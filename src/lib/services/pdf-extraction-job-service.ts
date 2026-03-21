import { promises as fs } from "fs";
import path from "path";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { invalidatePdfDocumentCaches } from "@/lib/services/pdf-document-service";
import { Question } from "@/types/pdf";

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

type ProcessingStep = {
    id: string;
    stage: string;
    status: "info" | "success" | "warning" | "error";
    message: string;
    imageName?: string;
    variant?: "original" | "enhanced";
    timestamp: string;
};

type ExtractImageResponse = {
    questions?: Question[];
    images?: SourceImageMeta[];
    warnings?: string[];
    processingSteps?: ProcessingStep[];
    quotaExceeded?: boolean;
    retryAfterSeconds?: number;
    error?: string;
};

export type DocumentExtractionJobState = {
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

const EXTRACTION_JOB_KEY = "serverExtractionJob";
const EXTRACTION_STALE_MS = 5 * 60 * 1000;
const MAX_STORED_PROCESSING_STEPS = 600;
const SERVER_EXTRACT_BATCH_SIZE = Math.max(
    4,
    Number.parseInt(process.env.SERVER_EXTRACT_BATCH_SIZE || "12", 10) || 12
);
const SERVER_EXTRACT_MAX_CONCURRENT_BATCHES = Math.max(
    1,
    Number.parseInt(process.env.SERVER_EXTRACT_MAX_CONCURRENT_BATCHES || "4", 10) || 4
);
const runningDocumentIds = new Set<string>();

function asRecord(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        return {};
    }
    return { ...(value as Record<string, unknown>) };
}

function clampNonNegativeInteger(value: unknown): number {
    const numeric = Number.parseInt(String(value ?? "0"), 10);
    if (!Number.isFinite(numeric)) return 0;
    return Math.max(0, numeric);
}

function normalizeStringArray(value: unknown): string[] {
    if (!Array.isArray(value)) return [];
    return value.map((item) => String(item ?? "").trim()).filter(Boolean);
}

function normalizeSourceImages(value: unknown): SourceImageMeta[] {
    if (!Array.isArray(value)) return [];

    const normalized = value
        .map((item) => {
            const source = asRecord(item);
            const originalImagePath = String(source.originalImagePath ?? "").trim();
            const imagePath = String(source.imagePath ?? "").trim() || originalImagePath;
            const imageName = String(source.imageName ?? "").trim();

            if (!imagePath || !imageName) return null;

            return {
                imagePath,
                originalImagePath: originalImagePath || undefined,
                imageName,
                questionCount: clampNonNegativeInteger(source.questionCount),
                processed: typeof source.processed === "boolean" ? source.processed : undefined,
                failed: typeof source.failed === "boolean" ? source.failed : undefined,
                extractionError: String(source.extractionError ?? "").trim() || undefined,
                diagramCount: clampNonNegativeInteger(source.diagramCount),
                extractionMode: source.extractionMode === "enhanced" ? "enhanced" : "original",
                averageConfidence:
                    typeof source.averageConfidence === "number"
                        ? source.averageConfidence
                        : undefined,
                qualityIssues: normalizeStringArray(source.qualityIssues).slice(0, 12),
            } satisfies SourceImageMeta;
        })
        .filter(Boolean);

    return normalized as SourceImageMeta[];
}

