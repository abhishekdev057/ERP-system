import { createHash } from "crypto";
import { GoogleGenerativeAI, TaskType } from "@google/generative-ai";
import { prisma } from "@/lib/prisma";
import { recordGeminiUsage } from "@/lib/gemini-usage";

export type MediaKnowledgeReferenceType =
    | "organization"
    | "member"
    | "student"
    | "book"
    | "document"
    | "media"
    | "schedule"
    | "whiteboard";

export type MediaKnowledgeReference = {
    type: MediaKnowledgeReferenceType;
    title: string;
    summary: string;
    sourceType?: string;
    sourceId?: string;
    score?: number;
    updatedAt?: string;
    metadata?: Record<string, unknown>;
};

export type KnowledgeIndexSummary = {
    totalIndexedItems: number;
    lastSyncedAt?: string;
    lastSourceUpdateAt?: string;
    embeddingsEnabled: boolean;
    sourceCounts: Record<string, number>;
};

export type MediaKnowledgeRetrievalResult = {
    references: MediaKnowledgeReference[];
    knowledgeContext: string;
    availableBookCount: number;
    availableDocumentCount: number;
    availableMemberCount: number;
    availableStudentCount: number;
    availableGeneratedMediaCount: number;
    availableScheduleCount: number;
    availableWhiteboardCount: number;
    totalIndexedItems: number;
    indexSummary: KnowledgeIndexSummary;
};

type KnowledgeSourceType =
    | "ORGANIZATION"
    | "MEMBER"
    | "STUDENT"
    | "BOOK"
    | "DOCUMENT"
    | "GENERATED_MEDIA"
    | "MEDIA_SCHEDULE"
    | "WHITEBOARD";

type SourceChunk = {
    organizationId: string;
    userId?: string | null;
    sourceType: KnowledgeSourceType;
    sourceId: string;
    chunkKey: string;
    title: string;
    summary: string;
    content: string;
    keywords: string[];
    metadata?: Record<string, unknown>;
    sourceUpdatedAt?: Date | null;
};

type IndexRow = {
    id: string;
    organizationId: string;
    userId?: string | null;
    sourceType: KnowledgeSourceType;
    sourceId: string;
    chunkKey: string;
    title: string;
    summary?: string | null;
    content: string;
    keywords?: string[];
    metadata?: Record<string, unknown> | null;
    contentHash: string;
    embedding?: number[] | null;
    embeddingModel?: string | null;
    sourceUpdatedAt?: Date | null;
    updatedAt?: Date;
};

type RetrievalScoredRow = IndexRow & {
    score: number;
    lexicalScore: number;
    semanticScore: number;
};

type WhiteboardSnapshotUpsertInput = {
    organizationId?: string | null;
    userId: string;
    storageKey: string;
    documentId?: string | null;
    title?: string | null;
    documentTitle?: string | null;
    pageNumber?: number;
    numPages?: number | null;
    summary?: string | null;
    contentText?: string | null;
    snapshotMeta?: Record<string, unknown> | null;
};

type TimelineConversationEntry = {
    remark?: string | null;
    channel?: string | null;
    date?: Date | string | null;
    member?: {
        name?: string | null;
        designation?: string | null;
    } | null;
    student?: {
        name?: string | null;
        classLevel?: string | null;
        status?: string | null;
        location?: string | null;
    } | null;
};

const EMBEDDING_MODEL = process.env.GEMINI_EMBEDDING_MODEL || "gemini-embedding-001";
const EMBEDDING_VERSION = 2;
const INDEX_SYNC_TTL_MS = 10 * 60 * 1000;
const QUERY_CANDIDATE_LIMIT = 160;
const QUERY_REFERENCE_LIMIT = 6;
const MAX_QUERY_KEYWORDS = 18;
const MAX_KEYWORDS_PER_CHUNK = 28;
const MAX_EMBED_BATCH_SIZE = 100;
const EMBEDDING_DISABLE_MS = 30 * 60 * 1000;
const BOOK_CHUNK_MAX = 1200;
const DOC_CHUNK_MAX = 1300;
const PROMPT_CONTEXT_LIMIT = 760;
const INDEX_SUMMARY_CACHE_TTL_MS = 60 * 1000;
const RETRIEVAL_CACHE_TTL_MS = 90 * 1000;
const QUERY_EMBED_CACHE_TTL_MS = 10 * 60 * 1000;

const prismaAny = prisma as any;
let embeddingDisabledUntil = 0;
let lastEmbeddingFailureReason = "";
const indexSummaryCache = new Map<string, { checkedAt: number; summary: KnowledgeIndexSummary }>();
const retrievalCache = new Map<string, { expiresAt: number; value: MediaKnowledgeRetrievalResult }>();
const queryEmbeddingCache = new Map<string, { expiresAt: number; embedding: number[] | null }>();

