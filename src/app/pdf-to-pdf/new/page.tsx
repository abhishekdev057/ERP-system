"use client";

import { Suspense, startTransition, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useSession } from "next-auth/react";
import toast from "react-hot-toast";
import { StudioWorkspaceHero } from "@/components/content-studio/StudioWorkspaceHero";
import Modal from "@/components/ui/Modal";
import { ExtractorWorkspaceHistory } from "@/components/pdf/ExtractorWorkspaceHistory";
import { exportToDocx } from "@/lib/docx-export";
import { isQuestionMeaningful } from "@/lib/question-utils";

import {
    MatchColumnEntry,
    PdfData,
    PreviewResolution,
    Question,
    QuestionOption,
    QuestionType,
} from "@/types/pdf";

const DEFAULT_MAX_IMAGES_PER_BATCH = 12;
const UPLOAD_PAGE_CONCURRENCY = 4;
const ANSWER_FILL_PAGE_BATCH_SIZE = 8;
const ANSWER_FILL_BATCH_PAUSE_MS = 220;
const REVIEW_QUESTION_PAGE_SIZE = 20;
const DECK_MERGE_BASKET_STORAGE_KEY = "extractor_deck_merge_basket_v1";
type OutputLanguageMode = "english" | "hindi" | "both";
type OutputQuestionScope = "all" | "current" | "range";

const OUTPUT_LANGUAGE_OPTIONS: Array<{ value: OutputLanguageMode; label: string }> = [
    { value: "english", label: "English" },
    { value: "hindi", label: "Hindi" },
    { value: "both", label: "Both (H&E)" },
];

const OUTPUT_SCOPE_OPTIONS: Array<{ value: OutputQuestionScope; label: string }> = [
    { value: "all", label: "All Questions" },
    { value: "current", label: "Current Question" },
    { value: "range", label: "Question Range" },
];

const QUESTION_TYPE_OPTIONS: Array<{ value: QuestionType; label: string }> = [
    { value: "MCQ", label: "MCQ" },
    { value: "FIB", label: "Fill in the Blank" },
    { value: "MATCH_COLUMN", label: "Match the Column" },
    { value: "TRUE_FALSE", label: "True / False" },
    { value: "ASSERTION_REASON", label: "Assertion / Reason" },
    { value: "NUMERICAL", label: "Numerical" },
    { value: "SHORT_ANSWER", label: "Short Answer" },
    { value: "LONG_ANSWER", label: "Long Answer" },
];

type SourceImageMeta = {
    imagePath: string;
    imageName: string;
    originalImagePath?: string;
    questionCount: number;
    processed?: boolean;
    failed?: boolean;
    extractionError?: string;
    diagramCount?: number;
    qualityIssues?: string[];
    extractionMode?: "original" | "enhanced";
    averageConfidence?: number;
};

type SourceImageExtractionState = "pending" | "failed" | "extracted";
type QuestionEntry = { question: Question; index: number };
type DeckMergeBasketPage = {
    id: string;
    sourceDocumentId: string | null;
    sourceDocumentTitle: string;
    sourceDocumentSubject?: string;
    sourceDocumentDate?: string;
    sourcePageIndex: number;
    imageName: string;
    imagePath: string;
    originalImagePath?: string;
    questionCount: number;
    questionNumbers: string[];
    questions: Question[];
};

type DeckTargetDocument = {
    id: string;
    title: string;
    subject?: string;
    date?: string;
    pageCount: number;
    questionCount: number;
    updatedAt?: string;
};

type ProcessingStep = {
    id: string;
    stage: string;
    status: "info" | "success" | "warning" | "error";
    message: string;
    imageName?: string;
    variant?: "original" | "enhanced";
    timestamp: string;
};

type CorrectionMarkShape = "circle" | "rect";

type CorrectionMark = {
    id: string;
    imageName: string;
    questionNumber: string;
    questionIndex?: number;
    shape: CorrectionMarkShape;
    x: number;
    y: number;
    width: number;
    height: number;
    note?: string;
    selectedText?: string;
    replacementText?: string;
    createdAt: string;
    createdById?: string;
    createdByName?: string;
    status: "open" | "resolved";
};

type DraftCorrectionMark = {
    shape: CorrectionMarkShape;
    x: number;
    y: number;
    width: number;
    height: number;
};

type ExtractImageResponse = {
    questions: Question[];
    images: SourceImageMeta[];
    totalImages: number;
    totalQuestions: number;
    totalDiagrams?: number;
    maxImagesPerBatch: number;
    warnings: string[];
    processingSteps?: ProcessingStep[];
    quotaExceeded?: boolean;
    retryAfterSeconds?: number;
    error?: string;
};

type ServerExtractionJob = {
    jobId: string;
    status: "running" | "completed" | "failed";
    totalPages: number;
    completedPages: number;
    failedPages: number;
    extractedQuestionCount: number;
    targetIndices: number[];
    processedIndices: number[];
    failedIndices: number[];
    startedAt: string;
    updatedAt: string;
    completedAt?: string;
    retryAfterSeconds?: number;
    message?: string;
    lastProcessedPageIndex?: number;
    lastProcessedPageName?: string;
    error?: string;
};

type AssistantMessage = {
    id: string;
    role: "user" | "assistant";
    text: string;
    suggestion?: Question;
    targetIndex?: number;
    applied?: boolean;
};

type WorkspaceAssistantResponse = {
    reply?: string;
    question?: Question;
    error?: string;
};

function clampQuestionPosition(value: number, totalQuestions: number): number {
    if (!Number.isFinite(value)) return 1;
    if (totalQuestions <= 0) return 1;
    return Math.max(1, Math.min(totalQuestions, Math.trunc(value)));
}

function applyLanguageModeToQuestion(
    question: Question,
    outputLanguageMode: OutputLanguageMode
): Question {
    if (outputLanguageMode === "both") {
        return question;
    }

    const preferEnglish = outputLanguageMode === "english";
    const localizedQuestionPrimary = preferEnglish
        ? String(question.questionEnglish || question.questionHindi || "").trim()
        : String(question.questionHindi || question.questionEnglish || "").trim();
    const localizedSolutionPrimary = preferEnglish
        ? String(question.solutionEnglish || question.solution || question.solutionHindi || "").trim()
        : String(question.solutionHindi || question.solution || question.solutionEnglish || "").trim();
    const localizedMatchColumns = question.matchColumns
        ? {
            left: question.matchColumns.left.map((entry) => ({
                english: preferEnglish
                    ? String(entry.english || entry.hindi || "").trim()
                    : "",
                hindi: preferEnglish
                    ? ""
                    : String(entry.hindi || entry.english || "").trim(),
            })),
            right: question.matchColumns.right.map((entry) => ({
                english: preferEnglish
                    ? String(entry.english || entry.hindi || "").trim()
                    : "",
                hindi: preferEnglish
                    ? ""
                    : String(entry.hindi || entry.english || "").trim(),
            })),
        }
        : undefined;

    return {
        ...question,
        questionEnglish: preferEnglish ? localizedQuestionPrimary : "",
        questionHindi: preferEnglish ? "" : localizedQuestionPrimary,
        solutionEnglish: preferEnglish ? localizedSolutionPrimary || undefined : undefined,
        solutionHindi: preferEnglish ? undefined : localizedSolutionPrimary || undefined,
        solution: localizedSolutionPrimary || question.solution,
        diagramCaptionEnglish: preferEnglish
            ? String(question.diagramCaptionEnglish || question.diagramCaptionHindi || "").trim() || undefined
            : undefined,
        diagramCaptionHindi: preferEnglish
            ? undefined
            : String(question.diagramCaptionHindi || question.diagramCaptionEnglish || "").trim() || undefined,
        options: (question.options || []).map((option) => ({
            english: preferEnglish
                ? String(option.english || option.hindi || "").trim()
                : "",
            hindi: preferEnglish
                ? ""
                : String(option.hindi || option.english || "").trim(),
        })),
        matchColumns: localizedMatchColumns,
    };
}

function getOutputLanguageLabel(outputLanguageMode: OutputLanguageMode): string {
    const match = OUTPUT_LANGUAGE_OPTIONS.find((option) => option.value === outputLanguageMode);
    return match?.label || "Both (H&E)";
}

function getOutputScopeLabel(
    outputQuestionScope: OutputQuestionScope,
    selectedQuestionIndex: number,
    rangeStart: number,
    rangeEnd: number
): string {
    if (outputQuestionScope === "current") {
        return `Current Q${selectedQuestionIndex + 1}`;
    }

    if (outputQuestionScope === "range") {
        return `Q${Math.min(rangeStart, rangeEnd)}-${Math.max(rangeStart, rangeEnd)}`;
    }

    return "All Questions";
}

type BatchAnswerFillResponse = {
    updates?: Array<{ index: number; answer: string }>;
    processed?: number;
    updated?: number;
    skipped?: number;
    error?: string;
};

type DuplicateInfo = {
    canonicalIndex: number;
    peers: number[];
    signature: string;
};

type DuplicateAnalysis = {
    byIndex: Record<number, DuplicateInfo>;
    groups: Array<{ signature: string; indices: number[] }>;
    duplicateQuestionCount: number;
};

type WorkspacePanelView = "editor" | "assistant";
type EditorMode = "gallery" | "detail";
type DetailViewMode = "review" | "structured" | "rich";
type BottomNavigatorScope = "pages" | "questions" | "workspace";
type BottomNavigatorItem = {
    key: string;
    index: number;
    label: string;
    title: string;
    status: SourceImageExtractionState | "active";
    kind: "page" | "question" | "workspace";
    detail?: string;
    globalQuestionIndex?: number;
    workspaceView?: "review" | "structured" | "rich";
};

const LEGACY_INSTITUTE_FALLBACK = "Nexora by Sigma Fusion";
const DEFAULT_EXTRACTOR_TEMPLATE_ID = "professional";
const DEFAULT_EXTRACTOR_PREVIEW_RESOLUTION: PreviewResolution = "1920x1080";

function normalizeInstituteNameValue(value: unknown): string {
    return String(value ?? "").trim();
}

function resolveInstituteName(preferredValue: unknown, fallbackValue?: unknown): string {
    const preferred = normalizeInstituteNameValue(preferredValue);
    if (preferred && preferred !== LEGACY_INSTITUTE_FALLBACK) {
        return preferred;
    }

    const fallback = normalizeInstituteNameValue(fallbackValue);
    if (fallback && fallback !== LEGACY_INSTITUTE_FALLBACK) {
        return fallback;
    }

    return "";
}

const WORKSPACE_PANEL_OPTIONS: Array<{ id: WorkspacePanelView; label: string }> = [
    { id: "editor", label: "Question Set Editor" },
];

const EDITOR_MODE_OPTIONS: Array<{ id: EditorMode; label: string }> = [
    { id: "gallery", label: "Pages Gallery" },
    { id: "detail", label: "Page Details" },
];

function createBlankQuestion(number: string): Question {
    return {
        clientId: createLocalId("question"),
        number,
        questionType: "MCQ",
        questionHindi: "",
        questionEnglish: "",
        answer: "",
        options: [
            { english: "", hindi: "" },
            { english: "", hindi: "" },
            { english: "", hindi: "" },
            { english: "", hindi: "" },
        ],
    };
}

function renumberQuestions(questions: Question[]) {
    return questions.map((question, index) => {
        return {
            ...question,
            clientId: question.clientId || createLocalId("question"),
            number: String(index + 1),
        };
    });
}

function reorderQuestionsForPageOrder(
    questions: Question[],
    orderedImageNames: string[]
): Question[] {
    const orderedImageNameSet = new Set(
        orderedImageNames.map((value) => String(value || "").trim()).filter(Boolean)
    );
    const questionsByImageName = new Map<string, Question[]>();
    const questionsWithoutPage: Question[] = [];

    questions.forEach((question) => {
        const imageName = String(question.sourceImageName || "").trim();
        if (!imageName || !orderedImageNameSet.has(imageName)) {
            questionsWithoutPage.push(question);
            return;
        }

        if (!questionsByImageName.has(imageName)) {
            questionsByImageName.set(imageName, []);
        }
        questionsByImageName.get(imageName)!.push(question);
    });

    const nextQuestions: Question[] = [];
    orderedImageNames.forEach((imageName) => {
        const bucket = questionsByImageName.get(String(imageName || "").trim()) || [];
        bucket.forEach((question) => nextQuestions.push(question));
    });
    questionsWithoutPage.forEach((question) => nextQuestions.push(question));

    return renumberQuestions(nextQuestions);
}

function reorderItemsByBlock<T>(
    items: T[],
    movingIndices: number[],
    targetIndex: number
): T[] {
    const normalizedMoving = Array.from(
        new Set(
            movingIndices
                .map((index) => Number.parseInt(String(index), 10))
                .filter((index) => Number.isFinite(index) && index >= 0 && index < items.length)
        )
    ).sort((left, right) => left - right);

    if (normalizedMoving.length === 0) return items;

    const clampedTargetIndex = Math.max(0, Math.min(targetIndex, items.length));
    const movingIndexSet = new Set(normalizedMoving);
    const movingItems = normalizedMoving.map((index) => items[index]);
    const remainingItems = items.filter((_, index) => !movingIndexSet.has(index));
    const insertAt = items
        .slice(0, clampedTargetIndex)
        .filter((_, index) => !movingIndexSet.has(index)).length;

    const nextItems = [...remainingItems];
    nextItems.splice(insertAt, 0, ...movingItems);
    return nextItems;
}

function normalizePreviewResolutionValue(value: unknown): PreviewResolution {
    const candidate = String(value || "").trim().toLowerCase();
    if (candidate === "1920x1080") return "1920x1080";
    return "default";
}

function areStringArraysEqual(left: string[], right: string[]): boolean {
    if (left.length !== right.length) return false;
    return left.every((value, index) => value === right[index]);
}

function normalizeServerExtractionJob(value: unknown): ServerExtractionJob | null {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const job = value as Record<string, unknown>;
    const status =
        job.status === "running" || job.status === "completed" || job.status === "failed"
            ? job.status
            : null;
    if (!status) return null;

    const normalizeIndices = (items: unknown): number[] =>
        Array.isArray(items)
            ? items
                .map((item) => Number.parseInt(String(item), 10))
                .filter((item) => Number.isFinite(item) && item >= 0)
            : [];

    const parseNumber = (input: unknown): number => {
        const parsed = Number.parseInt(String(input ?? "0"), 10);
        return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
    };

    return {
        jobId: String(job.jobId || "").trim() || createLocalId("job"),
        status,
        totalPages: parseNumber(job.totalPages),
        completedPages: parseNumber(job.completedPages),
        failedPages: parseNumber(job.failedPages),
        extractedQuestionCount: parseNumber(job.extractedQuestionCount),
        targetIndices: normalizeIndices(job.targetIndices),
        processedIndices: normalizeIndices(job.processedIndices),
        failedIndices: normalizeIndices(job.failedIndices),
        startedAt: String(job.startedAt || new Date().toISOString()),
        updatedAt: String(job.updatedAt || new Date().toISOString()),
        completedAt: String(job.completedAt || "").trim() || undefined,
        retryAfterSeconds:
            job.retryAfterSeconds === undefined
                ? undefined
                : parseNumber(job.retryAfterSeconds),
        message: String(job.message || "").trim() || undefined,
        lastProcessedPageIndex:
            job.lastProcessedPageIndex === undefined
                ? undefined
                : parseNumber(job.lastProcessedPageIndex),
        lastProcessedPageName: String(job.lastProcessedPageName || "").trim() || undefined,
        error: String(job.error || "").trim() || undefined,
    };
}
function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runWithConcurrency<T>(
    items: T[],
    concurrency: number,
    worker: (item: T, index: number) => Promise<void>
) {
    if (items.length === 0) return;

    const queue = items.map((item, index) => ({ item, index }));
    const workerCount = Math.max(1, Math.min(concurrency, queue.length));

    await Promise.all(
        Array.from({ length: workerCount }, async () => {
            while (queue.length > 0) {
                const next = queue.shift();
                if (!next) return;
                await worker(next.item, next.index);
            }
        })
    );
}

function nextQuestionNumber(questions: Question[]): string {
    return String(questions.length + 1);
}

function isOptionType(questionType: QuestionType | undefined): boolean {
    return (
        questionType === "MCQ" ||
        questionType === "TRUE_FALSE" ||
        questionType === "ASSERTION_REASON" ||
        questionType === "MATCH_COLUMN"
    );
}

function getQuestionTypeLabel(questionType: QuestionType | undefined): string {
    const selected = QUESTION_TYPE_OPTIONS.find((item) => item.value === questionType);
    return selected?.label || "Question";
}

function getQuestionTypeShort(questionType: QuestionType | undefined): string {
    switch (questionType) {
        case "MATCH_COLUMN":
            return "MATCH";
        case "SHORT_ANSWER":
            return "SHORT";
        case "LONG_ANSWER":
            return "LONG";
        case "TRUE_FALSE":
            return "T/F";
        case "ASSERTION_REASON":
            return "A/R";
        default:
            return questionType || "Q";
    }
}

function resolveQuestionNumberValue(question: Question, fallbackIndex: number): number {
    const parsed = Number.parseInt(String(question.number ?? "").trim(), 10);
    if (Number.isFinite(parsed) && parsed > 0) {
        return parsed;
    }
    return fallbackIndex + 1;
}

function formatQuestionNumberSummary(numbers: number[]): string {
    if (numbers.length === 0) return "Pending";

    const uniqueSorted = Array.from(new Set(numbers)).sort((left, right) => left - right);
    const segments: string[] = [];

    for (let index = 0; index < uniqueSorted.length; index += 1) {
        const start = uniqueSorted[index];
        let end = start;

        while (
            index + 1 < uniqueSorted.length &&
            uniqueSorted[index + 1] === end + 1
        ) {
            index += 1;
            end = uniqueSorted[index];
        }

        segments.push(start === end ? `Q${start}` : `Q${start}-${end}`);
    }

    return segments.join(", ");
}

function clampUnit(value: number): number {
    return Math.max(0, Math.min(1, value));
}

function normalizeDraftRect(mark: DraftCorrectionMark): DraftCorrectionMark {
    const x1 = clampUnit(mark.x);
    const y1 = clampUnit(mark.y);
    const x2 = clampUnit(mark.x + mark.width);
    const y2 = clampUnit(mark.y + mark.height);
    return {
        shape: mark.shape,
        x: Math.min(x1, x2),
        y: Math.min(y1, y2),
        width: Math.abs(x2 - x1),
        height: Math.abs(y2 - y1),
    };
}

function createLocalId(prefix: string): string {
    return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function normalizeDeckMergeBasket(value: unknown): DeckMergeBasketPage[] {
    if (!Array.isArray(value)) return [];

    return value
        .filter((item) => item && typeof item === "object")
        .map((item) => {
            const record = item as Record<string, unknown>;
            const normalizedQuestions = Array.isArray(record.questions)
                ? normalizeLoadedQuestions(record.questions).map((question) => ({
                    ...question,
                    clientId: createLocalId("question"),
                }))
                : [];

            return {
                id: String(record.id || createLocalId("deck_page")),
                sourceDocumentId:
                    typeof record.sourceDocumentId === "string" && record.sourceDocumentId.trim()
                        ? record.sourceDocumentId.trim()
                        : null,
                sourceDocumentTitle: String(record.sourceDocumentTitle || "Untitled workspace").trim() || "Untitled workspace",
                sourceDocumentSubject: String(record.sourceDocumentSubject || "").trim() || undefined,
                sourceDocumentDate: String(record.sourceDocumentDate || "").trim() || undefined,
                sourcePageIndex: Math.max(0, Number.parseInt(String(record.sourcePageIndex ?? "0"), 10) || 0),
                imageName: String(record.imageName || "page").trim() || "page",
                imagePath: String(record.imagePath || "").trim(),
                originalImagePath: String(record.originalImagePath || "").trim() || undefined,
                questionCount: Math.max(0, Number.parseInt(String(record.questionCount ?? normalizedQuestions.length), 10) || 0),
                questionNumbers: Array.isArray(record.questionNumbers)
                    ? record.questionNumbers.map((value) => String(value || "").trim()).filter(Boolean)
                    : normalizedQuestions.map((question) => String(question.number || "").trim()).filter(Boolean),
                questions: normalizedQuestions,
            } satisfies DeckMergeBasketPage;
        })
        .filter((item) => Boolean(item.imagePath));
}

function cloneQuestionForDeckMerge(question: Question, imageName: string): Question {
    return {
        ...question,
        clientId: createLocalId("question"),
        number: "0",
        sourceImageName: imageName,
    };
}

function buildUniqueImageName(
    preferredName: string,
    usedNames: Set<string>
): string {
    const trimmed = preferredName.trim() || `page-${usedNames.size + 1}.jpg`;
    if (!usedNames.has(trimmed)) return trimmed;

    const extensionIndex = trimmed.lastIndexOf(".");
    const hasExtension = extensionIndex > 0;
    const baseName = hasExtension ? trimmed.slice(0, extensionIndex) : trimmed;
    const extension = hasExtension ? trimmed.slice(extensionIndex) : "";

    let attempt = 2;
    while (usedNames.has(`${baseName}-${attempt}${extension}`)) {
        attempt += 1;
    }

    return `${baseName}-${attempt}${extension}`;
}

function buildSourceImagesWithQuestionCounts(
    images: SourceImageMeta[],
    questions: Question[]
): SourceImageMeta[] {
    return images.map((image) => {
        const questionCount = questions.filter(
            (question) => String(question.sourceImageName || "").trim() === image.imageName
        ).length;

        return {
            ...image,
            questionCount,
            processed: questionCount > 0 ? true : image.processed,
            failed: questionCount > 0 ? false : image.failed,
            extractionError: questionCount > 0 ? undefined : image.extractionError,
        };
    });
}

function escapeHtml(value: string): string {
    return value
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

function replaceAllOccurrences(text: string, search: string, replacement: string): string {
    if (!search) return text;
    return text.split(search).join(replacement);
}

function buildRichTemplateFromQuestion(question: Question): string {
    const lines: string[] = [];
    lines.push("[QUESTION_HINDI]");
    lines.push(question.questionHindi || "");
    lines.push("");
    lines.push("[QUESTION_ENGLISH]");
    lines.push(question.questionEnglish || "");
    lines.push("");

    if (question.questionType === "MATCH_COLUMN") {
        lines.push("[MATCH_COLUMN_LEFT]");
        (question.matchColumns?.left || []).forEach((entry) => {
            const hindi = String(entry.hindi || "").trim();
            const english = String(entry.english || "").trim();
            lines.push(`${hindi || english} || ${english || hindi}`);
        });
        lines.push("");
        lines.push("[MATCH_COLUMN_RIGHT]");
        (question.matchColumns?.right || []).forEach((entry) => {
            const hindi = String(entry.hindi || "").trim();
            const english = String(entry.english || "").trim();
            lines.push(`${hindi || english} || ${english || hindi}`);
        });
        lines.push("");
    }

    if (Array.isArray(question.options) && question.options.length > 0) {
        lines.push("[OPTIONS]");
        question.options.forEach((option, index) => {
            const hindi = String(option.hindi || "").trim();
            const english = String(option.english || "").trim();
            lines.push(`${index + 1}. ${hindi || english} || ${english || hindi}`);
        });
        lines.push("");
    }

    lines.push("[ANSWER]");
    lines.push(String(question.answer || "").trim());
    lines.push("");
    lines.push("[SOLUTION]");
    lines.push(
        String(
            question.solutionHindi ||
            question.solutionEnglish ||
            question.solution ||
            ""
        ).trim()
    );
    lines.push("");
    lines.push("[END]");

    return lines.join("\n");
}

function parseRichBilingualLine(line: string): { hindi: string; english: string } | null {
    const raw = line.trim();
    if (!raw) return null;
    const withoutPrefix = raw.replace(/^\(?[A-Za-z0-9]+\)?[.)\-:\s]+/, "").trim();
    const [first, second] = withoutPrefix.split("||").map((part) => part.trim());
    if (first && second) {
        return { hindi: first, english: second };
    }
    const fallback = withoutPrefix || raw;
    return { hindi: fallback, english: fallback };
}

function parseRichTemplateToQuestion(templateText: string, fallback: Question): Question {
    const sections: Record<string, string[]> = {};
    let activeSection = "";

    const lines = templateText.replace(/\r/g, "").split("\n");
    lines.forEach((line) => {
        const marker = line.trim().match(
            /^\[(QUESTION_HINDI|QUESTION_ENGLISH|MATCH_COLUMN_LEFT|MATCH_COLUMN_RIGHT|OPTIONS|ANSWER|SOLUTION|END)\]$/i
        );
        if (marker) {
            activeSection = marker[1].toUpperCase();
            if (!sections[activeSection]) sections[activeSection] = [];
            return;
        }
        if (!activeSection || activeSection === "END") return;
        sections[activeSection].push(line);
    });

    const questionHindi = sections.QUESTION_HINDI
        ? sections.QUESTION_HINDI.join("\n").trim()
        : fallback.questionHindi;
    const questionEnglish = sections.QUESTION_ENGLISH
        ? sections.QUESTION_ENGLISH.join("\n").trim()
        : fallback.questionEnglish;
    const answer = sections.ANSWER
        ? sections.ANSWER.join("\n").trim()
        : (fallback.answer || "");
    const solution = sections.SOLUTION
        ? sections.SOLUTION.join("\n").trim()
        : (fallback.solution || fallback.solutionHindi || fallback.solutionEnglish || "");

    const parsedOptions = (sections.OPTIONS || [])
        .map(parseRichBilingualLine)
        .filter((item): item is { hindi: string; english: string } => Boolean(item))
        .slice(0, 10);

    const parsedLeft = (sections.MATCH_COLUMN_LEFT || [])
        .map(parseRichBilingualLine)
        .filter((item): item is { hindi: string; english: string } => Boolean(item))
        .slice(0, 12);
    const parsedRight = (sections.MATCH_COLUMN_RIGHT || [])
        .map(parseRichBilingualLine)
        .filter((item): item is { hindi: string; english: string } => Boolean(item))
        .slice(0, 12);

    return {
        ...fallback,
        questionHindi,
        questionEnglish,
        answer,
        solution,
        options: parsedOptions.length > 0 ? parsedOptions : fallback.options,
        matchColumns:
            parsedLeft.length > 0 || parsedRight.length > 0
                ? {
                    left: parsedLeft.length > 0 ? parsedLeft : (fallback.matchColumns?.left || []),
                    right: parsedRight.length > 0 ? parsedRight : (fallback.matchColumns?.right || []),
                }
                : fallback.matchColumns,
    };
}

function applyReplacementToQuestionFields(question: Question, search: string, replacement: string): Question {
    const replace = (value: string | undefined): string | undefined => {
        if (typeof value !== "string") return value;
        return replaceAllOccurrences(value, search, replacement);
    };

    const nextMatchColumns = question.matchColumns
        ? {
            left: (question.matchColumns.left || []).map((entry) => ({
                hindi: replace(entry.hindi) || "",
                english: replace(entry.english) || "",
            })),
            right: (question.matchColumns.right || []).map((entry) => ({
                hindi: replace(entry.hindi) || "",
                english: replace(entry.english) || "",
            })),
        }
        : question.matchColumns;

    return {
        ...question,
        questionHindi: replace(question.questionHindi) || "",
        questionEnglish: replace(question.questionEnglish) || "",
        answer: replace(question.answer),
        solution: replace(question.solution),
        solutionHindi: replace(question.solutionHindi),
        solutionEnglish: replace(question.solutionEnglish),
        diagramCaptionHindi: replace(question.diagramCaptionHindi),
        diagramCaptionEnglish: replace(question.diagramCaptionEnglish),
        options: (question.options || []).map((option) => ({
            hindi: replace(option.hindi) || "",
            english: replace(option.english) || "",
        })),
        matchColumns: nextMatchColumns,
    };
}

function normalizeDuplicateToken(value: string | undefined): string {
    return String(value || "")
        .toLowerCase()
        .replace(/[^a-z0-9\u0900-\u097f]+/gi, " ")
        .replace(/\s+/g, " ")
        .trim();
}

function resolveSourceImageQuestionCount(image: SourceImageMeta, fallbackCount = 0): number {
    return Math.max(
        0,
        Number.isFinite(Number(image.questionCount)) ? Number(image.questionCount) : 0,
        fallbackCount
    );
}

function getSourceImageExtractionState(
    image: SourceImageMeta,
    fallbackQuestionCount = 0
): SourceImageExtractionState {
    const questionCount = resolveSourceImageQuestionCount(image, fallbackQuestionCount);
    if (image.failed) return "failed";
    if (image.processed && questionCount > 0) return "extracted";
    return "pending";
}

function isSourceImagePendingExtraction(image: SourceImageMeta): boolean {
    return getSourceImageExtractionState(image) !== "extracted";
}

function questionDuplicateSignature(question: Question): string {
    const questionHindi = normalizeDuplicateToken(question.questionHindi);
    const questionEnglish = normalizeDuplicateToken(question.questionEnglish);

    const optionSignature = Array.isArray(question.options)
        ? question.options
            .map((option) => `${normalizeDuplicateToken(option.hindi)}|${normalizeDuplicateToken(option.english)}`)
            .filter((entry) => entry !== "|")
            .sort()
            .join("||")
        : "";

    const leftMatchSignature = (question.matchColumns?.left || [])
        .map((entry) => `${normalizeDuplicateToken(entry.hindi)}|${normalizeDuplicateToken(entry.english)}`)
        .filter((entry) => entry !== "|")
        .join("||");

    const rightMatchSignature = (question.matchColumns?.right || [])
        .map((entry) => `${normalizeDuplicateToken(entry.hindi)}|${normalizeDuplicateToken(entry.english)}`)
        .filter((entry) => entry !== "|")
        .join("||");

    return [
        question.questionType || "UNKNOWN",
        questionHindi,
        questionEnglish,
        optionSignature,
        leftMatchSignature,
        rightMatchSignature,
    ].join("::");
}

function analyzeDuplicateQuestions(questions: Question[]): DuplicateAnalysis {
    const groupsBySignature = new Map<string, number[]>();

    questions.forEach((question, index) => {
        const signature = questionDuplicateSignature(question);
        if (!signature || signature.replace(/[:]/g, "").trim().length === 0) return;
        if (!groupsBySignature.has(signature)) {
            groupsBySignature.set(signature, []);
        }
        groupsBySignature.get(signature)!.push(index);
    });

    const groups = Array.from(groupsBySignature.entries())
        .filter(([, indices]) => indices.length > 1)
        .map(([signature, indices]) => ({ signature, indices }));

    const byIndex: Record<number, DuplicateInfo> = {};
    groups.forEach((group) => {
        const canonicalIndex = group.indices[0];
        group.indices.forEach((index) => {
            byIndex[index] = {
                canonicalIndex,
                peers: group.indices.filter((peer) => peer !== index),
                signature: group.signature,
            };
        });
    });

    return {
        byIndex,
        groups,
        duplicateQuestionCount: groups.reduce((count, group) => count + group.indices.length, 0),
    };
}

function removeDuplicateQuestionsForOutput(questions: Question[]): Question[] {
    const seen = new Set<string>();
    const filtered: Question[] = [];

    questions.forEach((question) => {
        const signature = questionDuplicateSignature(question);
        if (!signature || signature.replace(/[:]/g, "").trim().length === 0) {
            filtered.push(question);
            return;
        }
        if (seen.has(signature)) return;
        seen.add(signature);
        filtered.push(question);
    });

    return filtered;
}

function serializeMatchColumnEntries(entries: MatchColumnEntry[] | undefined): string {
    if (!entries?.length) return "";
    return entries.map((entry) => `${entry.english} || ${entry.hindi}`).join("\n");
}

function parseMatchColumnEntries(text: string): MatchColumnEntry[] {
    return text
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => {
            const [first, second] = line.split("||").map((part) => part.trim());
            if (first && second) {
                return { english: first, hindi: second };
            }
            return { english: line, hindi: line };
        })
        .slice(0, 12);
}

function normalizeAssistantQuestion(raw: Question, fallback: Question): Question {
    return {
        ...fallback,
        ...raw,
        number: String(raw.number || fallback.number || "").trim() || fallback.number,
        questionHindi: String(raw.questionHindi || fallback.questionHindi || "").trim(),
        questionEnglish: String(raw.questionEnglish || fallback.questionEnglish || "").trim(),
        options: Array.isArray(raw.options)
            ? raw.options
                .slice(0, 10)
                .map((option) => ({
                    english: String(option.english || "").trim(),
                    hindi: String(option.hindi || "").trim(),
                }))
            : fallback.options,
    };
}

function formatStepTimestamp(value: string): string {
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return "";
    return parsed.toLocaleTimeString("en-GB", {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
    });
}

function normalizeLoadedSourceImages(value: unknown): SourceImageMeta[] {
    if (!Array.isArray(value)) return [];
    const normalized: SourceImageMeta[] = [];

    for (const item of value) {
        if (!item || typeof item !== "object") continue;
        const source = item as Record<string, unknown>;
        const originalImagePath = String(source.originalImagePath || "").trim();
        const imagePath = String(source.imagePath || "").trim() || originalImagePath;
        if (!imagePath) continue;
        const questionCount = Math.max(0, Number.parseInt(String(source.questionCount ?? "0"), 10) || 0);
        const failed = typeof source.failed === "boolean" ? source.failed : false;
        const processed =
            typeof source.processed === "boolean"
                ? source.processed
                : (questionCount > 0 && !failed);

        normalized.push({
            imagePath,
            originalImagePath: originalImagePath || undefined,
            imageName: String(source.imageName || "image").trim() || "image",
            questionCount,
            processed,
            failed,
            extractionError: String(source.extractionError || "").trim() || undefined,
            diagramCount: Math.max(0, Number.parseInt(String(source.diagramCount ?? "0"), 10) || 0),
            extractionMode: source.extractionMode === "enhanced" ? "enhanced" : "original",
            averageConfidence:
                typeof source.averageConfidence === "number"
                    ? source.averageConfidence
                    : Number.parseFloat(String(source.averageConfidence ?? "")) || undefined,
            qualityIssues: Array.isArray(source.qualityIssues)
                ? source.qualityIssues.map((issue) => String(issue || "").trim()).filter(Boolean).slice(0, 12)
                : [],
        });
    }

    return normalized;
}

function normalizeLoadedQuestions(value: unknown): Question[] {
    if (!Array.isArray(value)) return [createBlankQuestion("1")];

    const mapped = value
        .map((item, index) => {
            if (!item || typeof item !== "object") return null;
            const question = item as Record<string, unknown>;
            const options = Array.isArray(question.options)
                ? question.options
                    .map((option) => {
                        if (!option || typeof option !== "object") return null;
                        const nextOption = option as Record<string, unknown>;
                        return {
                            english: String(nextOption.english || "").trim(),
                            hindi: String(nextOption.hindi || "").trim(),
                        };
                    })
                    .filter((option): option is QuestionOption => Boolean(option))
                : [];
            const answerCandidate = String(
                question.answer ||
                question.correctAnswer ||
                question.correctOption ||
                question.answerKey ||
                ""
            ).trim();

            return {
                ...(question as unknown as Question),
                number: String(question.number || index + 1).trim() || String(index + 1),
                questionHindi: String(question.questionHindi || "").trim(),
                questionEnglish: String(question.questionEnglish || "").trim(),
                ...(answerCandidate ? { answer: answerCandidate } : {}),
                options,
            } satisfies Question;
        })
        .filter((item): item is Question => Boolean(item));

    return mapped.length > 0 ? renumberQuestions(mapped) : [createBlankQuestion("1")];
}

function normalizeLoadedCorrectionMarks(value: unknown): CorrectionMark[] {
    if (!Array.isArray(value)) return [];

    return value
        .filter((item) => item && typeof item === "object")
        .map((item) => {
            const record = item as Record<string, unknown>;
            const shape: CorrectionMarkShape = record.shape === "circle" ? "circle" : "rect";
            const status: "open" | "resolved" = record.status === "resolved" ? "resolved" : "open";

            return {
                id: String(record.id || createLocalId("mark")),
                imageName: String(record.imageName || ""),
                questionNumber: String(record.questionNumber || ""),
                questionIndex:
                    Number.isFinite(Number(record.questionIndex))
                        ? Number(record.questionIndex)
                        : undefined,
                shape,
                x: clampUnit(Number(record.x || 0)),
                y: clampUnit(Number(record.y || 0)),
                width: clampUnit(Number(record.width || 0)),
                height: clampUnit(Number(record.height || 0)),
                note: String(record.note || "").trim(),
                selectedText: String(record.selectedText || "").trim() || undefined,
                replacementText: String(record.replacementText || "").trim() || undefined,
                createdAt: String(record.createdAt || new Date().toISOString()),
                createdById: record.createdById ? String(record.createdById) : undefined,
                createdByName: record.createdByName ? String(record.createdByName) : undefined,
                status,
            } satisfies CorrectionMark;
        });
}

