import { NextRequest, NextResponse } from "next/server";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { Prisma } from "@prisma/client";
import { enforceToolAccess } from "@/lib/api-auth";
import { prisma } from "@/lib/prisma";
import {
    buildWorkspacePayloadHash,
    invalidatePdfDocumentCaches,
} from "@/lib/services/pdf-document-service";
import { upsertOfflinePdfDocument } from "@/lib/services/offline-pdf-document-store";
import { getPdfDocumentById } from "@/lib/services/pdf-document-service";
import { getCompletedYouTubePollCandidateIds } from "@/lib/youtube-poll-progress";
import { Question } from "@/types/pdf";

export const dynamic = "force-dynamic";

const YOUTUBE_POLL_QUESTION_LIMIT = 100;
const YOUTUBE_POLL_OPTION_LIMIT = 35;

type PollCandidate = {
    id: string;
    questionNumber: string;
    prompt: string;
    promptLanguage: "English" | "Hindi";
    options: string[];
    optionLanguage: "English" | "Hindi" | "Mixed";
    wasAiShortened: boolean;
    shorteningNotes: string[];
};

type PollSkip = {
    questionNumber: string;
    reason: string;
};

type RequestBody = {
    documentId?: string;
    broadcastId?: string;
};

type GeminiPollCompressionResponse = {
    question?: {
        text?: string;
        wasShortened?: boolean;
    };
    options?: Array<{
        text?: string;
        wasShortened?: boolean;
    }>;
    notes?: string[];
};

type PollCandidateCachePayload = {
    version: number;
    language: "Hindi";
    questionsHash: string;
    savedAt: string;
    eligible: PollCandidate[];
    skipped: PollSkip[];
};

type RepairPayload = {
    question: string;
    options: string[];
    notes?: string[];
};

function normalizeInlineText(value: string | undefined | null): string {
    return String(value || "").replace(/\s+/g, " ").trim();
}

function containsDevanagari(value: string | undefined | null): boolean {
    return /[\u0900-\u097f]/.test(String(value || ""));
}

function removeBracketedLatinContent(value: string): string {
    return value
        .replace(/\((?=[^)]*[A-Za-z])[^)]*\)/g, " ")
        .replace(/\[(?=[^\]]*[A-Za-z])[^\]]*\]/g, " ")
        .replace(/\{(?=[^}]*[A-Za-z])[^}]*\}/g, " ");
}

function stripLeadingChoiceLabel(value: string): string {
    return value.replace(/^\s*[\[(]?[A-Za-z0-9\u0966-\u096f]+[\])\.\-:]*\s*/, "");
}