function sanitizeRagText(value: unknown, maxLength = 240): string {
    return String(value || "").replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function sanitizeLongText(value: unknown, maxLength = 8_000): string {
    return String(value || "")
        .replace(/\r/g, "\n")
        .replace(/[ \t]+/g, " ")
        .replace(/\n{3,}/g, "\n\n")
        .trim()
        .slice(0, maxLength);
}

function isEmbeddingRuntimeDisabled() {
    return embeddingDisabledUntil > Date.now();
}

function getEmbeddingRuntimeReason() {
    return isEmbeddingRuntimeDisabled() ? lastEmbeddingFailureReason : "";
}

function isEmbeddingSupportError(error: unknown) {
    const status = typeof error === "object" && error !== null ? Number((error as { status?: unknown }).status || 0) : 0;
    const message = error instanceof Error ? error.message.toLowerCase() : String(error || "").toLowerCase();
    return (
        status === 404 ||
        message.includes("not supported for embedcontent") ||
        message.includes("model") && message.includes("not found") ||
        message.includes("batchembedcontents")
    );
}

function disableEmbeddingsTemporarily(reason: string) {
    embeddingDisabledUntil = Date.now() + EMBEDDING_DISABLE_MS;
    lastEmbeddingFailureReason = reason;
}

function clearEmbeddingDisable() {
    embeddingDisabledUntil = 0;
    lastEmbeddingFailureReason = "";
}

function embeddingsConfiguredAndAvailable() {
    return Boolean(process.env.GEMINI_API_KEY) && !isEmbeddingRuntimeDisabled();
}

function splitIntoChunks(text: string, maxLength: number, overlap = 120): string[] {
    const normalized = sanitizeLongText(text, 30_000);
    if (!normalized) return [];
    if (normalized.length <= maxLength) return [normalized];

    const paragraphs = normalized
        .split(/\n{2,}/)
        .map((part) => part.trim())
        .filter(Boolean);

    const chunks: string[] = [];
    let current = "";

    const flush = () => {
        if (!current.trim()) return;
        chunks.push(current.trim());
        current = "";
    };

    for (const paragraph of paragraphs) {
        if (!current) {
            current = paragraph;
            continue;
        }

        const candidate = `${current}\n\n${paragraph}`.trim();
        if (candidate.length <= maxLength) {
            current = candidate;
            continue;
        }

        flush();
        const carry = chunks[chunks.length - 1]?.slice(-overlap).trim();
        current = carry ? `${carry}\n\n${paragraph}`.trim() : paragraph;
        if (current.length > maxLength) {
            const inlineParts = paragraph.match(new RegExp(`.{1,${Math.max(320, maxLength - overlap)}}`, "g")) || [];
            current = "";
            for (const part of inlineParts) {
                if (!current) {
                    current = part;
                    continue;
                }
                const inlineCandidate = `${current} ${part}`.trim();
                if (inlineCandidate.length <= maxLength) {
                    current = inlineCandidate;
                    continue;
                }
                flush();
                current = part;
            }
        }
    }

    flush();
    return chunks.filter(Boolean);
}

function extractPromptKeywords(prompt: string): string[] {
    const raw = String(prompt || "")
        .toLowerCase()
        .split(/[^a-z0-9\u0900-\u097f]+/i)
        .map((token) => token.trim())
        .filter((token) => token.length >= 2 && token.length <= 32);

    return Array.from(new Set(raw)).slice(0, MAX_QUERY_KEYWORDS);
}

function buildKeywordSet(...values: Array<string | undefined | null>) {
    const bag = values
        .flatMap((value) => extractPromptKeywords(String(value || "")))
        .filter(Boolean);
    return Array.from(new Set(bag)).slice(0, MAX_KEYWORDS_PER_CHUNK);
}

function hashContent(value: string) {
    return createHash("sha256").update(value).digest("hex");
}

function getRetrievalCacheKey(organizationId: string, prompt: string, limit: number) {
    return `${organizationId}::${limit}::${String(prompt || "")
        .toLowerCase()
        .replace(/\s+/g, " ")
        .trim()}`;
}

function invalidateRetrievalCacheForOrganization(organizationId: string) {
    for (const key of Array.from(retrievalCache.keys())) {
        if (key.startsWith(`${organizationId}::`)) {
            retrievalCache.delete(key);
        }
    }
}

function cosineSimilarity(left: number[], right: number[]) {
    if (!left.length || !right.length || left.length !== right.length) return 0;
    let dot = 0;
    let leftMag = 0;
    let rightMag = 0;
    for (let index = 0; index < left.length; index += 1) {
        dot += left[index] * right[index];
        leftMag += left[index] * left[index];
        rightMag += right[index] * right[index];
    }
    if (!leftMag || !rightMag) return 0;
    return dot / (Math.sqrt(leftMag) * Math.sqrt(rightMag));
}

function isPromotionalCreativePrompt(prompt: string): boolean {
    const normalized = String(prompt || "").toLowerCase();
    return [
        "admission",
        "addmission",
        "poster",
        "campaign",
        "promo",
        "promotion",
        "marketing",
        "instagram",
        "social media",
        "banner",
        "flyer",
        "brochure",
        "thumbnail",
        "advert",
        "branding",
        "reel",
        "folder cover",
        "folder image",
    ].some((term) => normalized.includes(term));
}

function classifyIntent(prompt: string) {
    const normalized = String(prompt || "").toLowerCase();
    return {
        promotional: isPromotionalCreativePrompt(prompt),
        academic:
            /\b(class|chapter|biology|physics|chemistry|math|agriculture|question|syllabus|notes|exam|folder|subject|document|pdf|book|library|content|inside)\b/.test(
                normalized
            ),
        people:
            /\b(student|lead|parent|teacher|member|staff|team|audience|batch|enquiry|enrollment|admission|conversation|timeline|remark|followup|follow-up|faculty|counsellor|counselor)\b/.test(
                normalized
            ),
        planning: /\b(schedule|calendar|planner|timeline|campaign plan|content plan|posting)\b/.test(normalized),
        whiteboard:
            /\b(board|whiteboard|annotat|diagram|session board|slide board|canvas)\b/.test(normalized),
    };
}

function sourceTypeToReferenceType(sourceType: KnowledgeSourceType): MediaKnowledgeReferenceType {
    switch (sourceType) {
        case "ORGANIZATION":
            return "organization";
        case "MEMBER":
            return "member";
        case "STUDENT":
            return "student";
        case "BOOK":
            return "book";
        case "DOCUMENT":
            return "document";
        case "GENERATED_MEDIA":
            return "media";
        case "MEDIA_SCHEDULE":
            return "schedule";
        case "WHITEBOARD":
            return "whiteboard";
    }
}

function buildPromptContext(references: MediaKnowledgeReference[], prompt: string) {
    const promotional = isPromotionalCreativePrompt(prompt);
    const selected = references.slice(0, promotional ? 4 : 5);
    return sanitizeRagText(
        selected
            .map((reference) => {
                const labelMap: Record<MediaKnowledgeReferenceType, string> = {
                    organization: "Institute",
                    member: "Member",
                    student: "Student",
                    book: "Library",
                    document: "Document",
                    media: "Media history",
                    schedule: "Scheduler",
                    whiteboard: "Whiteboard",
                };
                return `${labelMap[reference.type]} · ${reference.title}: ${sanitizeRagText(reference.summary, promotional ? 110 : 150)}`;
            })
            .join("; "),
        PROMPT_CONTEXT_LIMIT
    );
}

function formatConversationChannel(value: unknown) {
    const normalized = sanitizeRagText(value, 32).toLowerCase();
    switch (normalized) {
        case "in_person":
            return "In person";
        case "phone":
            return "Phone";
        case "email":
            return "Email";
        case "whatsapp":
            return "WhatsApp";
        case "other":
            return "Other";
        default:
            return normalized ? normalized.replace(/_/g, " ") : "Conversation";
    }
}

function formatConversationDate(value: Date | string | null | undefined) {
    const parsed = value instanceof Date ? value : value ? new Date(value) : null;
    if (!parsed || Number.isNaN(parsed.getTime())) return "";
    return parsed.toISOString().slice(0, 10);
}

function buildTimelineSummary(entries: TimelineConversationEntry[], perspective: "student" | "member") {
    return entries
        .slice(0, 4)
        .map((entry) => {
            const date = formatConversationDate(entry.date);
            const channel = formatConversationChannel(entry.channel);
            const counterpart =
                perspective === "student"
                    ? sanitizeRagText(entry.member?.name || entry.member?.designation, 48)
                    : sanitizeRagText(entry.student?.name, 48);
            return sanitizeRagText(
                [date, channel, counterpart, sanitizeRagText(entry.remark, 100)].filter(Boolean).join(" · "),
                140
            );
        })
        .filter(Boolean)
        .join(" | ");
}

function buildTimelineChunkContent(entries: TimelineConversationEntry[], perspective: "student" | "member") {
    return sanitizeLongText(
        entries
            .map((entry) => {
                const date = formatConversationDate(entry.date);
                const channel = formatConversationChannel(entry.channel);
                const counterpart =
                    perspective === "student"
                        ? sanitizeRagText(
                              entry.member?.name ||
                                  entry.member?.designation ||
                                  "Staff follow-up",
                              80
                          )
                        : sanitizeRagText(
                              [
                                  entry.student?.name || "Student",
                                  entry.student?.classLevel ? `Class ${entry.student.classLevel}` : "",
                                  entry.student?.status || "",
                              ]
                                  .filter(Boolean)
                                  .join(" · "),
                              100
                          );
                return [date, channel, counterpart, sanitizeRagText(entry.remark, 280)]
                    .filter(Boolean)
                    .join(" · ");
            })
            .filter(Boolean)
            .join("\n"),
        2_400
    );
}

function buildConversationTimelineChunks(options: {
    organizationId: string;
    sourceType: "STUDENT" | "MEMBER";
    sourceId: string;
    userId?: string | null;
    title: string;
    entries: TimelineConversationEntry[];
    sourceUpdatedAt?: Date | null;
    keywords: string[];
    perspective: "student" | "member";
}) {
    const groups: SourceChunk[] = [];
    for (let index = 0; index < options.entries.length; index += 4) {
        const slice = options.entries.slice(index, index + 4);
        if (!slice.length) continue;
        groups.push({
            organizationId: options.organizationId,
            userId: options.userId || null,
            sourceType: options.sourceType,
            sourceId: options.sourceId,
            chunkKey: `timeline_${Math.floor(index / 4) + 1}`,
            title: options.title,
            summary: sanitizeRagText(
                `${options.perspective === "student" ? "Conversation timeline" : "Student interaction timeline"} · ${buildTimelineSummary(slice, options.perspective)}`,
                220
            ),
            content: buildTimelineChunkContent(slice, options.perspective),
            keywords: buildKeywordSet(
                options.keywords.join(" "),
                ...slice.map((entry) =>
                    [
                        entry.remark,
                        entry.member?.name,
                        entry.member?.designation,
                        entry.student?.name,
                        entry.student?.classLevel,
                        entry.student?.status,
                    ]
                        .filter(Boolean)
                        .join(" ")
                )
            ),
            metadata: {
                timeline: true,
                perspective: options.perspective,
                entries: slice.length,
            },
            sourceUpdatedAt: options.sourceUpdatedAt || null,
        });
    }
    return groups;
}

function extractPdfQuestionLines(jsonData: unknown): string[] {
    if (!jsonData || typeof jsonData !== "object" || Array.isArray(jsonData)) return [];
    const payload = jsonData as Record<string, unknown>;
    const questions = Array.isArray(payload.questions) ? payload.questions : [];

    return questions.flatMap((item, index) => {
        if (!item || typeof item !== "object" || Array.isArray(item)) return [];
        const question = item as Record<string, unknown>;
        const questionNumber = sanitizeRagText(question.number ?? index + 1, 12);
        const questionText = sanitizeRagText(
            [question.questionHindi, question.questionEnglish].filter(Boolean).join(" / "),
            320
        );
        const options = Array.isArray(question.options)
            ? question.options
                  .map((option) => {
                      if (!option || typeof option !== "object" || Array.isArray(option)) return "";
                      const payloadOption = option as Record<string, unknown>;
                      return sanitizeRagText(
                          [payloadOption.hindi, payloadOption.english].filter(Boolean).join(" / "),
                          120
                      );
                  })
                  .filter(Boolean)
            : [];

        const correctAnswer = sanitizeRagText(question.answer ?? question.correctAnswer, 80);
        return [
            [
                `Q${questionNumber}`,
                questionText,
                options.length ? `Options: ${options.join(" | ")}` : "",
                correctAnswer ? `Answer: ${correctAnswer}` : "",
            ]
                .filter(Boolean)
                .join(" · "),
        ];
    });
}

function buildDocumentChunks(document: {
    id: string;
    title: string;
    subject?: string | null;
    date?: string | null;
    jsonData: unknown;
    updatedAt: Date;
    userId?: string | null;
}, organizationId: string): SourceChunk[] {
    const lines = extractPdfQuestionLines(document.jsonData);
    const grouped: string[] = [];

    for (let index = 0; index < lines.length; index += 6) {
        grouped.push(lines.slice(index, index + 6).join("\n"));
    }

    const baseChunks = grouped.length
        ? grouped
        : splitIntoChunks(
              sanitizeLongText(JSON.stringify(document.jsonData || {}), 6_000),
              DOC_CHUNK_MAX
          );

    return baseChunks.map((content, index) => ({
        organizationId,
        userId: document.userId,
        sourceType: "DOCUMENT",
        sourceId: document.id,
        chunkKey: `chunk_${index + 1}`,
        title: document.title,
        summary: sanitizeRagText(
            [
                document.subject ? `Subject ${document.subject}` : "",
                document.date ? `Date ${document.date}` : "",
                sanitizeRagText(content, 220),
            ]
                .filter(Boolean)
                .join(" · "),
            260
        ),
        content,
        keywords: buildKeywordSet(document.title, document.subject, content),
        metadata: {
            subject: document.subject || null,
            date: document.date || null,
            chunkIndex: index + 1,
        },
        sourceUpdatedAt: document.updatedAt,
    }));
}

function buildBookChunks(book: {
    id: string;
    title: string;
    description?: string | null;
    category?: string | null;
    classLevel?: string | null;
    extractedText?: string | null;
    updatedAt: Date;
}, organizationId: string): SourceChunk[] {
    const rawBody = sanitizeLongText(
        [book.description, book.extractedText].filter(Boolean).join("\n\n"),
        18_000
    );

    const chunks = splitIntoChunks(
        rawBody || `${book.title}. ${book.description || ""}`,
        BOOK_CHUNK_MAX
    );

    return chunks.map((content, index) => ({
        organizationId,
        sourceType: "BOOK",
        sourceId: book.id,
        chunkKey: `chunk_${index + 1}`,
        title: book.title,
        summary: sanitizeRagText(
            [
                book.classLevel ? `Class ${book.classLevel}` : "",
                book.category ? `Category ${book.category}` : "",
                sanitizeRagText(content, 210),
            ]
                .filter(Boolean)
                .join(" · "),
            260
        ),
        content,
        keywords: buildKeywordSet(book.title, book.description, book.category, book.classLevel, content),
        metadata: {
            category: book.category || null,
            classLevel: book.classLevel || null,
            chunkIndex: index + 1,
        },
        sourceUpdatedAt: book.updatedAt,
    }));
}

function normalizeStoryboard(storyboard: unknown) {
    if (!Array.isArray(storyboard)) return "";
    return storyboard
        .map((item) => sanitizeRagText(item, 120))
        .filter(Boolean)
        .join(" | ");
}

function summarizeKnowledgeReferences(value: unknown) {
    if (!Array.isArray(value)) return "";
    return value
        .map((item) => {
            if (!item || typeof item !== "object" || Array.isArray(item)) return "";
            const reference = item as Record<string, unknown>;
            return sanitizeRagText(
                [reference.type, reference.title, reference.summary].filter(Boolean).join(" · "),
                160
            );
        })
        .filter(Boolean)
        .slice(0, 5)
        .join(" | ");
}

function buildOrganizationChunk(organization: {
    id: string;
    name: string;
    orgType?: string | null;
    tagline?: string | null;
    description?: string | null;
    location?: string | null;
    audienceSummary?: string | null;
    boards: string[];
    classLevels: string[];
    subjects: string[];
    languages: string[];
    documentTypes: string[];
    workflowNeeds?: string | null;
    creativeNeeds?: string | null;
    aiGoals?: string | null;
    brandTone?: string | null;
    notesForAI?: string | null;
    updatedAt: Date;
}): SourceChunk {
    const content = sanitizeLongText(
        [
            organization.name,
            organization.orgType ? `Type: ${organization.orgType}` : "",
            organization.tagline ? `Tagline: ${organization.tagline}` : "",
            organization.description ? `Description: ${organization.description}` : "",
            organization.location ? `Location: ${organization.location}` : "",
            organization.audienceSummary ? `Audience: ${organization.audienceSummary}` : "",
            organization.boards.length ? `Boards: ${organization.boards.join(", ")}` : "",
            organization.classLevels.length ? `Classes: ${organization.classLevels.join(", ")}` : "",
            organization.subjects.length ? `Subjects: ${organization.subjects.join(", ")}` : "",
            organization.languages.length ? `Languages: ${organization.languages.join(", ")}` : "",
            organization.documentTypes.length ? `Document types: ${organization.documentTypes.join(", ")}` : "",
            organization.workflowNeeds ? `Workflow needs: ${organization.workflowNeeds}` : "",
            organization.creativeNeeds ? `Creative needs: ${organization.creativeNeeds}` : "",
            organization.aiGoals ? `AI goals: ${organization.aiGoals}` : "",
            organization.brandTone ? `Brand tone: ${organization.brandTone}` : "",
            organization.notesForAI ? `Notes for AI: ${organization.notesForAI}` : "",
        ]
            .filter(Boolean)
            .join("\n"),
        6_000
    );

    return {
        organizationId: organization.id,
        sourceType: "ORGANIZATION",
        sourceId: organization.id,
        chunkKey: "base",
        title: organization.name,
        summary: sanitizeRagText(
            [
                organization.orgType || "",
                organization.location || "",
                organization.audienceSummary || "",
            ]
                .filter(Boolean)
                .join(" · "),
            260
        ),
        content,
        keywords: buildKeywordSet(
            organization.name,
            organization.orgType,
            organization.location,
            organization.audienceSummary,
            organization.subjects.join(" "),
            organization.classLevels.join(" ")
        ),
        metadata: {
            boards: organization.boards,
            classLevels: organization.classLevels,
            subjects: organization.subjects,
            languages: organization.languages,
        },
        sourceUpdatedAt: organization.updatedAt,
    };
}

async function loadSourceChunksForOrganization(organizationId: string): Promise<SourceChunk[]> {
    const [organization, members, students, books, documents, generatedMedia, scheduleItems, whiteboardSnapshots] =
        await Promise.all([
            prisma.organization.findUnique({
                where: { id: organizationId },
                select: {
                    id: true,
                    name: true,
                    orgType: true,
                    tagline: true,
                    description: true,
                    location: true,
                    audienceSummary: true,
                    boards: true,
                    classLevels: true,
                    subjects: true,
                    languages: true,
                    documentTypes: true,
                    workflowNeeds: true,
                    creativeNeeds: true,
                    aiGoals: true,
                    brandTone: true,
                    notesForAI: true,
                    updatedAt: true,
                },
            }),
            prisma.user.findMany({
                where: { organizationId },
                select: {
                    id: true,
                    name: true,
                    email: true,
                    designation: true,
                    staffRole: true,
                    bio: true,
                    location: true,
                    role: true,
                    allowedTools: true,
                    updatedAt: true,
                    studentConversations: {
                        take: 12,
                        orderBy: { date: "desc" },
                        select: {
                            remark: true,
                            channel: true,
                            date: true,
                            student: {
                                select: {
                                    name: true,
                                    classLevel: true,
                                    status: true,
                                    location: true,
                                },
                            },
                        },
                    },
                },
                orderBy: { updatedAt: "desc" },
            }),
            prisma.student.findMany({
                where: { organizationId },
                select: {
                    id: true,
                    name: true,
                    phone: true,
                    email: true,
                    status: true,
                    leadConfidence: true,
                    tags: true,
                    location: true,
                    classLevel: true,
                    updatedAt: true,
                    conversations: {
                        take: 12,
                        orderBy: { date: "desc" },
                        select: {
                            remark: true,
                            channel: true,
                            date: true,
                            member: {
                                select: {
                                    name: true,
                                    designation: true,
                                },
                            },
                        },
                    },
                },
                orderBy: { updatedAt: "desc" },
            }),
            prisma.book.findMany({
                where: { organizationId },
                select: {
                    id: true,
                    title: true,
                    description: true,
                    category: true,
                    classLevel: true,
                    extractedText: true,
                    updatedAt: true,
                },
                orderBy: { updatedAt: "desc" },
            }),
            prisma.pdfDocument.findMany({
                where: { organizationId },
                select: {
                    id: true,
                    title: true,
                    subject: true,
                    date: true,
                    jsonData: true,
                    updatedAt: true,
                    userId: true,
                },
                orderBy: { updatedAt: "desc" },
            }),
            prisma.generatedMedia.findMany({
                where: { organizationId },
                select: {
                    id: true,
                    prompt: true,
                    effectivePrompt: true,
                    mode: true,
                    type: true,
                    note: true,
                    organizationName: true,
                    organizationSummary: true,
                    knowledgeReferences: true,
                    storyboard: true,
                    updatedAt: true,
                    userId: true,
                },
                orderBy: { updatedAt: "desc" },
                take: 120,
            }),
            prisma.mediaScheduleItem.findMany({
                where: { organizationId },
                select: {
                    id: true,
                    title: true,
                    description: true,
                    platform: true,
                    status: true,
                    scheduledFor: true,
                    timezone: true,
                    updatedAt: true,
                    userId: true,
                    generatedMedia: {
                        select: {
                            prompt: true,
                            type: true,
                            mode: true,
                        },
                    },
                },
                orderBy: { scheduledFor: "asc" },
                take: 160,
            }),
            prismaAny.whiteboardSnapshot?.findMany
                ? prismaAny.whiteboardSnapshot.findMany({
                      where: { organizationId },
                      orderBy: { updatedAt: "desc" },
                      take: 160,
                  })
                : Promise.resolve([]),
        ]);

    if (!organization) return [];

    const chunks: SourceChunk[] = [buildOrganizationChunk(organization)];

    for (const member of members) {
        const memberConversationSummary = buildTimelineSummary(member.studentConversations, "member");
        const memberKeywords = buildKeywordSet(
            member.name,
            member.email,
            member.designation,
            member.staffRole,
            member.location,
            member.bio,
            member.allowedTools.join(" "),
            memberConversationSummary
        );
        chunks.push({
            organizationId,
            userId: member.id,
            sourceType: "MEMBER",
            sourceId: member.id,
            chunkKey: "base",
            title: member.name || member.email || "Workspace member",
            summary: sanitizeRagText(
                [
                    member.designation || "",
                    member.staffRole || "",
                    member.role || "",
                    member.location || "",
                ]
                    .filter(Boolean)
                    .join(" · "),
                220
            ),
            content: sanitizeLongText(
                [
                    member.name ? `Name: ${member.name}` : "",
                    member.email ? `Email: ${member.email}` : "",
                    member.designation ? `Designation: ${member.designation}` : "",
                    member.staffRole ? `Staff role: ${member.staffRole}` : "",
                    member.role ? `Workspace role: ${member.role}` : "",
                    member.location ? `Location: ${member.location}` : "",
                    member.bio ? `Bio: ${member.bio}` : "",
                    member.allowedTools.length ? `Allowed tools: ${member.allowedTools.join(", ")}` : "",
                    memberConversationSummary ? `Recent student interactions: ${memberConversationSummary}` : "",
                ]
                    .filter(Boolean)
                    .join("\n"),
                2_400
            ),
            keywords: memberKeywords,
            metadata: {
                designation: member.designation || null,
                staffRole: member.staffRole || null,
                role: member.role || null,
            },
            sourceUpdatedAt: member.updatedAt,
        });

        if (member.studentConversations.length) {
            chunks.push(
                ...buildConversationTimelineChunks({
                    organizationId,
                    sourceType: "MEMBER",
                    sourceId: member.id,
                    userId: member.id,
                    title: `${member.name || member.email || "Member"} interaction timeline`,
                    entries: member.studentConversations,
                    sourceUpdatedAt: member.updatedAt,
                    keywords: memberKeywords,
                    perspective: "member",
                })
            );
        }
    }

    for (const student of students) {
        const conversationSummary = buildTimelineSummary(student.conversations, "student");
        const studentKeywords = buildKeywordSet(
            student.name,
            student.classLevel,
            student.location,
            student.status,
            student.tags.join(" "),
            conversationSummary
        );

        chunks.push({
            organizationId,
            sourceType: "STUDENT",
            sourceId: student.id,
            chunkKey: "base",
            title: student.name,
            summary: sanitizeRagText(
                [
                    student.status,
                    student.leadConfidence || "",
                    student.classLevel || "",
                    student.location || "",
                ]
                    .filter(Boolean)
                    .join(" · "),
                220
            ),
            content: sanitizeLongText(
                [
                    `Student: ${student.name}`,
                    student.phone ? `Phone: ${student.phone}` : "",
                    student.email ? `Email: ${student.email}` : "",
                    `Status: ${student.status}`,
                    student.leadConfidence ? `Lead confidence: ${student.leadConfidence}` : "",
                    student.classLevel ? `Class level: ${student.classLevel}` : "",
                    student.location ? `Location: ${student.location}` : "",
                    student.tags.length ? `Tags: ${student.tags.join(", ")}` : "",
                    conversationSummary ? `Recent conversations: ${conversationSummary}` : "",
                ]
                    .filter(Boolean)
                    .join("\n"),
                2_400
            ),
            keywords: studentKeywords,
            metadata: {
                status: student.status,
                leadConfidence: student.leadConfidence || null,
                classLevel: student.classLevel || null,
            },
            sourceUpdatedAt: student.updatedAt,
        });

        if (student.conversations.length) {
            chunks.push(
                ...buildConversationTimelineChunks({
                    organizationId,
                    sourceType: "STUDENT",
                    sourceId: student.id,
                    title: `${student.name} conversation timeline`,
                    entries: student.conversations,
                    sourceUpdatedAt: student.updatedAt,
                    keywords: studentKeywords,
                    perspective: "student",
                })
            );
        }
    }

    for (const book of books) {
        chunks.push(...buildBookChunks(book, organizationId));
    }

    for (const document of documents) {
        chunks.push(...buildDocumentChunks(document, organizationId));
    }

    for (const asset of generatedMedia) {
        chunks.push({
            organizationId,
            userId: asset.userId,
            sourceType: "GENERATED_MEDIA",
            sourceId: asset.id,
            chunkKey: "base",
            title: sanitizeRagText(asset.prompt, 90) || `Generated ${asset.type}`,
            summary: sanitizeRagText(
                [
                    asset.mode,
                    asset.type,
                    asset.note || "",
                    summarizeKnowledgeReferences(asset.knowledgeReferences),
                ]
                    .filter(Boolean)
                    .join(" · "),
                240
            ),
            content: sanitizeLongText(
                [
                    `Original prompt: ${asset.prompt}`,
                    asset.effectivePrompt ? `Effective prompt: ${asset.effectivePrompt}` : "",
                    asset.note ? `Generation note: ${asset.note}` : "",
                    asset.organizationSummary ? `Institute summary: ${asset.organizationSummary}` : "",
                    asset.storyboard ? `Storyboard: ${normalizeStoryboard(asset.storyboard)}` : "",
                    asset.knowledgeReferences ? `Supporting references: ${summarizeKnowledgeReferences(asset.knowledgeReferences)}` : "",
                ]
                    .filter(Boolean)
                    .join("\n"),
                3_000
            ),
            keywords: buildKeywordSet(
                asset.prompt,
                asset.effectivePrompt,
                asset.note,
                asset.organizationName,
                normalizeStoryboard(asset.storyboard)
            ),
            metadata: {
                mode: asset.mode,
                type: asset.type,
            },
            sourceUpdatedAt: asset.updatedAt,
        });
    }

    for (const item of scheduleItems) {
        chunks.push({
            organizationId,
            userId: item.userId,
            sourceType: "MEDIA_SCHEDULE",
            sourceId: item.id,
            chunkKey: "base",
            title: item.title,
            summary: sanitizeRagText(
                [
                    item.platform,
                    item.status,
                    item.scheduledFor.toISOString(),
                ]
                    .filter(Boolean)
                    .join(" · "),
                220
            ),
            content: sanitizeLongText(
                [
                    `Scheduled item: ${item.title}`,
                    item.description ? `Description: ${item.description}` : "",
                    `Platform: ${item.platform}`,
                    `Status: ${item.status}`,
                    `Scheduled for: ${item.scheduledFor.toISOString()} ${item.timezone}`,
                    item.generatedMedia?.prompt ? `Linked creative prompt: ${item.generatedMedia.prompt}` : "",
                    item.generatedMedia?.mode ? `Linked creative mode: ${item.generatedMedia.mode}` : "",
                ]
                    .filter(Boolean)
                    .join("\n"),
                2_200
            ),
            keywords: buildKeywordSet(
                item.title,
                item.description,
                item.platform,
                item.status,
                item.generatedMedia?.prompt || ""
            ),
            metadata: {
                platform: item.platform,
                status: item.status,
            },
            sourceUpdatedAt: item.updatedAt,
        });
    }

    for (const snapshot of whiteboardSnapshots as Array<Record<string, unknown>>) {
        chunks.push({
            organizationId,
            userId: String(snapshot.userId || "").trim() || null,
            sourceType: "WHITEBOARD",
            sourceId: String(snapshot.id || "").trim(),
            chunkKey: "base",
            title: sanitizeRagText(snapshot.title || snapshot.documentTitle || "Whiteboard snapshot", 90),
            summary: sanitizeRagText(
                [
                    snapshot.documentTitle ? `Document ${snapshot.documentTitle}` : "",
                    snapshot.pageNumber ? `Page ${snapshot.pageNumber}` : "",
                    snapshot.summary ? String(snapshot.summary) : "",
                ]
                    .filter(Boolean)
                    .join(" · "),
                240
            ),
            content: sanitizeLongText(
                [
                    snapshot.title ? `Board title: ${snapshot.title}` : "",
                    snapshot.documentTitle ? `Document: ${snapshot.documentTitle}` : "",
                    snapshot.summary ? `Summary: ${snapshot.summary}` : "",
                    snapshot.contentText ? `Board content: ${snapshot.contentText}` : "",
                ]
                    .filter(Boolean)
                    .join("\n"),
                3_200
            ),
            keywords: buildKeywordSet(
                String(snapshot.title || ""),
                String(snapshot.documentTitle || ""),
                String(snapshot.summary || ""),
                String(snapshot.contentText || "")
            ),
            metadata: {
                pageNumber: Number(snapshot.pageNumber || 1),
                numPages: Number(snapshot.numPages || 0) || null,
                documentId: String(snapshot.documentId || "").trim() || null,
            },
            sourceUpdatedAt: snapshot.updatedAt instanceof Date ? snapshot.updatedAt : new Date(String(snapshot.updatedAt || new Date().toISOString())),
        });
    }

    return chunks.filter((chunk) => chunk.sourceId && chunk.title && chunk.content);
}

async function embedTexts(texts: string[]) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey || !texts.length || isEmbeddingRuntimeDisabled()) {
        return texts.map(() => null);
    }

    try {
        const genAI = new GoogleGenerativeAI(apiKey);
        const model = genAI.getGenerativeModel({ model: EMBEDDING_MODEL });
        const embeddings: Array<number[] | null> = [];

        for (let start = 0; start < texts.length; start += MAX_EMBED_BATCH_SIZE) {
            const batch = texts.slice(start, start + MAX_EMBED_BATCH_SIZE);
            await recordGeminiUsage("knowledge_index_embedding");
            const response = await model.batchEmbedContents({
                requests: batch.map((text) => ({
                    taskType: TaskType.RETRIEVAL_DOCUMENT,
                    content: {
                        role: "user",
                        parts: [{ text }],
                    },
                })),
            });
            embeddings.push(
                ...(response.embeddings || []).map((item) => (Array.isArray(item.values) ? item.values : null))
            );
        }

        while (embeddings.length < texts.length) {
            embeddings.push(null);
        }

        clearEmbeddingDisable();
        return embeddings;
    } catch (error) {
        console.error("Failed to embed knowledge index batch:", error);
        if (isEmbeddingSupportError(error)) {
            disableEmbeddingsTemporarily(
                "Gemini embedding model is unavailable for this API key/version. Falling back to keyword retrieval."
            );
        }
        return texts.map(() => null);
    }
}