function createServerLocalId(prefix: string): string {
    return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function normalizeQuestions(value: unknown): Question[] {
    if (!Array.isArray(value)) return [];

    return value
        .map((item, index) => {
            const question = asRecord(item);
            const options = Array.isArray(question.options)
                ? question.options
                    .map((option) => {
                        const nextOption = asRecord(option);
                        return {
                            english: String(nextOption.english ?? "").trim(),
                            hindi: String(nextOption.hindi ?? "").trim(),
                        };
                    })
                    .slice(0, 10)
                : [];

            return {
                ...(question as unknown as Question),
                clientId: String(question.clientId ?? "").trim() || createServerLocalId("question"),
                number: String(question.number ?? index + 1).trim() || String(index + 1),
                questionHindi: String(question.questionHindi ?? "").trim(),
                questionEnglish: String(question.questionEnglish ?? "").trim(),
                answer: String(question.answer ?? question.correctAnswer ?? question.correctOption ?? question.answerKey ?? "").trim(),
                options,
            } satisfies Question;
        })
        .filter(Boolean);
}

function readProcessingSteps(value: unknown): ProcessingStep[] {
    if (!Array.isArray(value)) return [];
    return value
        .filter((item) => item && typeof item === "object")
        .map((item) => {
            const step = asRecord(item);
            const status: ProcessingStep["status"] =
                step.status === "success" || step.status === "warning" || step.status === "error"
                    ? step.status
                    : "info";
            const variant: ProcessingStep["variant"] =
                step.variant === "enhanced"
                    ? "enhanced"
                    : step.variant === "original"
                        ? "original"
                        : undefined;
            return {
                id: String(step.id ?? createServerLocalId("step")),
                stage: String(step.stage ?? "unknown"),
                status,
                message: String(step.message ?? "").trim(),
                imageName: String(step.imageName ?? "").trim() || undefined,
                variant,
                timestamp: String(step.timestamp ?? new Date().toISOString()),
            };
        })
        .filter((step) => Boolean(step.message));
}

function dedupeStrings(values: string[]): string[] {
    return Array.from(new Set(values.map((item) => item.trim()).filter(Boolean)));
}

function dedupeProcessingSteps(steps: ProcessingStep[]): ProcessingStep[] {
    const seen = new Set<string>();
    const deduped: ProcessingStep[] = [];

    for (const step of steps) {
        const signature = [
            step.stage,
            step.status,
            step.imageName || "",
            step.variant || "",
            step.message,
            step.timestamp,
        ].join("|");
        if (seen.has(signature)) continue;
        seen.add(signature);
        deduped.push(step);
    }

    return deduped.slice(-MAX_STORED_PROCESSING_STEPS);
}

function sortQuestionsByPageOrder(questions: Question[], sourceImages: SourceImageMeta[]): Question[] {
    const pageOrder = new Map(sourceImages.map((image, index) => [image.imageName, index]));

    return [...questions]
        .map((question, index) => ({ question, index }))
        .sort((left, right) => {
            const leftOrder = pageOrder.get(String(left.question.sourceImageName ?? "")) ?? Number.MAX_SAFE_INTEGER;
            const rightOrder = pageOrder.get(String(right.question.sourceImageName ?? "")) ?? Number.MAX_SAFE_INTEGER;
            if (leftOrder !== rightOrder) return leftOrder - rightOrder;
            return left.index - right.index;
        })
        .map((entry, index) => ({
            ...entry.question,
            clientId: entry.question.clientId || createServerLocalId("question"),
            number: String(index + 1),
        }));
}

function parseDataUrl(dataUrl: string): { mimeType: string; buffer: Buffer } | null {
    const match = dataUrl.match(/^data:([^;,]+)?(?:;base64)?,(.*)$/i);
    if (!match) return null;
    const mimeType = match[1] || "application/octet-stream";
    const payload = match[2] || "";
    return {
        mimeType,
        buffer: Buffer.from(payload, "base64"),
    };
}

function mimeTypeFromFileName(fileName: string): string {
    const lower = fileName.toLowerCase();
    if (lower.endsWith(".png")) return "image/png";
    if (lower.endsWith(".webp")) return "image/webp";
    if (lower.endsWith(".gif")) return "image/gif";
    return "image/jpeg";
}

async function sourceImageToFile(source: SourceImageMeta): Promise<File> {
    const candidatePath = source.imagePath || source.originalImagePath || "";
    if (!candidatePath) {
        throw new Error(`Image path is missing for ${source.imageName}.`);
    }

    if (candidatePath.startsWith("data:")) {
        const parsed = parseDataUrl(candidatePath);
        if (!parsed) {
            throw new Error(`Image data is invalid for ${source.imageName}.`);
        }
        return new File([new Uint8Array(parsed.buffer)], source.imageName, { type: parsed.mimeType });
    }

    if (/^https?:\/\//i.test(candidatePath)) {
        const response = await fetch(candidatePath, { cache: "no-store" });
        if (!response.ok) {
            throw new Error(`Failed to fetch source image ${source.imageName}.`);
        }
        const arrayBuffer = await response.arrayBuffer();
        return new File([arrayBuffer], source.imageName, {
            type: response.headers.get("content-type") || mimeTypeFromFileName(source.imageName),
        });
    }

    const relativePath = candidatePath.startsWith("/") ? candidatePath.slice(1) : candidatePath;
    const absolutePath = path.join(process.cwd(), "public", relativePath);
    const buffer = await fs.readFile(absolutePath);
    return new File([new Uint8Array(buffer)], source.imageName, {
        type: mimeTypeFromFileName(source.imageName),
    });
}

function normalizeExtractionJob(value: unknown): DocumentExtractionJobState | null {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;

    const job = asRecord(value);
    const status = job.status === "completed" || job.status === "failed" ? job.status : job.status === "running" ? "running" : null;
    if (!status) return null;

    return {
        jobId: String(job.jobId ?? "").trim() || createServerLocalId("job"),
        status,
        totalPages: clampNonNegativeInteger(job.totalPages),
        completedPages: clampNonNegativeInteger(job.completedPages),
        failedPages: clampNonNegativeInteger(job.failedPages),
        extractedQuestionCount: clampNonNegativeInteger(job.extractedQuestionCount),
        targetIndices: Array.isArray(job.targetIndices)
            ? job.targetIndices.map((item) => clampNonNegativeInteger(item))
            : [],
        processedIndices: Array.isArray(job.processedIndices)
            ? job.processedIndices.map((item) => clampNonNegativeInteger(item))
            : [],
        failedIndices: Array.isArray(job.failedIndices)
            ? job.failedIndices.map((item) => clampNonNegativeInteger(item))
            : [],
        startedAt: String(job.startedAt ?? new Date().toISOString()),
        updatedAt: String(job.updatedAt ?? new Date().toISOString()),
        completedAt: String(job.completedAt ?? "").trim() || undefined,
        retryAfterSeconds:
            job.retryAfterSeconds === undefined ? undefined : clampNonNegativeInteger(job.retryAfterSeconds),
        message: String(job.message ?? "").trim() || undefined,
        lastProcessedPageIndex:
            job.lastProcessedPageIndex === undefined ? undefined : clampNonNegativeInteger(job.lastProcessedPageIndex),
        lastProcessedPageName: String(job.lastProcessedPageName ?? "").trim() || undefined,
        error: String(job.error ?? "").trim() || undefined,
    };
}

function isRunningJobFresh(job: DocumentExtractionJobState | null): boolean {
    if (!job || job.status !== "running") return false;
    const updatedAtMs = Date.parse(job.updatedAt);
    if (!Number.isFinite(updatedAtMs)) return false;
    return Date.now() - updatedAtMs < EXTRACTION_STALE_MS;
}

function chunkItems<T>(items: T[], size: number): T[][] {
    if (size <= 0 || items.length === 0) return items.length === 0 ? [] : [items];

    const chunks: T[][] = [];
    for (let index = 0; index < items.length; index += size) {
        chunks.push(items.slice(index, index + size));
    }
    return chunks;
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

function filterWarningsForImage(warnings: string[] | undefined, imageName: string): string[] {
    if (!warnings || warnings.length === 0) return [];
    return warnings.filter((warning) => !warning.includes(":") || warning.includes(imageName));
}

export function readDocumentExtractionJob(jsonData: unknown): DocumentExtractionJobState | null {
    const payload = asRecord(jsonData);
    return normalizeExtractionJob(payload[EXTRACTION_JOB_KEY]);
}

type JobContext = {
    documentId: string;
    origin: string;
    cookieHeader?: string;
    indices: number[];
    initialJob: DocumentExtractionJobState;
};

type QueueResult =
    | { started: true; job: DocumentExtractionJobState }
    | { started: false; job: DocumentExtractionJobState; reason: "already_running" };

async function persistDocumentPayload(documentId: string, payload: Record<string, unknown>) {
    await prisma.pdfDocument.update({
        where: { id: documentId },
        data: {
            jsonData: payload as Prisma.InputJsonValue,
        },
    });
    invalidatePdfDocumentCaches();
}

async function loadDocumentPayload(documentId: string): Promise<Record<string, unknown>> {
    const document = await prisma.pdfDocument.findUnique({
        where: { id: documentId },
        select: { jsonData: true },
    });

    if (!document) {
        throw new Error("Workspace document was not found.");
    }

    return asRecord(document.jsonData);
}

async function markJobState(
    documentId: string,
    updater: (payload: Record<string, unknown>) => Record<string, unknown>
) {
    const payload = await loadDocumentPayload(documentId);
    const nextPayload = updater(payload);
    await persistDocumentPayload(documentId, nextPayload);
    return nextPayload;
}

async function runDocumentExtractionJob(context: JobContext) {
    const { documentId, origin, cookieHeader, indices, initialJob } = context;
    runningDocumentIds.add(documentId);

    let jobState = initialJob;
    let workingPayload = await loadDocumentPayload(documentId);
    const pageBatches = chunkItems(indices, SERVER_EXTRACT_BATCH_SIZE);
    const stableSourceImages = normalizeSourceImages(workingPayload.sourceImages);
    const quotaControl: {
        halted: boolean;
        retryAfterSeconds?: number;
        message?: string;
    } = {
        halted: false,
    };
    let mutationQueue: Promise<void> = Promise.resolve();

    const enqueueMutation = async <T>(mutator: () => Promise<T>): Promise<T> => {
        let resolveResult: (value: T | PromiseLike<T>) => void = () => undefined;
        let rejectResult: (reason?: unknown) => void = () => undefined;
        const result = new Promise<T>((resolve, reject) => {
            resolveResult = resolve;
            rejectResult = reject;
        });

        mutationQueue = mutationQueue.then(async () => {
            try {
                resolveResult(await mutator());
            } catch (error) {
                rejectResult(error);
            }
        });

        await result;
        return result;
    };

    const markPageOutcome = async (args: {
        pageIndex: number;
        extractedQuestions?: Question[];
        warnings?: string[];
        processingSteps?: ProcessingStep[];
        imageSummary?: SourceImageMeta | undefined;
        message: string;
        extractionError?: string;
        retryAfterSeconds?: number;
        pageFailed: boolean;
    }) => {
        await enqueueMutation(async () => {
            const currentQuestions = normalizeQuestions(workingPayload.questions);
            const currentSourceImages = normalizeSourceImages(workingPayload.sourceImages);
            const currentWarnings = normalizeStringArray(workingPayload.extractionWarnings);
            const currentSteps = readProcessingSteps(workingPayload.extractionProcessingSteps);
            const sourceImage = currentSourceImages[args.pageIndex] || stableSourceImages[args.pageIndex];

            if (!sourceImage) {
                jobState = {
                    ...jobState,
                    completedPages: jobState.completedPages + 1,
                    failedPages: jobState.failedPages + 1,
                    processedIndices: dedupeStrings([
                        ...jobState.processedIndices.map(String),
                        String(args.pageIndex),
                    ]).map((value) => clampNonNegativeInteger(value)),
                    failedIndices: dedupeStrings([
                        ...jobState.failedIndices.map(String),
                        String(args.pageIndex),
                    ]).map((value) => clampNonNegativeInteger(value)),
                    updatedAt: new Date().toISOString(),
                    retryAfterSeconds: args.retryAfterSeconds ?? jobState.retryAfterSeconds,
                    lastProcessedPageIndex: args.pageIndex,
                    message: args.message,
                    error: args.extractionError || jobState.error,
                };

                workingPayload = {
                    ...workingPayload,
                    [EXTRACTION_JOB_KEY]: jobState,
                };
                await persistDocumentPayload(documentId, workingPayload);
                return;
            }

            const pageImageName = sourceImage.imageName;
            const existingPageQuestions = currentQuestions.filter(
                (question) => String(question.sourceImageName ?? "").trim() === pageImageName
            );
            const nextPageQuestions =
                args.pageFailed && existingPageQuestions.length > 0
                    ? existingPageQuestions
                    : normalizeQuestions(args.extractedQuestions || []);
            const preservedQuestions = currentQuestions.filter(
                (question) => String(question.sourceImageName ?? "").trim() !== pageImageName
            );
            const nextQuestions = sortQuestionsByPageOrder(
                [...preservedQuestions, ...nextPageQuestions],
                currentSourceImages
            );

            const effectiveFailure = args.pageFailed && existingPageQuestions.length === 0;
            const nextQuestionCount = nextQuestions.filter(
                (question) => String(question.sourceImageName ?? "").trim() === pageImageName
            ).length;

            const nextSourceImages = currentSourceImages.map((image, index) => {
                if (index !== args.pageIndex) return image;
                return {
                    ...image,
                    questionCount: nextQuestionCount,
                    processed: !effectiveFailure && nextQuestionCount > 0,
                    failed: effectiveFailure,
                    extractionError:
                        effectiveFailure
                            ? args.extractionError || "No questions detected. Please retry extraction."
                            : undefined,
                    diagramCount: args.imageSummary?.diagramCount ?? image.diagramCount ?? 0,
                    extractionMode: args.imageSummary?.extractionMode ?? image.extractionMode ?? "original",
                    averageConfidence: args.imageSummary?.averageConfidence ?? image.averageConfidence,
                    qualityIssues: args.imageSummary?.qualityIssues ?? image.qualityIssues ?? [],
                } satisfies SourceImageMeta;
            });

            const processedIndices = new Set<number>(jobState.processedIndices);
            processedIndices.add(args.pageIndex);
            const failedIndices = new Set<number>(jobState.failedIndices);
            if (effectiveFailure) {
                failedIndices.add(args.pageIndex);
            } else {
                failedIndices.delete(args.pageIndex);
            }

            jobState = {
                ...jobState,
                completedPages: jobState.completedPages + 1,
                failedPages: jobState.failedPages + (effectiveFailure ? 1 : 0),
                extractedQuestionCount: jobState.extractedQuestionCount + (args.pageFailed ? 0 : nextQuestionCount),
                processedIndices: Array.from(processedIndices).sort((left, right) => left - right),
                failedIndices: Array.from(failedIndices).sort((left, right) => left - right),
                updatedAt: new Date().toISOString(),
                retryAfterSeconds: args.retryAfterSeconds ?? jobState.retryAfterSeconds,
                lastProcessedPageIndex: args.pageIndex,
                lastProcessedPageName: pageImageName,
                message: args.message,
                error:
                    effectiveFailure
                        ? args.extractionError || jobState.error
                        : jobState.error,
            };

            const nextPayload: Record<string, unknown> = {
                ...workingPayload,
                questions: nextQuestions,
                sourceImages: nextSourceImages,
                extractionWarnings: dedupeStrings([
                    ...currentWarnings,
                    ...(args.warnings || []),
                ]),
                extractionProcessingSteps: dedupeProcessingSteps([
                    ...currentSteps,
                    ...(args.processingSteps || []),
                ]),
                [EXTRACTION_JOB_KEY]: jobState,
            };

            workingPayload = nextPayload;
            await persistDocumentPayload(documentId, nextPayload);
        });
    };

    const processPageBatch = async (
        batchIndices: number[],
        batchIndex: number,
        totalBatches: number
    ) => {
        if (quotaControl.halted) {
            for (const pageIndex of batchIndices) {
                await markPageOutcome({
                    pageIndex,
                    message: `Skipped page ${pageIndex + 1} because extraction paused after a Gemini rate limit in batch ${batchIndex + 1}/${totalBatches}.`,
                    extractionError:
                        quotaControl.message ||
                        "Gemini quota/rate limit reached before this page could be processed.",
                    retryAfterSeconds: quotaControl.retryAfterSeconds,
                    pageFailed: true,
                });
            }
            return;
        }

        const batchEntries = batchIndices.map((pageIndex) => ({
            pageIndex,
            sourceImage: stableSourceImages[pageIndex],
        }));
        const validEntries = batchEntries.filter(
            (entry): entry is { pageIndex: number; sourceImage: SourceImageMeta } =>
                Boolean(entry.sourceImage)
        );

        for (const entry of batchEntries) {
            if (entry.sourceImage) continue;
            await markPageOutcome({
                pageIndex: entry.pageIndex,
                message: `Page ${entry.pageIndex + 1} is missing from the workspace.`,
                extractionError: `Page ${entry.pageIndex + 1} is missing from the workspace.`,
                pageFailed: true,
            });
        }

        if (validEntries.length === 0) {
            return;
        }

        try {
            const pageFiles = await Promise.all(
                validEntries.map(({ sourceImage }) => sourceImageToFile(sourceImage))
            );
            const formData = new FormData();
            pageFiles.forEach((pageFile) => formData.append("images", pageFile));

            const response = await fetch(`${origin}/api/extract-image`, {
                method: "POST",
                headers: cookieHeader ? { cookie: cookieHeader } : undefined,
                body: formData,
                cache: "no-store",
            });

            const result = (await response.json().catch(() => ({}))) as ExtractImageResponse;
            const extractedQuestions = normalizeQuestions(result.questions);
            const imageSummaries = new Map(
                (result.images || []).map((item) => [item.imageName, item])
            );

            if ((response.status === 429 || result.quotaExceeded) && !quotaControl.halted) {
                quotaControl.halted = true;
                quotaControl.retryAfterSeconds = result.retryAfterSeconds;
                quotaControl.message =
                    result.error ||
                    "Gemini quota/rate limit reached before extraction could complete.";
            }

            for (const { pageIndex, sourceImage } of validEntries) {
                const imageSummary = imageSummaries.get(sourceImage.imageName);
                const pageQuestions = extractedQuestions.filter(
                    (question) => question.sourceImageName === sourceImage.imageName
                );
                const pageWarnings = filterWarningsForImage(
                    result.warnings,
                    sourceImage.imageName
                );
                const pageProcessingSteps = (result.processingSteps || []).filter(
                    (step) => step.imageName === sourceImage.imageName
                );
                const pageFailed =
                    pageQuestions.length === 0 ||
                    (!response.ok && pageQuestions.length === 0);
                const extractionError = pageFailed
                    ? imageSummary?.extractionError ||
                    result.error ||
                    (result.quotaExceeded
                        ? "Gemini quota/rate limit reached for this page."
                        : "No questions detected. Please retry extraction.")
                    : undefined;

                await markPageOutcome({
                    pageIndex,
                    extractedQuestions: pageQuestions,
                    warnings: pageWarnings,
                    processingSteps: pageProcessingSteps,
                    imageSummary,
                    message: pageFailed
                        ? pageQuestions.length > 0
                            ? `Page ${pageIndex + 1} returned partial content and needs review.`
                            : `Page ${pageIndex + 1} needs retry.`
                        : `Page ${pageIndex + 1} extracted successfully in batch ${batchIndex + 1}/${totalBatches}.`,
                    extractionError,
                    retryAfterSeconds: result.retryAfterSeconds,
                    pageFailed,
                });
            }
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            for (const { pageIndex } of validEntries) {
                await markPageOutcome({
                    pageIndex,
                    message: `Page ${pageIndex + 1} failed during extraction.`,
                    extractionError: message,
                    pageFailed: true,
                });
            }
        }
    };

    try {
        await runWithConcurrency(
            pageBatches,
            SERVER_EXTRACT_MAX_CONCURRENT_BATCHES,
            async (batchIndices, batchIndex) => {
                await enqueueMutation(async () => {
                    jobState = {
                        ...jobState,
                        updatedAt: new Date().toISOString(),
                        message: `Running batch ${batchIndex + 1}/${pageBatches.length} with ${batchIndices.length} page(s).`,
                    };
                    workingPayload = {
                        ...workingPayload,
                        [EXTRACTION_JOB_KEY]: jobState,
                    };
                    await persistDocumentPayload(documentId, workingPayload);
                });

                await processPageBatch(batchIndices, batchIndex, pageBatches.length);
            }
        );

        await enqueueMutation(async () => {
            const remainingCount = Math.max(
                0,
                jobState.totalPages - jobState.completedPages
            );
            const rateLimitMessage =
                quotaControl.message ||
                "Gemini quota/rate limit reached before extraction could complete.";

            jobState = {
                ...jobState,
                status: quotaControl.halted ? "failed" : "completed",
                updatedAt: new Date().toISOString(),
                completedAt: new Date().toISOString(),
                retryAfterSeconds: quotaControl.retryAfterSeconds ?? jobState.retryAfterSeconds,
                message: quotaControl.halted
                    ? `Extraction paused by Gemini rate limits. ${jobState.completedPages} page(s) processed, ${Math.max(jobState.failedPages, remainingCount)} page(s) need retry.`
                    : jobState.failedPages > 0
                        ? `${jobState.completedPages} page(s) processed. ${jobState.failedPages} page(s) still need retry.`
                        : `All ${jobState.completedPages} page(s) extracted successfully.`,
                error: quotaControl.halted
                    ? rateLimitMessage
                    : jobState.failedPages > 0
                        ? jobState.error
                        : undefined,
            };

            workingPayload = {
                ...workingPayload,
                [EXTRACTION_JOB_KEY]: jobState,
            };
            await persistDocumentPayload(documentId, workingPayload);
        });
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        jobState = {
            ...jobState,
            status: "failed",
            updatedAt: new Date().toISOString(),
            completedAt: new Date().toISOString(),
            message,
            error: message,
        };

        try {
            workingPayload = {
                ...workingPayload,
                [EXTRACTION_JOB_KEY]: jobState,
            };
            await persistDocumentPayload(documentId, workingPayload);
        } catch (persistError) {
            console.error("Failed to persist extraction job failure:", persistError);
        }
    } finally {
        runningDocumentIds.delete(documentId);
    }
}

export async function queueDocumentExtractionJob(options: {
    documentId: string;
    jsonData: unknown;
    indices: number[];
    origin: string;
    cookieHeader?: string;
}): Promise<QueueResult> {
    const existingJob = readDocumentExtractionJob(options.jsonData);
    if (runningDocumentIds.has(options.documentId) || isRunningJobFresh(existingJob)) {
        return {
            started: false,
            job:
                existingJob ||
                {
                    jobId: createServerLocalId("job"),
                    status: "running",
                    totalPages: options.indices.length,
                    completedPages: 0,
                    failedPages: 0,
                    extractedQuestionCount: 0,
                    targetIndices: options.indices,
                    processedIndices: [],
                    failedIndices: [],
                    startedAt: new Date().toISOString(),
                    updatedAt: new Date().toISOString(),
                    message: "Extraction is already running for this workspace.",
                },
            reason: "already_running",
        };
    }

    const now = new Date().toISOString();
    const initialJob: DocumentExtractionJobState = {
        jobId: createServerLocalId("job"),
        status: "running",
        totalPages: options.indices.length,
        completedPages: 0,
        failedPages: 0,
        extractedQuestionCount: 0,
        targetIndices: options.indices,
        processedIndices: [],
        failedIndices: [],
        startedAt: now,
        updatedAt: now,
        message: `Queued ${options.indices.length} page(s) for server extraction in ${Math.max(
            1,
            Math.ceil(options.indices.length / SERVER_EXTRACT_BATCH_SIZE)
        )} batch(es) of up to ${SERVER_EXTRACT_BATCH_SIZE}.`,
    };

    const payload = asRecord(options.jsonData);
    await persistDocumentPayload(options.documentId, {
        ...payload,
        [EXTRACTION_JOB_KEY]: initialJob,
    });

    void runDocumentExtractionJob({
        documentId: options.documentId,
        origin: options.origin,
        cookieHeader: options.cookieHeader,
        indices: options.indices,
        initialJob,
    });

    return { started: true, job: initialJob };
}
