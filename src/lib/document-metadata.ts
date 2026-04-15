import { extractTopicSlidesFromDocument } from "@/lib/slide-topics";

export function normalizeAssignedUserIds(assignedUserIds: unknown): string[] {
    if (!Array.isArray(assignedUserIds)) return [];
    return Array.from(
        new Set(
            assignedUserIds
                .map((item) => String(item || "").trim())
                .filter(Boolean)
        )
    );
}

export function extractAssignedUserIds(jsonData: unknown): string[] {
    if (!jsonData || typeof jsonData !== "object") return [];
    const payload = jsonData as Record<string, unknown>;
    if (!payload._access || typeof payload._access !== "object") return [];
    const access = payload._access as Record<string, unknown>;
    return normalizeAssignedUserIds(access.assignedUserIds);
}

export function resolveAssignedUserIds(
    jsonData: unknown,
    assignedUserIds?: unknown
): string[] {
    const normalizedAssignedUserIds = normalizeAssignedUserIds(assignedUserIds);
    return normalizedAssignedUserIds.length > 0
        ? normalizedAssignedUserIds
        : extractAssignedUserIds(jsonData);
}

export function withAssignedUserIds(
    jsonData: unknown,
    assignedUserIds: string[]
): Record<string, unknown> {
    const payload =
        jsonData && typeof jsonData === "object"
            ? ({ ...(jsonData as Record<string, unknown>) } as Record<string, unknown>)
            : {};
    const access =
        payload._access && typeof payload._access === "object"
            ? ({ ...(payload._access as Record<string, unknown>) } as Record<string, unknown>)
            : {};

    access.assignedUserIds = normalizeAssignedUserIds(assignedUserIds);
    access.assignedAt = new Date().toISOString();

    payload._access = access;
    return payload;
}

export function extractCorrectionMarkCount(jsonData: unknown): number {
    if (!jsonData || typeof jsonData !== "object") return 0;
    const payload = jsonData as Record<string, unknown>;
    const marks = Array.isArray(payload.correctionMarks) ? payload.correctionMarks : [];
    return marks.length;
}

export type DocumentWorkspaceStats = {
    pageCount: number;
    questionCount: number;
    topicCount: number;
    extractedPageCount: number;
    pendingPageCount: number;
    extractionState: "not_started" | "partial" | "extracted";
};

function readTextValue(value: unknown): string {
    return typeof value === "string" ? value.trim() : "";
}

function isMeaningfulQuestion(question: unknown): boolean {
    if (!question || typeof question !== "object") return false;
    const payload = question as Record<string, unknown>;
    const options = Array.isArray(payload.options) ? payload.options : [];
    const hasPrompt = Boolean(readTextValue(payload.questionHindi) || readTextValue(payload.questionEnglish));
    const hasOptionText = options.some((option) => {
        if (!option || typeof option !== "object") return false;
        const optionPayload = option as Record<string, unknown>;
        return Boolean(readTextValue(optionPayload.hindi) || readTextValue(optionPayload.english));
    });
    return hasPrompt || hasOptionText;
}

function extractPageCountFromPayload(payload: Record<string, unknown>, sourceImages: unknown[]) {
    if (sourceImages.length > 0) return sourceImages.length;

    const directPageCount = Number(payload.pageCount || payload.totalPages || 0);
    if (Number.isFinite(directPageCount) && directPageCount > 0) {
        return Math.max(0, Math.trunc(directPageCount));
    }

    const meta = payload._job;
    if (meta && typeof meta === "object") {
        const nestedPageCount = Number((meta as Record<string, unknown>).totalPages || 0);
        if (Number.isFinite(nestedPageCount) && nestedPageCount > 0) {
            return Math.max(0, Math.trunc(nestedPageCount));
        }
    }

    return 0;
}

export function extractDocumentWorkspaceStats(jsonData: unknown): DocumentWorkspaceStats {
    if (!jsonData || typeof jsonData !== "object") {
        return {
            pageCount: 0,
            questionCount: 0,
            topicCount: 0,
            extractedPageCount: 0,
            pendingPageCount: 0,
            extractionState: "not_started",
        };
    }

    const payload = jsonData as Record<string, unknown>;
    const sourceImages = Array.isArray(payload.sourceImages) ? payload.sourceImages : [];
    const questions = Array.isArray(payload.questions) ? payload.questions : [];
    const meaningfulQuestions = questions.filter(isMeaningfulQuestion);
    const questionCount = meaningfulQuestions.length;
    const topicCount = extractTopicSlidesFromDocument(payload).length;
    const pageCount = extractPageCountFromPayload(payload, sourceImages);

    const questionCountByImageName = new Map<string, number>();
    meaningfulQuestions.forEach((item) => {
        const questionPayload = item as Record<string, unknown>;
        const sourceImageName = readTextValue(questionPayload.sourceImageName || questionPayload.imageName);
        if (!sourceImageName) return;
        questionCountByImageName.set(sourceImageName, (questionCountByImageName.get(sourceImageName) || 0) + 1);
    });

    let extractedPageCount = 0;
    if (sourceImages.length > 0) {
        extractedPageCount = sourceImages.reduce((count, item) => {
            if (!item || typeof item !== "object") return count;
            const imagePayload = item as Record<string, unknown>;
            const imageName = readTextValue(imagePayload.imageName || imagePayload.sourceImageName);
            const explicitQuestionCount = Number(imagePayload.questionCount || 0);
            const resolvedQuestionCount =
                Number.isFinite(explicitQuestionCount) && explicitQuestionCount > 0
                    ? Math.trunc(explicitQuestionCount)
                    : questionCountByImageName.get(imageName) || 0;
            const processed = Boolean(imagePayload.processed);
            const failed = Boolean(imagePayload.failed || imagePayload.extractionError);
            if (!failed && (processed || resolvedQuestionCount > 0)) {
                return count + 1;
            }
            return count;
        }, 0);
    } else if (topicCount > 0) {
        const topicSourcePages = Array.isArray(payload.topicSourcePages) ? payload.topicSourcePages : [];
        extractedPageCount = topicSourcePages.length > 0 ? topicSourcePages.length : pageCount || 1;
    } else if (questionCount > 0) {
        extractedPageCount = 1;
    }

    const pendingPageCount = Math.max(pageCount - extractedPageCount, 0);
    const extractionState =
        questionCount === 0 && topicCount === 0
            ? "not_started"
            : pendingPageCount > 0
                ? "partial"
                : "extracted";

    return {
        pageCount,
        questionCount,
        topicCount,
        extractedPageCount,
        pendingPageCount,
        extractionState,
    };
}