function deriveSourceImagesFromQuestions(questions: Question[]): SourceImageMeta[] {
    const buckets = new Map<
        string,
        {
            imagePath: string;
            imageName: string;
            questionCount: number;
            diagramCount: number;
        }
    >();

    for (const question of questions) {
        const imagePath = String(question.sourceImagePath || "").trim();
        const sourceImageName = String(question.sourceImageName || "").trim();
        const imageName =
            sourceImageName ||
            (imagePath ? imagePath.split("/").filter(Boolean).pop() || "image" : "");

        if (!imagePath || !imageName) continue;

        const key = imageName;
        const existing = buckets.get(key);
        if (!existing) {
            buckets.set(key, {
                imagePath,
                imageName,
                questionCount: 1,
                diagramCount:
                    question.diagramImagePath || question.autoDiagramImagePath ? 1 : 0,
            });
            continue;
        }

        existing.questionCount += 1;
        if (!existing.imagePath && imagePath) {
            existing.imagePath = imagePath;
        }
        if (question.diagramImagePath || question.autoDiagramImagePath) {
            existing.diagramCount += 1;
        }
    }

    return Array.from(buckets.values())
        .filter((item) => Boolean(item.imagePath))
        .map((item) => ({
            imagePath: item.imagePath,
            originalImagePath: item.imagePath,
            imageName: item.imageName,
            questionCount: item.questionCount,
            processed: item.questionCount > 0,
            failed: false,
            diagramCount: item.diagramCount,
            extractionMode: "original",
            qualityIssues: [],
        }));
}

function getQuestionReferenceImagePath(
    question: Question,
    sourceImages: SourceImageMeta[]
): string | null {
    const directPath = String(question.sourceImagePath || "").trim();
    if (directPath) return directPath;

    const sourceName = String(question.sourceImageName || "").trim();
    if (!sourceName) return null;

    const matchingSource = sourceImages.find((image) => image.imageName === sourceName);
    return matchingSource?.imagePath || null;
}

function getQuestionReferenceBounds(question: Question) {
    return question.questionBounds || question.diagramBounds || null;
}

function QuestionReferenceCrop({
    question,
    sourceImages,
    size = "compact",
}: {
    question: Question;
    sourceImages: SourceImageMeta[];
    size?: "compact" | "large";
}) {
    const imagePath = getQuestionReferenceImagePath(question, sourceImages);
    const bounds = getQuestionReferenceBounds(question);

    if (!imagePath) return null;

    const wrapperClass =
        size === "large"
            ? "relative overflow-hidden rounded-2xl border border-slate-200 bg-slate-50 shadow-sm aspect-[4/3] w-full max-w-[420px]"
            : "relative overflow-hidden rounded-xl border border-slate-200 bg-slate-50 shadow-sm aspect-[4/3] w-full max-w-[240px]";

    if (!bounds) {
        return (
            <div className={wrapperClass}>
                <img
                    src={imagePath}
                    alt={`Reference for question ${question.number}`}
                    className="h-full w-full object-cover"
                    loading="lazy"
                />
            </div>
        );
    }

    return (
        <div className={wrapperClass}>
            <img
                src={imagePath}
                alt={`Reference for question ${question.number}`}
                loading="lazy"
                className="absolute max-w-none max-h-none select-none pointer-events-none"
                style={{
                    width: `${100 / Math.max(bounds.width, 0.05)}%`,
                    height: `${100 / Math.max(bounds.height, 0.05)}%`,
                    left: `-${(bounds.x / Math.max(bounds.width, 0.05)) * 100}%`,
                    top: `-${(bounds.y / Math.max(bounds.height, 0.05)) * 100}%`,
                }}
            />
        </div>
    );
}

type EditableQuestionField =
    | "questionHindi"
    | "questionEnglish"
    | "answer"
    | "diagramImagePath"
    | "diagramCaptionHindi"
    | "diagramCaptionEnglish";

export default function PdfToPdfPage() {
    return (
        <Suspense fallback={<div className="page-container text-sm text-slate-600">Loading extractor...</div>}>
            <PdfToPdfContent />
        </Suspense>
    );
}

