"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import toast from "react-hot-toast";
import {
    BookOpenText,
    CheckCircle2,
    ChevronLeft,
    ChevronRight,
    Crop,
    FileText,
    Hand,
    Loader2,
    MousePointerSquareDashed,
    Plus,
    ScanText,
    Sparkles,
    SquareDashedMousePointer,
    ZoomIn,
    ZoomOut,
} from "lucide-react";
import {
    computeBookReaderStats,
    normalizeBookReaderState,
    upsertBookReaderPageState,
} from "@/lib/book-reader-state";
import { Question } from "@/types/pdf";

type BookReaderWorkspaceProps = {
    book: {
        id: string;
        title: string;
        description?: string;
        fileName: string;
        filePath: string;
        fileSize: number;
        category: string;
        classLevel?: string;
        extractedText?: string;
        pageCount?: number;
        uploadedAt: string;
        readerState?: unknown;
        workspaceStats?: {
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
    };
    onWorkspaceChange?: (payload: {
        pageCount: number;
        workspaceStats: {
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
        preparedDocumentId: string | null;
        preparedSetName: string | null;
    }) => void;
};

type PdfRuntimeLike = {
    GlobalWorkerOptions: {
        workerSrc: string;
    };
    Util: {
        transform: (a: number[], b: number[]) => number[];
    };
    getDocument: (input: unknown) => { promise: Promise<any>; destroy?: () => void };
};

type PageTextFragment = {
    text: string;
    x: number;
    y: number;
    width: number;
    height: number;
};

type PageContentEntry = {
    text: string;
    preview: string;
    questions: Question[];
    fragments: PageTextFragment[];
    source: "pdf-text" | "ocr";
    hasSearchableText: boolean;
    extractedAt: string;
};

type SelectionBounds = {
    x: number;
    y: number;
    width: number;
    height: number;
};

type SelectionEntry = {
    id: string;
    pageNumber: number;
    bounds: SelectionBounds;
    text: string;
    questions: Question[];
    imagePath?: string;
    imageName?: string;
    status: "processing" | "ready" | "error";
    createdAt: string;
    error?: string;
};

type SelectionDraft = {
    startX: number;
    startY: number;
    endX: number;
    endY: number;
};

type ToolMode = "select" | "pan";

const MIN_ZOOM = 0.7;
const MAX_ZOOM = 2.6;
const ZOOM_STEP = 0.15;
const BOOK_EXTRACTION_CONCURRENCY = 3;

function normalizeWhitespace(value: string): string {
    return value
        .replace(/[ \t]+/g, " ")
        .replace(/\s+([,.;:!?])/g, "$1")
        .trim();
}

function formatTextFragments(fragments: PageTextFragment[]): string {
    if (fragments.length === 0) return "";

    const sorted = [...fragments].sort((left, right) => {
        const deltaY = left.y - right.y;
        if (Math.abs(deltaY) <= Math.max(6, Math.min(left.height, right.height) * 0.55)) {
            return left.x - right.x;
        }
        return deltaY;
    });

    const lines: Array<{ y: number; fragments: PageTextFragment[] }> = [];

    sorted.forEach((fragment) => {
        const existing = lines.find(
            (line) =>
                Math.abs(line.y - fragment.y) <=
                Math.max(7, Math.min(fragment.height, line.fragments[0]?.height || fragment.height) * 0.65)
        );

        if (existing) {
            existing.fragments.push(fragment);
            existing.y = Math.min(existing.y, fragment.y);
            return;
        }

        lines.push({
            y: fragment.y,
            fragments: [fragment],
        });
    });

    return lines
        .sort((left, right) => left.y - right.y)
        .map((line) =>
            normalizeWhitespace(
                line.fragments
                    .sort((left, right) => left.x - right.x)
                    .map((fragment) => fragment.text)
                    .join(" ")
            )
        )
        .filter(Boolean)
        .join("\n");
}

function intersects(bounds: SelectionBounds, fragment: PageTextFragment) {
    const overlapWidth =
        Math.min(bounds.x + bounds.width, fragment.x + fragment.width) - Math.max(bounds.x, fragment.x);
    const overlapHeight =
        Math.min(bounds.y + bounds.height, fragment.y + fragment.height) - Math.max(bounds.y, fragment.y);

    return overlapWidth > 0 && overlapHeight > 0;
}

function clampRect(draft: SelectionDraft, width: number, height: number): SelectionBounds {
    const x = Math.max(0, Math.min(draft.startX, draft.endX));
    const y = Math.max(0, Math.min(draft.startY, draft.endY));
    const maxX = Math.max(0, Math.max(draft.startX, draft.endX));
    const maxY = Math.max(0, Math.max(draft.startY, draft.endY));

    return {
        x: Math.min(x, width),
        y: Math.min(y, height),
        width: Math.min(maxX, width) - Math.min(x, width),
        height: Math.min(maxY, height) - Math.min(y, height),
    };
}

function isMeaningfulRect(bounds: SelectionBounds) {
    return bounds.width >= 24 && bounds.height >= 24;
}

function buildPreview(text: string, max = 120) {
    const normalized = normalizeWhitespace(text.replace(/\n+/g, " "));
    if (normalized.length <= max) return normalized;
    return `${normalized.slice(0, max - 1).trim()}...`;
}

function clampZoom(value: number) {
    return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Number(value.toFixed(2))));
}

async function runWithConcurrency<T>(
    items: T[],
    concurrency: number,
    task: (item: T, index: number) => Promise<void>
) {
    const workerCount = Math.max(1, Math.min(concurrency, items.length || 1));
    let cursor = 0;

    await Promise.all(
        Array.from({ length: workerCount }, async () => {
            while (true) {
                const index = cursor;
                cursor += 1;
                if (index >= items.length) {
                    break;
                }
                await task(items[index], index);
            }
        })
    );
}

function renumberQuestions(questions: Question[]): Question[] {
    return questions.map((question, index) => ({
        ...question,
        number: String(index + 1),
    }));
}

function extractTextFragments(
    items: any[],
    viewport: any,
    pdfRuntime: PdfRuntimeLike
): PageTextFragment[] {
    return items
        .map((item: any) => {
            const rawText = normalizeWhitespace(String(item?.str || ""));
            if (!rawText) return null;

            const transform = pdfRuntime.Util.transform(viewport.transform, item.transform);
            const width = Math.max(
                1,
                Number.isFinite(item.width) ? item.width * viewport.scale : 1
            );
            const height = Math.max(
                10,
                Math.hypot(transform[2], transform[3]) ||
                    (Number(item.height) || 0) * viewport.scale ||
                    10
            );

            return {
                text: rawText,
                x: transform[4],
                y: transform[5] - height,
                width,
                height,
            } satisfies PageTextFragment;
        })
        .filter((fragment: PageTextFragment | null): fragment is PageTextFragment => Boolean(fragment));
}

async function cropCanvasToFile(
    canvas: HTMLCanvasElement,
    bounds: SelectionBounds,
    fileName: string
): Promise<File> {
    const tempCanvas = document.createElement("canvas");
    tempCanvas.width = Math.max(1, Math.round(bounds.width));
    tempCanvas.height = Math.max(1, Math.round(bounds.height));

    const context = tempCanvas.getContext("2d");
    if (!context) {
        throw new Error("Could not initialize crop canvas.");
    }

    context.drawImage(
        canvas,
        Math.round(bounds.x),
        Math.round(bounds.y),
        Math.round(bounds.width),
        Math.round(bounds.height),
        0,
        0,
        tempCanvas.width,
        tempCanvas.height
    );

    const blob = await new Promise<Blob | null>((resolve) => {
        tempCanvas.toBlob((nextBlob) => resolve(nextBlob), "image/jpeg", 0.92);
    });

    tempCanvas.width = 0;
    tempCanvas.height = 0;

    if (!blob) {
        throw new Error("Failed to create cropped image.");
    }

    return new File([blob], fileName, { type: "image/jpeg" });
}