async function embedQuery(prompt: string) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey || !prompt.trim() || isEmbeddingRuntimeDisabled()) return null;

    const cacheKey = String(prompt || "").toLowerCase().replace(/\s+/g, " ").trim();
    const cached = queryEmbeddingCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
        return cached.embedding;
    }

    try {
        const genAI = new GoogleGenerativeAI(apiKey);
        const model = genAI.getGenerativeModel({ model: EMBEDDING_MODEL });
        await recordGeminiUsage("knowledge_query_embedding");
        const response = await model.embedContent({
            taskType: TaskType.RETRIEVAL_QUERY,
            content: {
                role: "user",
                parts: [{ text: prompt }],
            },
        });
        clearEmbeddingDisable();
        const embedding = Array.isArray(response.embedding.values) ? response.embedding.values : null;
        queryEmbeddingCache.set(cacheKey, {
            expiresAt: Date.now() + QUERY_EMBED_CACHE_TTL_MS,
            embedding,
        });
        return embedding;
    } catch (error) {
        console.error("Failed to embed knowledge query:", error);
        if (isEmbeddingSupportError(error)) {
            disableEmbeddingsTemporarily(
                "Gemini embedding model is unavailable for this API key/version. Falling back to keyword retrieval."
            );
        }
        queryEmbeddingCache.set(cacheKey, {
            expiresAt: Date.now() + 30 * 1000,
            embedding: null,
        });
        return null;
    }
}