function PdfToPdfContent() {
    const { data: session } = useSession();
    const currentUserId = (session?.user as any)?.id as string | undefined;
    const currentUserRole = ((session?.user as any)?.role as string | undefined) || "MEMBER";
    const canReviewCorrectionMarks = currentUserRole === "ORG_ADMIN" || currentUserRole === "SYSTEM_ADMIN";
    const canCreateCorrectionMarks = currentUserRole === "MEMBER" || canReviewCorrectionMarks;
    const searchParams = useSearchParams();
    const router = useRouter();
    const pathname = usePathname();

    // Export state
    const [exportTitle, setExportTitle] = useState("Extracted Question Set");
    const [exportShuffleQuestions, setExportShuffleQuestions] = useState(false);
    const [organizationName, setOrganizationName] = useState("");

    const [pdfData, setPdfData] = useState<PdfData>({
        title: "Extracted Question Set",
        date: new Date().toLocaleDateString("en-GB"),
        instituteName: "",
        questions: [createBlankQuestion("1")],
        templateId: DEFAULT_EXTRACTOR_TEMPLATE_ID,
        optionDisplayOrder: "hindi-first",
        previewResolution: DEFAULT_EXTRACTOR_PREVIEW_RESOLUTION,
        sourceImages: [],
    });

    useEffect(() => {
        fetch("/api/me")
            .then(res => res.json())
            .then(data => {
                const resolvedOrganizationName = resolveInstituteName(data.organizationName);
                setOrganizationName(resolvedOrganizationName);
                if (resolvedOrganizationName) {
                    setPdfData(prev => {
                        const currentInstituteName = normalizeInstituteNameValue(prev.instituteName);
                        if (
                            currentInstituteName &&
                            currentInstituteName !== LEGACY_INSTITUTE_FALLBACK &&
                            currentInstituteName !== resolvedOrganizationName
                        ) {
                            return prev;
                        }

                        if (currentInstituteName === resolvedOrganizationName) {
                            return prev;
                        }

                        return {
                            ...prev,
                            instituteName: resolvedOrganizationName,
                        };
                    });
                }
            })
            .catch(console.error);
    }, []);
    const [sourceImages, setSourceImages] = useState<SourceImageMeta[]>([]);
    const [selectedQuestionIndex, setSelectedQuestionIndex] = useState(0);
    const [outputLanguageMode, setOutputLanguageMode] = useState<OutputLanguageMode>("both");
    const [outputQuestionScope, setOutputQuestionScope] = useState<OutputQuestionScope>("all");
    const [outputRangeStart, setOutputRangeStart] = useState(1);
    const [outputRangeEnd, setOutputRangeEnd] = useState(1);
    const [isExtracting, setIsExtracting] = useState(false);
    const [isStoppingExtraction, setIsStoppingExtraction] = useState(false);
    const [isSaving, setIsSaving] = useState(false);
    const [documentId, setDocumentId] = useState<string | null>(null);
    const [extractionWarnings, setExtractionWarnings] = useState<string[]>([]);
    const [processingSteps, setProcessingSteps] = useState<ProcessingStep[]>([]);
    const [isProcessPopupOpen, setIsProcessPopupOpen] = useState(false);
    const [isProcessPopupCollapsed, setIsProcessPopupCollapsed] = useState(false);
    const [processUnreadCount, setProcessUnreadCount] = useState(0);
    const [isProcessTimelineAtBottom, setIsProcessTimelineAtBottom] = useState(true);
    const [assistantPrompt, setAssistantPrompt] = useState("");
    const [assistantMessages, setAssistantMessages] = useState<AssistantMessage[]>([]);
    const [isAssistantBusy, setIsAssistantBusy] = useState(false);
    const [isAutoFillingAnswers, setIsAutoFillingAnswers] = useState(false);
    const [isAiChatPopupOpen, setIsAiChatPopupOpen] = useState(false);
    const [activeWorkspacePanel, setActiveWorkspacePanel] = useState<WorkspacePanelView>("editor");
    const [editorMode, setEditorMode] = useState<EditorMode>("gallery");
    const [detailViewMode, setDetailViewMode] = useState<DetailViewMode>("review");
    const [bottomNavigatorScope, setBottomNavigatorScope] = useState<BottomNavigatorScope>("pages");
    const [richTemplateText, setRichTemplateText] = useState("");
    const [selectedPageImageIndex, setSelectedPageImageIndex] = useState<number | null>(null);
    const [isLoadingSavedDocument, setIsLoadingSavedDocument] = useState(false);
    const [isDocxModalOpen, setIsDocxModalOpen] = useState(false);
    const [selectedDocxFormat, setSelectedDocxFormat] = useState<"1" | "2" | "3" | "4">("1");
    const [examPaperAnswerMode, setExamPaperAnswerMode] = useState<"without-answers" | "with-answers">("without-answers");
    const [selectedImageIndices, setSelectedImageIndices] = useState<Set<number>>(new Set());
    const [draggedPageIndices, setDraggedPageIndices] = useState<number[]>([]);
    const [pageDropTargetIndex, setPageDropTargetIndex] = useState<number | null>(null);
    const [isPageDropAtEnd, setIsPageDropAtEnd] = useState(false);
    const [deckMergeBasket, setDeckMergeBasket] = useState<DeckMergeBasketPage[]>([]);
    const [isDeckMergeModalOpen, setIsDeckMergeModalOpen] = useState(false);
    const [deckMergeMode, setDeckMergeMode] = useState<"existing" | "new">("existing");
    const [deckTargetDocuments, setDeckTargetDocuments] = useState<DeckTargetDocument[]>([]);
    const [isDeckTargetsLoading, setIsDeckTargetsLoading] = useState(false);
    const [deckTargetSearch, setDeckTargetSearch] = useState("");
    const [selectedDeckTargetId, setSelectedDeckTargetId] = useState("");
    const [newDeckTitle, setNewDeckTitle] = useState("");
    const [newDeckSubject, setNewDeckSubject] = useState("");
    const [isSubmittingDeckMerge, setIsSubmittingDeckMerge] = useState(false);
    const [reviewQuestionPage, setReviewQuestionPage] = useState(1);
    const [isDetailToolsCollapsed, setIsDetailToolsCollapsed] = useState(true);
    const [questionOrderBaseline, setQuestionOrderBaseline] = useState<string[]>([]);
    const [serverExtractionJob, setServerExtractionJob] = useState<ServerExtractionJob | null>(null);
    const [lastSavedHash, setLastSavedHash] = useState<string | null>(null);
    const [correctionMarks, setCorrectionMarks] = useState<CorrectionMark[]>([]);
    const [activeMarkTool, setActiveMarkTool] = useState<CorrectionMarkShape | null>(null);
    const [draftMark, setDraftMark] = useState<DraftCorrectionMark | null>(null);
    const [isCropMode, setIsCropMode] = useState(false);
    const [draftCropRect, setDraftCropRect] = useState<DraftCorrectionMark | null>(null);
    const [pendingCropRect, setPendingCropRect] = useState<DraftCorrectionMark | null>(null);
    const [isApplyingCrop, setIsApplyingCrop] = useState(false);
    const [isUploadingDiagram, setIsUploadingDiagram] = useState(false);
    const [pageZoom, setPageZoom] = useState(1);
    const [selectedMarkId, setSelectedMarkId] = useState<string | null>(null);
    const [markNoteDraft, setMarkNoteDraft] = useState("");
    const bottomNavigatorScrollRef = useRef<HTMLDivElement | null>(null);
    const bottomNavigatorButtonRefs = useRef<Record<string, HTMLButtonElement | null>>({});

    useEffect(() => {
        if (!isDeckMergeModalOpen) return;

        let cancelled = false;
        setIsDeckTargetsLoading(true);

        fetch("/api/documents?minimal=true&workspaceStats=true&limit=250&sortBy=updatedAt&sortOrder=desc", {
            cache: "no-store",
        })
            .then((response) => {
                if (!response.ok) {
                    throw new Error("Failed to load available decks.");
                }
                return response.json() as Promise<{
                    documents?: Array<Record<string, unknown>>;
                }>;
            })
            .then((data) => {
                if (cancelled) return;

                const nextTargets: DeckTargetDocument[] = Array.isArray(data.documents)
                    ? data.documents.reduce<DeckTargetDocument[]>((accumulator, record) => {
                        if (String(record.workspaceType || "").trim() !== "PDF_TO_PDF") {
                            return accumulator;
                        }

                        const id = String(record.id || "").trim();
                        if (!id) {
                            return accumulator;
                        }

                        const workspaceStats =
                            record.workspaceStats && typeof record.workspaceStats === "object"
                                ? (record.workspaceStats as Record<string, unknown>)
                                : {};

                        accumulator.push({
                            id,
                            title: String(record.title || "Untitled deck").trim() || "Untitled deck",
                            subject: String(record.subject || "").trim() || undefined,
                            date: String(record.date || "").trim() || undefined,
                            pageCount: Math.max(
                                0,
                                Number.parseInt(String(workspaceStats.pageCount ?? "0"), 10) || 0
                            ),
                            questionCount: Math.max(
                                0,
                                Number.parseInt(String(workspaceStats.questionCount ?? "0"), 10) || 0
                            ),
                            updatedAt: String(record.updatedAt || "").trim() || undefined,
                        });

                        return accumulator;
                    }, [])
                    : [];

                setDeckTargetDocuments(nextTargets);
                setSelectedDeckTargetId((current) => {
                    if (current && nextTargets.some((record) => record.id === current)) {
                        return current;
                    }
                    if (documentId && nextTargets.some((record) => record.id === documentId)) {
                        return documentId;
                    }
                    return nextTargets[0]?.id || "";
                });
            })
            .catch((error) => {
                console.error("[extractor] Failed to load merge targets:", error);
                if (!cancelled) {
                    toast.error(error instanceof Error ? error.message : "Failed to load decks.");
                }
            })
            .finally(() => {
                if (!cancelled) {
                    setIsDeckTargetsLoading(false);
                }
            });

        return () => {
            cancelled = true;
        };
    }, [documentId, isDeckMergeModalOpen]);

    useEffect(() => {
        if (typeof window === "undefined") return;
        try {
            const stored = window.sessionStorage.getItem(DECK_MERGE_BASKET_STORAGE_KEY);
            if (!stored) return;
            setDeckMergeBasket(normalizeDeckMergeBasket(JSON.parse(stored)));
        } catch (error) {
            console.warn("[extractor] Failed to restore deck basket:", error);
        }
    }, []);

    useEffect(() => {
        if (typeof window === "undefined") return;
        try {
            window.sessionStorage.setItem(
                DECK_MERGE_BASKET_STORAGE_KEY,
                JSON.stringify(deckMergeBasket)
            );
        } catch (error) {
            console.warn("[extractor] Failed to persist deck basket:", error);
        }
    }, [deckMergeBasket]);

    useEffect(() => {
        if (isDocxModalOpen) {
            setExportTitle(String(pdfData.title || "").trim() || "Extracted Question Set");
        }
    }, [isDocxModalOpen, pdfData.title]);

    function updatePdfDocumentMetaField<K extends "title" | "date" | "instituteName">(key: K, value: PdfData[K]) {
        const nextData = { ...pdfData, [key]: value };
        setPdfData(nextData);
        debouncedPreview(nextData);
    }

    const buildWorkspaceHash = (
        dataToHash: PdfData,
        imagesToHash: SourceImageMeta[],
        marksToHash: CorrectionMark[]
    ) =>
        JSON.stringify({
            pdfData: dataToHash,
            sourceImages: imagesToHash,
            correctionMarks: marksToHash,
        });

    const currentWorkspaceHash = useMemo(() => {
        return buildWorkspaceHash(
            pdfData,
            sourceImages,
            correctionMarks
        );
    }, [pdfData, sourceImages, correctionMarks]);

    const hasUnsavedChanges = lastSavedHash !== null && currentWorkspaceHash !== lastSavedHash;
    const meaningfulQuestions = useMemo(
        () => (pdfData.questions || []).filter(isQuestionMeaningful),
        [pdfData.questions]
    );
    const deckMergeBasketPageCount = deckMergeBasket.length;
    const deckMergeBasketQuestionCount = useMemo(
        () => deckMergeBasket.reduce((sum, item) => sum + item.questionCount, 0),
        [deckMergeBasket]
    );
    const deckMergeBasketWorkspaceCount = useMemo(
        () => new Set(deckMergeBasket.map((item) => item.sourceDocumentTitle)).size,
        [deckMergeBasket]
    );
    const filteredDeckTargetDocuments = useMemo(() => {
        const query = deckTargetSearch.trim().toLowerCase();
        if (!query) return deckTargetDocuments;
        return deckTargetDocuments.filter((document) => {
            return (
                document.title.toLowerCase().includes(query) ||
                String(document.subject || "").toLowerCase().includes(query)
            );
        });
    }, [deckTargetDocuments, deckTargetSearch]);

    useEffect(() => {
        const totalQuestions = Math.max(1, pdfData.questions.length);
        setOutputRangeStart((current) => clampQuestionPosition(current, totalQuestions));
        setOutputRangeEnd((current) => clampQuestionPosition(current, totalQuestions));
    }, [pdfData.questions.length]);

    useEffect(() => {
        if (outputQuestionScope !== "range") return;
        setOutputRangeStart((current) => clampQuestionPosition(current, pdfData.questions.length));
        setOutputRangeEnd((current) =>
            clampQuestionPosition(Math.max(current, outputRangeStart), pdfData.questions.length)
        );
    }, [outputQuestionScope, outputRangeStart, pdfData.questions.length]);

    const outputSelectedQuestionIndices = useMemo<Set<number> | null>(() => {
        if (pdfData.questions.length === 0) {
            return new Set<number>();
        }

        if (outputQuestionScope === "all") {
            return null;
        }

        if (outputQuestionScope === "current") {
            return new Set<number>([Math.max(0, Math.min(selectedQuestionIndex, pdfData.questions.length - 1))]);
        }

        const totalQuestions = pdfData.questions.length;
        const startIndex =
            clampQuestionPosition(Math.min(outputRangeStart, outputRangeEnd), totalQuestions) - 1;
        const endIndex =
            clampQuestionPosition(Math.max(outputRangeStart, outputRangeEnd), totalQuestions) - 1;
        const indices = new Set<number>();
        for (let index = startIndex; index <= endIndex; index += 1) {
            indices.add(index);
        }
        return indices;
    }, [
        outputQuestionScope,
        outputRangeEnd,
        outputRangeStart,
        pdfData.questions.length,
        selectedQuestionIndex,
    ]);
    const outputQuestionCount = outputSelectedQuestionIndices
        ? outputSelectedQuestionIndices.size
        : pdfData.questions.length;

    useEffect(() => {
        const currentIds = pdfData.questions
            .map((question) => String(question.clientId || "").trim())
            .filter(Boolean);

        setQuestionOrderBaseline((previous) => {
            if (currentIds.length === 0) {
                return previous.length === 0 ? previous : [];
            }

            if (previous.length === 0) {
                return areStringArraysEqual(previous, currentIds) ? previous : currentIds;
            }

            const currentIdSet = new Set(currentIds);
            const baselineFiltered = previous.filter((id) => currentIdSet.has(id));
            const baselineSet = new Set(baselineFiltered);
            const appendedIds = currentIds.filter((id) => !baselineSet.has(id));
            const nextBaseline = [...baselineFiltered, ...appendedIds];

            return areStringArraysEqual(previous, nextBaseline) ? previous : nextBaseline;
        });
    }, [pdfData.questions]);

    useEffect(() => {
        if (editorMode === "detail") return;
        if (pdfData.questions.length > 0 && selectedQuestionIndex < pdfData.questions.length) {
            const question = pdfData.questions[selectedQuestionIndex];
            if (question && question.sourceImageName) {
                const imgIndex = sourceImages.findIndex(img => img.imageName === question.sourceImageName);
                if (imgIndex !== -1 && imgIndex !== selectedPageImageIndex) {
                    setSelectedPageImageIndex(imgIndex);
                }
            }
        }
    }, [editorMode, selectedQuestionIndex, pdfData.questions, sourceImages, selectedPageImageIndex]);

    useEffect(() => {
        const handleBeforeUnload = (e: BeforeUnloadEvent) => {
            if (hasUnsavedChanges) {
                e.preventDefault();
                e.returnValue = ''; // Standard requirement for browser tab close/refresh warnings
            }
        };
        window.addEventListener('beforeunload', handleBeforeUnload);
        return () => window.removeEventListener('beforeunload', handleBeforeUnload);
    }, [hasUnsavedChanges]);

    // Idle auto-save
    useEffect(() => {
        if (!hasUnsavedChanges) return;
        if (!documentId || documentId === "offline") return;
        if (isSaving || isExtracting || isLoadingSavedDocument) return;
        if (serverExtractionJob?.status === "running") return;

        const timer = setTimeout(() => {
            void saveWorkspaceState(pdfData, sourceImages, true);
        }, 15000);

        return () => clearTimeout(timer);
    }, [
        currentWorkspaceHash,
        hasUnsavedChanges,
        isSaving,
        documentId,
        pdfData,
        sourceImages,
        isExtracting,
        isLoadingSavedDocument,
        serverExtractionJob?.status,
    ]);

    const fileInputRef = useRef<HTMLInputElement>(null);
    const appendFileInputRef = useRef<HTMLInputElement>(null);
    const diagramUploadInputRef = useRef<HTMLInputElement>(null);
    const pageViewerRef = useRef<HTMLDivElement>(null);
    const richEditorRef = useRef<HTMLDivElement>(null);
    const drawingStartRef = useRef<{ x: number; y: number; pointerId: number } | null>(null);
    const drawingModeRef = useRef<"mark" | "crop" | null>(null);
    const pageActionHeaderRef = useRef<HTMLElement>(null);
    const metricsStripRef = useRef<HTMLElement>(null);
    const workspaceStripRef = useRef<HTMLElement>(null);
    const loadedDocumentIdRef = useRef<string | null>(null);
    const loadedDocumentUpdatedAtRef = useRef<string | null>(null);
    const processTimelineBodyRef = useRef<HTMLDivElement>(null);
    const lastProcessStepCountRef = useRef(0);
    const saveInFlightRef = useRef<Promise<string | null> | null>(null);
    const [pageActionHeaderHeight, setPageActionHeaderHeight] = useState(72);
    const [metricsStripHeight, setMetricsStripHeight] = useState(0);
    const [workspaceStripHeight, setWorkspaceStripHeight] = useState(64);
    const TOP_NAV_OFFSET_PX = 58;

    const [modalConfig, setModalConfig] = useState<{
        isOpen: boolean;
        title: string;
        message: string;
        onConfirm?: () => void | Promise<void>;
        type: "danger" | "warning" | "info" | "success";
        confirmText?: string;
        cancelText?: string;
    }>({
        isOpen: false,
        title: "",
        message: "",
        type: "info",
    });

    useEffect(() => {
        return () => {
        };
    }, []);

    useEffect(() => {
        const updateStickyHeights = () => {
            if (pageActionHeaderRef.current) {
                setPageActionHeaderHeight(Math.ceil(pageActionHeaderRef.current.getBoundingClientRect().height));
            } else {
                setPageActionHeaderHeight(0);
            }
            if (metricsStripRef.current) {
                setMetricsStripHeight(Math.ceil(metricsStripRef.current.getBoundingClientRect().height));
            } else {
                setMetricsStripHeight(0);
            }
            if (workspaceStripRef.current) {
                setWorkspaceStripHeight(Math.ceil(workspaceStripRef.current.getBoundingClientRect().height));
            } else {
                setWorkspaceStripHeight(0);
            }
        };

        updateStickyHeights();
        const rafId = window.requestAnimationFrame(updateStickyHeights);
        const observers: ResizeObserver[] = [];

        if (typeof ResizeObserver !== "undefined") {
            [pageActionHeaderRef.current, metricsStripRef.current, workspaceStripRef.current]
                .filter(Boolean)
                .forEach((element) => {
                    const observer = new ResizeObserver(() => updateStickyHeights());
                    observer.observe(element!);
                    observers.push(observer);
                });
        }

        window.addEventListener("resize", updateStickyHeights);
        return () => {
            window.cancelAnimationFrame(rafId);
            observers.forEach((observer) => observer.disconnect());
            window.removeEventListener("resize", updateStickyHeights);
        };
    }, []);

    const stickyMetricsTopPx = TOP_NAV_OFFSET_PX + pageActionHeaderHeight;
    const stickyWorkspaceTopPx = stickyMetricsTopPx + metricsStripHeight;
    const isEditorDetailMode =
        activeWorkspacePanel === "editor" && editorMode === "detail";
    const reviewViewportMaxHeight = `calc(100vh - ${stickyWorkspaceTopPx + 14}px)`;
    const compactPageFileName =
        selectedPageImageIndex !== null
            ? sourceImages[selectedPageImageIndex]?.imageName || ""
            : "";

    const selectedPageImage =
        selectedPageImageIndex !== null ? sourceImages[selectedPageImageIndex] || null : null;
    const selectedPageImageName = selectedPageImage?.imageName || "";
    const questionEntries = useMemo<QuestionEntry[]>(
        () => pdfData.questions.map((question, index) => ({ question, index })),
        [pdfData.questions]
    );
    const questionEntriesByImageName = useMemo(() => {
        const map = new Map<string, QuestionEntry[]>();

        questionEntries.forEach((entry) => {
            const imageName = String(entry.question.sourceImageName || "");
            if (!map.has(imageName)) {
                map.set(imageName, []);
            }
            map.get(imageName)!.push(entry);
        });

        return map;
    }, [questionEntries]);
    const selectedPageQuestionEntries = useMemo(
        () =>
            selectedPageImageName
                ? questionEntriesByImageName.get(selectedPageImageName) || []
                : questionEntries,
        [questionEntries, questionEntriesByImageName, selectedPageImageName]
    );
    const scopedPageQuestionEntries = useMemo(
        () =>
            outputSelectedQuestionIndices
                ? selectedPageQuestionEntries.filter(({ index }) =>
                    outputSelectedQuestionIndices.has(index)
                )
                : selectedPageQuestionEntries,
        [outputSelectedQuestionIndices, selectedPageQuestionEntries]
    );
    const selectedPageQuestionCount = selectedPageQuestionEntries.length;
    const selectedPageStatus = selectedPageImage
        ? getSourceImageExtractionState(selectedPageImage, selectedPageQuestionCount)
        : "pending";
    const pageNavigationItems = useMemo(
        () =>
            sourceImages.map((image, index) => {
                const questionsOnPage = questionEntriesByImageName.get(image.imageName) || [];
                const questionCount = questionsOnPage.length;
                const questionNumbers = questionsOnPage.map(({ question, index: questionIndex }) =>
                    resolveQuestionNumberValue(question, questionIndex)
                );
                return {
                    index,
                    imageName: image.imageName,
                    questionCount,
                    questionSummary: formatQuestionNumberSummary(questionNumbers),
                    extractionState: getSourceImageExtractionState(image, questionCount),
                };
            }),
        [questionEntriesByImageName, sourceImages]
    );
    const selectedQuestion = useMemo(() => {
        const current = pdfData.questions[selectedQuestionIndex] || null;
        if (editorMode === "detail" && selectedPageImageName) {
            return current?.sourceImageName === selectedPageImageName ? current : null;
        }
        return current;
    }, [editorMode, pdfData.questions, selectedPageImageName, selectedQuestionIndex]);
    const questionNavigatorItems = useMemo<BottomNavigatorItem[]>(
        () =>
            selectedPageQuestionEntries.map(({ question, index }, pageQuestionIndex) => ({
                key: `question-${index}`,
                index: pageQuestionIndex,
                label: `Q${question.number || index + 1}`,
                status: "extracted",
                title: `Question ${question.number || index + 1} · ${getQuestionTypeLabel(question.questionType)}`,
                kind: "question",
                globalQuestionIndex: index,
            })),
        [selectedPageQuestionEntries]
    );
    const reviewQuestionTotalPages = Math.max(
        1,
        Math.ceil(scopedPageQuestionEntries.length / REVIEW_QUESTION_PAGE_SIZE)
    );
    const activeReviewQuestionPage = Math.min(reviewQuestionPage, reviewQuestionTotalPages);
    const visibleReviewQuestionEntries = useMemo(
        () =>
            scopedPageQuestionEntries.slice(
                (activeReviewQuestionPage - 1) * REVIEW_QUESTION_PAGE_SIZE,
                activeReviewQuestionPage * REVIEW_QUESTION_PAGE_SIZE
            ),
        [activeReviewQuestionPage, scopedPageQuestionEntries]
    );
    const reviewQuestionRangeStart =
        scopedPageQuestionEntries.length === 0
            ? 0
            : (activeReviewQuestionPage - 1) * REVIEW_QUESTION_PAGE_SIZE + 1;
    const reviewQuestionRangeEnd =
        scopedPageQuestionEntries.length === 0
            ? 0
            : Math.min(
                scopedPageQuestionEntries.length,
                activeReviewQuestionPage * REVIEW_QUESTION_PAGE_SIZE
            );
    const workspaceNavigatorItems = useMemo<BottomNavigatorItem[]>(
        () => [
            {
                key: "workspace-review",
                index: 0,
                label: "Rv",
                status: detailViewMode === "review" ? "active" : "extracted",
                title: "Review workspace",
                kind: "workspace",
                workspaceView: "review",
            },
            {
                key: "workspace-structured",
                index: 1,
                label: "St",
                status: detailViewMode === "structured" ? "active" : "extracted",
                title: "Structured editor",
                kind: "workspace",
                workspaceView: "structured",
            },
            {
                key: "workspace-rich",
                index: 2,
                label: "Rg",
                status: detailViewMode === "rich" ? "active" : "extracted",
                title: "Rich content editor",
                kind: "workspace",
                workspaceView: "rich",
            },
        ],
        [detailViewMode]
    );
    const activeBottomNavigatorIndex = useMemo(() => {
        if (editorMode !== "detail") {
            return Math.max(0, Math.min(selectedQuestionIndex, Math.max(0, pdfData.questions.length - 1)));
        }

        if (bottomNavigatorScope === "pages") {
            return selectedPageImageIndex ?? 0;
        }

        if (bottomNavigatorScope === "workspace") {
            return workspaceNavigatorItems.findIndex((item) => item.status === "active");
        }

        const questionIndexInPage = questionNavigatorItems.findIndex(
            (item) => item.globalQuestionIndex === selectedQuestionIndex
        );
        return questionIndexInPage === -1 ? 0 : questionIndexInPage;
    }, [
        bottomNavigatorScope,
        editorMode,
        pdfData.questions.length,
        questionNavigatorItems,
        selectedPageImageIndex,
        selectedQuestionIndex,
        workspaceNavigatorItems,
    ]);
    const bottomNavigatorItems = useMemo<BottomNavigatorItem[]>(() => {
        if (editorMode !== "detail") {
            return pdfData.questions.map((question, index) => ({
                key: `question-${index}`,
                index,
                label: String(index + 1),
                status: "extracted",
                title: `Question ${question.number || index + 1}`,
                kind: "question",
                globalQuestionIndex: index,
            }));
        }

        if (bottomNavigatorScope === "pages") {
            return pageNavigationItems.map((item) => ({
                key: `page-${item.index}`,
                index: item.index,
                label: String(item.index + 1),
                detail: item.questionSummary,
                status: item.extractionState,
                title: `${item.imageName} · ${item.questionSummary}`,
                kind: "page",
            }));
        }

        if (bottomNavigatorScope === "workspace") {
            return workspaceNavigatorItems;
        }

        return questionNavigatorItems;
    }, [
        bottomNavigatorScope,
        editorMode,
        pageNavigationItems,
        pdfData.questions,
        questionNavigatorItems,
        workspaceNavigatorItems,
    ]);

    useEffect(() => {
        if (editorMode !== "detail" || !selectedPageImageName) return;
        const current = pdfData.questions[selectedQuestionIndex];
        if (current?.sourceImageName === selectedPageImageName) return;

        const firstMatchingIndex = pdfData.questions.findIndex(
            (question) => question.sourceImageName === selectedPageImageName
        );
        if (firstMatchingIndex !== -1) {
            setSelectedQuestionIndex(firstMatchingIndex);
        }
    }, [editorMode, pdfData.questions, selectedPageImageName, selectedQuestionIndex]);

    useEffect(() => {
        if (editorMode !== "detail") return;
        if (bottomNavigatorScope === "questions" && selectedPageQuestionEntries.length === 0) {
            setBottomNavigatorScope("pages");
        }
    }, [bottomNavigatorScope, editorMode, selectedPageQuestionEntries.length]);

    useEffect(() => {
        setReviewQuestionPage(1);
    }, [selectedPageImageName, outputLanguageMode, outputQuestionScope, outputRangeEnd, outputRangeStart]);

    useEffect(() => {
        if (reviewQuestionPage === activeReviewQuestionPage) return;
        setReviewQuestionPage(activeReviewQuestionPage);
    }, [activeReviewQuestionPage, reviewQuestionPage]);

    useEffect(() => {
        if (detailViewMode !== "review") return;

        const questionIndexInPage = scopedPageQuestionEntries.findIndex(
            ({ index }) => index === selectedQuestionIndex
        );
        if (questionIndexInPage === -1) return;

        const targetPage = Math.floor(questionIndexInPage / REVIEW_QUESTION_PAGE_SIZE) + 1;
        if (targetPage !== activeReviewQuestionPage) {
            setReviewQuestionPage(targetPage);
        }
    }, [
        activeReviewQuestionPage,
        detailViewMode,
        scopedPageQuestionEntries,
        selectedQuestionIndex,
    ]);

    useEffect(() => {
        if (editorMode !== "detail" || detailViewMode !== "rich" || !selectedQuestion) return;
        const nextTemplate = buildRichTemplateFromQuestion(selectedQuestion);
        setRichTemplateText(nextTemplate);
        if (richEditorRef.current) {
            richEditorRef.current.innerText = nextTemplate;
        }
    }, [editorMode, detailViewMode, selectedQuestionIndex]);

    useEffect(() => {
        const container = bottomNavigatorScrollRef.current;
        const activeItem = bottomNavigatorItems[activeBottomNavigatorIndex];
        const button = activeItem
            ? bottomNavigatorButtonRefs.current[activeItem.key]
            : null;

        if (!container || !button) return;

        const targetLeft =
            button.offsetLeft - container.clientWidth / 2 + button.clientWidth / 2;

        container.scrollTo({
            left: Math.max(0, targetLeft),
            behavior: "smooth",
        });
    }, [activeBottomNavigatorIndex, bottomNavigatorItems]);

    const extractionSummary = useMemo(() => {
        const questionCount = meaningfulQuestions.length;
        const withDiagrams = meaningfulQuestions.filter(
            (question) => Boolean(question.diagramImagePath || question.autoDiagramImagePath)
        ).length;
        const highConfidence = meaningfulQuestions.filter(
            (question) => (question.extractionConfidence || 0) >= 0.85
        ).length;
        const typeCounts = meaningfulQuestions.reduce(
            (acc, question) => {
                const type = question.questionType || "UNKNOWN";
                acc[type] = (acc[type] || 0) + 1;
                return acc;
            },
            {} as Record<string, number>
        );
        return { questionCount, withDiagrams, highConfidence, typeCounts };
    }, [meaningfulQuestions]);

    const duplicateAnalysis = useMemo(
        () => analyzeDuplicateQuestions(pdfData.questions),
        [pdfData.questions]
    );

    const selectedDuplicateInfo =
        duplicateAnalysis.byIndex[selectedQuestionIndex] || null;

    const selectedQuestionMessages = useMemo(
        () =>
            assistantMessages.filter(
                (message) => message.targetIndex === selectedQuestionIndex
            ),
        [assistantMessages, selectedQuestionIndex]
    );

    const selectedPageMarks = useMemo(
        () =>
            correctionMarks.filter((mark) => mark.imageName === selectedPageImageName),
        [correctionMarks, selectedPageImageName]
    );

    const remainingExtractionIndices = useMemo(
        () =>
            sourceImages
                .map((image, index) => ({ image, index }))
                .filter(({ image }) => isSourceImagePendingExtraction(image))
                .map(({ index }) => index),
        [sourceImages]
    );

    const remainingExtractionCount = remainingExtractionIndices.length;

    const selectedMark = useMemo(
        () => correctionMarks.find((mark) => mark.id === selectedMarkId) || null,
        [correctionMarks, selectedMarkId]
    );

    useEffect(() => {
        setMarkNoteDraft(selectedMark?.note || "");
    }, [selectedMark?.id, selectedMark?.note]);

    useEffect(() => {
        setSelectedMarkId(null);
        setDraftMark(null);
        setDraftCropRect(null);
        setPendingCropRect(null);
        setIsCropMode(false);
        setPageZoom(1);
        drawingStartRef.current = null;
        drawingModeRef.current = null;
    }, [selectedPageImageName]);

    const showBottomQuestionNavigator =
        activeWorkspacePanel === "editor" &&
        editorMode === "detail" &&
        sourceImages.length > 0;

    const activateWorkspaceNavigatorItem = (
        targetView: BottomNavigatorItem["workspaceView"]
    ) => {
        if (!targetView) return;

        if (targetView === "review") {
            setDetailViewMode("review");
            setBottomNavigatorScope("workspace");
            return;
        }

        if (targetView === "structured") {
            setDetailViewMode("structured");
            setBottomNavigatorScope("workspace");
            return;
        }

        setDetailViewMode("rich");
        setBottomNavigatorScope("workspace");
    };

    const goToDetailPageIndex = (pageIndex: number) => {
        if (pageIndex < 0 || pageIndex >= sourceImages.length) return;

        const nextPage = sourceImages[pageIndex];
        const firstQuestionIndex = pdfData.questions.findIndex(
            (question) => question.sourceImageName === nextPage.imageName
        );

        setSelectedPageImageIndex(pageIndex);
        setEditorMode("detail");

        if (firstQuestionIndex !== -1) {
            setSelectedQuestionIndex(firstQuestionIndex);
        }
        setBottomNavigatorScope("pages");
    };

    const activateBottomNavigatorItem = (item: BottomNavigatorItem) => {
        if (item.kind === "page") {
            goToDetailPageIndex(item.index);
            return;
        }

        if (item.kind === "question" && typeof item.globalQuestionIndex === "number") {
            setSelectedQuestionIndex(item.globalQuestionIndex);
            setEditorMode("detail");
            setBottomNavigatorScope("questions");
            return;
        }

        activateWorkspaceNavigatorItem(item.workspaceView);
    };

    const goToPreviousNavigatorItem = () => {
        if (editorMode === "detail" && bottomNavigatorScope === "pages") {
            goToDetailPageIndex(Math.max(0, activeBottomNavigatorIndex - 1));
            return;
        }

        if (editorMode === "detail" && bottomNavigatorScope === "workspace") {
            const previousItem =
                workspaceNavigatorItems[Math.max(0, activeBottomNavigatorIndex - 1)];
            if (previousItem) {
                activateWorkspaceNavigatorItem(previousItem.workspaceView);
            }
            return;
        }

        const previousQuestion =
            questionNavigatorItems[Math.max(0, activeBottomNavigatorIndex - 1)];
        if (previousQuestion?.globalQuestionIndex !== undefined) {
            setSelectedQuestionIndex(previousQuestion.globalQuestionIndex);
        } else {
            setSelectedQuestionIndex(Math.max(0, selectedQuestionIndex - 1));
        }
    };

    const goToNextNavigatorItem = () => {
        if (editorMode === "detail" && bottomNavigatorScope === "pages") {
            goToDetailPageIndex(Math.min(sourceImages.length - 1, activeBottomNavigatorIndex + 1));
            return;
        }

        if (editorMode === "detail" && bottomNavigatorScope === "workspace") {
            const nextItem =
                workspaceNavigatorItems[
                Math.min(workspaceNavigatorItems.length - 1, activeBottomNavigatorIndex + 1)
                ];
            if (nextItem) {
                activateWorkspaceNavigatorItem(nextItem.workspaceView);
            }
            return;
        }

        const nextQuestion =
            questionNavigatorItems[
            Math.min(questionNavigatorItems.length - 1, activeBottomNavigatorIndex + 1)
            ];
        if (nextQuestion?.globalQuestionIndex !== undefined) {
            setSelectedQuestionIndex(nextQuestion.globalQuestionIndex);
        } else {
            setSelectedQuestionIndex(Math.min(pdfData.questions.length - 1, selectedQuestionIndex + 1));
        }
    };

    const isNearProcessTimelineBottom = (node: HTMLDivElement | null): boolean => {
        if (!node) return true;
        const distance = node.scrollHeight - node.scrollTop - node.clientHeight;
        return distance <= 64;
    };

    const scrollProcessTimelineToBottom = (behavior: ScrollBehavior = "smooth") => {
        const node = processTimelineBodyRef.current;
        if (!node) return;
        node.scrollTo({ top: node.scrollHeight, behavior });
        setIsProcessTimelineAtBottom(true);
        setProcessUnreadCount(0);
    };

    const handleProcessTimelineScroll = () => {
        const nearBottom = isNearProcessTimelineBottom(processTimelineBodyRef.current);
        setIsProcessTimelineAtBottom(nearBottom);
        if (nearBottom) {
            setProcessUnreadCount(0);
        }
    };

    const toggleProcessTimeline = () => {
        setIsProcessPopupOpen((prev) => {
            const nextOpen = !prev;
            if (nextOpen) {
                setIsProcessPopupCollapsed(false);
                requestAnimationFrame(() => scrollProcessTimelineToBottom("auto"));
            }
            return nextOpen;
        });
    };

    const clearProcessTimeline = () => {
        setProcessingSteps([]);
        setProcessUnreadCount(0);
        setIsProcessTimelineAtBottom(true);
        lastProcessStepCountRef.current = 0;
    };

    useEffect(() => {
        const nextCount = processingSteps.length;
        const prevCount = lastProcessStepCountRef.current;
        const addedCount = nextCount - prevCount;
        lastProcessStepCountRef.current = nextCount;

        if (addedCount <= 0) return;

        const canAutoScroll =
            isProcessPopupOpen &&
            !isProcessPopupCollapsed &&
            isNearProcessTimelineBottom(processTimelineBodyRef.current);

        if (canAutoScroll) {
            requestAnimationFrame(() => scrollProcessTimelineToBottom("smooth"));
            return;
        }

        setIsProcessTimelineAtBottom(false);
        setProcessUnreadCount((prev) => prev + addedCount);
    }, [processingSteps.length, isProcessPopupOpen, isProcessPopupCollapsed]);

    useEffect(() => {
        if (!isProcessPopupOpen || isProcessPopupCollapsed) return;
        requestAnimationFrame(() => scrollProcessTimelineToBottom("auto"));
    }, [isProcessPopupOpen, isProcessPopupCollapsed]);

    useEffect(() => {
        if (processingSteps.length > 0) return;
        setProcessUnreadCount(0);
        setIsProcessTimelineAtBottom(true);
        lastProcessStepCountRef.current = 0;
    }, [processingSteps.length]);

    const appendProcessingStep = (
        step: Omit<ProcessingStep, "id" | "timestamp"> & Partial<Pick<ProcessingStep, "id" | "timestamp">>
    ) => {
        setProcessingSteps((prev) => [
            ...prev,
            {
                id: step.id || `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
                timestamp: step.timestamp || new Date().toISOString(),
                stage: step.stage,
                status: step.status,
                message: step.message,
                imageName: step.imageName,
                variant: step.variant,
            },
        ]);
    };

    const requestConfirmation = (
        title: string,
        message: string,
        onConfirm: () => void | Promise<void>,
        options?: {
            type?: "danger" | "warning" | "info" | "success";
            confirmText?: string;
            cancelText?: string;
        }
    ) => {
        setModalConfig({
            isOpen: true,
            title,
            message,
            onConfirm,
            type: options?.type || "warning",
            confirmText: options?.confirmText,
            cancelText: options?.cancelText,
        });
    };

    const debouncedPreview = (_nextData: PdfData) => {
        // Preview generation has been removed from the extractor workspace.
    };

    const ensureWorkspaceDocument = async (
        questionsToSave: Question[],
        imagesToSave: SourceImageMeta[]
    ): Promise<string | null> => {
        if (documentId) {
            return documentId;
        }

        const initSaveRes = await fetch("/api/documents/save", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                title: pdfData.title,
                date: pdfData.date,
                instituteName: pdfData.instituteName,
                templateId: pdfData.templateId || DEFAULT_EXTRACTOR_TEMPLATE_ID,
                previewResolution: normalizePreviewResolutionValue(
                    pdfData.previewResolution ?? DEFAULT_EXTRACTOR_PREVIEW_RESOLUTION
                ),
                sourceType: "PDF",
                questions: questionsToSave,
                sourceImages: imagesToSave,
                documentId: documentId || undefined,
            }),
        });

        if (!initSaveRes.ok) {
            const detail = await initSaveRes.json().catch(() => ({}));
            throw new Error(detail.error || "Failed to initialize workspace.");
        }

        const initData = await initSaveRes.json().catch(() => ({}));
        const nextDocumentId =
            typeof initData?.documentId === "string" && initData.documentId.trim()
                ? initData.documentId.trim()
                : documentId;

        if (nextDocumentId) {
            setDocumentId(nextDocumentId);
        }

        return nextDocumentId || null;
    };

    const renderPdfFileToImageFiles = async (file: File): Promise<File[]> => {
        const pdfRuntimeUrl = "/pdfjs/pdf.mjs";
        const pdfjsLib: any = await import(/* webpackIgnore: true */ pdfRuntimeUrl);
        pdfjsLib.GlobalWorkerOptions.workerSrc = "/pdfjs/pdf.worker.min.mjs";

        const fileArrayBuffer = await file.arrayBuffer();
        const pdfDocument = await pdfjsLib.getDocument({
            data: new Uint8Array(fileArrayBuffer),
            cMapUrl: "/pdfjs/cmaps/",
            cMapPacked: true,
            standardFontDataUrl: "/pdfjs/standard_fonts/",
            wasmUrl: "/pdfjs/wasm/",
        }).promise;
        const numPages = pdfDocument.numPages;

        appendProcessingStep({
            stage: "client_pdf_parsed",
            status: "info",
            message: `Parsed PDF "${file.name}" with ${numPages} page(s). Extracting images...`,
        });

        const pageFiles: File[] = [];

        for (let i = 1; i <= numPages; i++) {
            const page = await pdfDocument.getPage(i);
            const viewport = page.getViewport({ scale: 2.0 });
            const canvas = document.createElement("canvas");
            const context = canvas.getContext("2d");
            if (!context) continue;

            canvas.height = viewport.height;
            canvas.width = viewport.width;

            await page.render({
                canvasContext: context,
                viewport,
                canvas,
            }).promise;

            const blob = await new Promise<Blob | null>((resolve) => {
                canvas.toBlob((nextBlob) => resolve(nextBlob), "image/jpeg", 0.9);
            });

            canvas.width = 0;
            canvas.height = 0;

            if (!blob) continue;

            const fileBaseName = file.name.replace(/\.[^.]+$/, "") || "page";
            pageFiles.push(
                new File([blob], `${fileBaseName}-page-${i}.jpg`, {
                    type: "image/jpeg",
                })
            );
        }

        return pageFiles;
    };

    const uploadWorkspaceImageFile = async (
        file: File,
        workspaceId: string | null
    ): Promise<SourceImageMeta> => {
        const uploadForm = new FormData();
        uploadForm.append("file", file, file.name);
        uploadForm.append("filename", file.name);
        if (workspaceId) {
            uploadForm.append("documentId", workspaceId);
        }

        const uploadRes = await fetch("/api/uploads/pdf-page", {
            method: "POST",
            body: uploadForm,
        });

        if (!uploadRes.ok) {
            const detail = await uploadRes.json().catch(() => ({}));
            throw new Error(detail.error || `Failed to upload ${file.name}.`);
        }

        const uploadData = await uploadRes.json().catch(() => ({}));
        const imagePath =
            typeof uploadData?.imagePath === "string" && uploadData.imagePath.trim()
                ? uploadData.imagePath.trim()
                : "";

        if (!imagePath) {
            throw new Error(`Upload for ${file.name} returned no image path.`);
        }

        return {
            imagePath,
            imageName: file.name,
            questionCount: 0,
            processed: false,
            failed: false,
        };
    };

    const ingestFilesIntoWorkspace = async (
        files: File[],
        mode: "replace" | "append"
    ) => {
        if (files.length === 0) return;

        const isReplace = mode === "replace";
        const hasExistingWorkspaceContent =
            sourceImages.length > 0 || pdfData.questions.some(isQuestionMeaningful);

        setIsExtracting(true);
        setIsProcessPopupOpen(true);

        if (isReplace) {
            setProcessingSteps([]);
            setCorrectionMarks([]);
            setSelectedMarkId(null);
            setMarkNoteDraft("");
            setActiveMarkTool(null);
            appendProcessingStep({
                stage: "client_upload_start",
                status: "info",
                message: `Starting upload for ${files.length} file(s).`,
            });
        } else {
            appendProcessingStep({
                stage: "client_append_start",
                status: "info",
                message: `Processing ${files.length} file(s) to append.`,
            });
        }

        try {
            const isSeedEmpty =
                pdfData.questions.length === 1 &&
                !pdfData.questions[0].questionHindi &&
                !pdfData.questions[0].questionEnglish &&
                pdfData.questions[0].options.every((option) => !option.english && !option.hindi);

            const retainedQuestions = isSeedEmpty ? [] : pdfData.questions;
            const nextQuestions =
                retainedQuestions.length === 0 ? [createBlankQuestion("1")] : retainedQuestions;
            const baseImages = isReplace ? [] : sourceImages;

            const workspaceId = await ensureWorkspaceDocument(
                nextQuestions,
                baseImages
            );

            appendProcessingStep({
                stage: "client_workspace_created",
                status: "success",
                message: `Workspace ready (ID: ${workspaceId || "offline"}). Uploading page images...`,
            });

            const normalizedFiles: File[] = [];
            for (const file of files) {
                if (file.type === "application/pdf") {
                    const pageFiles = await renderPdfFileToImageFiles(file);
                    normalizedFiles.push(...pageFiles);
                } else if (file.type.startsWith("image/")) {
                    normalizedFiles.push(file);
                }
            }

            if (normalizedFiles.length === 0) {
                throw new Error("No supported PDF pages or images were produced from the selected files.");
            }

            const uploadedImagesByIndex = new Array<SourceImageMeta | null>(normalizedFiles.length).fill(null);
            let completedUploads = 0;

            await runWithConcurrency(
                normalizedFiles,
                UPLOAD_PAGE_CONCURRENCY,
                async (normalizedFile, uploadIndex) => {
                    const uploaded = await uploadWorkspaceImageFile(normalizedFile, workspaceId);
                    uploadedImagesByIndex[uploadIndex] = uploaded;
                    completedUploads += 1;

                    const uploadedImages = uploadedImagesByIndex.filter(
                        (entry): entry is SourceImageMeta => Boolean(entry)
                    );
                    const liveImages = isReplace
                        ? uploadedImages
                        : [...baseImages, ...uploadedImages];

                    setSourceImages(liveImages);
                    setPdfData((prev) => ({
                        ...prev,
                        sourceImages: liveImages,
                        questions: nextQuestions,
                    }));

                    if (
                        completedUploads % UPLOAD_PAGE_CONCURRENCY === 0 ||
                        completedUploads === normalizedFiles.length
                    ) {
                        appendProcessingStep({
                            stage: "client_page_upload",
                            status: "info",
                            message: `Uploaded ${completedUploads} / ${normalizedFiles.length} page(s)...`,
                        });
                    }
                }
            );

            const uploadedImages = uploadedImagesByIndex.filter(
                (entry): entry is SourceImageMeta => Boolean(entry)
            );

            const finalImages = isReplace
                ? uploadedImages
                : [...baseImages, ...uploadedImages];

            const savedId =
                (await saveWorkspaceState(
                    {
                        ...pdfData,
                        questions: nextQuestions,
                        sourceImages: finalImages,
                    },
                    finalImages,
                    true
                )) || workspaceId;

            if (savedId) {
                setDocumentId(savedId);
            }

            setSourceImages(finalImages);
            setPdfData((prev) => ({
                ...prev,
                sourceImages: finalImages,
                questions: nextQuestions,
            }));

            if (finalImages.length > 0) {
                setSelectedPageImageIndex(isReplace ? 0 : baseImages.length);
            }

            setEditorMode("gallery");

            appendProcessingStep({
                stage: isReplace ? "client_upload_complete" : "client_append_complete",
                status: "success",
                message: isReplace
                    ? `Saved ${uploadedImages.length} page(s) to the workspace. Select pages and click "Extract" to begin AI parsing.`
                    : `Successfully appended ${uploadedImages.length} page(s) to the gallery.`,
            });

            toast.success(
                isReplace || !hasExistingWorkspaceContent
                    ? `${uploadedImages.length} page(s) saved to workspace.`
                    : `Added ${uploadedImages.length} new page(s).`
            );
        } catch (error: any) {
            console.error("Workspace ingestion error:", error);
            if (isReplace) {
                setModalConfig({
                    isOpen: true,
                    title: "PDF Processing failed",
                    message: error.message || "Could not process the selected files. Please check them and try again.",
                    type: "danger",
                });
            }
            toast.error(error.message || "Failed to process the selected files.");
            appendProcessingStep({
                stage: isReplace ? "client_upload_error" : "client_append_error",
                status: "error",
                message: error.message || "Failed to process the selected files.",
            });
        } finally {
            setIsExtracting(false);
            if (fileInputRef.current) fileInputRef.current.value = "";
            if (appendFileInputRef.current) appendFileInputRef.current.value = "";
        }
    };

    const handlePdfUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const files = Array.from(e.target.files || []);
        if (files.length === 0) return;

        const shouldAppend =
            sourceImages.length > 0 || pdfData.questions.some(isQuestionMeaningful);

        await ingestFilesIntoWorkspace(files, shouldAppend ? "append" : "replace");
    };

    function hydrateWorkspaceFromPayload(
        payload: Record<string, unknown>,
        nextDocumentId: string,
        options?: {
            announce?: boolean;
            resetSelection?: boolean;
            forceEditorPanel?: boolean;
        }
    ) {
            const templateId =
                typeof payload.templateId === "string" && payload.templateId.trim()
                    ? payload.templateId
                    : "professional";
            const previewResolution = normalizePreviewResolutionValue(payload.previewResolution);
            const loadedQuestions = normalizeLoadedQuestions(payload.questions);
            const loadedSourceImages = normalizeLoadedSourceImages(payload.sourceImages);
            const recoveredSourceImages =
                loadedSourceImages.length > 0
                    ? loadedSourceImages
                    : deriveSourceImagesFromQuestions(loadedQuestions);
            const loadedCorrectionMarks = normalizeLoadedCorrectionMarks(payload.correctionMarks);
            const nextJob = normalizeServerExtractionJob(payload.serverExtractionJob);
            const nextExtractionWarnings = Array.isArray(payload.extractionWarnings)
                ? payload.extractionWarnings
                    .map((warning) => String(warning || "").trim())
                    .filter(Boolean)
                : [];
            const nextProcessingSteps = Array.isArray(payload.extractionProcessingSteps)
                ? (payload.extractionProcessingSteps as ProcessingStep[])
                : [];
            const nextAssistantMessages = Array.isArray(payload.assistantMessages)
                ? (payload.assistantMessages as AssistantMessage[])
                : [];
            const nextOutputLanguageMode =
                payload.outputLanguageMode === "english" ||
                payload.outputLanguageMode === "hindi" ||
                payload.outputLanguageMode === "both"
                    ? payload.outputLanguageMode
                    : "both";
            const nextOutputQuestionScope =
                payload.outputQuestionScope === "current" ||
                payload.outputQuestionScope === "range" ||
                payload.outputQuestionScope === "all"
                    ? payload.outputQuestionScope
                    : "all";
            const nextOutputRangeStart = clampQuestionPosition(
                Number(payload.outputRangeStart),
                Math.max(loadedQuestions.length, 1)
            );
            const nextOutputRangeEnd = clampQuestionPosition(
                Number(payload.outputRangeEnd),
                Math.max(loadedQuestions.length, 1)
            );
            const loadedData: PdfData = {
                title: String(payload.title || "Extracted Question Set").trim() || "Extracted Question Set",
                date: String(payload.date || new Date().toLocaleDateString("en-GB")).trim(),
                subject:
                    typeof payload.subject === "string" && payload.subject.trim()
                        ? payload.subject
                        : undefined,
                instituteName: resolveInstituteName(payload.instituteName, organizationName),
                questions: loadedQuestions,
                templateId,
                optionDisplayOrder: "hindi-first",
                previewResolution,
                sourceImages: recoveredSourceImages,
            };

            startTransition(() => {
                setPdfData(loadedData);
                setSourceImages(recoveredSourceImages);
                setDocumentId(nextDocumentId);
                setExtractionWarnings(nextExtractionWarnings);
                setProcessingSteps(nextProcessingSteps);
                setAssistantMessages(nextAssistantMessages);
                setCorrectionMarks(loadedCorrectionMarks);
                setServerExtractionJob(nextJob);
                setIsExtracting(nextJob?.status === "running");

                if (options?.resetSelection) {
                    setSelectedQuestionIndex(0);
                    setSelectedPageImageIndex((current) => {
                        if (editorMode === "detail" && current !== null && current < recoveredSourceImages.length) {
                            return current;
                        }
                        return recoveredSourceImages.length > 0 ? 0 : null;
                    });
                } else {
                    setSelectedQuestionIndex((current) =>
                        loadedData.questions.length === 0
                            ? 0
                            : Math.max(0, Math.min(current, loadedData.questions.length - 1))
                    );
                    setSelectedPageImageIndex((current) => {
                        if (current === null) return current;
                        if (recoveredSourceImages.length === 0) return null;
                        return Math.max(0, Math.min(current, recoveredSourceImages.length - 1));
                    });
                }

                if (options?.forceEditorPanel) {
                    setActiveWorkspacePanel("editor");
                }

                setLastSavedHash(
                    buildWorkspaceHash(
                        loadedData,
                        recoveredSourceImages,
                        loadedCorrectionMarks
                    )
                );
            });

            if (options?.announce) {
                toast.success("Institute Suite workspace loaded");
            }

            return {
                loadedData,
                recoveredSourceImages,
                job: nextJob,
            };
    }

    async function syncWorkspaceFromServer(
        targetDocumentId: string,
        options?: Parameters<typeof hydrateWorkspaceFromPayload>[2]
    ) {
        const response = await fetch(`/api/documents/${targetDocumentId}`, {
            cache: "no-store",
        });

        if (!response.ok) {
            throw new Error("Failed to sync workspace state.");
        }

        const data = (await response.json()) as {
            document?: {
                id: string;
                updatedAt?: string;
                jsonData?: Record<string, unknown>;
            };
        };

        if (!data.document?.jsonData || typeof data.document.jsonData !== "object") {
            throw new Error("Workspace payload is missing.");
        }

        if (
            data.document.updatedAt &&
            loadedDocumentUpdatedAtRef.current === data.document.updatedAt
        ) {
            return null;
        }

        loadedDocumentUpdatedAtRef.current = data.document.updatedAt || null;

        return hydrateWorkspaceFromPayload(
            data.document.jsonData as Record<string, unknown>,
            data.document.id,
            options
        );
    }

    async function startServerExtraction(
        indicesToExtract: number[],
        options?: {
            startMessage?: string;
            successMessage?: string;
            clearSelection?: boolean;
            selectedPageIndex?: number | null;
        }
    ) {
        const targetDocumentId = await saveWorkspaceState(
            pdfData,
            sourceImages,
            true
        );

        if (!targetDocumentId) {
            throw new Error("Save the workspace once before starting server extraction.");
        }

        if (indicesToExtract.length === 0) {
            return;
        }

        setIsExtracting(true);
        setIsProcessPopupOpen(true);

        if (options?.startMessage) {
            appendProcessingStep({
                stage: "server_extraction_queued",
                status: "info",
                message: options.startMessage,
            });
        }

        const response = await fetch(`/api/documents/${targetDocumentId}/extract`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ indices: indicesToExtract }),
        });

        const data = (await response.json().catch(() => ({}))) as {
            job?: ServerExtractionJob;
            error?: string;
        };

        if (response.status === 409 && data.job) {
            setServerExtractionJob(data.job);
            appendProcessingStep({
                stage: "server_extraction_running",
                status: "warning",
                message: data.error || data.job.message || "Extraction is already running.",
            });
            toast.error(data.error || "Extraction is already running for this workspace.");
            return;
        }

        if (!response.ok) {
            throw new Error(data.error || "Failed to start server extraction.");
        }

        const job = data.job || null;
        setServerExtractionJob(job);

        if (typeof options?.selectedPageIndex === "number") {
            setSelectedPageImageIndex(options.selectedPageIndex);
            setEditorMode("detail");
        }

        if (options?.clearSelection) {
            setSelectedImageIndices(new Set());
        }

        toast.success(options?.successMessage || "Server extraction started.");
    }

    const stopServerExtraction = async () => {
        if (!documentId || documentId === "offline") {
            toast.error("Save the workspace first so the running extraction job can be stopped.");
            return;
        }

        if (!isExtracting && serverExtractionJob?.status !== "running") {
            toast.error("No extraction is currently running.");
            return;
        }

        setIsStoppingExtraction(true);
        setIsProcessPopupOpen(true);

        try {
            const response = await fetch(`/api/documents/${documentId}/extract`, {
                method: "DELETE",
            });

            const data = (await response.json().catch(() => ({}))) as {
                job?: ServerExtractionJob;
                error?: string;
            };

            const nextJob = normalizeServerExtractionJob(data.job);

            if (response.status === 409) {
                setServerExtractionJob(nextJob);
                setIsExtracting(false);
                toast.error(data.error || "No running extraction job was found.");
                return;
            }

            if (!response.ok) {
                throw new Error(data.error || "Failed to stop extraction.");
            }

            setServerExtractionJob(nextJob);
            setIsExtracting(false);
            appendProcessingStep({
                stage: "server_extraction_stopped",
                status: "warning",
                message: nextJob?.message || "Extraction stopped by user.",
            });
            toast.success("Extraction stopped.");

            await syncWorkspaceFromServer(documentId, {
                resetSelection: false,
                forceEditorPanel: false,
            }).catch((error) => {
                console.error("Failed to sync workspace after stop:", error);
            });
        } catch (error: any) {
            console.error("Stop extraction error:", error);
            toast.error(error.message || "Failed to stop extraction.");
        } finally {
            setIsStoppingExtraction(false);
        }
    };

    const extractSingleImage = async (imageIndex: number) => {
        if (imageIndex < 0 || imageIndex >= sourceImages.length) return;
        if (isExtracting || isStoppingExtraction || serverExtractionJob?.status === "running") {
            toast.error("An extraction is already running. Please wait.");
            return;
        }

        const targetImage = sourceImages[imageIndex];
        try {
            await startServerExtraction([imageIndex], {
                startMessage: `Queued server extraction for page: ${targetImage.imageName}.`,
                successMessage: `Server extraction started for ${targetImage.imageName}.`,
                selectedPageIndex: imageIndex,
            });
        } catch (error: any) {
            console.error("Single extraction error:", error);
            toast.error(error.message || "Failed to queue extraction.");
            appendProcessingStep({
                stage: "server_single_error",
                status: "error",
                message: error.message || "Failed to queue extraction for this page.",
            });
            setIsExtracting(false);
        }
    };

    const handleAppendUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const filesToAppend = Array.from(e.target.files || []);
        if (filesToAppend.length === 0) return;
        await ingestFilesIntoWorkspace(filesToAppend, "append");
    };

    const extractMultipleImages = async () => {
        const indicesToExtract = Array.from(selectedImageIndices).sort((a, b) => a - b);
        if (indicesToExtract.length === 0) return;
        if (indicesToExtract.length > DEFAULT_MAX_IMAGES_PER_BATCH) {
            toast.error(`Batch extraction supports up to ${DEFAULT_MAX_IMAGES_PER_BATCH} selected pages at once. You can still drag larger selections to reorder them.`);
            return;
        }

        if (isExtracting || isStoppingExtraction || serverExtractionJob?.status === "running") {
            toast.error("An extraction is already running. Please wait.");
            return;
        }

        try {
            await startServerExtraction(indicesToExtract, {
                startMessage: `Starting batch extraction for ${indicesToExtract.length} page(s)...`,
                successMessage: `Server extraction started for ${indicesToExtract.length} selected page(s).`,
                clearSelection: true,
            });
        } catch (error: any) {
            console.error("Batch extraction error:", error);
            toast.error(error.message || "Failed to queue extraction.");
            appendProcessingStep({
                stage: "server_batch_error",
                status: "error",
                message: error.message || "Failed to queue batch extraction.",
            });
            setIsExtracting(false);
        }
    };

    const extractAllRemainingInBatches = async () => {
        if (isExtracting || isStoppingExtraction || serverExtractionJob?.status === "running") {
            toast.error("An extraction is already running. Please wait.");
            return;
        }

        const allPending = remainingExtractionIndices;
        if (allPending.length === 0) {
            toast.success("No remaining pages to process.");
            return;
        }

        try {
            await startServerExtraction(allPending, {
                startMessage: `Queued ${allPending.length} page(s) for high-throughput extraction.`,
                successMessage: `High-throughput extraction started for ${allPending.length} page(s).`,
                clearSelection: true,
            });
        } catch (error: any) {
            console.error("Auto extraction error:", error);
            toast.error(error.message || "Failed to queue auto extraction.");
            appendProcessingStep({
                stage: "server_auto_batch_error",
                status: "error",
                message: error.message || "Failed to queue auto extraction.",
            });
            setIsExtracting(false);
        }
    };

    const autoFillAnswersInPageBatches = async () => {
        if (isAutoFillingAnswers) {
            toast.error("Answer filling is already running. Please wait.");
            return;
        }
        if (isExtracting) {
            toast.error("Wait for extraction to finish, then run answer fill.");
            return;
        }

        const questionIndices = pdfData.questions
            .map((question, index) => ({ question, index }))
            .filter(({ question }) => isQuestionMeaningful(question))
            .map(({ index }) => index);

        if (questionIndices.length === 0) {
            toast.error("No extracted questions found to fill answers.");
            return;
        }

        const pageNamesInOrder = sourceImages
            .map((image) => image.imageName)
            .filter((name): name is string => Boolean(name));

        const questionIndicesByPage = new Map<string, number[]>();
        questionIndices.forEach((questionIndex) => {
            const imageName = pdfData.questions[questionIndex]?.sourceImageName;
            if (!imageName) return;
            if (!questionIndicesByPage.has(imageName)) {
                questionIndicesByPage.set(imageName, []);
            }
            questionIndicesByPage.get(imageName)!.push(questionIndex);
        });

        const pageBatches: string[][] = [];
        for (let offset = 0; offset < pageNamesInOrder.length; offset += ANSWER_FILL_PAGE_BATCH_SIZE) {
            pageBatches.push(pageNamesInOrder.slice(offset, offset + ANSWER_FILL_PAGE_BATCH_SIZE));
        }

        const mappedQuestionIndices = new Set<number>();
        questionIndicesByPage.forEach((indices) => {
            indices.forEach((index) => mappedQuestionIndices.add(index));
        });
        const unmappedQuestionIndices = questionIndices.filter((index) => !mappedQuestionIndices.has(index));
        const fallbackBatchCount = Math.ceil(unmappedQuestionIndices.length / ANSWER_FILL_PAGE_BATCH_SIZE);
        const totalBatches = Math.max(1, pageBatches.length + fallbackBatchCount);

        setIsAutoFillingAnswers(true);
        setIsProcessPopupOpen(true);
        appendProcessingStep({
            stage: "client_answer_fill_start",
            status: "info",
            message: `Starting answer-only fill for ${questionIndices.length} question(s) in ${totalBatches} batch(es) of ${ANSWER_FILL_PAGE_BATCH_SIZE} page(s).`,
        });

        let completedBatches = 0;
        let totalUpdatedAnswers = 0;

        const runAnswerBatch = async (indices: number[], label: string): Promise<void> => {
            if (indices.length === 0) return;

            appendProcessingStep({
                stage: "client_answer_fill_batch_start",
                status: "info",
                message: `${label}: processing ${indices.length} question(s)...`,
            });

            const payload = {
                questions: indices.map((index) => ({
                    index,
                    question: pdfData.questions[index],
                })),
            };

            const response = await fetch("/api/image-workspace-assistant/batch-answers", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload),
            });

            const data = (await response.json()) as BatchAnswerFillResponse;
            if (!response.ok) {
                throw new Error(data.error || "Batch answer fill failed.");
            }

            const updates = Array.isArray(data.updates)
                ? data.updates.filter((update) => Number.isFinite(update.index) && String(update.answer || "").trim())
                : [];

            if (updates.length > 0) {
                setPdfData((prev) => {
                    const nextQuestions = [...prev.questions];
                    let changed = false;

                    updates.forEach((update) => {
                        const index = Number(update.index);
                        if (index < 0 || index >= nextQuestions.length) return;
                        const answer = String(update.answer || "").trim();
                        if (!answer) return;
                        const currentAnswer = String(nextQuestions[index]?.answer || "").trim();
                        if (currentAnswer === answer) return;
                        nextQuestions[index] = {
                            ...nextQuestions[index],
                            answer,
                        };
                        changed = true;
                    });

                    if (!changed) return prev;
                    const nextData = { ...prev, questions: nextQuestions };
                    debouncedPreview(nextData);
                    return nextData;
                });
            }

            totalUpdatedAnswers += updates.length;
            completedBatches += 1;

            appendProcessingStep({
                stage: "client_answer_fill_batch_done",
                status: "success",
                message: `${label}: updated ${updates.length} answer(s).`,
            });
        };

        try {
            for (let batchIndex = 0; batchIndex < pageBatches.length; batchIndex += 1) {
                const pageBatch = pageBatches[batchIndex];
                const questionIndexSet = new Set<number>();

                pageBatch.forEach((imageName) => {
                    const indices = questionIndicesByPage.get(imageName) || [];
                    indices.forEach((index) => questionIndexSet.add(index));
                });

                const indices = Array.from(questionIndexSet).sort((a, b) => a - b);
                if (indices.length > 0) {
                    try {
                        await runAnswerBatch(indices, `Answer batch ${batchIndex + 1}/${totalBatches}`);
                    } catch (error: any) {
                        appendProcessingStep({
                            stage: "client_answer_fill_batch_error",
                            status: "warning",
                            message: `Answer batch ${batchIndex + 1}/${totalBatches} failed: ${error.message || "Unknown error"}`,
                        });
                    }
                }

                if (batchIndex < pageBatches.length - 1 || unmappedQuestionIndices.length > 0) {
                    await sleep(ANSWER_FILL_BATCH_PAUSE_MS);
                }
            }

            for (let offset = 0; offset < unmappedQuestionIndices.length; offset += ANSWER_FILL_PAGE_BATCH_SIZE) {
                const chunk = unmappedQuestionIndices.slice(offset, offset + ANSWER_FILL_PAGE_BATCH_SIZE);
                const fallbackBatchIndex = Math.floor(offset / ANSWER_FILL_PAGE_BATCH_SIZE);
                const label = `Answer batch ${pageBatches.length + fallbackBatchIndex + 1}/${totalBatches}`;
                try {
                    await runAnswerBatch(chunk, label);
                } catch (error: any) {
                    appendProcessingStep({
                        stage: "client_answer_fill_batch_error",
                        status: "warning",
                        message: `${label} failed: ${error.message || "Unknown error"}`,
                    });
                }

                if (offset + ANSWER_FILL_PAGE_BATCH_SIZE < unmappedQuestionIndices.length) {
                    await sleep(ANSWER_FILL_BATCH_PAUSE_MS);
                }
            }

            appendProcessingStep({
                stage: "client_answer_fill_done",
                status: "success",
                message: `Answer fill completed: ${completedBatches}/${totalBatches} batch(es), ${totalUpdatedAnswers} answer(s) updated.`,
            });
            toast.success(`Answer fill complete (${totalUpdatedAnswers} answers updated).`);
        } finally {
            setIsAutoFillingAnswers(false);
        }
    };

    const toggleImageSelection = (idx: number, e: React.MouseEvent) => {
        e.stopPropagation();
        setSelectedImageIndices((prev) => {
            const next = new Set(prev);
            if (next.has(idx)) {
                next.delete(idx);
            } else {
                next.add(idx);
            }
            return next;
        });
    };

    const clearPageDragState = () => {
        setDraggedPageIndices([]);
        setPageDropTargetIndex(null);
        setIsPageDropAtEnd(false);
    };

    const handlePageDragStart = (pageIndex: number) => {
        const normalizedSelection = Array.from(selectedImageIndices)
            .map((index) => Number.parseInt(String(index), 10))
            .filter((index) => Number.isFinite(index) && index >= 0 && index < sourceImages.length)
            .sort((left, right) => left - right);

        const movingIndices =
            normalizedSelection.length > 0 && normalizedSelection.includes(pageIndex)
                ? normalizedSelection
                : [pageIndex];

        setDraggedPageIndices(movingIndices);
        setPageDropTargetIndex(pageIndex);
        setIsPageDropAtEnd(false);
    };

    const handlePageDrop = (targetIndex: number) => {
        if (draggedPageIndices.length === 0) return;
        reorderPages(draggedPageIndices, targetIndex);
        clearPageDragState();
    };

    const handlePageDropToEnd = () => {
        if (draggedPageIndices.length === 0) return;
        reorderPages(draggedPageIndices, sourceImages.length);
        clearPageDragState();
    };

    const addSelectedPagesToDeckBasket = () => {
        const selectedIndices = Array.from(selectedImageIndices)
            .map((index) => Number.parseInt(String(index), 10))
            .filter((index) => Number.isFinite(index) && index >= 0 && index < sourceImages.length)
            .sort((left, right) => left - right);

        if (selectedIndices.length === 0) {
            toast.error("Select one or more pages first.");
            return;
        }

        const nextPages: DeckMergeBasketPage[] = selectedIndices
            .map((index): DeckMergeBasketPage | null => {
                const image = sourceImages[index];
                if (!image) return null;

                const relatedQuestions = pdfData.questions
                    .filter((question) => String(question.sourceImageName || "").trim() === image.imageName)
                    .map((question) => ({
                        ...question,
                        clientId: createLocalId("question"),
                    }));

                return {
                    id: `${documentId || "draft"}::${image.imageName}`,
                    sourceDocumentId: documentId,
                    sourceDocumentTitle: String(pdfData.title || "Extracted Question Set").trim() || "Extracted Question Set",
                    sourceDocumentSubject: String(pdfData.subject || "").trim() || undefined,
                    sourceDocumentDate: String(pdfData.date || "").trim() || undefined,
                    sourcePageIndex: index,
                    imageName: image.imageName,
                    imagePath: image.imagePath,
                    originalImagePath: image.originalImagePath,
                    questionCount: relatedQuestions.length,
                    questionNumbers: relatedQuestions
                        .map((question) => String(question.number || "").trim())
                        .filter(Boolean),
                    questions: relatedQuestions,
                } satisfies DeckMergeBasketPage;
            })
            .filter((item): item is DeckMergeBasketPage => item !== null);

        if (nextPages.length === 0) {
            toast.error("Unable to prepare the selected pages.");
            return;
        }

        setDeckMergeBasket((current) => {
            const next = [...current];
            nextPages.forEach((page) => {
                const existingIndex = next.findIndex((item) => item.id === page.id);
                if (existingIndex >= 0) {
                    next[existingIndex] = page;
                } else {
                    next.push(page);
                }
            });
            return next;
        });

        setSelectedImageIndices(new Set());
        toast.success(
            `${nextPages.length} page${nextPages.length === 1 ? "" : "s"} added to deck basket.`
        );
    };

    const removeDeckBasketPage = (pageId: string) => {
        setDeckMergeBasket((current) => current.filter((item) => item.id !== pageId));
    };

    const clearDeckMergeBasket = () => {
        setDeckMergeBasket([]);
        toast.success("Deck basket cleared.");
    };

    const openDeckMergeModal = () => {
        if (deckMergeBasket.length === 0) {
            toast.error("Add pages to the deck basket first.");
            return;
        }

        setDeckMergeMode("existing");
        setDeckTargetSearch("");
        setNewDeckTitle(
            String(pdfData.title || "").trim()
                ? `${String(pdfData.title || "").trim()} Merged Deck`
                : "Merged Question Deck"
        );
        setNewDeckSubject(String(pdfData.subject || "").trim());
        setIsDeckMergeModalOpen(true);
    };

    const submitDeckMerge = async () => {
        if (deckMergeBasket.length === 0) {
            toast.error("Deck basket is empty.");
            return;
        }

        if (deckMergeMode === "existing" && !selectedDeckTargetId) {
            toast.error("Choose a target deck first.");
            return;
        }

        if (deckMergeMode === "new" && !newDeckTitle.trim()) {
            toast.error("Enter a title for the new deck.");
            return;
        }

        setIsSubmittingDeckMerge(true);

        try {
            let targetDocumentId = selectedDeckTargetId;
            let targetPayload: Record<string, unknown> = {};

            if (deckMergeMode === "existing") {
                const response = await fetch(`/api/documents/${selectedDeckTargetId}`, {
                    cache: "no-store",
                });
                if (!response.ok) {
                    throw new Error("Failed to load the target deck.");
                }
                const data = (await response.json()) as {
                    document?: {
                        id: string;
                        jsonData?: Record<string, unknown>;
                    };
                };
                if (!data.document?.jsonData || typeof data.document.jsonData !== "object") {
                    throw new Error("Target deck payload is missing.");
                }
                targetPayload = { ...(data.document.jsonData as Record<string, unknown>) };
                targetDocumentId = data.document.id;
            } else {
                targetPayload = {
                    title: newDeckTitle.trim(),
                    subject: newDeckSubject.trim() || newDeckTitle.trim(),
                    date: new Date().toLocaleDateString("en-GB"),
                    instituteName: resolveInstituteName(pdfData.instituteName, organizationName),
                    templateId:
                        typeof pdfData.templateId === "string" && pdfData.templateId.trim()
                            ? pdfData.templateId
                            : DEFAULT_EXTRACTOR_TEMPLATE_ID,
                    optionDisplayOrder: pdfData.optionDisplayOrder || "hindi-first",
                    previewResolution: pdfData.previewResolution || DEFAULT_EXTRACTOR_PREVIEW_RESOLUTION,
                    questions: [],
                    sourceImages: [],
                    sourceType: "PDF",
                } satisfies Record<string, unknown>;
            }

            const targetImages = Array.isArray(targetPayload.sourceImages)
                ? normalizeLoadedSourceImages(targetPayload.sourceImages)
                : [];
            const targetQuestions = Array.isArray(targetPayload.questions)
                ? normalizeLoadedQuestions(targetPayload.questions).filter(
                    (question) =>
                        isQuestionMeaningful(question) ||
                        Boolean(String(question.sourceImageName || "").trim())
                )
                : [];

            const nextImages = [...targetImages];
            const nextQuestions = [...targetQuestions];
            const usedImageNames = new Set(nextImages.map((image) => image.imageName));

            deckMergeBasket.forEach((page) => {
                const uniqueImageName = buildUniqueImageName(page.imageName, usedImageNames);
                usedImageNames.add(uniqueImageName);

                nextImages.push({
                    imageName: uniqueImageName,
                    imagePath: page.imagePath,
                    originalImagePath: page.originalImagePath,
                    questionCount: page.questionCount,
                    processed: page.questionCount > 0,
                    failed: false,
                    extractionError: undefined,
                    diagramCount: 0,
                    extractionMode: "original",
                });

                page.questions.forEach((question) => {
                    nextQuestions.push(cloneQuestionForDeckMerge(question, uniqueImageName));
                });
            });

            const finalQuestions = reorderQuestionsForPageOrder(
                nextQuestions,
                nextImages.map((image) => image.imageName)
            );
            const finalImages = buildSourceImagesWithQuestionCounts(nextImages, finalQuestions);

            const payloadToSave: Record<string, unknown> = {
                ...targetPayload,
                title:
                    deckMergeMode === "new"
                        ? newDeckTitle.trim()
                        : String(targetPayload.title || "Merged Question Deck").trim() || "Merged Question Deck",
                subject:
                    deckMergeMode === "new"
                        ? newDeckSubject.trim() || newDeckTitle.trim()
                        : String(targetPayload.subject || targetPayload.title || "").trim() ||
                          String(targetPayload.title || "Merged Question Deck").trim(),
                date:
                    String(targetPayload.date || "").trim() || new Date().toLocaleDateString("en-GB"),
                instituteName: resolveInstituteName(
                    targetPayload.instituteName,
                    pdfData.instituteName || organizationName
                ),
                templateId:
                    typeof targetPayload.templateId === "string" && targetPayload.templateId.trim()
                        ? targetPayload.templateId
                        : (typeof pdfData.templateId === "string" && pdfData.templateId.trim()
                            ? pdfData.templateId
                            : DEFAULT_EXTRACTOR_TEMPLATE_ID),
                optionDisplayOrder:
                    targetPayload.optionDisplayOrder === "english-first"
                        ? "english-first"
                        : "hindi-first",
                previewResolution: normalizePreviewResolutionValue(targetPayload.previewResolution),
                sourceImages: finalImages,
                questions: finalQuestions,
                sourceType: "PDF",
            };

            if (deckMergeMode === "existing" && targetDocumentId) {
                payloadToSave.documentId = targetDocumentId;
            }

            const saveResponse = await fetch("/api/documents/save", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify(payloadToSave),
            });

            const saveData = (await saveResponse.json().catch(() => ({}))) as {
                documentId?: string;
                error?: string;
                details?: string;
            };

            if (!saveResponse.ok || !saveData.documentId) {
                throw new Error(saveData.details || saveData.error || "Failed to send pages into the target deck.");
            }

            const nextTargetId = saveData.documentId;
            loadedDocumentIdRef.current = null;
            loadedDocumentUpdatedAtRef.current = null;
            await syncWorkspaceFromServer(nextTargetId, {
                announce: true,
                resetSelection: true,
                forceEditorPanel: true,
            });

            router.replace(`${pathname}?load=${nextTargetId}#extractor-workspace-review`, {
                scroll: false,
            });

            setDeckMergeBasket([]);
            setIsDeckMergeModalOpen(false);
            setSelectedImageIndices(new Set());
            setEditorMode("gallery");
            setSelectedPageImageIndex(null);
            setSelectedQuestionIndex(0);

            toast.success(
                `Merged ${deckMergeBasket.length} page${deckMergeBasket.length === 1 ? "" : "s"} into the target deck.`
            );
        } catch (error) {
            console.error("[extractor] Failed to merge deck basket:", error);
            toast.error(
                error instanceof Error ? error.message : "Failed to merge the selected pages."
            );
        } finally {
            setIsSubmittingDeckMerge(false);
        }
    };

    const removeSourceImage = (idx: number, e: React.MouseEvent) => {
        e.stopPropagation();
        const removedImageName = sourceImages[idx]?.imageName;
        setSourceImages(prev => {
            const next = [...prev];
            next.splice(idx, 1);
            return next;
        });
        setPdfData(prev => {
            const nextImages = prev.sourceImages ? [...prev.sourceImages] : [];
            nextImages.splice(idx, 1);
            return { ...prev, sourceImages: nextImages };
        });
        setSelectedImageIndices(prev => {
            const next = new Set(prev);
            next.delete(idx);
            const shifted = new Set<number>();
            next.forEach(i => {
                if (i > idx) shifted.add(i - 1);
                else shifted.add(i);
            });
            return shifted;
        });
        if (selectedPageImageIndex === idx) {
            setSelectedPageImageIndex(null);
            setEditorMode("gallery");
        } else if (selectedPageImageIndex !== null && selectedPageImageIndex > idx) {
            setSelectedPageImageIndex(selectedPageImageIndex - 1);
        }
        if (removedImageName) {
            setCorrectionMarks((prev) =>
                prev.filter((mark) => mark.imageName !== removedImageName)
            );
        }
    };

    useEffect(() => {
        const loadId = searchParams.get("load");
        if (!loadId) return;
        if (loadedDocumentIdRef.current === loadId) return;

        loadedDocumentIdRef.current = loadId;
        setIsLoadingSavedDocument(true);

        fetch(`/api/documents/${loadId}`)
            .then(async (response) => {
                if (!response.ok) {
                    throw new Error("Failed to load saved workspace");
                }
                return response.json() as Promise<{
                    document?: {
                        id: string;
                        updatedAt?: string;
                        jsonData?: Record<string, unknown>;
                    };
                }>;
            })
            .then((data) => {
                if (!data.document?.jsonData || typeof data.document.jsonData !== "object") {
                    throw new Error("Saved workspace payload is missing");
                }

                loadedDocumentUpdatedAtRef.current = data.document.updatedAt || null;

                hydrateWorkspaceFromPayload(
                    data.document.jsonData as Record<string, unknown>,
                    loadId,
                    {
                        announce: true,
                        resetSelection: true,
                        forceEditorPanel: true,
                    }
                );
            })
            .catch((error) => {
                console.error("Failed to load content workspace:", error);
                toast.error(
                    error instanceof Error ? error.message : "Failed to load saved workspace"
                );
            })
            .finally(() => {
                setIsLoadingSavedDocument(false);
            });
    }, [searchParams]);

    useEffect(() => {
        if (!documentId || documentId === "offline") return;
        if (serverExtractionJob?.status !== "running") return;

        let cancelled = false;

        const pollWorkspace = async () => {
            try {
                const result = await syncWorkspaceFromServer(documentId, {
                    resetSelection: false,
                    forceEditorPanel: false,
                });

                if (cancelled) return;

                const nextJob = result?.job || null;
                if (!nextJob || nextJob.status === "running") {
                    setIsExtracting(true);
                    return;
                }

                setIsExtracting(false);
                if (nextJob.status === "completed") {
                    toast.success(
                        nextJob.message ||
                        `Server extraction finished. ${nextJob.extractedQuestionCount} question(s) extracted.`
                    );
                } else if (nextJob.status === "failed") {
                    toast.error(nextJob.error || nextJob.message || "Server extraction failed.");
                }
            } catch (error) {
                if (cancelled) return;
                console.error("Failed to poll extraction job:", error);
            }
        };

        void pollWorkspace();
        const intervalId = window.setInterval(() => {
            void pollWorkspace();
        }, 3000);

        return () => {
            cancelled = true;
            window.clearInterval(intervalId);
        };
    }, [documentId, serverExtractionJob?.jobId, serverExtractionJob?.status]);

    const saveWorkspaceState = async (
        dataToSave: PdfData,
        imagesToSave: SourceImageMeta[],
        silent = true
    ): Promise<string | null> => {
        const effectiveSourceImages = imagesToSave.length
            ? imagesToSave
            : ((dataToSave.sourceImages as SourceImageMeta[] | undefined) || []);
        const effectiveTemplateId =
            typeof dataToSave.templateId === "string" && dataToSave.templateId.trim()
                ? dataToSave.templateId.trim()
                : DEFAULT_EXTRACTOR_TEMPLATE_ID;
        const effectivePreviewResolution = normalizePreviewResolutionValue(
            dataToSave.previewResolution ?? DEFAULT_EXTRACTOR_PREVIEW_RESOLUTION
        );
        const nextWorkspaceHash = buildWorkspaceHash(
            dataToSave,
            effectiveSourceImages,
            correctionMarks
        );

        if (nextWorkspaceHash === lastSavedHash) {
            return documentId;
        }

        if (saveInFlightRef.current) {
            return saveInFlightRef.current;
        }

        const savePromise = (async (): Promise<string | null> => {
            setIsSaving(true);
            try {
            const currentSourceImages = imagesToSave.length
                ? imagesToSave
                : ((dataToSave.sourceImages as SourceImageMeta[] | undefined) || []);

            // Strip base64 data URLs from sourceImages before saving
            const safeSourceImages = currentSourceImages.map(({ imagePath, originalImagePath, ...rest }) => ({
                ...rest,
                imagePath: imagePath?.startsWith("data:")
                    ? (originalImagePath?.startsWith("data:") ? "" : (originalImagePath || ""))
                    : (imagePath || ""),
                originalImagePath:
                    originalImagePath?.startsWith("data:") ? "" : (originalImagePath || ""),
            }));

            const savePayload = {
                ...dataToSave,
                templateId: effectiveTemplateId,
                previewResolution: effectivePreviewResolution,
                optionDisplayOrder: "hindi-first",
                outputLanguageMode,
                outputQuestionScope,
                outputRangeStart,
                outputRangeEnd,
                sourceImages: safeSourceImages,
                sourceType: "PDF",
                extractionWarnings,
                extractionProcessingSteps: processingSteps,
                assistantMessages,
                correctionMarks,
                serverExtractionJob,
                savedAt: new Date().toISOString(),
                documentId: documentId || undefined,
            };

            const response = await fetch("/api/documents/save", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(savePayload),
            });

            if (!response.ok) {
                const detail = await response.json().catch(() => ({}));
                throw new Error(detail.error || "Save failed");
            }

            const data = await response.json().catch(() => ({}));
            const savedId = data?.documentId;
            if (savedId) setDocumentId(savedId);

            setLastSavedHash(nextWorkspaceHash);

            if (!silent) toast.success("Saved to workspace documents");
            return savedId || null;
        } catch (error: any) {
            console.error(error);
            if (!silent) toast.error(error.message || "Save failed");
            return null;
        } finally {
            saveInFlightRef.current = null;
            setIsSaving(false);
        }
        })();

        saveInFlightRef.current = savePromise;
        return savePromise;
    };

    const handleSaveToDb = async () => {
        await saveWorkspaceState(pdfData, sourceImages, false);
    };

    const buildExportData = (options?: {
        selectedIndices?: Set<number>;
        titleOverride?: string;
        shuffleQuestions?: boolean;
    }): PdfData => {
        const selectedQuestions = options?.selectedIndices
            ? pdfData.questions.filter((_, index) => options.selectedIndices?.has(index))
            : pdfData.questions;

        const filteredQuestions = removeDuplicateQuestionsForOutput(selectedQuestions).filter(isQuestionMeaningful);
        const questionsForExport = [...filteredQuestions];

        if (options?.shuffleQuestions) {
            for (let index = questionsForExport.length - 1; index > 0; index -= 1) {
                const swapIndex = Math.floor(Math.random() * (index + 1));
                [questionsForExport[index], questionsForExport[swapIndex]] = [
                    questionsForExport[swapIndex],
                    questionsForExport[index],
                ];
            }
        }

        return {
            ...pdfData,
            title: String(options?.titleOverride || pdfData.title || "").trim() || "Extracted Question Set",
            optionDisplayOrder:
                outputLanguageMode === "english"
                    ? "english-first"
                    : pdfData.optionDisplayOrder || "hindi-first",
            questions: renumberQuestions(
                questionsForExport.map((question) =>
                    applyLanguageModeToQuestion(question, outputLanguageMode)
                )
            ),
        };
    };

    const patchSelectedQuestion = (patch: Partial<Question>) => {
        setPdfData((prev) => {
            const currentQuestion = prev.questions[selectedQuestionIndex];
            if (!currentQuestion) return prev;

            const nextQuestions = [...prev.questions];
            nextQuestions[selectedQuestionIndex] = {
                ...currentQuestion,
                ...patch,
            };

            const nextData = { ...prev, questions: nextQuestions };
            debouncedPreview(nextData);
            return nextData;
        });
    };

    const updateQuestionField = (field: EditableQuestionField, value: string) => {
        patchSelectedQuestion({ [field]: value } as Partial<Question>);
    };

    const updateQuestionType = (questionType: QuestionType) => {
        setPdfData((prev) => {
            const nextQuestions = [...prev.questions];
            const current = nextQuestions[selectedQuestionIndex];
            const shouldHaveOptions = isOptionType(questionType);
            nextQuestions[selectedQuestionIndex] = {
                ...current,
                questionType,
                options: shouldHaveOptions
                    ? current.options.length >= 2
                        ? current.options
                        : [
                            { english: "", hindi: "" },
                            { english: "", hindi: "" },
                        ]
                    : current.options,
                blankCount: questionType === "FIB" ? Math.max(1, current.blankCount || 1) : undefined,
                matchColumns:
                    questionType === "MATCH_COLUMN"
                        ? current.matchColumns || { left: [], right: [] }
                        : current.matchColumns,
            };

            const nextData = { ...prev, questions: nextQuestions };
            debouncedPreview(nextData);
            return nextData;
        });
    };

    const updateBlankCount = (value: number) => {
        setPdfData((prev) => {
            const nextQuestions = [...prev.questions];
            const current = nextQuestions[selectedQuestionIndex];
            nextQuestions[selectedQuestionIndex] = {
                ...current,
                blankCount: Math.max(1, Math.min(value || 1, 20)),
            };
            const nextData = { ...prev, questions: nextQuestions };
            debouncedPreview(nextData);
            return nextData;
        });
    };

    const updateMatchColumns = (side: "left" | "right", text: string) => {
        setPdfData((prev) => {
            const nextQuestions = [...prev.questions];
            const current = nextQuestions[selectedQuestionIndex];
            const currentColumns = current.matchColumns || { left: [], right: [] };
            nextQuestions[selectedQuestionIndex] = {
                ...current,
                matchColumns: {
                    ...currentColumns,
                    [side]: parseMatchColumnEntries(text),
                },
            };
            const nextData = { ...prev, questions: nextQuestions };
            debouncedPreview(nextData);
            return nextData;
        });
    };

    const updateOptionField = (optionIndex: number, language: keyof QuestionOption, value: string) => {
        setPdfData((prev) => {
            const nextQuestions = [...prev.questions];
            const question = nextQuestions[selectedQuestionIndex];
            const nextOptions = [...question.options];
            nextOptions[optionIndex] = {
                ...nextOptions[optionIndex],
                [language]: value,
            };

            nextQuestions[selectedQuestionIndex] = {
                ...question,
                options: nextOptions,
            };

            const nextData = { ...prev, questions: nextQuestions };
            debouncedPreview(nextData);
            return nextData;
        });
    };
    const reorderQuestionsByClientIds = (orderedClientIds: string[]) => {
        setPdfData((prev) => {
            const questionById = new Map(
                prev.questions.map((question) => [String(question.clientId || ""), question])
            );
            const nextQuestions = renumberQuestions(
                orderedClientIds
                    .map((clientId) => questionById.get(clientId))
                    .filter((question): question is Question => Boolean(question))
            );

            if (nextQuestions.length !== prev.questions.length) {
                return prev;
            }

            const currentClientId = prev.questions[selectedQuestionIndex]?.clientId;
            const nextSelectedIndex = currentClientId
                ? Math.max(
                    0,
                    nextQuestions.findIndex((question) => question.clientId === currentClientId)
                )
                : Math.max(0, Math.min(selectedQuestionIndex, nextQuestions.length - 1));

            const nextData = { ...prev, questions: nextQuestions };
            setSelectedQuestionIndex(nextSelectedIndex);
            debouncedPreview(nextData);
            return nextData;
        });
    };

    const moveSelectedQuestion = (direction: "up" | "down") => {
        const currentQuestion = pdfData.questions[selectedQuestionIndex];
        if (!currentQuestion?.clientId) return;

        const currentPosition = pdfData.questions.findIndex(
            (question) => question.clientId === currentQuestion.clientId
        );
        if (currentPosition === -1) return;

        const targetPosition =
            direction === "up" ? currentPosition - 1 : currentPosition + 1;
        if (targetPosition < 0 || targetPosition >= pdfData.questions.length) return;

        const orderedClientIds = pdfData.questions.map((question) => String(question.clientId || ""));
        const [moved] = orderedClientIds.splice(currentPosition, 1);
        orderedClientIds.splice(targetPosition, 0, moved);
        reorderQuestionsByClientIds(orderedClientIds);
    };

    const shuffleQuestions = () => {
        if (pdfData.questions.length <= 1) return;

        const shuffledIds = pdfData.questions
            .map((question) => String(question.clientId || ""))
            .slice();

        for (let index = shuffledIds.length - 1; index > 0; index -= 1) {
            const swapIndex = Math.floor(Math.random() * (index + 1));
            [shuffledIds[index], shuffledIds[swapIndex]] = [shuffledIds[swapIndex], shuffledIds[index]];
        }

        reorderQuestionsByClientIds(shuffledIds);
        toast.success("Question order shuffled");
    };

    const resetQuestionOrder = () => {
        if (questionOrderBaseline.length === 0) return;
        reorderQuestionsByClientIds(questionOrderBaseline);
        toast.success("Question order reset");
    };

    const applyPageOrder = (nextImages: SourceImageMeta[], successMessage?: string) => {
        const currentSelectedImageName =
            selectedPageImageIndex !== null ? sourceImages[selectedPageImageIndex]?.imageName || "" : "";
        const currentSelectedQuestionClientId =
            pdfData.questions[selectedQuestionIndex]?.clientId || "";
        const selectedImageNames = new Set(
            Array.from(selectedImageIndices)
                .map((index) => sourceImages[index]?.imageName || "")
                .filter(Boolean)
        );
        const nextImageNames = nextImages.map((image) => image.imageName);
        const nextQuestions = reorderQuestionsForPageOrder(pdfData.questions, nextImageNames);
        const nextData: PdfData = {
            ...pdfData,
            questions: nextQuestions,
            sourceImages: nextImages,
        };

        setSourceImages(nextImages);
        setPdfData(nextData);

        if (selectedImageNames.size > 0) {
            const nextSelectedIndices = new Set<number>();
            nextImages.forEach((image, index) => {
                if (selectedImageNames.has(image.imageName)) {
                    nextSelectedIndices.add(index);
                }
            });
            setSelectedImageIndices(nextSelectedIndices);
        }

        if (currentSelectedImageName) {
            const nextPageIndex = nextImages.findIndex(
                (image) => image.imageName === currentSelectedImageName
            );
            setSelectedPageImageIndex(nextPageIndex === -1 ? null : nextPageIndex);
        }

        if (currentSelectedQuestionClientId) {
            const nextQuestionIndex = nextQuestions.findIndex(
                (question) => question.clientId === currentSelectedQuestionClientId
            );
            if (nextQuestionIndex !== -1) {
                setSelectedQuestionIndex(nextQuestionIndex);
            }
        }

        debouncedPreview(nextData);
        if (successMessage) {
            toast.success(successMessage);
        }
    };

    const reorderPages = (movingIndices: number[], targetIndex: number) => {
        if (sourceImages.length <= 1) return;
        const normalizedMoving = Array.from(
            new Set(
                movingIndices
                    .map((index) => Number.parseInt(String(index), 10))
                    .filter((index) => Number.isFinite(index) && index >= 0 && index < sourceImages.length)
            )
        ).sort((left, right) => left - right);

        if (normalizedMoving.length === 0) return;

        const nextImages = reorderItemsByBlock(sourceImages, normalizedMoving, targetIndex);
        const didChange = nextImages.some((image, index) => image.imageName !== sourceImages[index]?.imageName);
        if (!didChange) return;

        applyPageOrder(
            nextImages,
            normalizedMoving.length > 1
                ? `${normalizedMoving.length} pages moved. Question numbering updated.`
                : "Page moved. Question numbering updated."
        );
    };

    const moveSelectedPagesBy = (direction: "up" | "down") => {
        const normalizedSelection = Array.from(selectedImageIndices)
            .map((index) => Number.parseInt(String(index), 10))
            .filter((index) => Number.isFinite(index) && index >= 0 && index < sourceImages.length)
            .sort((left, right) => left - right);

        if (normalizedSelection.length === 0) {
            toast.error("Select page cards first.");
            return;
        }

        if (direction === "up") {
            if (normalizedSelection[0] === 0) return;
            reorderPages(normalizedSelection, normalizedSelection[0] - 1);
            return;
        }

        const lastIndex = normalizedSelection[normalizedSelection.length - 1];
        if (lastIndex >= sourceImages.length - 1) return;
        reorderPages(normalizedSelection, lastIndex + 2);
    };

    const addQuestion = () => {
        setPdfData((prev) => {
            const nextQuestions = renumberQuestions([
                ...prev.questions,
                createBlankQuestion(nextQuestionNumber(prev.questions)),
            ]);
            const nextData = { ...prev, questions: nextQuestions };
            setSelectedQuestionIndex(nextData.questions.length - 1);
            debouncedPreview(nextData);
            return nextData;
        });
    };

    const removeQuestion = (index: number) => {
        if (pdfData.questions.length <= 1) {
            toast.error("At least one question is required");
            return;
        }

        setPdfData((prev) => {
            const nextQuestions = renumberQuestions(prev.questions.filter((_, i) => i !== index));
            const nextData = { ...prev, questions: nextQuestions };
            setSelectedQuestionIndex((current) => Math.max(0, Math.min(current, nextQuestions.length - 1)));
            debouncedPreview(nextData);
            return nextData;
        });
        toast.success("Question deleted");
    };

    const addOption = () => {
        setPdfData((prev) => {
            const nextQuestions = [...prev.questions];
            const question = nextQuestions[selectedQuestionIndex];
            if (question.options.length >= 10) {
                toast.error("Maximum 10 options supported");
                return prev;
            }
            nextQuestions[selectedQuestionIndex] = {
                ...question,
                options: [...question.options, { english: "", hindi: "" }],
            };

            const nextData = { ...prev, questions: nextQuestions };
            debouncedPreview(nextData);
            return nextData;
        });
    };

    const removeOption = (index: number) => {
        setPdfData((prev) => {
            const nextQuestions = [...prev.questions];
            const question = nextQuestions[selectedQuestionIndex];
            if (question.options.length <= 2) {
                toast.error("At least 2 options required");
                return prev;
            }

            nextQuestions[selectedQuestionIndex] = {
                ...question,
                options: question.options.filter((_, i) => i !== index),
            };

            const nextData = { ...prev, questions: nextQuestions };
            debouncedPreview(nextData);
            return nextData;
        });
        toast.success("Option removed");
    };

    const requestRemoveQuestion = (index: number) => {
        const target = pdfData.questions[index];
        requestConfirmation(
            "Delete question",
            `Question ${target?.number || index + 1} will be removed from this workspace.`,
            () => removeQuestion(index),
            { type: "danger", confirmText: "Delete Question" }
        );
    };

    const removeDiagramFromSelectedQuestion = () => {
        if (!selectedQuestion) return;
        patchSelectedQuestion({
            diagramImagePath: "",
            diagramBounds: undefined,
        });
        toast.success("Diagram removed from slide");
    };

    const handleCustomDiagramSelection = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        if (!selectedQuestion) {
            toast.error("Select a question before uploading a diagram.");
            e.target.value = "";
            return;
        }

        setIsUploadingDiagram(true);

        try {
            const formData = new FormData();
            formData.append("file", file);
            formData.append(
                "filename",
                file.name || `question-${selectedQuestion.number || selectedQuestionIndex + 1}-diagram`
            );

            const response = await fetch("/api/uploads/diagram", {
                method: "POST",
                body: formData,
            });

            const data = (await response.json().catch(() => ({}))) as {
                imagePath?: string;
                error?: string;
                details?: string;
            };

            if (!response.ok || !data.imagePath) {
                throw new Error(data.error || data.details || "Diagram upload failed.");
            }

            patchSelectedQuestion({
                diagramImagePath: data.imagePath,
                diagramBounds: undefined,
                diagramDetected: true,
            });

            appendProcessingStep({
                stage: "custom_diagram_uploaded",
                status: "success",
                message: `Uploaded custom diagram for Question ${selectedQuestion.number || selectedQuestionIndex + 1}.`,
                imageName: selectedQuestion.sourceImageName,
            });
            toast.success("Custom diagram uploaded.");
        } catch (error: any) {
            console.error("Diagram upload error:", error);
            toast.error(error.message || "Failed to upload diagram.");
            appendProcessingStep({
                stage: "custom_diagram_upload_error",
                status: "error",
                message: error.message || "Failed to upload custom diagram.",
                imageName: selectedQuestion.sourceImageName,
            });
        } finally {
            setIsUploadingDiagram(false);
            e.target.value = "";
        }
    };

    const requestRemoveDiagram = () => {
        if (!selectedQuestion?.diagramImagePath) {
            toast.error("No diagram selected to remove.");
            return;
        }

        requestConfirmation(
            "Remove diagram",
            "Only the slide diagram will be removed. You can still reselect extracted diagram content.",
            removeDiagramFromSelectedQuestion,
            { type: "warning", confirmText: "Remove Diagram" }
        );
    };

    const requestRemoveOption = (optionIndex: number) => {
        const question = pdfData.questions[selectedQuestionIndex];
        if (!question) return;
        if (question.options.length <= 2) {
            toast.error("At least 2 options required");
            return;
        }

        requestConfirmation(
            "Delete option",
            `Option ${optionIndex + 1} will be removed from Question ${question.number || selectedQuestionIndex + 1}.`,
            () => removeOption(optionIndex),
            { type: "warning", confirmText: "Delete Option" }
        );
    };

    const getViewerPointerPoint = (event: React.PointerEvent<HTMLDivElement>) => {
        const node = pageViewerRef.current;
        if (!node) return null;
        const rect = node.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) return null;
        const x = clampUnit((event.clientX - rect.left) / rect.width);
        const y = clampUnit((event.clientY - rect.top) / rect.height);
        return { x, y };
    };

    const zoomInPageViewer = () => {
        setPageZoom((prev) => Math.min(3, Math.max(0.5, Number((prev + 0.25).toFixed(2)))));
    };

    const zoomOutPageViewer = () => {
        setPageZoom((prev) => Math.min(3, Math.max(0.5, Number((prev - 0.25).toFixed(2)))));
    };

    const resetPageZoom = () => {
        setPageZoom(1);
    };

    const cancelCropSelection = () => {
        setDraftCropRect(null);
        setPendingCropRect(null);
        setIsCropMode(false);
        drawingModeRef.current = null;
        drawingStartRef.current = null;
    };

    const toggleCropMode = () => {
        setIsCropMode((prev) => {
            const next = !prev;
            if (next) {
                setActiveMarkTool(null);
            } else {
                setDraftCropRect(null);
                setPendingCropRect(null);
            }
            return next;
        });
    };

    const restoreSelectedPageImage = () => {
        if (selectedPageImageIndex === null) return;
        const source = sourceImages[selectedPageImageIndex];
        const originalPath = source?.originalImagePath;
        if (!originalPath) {
            toast.error("Original page image not available for restore.");
            return;
        }

        setSourceImages((prev) =>
            prev.map((item, index) =>
                index === selectedPageImageIndex
                    ? {
                        ...item,
                        imagePath: originalPath,
                    }
                    : item
            )
        );
        setDraftCropRect(null);
        setPendingCropRect(null);
        setIsCropMode(false);
        toast.success("Original image restored.");
    };

    const applyCropToSelectedPage = async () => {
        if (selectedPageImageIndex === null) {
            toast.error("Select a page before cropping.");
            return;
        }
        if (!pendingCropRect) {
            toast.error("Draw a crop area first.");
            return;
        }
        if (isApplyingCrop) return;

        const source = sourceImages[selectedPageImageIndex];
        if (!source) {
            toast.error("Selected page image not found.");
            return;
        }

        const sourcePath = source.imagePath || source.originalImagePath || "";
        if (!sourcePath) {
            toast.error("Image source is missing.");
            return;
        }

        const rect = normalizeDraftRect({ ...pendingCropRect, shape: "rect" });
        if (rect.width < 0.015 || rect.height < 0.015) {
            toast.error("Crop area is too small.");
            return;
        }

        setIsApplyingCrop(true);
        try {
            const image = await new Promise<HTMLImageElement>((resolve, reject) => {
                const img = new Image();
                img.onload = () => resolve(img);
                img.onerror = () => reject(new Error("Failed to load image for crop."));
                img.src = sourcePath;
            });

            const naturalWidth = image.naturalWidth || image.width;
            const naturalHeight = image.naturalHeight || image.height;
            if (!naturalWidth || !naturalHeight) {
                throw new Error("Invalid image size.");
            }

            const sx = Math.max(0, Math.floor(rect.x * naturalWidth));
            const sy = Math.max(0, Math.floor(rect.y * naturalHeight));
            const sw = Math.max(1, Math.floor(rect.width * naturalWidth));
            const sh = Math.max(1, Math.floor(rect.height * naturalHeight));
            const safeWidth = Math.min(sw, naturalWidth - sx);
            const safeHeight = Math.min(sh, naturalHeight - sy);

            const canvas = document.createElement("canvas");
            canvas.width = safeWidth;
            canvas.height = safeHeight;
            const ctx = canvas.getContext("2d");
            if (!ctx) throw new Error("Canvas context unavailable.");

            ctx.drawImage(image, sx, sy, safeWidth, safeHeight, 0, 0, safeWidth, safeHeight);
            const croppedDataUrl = canvas.toDataURL("image/png");

            setSourceImages((prev) =>
                prev.map((item, index) =>
                    index === selectedPageImageIndex
                        ? {
                            ...item,
                            originalImagePath: item.originalImagePath || item.imagePath,
                            imagePath: croppedDataUrl,
                        }
                        : item
                )
            );

            setPendingCropRect(null);
            setDraftCropRect(null);
            setIsCropMode(false);
            toast.success("Crop applied.");
        } catch (error) {
            console.error("Failed to crop selected page image:", error);
            toast.error(error instanceof Error ? error.message : "Failed to apply crop.");
        } finally {
            setIsApplyingCrop(false);
        }
    };

    const handlePageViewerPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
        if (event.button !== 0) return;
        if (!canCreateCorrectionMarks && !isCropMode) return;
        if (!activeMarkTool && !isCropMode) return;
        if (Math.abs(pageZoom - 1) > 0.001) {
            toast.error("Set zoom to 100% before drawing marks or crop area.");
            return;
        }

        const point = getViewerPointerPoint(event);
        if (!point) return;

        const drawingMode: "mark" | "crop" = isCropMode ? "crop" : "mark";
        drawingModeRef.current = drawingMode;
        drawingStartRef.current = { ...point, pointerId: event.pointerId };

        if (drawingMode === "crop") {
            setDraftCropRect({
                shape: "rect",
                x: point.x,
                y: point.y,
                width: 0,
                height: 0,
            });
            setPendingCropRect(null);
        } else {
            setDraftMark({
                shape: activeMarkTool || "rect",
                x: point.x,
                y: point.y,
                width: 0,
                height: 0,
            });
            setSelectedMarkId(null);
        }

        event.currentTarget.setPointerCapture(event.pointerId);
        event.preventDefault();
    };

    const handlePageViewerPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
        if (!drawingStartRef.current || drawingStartRef.current.pointerId !== event.pointerId) return;
        if (!drawingModeRef.current) return;
        const point = getViewerPointerPoint(event);
        if (!point) return;
        const start = drawingStartRef.current;

        if (drawingModeRef.current === "crop") {
            setDraftCropRect({
                shape: "rect",
                x: start.x,
                y: start.y,
                width: point.x - start.x,
                height: point.y - start.y,
            });
        } else {
            setDraftMark({
                shape: activeMarkTool || "rect",
                x: start.x,
                y: start.y,
                width: point.x - start.x,
                height: point.y - start.y,
            });
        }
    };

    const handlePageViewerPointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
        if (!drawingStartRef.current || drawingStartRef.current.pointerId !== event.pointerId) return;
        const drawingMode = drawingModeRef.current;
        const draft = drawingMode === "crop" ? draftCropRect : draftMark;
        drawingStartRef.current = null;
        drawingModeRef.current = null;
        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
            event.currentTarget.releasePointerCapture(event.pointerId);
        }
        setDraftMark(null);
        setDraftCropRect(null);
        if (!draft || !selectedPageImageName) return;

        const normalized = normalizeDraftRect(draft);
        if (normalized.width < 0.015 || normalized.height < 0.015) return;

        if (drawingMode === "crop") {
            setPendingCropRect({ ...normalized, shape: "rect" });
            toast.success("Crop area selected. Click Apply Crop.");
            return;
        }

        const nextMark: CorrectionMark = {
            id: createLocalId("mark"),
            imageName: selectedPageImageName,
            questionNumber: selectedQuestion?.number || "",
            questionIndex: selectedQuestionIndex,
            shape: normalized.shape,
            x: normalized.x,
            y: normalized.y,
            width: normalized.width,
            height: normalized.height,
            note: "",
            selectedText: undefined,
            replacementText: undefined,
            createdAt: new Date().toISOString(),
            createdById: currentUserId,
            createdByName:
                (session?.user?.name as string | undefined) ||
                (session?.user?.email as string | undefined) ||
                "Staff",
            status: "open",
        };

        setCorrectionMarks((prev) => [...prev, nextMark]);
        setSelectedMarkId(nextMark.id);
        setMarkNoteDraft("");
        toast.success("Typo mark added. Add note and save.");
    };

    const saveSelectedMarkNote = () => {
        if (!selectedMarkId) return;
        const note = markNoteDraft.trim();
        setCorrectionMarks((prev) =>
            prev.map((mark) => (mark.id === selectedMarkId ? { ...mark, note } : mark))
        );
        toast.success("Mark note saved");
    };

    const deleteSelectedMark = () => {
        if (!selectedMarkId) return;
        setCorrectionMarks((prev) => prev.filter((mark) => mark.id !== selectedMarkId));
        setSelectedMarkId(null);
        setMarkNoteDraft("");
        toast.success("Mark removed");
    };

    const toggleSelectedMarkStatus = () => {
        if (!selectedMarkId) return;
        setCorrectionMarks((prev) =>
            prev.map((mark) =>
                mark.id === selectedMarkId
                    ? { ...mark, status: mark.status === "resolved" ? "open" : "resolved" }
                    : mark
            )
        );
    };

    const getRichEditorText = () => {
        const raw = richEditorRef.current?.innerText ?? richTemplateText;
        return raw.replace(/\r/g, "");
    };

    const handleRichEditorInput = () => {
        setRichTemplateText(getRichEditorText());
    };

    const runRichFormatCommand = (command: string, value?: string) => {
        richEditorRef.current?.focus();
        document.execCommand(command, false, value);
    };

    const resetRichTemplateFromStructured = () => {
        if (!selectedQuestion) return;
        const nextTemplate = buildRichTemplateFromQuestion(selectedQuestion);
        setRichTemplateText(nextTemplate);
        if (richEditorRef.current) {
            richEditorRef.current.innerText = nextTemplate;
        }
        toast.success("Rich draft reset from structured fields.");
    };

    const applyRichTemplateToStructured = () => {
        if (!selectedQuestion) return;
        const latestTemplate = getRichEditorText();
        const nextQuestion = parseRichTemplateToQuestion(latestTemplate, selectedQuestion);
        setPdfData((prev) => {
            const nextQuestions = [...prev.questions];
            nextQuestions[selectedQuestionIndex] = nextQuestion;
            const nextData = { ...prev, questions: nextQuestions };
            debouncedPreview(nextData);
            return nextData;
        });
        setRichTemplateText(buildRichTemplateFromQuestion(nextQuestion));
        toast.success("Rich content applied to question fields.");
    };

    const attachSelectedTextToMark = () => {
        if (!selectedMarkId) {
            toast.error("Select a mark first.");
            return;
        }
        const selectedText = window.getSelection()?.toString().trim() || "";
        if (!selectedText) {
            toast.error("Select text in rich content before attaching.");
            return;
        }
        setCorrectionMarks((prev) =>
            prev.map((mark) =>
                mark.id === selectedMarkId
                    ? {
                        ...mark,
                        selectedText,
                        replacementText: mark.replacementText || "",
                    }
                    : mark
            )
        );
        toast.success("Selected text linked to mark.");
    };

    const applySelectedMarkReplacement = () => {
        if (!selectedMarkId) {
            toast.error("Select a mark first.");
            return;
        }
        const targetMark = correctionMarks.find((mark) => mark.id === selectedMarkId);
        if (!targetMark) {
            toast.error("Selected mark not found.");
            return;
        }

        const searchText = String(targetMark.selectedText || "").trim();
        const replacementText = String(targetMark.replacementText || "").trim();
        if (!searchText) {
            toast.error("Mark does not have selected text.");
            return;
        }
        if (!replacementText) {
            toast.error("Add replacement text before applying.");
            return;
        }

        const targetIndex =
            Number.isFinite(targetMark.questionIndex) &&
                (targetMark.questionIndex as number) >= 0 &&
                (targetMark.questionIndex as number) < pdfData.questions.length
                ? (targetMark.questionIndex as number)
                : selectedQuestionIndex;

        const targetQuestion = pdfData.questions[targetIndex];
        if (!targetQuestion) {
            toast.error("Target question not found for this mark.");
            return;
        }

        const updatedQuestion = applyReplacementToQuestionFields(
            targetQuestion,
            searchText,
            replacementText
        );

        setPdfData((prev) => {
            const nextQuestions = [...prev.questions];
            nextQuestions[targetIndex] = updatedQuestion;
            const nextData = { ...prev, questions: nextQuestions };
            debouncedPreview(nextData);
            return nextData;
        });

        setCorrectionMarks((prev) =>
            prev.map((mark) =>
                mark.id === selectedMarkId ? { ...mark, status: "resolved" } : mark
            )
        );

        if (targetIndex === selectedQuestionIndex) {
            const nextTemplate = buildRichTemplateFromQuestion(updatedQuestion);
            setRichTemplateText(nextTemplate);
            if (richEditorRef.current) {
                richEditorRef.current.innerText = nextTemplate;
            }
        }

        toast.success("Replacement applied from mark to question.");
    };
    const sendAssistantPrompt = async () => {
        const prompt = assistantPrompt.trim();
        if (!prompt) return;
        if (!selectedQuestion) {
            toast.error("Select a question to request AI correction.");
            return;
        }

        const targetIndex = selectedQuestionIndex;
        const userMessage: AssistantMessage = {
            id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
            role: "user",
            text: prompt,
            targetIndex,
        };

        setAssistantMessages((prev) => [...prev, userMessage]);
        setAssistantPrompt("");
        setIsAssistantBusy(true);

        try {
            const response = await fetch("/api/image-workspace-assistant", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    message: prompt,
                    question: selectedQuestion,
                }),
            });

            const data = (await response.json()) as WorkspaceAssistantResponse;
            if (!response.ok) {
                throw new Error(data.error || "Assistant correction failed.");
            }

            const suggestion = data.question
                ? normalizeAssistantQuestion(data.question, selectedQuestion)
                : undefined;
            const assistantMessage: AssistantMessage = {
                id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
                role: "assistant",
                text: data.reply || "Generated a structure-aware correction suggestion.",
                suggestion,
                targetIndex,
            };
            setAssistantMessages((prev) => [...prev, assistantMessage]);
        } catch (error: any) {
            console.error("Assistant correction error:", error);
            toast.error(error.message || "Assistant correction failed");
            setAssistantMessages((prev) => [
                ...prev,
                {
                    id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
                    role: "assistant",
                    text: error.message || "Assistant correction failed.",
                    targetIndex,
                },
            ]);
        } finally {
            setIsAssistantBusy(false);
        }
    };

    const applyAssistantSuggestion = (messageId: string) => {
        const message = assistantMessages.find((entry) => entry.id === messageId);
        if (!message?.suggestion || message.targetIndex === undefined) {
            toast.error("No suggestion available to apply.");
            return;
        }
        const targetIndex = message.targetIndex;
        const suggestion = message.suggestion;

        setPdfData((prev) => {
            const nextQuestions = [...prev.questions];
            if (targetIndex < 0 || targetIndex >= nextQuestions.length) {
                return prev;
            }
            nextQuestions[targetIndex] = suggestion;
            const nextData = { ...prev, questions: nextQuestions };
            debouncedPreview(nextData);
            return nextData;
        });

        setSelectedQuestionIndex(targetIndex);
        setAssistantMessages((prev) =>
            prev.map((entry) => (entry.id === messageId ? { ...entry, applied: true } : entry))
        );
        toast.success("AI suggestion applied to question");
    };

    return (
        <div className="page-container workspace-mobile-page pb-24" style={{ width: "min(1700px, calc(100% - 1.5rem))" }}>
            <StudioWorkspaceHero
                theme="extractor"
                compact
                eyebrow="Institute Suite · Extraction"
                title="Question Extractor"
                description="Process PDFs or page images, continue saved review workspaces, and prepare bilingual slides inside the same extractor shell. The editing header below stays intact for fast question review."
                highlights={["Saved workspaces", "Bilingual slides", "Diagram-aware review"]}
                actions={[
                    { href: "/content-studio", label: "Tool Hub", tone: "secondary" },
                    { href: "/content-studio/media", label: "Media Studio", tone: "ghost" },
                    { href: "/content-studio/youtube", label: "YouTube Workspace", tone: "ghost" },
                    { href: "/content-studio/whatsapp", label: "WhatsApp Workspace", tone: "ghost" },
                    { href: "/content-studio/telegram", label: "Telegram Workspace", tone: "ghost" },
                ]}
                helperText="Saved extractor history appears below, right inside the question review workflow."
            />

            <header
                ref={pageActionHeaderRef}
                className={`page-header workspace-sticky-header sticky z-[60] mb-3 rounded-[28px] border border-slate-200 bg-white/92 shadow-sm backdrop-blur-md ${isEditorDetailMode ? "px-4 py-2.5" : "px-4 py-3"}`}
                style={{ top: `${TOP_NAV_OFFSET_PX}px` }}
            >
                <div className="workspace-compact-bar">
                    <div className="workspace-compact-primary">
                        <div className="workspace-compact-heading">
                            <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-indigo-50 text-indigo-600 text-[10px] font-bold tracking-widest uppercase border border-indigo-100">
                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                                    <polyline points="14 2 14 8 20 8"></polyline>
                                    <line x1="16" y1="13" x2="8" y2="13"></line>
                                    <line x1="16" y1="17" x2="8" y2="17"></line>
                                    <polyline points="10 9 9 9 8 9"></polyline>
                                </svg>
                                Institute Suite
                            </div>
                            <div>
                                <p className="workspace-compact-title">Question Review</p>
                                <p className="workspace-compact-subtitle">
                                    {sourceImages.length} pages · {extractionSummary.questionCount} questions
                                </p>
                            </div>
                        </div>

                        <div className="workspace-compact-statuses">
                            {hasUnsavedChanges && (
                                <span className="status-badge workspace-status-badge-warning">
                                    Unsaved Changes
                                </span>
                            )}
                            {isExtracting && (
                                <span className="status-badge">
                                    <span className="spinner" style={{ width: 10, height: 10 }} />
                                    Extracting
                                </span>
                            )}
                            {isSaving && (
                                <span className="status-badge">
                                    <span className="spinner" style={{ width: 10, height: 10 }} />
                                    Saving
                                </span>
                            )}
                            {isLoadingSavedDocument && <span className="status-badge">Loading</span>}
                            <span className="status-badge">Hindi then English</span>
                        </div>
                    </div>

                    <div className="workspace-compact-metrics">
                        <span className="tool-chip">Pages: {sourceImages.length}</span>
                        <span className="tool-chip">Questions: {extractionSummary.questionCount}</span>
                        <span className="tool-chip">MCQ: {extractionSummary.typeCounts.MCQ || 0}</span>
                        <span className="tool-chip">Match: {extractionSummary.typeCounts.MATCH_COLUMN || 0}</span>
                        <span className="tool-chip">Duplicates: {duplicateAnalysis.duplicateQuestionCount}</span>
                    </div>
                </div>
            </header>

            {extractionWarnings.length > 0 && (
                <div className="mx-4 mt-4 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 shadow-sm">
                    <p className="font-bold mb-1 uppercase tracking-wide">Extraction Warnings</p>
                    <ul className="list-disc pl-5 space-y-1 font-medium">
                        {extractionWarnings.slice(-5).map((warning, index) => (
                            <li key={`${warning}-${index}`}>{warning}</li>
                        ))}
                    </ul>
                </div>
            )}

            <ExtractorWorkspaceHistory
                currentDocumentId={documentId}
                isLoadingCurrentDocument={isLoadingSavedDocument}
            />

            {/* ── WORKSPACE VIEW STRIP ── sticky below stat strip ─────── */}
            <section
                id="extractor-workspace-review"
                ref={workspaceStripRef}
                className={`workspace-sticky-strip bg-slate-50/90 backdrop-blur-md px-4 py-2.5 mb-0 sticky z-[54] border border-slate-200 rounded-[28px] shadow-[0_8px_24px_-18px_rgba(15,23,42,0.28)] ${isEditorDetailMode ? "workspace-strip-compact" : ""}`}
                style={{ top: `${stickyWorkspaceTopPx}px` }}
            >
                <input
                    type="file"
                    ref={fileInputRef}
                    onChange={handlePdfUpload}
                    className="hidden"
                    accept="application/pdf,image/*"
                    multiple
                />
                <input
                    type="file"
                    ref={appendFileInputRef}
                    onChange={handleAppendUpload}
                    className="hidden"
                    accept="application/pdf,image/*"
                    multiple
                />
                <input
                    type="file"
                    ref={diagramUploadInputRef}
                    onChange={handleCustomDiagramSelection}
                    className="hidden"
                    accept="image/*"
                />

                {isEditorDetailMode && (
                    <div className="workspace-review-focus-strip">
                        <div className="workspace-review-focus-main">
                            <div className="workspace-review-focus-copy">
                                <p className="workspace-review-focus-label">Focused Review</p>
                                <p className="workspace-review-focus-title">
                                    {compactPageFileName || `Page ${selectedPageImageIndex !== null ? selectedPageImageIndex + 1 : "-"}`}
                                </p>
                            </div>

                            <div className="workspace-review-focus-tabs">
                                {WORKSPACE_PANEL_OPTIONS.map((view) => (
                                    <button
                                        key={`focus-panel-${view.id}`}
                                        type="button"
                                        onClick={() => setActiveWorkspacePanel(view.id)}
                                        className={`tool-btn workspace-review-mini-btn ${activeWorkspacePanel === view.id ? "tool-btn-active" : ""}`}
                                    >
                                        {view.id === "editor" ? "Editor" : view.label}
                                    </button>
                                ))}
                                {EDITOR_MODE_OPTIONS.map((mode) => (
                                    <button
                                        key={`focus-mode-${mode.id}`}
                                        type="button"
                                        onClick={() => setEditorMode(mode.id)}
                                        disabled={mode.id === "detail" && selectedPageImageIndex === null}
                                        className={`tool-btn workspace-review-mini-btn ${editorMode === mode.id ? "tool-btn-active" : ""}`}
                                    >
                                        {mode.id === "detail" ? "Page" : "Gallery"}
                                    </button>
                                ))}
                                <button
                                    type="button"
                                    onClick={() => activateWorkspaceNavigatorItem("review")}
                                    className={`tool-btn workspace-review-mini-btn ${detailViewMode === "review" ? "tool-btn-active" : ""}`}
                                >
                                    Review
                                </button>
                                <button
                                    type="button"
                                    onClick={() => activateWorkspaceNavigatorItem("structured")}
                                    className={`tool-btn workspace-review-mini-btn ${detailViewMode === "structured" ? "tool-btn-active" : ""}`}
                                >
                                    Structured
                                </button>
                                <button
                                    type="button"
                                    onClick={() => activateWorkspaceNavigatorItem("rich")}
                                    className={`tool-btn workspace-review-mini-btn ${detailViewMode === "rich" ? "tool-btn-active" : ""}`}
                                >
                                    Rich
                                </button>
                            </div>
                        </div>

                        <div className="workspace-review-focus-actions">
                            <div className="workspace-review-focus-chips">
                                <span className="tool-chip">Page {selectedPageImageIndex !== null ? selectedPageImageIndex + 1 : "-"}</span>
                                <span className="tool-chip">Qs {selectedPageQuestionEntries.length}</span>
                                <span className="tool-chip">
                                    {selectedPageStatus === "extracted" ? "Ready" : selectedPageStatus === "failed" ? "Retry" : "Pending"}
                                </span>
                                {selectedQuestion && (
                                    <span className="tool-chip">Active Q{selectedQuestion.number || selectedQuestionIndex + 1}</span>
                                )}
                            </div>

                            <div className="workspace-review-focus-actions-row">
                                <button
                                    type="button"
                                    onClick={() => fileInputRef.current?.click()}
                                    className="tool-btn workspace-review-mini-btn"
                                >
                                    Upload
                                </button>
                                <button
                                    type="button"
                                    onClick={handleSaveToDb}
                                    disabled={isSaving || isExtracting}
                                    className="tool-btn workspace-review-mini-btn"
                                >
                                    {isSaving ? "Saving..." : "Save"}
                                </button>
                                <button
                                    type="button"
                                    onClick={() => selectedPageImageIndex !== null && extractSingleImage(selectedPageImageIndex)}
                                    disabled={isExtracting || isStoppingExtraction || selectedPageImageIndex === null}
                                    className="tool-btn workspace-review-mini-btn tool-btn-primary"
                                >
                                    {isStoppingExtraction ? "Stopping..." : isExtracting ? "Extracting..." : "Extract"}
                                </button>
                                {(isExtracting || serverExtractionJob?.status === "running") && (
                                    <button
                                        type="button"
                                        onClick={stopServerExtraction}
                                        disabled={isStoppingExtraction}
                                        className="tool-btn workspace-review-mini-btn tool-btn-danger"
                                    >
                                        {isStoppingExtraction ? "Stopping..." : "Stop"}
                                    </button>
                                )}
                                <button
                                    type="button"
                                    onClick={toggleProcessTimeline}
                                    className={`tool-btn workspace-review-mini-btn ${isProcessPopupOpen ? "tool-btn-active" : ""}`}
                                >
                                    Timeline
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setIsDetailToolsCollapsed((prev) => !prev)}
                                    className="tool-btn workspace-review-mini-btn"
                                >
                                    {isDetailToolsCollapsed ? "Show Tools" : "Hide Tools"}
                                </button>
                            </div>
                        </div>
                    </div>
                )}

                {(!isEditorDetailMode || !isDetailToolsCollapsed) && (
                <div className={`workspace-control-deck ${isEditorDetailMode ? "workspace-control-deck-compact" : ""}`}>
                    <div className={`workspace-control-section ${isEditorDetailMode ? "" : "workspace-control-section-wide"}`}>
                        <div className="workspace-control-heading">
                            <p className="workspace-control-label">Workspace</p>
                        </div>
                        <div className="workspace-control-buttons">
                            <button
                                type="button"
                                onClick={() => fileInputRef.current?.click()}
                                className="tool-btn tool-btn-primary"
                            >
                                Upload PDF/Images
                            </button>
                            <button
                                type="button"
                                onClick={handleSaveToDb}
                                disabled={isSaving || isExtracting}
                                className="tool-btn"
                            >
                                {isSaving ? "Saving..." : "Save Progress"}
                            </button>
                            <button
                                type="button"
                                onClick={() => {
                                    setExportTitle(String(pdfData.title || "").trim() || "Extracted Question Set");
                                    setExportShuffleQuestions(false);
                                    setIsDocxModalOpen(true);
                                }}
                                disabled={isExtracting || !pdfData.questions.some(isQuestionMeaningful)}
                                className="tool-btn"
                            >
                                Export DOCX
                            </button>
                            <button
                                type="button"
                                onClick={toggleProcessTimeline}
                                className={`tool-btn ${isProcessPopupOpen ? "tool-btn-active" : ""}`}
                                aria-label={isProcessPopupOpen ? "Hide AI timeline" : "Show AI timeline"}
                            >
                                AI Timeline
                                <span className={`ml-1 inline-flex min-w-5 h-5 items-center justify-center rounded-full px-1.5 text-[10px] font-bold ${processUnreadCount > 0
                                    ? "bg-amber-400 text-amber-950"
                                    : isProcessPopupOpen
                                        ? "bg-white/20 text-white"
                                        : "bg-slate-100 text-slate-600"
                                    }`}>
                                    {processUnreadCount > 0 ? processUnreadCount : processingSteps.length}
                                </span>
                            </button>
                        </div>
                        <div className="workspace-control-meta">
                            <span className="tool-chip">Questions: {extractionSummary.questionCount}</span>
                            <span className="tool-chip">Pages: {sourceImages.length}</span>
                            <span className="tool-chip">Diagrams: {extractionSummary.withDiagrams}</span>
                            <span className="tool-chip">High Confidence: {extractionSummary.highConfidence}</span>
                        </div>
                    </div>

                    <div className="workspace-control-section">
                        <div className="workspace-control-heading">
                            <p className="workspace-control-label">View</p>
                        </div>
                        <div className="workspace-control-buttons">
                            {WORKSPACE_PANEL_OPTIONS.map((view) => (
                                <button
                                    key={view.id}
                                    type="button"
                                    onClick={() => setActiveWorkspacePanel(view.id)}
                                    className={`tool-btn ${activeWorkspacePanel === view.id ? "tool-btn-active" : ""}`}
                                >
                                    {view.label}
                                </button>
                            ))}
                            {activeWorkspacePanel === "editor" &&
                                EDITOR_MODE_OPTIONS.map((mode) => (
                                    <button
                                        key={mode.id}
                                        type="button"
                                        onClick={() => setEditorMode(mode.id)}
                                        disabled={mode.id === "detail" && selectedPageImageIndex === null}
                                        className={`tool-btn ${editorMode === mode.id ? "tool-btn-active" : ""}`}
                                    >
                                        {mode.label}
                                    </button>
                                ))}
                        </div>
                    </div>

                    <div className="workspace-control-section">
                        <div className="workspace-control-heading">
                            <p className="workspace-control-label">Output</p>
                            <p className="workspace-control-note">
                                Control review rendering and exported PDF/DOCX language by current question or range.
                            </p>
                        </div>
                        <div className="workspace-output-grid">
                            <label className="workspace-output-field">
                                <span className="workspace-output-field-label">
                                    Language
                                </span>
                                <select
                                    value={outputLanguageMode}
                                    onChange={(e) => setOutputLanguageMode(e.target.value as OutputLanguageMode)}
                                    className="select workspace-output-select"
                                >
                                    {OUTPUT_LANGUAGE_OPTIONS.map((option) => (
                                        <option key={option.value} value={option.value}>
                                            {option.label}
                                        </option>
                                    ))}
                                </select>
                            </label>
                            <label className="workspace-output-field">
                                <span className="workspace-output-field-label">
                                    Questions
                                </span>
                                <select
                                    value={outputQuestionScope}
                                    onChange={(e) => setOutputQuestionScope(e.target.value as OutputQuestionScope)}
                                    className="select workspace-output-select"
                                >
                                    {OUTPUT_SCOPE_OPTIONS.map((option) => (
                                        <option key={option.value} value={option.value}>
                                            {option.label}
                                        </option>
                                    ))}
                                </select>
                            </label>
                            {outputQuestionScope === "range" && (
                                <div className="workspace-output-range">
                                    <label className="workspace-output-field">
                                        <span className="workspace-output-field-label">
                                            From
                                        </span>
                                        <input
                                            type="number"
                                            min={1}
                                            max={Math.max(1, pdfData.questions.length)}
                                            value={outputRangeStart}
                                            onChange={(e) =>
                                                setOutputRangeStart(
                                                    clampQuestionPosition(
                                                        Number.parseInt(e.target.value || "1", 10),
                                                        pdfData.questions.length
                                                    )
                                                )
                                            }
                                            className="input workspace-output-select"
                                        />
                                    </label>
                                    <label className="workspace-output-field">
                                        <span className="workspace-output-field-label">
                                            To
                                        </span>
                                        <input
                                            type="number"
                                            min={1}
                                            max={Math.max(1, pdfData.questions.length)}
                                            value={outputRangeEnd}
                                            onChange={(e) =>
                                                setOutputRangeEnd(
                                                    clampQuestionPosition(
                                                        Number.parseInt(e.target.value || "1", 10),
                                                        pdfData.questions.length
                                                    )
                                                )
                                            }
                                            className="input workspace-output-select"
                                        />
                                    </label>
                                </div>
                            )}
                        </div>
                        <div className="workspace-control-meta workspace-output-meta">
                            <span className="tool-chip">Language: {getOutputLanguageLabel(outputLanguageMode)}</span>
                            <span className="tool-chip">
                                Scope: {getOutputScopeLabel(outputQuestionScope, selectedQuestionIndex, outputRangeStart, outputRangeEnd)}
                            </span>
                            <span className="tool-chip">Will export: {outputQuestionCount}</span>
                        </div>
                    </div>

                    {activeWorkspacePanel === "editor" && (
                        <div className="workspace-control-section">
                            <div className="workspace-control-heading">
                                <p className="workspace-control-label">Pages</p>
                                <p className="workspace-control-note">
                                    Keep uploads and extraction reachable without scrolling through the editor.
                                </p>
                            </div>
                            <div className="workspace-control-buttons">
                                <button
                                    onClick={() => appendFileInputRef.current?.click()}
                                    className="tool-btn"
                                    disabled={isExtracting}
                                >
                                    {isExtracting ? "Adding..." : "+ Upload More Pages"}
                                </button>
                                {editorMode === "gallery" && (
                                    <button
                                        onClick={extractAllRemainingInBatches}
                                        className="tool-btn tool-btn-primary"
                                        disabled={isExtracting || isStoppingExtraction || remainingExtractionCount === 0}
                                        title="Queue every non-extracted page for high-throughput server extraction"
                                    >
                                        {isStoppingExtraction
                                            ? "Stopping..."
                                            : isExtracting
                                            ? "Extracting..."
                                            : `Extract Everything (${remainingExtractionCount})`}
                                    </button>
                                )}
                                {editorMode === "detail" && selectedPageImageIndex !== null && (
                                    <button
                                        onClick={() => extractSingleImage(selectedPageImageIndex)}
                                        className="tool-btn tool-btn-primary"
                                        disabled={isExtracting || isStoppingExtraction}
                                    >
                                        {isStoppingExtraction ? "Stopping..." : isExtracting ? "Extracting..." : "Extract Current Page"}
                                    </button>
                                )}
                                {editorMode === "gallery" && selectedImageIndices.size > 0 && (
                                    <button
                                        type="button"
                                        onClick={extractMultipleImages}
                                        disabled={isExtracting || isStoppingExtraction}
                                        className="tool-btn tool-btn-primary"
                                    >
                                        {isStoppingExtraction
                                            ? "Stopping..."
                                            : isExtracting
                                            ? "Extracting..."
                                            : `Extract Selected (${selectedImageIndices.size})`}
                                    </button>
                                )}
                                {(isExtracting || serverExtractionJob?.status === "running") && (
                                    <button
                                        type="button"
                                        onClick={stopServerExtraction}
                                        disabled={isStoppingExtraction}
                                        className="tool-btn tool-btn-danger"
                                    >
                                        {isStoppingExtraction ? "Stopping Extraction..." : "Stop Extraction"}
                                    </button>
                                )}
                                {editorMode === "gallery" && selectedImageIndices.size > 0 && (
                                    <button
                                        type="button"
                                        onClick={() => setSelectedImageIndices(new Set())}
                                        className="tool-btn"
                                    >
                                        Clear Selection
                                    </button>
                                )}
                            </div>
                            <div className="workspace-control-meta">
                                {editorMode === "gallery" && (
                                    <>
                                        <span className="tool-chip">Selected: {selectedImageIndices.size}</span>
                                        <span className="tool-chip">Pending: {remainingExtractionCount}</span>
                                    </>
                                )}
                                {editorMode === "detail" && selectedPageImageIndex !== null && (
                                    <>
                                        <span className="tool-chip">Page: {selectedPageImageIndex + 1}</span>
                                        <span className="tool-chip">
                                            Status: {selectedPageStatus === "extracted" ? "Ready" : selectedPageStatus === "failed" ? "Retry" : "Pending"}
                                        </span>
                                    </>
                                )}
                            </div>
                        </div>
                    )}

                    {activeWorkspacePanel === "editor" && editorMode === "detail" && selectedQuestion && (
                        <>
                            <div className="workspace-control-section">
                                <div className="workspace-control-heading">
                                    <p className="workspace-control-label">Question</p>
                                    <p className="workspace-control-note">
                                        Edit the selected question without losing the page context.
                                    </p>
                                </div>
                                <div className="workspace-control-buttons">
                                    <button onClick={addQuestion} className="tool-btn">
                                        Add Question
                                    </button>
                                    <button
                                        className="tool-btn"
                                        onClick={() => setIsAiChatPopupOpen(true)}
                                    >
                                        AI Correction Chat
                                    </button>
                                    <button
                                        className="tool-btn tool-btn-primary"
                                        onClick={autoFillAnswersInPageBatches}
                                        disabled={isAutoFillingAnswers || isExtracting}
                                        title="Auto-fill answers in sequential page batches of 8"
                                    >
                                        {isAutoFillingAnswers ? "Filling Answers..." : "Auto Fill Answers"}
                                    </button>
                                    <button
                                        className="tool-btn"
                                        onClick={() => moveSelectedQuestion("up")}
                                        disabled={selectedQuestionIndex === 0}
                                    >
                                        Move Up
                                    </button>
                                    <button
                                        className="tool-btn"
                                        onClick={() => moveSelectedQuestion("down")}
                                        disabled={selectedQuestionIndex === pdfData.questions.length - 1}
                                    >
                                        Move Down
                                    </button>
                                    <button
                                        className="tool-btn"
                                        onClick={shuffleQuestions}
                                        disabled={pdfData.questions.length <= 1}
                                    >
                                        Shuffle
                                    </button>
                                    <button
                                        className="tool-btn"
                                        onClick={resetQuestionOrder}
                                        disabled={questionOrderBaseline.length === 0}
                                    >
                                        Reset Order
                                    </button>
                                    <button
                                        className="tool-btn tool-btn-danger"
                                        onClick={() => requestRemoveQuestion(selectedQuestionIndex)}
                                    >
                                        Delete Question
                                    </button>
                                </div>
                                <div className="workspace-control-meta">
                                    <span className="tool-chip">Q{selectedQuestion.number || selectedQuestionIndex + 1}</span>
                                    <span className="tool-chip">{getQuestionTypeLabel(selectedQuestion.questionType)}</span>
                                </div>
                            </div>

                            <div className="workspace-control-section">
                                <div className="workspace-control-heading">
                                    <p className="workspace-control-label">Diagram and Review</p>
                                    <p className="workspace-control-note">
                                        Keep diagram handling and review marks together.
                                    </p>
                                </div>
                                <div className="workspace-control-buttons">
                                    <button
                                        className="tool-btn"
                                        onClick={() => diagramUploadInputRef.current?.click()}
                                        disabled={isUploadingDiagram}
                                    >
                                        {isUploadingDiagram ? "Uploading Diagram..." : "Upload Diagram"}
                                    </button>
                                    <button
                                        className="tool-btn"
                                        onClick={() => {
                                            updateQuestionField(
                                                "diagramImagePath",
                                                selectedQuestion.autoDiagramImagePath ||
                                                    selectedQuestion.diagramImagePath ||
                                                    ""
                                            );
                                        }}
                                        disabled={
                                            !selectedQuestion.autoDiagramImagePath &&
                                            !selectedQuestion.diagramImagePath
                                        }
                                    >
                                        Use Auto Diagram
                                    </button>
                                    <button
                                        className="tool-btn"
                                        onClick={requestRemoveDiagram}
                                    >
                                        Remove Diagram
                                    </button>
                                    <button
                                        className={`tool-btn ${activeMarkTool === "circle" ? "tool-btn-primary" : ""}`}
                                        onClick={() => {
                                            setIsCropMode(false);
                                            setDraftCropRect(null);
                                            setPendingCropRect(null);
                                            setActiveMarkTool((prev) => (prev === "circle" ? null : "circle"));
                                        }}
                                        disabled={!canCreateCorrectionMarks}
                                    >
                                        Circle Mark
                                    </button>
                                    <button
                                        className={`tool-btn ${activeMarkTool === "rect" ? "tool-btn-primary" : ""}`}
                                        onClick={() => {
                                            setIsCropMode(false);
                                            setDraftCropRect(null);
                                            setPendingCropRect(null);
                                            setActiveMarkTool((prev) => (prev === "rect" ? null : "rect"));
                                        }}
                                        disabled={!canCreateCorrectionMarks}
                                    >
                                        Rectangle Mark
                                    </button>
                                </div>
                                <div className="workspace-control-meta">
                                    <span className="tool-chip">Marks: {selectedPageMarks.length}</span>
                                    <span className="tool-chip">Duplicates: {duplicateAnalysis.duplicateQuestionCount}</span>
                                </div>
                            </div>

                            <div className="workspace-control-section">
                                <div className="workspace-control-heading">
                                    <p className="workspace-control-label">Zoom and Crop</p>
                                    <p className="workspace-control-note">
                                        Image cleanup tools stay visible while the page viewer scrolls.
                                    </p>
                                </div>
                                <div className="workspace-control-buttons">
                                    <button
                                        className="tool-btn"
                                        onClick={zoomOutPageViewer}
                                        disabled={pageZoom <= 0.5}
                                        title="Zoom out"
                                    >
                                        Zoom -
                                    </button>
                                    <button
                                        className="tool-btn"
                                        onClick={resetPageZoom}
                                        disabled={Math.abs(pageZoom - 1) < 0.001}
                                        title="Reset zoom to 100%"
                                    >
                                        Zoom 100%
                                    </button>
                                    <button
                                        className="tool-btn"
                                        onClick={zoomInPageViewer}
                                        disabled={pageZoom >= 3}
                                        title="Zoom in"
                                    >
                                        Zoom +
                                    </button>
                                    <button
                                        className={`tool-btn ${isCropMode ? "tool-btn-primary" : ""}`}
                                        onClick={toggleCropMode}
                                    >
                                        {isCropMode ? "Crop Mode On" : "Crop Mode"}
                                    </button>
                                    <button
                                        className="tool-btn tool-btn-primary"
                                        onClick={applyCropToSelectedPage}
                                        disabled={!pendingCropRect || isApplyingCrop}
                                    >
                                        {isApplyingCrop ? "Applying Crop..." : "Apply Crop"}
                                    </button>
                                    <button
                                        className="tool-btn"
                                        onClick={cancelCropSelection}
                                        disabled={!isCropMode && !pendingCropRect && !draftCropRect}
                                    >
                                        Cancel Crop
                                    </button>
                                    <button
                                        className="tool-btn"
                                        onClick={restoreSelectedPageImage}
                                        disabled={
                                            selectedPageImageIndex === null ||
                                            !sourceImages[selectedPageImageIndex]?.originalImagePath
                                        }
                                    >
                                        Reset Image
                                    </button>
                                </div>
                                <div className="workspace-control-meta">
                                    <span className="tool-chip">{Math.round(pageZoom * 100)}%</span>
                                    <span className="tool-chip">Crop: {pendingCropRect ? "Selected" : "None"}</span>
                                    <span className="tool-chip">
                                        Status: {selectedPageStatus === "extracted" ? "Ready" : selectedPageStatus === "failed" ? "Retry" : "Pending"}
                                    </span>
                                </div>
                            </div>
                        </>
                    )}
                </div>
                )}
            </section>

            {activeWorkspacePanel === "assistant" && (
                <section className="grid grid-cols-1 gap-3 mb-3">
                    {activeWorkspacePanel === "assistant" && (
                        <article className="surface p-3">
                            <div className="flex items-center justify-between gap-3 mb-3">
                                <div>
                                    <p className="text-xs font-bold uppercase tracking-wide text-slate-500">
                                        AI Correction Chat
                                    </p>
                                    <p className="text-[11px] text-slate-500 mt-1">
                                        Ask AI to fix structure, language, option order, or formatting for the selected question.
                                    </p>
                                </div>
                                <span className="status-badge">
                                    Target: Q{selectedQuestion?.number || selectedQuestionIndex + 1}
                                </span>
                            </div>

                            <div className="surface-subtle p-4 mb-3 h-64 overflow-auto space-y-3 rounded-xl border border-slate-100 bg-slate-50/50">
                                {assistantMessages.length === 0 ? (
                                    <p className="text-sm text-slate-500 text-center mt-4">
                                        Example: “Fix this as Match the Column and keep Hindi question first.”
                                    </p>
                                ) : (
                                    assistantMessages.map((message) => (
                                        <div
                                            key={message.id}
                                            className={`rounded-2xl border px-4 py-3 shadow-sm ${message.role === "user"
                                                ? "border-blue-200 bg-blue-50 ml-8"
                                                : "border-slate-200 bg-white mr-8"
                                                }`}
                                        >
                                            <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-1.5">
                                                {message.role === "user" ? "You" : "AI"}
                                            </p>
                                            <p className="text-sm text-slate-800 leading-relaxed">{message.text}</p>
                                            {message.suggestion && (
                                                <div className="mt-3 flex items-center gap-3">
                                                    <button
                                                        className="btn btn-secondary text-xs py-1 px-3 shadow-sm bg-white"
                                                        onClick={() => applyAssistantSuggestion(message.id)}
                                                        disabled={Boolean(message.applied)}
                                                    >
                                                        {message.applied ? "Applied" : "Apply Suggestion"}
                                                    </button>
                                                    <span className="text-[11px] font-medium text-slate-500 bg-slate-100 px-2 py-0.5 rounded-md">
                                                        Structure: {getQuestionTypeLabel(message.suggestion.questionType)}
                                                    </span>
                                                </div>
                                            )}
                                        </div>
                                    ))
                                )}
                            </div>

                            <div className="space-y-2">
                                <textarea
                                    value={assistantPrompt}
                                    onChange={(e) => setAssistantPrompt(e.target.value)}
                                    onKeyDown={(e) => {
                                        if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                                            e.preventDefault();
                                            sendAssistantPrompt();
                                        }
                                    }}
                                    className="textarea min-h-[88px]"
                                    placeholder="Ask AI to correct the selected question..."
                                />
                                <div className="flex justify-end">
                                    <button
                                        className="btn btn-secondary"
                                        onClick={sendAssistantPrompt}
                                        disabled={isAssistantBusy || !assistantPrompt.trim() || !selectedQuestion}
                                    >
                                        {isAssistantBusy ? "Thinking..." : "Send to AI"}
                                    </button>
                                </div>
                            </div>
                        </article>
                    )}
                </section>
            )
            }

            {
                activeWorkspacePanel === "editor" && (
                    <section className="workspace-grid workspace-grid-single">
                        {activeWorkspacePanel === "editor" && (
                            <article className={`workspace-panel ${editorMode === "gallery" ? "workspace-panel-gallery" : ""}`}>
                                <div className="workspace-panel-header flex-col items-start gap-3 border-0 pt-3">

                                    {editorMode === "gallery" && (
                                        <div className="w-full">
                                            <div className="workspace-gallery-sticky-bar">
                                            <div className="flex items-center justify-between mb-2">
                                                <div>
                                                    <p className="text-xs font-bold uppercase tracking-wide text-slate-500">PDF Pages Generated ({sourceImages.length})</p>
                                                    <p className="text-[11px] text-slate-500 mt-0.5">
                                                        Select pages for extraction or drag them as a block to reorder. Batch extraction uses up to {DEFAULT_MAX_IMAGES_PER_BATCH} pages at once.
                                                    </p>
                                                </div>
                                                <div className="flex flex-wrap items-center justify-end gap-2">
                                                    <span className="tool-chip">
                                                        {selectedImageIndices.size > 0
                                                            ? `${selectedImageIndices.size} page(s) selected`
                                                            : "Drag pages to reorder"}
                                                    </span>
                                                    <span className="tool-chip">
                                                        Deck basket: {deckMergeBasketPageCount} page(s)
                                                    </span>
                                                    <button
                                                        type="button"
                                                        className="btn btn-secondary text-xs px-3 py-1.5"
                                                        onClick={addSelectedPagesToDeckBasket}
                                                        disabled={selectedImageIndices.size === 0}
                                                    >
                                                        Add Selected To Basket
                                                    </button>
                                                    <button
                                                        type="button"
                                                        className="btn btn-secondary text-xs px-3 py-1.5"
                                                        onClick={openDeckMergeModal}
                                                        disabled={deckMergeBasketPageCount === 0}
                                                    >
                                                        Send Basket To Deck
                                                    </button>
                                                    <button
                                                        type="button"
                                                        className="btn btn-secondary text-xs px-3 py-1.5"
                                                        onClick={() => moveSelectedPagesBy("up")}
                                                        disabled={selectedImageIndices.size === 0}
                                                    >
                                                        Move Selected Prev
                                                    </button>
                                                    <button
                                                        type="button"
                                                        className="btn btn-secondary text-xs px-3 py-1.5"
                                                        onClick={() => moveSelectedPagesBy("down")}
                                                        disabled={selectedImageIndices.size === 0}
                                                    >
                                                        Move Selected Next
                                                    </button>
                                                </div>
                                            </div>
                                            <p className="text-[11px] text-slate-500 mt-0.5">
                                                Drag one page or a selected page block to a new position. Question numbering updates automatically to match the new page order.
                                            </p>
                                            {deckMergeBasketPageCount > 0 && (
                                                <div className="mt-3 rounded-2xl border border-indigo-100 bg-indigo-50/70 px-4 py-3">
                                                    <div className="flex flex-wrap items-center justify-between gap-3">
                                                        <div className="space-y-1">
                                                            <p className="text-xs font-bold uppercase tracking-[0.24em] text-indigo-700">
                                                                Deck Basket Active
                                                            </p>
                                                            <p className="text-sm font-semibold text-slate-900">
                                                                {deckMergeBasketPageCount} page(s) from {deckMergeBasketWorkspaceCount} workspace(s) · {deckMergeBasketQuestionCount} question(s)
                                                            </p>
                                                        </div>
                                                        <div className="flex flex-wrap items-center gap-2">
                                                            <button
                                                                type="button"
                                                                className="btn btn-secondary text-xs px-3 py-1.5"
                                                                onClick={openDeckMergeModal}
                                                            >
                                                                Choose Target Deck
                                                            </button>
                                                            <button
                                                                type="button"
                                                                className="btn btn-ghost text-xs px-3 py-1.5"
                                                                onClick={clearDeckMergeBasket}
                                                            >
                                                                Clear Basket
                                                            </button>
                                                        </div>
                                                    </div>
                                                </div>
                                            )}
                                            </div>

                                            <div className="grid grid-cols-1 min-[480px]:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4 gap-4 mt-4 mb-4">
                                                {sourceImages.map((img, idx) => {
                                                    const relatedQuestions = pdfData.questions.filter(q => q.sourceImageName === img.imageName);
                                                    const questionCount = resolveSourceImageQuestionCount(img, relatedQuestions.length);
                                                    const extractionState = getSourceImageExtractionState(img, relatedQuestions.length);
                                                    const isSelected = selectedImageIndices.has(idx);
                                                    const isDragged = draggedPageIndices.includes(idx);
                                                    const isDropTarget = pageDropTargetIndex === idx && !isPageDropAtEnd && draggedPageIndices.length > 0;
                                                    const statusLabel =
                                                        extractionState === "extracted"
                                                            ? "Extracted"
                                                            : extractionState === "failed"
                                                                ? "Retry Needed"
                                                                : "Not Extracted";
                                                    return (
                                                        <div
                                                            key={idx}
                                                            onDragOver={(event) => {
                                                                event.preventDefault();
                                                                if (pageDropTargetIndex !== idx || isPageDropAtEnd) {
                                                                    setPageDropTargetIndex(idx);
                                                                    setIsPageDropAtEnd(false);
                                                                }
                                                            }}
                                                            onDrop={(event) => {
                                                                event.preventDefault();
                                                                event.stopPropagation();
                                                                handlePageDrop(idx);
                                                            }}
                                                            className={`border rounded-xl p-3 cursor-pointer relative group flex flex-col items-center transition-all shadow-sm ${isSelected ? "border-blue-500 bg-blue-50 ring-2 ring-blue-500/20" : "border-slate-200 hover:border-blue-400 bg-slate-50"} ${isDragged ? "opacity-70 scale-[0.985]" : ""} ${isDropTarget ? "ring-2 ring-indigo-400 border-indigo-500 bg-indigo-50/70" : ""}`}
                                                            onClick={() => {
                                                                setSelectedPageImageIndex(idx);
                                                                setEditorMode("detail");
                                                                if (relatedQuestions.length > 0) {
                                                                    const globalIndex = pdfData.questions.findIndex(q => q.sourceImageName === img.imageName);
                                                                    if (globalIndex !== -1) setSelectedQuestionIndex(globalIndex);
                                                                }
                                                            }}
                                                        >
                                                            <div className="absolute top-2 left-2 z-10" onClick={(e) => toggleImageSelection(idx, e)}>
                                                                <div className={`w-5 h-5 rounded flex items-center justify-center border transition-colors ${isSelected ? "bg-blue-600 border-blue-600" : "bg-white/90 border-slate-300 backdrop-blur-sm hover:border-blue-400"}`}>
                                                                    {isSelected && (
                                                                        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg">
                                                                            <path d="M10 3L4.5 8.5L2 6" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                                                                        </svg>
                                                                    )}
                                                                </div>
                                                            </div>
                                                            <button
                                                                className="absolute top-2 right-2 z-10 w-7 h-7 rounded-full bg-white/90 backdrop-blur-sm border border-slate-200 flex items-center justify-center text-slate-400 hover:text-red-600 hover:bg-red-50 hover:border-red-200 transition-colors opacity-0 group-hover:opacity-100 focus:opacity-100 shadow-sm"
                                                                onClick={(e) => removeSourceImage(idx, e)}
                                                                title="Remove Page"
                                                            >
                                                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                                                    <path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2M10 11v6M14 11v6" />
                                                                </svg>
                                                            </button>

                                                            <div
                                                                className="mb-2 flex w-full items-center justify-between rounded-lg border border-slate-200 bg-white/80 px-2.5 py-1.5 text-[10px] font-bold uppercase tracking-[0.2em] text-slate-500 cursor-grab active:cursor-grabbing"
                                                                draggable
                                                                onDragStart={(event) => {
                                                                    event.stopPropagation();
                                                                    event.dataTransfer.effectAllowed = "move";
                                                                    event.dataTransfer.setData("text/plain", img.imageName);
                                                                    handlePageDragStart(idx);
                                                                }}
                                                                onDragEnd={(event) => {
                                                                    event.stopPropagation();
                                                                    clearPageDragState();
                                                                }}
                                                                onClick={(event) => event.stopPropagation()}
                                                                title="Drag this page to reorder"
                                                            >
                                                                <span>Page {idx + 1}</span>
                                                                <span className="flex items-center gap-1.5 text-slate-600">
                                                                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                                                        <path d="M9 5L4 5L4 10" />
                                                                        <path d="M20 15L20 20L15 20" />
                                                                        <path d="M4 9L10 3" />
                                                                        <path d="M14 21L20 15" />
                                                                    </svg>
                                                                    Drag
                                                                </span>
                                                            </div>
                                                            <img
                                                                src={img.imagePath}
                                                                alt={img.imageName}
                                                                draggable={false}
                                                                className="w-full h-auto max-h-56 object-contain rounded-lg border border-slate-200 bg-white"
                                                            />
                                                            <div className="mt-3 text-center w-full flex flex-col gap-2.5">
                                                                <div className="space-y-1">
                                                                    <p className="text-xs font-semibold text-slate-700 truncate w-full">{img.imageName}</p>
                                                                    <p className="text-[10px] uppercase tracking-wide text-slate-500 font-semibold">
                                                                        {questionCount} Questions
                                                                    </p>
                                                                </div>
                                                                {extractionState === "extracted" ? (
                                                                    <div className="flex items-center justify-center gap-1.5 bg-emerald-50 border border-emerald-200 rounded-md px-2 py-1">
                                                                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-emerald-600">
                                                                            <path d="M20 6L9 17l-5-5" />
                                                                        </svg>
                                                                        <span className="text-[11px] font-semibold text-emerald-700">
                                                                            {statusLabel}
                                                                        </span>
                                                                    </div>
                                                                ) : extractionState === "failed" ? (
                                                                    <div className="flex flex-col gap-1.5 w-full">
                                                                        <div className="flex items-center justify-center gap-1.5 bg-red-50 border border-red-200 rounded-md px-2 py-1">
                                                                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-red-500">
                                                                                <path d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                                                                            </svg>
                                                                            <span className="text-[11px] font-semibold text-red-700">{statusLabel}</span>
                                                                        </div>
                                                                        {img.extractionError && (
                                                                            <p className="text-[10px] text-red-600 leading-4">{img.extractionError}</p>
                                                                        )}
                                                                        <button
                                                                            onClick={(e) => {
                                                                                e.stopPropagation();
                                                                                extractSingleImage(idx);
                                                                            }}
                                                                            disabled={isExtracting}
                                                                            className="btn btn-secondary text-[11px] py-1.5 w-full shadow-sm bg-red-50 text-red-600 hover:bg-red-100 hover:text-red-700 hover:shadow border-red-200 transition-all font-medium"
                                                                        >
                                                                            Retry Extract
                                                                        </button>
                                                                    </div>
                                                                ) : (
                                                                    <div className="flex flex-col gap-1.5 w-full">
                                                                        <div className="flex items-center justify-center gap-1.5 bg-amber-50 border border-amber-200 rounded-md px-2 py-1">
                                                                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-amber-600">
                                                                                <path d="M12 8v4m0 4h.01" />
                                                                                <circle cx="12" cy="12" r="10" />
                                                                            </svg>
                                                                            <span className="text-[11px] font-semibold text-amber-700">{statusLabel}</span>
                                                                        </div>
                                                                        <button
                                                                            onClick={(e) => {
                                                                                e.stopPropagation();
                                                                                extractSingleImage(idx);
                                                                            }}
                                                                            disabled={isExtracting}
                                                                            className="btn btn-secondary text-xs py-1.5 w-full shadow-sm bg-white hover:bg-slate-50 hover:shadow border-slate-200 transition-all font-medium"
                                                                        >
                                                                            Extract Single
                                                                        </button>
                                                                    </div>
                                                                )}
                                                            </div>
                                                        </div>
                                                    );
                                                })}
                                                {sourceImages.length > 0 && (
                                                    <div
                                                        className={`col-span-full rounded-2xl border-2 border-dashed px-4 py-4 text-center transition-all ${isPageDropAtEnd && draggedPageIndices.length > 0 ? "border-indigo-500 bg-indigo-50 text-indigo-700" : "border-slate-200 bg-white/70 text-slate-500"}`}
                                                        onDragOver={(event) => {
                                                            event.preventDefault();
                                                            if (!isPageDropAtEnd) {
                                                                setIsPageDropAtEnd(true);
                                                                setPageDropTargetIndex(null);
                                                            }
                                                        }}
                                                        onDragLeave={() => {
                                                            if (isPageDropAtEnd) {
                                                                setIsPageDropAtEnd(false);
                                                            }
                                                        }}
                                                        onDrop={(event) => {
                                                            event.preventDefault();
                                                            event.stopPropagation();
                                                            handlePageDropToEnd();
                                                        }}
                                                    >
                                                        <p className="text-xs font-bold uppercase tracking-[0.24em]">
                                                            Drop Here To Move To End
                                                        </p>
                                                        <p className="mt-1 text-[11px]">
                                                            Useful when you want the selected pages to go after the current last page.
                                                        </p>
                                                    </div>
                                                )}
                                                {sourceImages.length === 0 && (
                                                    <div className="col-span-full flex flex-col items-center justify-center p-12 bg-slate-50/50 rounded-xl border-2 border-slate-200 border-dashed text-center">
                                                        <div className="w-16 h-16 bg-white rounded-full flex items-center justify-center shadow-sm border border-slate-100 mb-4">
                                                            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-indigo-400">
                                                                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                                                                <polyline points="14 2 14 8 20 8"></polyline>
                                                                <line x1="16" y1="13" x2="8" y2="13"></line>
                                                                <line x1="16" y1="17" x2="8" y2="17"></line>
                                                                <polyline points="10 9 9 9 8 9"></polyline>
                                                            </svg>
                                                        </div>
                                                        <h3 className="text-lg font-semibold text-slate-900 mb-1">No pages yet</h3>
                                                        <p className="text-slate-500 text-sm max-w-sm">Upload a PDF document to generate page preview images. You can then extract questions from them.</p>
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    )}

                                    {editorMode !== "gallery" && (
                                        <>
                                            <div className="workspace-detail-toolbar">
                                                <div className="workspace-detail-toolbar-main">
                                                    <div className="workspace-detail-copy">
                                                        <p className="workspace-detail-label">Page Review</p>
                                                        <p className="workspace-detail-title">
                                                            {sourceImages[selectedPageImageIndex || 0]?.imageName || "Page details"}
                                                        </p>
                                                        <p className="workspace-detail-note">
                                                            Review extracted questions on this page, then switch only when you need structured or rich editing.
                                                        </p>
                                                    </div>

                                                    <div className="workspace-detail-switches">
                                                        <div className="workspace-detail-segment">
                                                            <button
                                                                type="button"
                                                                onClick={() => activateWorkspaceNavigatorItem("review")}
                                                                className={`workspace-detail-segment-btn ${detailViewMode === "review" ? "is-active" : ""}`}
                                                            >
                                                                Review
                                                            </button>
                                                            <button
                                                                type="button"
                                                                onClick={() => activateWorkspaceNavigatorItem("structured")}
                                                                className={`workspace-detail-segment-btn ${detailViewMode === "structured" ? "is-active" : ""}`}
                                                            >
                                                                Structured
                                                            </button>
                                                            <button
                                                                type="button"
                                                                onClick={() => activateWorkspaceNavigatorItem("rich")}
                                                                className={`workspace-detail-segment-btn ${detailViewMode === "rich" ? "is-active" : ""}`}
                                                            >
                                                                Rich
                                                            </button>
                                                        </div>
                                                    </div>
                                                </div>

                                                <div className="workspace-detail-toolbar-meta">
                                                    <span className="tool-chip">Page {selectedPageImageIndex !== null ? selectedPageImageIndex + 1 : "-"}</span>
                                                    <span className="tool-chip">Questions {selectedPageQuestionEntries.length}</span>
                                                    <span className="tool-chip">
                                                        Active {selectedQuestion ? `Q${selectedQuestion.number || selectedQuestionIndex + 1}` : "None"}
                                                    </span>
                                                    <span className="tool-chip">
                                                        {detailViewMode === "rich"
                                                            ? "Rich Editor"
                                                            : detailViewMode === "review"
                                                                ? "Review"
                                                                : "Structured"}
                                                    </span>
                                                    <span className="tool-chip">Duplicates {duplicateAnalysis.duplicateQuestionCount}</span>
                                                </div>

                                                {editorMode === "detail" && selectedPageImage && selectedPageQuestionCount === 0 && (
                                                    <div className="workspace-detail-warning">
                                                        This page is not extracted yet. Run extraction to generate editable questions.
                                                    </div>
                                                )}
                                            </div>

                                            {duplicateAnalysis.groups.length > 0 && (
                                                <div className="workspace-detail-duplicates">
                                                    <p className="text-[11px] font-bold uppercase tracking-wide text-rose-700 mb-1">
                                                        Duplicate Groups ({duplicateAnalysis.groups.length})
                                                    </p>
                                                    <div className="flex flex-wrap gap-2">
                                                        {duplicateAnalysis.groups.map((group, groupIndex) => (
                                                            <button
                                                                key={`${group.signature}-${groupIndex}`}
                                                                type="button"
                                                                className="btn btn-ghost text-xs border border-rose-200 bg-white whitespace-nowrap"
                                                                onClick={() => {
                                                                    const nextIndex = group.indices[0];
                                                                    setSelectedQuestionIndex(nextIndex);
                                                                    if (editorMode === "detail") {
                                                                        const nextQuestion = pdfData.questions[nextIndex];
                                                                        const pageIndex = sourceImages.findIndex(
                                                                            (image) => image.imageName === nextQuestion?.sourceImageName
                                                                        );
                                                                        if (pageIndex !== -1) {
                                                                            setSelectedPageImageIndex(pageIndex);
                                                                        }
                                                                    }
                                                                }}
                                                            >
                                                                {group.indices
                                                                    .map((questionIndex) => `Q${pdfData.questions[questionIndex]?.number || questionIndex + 1}`)
                                                                    .join(" ↔ ")}
                                                            </button>
                                                        ))}
                                                    </div>
                                                </div>
                                            )}
                                        </>
                                    )}
                                </div>

                                {editorMode !== "gallery" && (
                                    <div className="workspace-review-shell" style={{ minHeight: 0 }}>
                                        {editorMode === "detail" && selectedPageImageIndex !== null && sourceImages[selectedPageImageIndex] && (
                                            <div
                                                className="workspace-page-viewer-panel"
                                                style={{
                                                    maxHeight: reviewViewportMaxHeight,
                                                    top: `${stickyWorkspaceTopPx + 8}px`,
                                                }}
                                            >
                                                <div className="workspace-page-viewer-body">
                                                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                                                        <p className="text-xs font-bold uppercase tracking-wide text-slate-500">Original Page Viewer</p>
                                                        <div className="flex flex-wrap items-center gap-2">
                                                            <span className="text-[10px] font-semibold px-2.5 py-1 bg-white text-slate-600 rounded-md border border-slate-200 shadow-sm">
                                                                {sourceImages[selectedPageImageIndex].imageName}
                                                            </span>
                                                            <span
                                                                className={`text-[10px] font-semibold px-2.5 py-1 rounded-md border shadow-sm ${
                                                                    selectedPageStatus === "extracted"
                                                                        ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                                                                        : selectedPageStatus === "failed"
                                                                            ? "bg-red-50 text-red-700 border-red-200"
                                                                            : "bg-amber-50 text-amber-700 border-amber-200"
                                                                }`}
                                                            >
                                                                {selectedPageStatus === "extracted"
                                                                    ? "Extracted"
                                                                    : selectedPageStatus === "failed"
                                                                        ? "Retry Needed"
                                                                        : "Not Extracted"}
                                                            </span>
                                                        </div>
                                                    </div>
                                                    <div className="workspace-page-image-frame group">
                                                        <div className="absolute inset-0 bg-slate-900/5 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none rounded-2xl"></div>
                                                        <div
                                                            ref={pageViewerRef}
                                                            className={`relative w-full h-full overflow-auto ${(activeMarkTool || isCropMode) && Math.abs(pageZoom - 1) < 0.001 ? "cursor-crosshair" : "cursor-default"}`}
                                                            onPointerDown={handlePageViewerPointerDown}
                                                            onPointerMove={handlePageViewerPointerMove}
                                                            onPointerUp={handlePageViewerPointerUp}
                                                            onPointerCancel={handlePageViewerPointerUp}
                                                        >
                                                            <div
                                                                className="relative rounded-xl overflow-hidden mx-auto my-auto"
                                                                style={{
                                                                    width: `${pageZoom * 100}%`,
                                                                    height: `${pageZoom * 100}%`,
                                                                }}
                                                            >
                                                                <img
                                                                    src={sourceImages[selectedPageImageIndex].imagePath}
                                                                    alt="Page Preview"
                                                                    className="w-full h-full object-contain rounded-xl select-none pointer-events-none"
                                                                    draggable={false}
                                                                />
                                                                <div className="absolute inset-0 pointer-events-none rounded-xl">
                                                                    {selectedPageMarks.map((mark) => (
                                                                        <button
                                                                            key={mark.id}
                                                                            type="button"
                                                                            className={`absolute pointer-events-auto ${selectedMarkId === mark.id ? "ring-2 ring-amber-400" : ""}`}
                                                                            style={{
                                                                                left: `${mark.x * 100}%`,
                                                                                top: `${mark.y * 100}%`,
                                                                                width: `${mark.width * 100}%`,
                                                                                height: `${mark.height * 100}%`,
                                                                                border: `2px solid ${mark.status === "resolved" ? "#16a34a" : "#f59e0b"}`,
                                                                                borderRadius: mark.shape === "circle" ? "999px" : "8px",
                                                                                background: "rgba(245, 158, 11, 0.08)",
                                                                            }}
                                                                            onClick={(event) => {
                                                                                event.preventDefault();
                                                                                event.stopPropagation();
                                                                                setSelectedMarkId(mark.id);
                                                                            }}
                                                                            onPointerDown={(event) => event.stopPropagation()}
                                                                            title={mark.note || "Correction mark"}
                                                                        />
                                                                    ))}
                                                                    {draftMark && (() => {
                                                                        const normalizedDraft = normalizeDraftRect(draftMark);
                                                                        return (
                                                                            <div
                                                                                className="absolute"
                                                                                style={{
                                                                                    left: `${normalizedDraft.x * 100}%`,
                                                                                    top: `${normalizedDraft.y * 100}%`,
                                                                                    width: `${normalizedDraft.width * 100}%`,
                                                                                    height: `${normalizedDraft.height * 100}%`,
                                                                                    border: "2px dashed #2563eb",
                                                                                    borderRadius: normalizedDraft.shape === "circle" ? "999px" : "8px",
                                                                                    background: "rgba(37, 99, 235, 0.1)",
                                                                                }}
                                                                            />
                                                                        );
                                                                    })()}
                                                                    {draftCropRect && (() => {
                                                                        const normalizedDraft = normalizeDraftRect(draftCropRect);
                                                                        return (
                                                                            <div
                                                                                className="absolute"
                                                                                style={{
                                                                                    left: `${normalizedDraft.x * 100}%`,
                                                                                    top: `${normalizedDraft.y * 100}%`,
                                                                                    width: `${normalizedDraft.width * 100}%`,
                                                                                    height: `${normalizedDraft.height * 100}%`,
                                                                                    border: "2px dashed #0ea5e9",
                                                                                    borderRadius: "8px",
                                                                                    background: "rgba(14, 165, 233, 0.15)",
                                                                                }}
                                                                            />
                                                                        );
                                                                    })()}
                                                                    {pendingCropRect && (() => {
                                                                        const normalizedCrop = normalizeDraftRect(pendingCropRect);
                                                                        return (
                                                                            <div
                                                                                className="absolute"
                                                                                style={{
                                                                                    left: `${normalizedCrop.x * 100}%`,
                                                                                    top: `${normalizedCrop.y * 100}%`,
                                                                                    width: `${normalizedCrop.width * 100}%`,
                                                                                    height: `${normalizedCrop.height * 100}%`,
                                                                                    border: "2px solid #059669",
                                                                                    borderRadius: "8px",
                                                                                    background: "rgba(16, 185, 129, 0.12)",
                                                                                }}
                                                                            />
                                                                        );
                                                                    })()}
                                                                </div>
                                                            </div>
                                                        </div>
                                                    </div>
                                                    {selectedPageStatus !== "extracted" && (
                                                        <div
                                                            className={`rounded-2xl border px-4 py-3 ${
                                                                selectedPageStatus === "failed"
                                                                    ? "border-red-200 bg-red-50/80"
                                                                    : "border-amber-200 bg-amber-50/80"
                                                            }`}
                                                        >
                                                            <p
                                                                className={`text-xs font-bold uppercase tracking-wide ${
                                                                    selectedPageStatus === "failed" ? "text-red-700" : "text-amber-700"
                                                                }`}
                                                            >
                                                                {selectedPageStatus === "failed" ? "Extraction needs retry" : "Page not extracted yet"}
                                                            </p>
                                                            <p
                                                                className={`text-sm mt-1 leading-6 ${
                                                                    selectedPageStatus === "failed" ? "text-red-700" : "text-amber-800"
                                                                }`}
                                                            >
                                                                {sourceImages[selectedPageImageIndex].extractionError ||
                                                                    "This page does not have extracted questions yet. Run extraction to populate the editor."}
                                                            </p>
                                                        </div>
                                                    )}
                                                    {editorMode === "detail" && selectedPageMarks.length > 0 && (
                                                        <div className="surface-subtle p-3">
                                                            <p className="text-xs font-bold text-slate-600 uppercase tracking-wide mb-2">
                                                                Typo Marks ({selectedPageMarks.length})
                                                            </p>
                                                            <div className="max-h-44 overflow-auto space-y-2">
                                                                {selectedPageMarks.map((mark, index) => (
                                                                    <button
                                                                        key={mark.id}
                                                                        type="button"
                                                                        className={`w-full text-left p-2 rounded-lg border ${selectedMarkId === mark.id
                                                                            ? "border-indigo-300 bg-indigo-50"
                                                                            : "border-slate-200 bg-white"
                                                                            }`}
                                                                        onClick={() => setSelectedMarkId(mark.id)}
                                                                    >
                                                                        <p className="text-[11px] font-semibold text-slate-700">
                                                                            Mark {index + 1} • {mark.shape === "circle" ? "Circle" : "Rectangle"} • {mark.status}
                                                                        </p>
                                                                        <p className="text-[10px] text-slate-500 mt-1">
                                                                            {mark.createdByName || "Staff"} • {new Date(mark.createdAt).toLocaleString("en-IN")}
                                                                        </p>
                                                                        {mark.note && (
                                                                            <p className="text-[11px] text-slate-600 mt-1 line-clamp-2">{mark.note}</p>
                                                                        )}
                                                                        {mark.selectedText && (
                                                                            <p className="text-[11px] text-indigo-700 mt-1 line-clamp-2">
                                                                                Replace: {mark.selectedText}
                                                                                {mark.replacementText ? ` → ${mark.replacementText}` : ""}
                                                                            </p>
                                                                        )}
                                                                    </button>
                                                                ))}
                                                            </div>

                                                            {selectedMark && (
                                                                <div className="mt-3 border-t border-slate-200 pt-3 space-y-2">
                                                                    <textarea
                                                                        value={markNoteDraft}
                                                                        onChange={(event) => setMarkNoteDraft(event.target.value)}
                                                                        placeholder="Add correction note (typo details, expected text, etc.)"
                                                                        className="textarea min-h-[72px]"
                                                                    />
                                                                    <input
                                                                        type="text"
                                                                        value={selectedMark.selectedText || ""}
                                                                        onChange={(event) => {
                                                                            const value = event.target.value;
                                                                            setCorrectionMarks((prev) =>
                                                                                prev.map((mark) =>
                                                                                    mark.id === selectedMark.id
                                                                                        ? { ...mark, selectedText: value }
                                                                                        : mark
                                                                                )
                                                                            );
                                                                        }}
                                                                        className="input"
                                                                        placeholder="Selected text to replace"
                                                                    />
                                                                    <input
                                                                        type="text"
                                                                        value={selectedMark.replacementText || ""}
                                                                        onChange={(event) => {
                                                                            const value = event.target.value;
                                                                            setCorrectionMarks((prev) =>
                                                                                prev.map((mark) =>
                                                                                    mark.id === selectedMark.id
                                                                                        ? { ...mark, replacementText: value }
                                                                                        : mark
                                                                                )
                                                                            );
                                                                        }}
                                                                        className="input"
                                                                        placeholder="Replacement text"
                                                                    />
                                                                    <div className="flex flex-wrap items-center gap-2">
                                                                        <button
                                                                            type="button"
                                                                            className="btn btn-secondary text-xs"
                                                                            onClick={saveSelectedMarkNote}
                                                                        >
                                                                            Save Note
                                                                        </button>
                                                                        <button
                                                                            type="button"
                                                                            className="btn btn-ghost text-xs"
                                                                            onClick={attachSelectedTextToMark}
                                                                        >
                                                                            Use Selected Word
                                                                        </button>
                                                                        <button
                                                                            type="button"
                                                                            className="btn btn-secondary text-xs"
                                                                            onClick={applySelectedMarkReplacement}
                                                                        >
                                                                            Replace in Question
                                                                        </button>
                                                                        {canReviewCorrectionMarks && (
                                                                            <button
                                                                                type="button"
                                                                                className="btn btn-ghost text-xs"
                                                                                onClick={toggleSelectedMarkStatus}
                                                                            >
                                                                                {selectedMark.status === "resolved" ? "Mark Open" : "Mark Resolved"}
                                                                            </button>
                                                                        )}
                                                                        <button
                                                                            type="button"
                                                                            className="btn btn-danger text-xs"
                                                                            onClick={deleteSelectedMark}
                                                                        >
                                                                            Remove Mark
                                                                        </button>
                                                                    </div>
                                                                </div>
                                                            )}
                                                        </div>
                                                    )}
                                                    <button
                                                        onClick={() => extractSingleImage(selectedPageImageIndex)}
                                                        disabled={isExtracting}
                                                        className="btn btn-primary w-full shadow-md bg-indigo-600 hover:bg-indigo-700 border-transparent py-2.5 transition-transform hover:-translate-y-0.5"
                                                    >
                                                        {isExtracting ? (
                                                            <span className="flex items-center justify-center gap-2"><span className="spinner border-white" /> Extracting...</span>
                                                        ) : selectedPageStatus === "failed" ? "Retry AI Extraction" : "Run AI Extraction"}
                                                    </button>
                                                </div>
                                            </div>
                                        )}
                                        <div
                                            className="workspace-review-panel"
                                            style={{ maxHeight: reviewViewportMaxHeight }}
                                        >
                                            {detailViewMode === "review" ? (
                                                <div className="space-y-4">
                                                    <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-sm">
                                                        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                                                            <div>
                                                                <p className="text-xs font-bold uppercase tracking-wide text-slate-500">
                                                                    Review Workspace
                                                                </p>
                                                                <p className="text-[11px] text-slate-500 mt-1">
                                                                    Audit all extracted questions for this page, then open only the item that needs structured or rich editing.
                                                                </p>
                                                            </div>
                                                            <div className="flex flex-wrap gap-2">
                                                                <span className="tool-chip">Page: {selectedPageImageIndex !== null ? selectedPageImageIndex + 1 : "-"}</span>
                                                                <span className="tool-chip">Questions: {selectedPageQuestionEntries.length}</span>
                                                                <span className="tool-chip">
                                                                    Visible: {reviewQuestionRangeStart}-{reviewQuestionRangeEnd}
                                                                </span>
                                                                <span className="tool-chip">Duplicates: {duplicateAnalysis.duplicateQuestionCount}</span>
                                                            </div>
                                                        </div>
                                                    </div>

                                                    {editorMode === "detail" && selectedPageStatus !== "extracted" ? (
                                                        <div className="rounded-2xl border border-dashed border-amber-300 bg-white px-6 py-10 text-center">
                                                            <h3 className="text-lg font-bold text-slate-900">Review is unavailable for this page</h3>
                                                            <p className="mt-2 text-sm text-slate-600 max-w-lg mx-auto">
                                                                Extract this page first so the workspace can build the page-level review cards.
                                                            </p>
                                                            <button
                                                                type="button"
                                                                onClick={() => selectedPageImageIndex !== null && extractSingleImage(selectedPageImageIndex)}
                                                                disabled={isExtracting || selectedPageImageIndex === null}
                                                                className="btn btn-primary mt-5 bg-indigo-600 hover:bg-indigo-700 border-transparent"
                                                            >
                                                                {isExtracting ? "Extracting..." : selectedPageStatus === "failed" ? "Retry Extraction" : "Extract This Page"}
                                                            </button>
                                                        </div>
                                                    ) : scopedPageQuestionEntries.length > 0 ? (
                                                        <>
                                                            <div className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-sm md:flex-row md:items-center md:justify-between">
                                                                <div>
                                                                    <p className="text-xs font-bold uppercase tracking-wide text-slate-500">
                                                                        Review Window
                                                                    </p>
                                                                    <p className="text-[11px] text-slate-500 mt-1">
                                                                        Rendering {reviewQuestionRangeStart}-{reviewQuestionRangeEnd} of {scopedPageQuestionEntries.length} question(s) in the active output view.
                                                                    </p>
                                                                </div>
                                                                <div className="flex flex-wrap items-center gap-2">
                                                                    <span className="tool-chip">
                                                                        {getOutputLanguageLabel(outputLanguageMode)}
                                                                    </span>
                                                                    <span className="tool-chip">
                                                                        {getOutputScopeLabel(outputQuestionScope, selectedQuestionIndex, outputRangeStart, outputRangeEnd)}
                                                                    </span>
                                                                    <button
                                                                        type="button"
                                                                        className="btn btn-secondary text-xs"
                                                                        disabled={activeReviewQuestionPage <= 1}
                                                                        onClick={() =>
                                                                            setReviewQuestionPage((current) => Math.max(1, current - 1))
                                                                        }
                                                                    >
                                                                        Previous Set
                                                                    </button>
                                                                    <span className="tool-chip">
                                                                        Set {activeReviewQuestionPage}/{reviewQuestionTotalPages}
                                                                    </span>
                                                                    <button
                                                                        type="button"
                                                                        className="btn btn-secondary text-xs"
                                                                        disabled={activeReviewQuestionPage >= reviewQuestionTotalPages}
                                                                        onClick={() =>
                                                                            setReviewQuestionPage((current) =>
                                                                                Math.min(reviewQuestionTotalPages, current + 1)
                                                                            )
                                                                        }
                                                                    >
                                                                        Next Set
                                                                    </button>
                                                                </div>
                                                            </div>

                                                            {visibleReviewQuestionEntries.map(({ question, index }) => {
                                                            const duplicateInfo = duplicateAnalysis.byIndex[index];
                                                            const isActiveQuestion = index === selectedQuestionIndex;
                                                            const localizedQuestion = applyLanguageModeToQuestion(
                                                                question,
                                                                outputLanguageMode
                                                            );
                                                            const questionText =
                                                                localizedQuestion.questionHindi ||
                                                                localizedQuestion.questionEnglish ||
                                                                "Question text unavailable";

                                                            return (
                                                                <article
                                                                    key={question.clientId || `${question.number}-${index}`}
                                                                    className={`rounded-2xl border bg-white p-4 shadow-sm transition-all ${isActiveQuestion
                                                                        ? "border-indigo-300 shadow-[0_16px_36px_-28px_rgba(79,70,229,0.55)]"
                                                                        : "border-slate-200"
                                                                        }`}
                                                                >
                                                                    <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                                                                        <div className="space-y-2">
                                                                            <div className="flex flex-wrap items-center gap-2">
                                                                                <span className="text-sm font-extrabold text-slate-900">
                                                                                    Q{question.number || index + 1}
                                                                                </span>
                                                                                <span className="rounded-full border border-indigo-100 bg-indigo-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-indigo-700">
                                                                                    {getQuestionTypeLabel(question.questionType)}
                                                                                </span>
                                                                                {localizedQuestion.answer && (
                                                                                    <span className="rounded-full border border-emerald-100 bg-emerald-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-emerald-700">
                                                                                        Answer: {localizedQuestion.answer}
                                                                                    </span>
                                                                                )}
                                                                                {(localizedQuestion.diagramImagePath || localizedQuestion.autoDiagramImagePath) && (
                                                                                    <span className="rounded-full border border-amber-100 bg-amber-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-amber-700">
                                                                                        Diagram
                                                                                    </span>
                                                                                )}
                                                                                {duplicateInfo && (
                                                                                    <span className="rounded-full border border-rose-100 bg-rose-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-rose-700">
                                                                                        Duplicate group
                                                                                    </span>
                                                                                )}
                                                                            </div>
                                                                            <p className="text-sm font-semibold leading-6 text-slate-900 whitespace-pre-wrap">
                                                                                {questionText}
                                                                            </p>
                                                                            {outputLanguageMode === "both" &&
                                                                                localizedQuestion.questionEnglish &&
                                                                                localizedQuestion.questionEnglish !== localizedQuestion.questionHindi && (
                                                                                    <p className="text-sm leading-6 text-slate-600 whitespace-pre-wrap">
                                                                                        {localizedQuestion.questionEnglish}
                                                                                    </p>
                                                                                )}
                                                                        </div>

                                                                        <div className="flex flex-wrap gap-2 lg:max-w-[320px] lg:justify-end">
                                                                            <button
                                                                                type="button"
                                                                                className={`btn text-xs ${isActiveQuestion ? "btn-secondary" : "btn-ghost"}`}
                                                                                onClick={() => {
                                                                                    setSelectedQuestionIndex(index);
                                                                                    setBottomNavigatorScope("pages");
                                                                                }}
                                                                            >
                                                                                Focus
                                                                            </button>
                                                                            <button
                                                                                type="button"
                                                                                className="btn btn-secondary text-xs"
                                                                                onClick={() => {
                                                                                    setSelectedQuestionIndex(index);
                                                                                    activateWorkspaceNavigatorItem("structured");
                                                                                }}
                                                                            >
                                                                                Structured
                                                                            </button>
                                                                            <button
                                                                                type="button"
                                                                                className="btn btn-secondary text-xs"
                                                                                onClick={() => {
                                                                                    setSelectedQuestionIndex(index);
                                                                                    activateWorkspaceNavigatorItem("rich");
                                                                                }}
                                                                            >
                                                                                Rich Edit
                                                                            </button>
                                                                            <button
                                                                                type="button"
                                                                                className="btn btn-ghost text-xs"
                                                                                onClick={() => {
                                                                                    setSelectedQuestionIndex(index);
                                                                                    setIsAiChatPopupOpen(true);
                                                                                }}
                                                                            >
                                                                                AI Chat
                                                                            </button>
                                                                            <button
                                                                                type="button"
                                                                                className="btn btn-danger text-xs"
                                                                                onClick={() => requestRemoveQuestion(index)}
                                                                            >
                                                                                Delete
                                                                            </button>
                                                                        </div>
                                                                    </div>

                                                                    {(isOptionType(localizedQuestion.questionType) || localizedQuestion.questionType === "MATCH_COLUMN") &&
                                                                        localizedQuestion.options?.length > 0 && (
                                                                            <div className="mt-4 flex flex-wrap gap-2">
                                                                                {localizedQuestion.options.map((option, optionIndex) => (
                                                                                    <div
                                                                                        key={`${localizedQuestion.clientId || localizedQuestion.number}-option-${optionIndex}`}
                                                                                        className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700"
                                                                                    >
                                                                                        <span className="font-bold text-slate-500">
                                                                                            {optionIndex + 1}.
                                                                                        </span>{" "}
                                                                                        {option.hindi || option.english}
                                                                                        {option.english && option.english !== option.hindi
                                                                                            ? ` / ${option.english}`
                                                                                            : ""}
                                                                                    </div>
                                                                                ))}
                                                                            </div>
                                                                        )}

                                                                    {localizedQuestion.questionType === "MATCH_COLUMN" &&
                                                                        localizedQuestion.matchColumns && (
                                                                            <div className="mt-4 grid gap-3 md:grid-cols-2">
                                                                                <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                                                                                    <p className="text-[11px] font-bold uppercase tracking-wide text-slate-500">
                                                                                        Column I
                                                                                    </p>
                                                                                    <div className="mt-2 space-y-1 text-sm text-slate-700">
                                                                                        {localizedQuestion.matchColumns.left.map((entry, entryIndex) => (
                                                                                            <p key={`left-${entryIndex}`}>
                                                                                                {entry.hindi || entry.english}
                                                                                            </p>
                                                                                        ))}
                                                                                    </div>
                                                                                </div>
                                                                                <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                                                                                    <p className="text-[11px] font-bold uppercase tracking-wide text-slate-500">
                                                                                        Column II
                                                                                    </p>
                                                                                    <div className="mt-2 space-y-1 text-sm text-slate-700">
                                                                                        {localizedQuestion.matchColumns.right.map((entry, entryIndex) => (
                                                                                            <p key={`right-${entryIndex}`}>
                                                                                                {entry.hindi || entry.english}
                                                                                            </p>
                                                                                        ))}
                                                                                    </div>
                                                                                </div>
                                                                            </div>
                                                                        )}

                                                                    <div className="mt-4 flex flex-wrap gap-2">
                                                                        {typeof question.extractionConfidence === "number" && (
                                                                            <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-1 text-[11px] font-semibold text-slate-600">
                                                                                Confidence: {Math.round(question.extractionConfidence * 100)}%
                                                                            </span>
                                                                        )}
                                                                        <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-1 text-[11px] font-semibold text-slate-600">
                                                                            Source: {question.sourceImageName || "Unknown page"}
                                                                        </span>
                                                                        {duplicateInfo && (
                                                                            <button
                                                                                type="button"
                                                                                className="rounded-full border border-rose-200 bg-rose-50 px-2 py-1 text-[11px] font-semibold text-rose-700"
                                                                                onClick={() => {
                                                                                    setSelectedQuestionIndex(duplicateInfo.canonicalIndex);
                                                                                    setBottomNavigatorScope("pages");
                                                                                }}
                                                                            >
                                                                                Go canonical Q{pdfData.questions[duplicateInfo.canonicalIndex]?.number || duplicateInfo.canonicalIndex + 1}
                                                                            </button>
                                                                        )}
                                                                    </div>
                                                                </article>
                                                            );
                                                            })}
                                                        </>
                                                    ) : (
                                                        <div className="empty-state">
                                                            <h3>No questions in this output view</h3>
                                                            <p className="text-sm">
                                                                Change the language or question scope, or switch to another page to review matching questions.
                                                            </p>
                                                        </div>
                                                    )}
                                                </div>
                                            ) : detailViewMode === "structured" ? (
                                                <>
                                                    <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-6 mb-8 bg-white p-5 rounded-2xl border border-slate-200 shadow-sm">
                                                        <div>
                                                            <label className="text-xs font-bold text-slate-500 uppercase tracking-wider block mb-2">Deck Title</label>
                                                            <input
                                                                type="text"
                                                                value={pdfData.title}
                                                                onChange={(e) => updatePdfDocumentMetaField("title", e.target.value)}
                                                                className="input bg-slate-50 shadow-inner border-slate-200 focus:bg-white focus:ring-indigo-500 focus:border-indigo-500 px-4 py-2.5 rounded-xl transition-all"
                                                            />
                                                        </div>
                                                        <div>
                                                            <label className="text-xs font-bold text-slate-600 uppercase tracking-wide block mb-1.5">Institute Name</label>
                                                            <input
                                                                type="text"
                                                                value={pdfData.instituteName}
                                                                onChange={(e) => updatePdfDocumentMetaField("instituteName", e.target.value)}
                                                                className="input bg-white shadow-sm border-slate-200 focus:ring-blue-500"
                                                                placeholder={organizationName || "Enter institute name"}
                                                            />
                                                        </div>
                                                        <div>
                                                            <label className="text-xs font-bold text-slate-600 uppercase tracking-wide block mb-1.5">Date</label>
                                                            <input
                                                                type="text"
                                                                value={pdfData.date}
                                                                onChange={(e) => updatePdfDocumentMetaField("date", e.target.value)}
                                                                className="input bg-white shadow-sm border-slate-200 focus:ring-blue-500"
                                                            />
                                                        </div>
                                                    </div>

                                                    {editorMode === "detail" && selectedPageStatus !== "extracted" ? (
                                                        <div className="rounded-2xl border border-dashed border-amber-300 bg-white px-6 py-10 text-center">
                                                            <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-amber-100 text-amber-700">
                                                                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                                                                    <path d="M12 8v4m0 4h.01" />
                                                                    <circle cx="12" cy="12" r="10" />
                                                                </svg>
                                                            </div>
                                                            <h3 className="text-lg font-bold text-slate-900">Page not extracted yet</h3>
                                                            <p className="mt-2 text-sm text-slate-600 max-w-lg mx-auto">
                                                                {selectedPageStatus === "failed"
                                                                    ? selectedPageImage?.extractionError || "The last extraction attempt did not return usable questions. Retry extraction for this page."
                                                                    : "This page has not been extracted yet. Please run extraction to populate structured fields."}
                                                            </p>
                                                            <button
                                                                type="button"
                                                                onClick={() => selectedPageImageIndex !== null && extractSingleImage(selectedPageImageIndex)}
                                                                disabled={isExtracting || selectedPageImageIndex === null}
                                                                className="btn btn-primary mt-5 bg-indigo-600 hover:bg-indigo-700 border-transparent"
                                                            >
                                                                {isExtracting ? "Extracting..." : selectedPageStatus === "failed" ? "Retry Extraction" : "Extract This Page"}
                                                            </button>
                                                        </div>
                                                    ) : selectedQuestion ? (
                                                        <>
                                                            <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm mb-5 flex flex-wrap items-center gap-4 justify-between relative overflow-hidden">
                                                                <div className="absolute left-0 top-0 bottom-0 w-1 bg-indigo-500"></div>
                                                                <div className="pl-2">
                                                                    <div className="flex items-center gap-2 mb-1">
                                                                        <p className="text-lg font-extrabold text-slate-900 tracking-tight">
                                                                            Question {selectedQuestion.number || selectedQuestionIndex + 1}
                                                                        </p>
                                                                        <span className="px-2 py-0.5 bg-indigo-50 text-indigo-700 text-[10px] font-bold uppercase tracking-wider rounded border border-indigo-100">
                                                                            {getQuestionTypeLabel(selectedQuestion.questionType)}
                                                                        </span>
                                                                    </div>
                                                                    <p className="text-xs font-medium text-slate-500">
                                                                        Source: {selectedQuestion.sourceImageName || "Unknown Page"}
                                                                    </p>
                                                                </div>
                                                            </div>

                                                            {selectedDuplicateInfo && (
                                                                <div className="mb-4 rounded-xl border border-rose-200 bg-rose-50/70 p-3">
                                                                    <p className="text-xs font-bold uppercase tracking-wide text-rose-700">
                                                                        Duplicate detected
                                                                    </p>
                                                                    <p className="text-xs text-rose-700 mt-1">
                                                                        This question matches {selectedDuplicateInfo.peers.length} other item(s) with same structure and options.
                                                                    </p>
                                                                    <div className="flex flex-wrap items-center gap-2 mt-2">
                                                                        {selectedDuplicateInfo.peers.map((peerIndex) => (
                                                                            <button
                                                                                key={peerIndex}
                                                                                type="button"
                                                                                className="btn btn-ghost text-xs border border-rose-200 bg-white whitespace-nowrap"
                                                                                onClick={() => setSelectedQuestionIndex(peerIndex)}
                                                                            >
                                                                                Go Q{pdfData.questions[peerIndex]?.number || peerIndex + 1}
                                                                            </button>
                                                                        ))}
                                                                        <button
                                                                            type="button"
                                                                            className="btn btn-danger text-xs whitespace-nowrap"
                                                                            onClick={() => requestRemoveQuestion(selectedQuestionIndex)}
                                                                        >
                                                                            Delete Current Duplicate
                                                                        </button>
                                                                    </div>
                                                                </div>
                                                            )}

                                                            {selectedQuestion.diagramImagePath && (
                                                                <div className="surface-subtle p-2 mb-4">
                                                                    <p className="text-xs text-slate-600 mb-1">Diagram (slide)</p>
                                                                    <img
                                                                        src={selectedQuestion.diagramImagePath}
                                                                        alt="Diagram"
                                                                        className="w-full h-44 object-contain rounded-lg bg-white"
                                                                    />
                                                                    {selectedQuestion.diagramBounds && (
                                                                        <p className="text-[10px] text-slate-500 mt-1">
                                                                            Auto bounds: x {selectedQuestion.diagramBounds.x.toFixed(2)} | y{" "}
                                                                            {selectedQuestion.diagramBounds.y.toFixed(2)} | w{" "}
                                                                            {selectedQuestion.diagramBounds.width.toFixed(2)} | h{" "}
                                                                            {selectedQuestion.diagramBounds.height.toFixed(2)}
                                                                        </p>
                                                                    )}
                                                                </div>
                                                            )}

                                                            <div className="space-y-4">
                                                                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                                                                    <div>
                                                                        <label className="text-xs font-bold text-slate-500 uppercase tracking-wider block mb-2">Question Number</label>
                                                                        <input
                                                                            type="text"
                                                                            value={selectedQuestion.number || ""}
                                                                            readOnly
                                                                            className="input bg-slate-50 shadow-inner border-slate-200 focus:bg-white focus:ring-indigo-500 focus:border-indigo-500 border-2 border-transparent transition-all"
                                                                            placeholder="Auto-managed"
                                                                        />
                                                                        <p className="text-[11px] text-slate-500 mt-2">
                                                                            Question numbering is automatic and follows the current question/page order. Rearrange pages in Pages Gallery to resequence numbering.
                                                                        </p>
                                                                    </div>
                                                                    <div>
                                                                        <label className="text-xs font-bold text-slate-500 uppercase tracking-wider block mb-2">Question Type</label>
                                                                        <select
                                                                            value={selectedQuestion.questionType || "UNKNOWN"}
                                                                            onChange={(e) => updateQuestionType(e.target.value as QuestionType)}
                                                                            className="select bg-slate-50 shadow-inner border-slate-200 focus:bg-white focus:ring-indigo-500 focus:border-indigo-500 border-2 border-transparent transition-all"
                                                                        >
                                                                            {QUESTION_TYPE_OPTIONS.map((option) => (
                                                                                <option key={option.value} value={option.value}>
                                                                                    {option.label}
                                                                                </option>
                                                                            ))}
                                                                        </select>
                                                                    </div>
                                                                    <div>
                                                                        <label className="text-xs font-bold text-slate-500 uppercase tracking-wider block mb-2">Answer</label>
                                                                        <input
                                                                            type="text"
                                                                            value={selectedQuestion.answer || ""}
                                                                            onChange={(e) => updateQuestionField("answer", e.target.value)}
                                                                            className="input bg-slate-50 shadow-inner border-slate-200 focus:bg-white focus:ring-indigo-500 focus:border-indigo-500 border-2 border-transparent transition-all"
                                                                            placeholder="e.g. A / B / 2 / True"
                                                                        />
                                                                    </div>
                                                                </div>

                                                                <div>
                                                                    <label className="text-xs font-bold text-slate-500 uppercase tracking-wider block mb-2">Question (Hindi)</label>
                                                                    <textarea
                                                                        value={selectedQuestion.questionHindi}
                                                                        onChange={(e) =>
                                                                            updateQuestionField("questionHindi", e.target.value)
                                                                        }
                                                                        className="textarea min-h-[92px] bg-slate-50 shadow-inner border-slate-200 focus:bg-white focus:ring-indigo-500 focus:border-indigo-500 border-2 border-transparent transition-all resize-y"
                                                                        placeholder="हिंदी प्रश्न"
                                                                    />
                                                                </div>

                                                                <div>
                                                                    <label className="text-xs font-bold text-slate-500 uppercase tracking-wider block mb-2">Question (English)</label>
                                                                    <textarea
                                                                        value={selectedQuestion.questionEnglish}
                                                                        onChange={(e) => updateQuestionField("questionEnglish", e.target.value)}
                                                                        className="textarea min-h-[92px] bg-slate-50 shadow-inner border-slate-200 focus:bg-white focus:ring-indigo-500 focus:border-indigo-500 border-2 border-transparent transition-all resize-y"
                                                                        placeholder="English question"
                                                                    />
                                                                </div>

                                                                {selectedQuestion.questionType === "FIB" && (
                                                                    <div>
                                                                        <label className="text-xs font-semibold text-slate-600 block mb-1">
                                                                            Blank Count
                                                                        </label>
                                                                        <input
                                                                            type="number"
                                                                            min={1}
                                                                            max={20}
                                                                            value={selectedQuestion.blankCount || 1}
                                                                            onChange={(e) =>
                                                                                updateBlankCount(Number.parseInt(e.target.value || "1", 10))
                                                                            }
                                                                            className="input"
                                                                        />
                                                                    </div>
                                                                )}

                                                                {selectedQuestion.questionType === "MATCH_COLUMN" && (
                                                                    <div className="surface-subtle p-3">
                                                                        <p className="text-xs font-semibold text-slate-600 uppercase tracking-wide mb-2">
                                                                            Match Columns (Use format: `English || Hindi`)
                                                                        </p>
                                                                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                                                            <div>
                                                                                <label className="text-xs font-semibold text-slate-600 block mb-1">
                                                                                    Column I
                                                                                </label>
                                                                                <textarea
                                                                                    value={serializeMatchColumnEntries(
                                                                                        selectedQuestion.matchColumns?.left
                                                                                    )}
                                                                                    onChange={(e) => updateMatchColumns("left", e.target.value)}
                                                                                    className="textarea min-h-[120px] bg-slate-50 shadow-inner border-slate-200 focus:bg-white focus:ring-indigo-500 focus:border-indigo-500 border-2 border-transparent transition-all resize-y"
                                                                                    placeholder={"a) Term A || टर्म A"}
                                                                                />
                                                                            </div>
                                                                            <div>
                                                                                <label className="text-xs font-semibold text-slate-600 block mb-1">
                                                                                    Column II
                                                                                </label>
                                                                                <textarea
                                                                                    value={serializeMatchColumnEntries(
                                                                                        selectedQuestion.matchColumns?.right
                                                                                    )}
                                                                                    onChange={(e) => updateMatchColumns("right", e.target.value)}
                                                                                    className="textarea min-h-[120px] bg-slate-50 shadow-inner border-slate-200 focus:bg-white focus:ring-indigo-500 focus:border-indigo-500 border-2 border-transparent transition-all resize-y"
                                                                                    placeholder={"1) Match A || मिलान A"}
                                                                                />
                                                                            </div>
                                                                        </div>
                                                                    </div>
                                                                )}

                                                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                                                    <div>
                                                                        <label className="text-xs font-semibold text-slate-600 block mb-1">Diagram Caption (English)</label>
                                                                        <input
                                                                            value={selectedQuestion.diagramCaptionEnglish || ""}
                                                                            onChange={(e) => updateQuestionField("diagramCaptionEnglish", e.target.value)}
                                                                            className="input bg-slate-50 shadow-inner border-slate-200 focus:bg-white focus:ring-indigo-500 focus:border-indigo-500 border-2 border-transparent transition-all"
                                                                            placeholder="Optional"
                                                                        />
                                                                    </div>
                                                                    <div>
                                                                        <label className="text-xs font-semibold text-slate-600 block mb-1">Diagram Caption (Hindi)</label>
                                                                        <input
                                                                            value={selectedQuestion.diagramCaptionHindi || ""}
                                                                            onChange={(e) =>
                                                                                updateQuestionField("diagramCaptionHindi", e.target.value)
                                                                            }
                                                                            className="input bg-slate-50 shadow-inner border-slate-200 focus:bg-white focus:ring-indigo-500 focus:border-indigo-500 border-2 border-transparent transition-all"
                                                                            placeholder="Optional"
                                                                        />
                                                                    </div>
                                                                </div>

                                                                {(isOptionType(selectedQuestion.questionType) || selectedQuestion.questionType === "MATCH_COLUMN") && (
                                                                    <div className="space-y-3 mt-6 border-t border-slate-200 pt-4">
                                                                        <div className="flex items-center justify-between">
                                                                            <p className="text-xs font-semibold text-slate-600 uppercase tracking-wide">
                                                                                {selectedQuestion.questionType === "MATCH_COLUMN" && selectedQuestion.options?.length > 0
                                                                                    ? "Match Answer Codes (Hindi then English)"
                                                                                    : "Options (Hindi then English)"}
                                                                            </p>
                                                                            <button onClick={addOption} className="btn btn-ghost text-xs">
                                                                                Add Option
                                                                            </button>
                                                                        </div>

                                                                        {selectedQuestion.options.map((option, optionIndex) => (
                                                                            <div key={optionIndex} className="bg-slate-50/50 rounded-xl p-4 border border-slate-100 shadow-sm relative overflow-hidden group">
                                                                                <div className="absolute left-0 top-0 bottom-0 w-1 bg-slate-200 group-hover:bg-blue-400 transition-colors"></div>
                                                                                <div className="flex items-center justify-between mb-3 pl-2">
                                                                                    <p className="text-xs font-bold text-slate-700 uppercase tracking-wide">Option {optionIndex + 1}</p>
                                                                                    <button
                                                                                        onClick={() => requestRemoveOption(optionIndex)}
                                                                                        className="btn text-[10px] uppercase font-bold text-rose-500 hover:text-rose-700 hover:bg-rose-50 px-2 py-1 h-auto min-h-0"
                                                                                    >
                                                                                        Remove
                                                                                    </button>
                                                                                </div>
                                                                                <div className="space-y-3 pl-2">
                                                                                    <input
                                                                                        type="text"
                                                                                        value={option.hindi}
                                                                                        onChange={(e) =>
                                                                                            updateOptionField(
                                                                                                optionIndex,
                                                                                                "hindi",
                                                                                                e.target.value
                                                                                            )
                                                                                        }
                                                                                        className="input bg-white shadow-sm border-slate-200 focus:ring-indigo-500 focus:border-indigo-500 transition-all"
                                                                                        placeholder={`विकल्प ${optionIndex + 1} (Hindi)`}
                                                                                    />
                                                                                    <input
                                                                                        type="text"
                                                                                        value={option.english}
                                                                                        onChange={(e) =>
                                                                                            updateOptionField(
                                                                                                optionIndex,
                                                                                                "english",
                                                                                                e.target.value
                                                                                            )
                                                                                        }
                                                                                        className="input bg-white shadow-sm border-slate-200 focus:ring-indigo-500 focus:border-indigo-500 transition-all"
                                                                                        placeholder={`Option ${optionIndex + 1} (English)`}
                                                                                    />
                                                                                </div>
                                                                            </div>
                                                                        ))}
                                                                    </div>
                                                                )}
                                                            </div>
                                                        </>
                                                    ) : (
                                                        <div className="empty-state">
                                                            <h3>No question selected</h3>
                                                            <p className="text-sm">Upload images or add a question manually.</p>
                                                        </div>
                                                    )}
                                                </>
                                            ) : (
                                                <div className="space-y-4">
                                                    <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm">
                                                        <p className="text-xs font-bold uppercase tracking-wide text-slate-500">
                                                            Rich Content Workspace
                                                        </p>
                                                        <p className="text-[11px] text-slate-500 mt-1">
                                                            WordPress-style content box with formatting controls. Keep section headers like `[QUESTION_HINDI]` intact for structured sync.
                                                        </p>
                                                        <div className="mt-3 flex flex-wrap gap-2">
                                                            <button
                                                                type="button"
                                                                className="btn btn-secondary text-xs"
                                                                onClick={applyRichTemplateToStructured}
                                                                disabled={!selectedQuestion}
                                                            >
                                                                Apply to Structured Fields
                                                            </button>
                                                            <button
                                                                type="button"
                                                                className="btn btn-ghost text-xs"
                                                                onClick={resetRichTemplateFromStructured}
                                                                disabled={!selectedQuestion}
                                                            >
                                                                Reset from Structured
                                                            </button>
                                                            <button
                                                                type="button"
                                                                className="btn btn-ghost text-xs"
                                                                onClick={attachSelectedTextToMark}
                                                            >
                                                                Link Selected Word to Mark
                                                            </button>
                                                            <button
                                                                type="button"
                                                                className="btn btn-secondary text-xs"
                                                                onClick={applySelectedMarkReplacement}
                                                                disabled={!selectedMark}
                                                            >
                                                                Apply Mark Replacement
                                                            </button>
                                                            {selectedMark && (
                                                                <span className="status-badge">
                                                                    Active Mark: {selectedMark.shape === "circle" ? "Circle" : "Rectangle"}
                                                                </span>
                                                            )}
                                                        </div>
                                                    </div>

                                                    {editorMode === "detail" && selectedPageStatus !== "extracted" ? (
                                                        <div className="rounded-2xl border border-dashed border-amber-300 bg-white px-6 py-10 text-center">
                                                            <h3 className="text-lg font-bold text-slate-900">Rich content is unavailable</h3>
                                                            <p className="mt-2 text-sm text-slate-600 max-w-lg mx-auto">
                                                                Extract this page first, then the rich editor will be populated with structured content for manual refinement.
                                                            </p>
                                                        </div>
                                                    ) : selectedQuestion ? (
                                                        <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm">
                                                            <div className="flex flex-wrap gap-2 mb-3">
                                                                <button type="button" className="btn btn-ghost text-xs" onClick={() => runRichFormatCommand("bold")}>
                                                                    Bold
                                                                </button>
                                                                <button type="button" className="btn btn-ghost text-xs" onClick={() => runRichFormatCommand("italic")}>
                                                                    Italic
                                                                </button>
                                                                <button type="button" className="btn btn-ghost text-xs" onClick={() => runRichFormatCommand("underline")}>
                                                                    Underline
                                                                </button>
                                                                <button type="button" className="btn btn-ghost text-xs" onClick={() => runRichFormatCommand("insertUnorderedList")}>
                                                                    Bullets
                                                                </button>
                                                                <button type="button" className="btn btn-ghost text-xs" onClick={() => runRichFormatCommand("insertOrderedList")}>
                                                                    Numbered
                                                                </button>
                                                                <button type="button" className="btn btn-ghost text-xs" onClick={() => runRichFormatCommand("removeFormat")}>
                                                                    Clear Format
                                                                </button>
                                                            </div>

                                                            <div
                                                                ref={richEditorRef}
                                                                contentEditable
                                                                suppressContentEditableWarning
                                                                onInput={handleRichEditorInput}
                                                                className="min-h-[460px] rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm leading-relaxed text-slate-800 whitespace-pre-wrap focus:outline-none focus:ring-2 focus:ring-indigo-200"
                                                            >
                                                                {richTemplateText || buildRichTemplateFromQuestion(selectedQuestion)}
                                                            </div>
                                                        </div>
                                                    ) : (
                                                        <div className="empty-state">
                                                            <h3>No question selected</h3>
                                                            <p className="text-sm">Select a question to start rich content editing.</p>
                                                        </div>
                                                    )}
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                )}
                            </article>
                        )}

                    </section>
                )
            }

            {
                isAiChatPopupOpen && (
                    <div className="fixed inset-0 z-[92] flex items-center justify-center p-4">
                        <button
                            type="button"
                            className="absolute inset-0 modal-backdrop border-0"
                            onClick={() => setIsAiChatPopupOpen(false)}
                            aria-label="Close AI correction chat"
                        />

                        <div className="relative w-full max-w-3xl rounded-3xl border border-slate-200/60 bg-white/95 backdrop-blur-xl shadow-[0_20px_60px_-15px_rgba(0,0,0,0.1)] overflow-hidden flex flex-col max-h-[90vh]">
                            <div className="px-6 py-5 border-b border-slate-200/50 bg-slate-50/50 flex items-center justify-between gap-3 shrink-0">
                                <div>
                                    <div className="flex items-center gap-3">
                                        <div className="w-8 h-8 rounded-full bg-indigo-100 text-indigo-600 flex items-center justify-center">
                                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                                <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"></path>
                                            </svg>
                                        </div>
                                        <div>
                                            <p className="text-[13px] font-bold text-slate-800">
                                                AI Correction Chat
                                            </p>
                                            <p className="text-[11px] text-slate-500 font-medium">
                                                Targeting: Question {selectedQuestion?.number || selectedQuestionIndex + 1}
                                            </p>
                                        </div>
                                    </div>
                                </div>
                                <button
                                    type="button"
                                    className="w-8 h-8 rounded-full bg-slate-100 hover:bg-slate-200 text-slate-500 flex items-center justify-center transition-colors border border-transparent hover:border-slate-300"
                                    onClick={() => setIsAiChatPopupOpen(false)}
                                >
                                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                        <line x1="18" y1="6" x2="6" y2="18"></line>
                                        <line x1="6" y1="6" x2="18" y2="18"></line>
                                    </svg>
                                </button>
                            </div>

                            <div className="flex-1 overflow-hidden flex flex-col p-6 gap-5 bg-gradient-to-b from-white to-slate-50/30">
                                <div className="flex-1 overflow-y-auto space-y-4 pr-2 custom-scrollbar">
                                    {selectedQuestionMessages.length === 0 ? (
                                        <div className="h-full flex flex-col items-center justify-center text-center opacity-70">
                                            <div className="w-16 h-16 bg-slate-100 rounded-full flex items-center justify-center mb-4 text-slate-400">
                                                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                                                    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v10z"></path>
                                                </svg>
                                            </div>
                                            <p className="text-sm font-semibold text-slate-700">How can AI help with this question?</p>
                                            <p className="text-xs text-slate-500 mt-1 max-w-xs">Ask to fix structure, translate text, correct options, or improve formatting.</p>
                                        </div>
                                    ) : (
                                        selectedQuestionMessages.map((message) => (
                                            <div
                                                key={message.id}
                                                className={`flex flex-col ${message.role === "user" ? "items-end ml-12" : "items-start mr-12"}`}
                                            >
                                                <div className="flex items-center gap-2 mb-1.5 px-1">
                                                    <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                                                        {message.role === "user" ? "You" : "AI Assistant"}
                                                    </span>
                                                    {message.role === "assistant" && (
                                                        <span className="w-1.5 h-1.5 rounded-full bg-indigo-500"></span>
                                                    )}
                                                </div>
                                                <div
                                                    className={`rounded-2xl px-4 py-3 shadow-sm ${message.role === "user"
                                                        ? "bg-indigo-600 text-white rounded-tr-sm border border-transparent"
                                                        : "bg-white text-slate-800 rounded-tl-sm border border-slate-200/80 shadow-[0_2px_8px_-2px_rgba(0,0,0,0.05)]"
                                                        }`}
                                                >
                                                    <p className={`text-[13px] leading-relaxed ${message.role === "user" ? "text-indigo-50" : "text-slate-700"}`}>{message.text}</p>

                                                    {message.suggestion && (
                                                        <div className="mt-3 pt-3 border-t border-slate-100/50 flex flex-wrap items-center gap-2 border-opacity-20">
                                                            <button
                                                                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors flex items-center gap-1.5 ${message.applied
                                                                    ? "bg-emerald-50 text-emerald-700 border border-emerald-200 cursor-default"
                                                                    : "bg-indigo-50 text-indigo-700 hover:bg-indigo-100 border border-indigo-200"}`}
                                                                onClick={() => applyAssistantSuggestion(message.id)}
                                                                disabled={Boolean(message.applied)}
                                                            >
                                                                {message.applied ? (
                                                                    <><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg> Applied</>
                                                                ) : "Apply Suggestion"}
                                                            </button>
                                                            <span className="text-[10px] uppercase font-bold tracking-wider text-slate-400 bg-slate-50/50 px-2 py-1 rounded border border-slate-100">
                                                                {getQuestionTypeLabel(message.suggestion.questionType)}
                                                            </span>
                                                        </div>
                                                    )}
                                                </div>
                                            </div>
                                        ))
                                    )}
                                </div>

                                <div className="shrink-0 bg-white rounded-2xl border border-slate-200 shadow-[0_-4px_20px_-10px_rgba(0,0,0,0.05)] overflow-hidden focus-within:ring-2 focus-within:ring-indigo-500/20 focus-within:border-indigo-300 transition-all">
                                    <div className="flex flex-wrap gap-1.5 p-2 bg-slate-50/80 border-b border-slate-100">
                                        <button
                                            type="button"
                                            onClick={() => setAssistantPrompt("Fix line breaks and structure formatting (A., B., C.)")}
                                            className="px-2.5 py-1 text-[11px] font-medium bg-white hover:bg-slate-100 text-slate-600 rounded-md border border-slate-200 shadow-sm transition-colors"
                                        >
                                            ✨ Fix Structure
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => setAssistantPrompt("Translate the entire text perfectly to Hindi")}
                                            className="px-2.5 py-1 text-[11px] font-medium bg-white hover:bg-slate-100 text-slate-600 rounded-md border border-slate-200 shadow-sm transition-colors"
                                        >
                                            🌐 Translate to Hindi
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => setAssistantPrompt("Fix spelling and grammar typos")}
                                            className="px-2.5 py-1 text-[11px] font-medium bg-white hover:bg-slate-100 text-slate-600 rounded-md border border-slate-200 shadow-sm transition-colors"
                                        >
                                            ✍️ Fix Typos
                                        </button>
                                    </div>
                                    <div className="flex items-end p-2 gap-2 bg-white">
                                        <textarea
                                            value={assistantPrompt}
                                            onChange={(e) => setAssistantPrompt(e.target.value)}
                                            onKeyDown={(e) => {
                                                if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                                                    e.preventDefault();
                                                    sendAssistantPrompt();
                                                }
                                            }}
                                            className="flex-1 min-h-[44px] max-h-[120px] bg-transparent border-0 focus:ring-0 resize-none text-sm p-2 text-slate-800 placeholder-slate-400"
                                            placeholder="Ask AI to correct this question... (Cmd/Ctrl + Enter to send)"
                                        />
                                        <button
                                            className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 transition-all mb-1 mr-1 ${isAssistantBusy || !assistantPrompt.trim() || !selectedQuestion
                                                ? "bg-slate-100 text-slate-400 cursor-not-allowed"
                                                : "bg-indigo-600 text-white shadow-[0_4px_12px_-4px_rgba(79,70,229,0.5)] hover:bg-indigo-700 hover:-translate-y-0.5"
                                                }`}
                                            onClick={sendAssistantPrompt}
                                            disabled={isAssistantBusy || !assistantPrompt.trim() || !selectedQuestion}
                                        >
                                            {isAssistantBusy ? (
                                                <span className="spinner border-slate-400" style={{ width: 16, height: 16 }} />
                                            ) : (
                                                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                                    <line x1="22" y1="2" x2="11" y2="13"></line>
                                                    <polygon points="22 2 15 22 11 13 2 9 22 2"></polygon>
                                                </svg>
                                            )}
                                        </button>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                )
            }

            {
                showBottomQuestionNavigator && (
                    <div className="workspace-bottom-navigator fixed bottom-0 left-0 right-0 z-[100] bg-white/95 backdrop-blur border-t border-slate-200 shadow-[0_-4px_12px_rgba(0,0,0,0.08)] py-3 px-4 md:px-8 mt-4 flex items-center justify-between gap-2 md:gap-4">
                        <button
                            onClick={goToPreviousNavigatorItem}
                            disabled={activeBottomNavigatorIndex === 0}
                            className={`workspace-bottom-nav-side-btn btn shrink-0 flex items-center px-3 py-1.5 md:py-2 rounded-xl font-bold text-sm transition-all ${activeBottomNavigatorIndex === 0
                                ? "bg-slate-50 text-slate-400 cursor-not-allowed border-transparent"
                                : "bg-white border-slate-200 text-slate-700 hover:bg-slate-50 hover:border-slate-300 shadow-sm"
                                }`}
                        >
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="md:mr-1.5"><polyline points="15 18 9 12 15 6"></polyline></svg>
                            <span className="hidden md:inline">Previous</span>
                        </button>

                        <div className="flex-1 flex flex-col justify-center overflow-hidden gap-2">
                            <div className="flex items-center justify-center">
                                <div className="workspace-bottom-nav-scope inline-flex items-center gap-1 rounded-2xl border border-slate-200 bg-slate-100 p-1 shadow-inner">
                                    <button
                                        type="button"
                                        onClick={() => setBottomNavigatorScope("pages")}
                                        className={`px-2.5 py-1.5 rounded-xl text-[11px] font-bold uppercase tracking-wide transition-all ${bottomNavigatorScope === "pages"
                                            ? "bg-white text-indigo-700 shadow-sm border border-slate-200/60"
                                            : "text-slate-500 hover:text-slate-800"
                                            }`}
                                    >
                                        Pages
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => setBottomNavigatorScope("questions")}
                                        disabled={selectedPageQuestionEntries.length === 0}
                                        className={`px-2.5 py-1.5 rounded-xl text-[11px] font-bold uppercase tracking-wide transition-all ${bottomNavigatorScope === "questions"
                                            ? "bg-white text-indigo-700 shadow-sm border border-slate-200/60"
                                            : "text-slate-500 hover:text-slate-800"
                                            } disabled:opacity-40 disabled:cursor-not-allowed`}
                                    >
                                        Questions
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => setBottomNavigatorScope("workspace")}
                                        className={`px-2.5 py-1.5 rounded-xl text-[11px] font-bold uppercase tracking-wide transition-all ${bottomNavigatorScope === "workspace"
                                            ? "bg-white text-indigo-700 shadow-sm border border-slate-200/60"
                                            : "text-slate-500 hover:text-slate-800"
                                            }`}
                                    >
                                        Workspace
                                    </button>
                                </div>
                            </div>

                            <div className="flex-1 flex justify-center overflow-hidden">
                                <div
                                    ref={bottomNavigatorScrollRef}
                                    className="workspace-bottom-nav-scroll max-w-full overflow-x-auto flex items-center justify-start px-2 py-1 mx-2"
                                    style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}
                                >
                                    <div className="flex gap-2 items-center pb-1">
                                        <span className="text-xs font-bold text-slate-500 tracking-wider uppercase shrink-0 mr-1 hidden sm:inline-block">
                                            {bottomNavigatorScope === "pages"
                                                ? "Pages:"
                                                : bottomNavigatorScope === "questions"
                                                    ? "Page Qs:"
                                                    : "Modes:"}
                                        </span>
                                        {bottomNavigatorItems.map((item) => (
                                            <button
                                                key={item.key}
                                                ref={(node) => {
                                                    bottomNavigatorButtonRefs.current[item.key] = node;
                                                }}
                                                onClick={() => activateBottomNavigatorItem(item)}
                                                title={item.title}
                                                className={`workspace-bottom-nav-item ${item.kind === "page" ? "workspace-bottom-nav-item-page" : ""} relative shrink-0 flex items-center justify-center text-sm font-bold transition-all ${item.kind === "workspace"
                                                    ? "min-w-[3.2rem] h-10 rounded-2xl px-3"
                                                    : item.kind === "question"
                                                        ? "min-w-[3.25rem] h-10 rounded-2xl px-3"
                                                        : "min-w-[5.6rem] h-14 rounded-[1.15rem] px-2.5"
                                                    } ${item.index === activeBottomNavigatorIndex
                                                        ? "bg-indigo-600 text-white shadow-md transform scale-105"
                                                        : item.status === "failed"
                                                            ? "bg-red-50 text-red-700 hover:bg-red-100"
                                                            : item.status === "pending"
                                                                ? "bg-amber-50 text-amber-700 hover:bg-amber-100"
                                                                : "bg-slate-100 text-slate-600 hover:bg-slate-200 hover:text-slate-800"
                                                        }`}
                                            >
                                                {item.kind === "page" ? (
                                                    <span className="flex flex-col items-center justify-center leading-none">
                                                        <span className="text-[0.9rem] font-extrabold">
                                                            {item.label}
                                                        </span>
                                                        <span className="mt-1 max-w-[4.8rem] truncate text-[10px] font-semibold tracking-wide opacity-90">
                                                            {item.detail || "Pending"}
                                                        </span>
                                                    </span>
                                                ) : (
                                                    <span>{item.label}</span>
                                                )}
                                                {bottomNavigatorScope === "pages" && (
                                                    <span
                                                        className={`absolute -right-1 -bottom-1 flex h-4 w-4 items-center justify-center rounded-full border border-white shadow-sm ${item.status === "extracted"
                                                            ? "bg-emerald-500 text-white"
                                                            : item.status === "failed"
                                                                ? "bg-red-500 text-white"
                                                                : "bg-amber-400 text-white"
                                                            }`}
                                                    >
                                                        {item.status === "extracted" ? (
                                                            <svg width="9" height="9" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                                                <polyline points="2.5 6.5 5 9 9.5 3.5"></polyline>
                                                            </svg>
                                                        ) : item.status === "failed" ? (
                                                            <svg width="8" height="8" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                                                <line x1="6" y1="2.5" x2="6" y2="6.5"></line>
                                                                <circle cx="6" cy="9" r="0.75" fill="currentColor" stroke="none"></circle>
                                                            </svg>
                                                        ) : (
                                                            <svg width="7" height="7" viewBox="0 0 12 12" fill="currentColor">
                                                                <circle cx="6" cy="6" r="3"></circle>
                                                            </svg>
                                                        )}
                                                    </span>
                                                )}
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            </div>
                        </div>

                        <button
                            onClick={goToNextNavigatorItem}
                            disabled={activeBottomNavigatorIndex >= bottomNavigatorItems.length - 1}
                            className={`workspace-bottom-nav-side-btn btn shrink-0 flex items-center px-3 py-1.5 md:py-2 rounded-xl font-bold text-sm transition-all ${activeBottomNavigatorIndex >= bottomNavigatorItems.length - 1
                                ? "bg-slate-50 text-slate-400 cursor-not-allowed border-transparent"
                                : "bg-indigo-50 border-indigo-100 text-indigo-700 hover:bg-indigo-100 shadow-sm"
                                }`}
                        >
                            <span className="hidden md:inline">Next</span>
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="md:ml-1.5"><polyline points="9 18 15 12 9 6"></polyline></svg>
                        </button>
                    </div>
                )
            }

            <aside
                className={`process-popup-panel process-popup-sidebar ${isProcessPopupOpen ? "is-open" : ""} ${isProcessPopupCollapsed ? "is-collapsed" : ""}`}
                role="dialog"
                aria-label="AI processing timeline"
                aria-hidden={!isProcessPopupOpen}
                style={{ bottom: showBottomQuestionNavigator ? "7rem" : "1rem" }}
            >
                <div className="process-popup-header">
                    <div className="process-popup-header-copy">
                        <p className="text-xs font-bold uppercase tracking-wide text-slate-500">
                            AI Processing Timeline
                        </p>
                        <p className="text-[11px] text-slate-500 mt-1">
                            Live extraction stages, retries, diagram crop checks, and quality signals.
                        </p>
                    </div>
                    <div className="process-popup-header-actions">
                        <button
                            className="btn btn-ghost text-xs"
                            onClick={() => setIsProcessPopupCollapsed((prev) => !prev)}
                            type="button"
                        >
                            {isProcessPopupCollapsed ? "Expand" : "Collapse"}
                        </button>
                        {!isProcessPopupCollapsed && (
                            <button
                                className="btn btn-ghost text-xs"
                                onClick={clearProcessTimeline}
                                disabled={processingSteps.length === 0 || isExtracting}
                                type="button"
                            >
                                Clear
                            </button>
                        )}
                        <button
                            className="btn btn-ghost text-xs"
                            onClick={() => setIsProcessPopupOpen(false)}
                            type="button"
                        >
                            Close
                        </button>
                    </div>
                </div>

                {!isProcessPopupCollapsed && (
                    <>
                        <div
                            ref={processTimelineBodyRef}
                            className="process-popup-body"
                            onScroll={handleProcessTimelineScroll}
                        >
                            {processingSteps.length === 0 ? (
                                <p className="text-xs text-slate-500">
                                    No extraction steps yet. Upload images to see detailed AI processing logs.
                                </p>
                            ) : (
                                processingSteps.slice(-120).map((step) => (
                                    <div key={step.id} className={`process-step process-step-${step.status}`}>
                                        <span className="process-step-dot" />
                                        <div className="flex-1 min-w-0">
                                            <p className="text-[11px] text-slate-900 leading-relaxed">
                                                {step.message}
                                            </p>
                                            <p className="text-[10px] text-slate-500 mt-1">
                                                {formatStepTimestamp(step.timestamp)}
                                                {step.imageName ? ` • ${step.imageName}` : ""}
                                                {step.variant ? ` • ${step.variant}` : ""}
                                            </p>
                                        </div>
                                    </div>
                                ))
                            )}
                        </div>

                        {!isProcessTimelineAtBottom && processUnreadCount > 0 && (
                            <button
                                type="button"
                                className="process-scroll-latest"
                                onClick={() => scrollProcessTimelineToBottom("smooth")}
                                aria-label="Scroll to latest AI updates"
                            >
                                <span className="process-scroll-latest-icon" aria-hidden="true">↓</span>
                                <span className="process-scroll-latest-text">{processUnreadCount} new</span>
                            </button>
                        )}
                    </>
                )}
            </aside>

            {isDeckMergeModalOpen && (
                <div className="fixed inset-0 z-[110] flex items-center justify-center bg-slate-950/45 backdrop-blur-sm p-4">
                    <button
                        type="button"
                        className="absolute inset-0 border-0"
                        onClick={() => !isSubmittingDeckMerge && setIsDeckMergeModalOpen(false)}
                        aria-label="Close deck merge modal"
                    />
                    <div className="relative z-[111] w-full max-w-6xl rounded-[28px] border border-slate-200 bg-white shadow-2xl overflow-hidden">
                        <div className="flex items-start justify-between gap-4 border-b border-slate-100 px-6 py-5 bg-slate-50/70">
                            <div>
                                <p className="text-xs font-bold uppercase tracking-[0.28em] text-indigo-600">Merge Into Deck</p>
                                <h2 className="mt-1 text-2xl font-bold text-slate-950">Send selected pages into one workspace</h2>
                                <p className="mt-1 text-sm text-slate-500">
                                    Collect pages from any number of workspaces, then merge them into an existing deck or create a new one.
                                </p>
                            </div>
                            <button
                                type="button"
                                className="w-10 h-10 rounded-full border border-slate-200 bg-white text-slate-500 hover:text-slate-700"
                                onClick={() => !isSubmittingDeckMerge && setIsDeckMergeModalOpen(false)}
                            >
                                ×
                            </button>
                        </div>

                        <div className="grid grid-cols-1 xl:grid-cols-[1.15fr_1fr] gap-0 max-h-[78vh]">
                            <div className="border-r border-slate-100 overflow-y-auto p-6 space-y-4">
                                <div className="rounded-2xl border border-indigo-100 bg-indigo-50/70 p-4">
                                    <div className="flex flex-wrap items-center gap-2">
                                        <span className="tool-chip">Pages: {deckMergeBasketPageCount}</span>
                                        <span className="tool-chip">Questions: {deckMergeBasketQuestionCount}</span>
                                        <span className="tool-chip">Workspaces: {deckMergeBasketWorkspaceCount}</span>
                                    </div>
                                    <p className="mt-2 text-sm text-slate-600">
                                        Current basket will be appended after the target deck’s existing pages. You can reorder pages inside the target deck after merge.
                                    </p>
                                </div>

                                <div className="space-y-3">
                                    {deckMergeBasket.map((page) => (
                                        <div
                                            key={page.id}
                                            className="rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-sm"
                                        >
                                            <div className="flex items-start justify-between gap-3">
                                                <div className="min-w-0">
                                                    <p className="text-sm font-semibold text-slate-950 truncate">
                                                        {page.sourceDocumentTitle}
                                                    </p>
                                                    <p className="text-xs uppercase tracking-[0.22em] text-slate-400 mt-1">
                                                        Page {page.sourcePageIndex + 1}
                                                    </p>
                                                </div>
                                                <button
                                                    type="button"
                                                    className="text-xs font-semibold text-red-600 hover:text-red-700"
                                                    onClick={() => removeDeckBasketPage(page.id)}
                                                >
                                                    Remove
                                                </button>
                                            </div>
                                            <div className="mt-3 flex flex-wrap items-center gap-2">
                                                <span className="tool-chip">{page.questionCount} question(s)</span>
                                                {page.questionNumbers.length > 0 && (
                                                    <span className="tool-chip">
                                                        {formatQuestionNumberSummary(
                                                            page.questionNumbers
                                                                .map((value) => Number.parseInt(value, 10))
                                                                .filter((value) => Number.isFinite(value) && value > 0)
                                                        )}
                                                    </span>
                                                )}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>

                            <div className="overflow-y-auto p-6 space-y-5">
                                <div className="flex flex-wrap gap-2">
                                    <button
                                        type="button"
                                        className={`btn ${deckMergeMode === "existing" ? "btn-primary" : "btn-secondary"}`}
                                        onClick={() => setDeckMergeMode("existing")}
                                    >
                                        Existing Deck
                                    </button>
                                    <button
                                        type="button"
                                        className={`btn ${deckMergeMode === "new" ? "btn-primary" : "btn-secondary"}`}
                                        onClick={() => setDeckMergeMode("new")}
                                    >
                                        New Deck
                                    </button>
                                </div>

                                {deckMergeMode === "existing" ? (
                                    <div className="space-y-4">
                                        <div className="flex items-center gap-3">
                                            <input
                                                type="text"
                                                value={deckTargetSearch}
                                                onChange={(event) => setDeckTargetSearch(event.target.value)}
                                                placeholder="Search target deck..."
                                                className="input flex-1"
                                            />
                                            <span className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">
                                                {filteredDeckTargetDocuments.length} deck(s)
                                            </span>
                                        </div>

                                        <div className="space-y-3 max-h-[46vh] overflow-y-auto pr-1">
                                            {isDeckTargetsLoading ? (
                                                <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-8 text-center text-sm text-slate-500">
                                                    Loading decks...
                                                </div>
                                            ) : filteredDeckTargetDocuments.length === 0 ? (
                                                <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-8 text-center text-sm text-slate-500">
                                                    No matching decks found.
                                                </div>
                                            ) : (
                                                filteredDeckTargetDocuments.map((deck) => {
                                                    const isSelected = selectedDeckTargetId === deck.id;
                                                    return (
                                                        <button
                                                            key={deck.id}
                                                            type="button"
                                                            className={`w-full rounded-2xl border px-4 py-4 text-left transition-all ${isSelected ? "border-indigo-400 bg-indigo-50 ring-2 ring-indigo-200" : "border-slate-200 bg-white hover:border-slate-300"}`}
                                                            onClick={() => setSelectedDeckTargetId(deck.id)}
                                                        >
                                                            <div className="flex items-start justify-between gap-3">
                                                                <div className="min-w-0">
                                                                    <p className="text-base font-semibold text-slate-950 truncate">{deck.title}</p>
                                                                    <p className="mt-1 text-sm text-slate-500 truncate">
                                                                        {deck.subject || "Extracted Question Set"} · {deck.date || "No date"}
                                                                    </p>
                                                                </div>
                                                                {isSelected && (
                                                                    <span className="tool-chip">Target</span>
                                                                )}
                                                            </div>
                                                            <div className="mt-3 flex flex-wrap gap-2">
                                                                <span className="tool-chip">Pages: {deck.pageCount}</span>
                                                                <span className="tool-chip">Questions: {deck.questionCount}</span>
                                                            </div>
                                                        </button>
                                                    );
                                                })
                                            )}
                                        </div>
                                    </div>
                                ) : (
                                    <div className="space-y-4">
                                        <label className="block">
                                            <span className="block text-xs font-bold uppercase tracking-[0.22em] text-slate-500 mb-2">
                                                Deck Title
                                            </span>
                                            <input
                                                type="text"
                                                value={newDeckTitle}
                                                onChange={(event) => setNewDeckTitle(event.target.value)}
                                                placeholder="Merged Question Deck"
                                                className="input w-full"
                                            />
                                        </label>
                                        <label className="block">
                                            <span className="block text-xs font-bold uppercase tracking-[0.22em] text-slate-500 mb-2">
                                                Subject
                                            </span>
                                            <input
                                                type="text"
                                                value={newDeckSubject}
                                                onChange={(event) => setNewDeckSubject(event.target.value)}
                                                placeholder="Optional subject label"
                                                className="input w-full"
                                            />
                                        </label>
                                    </div>
                                )}

                                <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
                                    Merge will append the basket pages at the end of the target deck, then question numbers will be recalculated automatically.
                                </div>
                            </div>
                        </div>

                        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 px-6 py-4 bg-white">
                            <button
                                type="button"
                                className="btn btn-ghost"
                                onClick={() => setIsDeckMergeModalOpen(false)}
                                disabled={isSubmittingDeckMerge}
                            >
                                Cancel
                            </button>
                            <div className="flex flex-wrap items-center gap-2">
                                <button
                                    type="button"
                                    className="btn btn-secondary"
                                    onClick={clearDeckMergeBasket}
                                    disabled={isSubmittingDeckMerge}
                                >
                                    Clear Basket
                                </button>
                                <button
                                    type="button"
                                    className="btn btn-primary"
                                    onClick={submitDeckMerge}
                                    disabled={isSubmittingDeckMerge}
                                >
                                    {isSubmittingDeckMerge ? "Sending..." : "Send Into Deck"}
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            <Modal
                isOpen={modalConfig.isOpen}
                onClose={() => setModalConfig((prev) => ({ ...prev, isOpen: false }))}
                onConfirm={modalConfig.onConfirm}
                title={modalConfig.title}
                message={modalConfig.message}
                type={modalConfig.type}
                confirmText={modalConfig.confirmText}
                cancelText={modalConfig.cancelText}
            />

            {
                isDocxModalOpen && (
                    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4 animate-in fade-in duration-200">
                        <div className="bg-white rounded-3xl shadow-2xl max-w-4xl w-full max-h-[90vh] flex flex-col overflow-hidden animate-in slide-in-from-bottom-4 duration-300 border border-slate-200">
                            <div className="px-6 py-5 border-b border-slate-100 flex items-center justify-between bg-white">
                                <div>
                                    <h2 className="text-xl font-bold text-slate-900 tracking-tight">Export Workspace</h2>
                                    <p className="mt-1 text-sm text-slate-500">Choose the output format and export settings for this question set.</p>
                                </div>
                                <button
                                    onClick={() => setIsDocxModalOpen(false)}
                                    className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-slate-200 text-slate-500 transition-colors"
                                >
                                    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg">
                                        <path d="M1 1L13 13M1 13L13 1" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                                    </svg>
                                </button>
                            </div>

                            <div className="overflow-y-auto px-6 py-6 space-y-6">
                                <div className="grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
                                    <div className="space-y-4 rounded-2xl border border-slate-200 bg-slate-50 p-5">
                                        <div>
                                            <p className="text-xs font-bold uppercase tracking-[0.22em] text-slate-500 mb-2">Export Title</p>
                                            <p className="text-sm text-slate-500 mb-3">Use a clean exam or document title for the downloaded file.</p>
                                        </div>
                                        <input
                                            type="text"
                                            value={exportTitle}
                                            onChange={(e) => setExportTitle(e.target.value)}
                                            placeholder="Enter export title"
                                            className="w-full input bg-white shadow-sm border-slate-200 focus:bg-white focus:ring-blue-500 focus:border-blue-500 px-3 py-2.5 rounded-xl text-sm"
                                        />
                                        <label className="flex items-center justify-between gap-4 rounded-xl border border-slate-200 bg-white px-4 py-3">
                                            <div>
                                                <p className="text-sm font-semibold text-slate-900">Shuffle Questions</p>
                                                <p className="text-xs text-slate-500">Only affects the exported file order.</p>
                                            </div>
                                            <input
                                                type="checkbox"
                                                checked={exportShuffleQuestions}
                                                onChange={(e) => setExportShuffleQuestions(e.target.checked)}
                                                className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                                            />
                                        </label>
                                    </div>

                                    <div className="rounded-2xl border border-slate-200 bg-white p-5">
                                        <p className="text-xs font-bold uppercase tracking-[0.22em] text-slate-500 mb-4">Export Snapshot</p>
                                        <div className="grid grid-cols-1 gap-3">
                                            <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
                                                <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-500">Language</p>
                                                <p className="mt-1 text-sm font-semibold text-slate-900">{getOutputLanguageLabel(outputLanguageMode)}</p>
                                            </div>
                                            <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
                                                <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-500">Scope</p>
                                                <p className="mt-1 text-sm font-semibold text-slate-900">
                                                    {getOutputScopeLabel(
                                                        outputQuestionScope,
                                                        selectedQuestionIndex,
                                                        outputRangeStart,
                                                        outputRangeEnd
                                                    )}
                                                </p>
                                            </div>
                                            <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
                                                <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-500">Questions</p>
                                                <p className="mt-1 text-sm font-semibold text-slate-900">{outputQuestionCount}</p>
                                            </div>
                                        </div>
                                    </div>
                                </div>

                                <div>
                                <div className="mb-4">
                                    <p className="text-xs font-bold uppercase tracking-[0.22em] text-slate-500">Format Presets</p>
                                    <h3 className="mt-2 text-lg font-bold text-slate-900">Select the layout for the exported file</h3>
                                    <p className="mt-1 text-sm text-slate-500">Pick the format that best matches your upload target or exam-paper output style.</p>
                                </div>

                                <div className="grid gap-3 md:grid-cols-2">
                                    <label className={`flex min-h-[144px] items-start gap-4 p-5 rounded-2xl border-2 cursor-pointer transition-all ${selectedDocxFormat === "1" ? "border-blue-500 bg-blue-50/60 shadow-sm" : "border-slate-200 hover:border-slate-300 bg-white"}`}>
                                        <input
                                            type="radio"
                                            name="docxFormat"
                                            value="1"
                                            checked={selectedDocxFormat === "1"}
                                            onChange={() => setSelectedDocxFormat("1")}
                                            className="sr-only"
                                        />
                                        <div className="pt-1 flex-shrink-0">
                                            <div className={`w-5 h-5 rounded-full border flex items-center justify-center ${selectedDocxFormat === "1" ? "border-blue-600 border-[6px]" : "border-slate-300"}`}></div>
                                        </div>
                                        <div className="space-y-2">
                                            <p className="text-base font-bold text-slate-900">Format 1: Table Layout</p>
                                            <p className="text-sm text-slate-600 leading-6">Structured rows for question, type, options, answer, solution, and marks side by side.</p>
                                            <div className="flex flex-wrap gap-2">
                                                <span className="tool-chip">Table structure</span>
                                                <span className="tool-chip">Detailed review</span>
                                            </div>
                                        </div>
                                    </label>

                                    <label className={`flex min-h-[144px] items-start gap-4 p-5 rounded-2xl border-2 cursor-pointer transition-all ${selectedDocxFormat === "2" ? "border-blue-500 bg-blue-50/60 shadow-sm" : "border-slate-200 hover:border-slate-300 bg-white"}`}>
                                        <input
                                            type="radio"
                                            name="docxFormat"
                                            value="2"
                                            checked={selectedDocxFormat === "2"}
                                            onChange={() => setSelectedDocxFormat("2")}
                                            className="sr-only"
                                        />
                                        <div className="pt-1 flex-shrink-0">
                                            <div className={`w-5 h-5 rounded-full border flex items-center justify-center ${selectedDocxFormat === "2" ? "border-blue-600 border-[6px]" : "border-slate-300"}`}></div>
                                        </div>
                                        <div className="space-y-2">
                                            <p className="text-base font-bold text-slate-900">Format 2: Simple Text Flow</p>
                                            <p className="text-sm text-slate-600 leading-6">Classic upload-ready text flow with strict line breaks for question, options, answer, solution, and marks.</p>
                                            <div className="flex flex-wrap gap-2">
                                                <span className="tool-chip">Uploader safe</span>
                                                <span className="tool-chip">Plain text</span>
                                            </div>
                                        </div>
                                    </label>

                                    <label className={`flex min-h-[144px] items-start gap-4 p-5 rounded-2xl border-2 cursor-pointer transition-all ${selectedDocxFormat === "3" ? "border-blue-500 bg-blue-50/60 shadow-sm" : "border-slate-200 hover:border-slate-300 bg-white"}`}>
                                        <input
                                            type="radio"
                                            name="docxFormat"
                                            value="3"
                                            checked={selectedDocxFormat === "3"}
                                            onChange={() => setSelectedDocxFormat("3")}
                                            className="sr-only"
                                        />
                                        <div className="pt-1 flex-shrink-0">
                                            <div className={`w-5 h-5 rounded-full border flex items-center justify-center ${selectedDocxFormat === "3" ? "border-blue-600 border-[6px]" : "border-slate-300"}`}></div>
                                        </div>
                                        <div className="space-y-2">
                                            <p className="text-base font-bold text-slate-900">Format 3: Bulk Uploader Template</p>
                                            <p className="text-sm text-slate-600 leading-6">Matches your uploader template with numeric options, numeric answer, and tightly controlled line formatting.</p>
                                            <div className="flex flex-wrap gap-2">
                                                <span className="tool-chip">Numeric answer</span>
                                                <span className="tool-chip">Bulk import</span>
                                            </div>
                                        </div>
                                    </label>

                                    <label className={`flex min-h-[160px] items-start gap-4 p-5 rounded-2xl border-2 cursor-pointer transition-all md:col-span-2 ${selectedDocxFormat === "4" ? "border-blue-500 bg-blue-50/60 shadow-sm" : "border-slate-200 hover:border-slate-300 bg-white"}`}>
                                        <input
                                            type="radio"
                                            name="docxFormat"
                                            value="4"
                                            checked={selectedDocxFormat === "4"}
                                            onChange={() => setSelectedDocxFormat("4")}
                                            className="sr-only"
                                        />
                                        <div className="pt-1 flex-shrink-0">
                                            <div className={`w-5 h-5 rounded-full border flex items-center justify-center ${selectedDocxFormat === "4" ? "border-blue-600 border-[6px]" : "border-slate-300"}`}></div>
                                        </div>
                                        <div className="space-y-2">
                                            <p className="text-base font-bold text-slate-900">Format 4: School Exam Paper <span className="text-purple-600">Exports as PDF</span></p>
                                            <p className="text-sm text-slate-600 leading-6">Professional exam-paper layout for print-ready output. Best for school exams and polished institute papers.</p>
                                            <div className="flex flex-wrap gap-2">
                                                <span className="tool-chip">Print ready</span>
                                                <span className="tool-chip">PDF output</span>
                                                <span className="tool-chip">Professional header</span>
                                            </div>
                                            {selectedDocxFormat === "4" && (
                                                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                                                    <button
                                                        type="button"
                                                        onClick={(event) => {
                                                            event.preventDefault();
                                                            event.stopPropagation();
                                                            setExamPaperAnswerMode("without-answers");
                                                        }}
                                                        className={`rounded-xl border px-3 py-3 text-left transition ${
                                                            examPaperAnswerMode === "without-answers"
                                                                ? "border-blue-500 bg-white shadow-sm"
                                                                : "border-slate-200 bg-slate-50 hover:border-slate-300"
                                                        }`}
                                                    >
                                                        <p className="text-sm font-bold text-slate-900">Without Answers</p>
                                                        <p className="mt-1 text-xs text-slate-500">Clean exam paper for students without answer highlights.</p>
                                                    </button>
                                                    <button
                                                        type="button"
                                                        onClick={(event) => {
                                                            event.preventDefault();
                                                            event.stopPropagation();
                                                            setExamPaperAnswerMode("with-answers");
                                                        }}
                                                        className={`rounded-xl border px-3 py-3 text-left transition ${
                                                            examPaperAnswerMode === "with-answers"
                                                                ? "border-emerald-500 bg-white shadow-sm"
                                                                : "border-slate-200 bg-slate-50 hover:border-slate-300"
                                                        }`}
                                                    >
                                                        <p className="text-sm font-bold text-slate-900">With Answers</p>
                                                        <p className="mt-1 text-xs text-slate-500">Answer keys stay inline and highlighted in green.</p>
                                                    </button>
                                                </div>
                                            )}
                                        </div>
                                    </label>
                                </div>
                                </div>
                            </div>

                            <div className="px-6 py-4 bg-slate-50 flex items-center justify-end gap-3 border-t border-slate-100 rounded-b-3xl">
                                <button
                                    onClick={() => setIsDocxModalOpen(false)}
                                    className="px-5 py-2.5 text-sm font-semibold text-slate-600 hover:bg-slate-200 rounded-lg transition-colors"
                                >
                                    Cancel
                                </button>
                                <button
                                    onClick={async () => {
                                        setIsDocxModalOpen(false);
                                        try {
                                            const exportData = buildExportData({
                                                selectedIndices: outputSelectedQuestionIndices || undefined,
                                                titleOverride: exportTitle,
                                                shuffleQuestions: exportShuffleQuestions,
                                            });

                                            if (exportData.questions.length === 0) {
                                                throw new Error("No valid questions available for export.");
                                            }

                                            if (selectedDocxFormat === "4") {
                                                // Format 4 → server-side PDF
                                                toast.loading("Generating exam PDF…", { id: "exam-pdf" });
                                                const res = await fetch("/api/generate-exam", {
                                                    method: "POST",
                                                    headers: { "Content-Type": "application/json" },
                                                    body: JSON.stringify({
                                                        ...exportData,
                                                        includeAnswers: examPaperAnswerMode === "with-answers",
                                                        includeSections: false,
                                                    }),
                                                });
                                                toast.dismiss("exam-pdf");
                                                if (!res.ok) {
                                                    const err = await res.json().catch(() => ({}));
                                                    throw new Error(err.details || "Failed to generate exam PDF");
                                                }
                                                const blob = await res.blob();
                                                const url = URL.createObjectURL(blob);
                                                const a = document.createElement("a");
                                                a.href = url;
                                                const cd = res.headers.get("Content-Disposition") || "";
                                                const fname = cd.match(/filename\*=UTF-8''(.+)/)?.[1];
                                                a.download = fname ? decodeURIComponent(fname) : `${exportData.title || "exam"}-paper.pdf`;
                                                a.click();
                                                URL.revokeObjectURL(url);
                                                toast.success("Exam PDF downloaded!");
                                            } else {
                                                await exportToDocx(exportData, selectedDocxFormat);
                                                toast.success("DOCX downloaded");
                                            }
                                        } catch (err: any) {
                                            console.error("Export failed:", err);
                                            toast.error(err?.message || "Export failed");
                                        }
                                    }}
                                    className={`px-5 py-2.5 text-sm font-semibold text-white rounded-lg shadow-md hover:shadow-lg transition-all ${selectedDocxFormat === "4"
                                        ? "bg-purple-600 hover:bg-purple-700"
                                        : "bg-blue-600 hover:bg-blue-700"
                                        }`}
                                >
                                    {selectedDocxFormat === "4" ? "Generate Exam PDF" : "Generate DOCX"}
                                </button>
                            </div>
                        </div>
                    </div>
                )
            }
        </div>
    );
}
