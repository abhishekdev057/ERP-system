type PageStatus = "searchable" | "ocr";

export type BookReaderPageState = {
    status: PageStatus;
    questionCount: number;
    extractedAt: string;
    preview?: string;
};

export type BookPreparedSetState = {
    name: string;
    extractorDocumentId: string;
    questionCount: number;
    createdAt: string;
};

export type BookReaderState = {
    version: 1;
    pages: Record<string, BookReaderPageState>;
    preparedSets: BookPreparedSetState[];
    updatedAt: string;
};

export type BookReaderStats = {
    totalPages: number;
    extractedPages: number;
    searchablePages: number;
    ocrPages: number;
    notExtractedPages: number;
    extractedQuestionCount: number;
    preparedSetCount: number;
    hasAnyExtraction: boolean;
    statusLabel: string;
};

function toNonNegativeInteger(value: unknown): number {
    const numeric = Number.parseInt(String(value ?? "0"), 10);
    if (!Number.isFinite(numeric) || numeric < 0) return 0;
    return numeric;
}

function normalizeText(value: unknown, max = 220): string {
    const normalized = String(value ?? "").replace(/\s+/g, " ").trim();
    if (normalized.length <= max) return normalized;
    return `${normalized.slice(0, max - 1).trim()}...`;
}

export function normalizeBookReaderState(value: unknown): BookReaderState {
    const raw = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
    const rawPages = raw.pages && typeof raw.pages === "object" ? (raw.pages as Record<string, unknown>) : {};
    const rawPreparedSets = Array.isArray(raw.preparedSets) ? raw.preparedSets : [];

    const pages = Object.entries(rawPages).reduce<Record<string, BookReaderPageState>>(
        (accumulator, [pageKey, pageValue]) => {
            const page =
                pageValue && typeof pageValue === "object"
                    ? (pageValue as Record<string, unknown>)
                    : {};
            const status =
                page.status === "ocr" ? "ocr" : page.status === "searchable" ? "searchable" : null;

            if (!status) {
                return accumulator;
            }

            accumulator[pageKey] = {
                status,
                questionCount: toNonNegativeInteger(page.questionCount),
                extractedAt:
                    normalizeText(page.extractedAt, 80) || new Date().toISOString(),
                preview: normalizeText(page.preview, 160) || undefined,
            };
            return accumulator;
        },
        {}
    );

    const preparedSets = rawPreparedSets
        .map((item) => {
            const prepared =
                item && typeof item === "object" ? (item as Record<string, unknown>) : {};
            const extractorDocumentId = normalizeText(prepared.extractorDocumentId, 80);
            if (!extractorDocumentId) return null;

            return {
                name: normalizeText(prepared.name, 160) || "Prepared Set",
                extractorDocumentId,
                questionCount: toNonNegativeInteger(prepared.questionCount),
                createdAt: normalizeText(prepared.createdAt, 80) || new Date().toISOString(),
            } satisfies BookPreparedSetState;
        })
        .filter((entry): entry is BookPreparedSetState => Boolean(entry));

    return {
        version: 1,
        pages,
        preparedSets,
        updatedAt: normalizeText(raw.updatedAt, 80) || new Date().toISOString(),
    };
}

export function computeBookReaderStats(
    readerState: unknown,
    pageCount: number | null | undefined
): BookReaderStats {
    const normalized = normalizeBookReaderState(readerState);
    const totalPages = Math.max(
        toNonNegativeInteger(pageCount),
        Object.keys(normalized.pages).length
    );
    const pageStates = Object.values(normalized.pages);
    const searchablePages = pageStates.filter((page) => page.status === "searchable").length;
    const ocrPages = pageStates.filter((page) => page.status === "ocr").length;
    const extractedPages = searchablePages + ocrPages;
    const notExtractedPages = Math.max(totalPages - extractedPages, 0);
    const extractedQuestionCount = pageStates.reduce(
        (sum, page) => sum + toNonNegativeInteger(page.questionCount),
        0
    );
    const preparedSetCount = normalized.preparedSets.length;
    const hasAnyExtraction = extractedPages > 0 || preparedSetCount > 0 || extractedQuestionCount > 0;
    const statusLabel =
        totalPages > 0 && extractedPages >= totalPages
            ? "Fully extracted"
            : hasAnyExtraction
              ? "Partially extracted"
              : "Nothing extracted yet";

    return {
        totalPages,
        extractedPages,
        searchablePages,
        ocrPages,
        notExtractedPages,
        extractedQuestionCount,
        preparedSetCount,
        hasAnyExtraction,
        statusLabel,
    };
}

export function upsertBookReaderPageState(
    currentState: unknown,
    input: {
        pageNumber: number;
        status: PageStatus;
        questionCount?: number;
        preview?: string;
    }
): BookReaderState {
    const current = normalizeBookReaderState(currentState);
    const key = String(Math.max(1, toNonNegativeInteger(input.pageNumber)));
    const previous = current.pages[key];
    const nextStatus =
        previous?.status === "ocr" && input.status === "searchable" ? "ocr" : input.status;
    const nextQuestionCount = Math.max(
        toNonNegativeInteger(input.questionCount),
        toNonNegativeInteger(previous?.questionCount)
    );

    return {
        ...current,
        pages: {
            ...current.pages,
            [key]: {
                status: nextStatus,
                questionCount: nextQuestionCount,
                extractedAt: new Date().toISOString(),
                preview: normalizeText(input.preview, 160) || previous?.preview,
            },
        },
        updatedAt: new Date().toISOString(),
    };
}

export function appendPreparedSetToReaderState(
    currentState: unknown,
    input: {
        name: string;
        extractorDocumentId: string;
        questionCount: number;
    }
): BookReaderState {
    const current = normalizeBookReaderState(currentState);
    const deduped = current.preparedSets.filter(
        (item) => item.extractorDocumentId !== input.extractorDocumentId
    );

    return {
        ...current,
        preparedSets: [
            {
                name: normalizeText(input.name, 160) || "Prepared Set",
                extractorDocumentId: normalizeText(input.extractorDocumentId, 80),
                questionCount: toNonNegativeInteger(input.questionCount),
                createdAt: new Date().toISOString(),
            },
            ...deduped,
        ].slice(0, 40),
        updatedAt: new Date().toISOString(),
    };
}