async function computeLatestOrganizationSourceUpdatedAt(organizationId: string) {
    const [organization, user, student, book, document, media, schedule, whiteboard] = await Promise.all([
        prisma.organization.findUnique({
            where: { id: organizationId },
            select: { updatedAt: true },
        }),
        prisma.user.findFirst({
            where: { organizationId },
            orderBy: { updatedAt: "desc" },
            select: { updatedAt: true },
        }),
        prisma.student.findFirst({
            where: { organizationId },
            orderBy: { updatedAt: "desc" },
            select: { updatedAt: true },
        }),
        prisma.book.findFirst({
            where: { organizationId },
            orderBy: { updatedAt: "desc" },
            select: { updatedAt: true },
        }),
        prisma.pdfDocument.findFirst({
            where: { organizationId },
            orderBy: { updatedAt: "desc" },
            select: { updatedAt: true },
        }),
        prisma.generatedMedia.findFirst({
            where: { organizationId },
            orderBy: { updatedAt: "desc" },
            select: { updatedAt: true },
        }),
        prisma.mediaScheduleItem.findFirst({
            where: { organizationId },
            orderBy: { updatedAt: "desc" },
            select: { updatedAt: true },
        }),
        prismaAny.whiteboardSnapshot?.findFirst
            ? prismaAny.whiteboardSnapshot.findFirst({
                  where: { organizationId },
                  orderBy: { updatedAt: "desc" },
                  select: { updatedAt: true },
              })
            : Promise.resolve(null),
    ]);

    const candidates = [
        organization?.updatedAt,
        user?.updatedAt,
        student?.updatedAt,
        book?.updatedAt,
        document?.updatedAt,
        media?.updatedAt,
        schedule?.updatedAt,
        whiteboard?.updatedAt,
    ].filter(Boolean) as Date[];

    if (!candidates.length) return undefined;
    return candidates.reduce((latest, current) => (current > latest ? current : latest), candidates[0]);
}