async function uploadSelectionSnippet(
    file: File,
    scopeId: string
): Promise<{ imagePath: string; imageName: string }> {
    const formData = new FormData();
    formData.append("file", file, file.name);
    formData.append("filename", file.name);
    formData.append("documentId", scopeId);

    const response = await fetch("/api/uploads/pdf-page", {
        method: "POST",
        body: formData,
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
        throw new Error(data.error || "Failed to save selected snippet image.");
    }

    return {
        imagePath: String(data.imagePath || "").trim(),
        imageName: String(data.filename || file.name).trim() || file.name,
    };
}

export default function BookReaderWorkspace({ book, onWorkspaceChange }: BookReaderWorkspaceProps) {
    const pdfRuntimeRef = useRef<PdfRuntimeLike | null>(null);
    const pdfDocumentRef = useRef<any | null>(null);
    const canvasRef = useRef<HTMLCanvasElement | null>(null);
    const pageRenderHostRef = useRef<HTMLDivElement | null>(null);
    const readerStateRef = useRef(normalizeBookReaderState(book.readerState));
    const pageContentRef = useRef<Record<number, PageContentEntry>>({});
    const pageSyncSignatureRef = useRef<Record<string, string>>({});
    const panSessionRef = useRef<{
        pointerId: number;
        startX: number;
        startY: number;
        scrollLeft: number;
        scrollTop: number;
    } | null>(null);

    const [pageCount, setPageCount] = useState<number>(book.pageCount || 0);
    const [currentPage, setCurrentPage] = useState(1);
    const [zoom, setZoom] = useState(1);
    const [canvasSize, setCanvasSize] = useState({ width: 0, height: 0 });
    const [loadingDocument, setLoadingDocument] = useState(true);
    const [renderingPage, setRenderingPage] = useState(false);
    const [extractingPage, setExtractingPage] = useState(false);
    const [extractingWholeBook, setExtractingWholeBook] = useState(false);
    const [loadError, setLoadError] = useState<string | null>(null);
    const [pageContent, setPageContent] = useState<Record<number, PageContentEntry>>({});
    const [selectionDraft, setSelectionDraft] = useState<SelectionDraft | null>(null);
    const [selectionBounds, setSelectionBounds] = useState<SelectionBounds | null>(null);
    const [selectionEntries, setSelectionEntries] = useState<SelectionEntry[]>([]);
    const [openingSetModal, setOpeningSetModal] = useState(false);
    const [setNameDraft, setSetNameDraft] = useState(`${book.title} Prepared Set`);
    const [savingPreparedSet, setSavingPreparedSet] = useState(false);
    const [preparedDocumentId, setPreparedDocumentId] = useState<string | null>(null);
    const [preparedSetName, setPreparedSetName] = useState<string | null>(null);
    const [toolMode, setToolMode] = useState<ToolMode>("select");
    const [isPanning, setIsPanning] = useState(false);
    const [readerState, setReaderState] = useState(() => normalizeBookReaderState(book.readerState));
    const [wholeBookProgress, setWholeBookProgress] = useState<{
        total: number;
        processed: number;
        currentPage: number | null;
        successCount: number;
        errorCount: number;
    } | null>(null);

    const totalSelectedQuestions = useMemo(
        () =>
            selectionEntries.reduce(
                (sum, entry) => sum + (entry.status === "ready" ? entry.questions.length : 0),
                0
            ),
        [selectionEntries]
    );

    const currentPageContent = pageContent[currentPage];
    const workspaceStats = useMemo(
        () => computeBookReaderStats(readerState, pageCount || book.pageCount),
        [readerState, pageCount, book.pageCount]
    );
    const currentPageState = readerState.pages[String(currentPage)];
    const preparedSets = readerState.preparedSets;
    const extractionCoverage =
        workspaceStats.totalPages > 0
            ? Math.round((workspaceStats.extractedPages / workspaceStats.totalPages) * 100)
            : 0;

    useEffect(() => {
        readerStateRef.current = readerState;
    }, [readerState]);

    useEffect(() => {
        pageContentRef.current = pageContent;
    }, [pageContent]);

    useEffect(() => {
        const normalizedReaderState = normalizeBookReaderState(book.readerState);
        const hydratedPageContent = Object.entries(normalizedReaderState.pages).reduce<
            Record<number, PageContentEntry>
        >((accumulator, [pageKey, pageState]) => {
            const pageNumber = Number.parseInt(pageKey, 10);
            if (!Number.isFinite(pageNumber) || pageNumber < 1) return accumulator;
            if (!pageState.text && !pageState.preview) return accumulator;

            accumulator[pageNumber] = {
                text: pageState.text || "",
                preview: pageState.preview || buildPreview(pageState.text || `Page ${pageNumber}`),
                questions: [],
                fragments: [],
                source: pageState.status === "ocr" ? "ocr" : "pdf-text",
                hasSearchableText: pageState.status === "searchable",
                extractedAt: pageState.extractedAt,
            };

            return accumulator;
        }, {});

        readerStateRef.current = normalizedReaderState;
        pageContentRef.current = hydratedPageContent;
        pageSyncSignatureRef.current = {};
        panSessionRef.current = null;
        const latestPreparedSet = normalizedReaderState.preparedSets[0];

        setReaderState(normalizedReaderState);
        setPageCount(book.pageCount || Object.keys(normalizedReaderState.pages).length || 0);
        setCurrentPage(1);
        setZoom(1);
        setCanvasSize({ width: 0, height: 0 });
        setPageContent(hydratedPageContent);
        setSelectionDraft(null);
        setSelectionBounds(null);
        setSelectionEntries([]);
        setPreparedDocumentId(latestPreparedSet?.extractorDocumentId || null);
        setPreparedSetName(latestPreparedSet?.name || null);
        setToolMode("select");
        setIsPanning(false);
        setSetNameDraft(`${book.title} Prepared Set`);
        setWholeBookProgress(null);
    }, [book.id, book.pageCount, book.readerState, book.title]);

    useEffect(() => {
        onWorkspaceChange?.({
            pageCount: pageCount || book.pageCount || 0,
            workspaceStats,
            preparedDocumentId,
            preparedSetName,
        });
    }, [book.pageCount, onWorkspaceChange, pageCount, preparedDocumentId, preparedSetName, workspaceStats]);

    const persistReaderAction = useCallback(
        async (payload: Record<string, unknown>) => {
            const response = await fetch(`/api/books/${book.id}`, {
                method: "PATCH",
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify(payload),
            });

            const data = await response.json().catch(() => ({}));
            if (!response.ok) {
                throw new Error(data.error || "Book reader state could not be updated.");
            }

            if (data?.readerState) {
                const normalized = normalizeBookReaderState(data.readerState);
                readerStateRef.current = normalized;
                setReaderState(normalized);
            }

            return data as Record<string, unknown>;
        },
        [book.id]
    );

    const persistPageState = useCallback(
        async (input: {
            pageNumber: number;
            status: "searchable" | "ocr";
            questionCount?: number;
            preview?: string;
            text?: string;
        }) => {
            const pageKey = String(Math.max(1, input.pageNumber));
            const nextSignature = [
                input.status,
                Number(input.questionCount || 0),
                buildPreview(input.preview || "", 80),
                buildPreview(input.text || "", 120),
            ].join("|");

            if (pageSyncSignatureRef.current[pageKey] === nextSignature) {
                return;
            }

            const currentState = readerStateRef.current;
            const existing = currentState.pages[pageKey];
            const preview = buildPreview(input.preview || existing?.preview || `Page ${input.pageNumber}`);
            const nextQuestionCount = Number(input.questionCount || 0);
            const nextText = String(input.text || existing?.text || "").trim();

            if (
                existing &&
                (existing.status === input.status ||
                    (existing.status === "ocr" && input.status === "searchable")) &&
                existing.questionCount >= nextQuestionCount &&
                (existing.preview || "") === preview &&
                (existing.text || "") === nextText
            ) {
                pageSyncSignatureRef.current[pageKey] = nextSignature;
                return;
            }

            const optimistic = upsertBookReaderPageState(currentState, {
                pageNumber: input.pageNumber,
                status: input.status,
                questionCount: nextQuestionCount,
                preview,
                text: nextText,
            });
            readerStateRef.current = optimistic;
            setReaderState(optimistic);
            pageSyncSignatureRef.current[pageKey] = nextSignature;

            try {
                await persistReaderAction({
                    action: "upsertPageState",
                    pageNumber: input.pageNumber,
                    status: input.status,
                    questionCount: nextQuestionCount,
                    preview,
                    text: nextText,
                });
            } catch (error) {
                console.error("Failed to persist book page state:", error);
            }
        },
        [persistReaderAction]
    );

    useEffect(() => {
        let cancelled = false;
        let loadingTask: any = null;

        async function loadDocument() {
            try {
                setLoadingDocument(true);
                setLoadError(null);

                const pdfRuntimeUrl = "/pdfjs/pdf.mjs";
                const pdfjsLib: PdfRuntimeLike = await import(/* webpackIgnore: true */ pdfRuntimeUrl);
                pdfjsLib.GlobalWorkerOptions.workerSrc = "/pdfjs/pdf.worker.min.mjs";
                pdfRuntimeRef.current = pdfjsLib;

                loadingTask = pdfjsLib.getDocument({
                    url: book.filePath,
                    cMapUrl: "/pdfjs/cmaps/",
                    cMapPacked: true,
                    standardFontDataUrl: "/pdfjs/standard_fonts/",
                    wasmUrl: "/pdfjs/wasm/",
                });

                const pdfDocument = await loadingTask.promise;
                if (cancelled) return;

                pdfDocumentRef.current = pdfDocument;
                const resolvedPageCount = Number(pdfDocument.numPages) || book.pageCount || 0;
                setPageCount(resolvedPageCount);
                setCurrentPage((previous) =>
                    Math.max(1, Math.min(previous, Number(pdfDocument.numPages) || 1))
                );

                if (resolvedPageCount > 0 && resolvedPageCount !== Number(book.pageCount || 0)) {
                    void persistReaderAction({
                        action: "syncPageCount",
                        pageCount: resolvedPageCount,
                    }).catch((error) => {
                        console.error("Failed to sync book page count:", error);
                    });
                }
            } catch (error) {
                if (cancelled) return;
                console.error("Book PDF load failed:", error);
                setLoadError(
                    error instanceof Error
                        ? error.message
                        : "The custom reader could not load this book."
                );
            } finally {
                if (!cancelled) {
                    setLoadingDocument(false);
                }
            }
        }

        loadDocument();

        return () => {
            cancelled = true;
            try {
                loadingTask?.destroy?.();
            } catch {
                // noop
            }
        };
    }, [book.filePath, book.pageCount, persistReaderAction]);

    useEffect(() => {
        const pdfDocument = pdfDocumentRef.current;
        if (!pdfDocument || pageCount <= 0) return;

        let cancelled = false;
        let renderTask: any = null;

        async function renderPage() {
            try {
                setRenderingPage(true);
                setSelectionDraft(null);
                setSelectionBounds(null);

                const page = await pdfDocument.getPage(currentPage);
                if (cancelled) return;

                const pdfRuntime = pdfRuntimeRef.current;
                const hostElement = pageRenderHostRef.current;
                const canvasElement = canvasRef.current;
                if (!pdfRuntime || !hostElement || !canvasElement) return;

                const availableWidth = Math.max(360, hostElement.clientWidth - 32);
                const baseViewport = page.getViewport({ scale: 1 });
                const fittedScale = (availableWidth / baseViewport.width) * zoom;
                const viewport = page.getViewport({
                    scale: Number.isFinite(fittedScale) ? fittedScale : 1,
                });

                const context = canvasElement.getContext("2d");
                if (!context) {
                    throw new Error("Canvas context is unavailable.");
                }

                canvasElement.width = Math.round(viewport.width);
                canvasElement.height = Math.round(viewport.height);
                canvasElement.style.width = `${Math.round(viewport.width)}px`;
                canvasElement.style.height = `${Math.round(viewport.height)}px`;
                setCanvasSize({
                    width: Math.round(viewport.width),
                    height: Math.round(viewport.height),
                });

                renderTask = page.render({
                    canvasContext: context,
                    viewport,
                    canvas: canvasElement,
                });

                await renderTask.promise;
                if (cancelled) return;

                const textContent = await page.getTextContent();
                if (cancelled) return;

                const fragments = extractTextFragments(
                    Array.isArray(textContent.items) ? textContent.items : [],
                    viewport,
                    pdfRuntime
                );

                const formattedText = formatTextFragments(fragments);
                const preview = buildPreview(formattedText || `Page ${currentPage}`);

                setPageContent((current) => ({
                    ...current,
                    [currentPage]: current[currentPage]?.source === "ocr"
                        ? current[currentPage]
                        : {
                              text: formattedText,
                              preview,
                              fragments,
                              questions: current[currentPage]?.questions || [],
                              source: "pdf-text",
                              hasSearchableText: fragments.length > 0,
                              extractedAt: new Date().toISOString(),
                          },
                }));

                if (formattedText || fragments.length > 0) {
                    void persistPageState({
                        pageNumber: currentPage,
                        status: "searchable",
                        questionCount:
                            pageContentRef.current[currentPage]?.questions.length ||
                            currentPageContent?.questions.length ||
                            0,
                        preview,
                        text: formattedText,
                    });
                }
            } catch (error) {
                if (cancelled) return;
                console.error("Book page render failed:", error);
                toast.error("This page could not be rendered.");
            } finally {
                if (!cancelled) {
                    setRenderingPage(false);
                }
            }
        }

        renderPage();

        return () => {
            cancelled = true;
            try {
                renderTask?.cancel?.();
            } catch {
                // noop
            }
        };
    }, [currentPage, pageCount, zoom]);

    const handleReaderPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
        if (!canvasRef.current || renderingPage) return;

        if (toolMode === "pan") {
            const host = pageRenderHostRef.current;
            if (!host) return;

            panSessionRef.current = {
                pointerId: event.pointerId,
                startX: event.clientX,
                startY: event.clientY,
                scrollLeft: host.scrollLeft,
                scrollTop: host.scrollTop,
            };
            setIsPanning(true);
            setSelectionDraft(null);
            setSelectionBounds(null);
            event.preventDefault();
            event.currentTarget.setPointerCapture?.(event.pointerId);
            return;
        }

        const rect = canvasRef.current.getBoundingClientRect();
        const startX = event.clientX - rect.left;
        const startY = event.clientY - rect.top;

        setSelectionDraft({
            startX,
            startY,
            endX: startX,
            endY: startY,
        });
        setSelectionBounds(null);
        event.currentTarget.setPointerCapture?.(event.pointerId);
    };

    const handleReaderPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
        if (toolMode === "pan") {
            const panSession = panSessionRef.current;
            const host = pageRenderHostRef.current;
            if (!panSession || !host) return;

            host.scrollLeft = panSession.scrollLeft - (event.clientX - panSession.startX);
            host.scrollTop = panSession.scrollTop - (event.clientY - panSession.startY);
            return;
        }

        if (!selectionDraft || !canvasRef.current) return;

        const rect = canvasRef.current.getBoundingClientRect();
        const endX = event.clientX - rect.left;
        const endY = event.clientY - rect.top;

        setSelectionDraft((current) =>
            current
                ? {
                      ...current,
                      endX,
                      endY,
                  }
                : null
        );
    };

    const finalizeReaderPointer = useCallback(
        (event?: React.PointerEvent<HTMLDivElement>) => {
            if (toolMode === "pan") {
                if (panSessionRef.current) {
                    if (event) {
                        event.currentTarget.releasePointerCapture?.(panSessionRef.current.pointerId);
                    }
                    panSessionRef.current = null;
                }
                setIsPanning(false);
                return;
            }

            if (!selectionDraft || !canvasRef.current) return;

            const nextBounds = clampRect(
                selectionDraft,
                canvasRef.current.width,
                canvasRef.current.height
            );

            setSelectionDraft(null);
            setSelectionBounds(isMeaningfulRect(nextBounds) ? nextBounds : null);
            if (event) {
                event.currentTarget.releasePointerCapture?.(event.pointerId);
            }
        },
        [selectionDraft, toolMode]
    );

    const handleReaderWheel = (event: React.WheelEvent<HTMLDivElement>) => {
        if (!(event.ctrlKey || event.metaKey)) return;
        event.preventDefault();
        const direction = event.deltaY < 0 ? 1 : -1;
        setZoom((current) => clampZoom(current + direction * ZOOM_STEP));
    };

    const handleExtractCurrentPage = async () => {
        const canvas = canvasRef.current;
        if (!canvas) return;

        setExtractingPage(true);
        try {
            const fullPageFile = await cropCanvasToFile(
                canvas,
                {
                    x: 0,
                    y: 0,
                    width: canvas.width,
                    height: canvas.height,
                },
                `${book.title}-page-${currentPage}.jpg`
            );

            const formData = new FormData();
            formData.append("image", fullPageFile);
            formData.append("mode", "page");

            const response = await fetch("/api/books/extract-content", {
                method: "POST",
                body: formData,
            });

            const data = await response.json().catch(() => ({}));
            if (!response.ok) {
                throw new Error(data.error || "Current page extraction failed.");
            }

            const nextText = normalizeWhitespace(String(data.text || "")).length
                ? String(data.text)
                : currentPageContent?.text || "";
            const questions = Array.isArray(data.questions) ? (data.questions as Question[]) : [];

            setPageContent((current) => ({
                ...current,
                [currentPage]: {
                    text: nextText,
                    preview: buildPreview(nextText || `Page ${currentPage}`),
                    fragments: current[currentPage]?.fragments || [],
                    questions,
                    source: "ocr",
                    hasSearchableText: Boolean(current[currentPage]?.hasSearchableText),
                    extractedAt: new Date().toISOString(),
                },
            }));

            void persistPageState({
                pageNumber: currentPage,
                status: "ocr",
                questionCount: questions.length,
                preview: buildPreview(nextText || `Page ${currentPage}`),
                text: nextText,
            });

            toast.success(
                questions.length > 0
                    ? `Extracted ${questions.length} structured question(s) from page ${currentPage}.`
                    : `Formatted text extracted for page ${currentPage}.`
            );
        } catch (error) {
            console.error(error);
            toast.error(
                error instanceof Error ? error.message : "Page extraction could not be completed."
            );
        } finally {
            setExtractingPage(false);
        }
    };

    const requestStructuredExtraction = useCallback(
        async (imageFile: File, mode: "page" | "selection") => {
            const formData = new FormData();
            formData.append("image", imageFile);
            formData.append("mode", mode);

            const response = await fetch("/api/books/extract-content", {
                method: "POST",
                body: formData,
            });

            const data = await response.json().catch(() => ({}));
            if (!response.ok) {
                throw new Error(data.error || "Extraction request failed.");
            }

            return {
                text: String(data.text || ""),
                questions: Array.isArray(data.questions) ? (data.questions as Question[]) : [],
            };
        },
        []
    );

    const renderPageSnapshot = useCallback(async (pageNumber: number) => {
        const pdfDocument = pdfDocumentRef.current;
        const pdfRuntime = pdfRuntimeRef.current;

        if (!pdfDocument || !pdfRuntime) {
            throw new Error("The PDF reader is not ready yet.");
        }

        const page = await pdfDocument.getPage(pageNumber);
        const baseViewport = page.getViewport({ scale: 1 });
        const targetWidth = Math.max(1400, Math.min(2200, Math.round(baseViewport.width * 2)));
        const scale = targetWidth / Math.max(baseViewport.width, 1);
        const viewport = page.getViewport({ scale });

        const tempCanvas = document.createElement("canvas");
        tempCanvas.width = Math.round(viewport.width);
        tempCanvas.height = Math.round(viewport.height);

        const context = tempCanvas.getContext("2d");
        if (!context) {
            throw new Error("Temporary canvas context is unavailable.");
        }

        const renderTask = page.render({
            canvasContext: context,
            viewport,
            canvas: tempCanvas,
        });
        await renderTask.promise;

        const textContent = await page.getTextContent();
        const fragments = extractTextFragments(
            Array.isArray(textContent.items) ? textContent.items : [],
            viewport,
            pdfRuntime
        );
        const text = formatTextFragments(fragments);

        return {
            canvas: tempCanvas,
            fragments,
            text,
            preview: buildPreview(text || `Page ${pageNumber}`),
        };
    }, []);

    const handleExtractWholeBook = async () => {
        const totalPages = pageCount || book.pageCount || 0;
        if (totalPages <= 0) {
            toast.error("The book has no readable pages yet.");
            return;
        }

        if (extractingWholeBook) {
            return;
        }

        const pendingPageNumbers = Array.from({ length: totalPages }, (_, index) => index + 1).filter(
            (pageNumber) => !readerStateRef.current.pages[String(pageNumber)]
        );

        if (pendingPageNumbers.length === 0) {
            toast.success("All pages are already extracted. Nothing pending to resume.");
            return;
        }

        setExtractingWholeBook(true);
        setWholeBookProgress({
            total: pendingPageNumbers.length,
            processed: 0,
            currentPage: pendingPageNumbers[0] || 1,
            successCount: 0,
            errorCount: 0,
        });

        let successCount = 0;
        let errorCount = 0;
        let processedCount = 0;

        const updateProgress = (currentPage: number | null) => {
            setWholeBookProgress({
                total: pendingPageNumbers.length,
                processed: processedCount,
                currentPage,
                successCount,
                errorCount,
            });
        };

        try {
            await runWithConcurrency(pendingPageNumbers, BOOK_EXTRACTION_CONCURRENCY, async (pageNumber) => {
                updateProgress(pageNumber);
                try {
                    const snapshot = await renderPageSnapshot(pageNumber);
                    const pageFile = await cropCanvasToFile(
                        snapshot.canvas,
                        {
                            x: 0,
                            y: 0,
                            width: snapshot.canvas.width,
                            height: snapshot.canvas.height,
                        },
                        `${book.title}-page-${pageNumber}.jpg`
                    );
                    const extracted = await requestStructuredExtraction(pageFile, "page");
                    const nextText =
                        normalizeWhitespace(extracted.text).length > 0
                            ? extracted.text
                            : snapshot.text;
                    const nextPreview = buildPreview(nextText || snapshot.preview || `Page ${pageNumber}`);
                    const nextSource =
                        normalizeWhitespace(extracted.text).length > 0 || extracted.questions.length > 0
                            ? "ocr"
                            : "pdf-text";

                    setPageContent((current) => ({
                        ...current,
                        [pageNumber]: {
                            text: nextText,
                            preview: nextPreview,
                            questions: extracted.questions,
                            fragments: snapshot.fragments,
                            source: nextSource,
                            hasSearchableText: snapshot.fragments.length > 0,
                            extractedAt: new Date().toISOString(),
                        },
                    }));

                    if (nextText || extracted.questions.length > 0 || snapshot.fragments.length > 0) {
                        await persistPageState({
                            pageNumber,
                            status: nextSource === "ocr" ? "ocr" : "searchable",
                            questionCount: extracted.questions.length,
                            preview: nextPreview,
                            text: nextText,
                        });
                    }

                    snapshot.canvas.width = 0;
                    snapshot.canvas.height = 0;
                    successCount += 1;
                } catch (error) {
                    errorCount += 1;
                    console.error(`Failed to extract book page ${pageNumber}:`, error);
                } finally {
                    processedCount += 1;
                    updateProgress(
                        processedCount < pendingPageNumbers.length
                            ? pendingPageNumbers[processedCount] || null
                            : null
                    );
                }
            });

            if (errorCount === 0) {
                toast.success(`Whole book extracted across ${successCount} page(s).`);
            } else if (successCount > 0) {
                toast.success(`Book extraction finished. ${successCount} page(s) succeeded, ${errorCount} failed.`);
            } else {
                toast.error("Whole-book extraction could not complete on any page.");
            }
        } finally {
            setExtractingWholeBook(false);
            setTimeout(() => {
                setWholeBookProgress((current) =>
                    current && current.currentPage === null ? null : current
                );
            }, 2400);
        }
    };

    const handleCaptureSelection = async () => {
        const canvas = canvasRef.current;
        if (!canvas || !selectionBounds) return;

        const fragments = currentPageContent?.fragments || [];
        const intersected = fragments.filter((fragment) => intersects(selectionBounds, fragment));
        const initialText = formatTextFragments(intersected);
        const selectionId = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

        const pendingEntry: SelectionEntry = {
            id: selectionId,
            pageNumber: currentPage,
            bounds: selectionBounds,
            text: initialText,
            questions: [],
            status: "processing",
            createdAt: new Date().toISOString(),
        };

        setSelectionEntries((current) => [pendingEntry, ...current]);
        setSelectionBounds(null);

        try {
            const selectionFile = await cropCanvasToFile(
                canvas,
                selectionBounds,
                `${book.title}-page-${currentPage}-selection.jpg`
            );

            const snippetScopeId = `book_${book.id}`;
            const uploadedSnippet = await uploadSelectionSnippet(selectionFile, snippetScopeId);

            const extracted = await requestStructuredExtraction(selectionFile, "selection");
            const nextText = String(extracted.text || "").trim() || initialText;
            const nextQuestions = Array.isArray(extracted.questions) ? extracted.questions : [];

            setSelectionEntries((current) =>
                current.map((entry) =>
                    entry.id === selectionId
                        ? {
                              ...entry,
                              text: nextText,
                              questions: nextQuestions.map((question) => ({
                                  ...question,
                                  sourceImagePath: uploadedSnippet.imagePath,
                                  sourceImageName: uploadedSnippet.imageName,
                              })),
                              imagePath: uploadedSnippet.imagePath,
                              imageName: uploadedSnippet.imageName,
                              status: "ready",
                          }
                        : entry
                )
            );

            if (nextQuestions.length > 0) {
                const existingPageState = readerStateRef.current.pages[String(currentPage)];
                const existingPageQuestions = Number(existingPageState?.questionCount || 0);
                void persistPageState({
                    pageNumber: currentPage,
                    status: existingPageState?.status === "ocr" ? "ocr" : "searchable",
                    questionCount: existingPageQuestions + nextQuestions.length,
                    preview: existingPageState?.preview || currentPageContent?.preview || `Page ${currentPage}`,
                });
            }

            toast.success(
                nextQuestions.length > 0
                    ? `Selection parsed into ${nextQuestions.length} question(s).`
                    : "Selection text captured."
            );
        } catch (error) {
            console.error(error);
            setSelectionEntries((current) =>
                current.map((entry) =>
                    entry.id === selectionId
                        ? {
                              ...entry,
                              status: "error",
                              error:
                                  error instanceof Error
                                      ? error.message
                                      : "Selection extraction failed.",
                          }
                        : entry
                )
            );
            toast.error(
                error instanceof Error
                    ? error.message
                    : "Selection extraction could not be completed."
            );
        }
    };

    const handlePrepareQuestionSet = async () => {
        const readySelections = selectionEntries.filter((entry) => entry.status === "ready");
        const selectionsMissingImages = readySelections.filter((entry) => !entry.imagePath || !entry.imageName);

        if (selectionsMissingImages.length > 0) {
            toast.error("Some selected snippets are missing saved images. Capture them again once.");
            return;
        }

        const questions = renumberQuestions(
            readySelections.flatMap((entry) =>
                entry.questions.map((question) => ({
                    ...question,
                    sourceImagePath: entry.imagePath,
                    sourceImageName: entry.imageName,
                }))
            )
        );

        if (questions.length === 0) {
            toast.error("Select question regions first so the set has structured questions.");
            return;
        }

        setSavingPreparedSet(true);
        try {
            const response = await fetch(`/api/books/${book.id}/prepare-question-set`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({
                    name: setNameDraft.trim(),
                    questions,
                    selections: readySelections.map((entry) => ({
                        pageNumber: entry.pageNumber,
                        text: entry.text,
                        questionCount: entry.questions.length,
                        imagePath: entry.imagePath,
                        imageName: entry.imageName,
                        processed: true,
                    })),
                    sourceImages: readySelections.map((entry, index) => ({
                        imagePath: entry.imagePath,
                        originalImagePath: entry.imagePath,
                        imageName:
                            entry.imageName ||
                            `${book.title}-selection-${index + 1}.jpg`,
                        questionCount: entry.questions.length,
                        processed: true,
                        failed: false,
                        extractionMode: "original",
                    })),
                }),
            });

            const data = await response.json().catch(() => ({}));
            if (!response.ok) {
                throw new Error(data.error || "Question set could not be prepared.");
            }

            await persistReaderAction({
                action: "appendPreparedSet",
                extractorDocumentId: String(data.documentId),
                name: String(data.title || setNameDraft.trim()),
                questionCount: questions.length,
            });

            setPreparedDocumentId(String(data.documentId));
            setPreparedSetName(String(data.title || setNameDraft.trim()));
            setOpeningSetModal(false);
            toast.success("Prepared question set is now available in Extractor.");
        } catch (error) {
            console.error(error);
            toast.error(
                error instanceof Error
                    ? error.message
                    : "Prepared question set could not be saved."
            );
        } finally {
            setSavingPreparedSet(false);
        }
    };

    return (
        <>
            <section className="grid grid-cols-1 items-start gap-4 xl:grid-cols-[minmax(0,1.42fr)_430px]">
                <article className="workspace-panel overflow-visible">
                    <div className="workspace-panel-header flex flex-wrap items-center justify-between gap-3">
                        <div>
                            <p className="text-xs font-bold uppercase tracking-wide text-slate-500">
                                Custom Book Reader
                            </p>
                            <p className="text-sm text-slate-500 mt-1">
                                Navigate page-wise, draw a rectangle to capture content, and build question
                                sets directly from the book.
                            </p>
                        </div>

                        <div className="flex flex-wrap items-center gap-2">
                            <span className="status-badge">Zoom {Math.round(zoom * 100)}%</span>
                            <button
                                type="button"
                                className="btn btn-secondary"
                                onClick={() => setZoom((current) => clampZoom(current - ZOOM_STEP))}
                                disabled={loadingDocument || renderingPage}
                            >
                                <ZoomOut className="h-4 w-4" />
                            </button>
                            <button
                                type="button"
                                className="btn btn-secondary"
                                onClick={() => setZoom((current) => clampZoom(current + ZOOM_STEP))}
                                disabled={loadingDocument || renderingPage}
                            >
                                <ZoomIn className="h-4 w-4" />
                            </button>
                            <div className="flex items-center gap-1 rounded-full border border-slate-200 bg-white/90 p-1 shadow-sm">
                                <button
                                    type="button"
                                    className={`btn ${toolMode === "select" ? "btn-primary" : "btn-ghost"}`}
                                    onClick={() => setToolMode("select")}
                                >
                                    <MousePointerSquareDashed className="h-4 w-4" />
                                    Select
                                </button>
                                <button
                                    type="button"
                                    className={`btn ${toolMode === "pan" ? "btn-primary" : "btn-ghost"}`}
                                    onClick={() => {
                                        setToolMode("pan");
                                        setSelectionDraft(null);
                                        setSelectionBounds(null);
                                    }}
                                >
                                    <Hand className="h-4 w-4" />
                                    Pan
                                </button>
                            </div>
                            <button
                                type="button"
                                className="btn btn-secondary"
                                onClick={handleExtractCurrentPage}
                                disabled={loadingDocument || renderingPage || extractingPage || extractingWholeBook}
                            >
                                {extractingPage ? (
                                    <Loader2 className="h-4 w-4 animate-spin" />
                                ) : (
                                    <FileText className="h-4 w-4" />
                                )}
                                Extract This Page
                            </button>
                            <button
                                type="button"
                                className="btn btn-secondary"
                                onClick={handleExtractWholeBook}
                                disabled={
                                    loadingDocument || renderingPage || extractingPage || extractingWholeBook
                                }
                            >
                                {extractingWholeBook ? (
                                    <Loader2 className="h-4 w-4 animate-spin" />
                                ) : (
                                    <ScanText className="h-4 w-4" />
                                )}
                                {extractingWholeBook ? "Extracting Whole Book..." : "Extract Whole Book"}
                            </button>
                            <button
                                type="button"
                                className="btn btn-primary"
                                onClick={() => setOpeningSetModal(true)}
                                disabled={totalSelectedQuestions === 0 || savingPreparedSet}
                            >
                                <Sparkles className="h-4 w-4" />
                                Prepare Question Set
                            </button>
                        </div>
                    </div>

                    {wholeBookProgress ? (
                        <div className="px-4 pt-4">
                            <section className="rounded-[24px] border border-blue-200 bg-blue-50/75 p-4 shadow-[0_18px_40px_rgba(37,99,235,0.12)]">
                                <div className="flex flex-wrap items-center justify-between gap-3">
                                    <div>
                                        <p className="text-[11px] font-semibold uppercase tracking-[0.26em] text-blue-500">
                                            Whole Book Extraction
                                        </p>
                                        <p className="mt-1 text-base font-semibold text-slate-900">
                                            {wholeBookProgress.currentPage
                                                ? `Processing page ${wholeBookProgress.currentPage} of ${wholeBookProgress.total}`
                                                : `Processed ${wholeBookProgress.processed} of ${wholeBookProgress.total} pages`}
                                        </p>
                                    </div>
                                    <div className="flex flex-wrap items-center gap-2">
                                        <span className="status-badge">{wholeBookProgress.processed}/{wholeBookProgress.total} done</span>
                                        <span className="status-badge">{wholeBookProgress.successCount} success</span>
                                        {wholeBookProgress.errorCount > 0 ? (
                                            <span className="status-badge text-rose-600">{wholeBookProgress.errorCount} failed</span>
                                        ) : null}
                                    </div>
                                </div>
                                <div className="mt-3 h-2 overflow-hidden rounded-full bg-blue-100">
                                    <div
                                        className="h-full rounded-full bg-[linear-gradient(90deg,#2563eb,#60a5fa)] transition-all"
                                        style={{
                                            width: `${Math.max(
                                                4,
                                                Math.round(
                                                    (wholeBookProgress.processed /
                                                        Math.max(wholeBookProgress.total, 1)) *
                                                        100
                                                )
                                            )}%`,
                                        }}
                                    />
                                </div>
                            </section>
                        </div>
                    ) : null}

                    <div className="grid grid-cols-1 items-start gap-4 p-4 lg:grid-cols-[290px_minmax(0,1fr)]">
                        <aside className="flex flex-col gap-4 rounded-[28px] border border-slate-200 bg-white/86 p-4 shadow-[0_24px_80px_rgba(15,23,42,0.07)]">
                            <section className="rounded-[24px] border border-slate-200 bg-[linear-gradient(180deg,rgba(248,250,252,0.98),rgba(241,245,249,0.92))] p-4">
                                <div className="flex items-start justify-between gap-3">
                                    <div>
                                        <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-slate-400">
                                            Document Intelligence
                                        </p>
                                        <h3 className="mt-2 text-lg font-semibold text-slate-900">{book.title}</h3>
                                        <p className="mt-1 text-sm text-slate-500">
                                            {workspaceStats.statusLabel} across {workspaceStats.totalPages || pageCount || 0} pages.
                                        </p>
                                    </div>
                                    <span className="status-badge">{extractionCoverage}% ready</span>
                                </div>

                                <div className="mt-4 h-2 overflow-hidden rounded-full bg-slate-200">
                                    <div
                                        className="h-full rounded-full bg-[linear-gradient(90deg,#2563eb,#60a5fa)]"
                                        style={{ width: `${extractionCoverage}%` }}
                                    />
                                </div>

                                <div className="mt-4 grid grid-cols-2 gap-3">
                                    <div className="rounded-[20px] border border-slate-200 bg-white/90 p-3">
                                        <div className="flex items-center gap-2 text-slate-500">
                                            <BookOpenText className="h-4 w-4" />
                                            <span className="text-[11px] font-semibold uppercase tracking-[0.2em]">Pages</span>
                                        </div>
                                        <p className="mt-2 text-2xl font-bold text-slate-900">{workspaceStats.totalPages || pageCount || 0}</p>
                                        <p className="text-xs text-slate-500">{workspaceStats.notExtractedPages} pending</p>
                                    </div>
                                    <div className="rounded-[20px] border border-slate-200 bg-white/90 p-3">
                                        <div className="flex items-center gap-2 text-slate-500">
                                            <ScanText className="h-4 w-4" />
                                            <span className="text-[11px] font-semibold uppercase tracking-[0.2em]">Extracted</span>
                                        </div>
                                        <p className="mt-2 text-2xl font-bold text-slate-900">{workspaceStats.extractedPages}</p>
                                        <p className="text-xs text-slate-500">
                                            {workspaceStats.searchablePages} text / {workspaceStats.ocrPages} OCR
                                        </p>
                                    </div>
                                    <div className="rounded-[20px] border border-slate-200 bg-white/90 p-3">
                                        <div className="flex items-center gap-2 text-slate-500">
                                            <SquareDashedMousePointer className="h-4 w-4" />
                                            <span className="text-[11px] font-semibold uppercase tracking-[0.2em]">Selections</span>
                                        </div>
                                        <p className="mt-2 text-2xl font-bold text-slate-900">{selectionEntries.length}</p>
                                        <p className="text-xs text-slate-500">{totalSelectedQuestions} question(s) ready</p>
                                    </div>
                                    <div className="rounded-[20px] border border-slate-200 bg-white/90 p-3">
                                        <div className="flex items-center gap-2 text-slate-500">
                                            <Sparkles className="h-4 w-4" />
                                            <span className="text-[11px] font-semibold uppercase tracking-[0.2em]">Prepared</span>
                                        </div>
                                        <p className="mt-2 text-2xl font-bold text-slate-900">{workspaceStats.preparedSetCount}</p>
                                        <p className="text-xs text-slate-500">{workspaceStats.extractedQuestionCount} extracted question(s)</p>
                                    </div>
                                </div>
                            </section>

                            <section className="flex flex-col rounded-[24px] border border-slate-200 bg-slate-50/80 p-3">
                                <div className="flex items-center justify-between gap-3 px-1">
                                    <div>
                                        <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-slate-400">
                                            Page Deck
                                        </p>
                                        <p className="mt-1 text-sm font-semibold text-slate-900">
                                            {pageCount || book.pageCount || 0} pages
                                        </p>
                                    </div>
                                    <div className="flex flex-col items-end gap-1">
                                        <span className="status-badge">Page {currentPage}</span>
                                        <span className="status-badge">{currentPageState?.status === "ocr" ? "OCR" : currentPageState?.status === "searchable" ? "Text ready" : "Pending"}</span>
                                    </div>
                                </div>

                                <div className="mt-3 max-h-[920px] space-y-2 overflow-y-auto pr-1">
                                    {Array.from({ length: pageCount || 0 }, (_, index) => {
                                        const pageNumber = index + 1;
                                        const pageState = pageContent[pageNumber];
                                        const persistedPage = readerState.pages[String(pageNumber)];
                                        const selectionCount = selectionEntries.filter(
                                            (entry) => entry.pageNumber === pageNumber
                                        ).length;
                                        const questionCount =
                                            pageContent[pageNumber]?.questions.length ||
                                            Number(persistedPage?.questionCount || 0);

                                        return (
                                            <button
                                                key={pageNumber}
                                                type="button"
                                                onClick={() => setCurrentPage(pageNumber)}
                                                className={`w-full rounded-[24px] border px-3 py-3 text-left transition ${
                                                    pageNumber === currentPage
                                                        ? "border-blue-300 bg-blue-50 shadow-[0_20px_55px_rgba(59,130,246,0.14)]"
                                                        : "border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50"
                                                }`}
                                            >
                                                <div className="flex items-center justify-between gap-2">
                                                    <span className="text-sm font-semibold text-slate-900">
                                                        Page {pageNumber}
                                                    </span>
                                                    <div className="flex flex-wrap items-center justify-end gap-1">
                                                        {persistedPage?.status === "searchable" ? (
                                                            <span className="status-badge">
                                                                <CheckCircle2 className="mr-1 h-3.5 w-3.5" />
                                                                Text
                                                            </span>
                                                        ) : persistedPage?.status === "ocr" ? (
                                                            <span className="status-badge">OCR</span>
                                                        ) : (
                                                            <span className="status-badge">Pending</span>
                                                        )}
                                                    </div>
                                                </div>
                                                <p className="mt-2 text-xs leading-relaxed text-slate-500">
                                                    {pageState?.preview ||
                                                        persistedPage?.preview ||
                                                        (pageNumber === currentPage && renderingPage
                                                            ? "Loading page preview..."
                                                            : "Open this page in the custom reader.")}
                                                </p>
                                                <div className="mt-3 flex flex-wrap gap-2">
                                                    <span className="status-badge">{questionCount} question(s)</span>
                                                    {selectionCount > 0 ? (
                                                        <span className="status-badge">{selectionCount} selected</span>
                                                    ) : null}
                                                </div>
                                            </button>
                                        );
                                    })}
                                </div>
                            </section>
                        </aside>

                        <div className="flex flex-col rounded-[28px] border border-slate-200 bg-white/92 p-4 shadow-[0_24px_80px_rgba(15,23,42,0.08)]">
                            <div className="flex flex-wrap items-center justify-between gap-3">
                                <div className="flex flex-wrap items-center gap-2">
                                    <button
                                        type="button"
                                        className="btn btn-secondary"
                                        onClick={() => setCurrentPage((current) => Math.max(1, current - 1))}
                                        disabled={currentPage <= 1 || loadingDocument}
                                    >
                                        <ChevronLeft className="h-4 w-4" />
                                        Previous
                                    </button>
                                    <button
                                        type="button"
                                        className="btn btn-secondary"
                                        onClick={() =>
                                            setCurrentPage((current) =>
                                                Math.min(pageCount || current, current + 1)
                                            )
                                        }
                                        disabled={currentPage >= pageCount || loadingDocument}
                                    >
                                        Next
                                        <ChevronRight className="h-4 w-4" />
                                    </button>
                                    <span className="status-badge">
                                        Page {currentPage} / {pageCount || "?"}
                                    </span>
                                    {renderingPage && (
                                        <span className="status-badge">
                                            <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                                            Rendering
                                        </span>
                                    )}
                                </div>

                                <div className="flex flex-wrap items-center gap-2">
                                    <span className="status-badge">
                                        {currentPageContent?.questions.length || 0} parsed question(s)
                                    </span>
                                    <span className="status-badge">
                                        {currentPageContent?.source === "ocr"
                                            ? "Formatted OCR"
                                            : currentPageContent?.hasSearchableText
                                              ? "Searchable text"
                                              : "No OCR yet"}
                                    </span>
                                    <span className="status-badge">
                                        {toolMode === "select" ? "Select tool" : isPanning ? "Panning" : "Pan tool"}
                                    </span>
                                </div>
                            </div>

                            <div className="mt-4 flex flex-col rounded-[28px] border border-slate-200 bg-slate-50/70 p-3">
                                <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                                    <div>
                                        <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-slate-400">
                                            Page Canvas
                                        </p>
                                        <p className="mt-1 text-sm text-slate-500">
                                            {toolMode === "select"
                                                ? "Drag a rectangle over the page to capture that region as a temporary text/question set."
                                                : "Use click-and-drag to pan around the zoomed page. Pinch or Ctrl/Cmd + wheel to zoom."}
                                        </p>
                                    </div>
                                    <div className="flex flex-wrap items-center gap-2">
                                        {selectionBounds && toolMode === "select" && (
                                            <>
                                                <span className="status-badge">
                                                    {Math.round(selectionBounds.width)} x {Math.round(selectionBounds.height)}
                                                </span>
                                                <button
                                                    type="button"
                                                    className="btn btn-secondary"
                                                    onClick={() => setSelectionBounds(null)}
                                                >
                                                    Clear
                                                </button>
                                                <button
                                                    type="button"
                                                    className="btn btn-primary"
                                                    onClick={handleCaptureSelection}
                                                >
                                                    <Crop className="h-4 w-4" />
                                                    Capture Selection
                                                </button>
                                            </>
                                        )}
                                    </div>
                                </div>

                                <div
                                    ref={pageRenderHostRef}
                                    className="relative overflow-auto rounded-[24px] border border-slate-200 bg-white"
                                    onWheel={handleReaderWheel}
                                    style={{ minHeight: "clamp(760px, 86vh, 1320px)" }}
                                >
                                    {loadingDocument ? (
                                        <div className="flex min-h-[560px] items-center justify-center text-sm text-slate-500">
                                            <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                                            Loading book into the custom reader...
                                        </div>
                                    ) : loadError ? (
                                        <div className="flex min-h-[560px] items-center justify-center px-6 text-center text-sm text-rose-600">
                                            {loadError}
                                        </div>
                                    ) : (
                                        <div
                                            className="relative mx-auto"
                                            style={{
                                                width: canvasSize.width || "100%",
                                                height: canvasSize.height || "auto",
                                                cursor:
                                                    toolMode === "pan"
                                                        ? isPanning
                                                            ? "grabbing"
                                                            : "grab"
                                                        : "crosshair",
                                                touchAction: "none",
                                            }}
                                            onPointerDown={handleReaderPointerDown}
                                            onPointerMove={handleReaderPointerMove}
                                            onPointerUp={finalizeReaderPointer}
                                            onPointerCancel={finalizeReaderPointer}
                                            onPointerLeave={(event) => {
                                                if (selectionDraft || panSessionRef.current) {
                                                    finalizeReaderPointer(event);
                                                }
                                            }}
                                        >
                                            <canvas ref={canvasRef} className="block max-w-full" />

                                            {(selectionDraft || selectionBounds) && (
                                                <div
                                                    className="pointer-events-none absolute border-2 border-blue-500 bg-blue-500/10 shadow-[0_0_0_9999px_rgba(15,23,42,0.06)]"
                                                    style={{
                                                        left: `${(selectionDraft
                                                            ? clampRect(
                                                                  selectionDraft,
                                                                  canvasRef.current?.width || 0,
                                                                  canvasRef.current?.height || 0
                                                              )
                                                            : selectionBounds
                                                        )?.x || 0}px`,
                                                        top: `${(selectionDraft
                                                            ? clampRect(
                                                                  selectionDraft,
                                                                  canvasRef.current?.width || 0,
                                                                  canvasRef.current?.height || 0
                                                              )
                                                            : selectionBounds
                                                        )?.y || 0}px`,
                                                        width: `${(selectionDraft
                                                            ? clampRect(
                                                                  selectionDraft,
                                                                  canvasRef.current?.width || 0,
                                                                  canvasRef.current?.height || 0
                                                              )
                                                            : selectionBounds
                                                        )?.width || 0}px`,
                                                        height: `${(selectionDraft
                                                            ? clampRect(
                                                                  selectionDraft,
                                                                  canvasRef.current?.width || 0,
                                                                  canvasRef.current?.height || 0
                                                              )
                                                            : selectionBounds
                                                        )?.height || 0}px`,
                                                    }}
                                                />
                                            )}
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>
                    </div>
                </article>

                <article className="workspace-panel xl:sticky xl:top-4">
                    <div className="workspace-panel-header flex flex-wrap items-center justify-between gap-3">
                        <div>
                            <p className="text-xs font-bold uppercase tracking-wide text-slate-500">
                                Extracted Content + Sets Desk
                            </p>
                            <p className="text-sm text-slate-500 mt-1">
                                Review formatted page text, inspect selected regions, reopen prepared sets, and push ready questions into Extractor.
                            </p>
                        </div>

                        <div className="flex flex-wrap items-center gap-2">
                            <span className="status-badge">{selectionEntries.length} selection(s)</span>
                            <span className="status-badge">{totalSelectedQuestions} question(s) ready</span>
                            <span className="status-badge">{preparedSets.length} saved set(s)</span>
                        </div>
                    </div>

                    <div
                        className="workspace-scroll space-y-4 p-4"
                        style={{ maxHeight: "calc(100vh - 10rem)" }}
                    >
                        <section className="rounded-[28px] border border-slate-200 bg-white/80 p-4 shadow-[0_24px_80px_rgba(15,23,42,0.06)]">
                            <div className="flex items-center justify-between gap-3">
                                <div>
                                    <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-slate-400">
                                        Current Page Content
                                    </p>
                                    <h3 className="mt-2 text-lg font-semibold text-slate-900">
                                        Page {currentPage}
                                    </h3>
                                </div>
                                <span className="status-badge">
                                    {currentPageContent?.source === "ocr"
                                        ? "Formatted OCR"
                                        : currentPageContent?.hasSearchableText
                                          ? "Searchable PDF text"
                                          : "No extracted text yet"}
                                </span>
                            </div>

                            {currentPageContent?.text ? (
                                <>
                                    <div className="mt-3 rounded-[22px] border border-slate-200 bg-slate-50/80 p-4">
                                        <pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed text-slate-700">
                                            {currentPageContent.text}
                                        </pre>
                                    </div>
                                    {currentPageContent.questions.length > 0 && (
                                        <div className="mt-3 rounded-[22px] border border-emerald-200 bg-emerald-50/70 p-3">
                                            <p className="text-sm font-semibold text-emerald-900">
                                                {currentPageContent.questions.length} structured question(s) detected on this
                                                page.
                                            </p>
                                            <p className="mt-1 text-xs text-emerald-700">
                                                These are visible for review and can also be gathered from rectangle selections.
                                            </p>
                                        </div>
                                    )}
                                </>
                            ) : (
                                <div className="mt-3 rounded-[24px] border border-dashed border-slate-200 bg-slate-50/80 p-5 text-sm text-slate-500">
                                    <p>No formatted page content is available yet for this page.</p>
                                    <p className="mt-2">
                                        Use <strong>Extract This Page</strong> when the PDF does not expose searchable text.
                                    </p>
                                </div>
                            )}
                        </section>

                        <section className="rounded-[28px] border border-slate-200 bg-white/80 p-4 shadow-[0_24px_80px_rgba(15,23,42,0.06)]">
                            <div className="flex flex-wrap items-center justify-between gap-3">
                                <div>
                                    <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-slate-400">
                                        Prepared Sets
                                    </p>
                                    <h3 className="mt-2 text-lg font-semibold text-slate-900">
                                        Extractor-ready saved sets
                                    </h3>
                                </div>
                                {preparedDocumentId ? (
                                    <Link href={`/content-studio/extractor?load=${preparedDocumentId}`} className="btn btn-primary">
                                        Open Latest In Extractor
                                    </Link>
                                ) : null}
                            </div>

                            <div className="mt-3 space-y-3">
                                {preparedSets.length === 0 ? (
                                    <div className="rounded-[24px] border border-dashed border-slate-200 bg-slate-50/80 p-5 text-sm text-slate-500">
                                        Saved prepared sets will appear here after you capture question regions and click <strong>Prepare Question Set</strong>.
                                    </div>
                                ) : (
                                    preparedSets.map((setItem, index) => (
                                        <Link
                                            key={`${setItem.extractorDocumentId}_${index}`}
                                            href={`/content-studio/extractor?load=${encodeURIComponent(setItem.extractorDocumentId)}`}
                                            className="block rounded-[22px] border border-slate-200 bg-slate-50/80 p-4 transition hover:border-blue-200 hover:bg-blue-50/50"
                                        >
                                            <div className="flex items-center justify-between gap-3">
                                                <div>
                                                    <p className="text-sm font-semibold text-slate-900">{setItem.name}</p>
                                                    <p className="mt-1 text-xs text-slate-500">
                                                        {setItem.questionCount} question(s) • {new Date(setItem.createdAt).toLocaleString("en-IN")}
                                                    </p>
                                                </div>
                                                <span className="status-badge">Open</span>
                                            </div>
                                        </Link>
                                    ))
                                )}
                            </div>
                        </section>

                        <section className="rounded-[28px] border border-slate-200 bg-white/80 p-4 shadow-[0_24px_80px_rgba(15,23,42,0.06)]">
                            <div className="flex flex-wrap items-center justify-between gap-3">
                                <div>
                                    <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-slate-400">
                                        Selected Sets
                                    </p>
                                    <h3 className="mt-2 text-lg font-semibold text-slate-900">
                                        Temporary question snippets
                                    </h3>
                                </div>
                                {preparedDocumentId ? (
                                    <Link href={`/content-studio/extractor?load=${preparedDocumentId}`} className="btn btn-primary">
                                        Open In Extractor
                                    </Link>
                                ) : null}
                            </div>

                            {preparedSetName ? (
                                <div className="mt-3 rounded-[22px] border border-blue-200 bg-blue-50/80 p-4">
                                    <p className="text-sm font-semibold text-blue-900">
                                        Prepared set ready: {preparedSetName}
                                    </p>
                                    <p className="mt-1 text-xs text-blue-700">
                                        This set has been saved as an extractor workspace and can be reopened anytime.
                                    </p>
                                </div>
                            ) : null}

                            <div className="mt-3 space-y-3">
                                {selectionEntries.length === 0 ? (
                                    <div className="rounded-[24px] border border-dashed border-slate-200 bg-slate-50/80 p-5 text-sm text-slate-500">
                                        Draw a rectangle on the page and capture it. The selected region will appear here
                                        as text plus any structured questions detected inside it.
                                    </div>
                                ) : (
                                    selectionEntries.map((entry, index) => (
                                        <div
                                            key={entry.id}
                                            className="rounded-[24px] border border-slate-200 bg-slate-50/80 p-4"
                                        >
                                            <div className="flex flex-wrap items-center justify-between gap-2">
                                                <div className="flex flex-wrap items-center gap-2">
                                                    <span className="status-badge">Set {selectionEntries.length - index}</span>
                                                    <span className="status-badge">Page {entry.pageNumber}</span>
                                                    <span className="status-badge">{entry.questions.length} question(s)</span>
                                                </div>
                                                <div className="flex flex-wrap items-center gap-2">
                                                    {entry.status === "processing" ? (
                                                        <span className="status-badge">
                                                            <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                                                            Processing
                                                        </span>
                                                    ) : entry.status === "error" ? (
                                                        <span className="status-badge text-rose-600">{entry.error || "Error"}</span>
                                                    ) : (
                                                        <span className="status-badge">Ready</span>
                                                    )}
                                                    <button
                                                        type="button"
                                                        className="btn btn-ghost"
                                                        onClick={() =>
                                                            setSelectionEntries((current) =>
                                                                current.filter((item) => item.id !== entry.id)
                                                            )
                                                        }
                                                    >
                                                        Remove
                                                    </button>
                                                </div>
                                            </div>

                                            <div className="mt-3 rounded-[20px] border border-slate-200 bg-white p-3">
                                                <p className="text-sm font-medium text-slate-900">Selected text</p>
                                                <pre className="mt-2 whitespace-pre-wrap font-sans text-sm leading-relaxed text-slate-600">
                                                    {entry.text || "No text was detected inside this region yet."}
                                                </pre>
                                            </div>

                                            {entry.questions.length > 0 && (
                                                <div className="mt-3 space-y-2">
                                                    {entry.questions.map((question, questionIndex) => (
                                                        <div
                                                            key={`${entry.id}_${questionIndex}`}
                                                            className="rounded-[20px] border border-emerald-200 bg-emerald-50/70 p-3"
                                                        >
                                                            <p className="text-sm font-semibold text-emerald-900">
                                                                Q{questionIndex + 1}.{" "}
                                                                {question.questionHindi || question.questionEnglish}
                                                            </p>
                                                            {question.options.length > 0 && (
                                                                <div className="mt-2 grid gap-2 sm:grid-cols-2">
                                                                    {question.options.map((option, optionIndex) => (
                                                                        <div
                                                                            key={`${entry.id}_${questionIndex}_${optionIndex}`}
                                                                            className="rounded-[16px] border border-emerald-200 bg-white px-3 py-2 text-xs text-slate-700"
                                                                        >
                                                                            {optionIndex + 1}. {option.hindi || option.english}
                                                                        </div>
                                                                    ))}
                                                                </div>
                                                            )}
                                                        </div>
                                                    ))}
                                                </div>
                                            )}
                                        </div>
                                    ))
                                )}
                            </div>
                        </section>
                    </div>
                </article>
            </section>

            {openingSetModal && (
                <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
                    <button
                        type="button"
                        className="absolute inset-0 bg-slate-950/40"
                        onClick={() => !savingPreparedSet && setOpeningSetModal(false)}
                        aria-label="Close set name dialog"
                    />

                    <div className="relative w-full max-w-lg rounded-[32px] border border-slate-200 bg-white p-6 shadow-[0_32px_120px_rgba(15,23,42,0.22)]">
                        <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-slate-400">
                            Prepare Question Set
                        </p>
                        <h3 className="mt-3 text-2xl font-bold text-slate-900">
                            Name the set before saving it to Extractor
                        </h3>
                        <p className="mt-2 text-sm leading-relaxed text-slate-500">
                            This will create an extractor-compatible workspace from the selected question regions.
                        </p>

                        <label className="mt-5 block text-sm font-semibold text-slate-700">
                            Set name
                            <input
                                autoFocus
                                value={setNameDraft}
                                onChange={(event) => setSetNameDraft(event.target.value)}
                                className="mt-2 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-blue-300 focus:bg-white"
                                placeholder="Biology Chapter 11 Prepared Set"
                            />
                        </label>

                        <div className="mt-5 rounded-[22px] border border-slate-200 bg-slate-50/80 p-4">
                            <div className="flex flex-wrap items-center gap-2">
                                <span className="status-badge">{selectionEntries.length} selection(s)</span>
                                <span className="status-badge">{totalSelectedQuestions} question(s)</span>
                                <span className="status-badge">{book.title}</span>
                            </div>
                        </div>

                        <div className="mt-6 flex flex-wrap justify-end gap-2">
                            <button
                                type="button"
                                className="btn btn-ghost"
                                onClick={() => setOpeningSetModal(false)}
                                disabled={savingPreparedSet}
                            >
                                Cancel
                            </button>
                            <button
                                type="button"
                                className="btn btn-primary"
                                onClick={handlePrepareQuestionSet}
                                disabled={!setNameDraft.trim() || savingPreparedSet}
                            >
                                {savingPreparedSet ? (
                                    <>
                                        <Loader2 className="h-4 w-4 animate-spin" />
                                        Saving...
                                    </>
                                ) : (
                                    <>
                                        <Plus className="h-4 w-4" />
                                        Save To Extractor
                                    </>
                                )}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </>
    );
}