function normalizeHindiPollText(value: string): string {
    let next = normalizeInlineText(value);
    next = removeBracketedLatinContent(next);
    next = stripLeadingChoiceLabel(next);
    next = next
        .replace(/[“”"']/g, "")
        .replace(/\s*\/\s*/g, " ")
        .replace(/\s*[|]+\s*/g, " ")
        .replace(/\s*[-–—]\s*/g, " ")
        .replace(/\s{2,}/g, " ")
        .trim();

    if (containsDevanagari(next)) {
        next = next
            .replace(/[A-Za-z][A-Za-z0-9\s.,()\-/%]*/g, " ")
            .replace(/\s{2,}/g, " ")
            .trim();
    }

    return next;
}

function shortenAtWordBoundary(value: string, limit: number): string {
    const normalized = normalizeInlineText(value);
    if (normalized.length <= limit) return normalized;
    if (limit <= 1) return normalized.slice(0, limit);

    let slice = normalized.slice(0, limit - 1).trim();
    const cutoff = Math.max(slice.lastIndexOf(" "), slice.lastIndexOf("-"), slice.lastIndexOf("/"));
    if (cutoff >= Math.floor(limit * 0.55)) {
        slice = slice.slice(0, cutoff).trim();
    }
    return `${slice || normalized.slice(0, limit - 1)}…`;
}

function compactQuestionBoilerplate(value: string): string {
    const replacements: Array<[string, string]> = [
        ["निम्न में से कौन सा", "कौन-सा"],
        ["निम्न में से कौन सी", "कौन-सी"],
        ["निम्न में से कौन-सा", "कौन-सा"],
        ["निम्न में से कौन-सी", "कौन-सी"],
        ["इनमें से कौन सा", "कौन-सा"],
        ["इनमें से कौन सी", "कौन-सी"],
        ["इनमें से कौन-सा", "कौन-सा"],
        ["इनमें से कौन-सी", "कौन-सी"],
        ["निम्नलिखित में से", ""],
        ["निम्न में से", ""],
        ["इनमें से", ""],
        ["दिए गए", ""],
        ["दिया गया", ""],
    ];

    return replacements.reduce((current, [from, to]) => current.split(from).join(to), value)
        .replace(/\s{2,}/g, " ")
        .trim();
}

function forceFitText(value: string, limit: number, kind: "question" | "option", fallback: string): string {
    const base = normalizeHindiPollText(value) || normalizeHindiPollText(fallback) || normalizeInlineText(value) || normalizeInlineText(fallback);
    let next = base;

    if (kind === "question") {
        next = compactQuestionBoilerplate(next)
            .replace(/\s+\?/g, "?")
            .replace(/\s{2,}/g, " ")
            .trim();
    }

    if (next.length <= limit) return next;

    next = next
        .replace(/[,:;]/g, " ")
        .replace(/\s{2,}/g, " ")
        .trim();
    if (next.length <= limit) return next;

    if (kind === "question") {
        next = compactQuestionBoilerplate(next);
    }

    if (next.length <= limit) return next;

    return shortenAtWordBoundary(next, limit);
}

function pickPrimaryHindiText(...values: Array<string | undefined | null>): string {
    const normalized = values.map((value) => normalizeInlineText(value)).filter(Boolean);
    return normalized.find((value) => containsDevanagari(value)) || normalized[0] || "";
}

function withinPollLimits(questionText: string, optionTexts: string[]) {
    return Boolean(questionText) &&
        questionText.length <= YOUTUBE_POLL_QUESTION_LIMIT &&
        optionTexts.length >= 2 &&
        optionTexts.length <= 4 &&
        optionTexts.every((option) => Boolean(option) && option.length <= YOUTUBE_POLL_OPTION_LIMIT);
}

function buildForcedPollCandidate(
    question: Question,
    index: number,
    optionsOverride?: string[],
    notes: string[] = []
): PollCandidate {
    const questionNumber = String(question.number || index + 1);
    const rawOptions = Array.isArray(question.options) ? question.options : [];
    const selectedOptions = optionsOverride?.length
        ? optionsOverride
        : rawOptions.map((option, optionIndex) =>
            pickPrimaryHindiText(option.hindi, option.english, `विकल्प ${optionIndex + 1}`)
        );

    const normalizedOptions =
        selectedOptions.length >= 2
            ? selectedOptions.slice(0, 4)
            : selectedOptions.length === 1
                ? [selectedOptions[0], "अन्य"]
                : question.questionType === "TRUE_FALSE"
                    ? ["सही", "गलत"]
                    : ["विकल्प 1", "विकल्प 2"];

    const promptSource = pickPrimaryHindiText(question.questionHindi, question.questionEnglish, `प्रश्न ${questionNumber}`);

    return {
        id: `${questionNumber}_${index}`,
        questionNumber,
        prompt: forceFitText(promptSource, YOUTUBE_POLL_QUESTION_LIMIT, "question", `प्रश्न ${questionNumber}`),
        promptLanguage: "Hindi",
        options: normalizedOptions.map((option, optionIndex) =>
            forceFitText(option, YOUTUBE_POLL_OPTION_LIMIT, "option", `विकल्प ${optionIndex + 1}`)
        ),
        optionLanguage: "Hindi",
        wasAiShortened: true,
        shorteningNotes: normalizeNoteList(notes),
    };
}

function extractJsonObject(input: string): string {
    const trimmed = String(input || "").trim();
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");

    if (start === -1 || end === -1 || end < start) {
        throw new Error("Model did not return valid JSON.");
    }

    return trimmed.slice(start, end + 1);
}

function normalizeNoteList(notes: unknown): string[] {
    if (!Array.isArray(notes)) return [];
    return notes
        .map((note) => normalizeInlineText(String(note || "")))
        .filter(Boolean)
        .slice(0, 4);
}

function buildQuestionSetHash(questions: Question[]): string {
    return buildWorkspacePayloadHash({
        questions: questions.map((question) => ({
            number: question.number || "",
            questionHindi: question.questionHindi || "",
            questionEnglish: question.questionEnglish || "",
            options: Array.isArray(question.options)
                ? question.options.map((option) => ({
                    hindi: option.hindi || "",
                    english: option.english || "",
                }))
                : [],
        })),
    });
}

function readCachedPollCandidates(
    jsonData: unknown,
    questionsHash: string
): PollCandidateCachePayload | null {
    if (!jsonData || typeof jsonData !== "object" || Array.isArray(jsonData)) return null;
    const meta = (jsonData as Record<string, unknown>)._meta;
    if (!meta || typeof meta !== "object" || Array.isArray(meta)) return null;

    const cache = (meta as Record<string, unknown>).youtubePollCandidateCache;
    if (!cache || typeof cache !== "object" || Array.isArray(cache)) return null;

    const payload = cache as Partial<PollCandidateCachePayload>;
    if (
        payload.version !== 3 ||
        payload.language !== "Hindi" ||
        payload.questionsHash !== questionsHash ||
        !Array.isArray(payload.eligible) ||
        !Array.isArray(payload.skipped)
    ) {
        return null;
    }

    return {
        version: 3,
        language: "Hindi",
        questionsHash,
        savedAt: String(payload.savedAt || ""),
        eligible: payload.eligible as PollCandidate[],
        skipped: payload.skipped as PollSkip[],
    };
}

function withPollCandidateCache(
    jsonData: unknown,
    cachePayload: PollCandidateCachePayload
): Prisma.JsonObject {
    const base =
        jsonData && typeof jsonData === "object" && !Array.isArray(jsonData)
            ? (jsonData as Prisma.JsonObject)
            : ({} as Prisma.JsonObject);
    const meta =
        base._meta && typeof base._meta === "object" && !Array.isArray(base._meta)
            ? (base._meta as Prisma.JsonObject)
            : ({} as Prisma.JsonObject);

    return {
        ...base,
        _meta: {
            ...meta,
            youtubePollCandidateCache: cachePayload as unknown as Prisma.JsonObject,
        },
    };
}

async function persistPollCandidateCache(
    document: {
        id: string;
        title: string;
        subject: string;
        date: string;
        jsonData: unknown;
    },
    cachePayload: PollCandidateCachePayload
) {
    const nextJsonData = withPollCandidateCache(document.jsonData, cachePayload);

    if (String(document.id || "").startsWith("offline_")) {
        await upsertOfflinePdfDocument({
            documentId: document.id,
            title: document.title,
            subject: document.subject,
            date: document.date,
            jsonData: nextJsonData,
        });
        return;
    }

    await prisma.pdfDocument.update({
        where: { id: document.id },
        data: {
            jsonData: nextJsonData,
        },
    });
    invalidatePdfDocumentCaches();
}

function buildDirectCandidate(question: Question, index: number): PollCandidate | PollSkip {
    const questionNumber = String(question.number || index + 1);
    const prompt = normalizeHindiPollText(
        pickPrimaryHindiText(question.questionHindi, question.questionEnglish)
    );
    const options = Array.isArray(question.options) ? question.options : [];

    if (!prompt || prompt.length > YOUTUBE_POLL_QUESTION_LIMIT) {
        return {
            questionNumber,
            reason: "Hindi question text is empty or exceeds YouTube poll limits.",
        };
    }

    if (options.length < 2 || options.length > 4) {
        return {
            questionNumber,
            reason: "YouTube poll supports only 2 to 4 options.",
        };
    }

    const normalizedOptions = options.map((option) =>
        normalizeHindiPollText(pickPrimaryHindiText(option.hindi, option.english))
    );
    if (normalizedOptions.some((option) => !option || option.length > YOUTUBE_POLL_OPTION_LIMIT)) {
        return {
            questionNumber,
            reason: "At least one Hindi option is empty or exceeds YouTube poll limits.",
        };
    }

    return {
        id: `${questionNumber}_${index}`,
        questionNumber,
        prompt,
        promptLanguage: "Hindi",
        options: normalizedOptions,
        optionLanguage: "Hindi",
        wasAiShortened: false,
        shorteningNotes: [],
    };
}

function needsAiCompression(question: Question): boolean {
    const direct = buildDirectCandidate(question, 0);
    return "reason" in direct;
}

async function compressQuestionForYouTubePoll(
    model: ReturnType<GoogleGenerativeAI["getGenerativeModel"]>,
    question: Question,
    index: number
): Promise<PollCandidate> {
    const questionNumber = String(question.number || index + 1);
    const options = Array.isArray(question.options) ? question.options : [];
    const optionNotes: string[] = [];
    const selectedOptions = options.slice(0, 4);

    if (options.length > 4) {
        optionNotes.push("YouTube supports 4 options, so the first four choices were used.");
    }

    const prompt = `
Prepare a YouTube live poll candidate from the question below.

Hard limits:
- Question text must be 100 characters or fewer.
- Each option text must be 35 characters or fewer.
- Keep the original meaning intact.
- Preserve option order exactly.
- Return Hindi only for the question and every option.
- If the source is clearer in English, first convert it into natural Hindi and then shorten it.
- Use Devanagari Hindi only, not bilingual text.
- Return plain text only, with no numbering or labels inside the text.
- Keep the output poll-friendly and concise.
- If something is too long, compress it aggressively but do not skip it.
- You must return something that fits the limits.

Question number: ${questionNumber}
Question English: ${normalizeInlineText(question.questionEnglish) || "(empty)"}
Question Hindi: ${normalizeInlineText(question.questionHindi) || "(empty)"}

Options:
${selectedOptions
    .map(
        (option, optionIndex) =>
            `${optionIndex + 1}. English: ${normalizeInlineText(option.english) || "(empty)"} | Hindi: ${normalizeInlineText(option.hindi) || "(empty)"}`
    )
    .join("\n")}

Return strict JSON only:
{
  "question": {
    "text": "shortened Hindi question",
    "wasShortened": true
  },
  "options": [
    {
      "text": "shortened Hindi option",
      "wasShortened": true
    }
  ],
  "notes": ["optional short note"]
}
`;

    try {
        const result = await model.generateContent(prompt);
        const response = await result.response;
        const parsed = JSON.parse(
            extractJsonObject(response.text().trim())
        ) as GeminiPollCompressionResponse;

        const compressedQuestion = normalizeInlineText(parsed.question?.text);
        const compressedOptions = Array.isArray(parsed.options)
            ? parsed.options.map((option) => normalizeInlineText(option?.text)).filter(Boolean)
            : [];

        if (withinPollLimits(compressedQuestion, compressedOptions)) {
            return {
                id: `${questionNumber}_${index}`,
                questionNumber,
                prompt: normalizeHindiPollText(compressedQuestion),
                promptLanguage: "Hindi",
                options: compressedOptions.map((option) => normalizeHindiPollText(option)),
                optionLanguage: "Hindi",
                wasAiShortened: true,
                shorteningNotes: normalizeNoteList([...optionNotes, ...normalizeNoteList(parsed.notes)]),
            };
        }

        const repairPrompt = `
Repair the Hindi YouTube poll draft below so that it fits the limits without changing meaning.

Hard rules:
- Preserve the original meaning, intent, technical terms, and option order.
- Do not skip the question.
- Keep key nouns and qualifiers intact.
- Compress only filler or redundant wording.
- Question text must be 100 characters or fewer.
- Each option must be 35 characters or fewer.
- Return Hindi only in Devanagari script.
- Return strict JSON only.

Original question:
English: ${normalizeInlineText(question.questionEnglish) || "(empty)"}
Hindi: ${normalizeInlineText(question.questionHindi) || "(empty)"}

Original options:
${selectedOptions
    .map(
        (option, optionIndex) =>
            `${optionIndex + 1}. English: ${normalizeInlineText(option.english) || "(empty)"} | Hindi: ${normalizeInlineText(option.hindi) || "(empty)"}`
    )
    .join("\n")}

Current draft:
${JSON.stringify({
    question: compressedQuestion,
    options: compressedOptions,
})}

Return:
{
  "question": "Hindi question within 100 chars",
  "options": ["Hindi option within 35 chars"],
  "notes": ["optional short note"]
}
`;

        const repairResult = await model.generateContent(repairPrompt);
        const repairResponse = await repairResult.response;
        const repaired = JSON.parse(extractJsonObject(repairResponse.text().trim())) as RepairPayload;
        const repairedQuestion = normalizeInlineText(repaired.question);
        const repairedOptions = Array.isArray(repaired.options)
            ? repaired.options.map((option) => normalizeInlineText(option)).filter(Boolean)
            : [];

        if (withinPollLimits(repairedQuestion, repairedOptions)) {
            return {
                id: `${questionNumber}_${index}`,
                questionNumber,
                prompt: normalizeHindiPollText(repairedQuestion),
                promptLanguage: "Hindi",
                options: repairedOptions.map((option) => normalizeHindiPollText(option)),
                optionLanguage: "Hindi",
                wasAiShortened: true,
                shorteningNotes: normalizeNoteList([
                    ...optionNotes,
                    ...normalizeNoteList(parsed.notes),
                    ...normalizeNoteList(repaired.notes),
                ]),
            };
        }

        return buildForcedPollCandidate(
            question,
            index,
            repairedOptions.length ? repairedOptions : compressedOptions,
            [
                ...optionNotes,
                ...normalizeNoteList(parsed.notes),
                ...normalizeNoteList(repaired.notes),
                "Meaning-preserving force-fit fallback was applied after AI repair.",
            ]
        );
    } catch (error) {
        return buildForcedPollCandidate(
            question,
            index,
            undefined,
            [
                ...optionNotes,
                error instanceof Error
                    ? `Meaning-preserving fallback used after AI compression error: ${error.message}`
                    : "Meaning-preserving fallback used after AI compression error.",
            ]
        );
    }
}

async function buildPollCandidatesWithGemini(questions: Question[]): Promise<{
    eligible: PollCandidate[];
    skipped: PollSkip[];
}> {
    const apiKey = process.env.GEMINI_API_KEY;
    const eligible: PollCandidate[] = [];
    const skipped: PollSkip[] = [];

    const genAI = apiKey ? new GoogleGenerativeAI(apiKey) : null;
    const model = genAI
        ? genAI.getGenerativeModel({
            model: "gemini-2.5-flash",
            generationConfig: {
                temperature: 0.2,
                responseMimeType: "application/json",
            },
        })
        : null;

    for (let index = 0; index < questions.length; index += 1) {
        const question = questions[index];

        if (!needsAiCompression(question)) {
            const direct = buildDirectCandidate(question, index);
            if ("reason" in direct) {
                eligible.push(buildForcedPollCandidate(question, index, undefined, [direct.reason, "Forced into YouTube poll limits."]));
            } else {
                eligible.push(direct);
            }
            continue;
        }

        if (!model) {
            eligible.push(
                buildForcedPollCandidate(question, index, undefined, [
                    "Gemini API key was unavailable, so deterministic force-fit compression was used.",
                ])
            );
            continue;
        }

        const aiCandidate = await compressQuestionForYouTubePoll(model, question, index);
        eligible.push(aiCandidate);
    }

    return { eligible, skipped };
}

export async function POST(request: NextRequest) {
    try {
        const auth = await enforceToolAccess(["media-studio", "pdf-to-pdf"]);
        const body = (await request.json()) as RequestBody;
        const documentId = String(body.documentId || "").trim();
        const broadcastId = String(body.broadcastId || "").trim();

        if (!documentId) {
            return NextResponse.json({ error: "Document ID is required." }, { status: 400 });
        }

        const document = await getPdfDocumentById(
            documentId,
            auth.organizationId,
            auth.userId,
            auth.role
        );

        if (!document) {
            return NextResponse.json({ error: "Document not found." }, { status: 404 });
        }

        const questions = Array.isArray((document.jsonData as any)?.questions)
            ? ((document.jsonData as any).questions as Question[])
            : [];
        const questionsHash = buildQuestionSetHash(questions);
        const cached = readCachedPollCandidates(document.jsonData, questionsHash);
        const doneCandidateIds = getCompletedYouTubePollCandidateIds(document.jsonData, broadcastId);

        if (cached) {
            return NextResponse.json({
                success: true,
                documentId,
                cached: true,
                eligible: cached.eligible,
                skipped: cached.skipped,
                doneCandidateIds,
            });
        }

        const candidates = await buildPollCandidatesWithGemini(questions);
        const cachePayload: PollCandidateCachePayload = {
            version: 3,
            language: "Hindi",
            questionsHash,
            savedAt: new Date().toISOString(),
            eligible: candidates.eligible,
            skipped: candidates.skipped,
        };

        await persistPollCandidateCache(
            {
                id: document.id,
                title: document.title,
                subject: document.subject,
                date: document.date,
                jsonData: document.jsonData,
            },
            cachePayload
        );

        return NextResponse.json({
            success: true,
            documentId,
            cached: false,
            eligible: candidates.eligible,
            skipped: candidates.skipped,
            doneCandidateIds,
        });
    } catch (error) {
        console.error("YouTube poll candidate preparation error:", error);
        const message = error instanceof Error ? error.message : "Failed to prepare YouTube poll candidates.";
        if (/forbidden|unauthorized/i.test(message)) {
            return NextResponse.json({ error: "Forbidden" }, { status: 403 });
        }
        return NextResponse.json({ error: message }, { status: 500 });
    }
}