function buildStateSummary(state: Record<string, unknown> | null | undefined): KnowledgeIndexSummary {
    const sourceCounts =
        state?.sourceCounts && typeof state.sourceCounts === "object"
            ? (state.sourceCounts as Record<string, number>)
            : {};

    return {
        totalIndexedItems: Number(state?.itemCount || 0),
        lastSyncedAt: state?.lastSuccessfulSyncAt ? new Date(String(state.lastSuccessfulSyncAt)).toISOString() : undefined,
        lastSourceUpdateAt: state?.lastSourceUpdateAt ? new Date(String(state.lastSourceUpdateAt)).toISOString() : undefined,
        embeddingsEnabled: Boolean(state?.embeddingsEnabled),
        sourceCounts,
    };
}

export async function syncKnowledgeIndexForOrganization(organizationId: string): Promise<KnowledgeIndexSummary> {
    const allChunks = await loadSourceChunksForOrganization(organizationId);
    const existingRows = prismaAny.knowledgeIndexItem?.findMany
        ? await prismaAny.knowledgeIndexItem.findMany({
              where: { organizationId },
              select: {
                  id: true,
                  sourceType: true,
                  sourceId: true,
                  chunkKey: true,
                  contentHash: true,
                  embedding: true,
                  embeddingModel: true,
                  embeddingVersion: true,
              },
          })
        : [];

    const existingByKey = new Map<
        string,
        {
            id: string;
            contentHash: string;
            embedding: unknown;
            embeddingModel: string | null;
            embeddingVersion: number | null;
        }
    >();
    for (const row of existingRows as Array<Record<string, unknown>>) {
        existingByKey.set(
            `${row.sourceType}:${row.sourceId}:${row.chunkKey}`,
            {
                id: String(row.id),
                contentHash: String(row.contentHash || ""),
                embedding: row.embedding,
                embeddingModel: row.embeddingModel ? String(row.embeddingModel) : null,
                embeddingVersion:
                    typeof row.embeddingVersion === "number" ? row.embeddingVersion : Number(row.embeddingVersion || 0) || null,
            }
        );
    }

    const nextKeys = new Set<string>();
    const creates: SourceChunk[] = [];
    const updates: Array<SourceChunk & { id: string }> = [];
    const sourceCountSet = new Map<KnowledgeSourceType, Set<string>>();

    for (const chunk of allChunks) {
        const compositeKey = `${chunk.sourceType}:${chunk.sourceId}:${chunk.chunkKey}`;
        nextKeys.add(compositeKey);
        const contentHash = hashContent(`${chunk.title}\n${chunk.summary}\n${chunk.content}`);
        const existing = existingByKey.get(compositeKey);
        sourceCountSet.set(
            chunk.sourceType,
            new Set([...(Array.from(sourceCountSet.get(chunk.sourceType) || [])), chunk.sourceId])
        );

        if (!existing) {
            creates.push({ ...chunk, metadata: { ...(chunk.metadata || {}), contentHash } });
            continue;
        }

        const needsEmbeddingRefresh =
            embeddingsConfiguredAndAvailable() &&
            (!Array.isArray(existing.embedding) ||
                existing.embeddingModel !== EMBEDDING_MODEL ||
                existing.embeddingVersion !== EMBEDDING_VERSION);

        if (existing.contentHash !== contentHash || needsEmbeddingRefresh) {
            updates.push({ ...chunk, id: existing.id, metadata: { ...(chunk.metadata || {}), contentHash } });
        }
    }

    const staleIds = (existingRows as Array<Record<string, string>>)
        .filter((row) => !nextKeys.has(`${row.sourceType}:${row.sourceId}:${row.chunkKey}`))
        .map((row) => row.id);

    const changedChunks = [...creates, ...updates];
    const embeddings = await embedTexts(changedChunks.map((chunk) => chunk.content));

    for (let index = 0; index < creates.length; index += 1) {
        const chunk = creates[index];
        const embedding = embeddings[index];
        const contentHash = String((chunk.metadata as Record<string, unknown>)?.contentHash || "");
        await prismaAny.knowledgeIndexItem.create({
            data: {
                organizationId: chunk.organizationId,
                userId: chunk.userId || null,
                sourceType: chunk.sourceType,
                sourceId: chunk.sourceId,
                chunkKey: chunk.chunkKey,
                title: chunk.title,
                summary: chunk.summary,
                content: chunk.content,
                keywords: chunk.keywords,
                metadata: chunk.metadata || null,
                contentHash,
                embedding: embedding || undefined,
                embeddingModel: embedding ? EMBEDDING_MODEL : null,
                embeddingVersion: EMBEDDING_VERSION,
                sourceUpdatedAt: chunk.sourceUpdatedAt || null,
                indexedAt: new Date(),
            },
        });
    }

    for (let index = 0; index < updates.length; index += 1) {
        const chunk = updates[index];
        const embedding = embeddings[creates.length + index];
        const contentHash = String((chunk.metadata as Record<string, unknown>)?.contentHash || "");
        await prismaAny.knowledgeIndexItem.update({
            where: { id: chunk.id },
            data: {
                userId: chunk.userId || null,
                title: chunk.title,
                summary: chunk.summary,
                content: chunk.content,
                keywords: chunk.keywords,
                metadata: chunk.metadata || null,
                contentHash,
                embedding: embedding || undefined,
                embeddingModel: embedding ? EMBEDDING_MODEL : null,
                embeddingVersion: EMBEDDING_VERSION,
                sourceUpdatedAt: chunk.sourceUpdatedAt || null,
                indexedAt: new Date(),
            },
        });
    }

    if (staleIds.length) {
        await prismaAny.knowledgeIndexItem.deleteMany({
            where: {
                id: { in: staleIds },
            },
        });
    }

    const lastSourceUpdateAt = await computeLatestOrganizationSourceUpdatedAt(organizationId);
    const sourceCounts = Object.fromEntries(
        Array.from(sourceCountSet.entries()).map(([type, ids]) => [type, ids.size])
    );
    const now = new Date();

    const state = await prismaAny.knowledgeIndexState.upsert({
        where: { organizationId },
        update: {
            status: "ready",
            itemCount: allChunks.length,
            sourceCounts,
            embeddingsEnabled: embeddingsConfiguredAndAvailable(),
            lastFullSyncAt: now,
            lastSuccessfulSyncAt: now,
            lastSourceUpdateAt: lastSourceUpdateAt || null,
            lastError: getEmbeddingRuntimeReason() || null,
        },
        create: {
            organizationId,
            status: "ready",
            itemCount: allChunks.length,
            sourceCounts,
            embeddingsEnabled: embeddingsConfiguredAndAvailable(),
            lastFullSyncAt: now,
            lastSuccessfulSyncAt: now,
            lastSourceUpdateAt: lastSourceUpdateAt || null,
            lastError: getEmbeddingRuntimeReason() || null,
        },
    });

    const summary = buildStateSummary(state);
    indexSummaryCache.set(organizationId, {
        checkedAt: Date.now(),
        summary,
    });
    invalidateRetrievalCacheForOrganization(organizationId);
    return summary;
}

export async function ensureKnowledgeIndexFresh(organizationId: string): Promise<KnowledgeIndexSummary> {
    const cached = indexSummaryCache.get(organizationId);
    if (cached && Date.now() - cached.checkedAt < INDEX_SUMMARY_CACHE_TTL_MS) {
        return cached.summary;
    }

    const state = prismaAny.knowledgeIndexState?.findUnique
        ? await prismaAny.knowledgeIndexState.findUnique({
              where: { organizationId },
          })
        : null;

    const latestSourceUpdate = await computeLatestOrganizationSourceUpdatedAt(organizationId);
    const lastSuccessfulSyncAt = state?.lastSuccessfulSyncAt ? new Date(String(state.lastSuccessfulSyncAt)) : null;
    const syncAgeMs = lastSuccessfulSyncAt ? Date.now() - lastSuccessfulSyncAt.getTime() : Number.POSITIVE_INFINITY;
    const sourceChanged =
        Boolean(latestSourceUpdate) &&
        (!lastSuccessfulSyncAt || latestSourceUpdate!.getTime() > lastSuccessfulSyncAt.getTime());

    const needsEmbeddingBackfill =
        embeddingsConfiguredAndAvailable() &&
        (Boolean(state?.embeddingsEnabled) === false ||
            Boolean(
                await prismaAny.knowledgeIndexItem?.findFirst?.({
                    where: {
                        organizationId,
                        OR: [
                            { embeddingModel: null },
                            { embeddingModel: { not: EMBEDDING_MODEL } },
                            { embeddingVersion: { not: EMBEDDING_VERSION } },
                        ],
                    },
                    select: { id: true },
                })
            ));

    if (!state || syncAgeMs > INDEX_SYNC_TTL_MS || sourceChanged || Number(state.itemCount || 0) === 0 || needsEmbeddingBackfill) {
        const summary = await syncKnowledgeIndexForOrganization(organizationId);
        indexSummaryCache.set(organizationId, {
            checkedAt: Date.now(),
            summary,
        });
        invalidateRetrievalCacheForOrganization(organizationId);
        return summary;
    }

    const summary = buildStateSummary(state);
    indexSummaryCache.set(organizationId, {
        checkedAt: Date.now(),
        summary,
    });
    return summary;
}

function getSourceBoost(sourceType: KnowledgeSourceType, prompt: string) {
    const intent = classifyIntent(prompt);
    const hasPrompt = Boolean(String(prompt || "").trim());

    if (intent.promotional) {
        if (sourceType === "ORGANIZATION") return 6;
        if (sourceType === "GENERATED_MEDIA") return 4;
        if (sourceType === "MEDIA_SCHEDULE") return 3;
        if (sourceType === "BOOK" || sourceType === "DOCUMENT") return 1;
        if (sourceType === "WHITEBOARD") return 1;
    }

    if (intent.academic) {
        if (sourceType === "BOOK") return 10;
        if (sourceType === "DOCUMENT") return 9;
        if (sourceType === "WHITEBOARD") return 6;
        if (sourceType === "ORGANIZATION") return 2;
        if (sourceType === "GENERATED_MEDIA") return -6;
        if (sourceType === "MEDIA_SCHEDULE") return -4;
    }

    if (intent.people) {
        if (sourceType === "STUDENT") return 8;
        if (sourceType === "MEMBER") return 7;
        if (sourceType === "ORGANIZATION") return 4;
        if (sourceType === "DOCUMENT") return 2;
        if (sourceType === "GENERATED_MEDIA") return -3;
    }

    if (intent.planning) {
        if (sourceType === "MEDIA_SCHEDULE") return 5;
        if (sourceType === "GENERATED_MEDIA") return 3;
    }

    if (intent.whiteboard && sourceType === "WHITEBOARD") {
        return 5;
    }

    if (!hasPrompt) {
        if (sourceType === "ORGANIZATION") return 6;
        if (sourceType === "BOOK") return 5;
        if (sourceType === "DOCUMENT") return 5;
        if (sourceType === "WHITEBOARD") return 4;
        if (sourceType === "GENERATED_MEDIA") return 1;
        if (sourceType === "MEDIA_SCHEDULE") return 1;
    }

    if (sourceType === "ORGANIZATION") return 2;
    if (sourceType === "BOOK" || sourceType === "DOCUMENT") return 1;
    return 0;
}

function getSourcePriority(sourceType: KnowledgeSourceType, prompt: string) {
    const intent = classifyIntent(prompt);
    const hasPrompt = Boolean(String(prompt || "").trim());

    if (intent.academic) {
        switch (sourceType) {
            case "BOOK":
                return 0;
            case "DOCUMENT":
                return 1;
            case "WHITEBOARD":
                return 2;
            case "ORGANIZATION":
                return 3;
            case "GENERATED_MEDIA":
                return 4;
            case "MEDIA_SCHEDULE":
                return 5;
            default:
                return 6;
        }
    }

    if (intent.people) {
        switch (sourceType) {
            case "STUDENT":
                return 0;
            case "MEMBER":
                return 1;
            case "ORGANIZATION":
                return 2;
            case "DOCUMENT":
                return 3;
            case "WHITEBOARD":
                return 4;
            case "GENERATED_MEDIA":
                return 5;
            default:
                return 6;
        }
    }

    if (intent.planning) {
        switch (sourceType) {
            case "MEDIA_SCHEDULE":
                return 0;
            case "GENERATED_MEDIA":
                return 1;
            case "ORGANIZATION":
                return 2;
            case "DOCUMENT":
                return 3;
            default:
                return 4;
        }
    }

    if (intent.promotional) {
        switch (sourceType) {
            case "ORGANIZATION":
                return 0;
            case "GENERATED_MEDIA":
                return 1;
            case "MEDIA_SCHEDULE":
                return 2;
            case "BOOK":
            case "DOCUMENT":
                return 3;
            default:
                return 4;
        }
    }

    if (!hasPrompt) {
        switch (sourceType) {
            case "ORGANIZATION":
                return 0;
            case "BOOK":
                return 1;
            case "DOCUMENT":
                return 2;
            case "WHITEBOARD":
                return 3;
            case "GENERATED_MEDIA":
                return 4;
            case "MEDIA_SCHEDULE":
                return 5;
            default:
                return 6;
        }
    }

    return 10;
}

function computeLexicalScore(row: IndexRow, prompt: string, keywords: string[]) {
    if (!keywords.length) return 0;
    const intent = classifyIntent(prompt);
    const haystack = `${row.title} ${row.summary || ""} ${row.content}`.toLowerCase();
    const baseScore = keywords.reduce((score, keyword) => {
        if (!keyword) return score;
        if (haystack.includes(keyword)) return score + (row.title.toLowerCase().includes(keyword) ? 5 : 2.5);
        return score;
    }, 0);

    if (intent.academic) {
        if (row.sourceType === "BOOK" || row.sourceType === "DOCUMENT") {
            return baseScore * 1.2;
        }
        if (row.sourceType === "WHITEBOARD") {
            return baseScore * 1.1;
        }
        if (row.sourceType === "GENERATED_MEDIA") {
            return baseScore * 0.25;
        }
    }

    if (intent.promotional) {
        if (row.sourceType === "GENERATED_MEDIA") {
            return baseScore * 1.15;
        }
        if (row.sourceType === "BOOK" || row.sourceType === "DOCUMENT") {
            return baseScore * 0.65;
        }
    }

    return baseScore;
}

function getSourceTypeCap(sourceType: KnowledgeSourceType, prompt: string) {
    const intent = classifyIntent(prompt);
    const hasPrompt = Boolean(String(prompt || "").trim());

    if (intent.academic) {
        if (sourceType === "GENERATED_MEDIA") return 1;
        if (sourceType === "BOOK" || sourceType === "DOCUMENT") return 3;
        if (sourceType === "WHITEBOARD") return 2;
    }

    if (intent.people) {
        if (sourceType === "STUDENT" || sourceType === "MEMBER") return 4;
        if (sourceType === "ORGANIZATION") return 2;
        if (sourceType === "DOCUMENT" || sourceType === "BOOK") return 2;
    }

    if (!hasPrompt) {
        if (sourceType === "GENERATED_MEDIA") return 1;
        if (sourceType === "ORGANIZATION") return 1;
        if (sourceType === "BOOK" || sourceType === "DOCUMENT") return 2;
    }

    return 3;
}

async function fetchCandidateRows(organizationId: string, keywords: string[]) {
    const keywordSlice = keywords.slice(0, 10);

    const [keywordRows, recentRows] = await Promise.all([
        keywordSlice.length
            ? prismaAny.knowledgeIndexItem.findMany({
                  where: {
                      organizationId,
                      keywords: {
                          hasSome: keywordSlice,
                      },
                  },
                  orderBy: { updatedAt: "desc" },
                  take: QUERY_CANDIDATE_LIMIT,
              })
            : Promise.resolve([]),
        prismaAny.knowledgeIndexItem.findMany({
            where: { organizationId },
            orderBy: { updatedAt: "desc" },
            take: QUERY_CANDIDATE_LIMIT,
        }),
    ]);

    const map = new Map<string, IndexRow>();
    for (const row of [...keywordRows, ...recentRows] as Array<Record<string, unknown>>) {
        const key = `${row.sourceType}:${row.sourceId}:${row.chunkKey}`;
        map.set(key, {
            id: String(row.id),
            organizationId: String(row.organizationId),
            userId: row.userId ? String(row.userId) : null,
            sourceType: String(row.sourceType) as KnowledgeSourceType,
            sourceId: String(row.sourceId),
            chunkKey: String(row.chunkKey),
            title: String(row.title),
            summary: row.summary ? String(row.summary) : null,
            content: String(row.content),
            keywords: Array.isArray(row.keywords) ? (row.keywords as string[]) : [],
            metadata: row.metadata && typeof row.metadata === "object" ? (row.metadata as Record<string, unknown>) : null,
            contentHash: String(row.contentHash || ""),
            embedding: Array.isArray(row.embedding) ? (row.embedding as number[]) : null,
            embeddingModel: row.embeddingModel ? String(row.embeddingModel) : null,
            sourceUpdatedAt: row.sourceUpdatedAt ? new Date(String(row.sourceUpdatedAt)) : null,
            updatedAt: row.updatedAt ? new Date(String(row.updatedAt)) : undefined,
        });
    }

    return Array.from(map.values());
}

export async function retrieveKnowledgeForPrompt(options: {
    organizationId: string | null;
    prompt: string;
    limit?: number;
}): Promise<MediaKnowledgeRetrievalResult> {
    const organizationId = String(options.organizationId || "").trim();
    if (!organizationId) {
        return {
            references: [],
            knowledgeContext: "",
            availableBookCount: 0,
            availableDocumentCount: 0,
            availableMemberCount: 0,
            availableStudentCount: 0,
            availableGeneratedMediaCount: 0,
            availableScheduleCount: 0,
            availableWhiteboardCount: 0,
            totalIndexedItems: 0,
            indexSummary: {
                totalIndexedItems: 0,
                embeddingsEnabled: false,
                sourceCounts: {},
            },
        };
    }

    const prompt = String(options.prompt || "").trim();
    const limit = Math.max(1, Math.min(12, Number(options.limit || QUERY_REFERENCE_LIMIT)));
    const retrievalCacheKey = getRetrievalCacheKey(organizationId, prompt, limit);
    const cachedRetrieval = retrievalCache.get(retrievalCacheKey);
    if (cachedRetrieval && cachedRetrieval.expiresAt > Date.now()) {
        return cachedRetrieval.value;
    }

    const indexSummary = await ensureKnowledgeIndexFresh(organizationId);
    const keywords = extractPromptKeywords(prompt);
    const candidates = await fetchCandidateRows(organizationId, keywords);
    const intent = classifyIntent(prompt);
    const preliminaryLexical = candidates.map((row) => ({
        row,
        lexicalScore: computeLexicalScore(row, prompt, keywords),
    }));
    const usefulLexicalHits = preliminaryLexical.filter((entry) => entry.lexicalScore > 0).length;
    const strongestLexicalHit = preliminaryLexical[0]?.lexicalScore || 0;
    const shouldUseSemantic =
        Boolean(prompt) &&
        embeddingsConfiguredAndAvailable() &&
        !intent.people &&
        (keywords.length >= 4 || prompt.length >= 42) &&
        (usefulLexicalHits < Math.min(4, limit) || strongestLexicalHit < 8);
    const queryEmbedding = shouldUseSemantic ? await embedQuery(prompt) : null;

    const scored = preliminaryLexical
        .map(({ row, lexicalScore }) => {
            const semanticScore =
                queryEmbedding && Array.isArray(row.embedding)
                    ? Math.max(0, cosineSimilarity(queryEmbedding, row.embedding))
                    : 0;
            const freshnessBoost = row.updatedAt
                ? Math.max(0, 2 - (Date.now() - row.updatedAt.getTime()) / (1000 * 60 * 60 * 24 * 7))
                : 0;
            const score =
                lexicalScore +
                semanticScore * 22 +
                getSourceBoost(row.sourceType, prompt) +
                freshnessBoost;

            return {
                ...row,
                score,
                lexicalScore,
                semanticScore,
            } satisfies RetrievalScoredRow;
        })
        .sort((left, right) => {
            const scoreDelta = right.score - left.score;
            if (Math.abs(scoreDelta) > 4) return scoreDelta;
            const priorityDelta = getSourcePriority(left.sourceType, prompt) - getSourcePriority(right.sourceType, prompt);
            if (priorityDelta !== 0) return priorityDelta;
            if (right.score !== left.score) return right.score - left.score;
            return (right.updatedAt?.getTime() || 0) - (left.updatedAt?.getTime() || 0);
        });

    const perSourceCount = new Map<string, number>();
    const perSourceTypeCount = new Map<KnowledgeSourceType, number>();
    const references: MediaKnowledgeReference[] = [];

    for (const row of scored) {
        const sourceKey = `${row.sourceType}:${row.sourceId}`;
        const usedCount = perSourceCount.get(sourceKey) || 0;
        if (usedCount >= 2) continue;
        const typeCount = perSourceTypeCount.get(row.sourceType) || 0;
        if (typeCount >= getSourceTypeCap(row.sourceType, prompt)) continue;

        if (prompt && row.score <= 0.4 && references.length >= 2) {
            continue;
        }

        perSourceCount.set(sourceKey, usedCount + 1);
        perSourceTypeCount.set(row.sourceType, typeCount + 1);
        references.push({
            type: sourceTypeToReferenceType(row.sourceType),
            title: row.title,
            summary: sanitizeRagText(
                row.summary || row.content,
                isPromotionalCreativePrompt(prompt) ? 120 : 180
            ),
            sourceType: row.sourceType,
            sourceId: row.sourceId,
            score: Number(row.score.toFixed(2)),
            updatedAt: row.updatedAt?.toISOString(),
            metadata: row.metadata || undefined,
        });

        if (references.length >= limit) break;
    }

    const sourceCounts = indexSummary.sourceCounts || {};
    const result = {
        references,
        knowledgeContext: buildPromptContext(references, prompt),
        availableBookCount: Number(sourceCounts.BOOK || 0),
        availableDocumentCount: Number(sourceCounts.DOCUMENT || 0),
        availableMemberCount: Number(sourceCounts.MEMBER || 0),
        availableStudentCount: Number(sourceCounts.STUDENT || 0),
        availableGeneratedMediaCount: Number(sourceCounts.GENERATED_MEDIA || 0),
        availableScheduleCount: Number(sourceCounts.MEDIA_SCHEDULE || 0),
        availableWhiteboardCount: Number(sourceCounts.WHITEBOARD || 0),
        totalIndexedItems: indexSummary.totalIndexedItems,
        indexSummary,
    };
    retrievalCache.set(retrievalCacheKey, {
        expiresAt: Date.now() + RETRIEVAL_CACHE_TTL_MS,
        value: result,
    });
    return result;
}

export async function upsertWhiteboardSnapshot(input: WhiteboardSnapshotUpsertInput) {
    if (!prismaAny.whiteboardSnapshot?.upsert) return null;

    const snapshot = await prismaAny.whiteboardSnapshot.upsert({
        where: {
            userId_storageKey: {
                userId: input.userId,
                storageKey: input.storageKey,
            },
        },
        update: {
            organizationId: input.organizationId || null,
            documentId: input.documentId || null,
            title: input.title || null,
            documentTitle: input.documentTitle || null,
            pageNumber: Math.max(1, Number(input.pageNumber || 1)),
            numPages: input.numPages ? Math.max(1, Number(input.numPages)) : null,
            summary: input.summary || null,
            contentText: input.contentText || null,
            snapshotMeta: input.snapshotMeta || null,
        },
        create: {
            organizationId: input.organizationId || null,
            userId: input.userId,
            documentId: input.documentId || null,
            storageKey: input.storageKey,
            title: input.title || null,
            documentTitle: input.documentTitle || null,
            pageNumber: Math.max(1, Number(input.pageNumber || 1)),
            numPages: input.numPages ? Math.max(1, Number(input.numPages)) : null,
            summary: input.summary || null,
            contentText: input.contentText || null,
            snapshotMeta: input.snapshotMeta || null,
        },
    });

    return snapshot;
}

export { buildPromptContext as buildKnowledgePromptContext, isPromotionalCreativePrompt };
