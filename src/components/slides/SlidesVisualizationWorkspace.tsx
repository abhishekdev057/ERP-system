"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
    ArrowUpRight,
    CheckCircle2,
    ChevronLeft,
    ChevronRight,
    Download,
    FileImage,
    FileStack,
    ImageIcon,
    Layers3,
    LoaderCircle,
    RefreshCcw,
    Sparkles,
    Wand2,
} from "lucide-react";
import toast from "react-hot-toast";
import { StudioWorkspaceHero } from "@/components/content-studio/StudioWorkspaceHero";
import {
    buildSlideVisualizationQuestionSnapshot,
    getSlideVisualizationDirection,
    getSlideVisualizationQuestionKey,
    getSlideVisualizationQuestionPreview,
    resolveQuestionTextLayout,
    type SlideVisualizationQuestionSnapshot,
} from "@/lib/slides-visualization";
import {
    buildTopicSlideSnapshot,
    extractTopicSlidesFromDocument,
    extractTopicSourcePagesFromDocument,
    getTopicSlideKey,
    getTopicSlidePreview,
    isTopicSnapshot,
    resolveTopicTextLayout,
    type SlideVisualizationContentType,
    type SlideVisualizationTopicSnapshot,
} from "@/lib/slide-topics";
import { downloadBlobAsFile, formatDateTime } from "@/lib/utils";
import type { Question } from "@/types/pdf";

type WorkspaceStats = {
    pageCount: number;
    questionCount: number;
    topicCount: number;
    extractedPageCount: number;
    pendingPageCount: number;
    extractionState: "not_started" | "partial" | "extracted";
};

type SlidesDocumentRecord = {
    id: string;
    title: string;
    subject: string;
    date: string;
    createdAt: string;
    updatedAt: string;
    workspaceType?: "IMAGE_TO_PDF" | "JSON_TO_PDF" | "PDF_TO_PDF";
    correctionMarkCount?: number;
    workspaceStats?: WorkspaceStats;
};

type SlidesDocumentDetail = {
    id: string;
    title: string;
    subject: string;
    date: string;
    createdAt: string;
    updatedAt: string;
    jsonData: Record<string, unknown>;
};

type SlidesDocumentResponse = {
    documents: SlidesDocumentRecord[];
    pagination: {
        total: number;
        limit: number;
        offset: number;
        page: number;
        totalPages: number;
        hasMore: boolean;
    };
};

type GeminiUsageSummary = {
    usedWeightedUsage: number;
    remainingWeightedUsage: number;
    usagePercent: number;
    lastHourWeightedUsage: number;
    hourlyPercent: number;
    blocked: boolean;
    blockedUntil?: string;
    warnings: string[];
    nextResetAt: string;
};

type SlidesVisualizationItem = {
    id: string;
    documentId: string;
    questionKey: string;
    questionIndex: number;
    questionNumber: string;
    questionPreview: string;
    questionSnapshot: SlideVisualizationQuestionSnapshot | SlideVisualizationTopicSnapshot;
    prompt: string;
    generatedMediaId?: string | null;
    assetUrl?: string | null;
    status: string;
    imageModel?: string | null;
    createdAt: string;
    updatedAt: string;
};

type VisualizationSlideEntry = {
    key: string;
    index: number;
    number: string;
    preview: string;
    snapshot: SlideVisualizationQuestionSnapshot | SlideVisualizationTopicSnapshot;
    saved: SlidesVisualizationItem | null;
};

type BatchState = {
    total: number;
    completed: number;
    failed: number;
    currentLabel?: string;
};

const DOCUMENTS_PAGE_SIZE = 12;
const ESTIMATED_WEIGHT_PER_SLIDE = 2;

function sanitizeInlineText(value: unknown) {
    return String(value || "")
        .replace(/\s+/g, " ")
        .trim();
}

function getDocumentQuestions(document: SlidesDocumentDetail | null): Question[] {
    if (!document || typeof document.jsonData !== "object" || !document.jsonData) return [];
    const rawQuestions = (document.jsonData as { questions?: unknown }).questions;
    return Array.isArray(rawQuestions) ? (rawQuestions as Question[]) : [];
}

function getQuestionNumber(question: Question, index: number) {
    return sanitizeInlineText(question.number) || String(index + 1);
}

function getDocumentTopicSlides(document: SlidesDocumentDetail | null): SlideVisualizationTopicSnapshot[] {
    if (!document?.jsonData || typeof document.jsonData !== "object") return [];
    return extractTopicSlidesFromDocument(document.jsonData);
}

function getDocumentTopicSourceCount(document: SlidesDocumentDetail | null) {
    if (!document?.jsonData || typeof document.jsonData !== "object") return 0;
    return extractTopicSourcePagesFromDocument(document.jsonData).length;
}

function statusTone(state: WorkspaceStats["extractionState"] | undefined) {
    if (state === "extracted") return "bg-emerald-50 text-emerald-700 border-emerald-200";
    if (state === "partial") return "bg-amber-50 text-amber-700 border-amber-200";
    return "bg-slate-100 text-slate-600 border-slate-200";
}

function getSlideListLabel(entry: VisualizationSlideEntry) {
    return sanitizeInlineText(entry.preview).replace(/\s+/g, " ");
}

function getContentTypeLabel(contentType: SlideVisualizationContentType, count: number) {
    const noun = contentType === "topic" ? "topic slide" : "question";
    return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

function getInstituteName(document: SlidesDocumentDetail | null) {
    if (!document?.jsonData || typeof document.jsonData !== "object") return "";
    return sanitizeInlineText((document.jsonData as { instituteName?: unknown }).instituteName);
}

function getGenerationConcurrency(usage: GeminiUsageSummary | null, remainingCount: number) {
    if (!remainingCount) return 0;
    if (!usage) return 1;
    if (usage.blocked) return 0;
    if (usage.hourlyPercent >= 82 || usage.usagePercent >= 88) return 1;
    if (usage.remainingWeightedUsage < ESTIMATED_WEIGHT_PER_SLIDE * 2) return 1;
    return 2;
}

function isSlideGenerated(entry: VisualizationSlideEntry) {
    return Boolean(entry.saved?.assetUrl);
}

function LoadingPanel({ label }: { label: string }) {
    return (
        <div className="flex min-h-[260px] items-center justify-center rounded-[26px] border border-dashed border-slate-200 bg-slate-50 text-sm text-slate-500">
            <LoaderCircle className="mr-2 h-4 w-4 animate-spin" />
            {label}
        </div>
    );
}

export function SlidesVisualizationWorkspace() {
    const router = useRouter();
    const pathname = usePathname();
    const searchParams = useSearchParams();
    const requestedDocumentId = searchParams.get("documentId");
    const requestedMode = searchParams.get("mode") === "topic" ? "topic" : "question";

    const [documents, setDocuments] = useState<SlidesDocumentRecord[]>([]);
    const [pagination, setPagination] = useState<SlidesDocumentResponse["pagination"]>({
        total: 0,
        limit: DOCUMENTS_PAGE_SIZE,
        offset: 0,
        page: 1,
        totalPages: 1,
        hasMore: false,
    });
    const [searchInput, setSearchInput] = useState("");
    const [appliedQuery, setAppliedQuery] = useState("");
    const [documentsLoading, setDocumentsLoading] = useState(true);
    const [documentLoading, setDocumentLoading] = useState(false);
    const [visualizationsLoading, setVisualizationsLoading] = useState(false);
    const [selectedDocumentId, setSelectedDocumentId] = useState<string | null>(requestedDocumentId);
    const [selectedDocument, setSelectedDocument] = useState<SlidesDocumentDetail | null>(null);
    const [contentMode, setContentMode] = useState<SlideVisualizationContentType>(requestedMode);
    const [savedItems, setSavedItems] = useState<SlidesVisualizationItem[]>([]);
    const [usage, setUsage] = useState<GeminiUsageSummary | null>(null);
    const [activeQuestionKey, setActiveQuestionKey] = useState<string | null>(null);
    const [generatingKeys, setGeneratingKeys] = useState<string[]>([]);
    const [batchState, setBatchState] = useState<BatchState | null>(null);
    const [chunkingTopics, setChunkingTopics] = useState(false);
    const [exporting, setExporting] = useState(false);

    useEffect(() => {
        if (requestedDocumentId && requestedDocumentId !== selectedDocumentId) {
            setSelectedDocumentId(requestedDocumentId);
        }
    }, [requestedDocumentId, selectedDocumentId]);

    useEffect(() => {
        setContentMode(requestedMode);
    }, [requestedMode]);

    const handleSelectDocument = (documentId: string) => {
        setSelectedDocumentId(documentId);
        const params = new URLSearchParams(searchParams.toString());
        params.set("documentId", documentId);
        params.set("mode", contentMode);
        router.replace(`${pathname}?${params.toString()}`, { scroll: false });
    };

    const handleSelectMode = (nextMode: SlideVisualizationContentType) => {
        setContentMode(nextMode);
        const params = new URLSearchParams(searchParams.toString());
        if (selectedDocumentId) {
            params.set("documentId", selectedDocumentId);
        }
        params.set("mode", nextMode);
        router.replace(`${pathname}?${params.toString()}`, { scroll: false });
    };

    useEffect(() => {
        let cancelled = false;

        const run = async () => {
            setDocumentsLoading(true);
            try {
                const params = new URLSearchParams({
                    minimal: "true",
                    workspaceStats: "true",
                    limit: String(DOCUMENTS_PAGE_SIZE),
                    offset: String((pagination.page - 1) * DOCUMENTS_PAGE_SIZE),
                    sortBy: "updatedAt",
                    sortOrder: "desc",
                });
                if (appliedQuery.trim()) params.set("q", appliedQuery.trim());

                const response = await fetch(`/api/documents?${params.toString()}`, { cache: "no-store" });
                const data = (await response.json()) as SlidesDocumentResponse;
                if (!response.ok) {
                    throw new Error((data as { error?: string }).error || "Failed to load slide documents.");
                }
                if (cancelled) return;

                setDocuments(data.documents || []);
                setPagination((previous) => ({
                    ...data.pagination,
                    page: data.pagination?.page || previous.page,
                }));

                const nextSelected =
                    selectedDocumentId && data.documents.some((document) => document.id === selectedDocumentId)
                        ? selectedDocumentId
                        : requestedDocumentId && data.documents.some((document) => document.id === requestedDocumentId)
                            ? requestedDocumentId
                            : data.documents[0]?.id || null;

                setSelectedDocumentId(nextSelected);
            } catch (error) {
                console.error(error);
                if (!cancelled) {
                    toast.error(error instanceof Error ? error.message : "Failed to load slide documents.");
                    setDocuments([]);
                }
            } finally {
                if (!cancelled) {
                    setDocumentsLoading(false);
                }
            }
        };

        run();
        return () => {
            cancelled = true;
        };
    }, [appliedQuery, pagination.page, requestedDocumentId, selectedDocumentId]);

    useEffect(() => {
        if (!selectedDocumentId) {
            setSelectedDocument(null);
            setSavedItems([]);
            return;
        }

        let cancelled = false;

        const run = async () => {
            setDocumentLoading(true);
            try {
                const response = await fetch(`/api/documents/${selectedDocumentId}`, {
                    method: "GET",
                    cache: "no-store",
                });
                const data = await response.json();
                if (!response.ok) {
                    throw new Error(data.error || "Failed to load slide document.");
                }
                if (!cancelled) {
                    setSelectedDocument(data.document || null);
                }
            } catch (error) {
                console.error(error);
                if (!cancelled) {
                    toast.error(error instanceof Error ? error.message : "Failed to load selected document.");
                    setSelectedDocument(null);
                }
            } finally {
                if (!cancelled) {
                    setDocumentLoading(false);
                }
            }
        };

        run();
        return () => {
            cancelled = true;
        };
    }, [selectedDocumentId]);

    useEffect(() => {
        if (!selectedDocumentId) {
            setSavedItems([]);
            return;
        }

        let cancelled = false;

        const run = async () => {
            setVisualizationsLoading(true);
            try {
                const response = await fetch(`/api/content-studio/slides-visualizations?documentId=${encodeURIComponent(selectedDocumentId)}`, {
                    cache: "no-store",
                });
                const data = await response.json();
                if (!response.ok) {
                    throw new Error(data.error || "Failed to load saved slide visualizations.");
                }
                if (cancelled) return;
                setSavedItems(Array.isArray(data.items) ? data.items : []);
                setUsage(data.usage || null);
            } catch (error) {
                console.error(error);
                if (!cancelled) {
                    toast.error(error instanceof Error ? error.message : "Failed to load saved slide visualizations.");
                    setSavedItems([]);
                }
            } finally {
                if (!cancelled) {
                    setVisualizationsLoading(false);
                }
            }
        };

        run();
        return () => {
            cancelled = true;
        };
    }, [selectedDocumentId]);

    const savedByKey = useMemo(
        () => new Map(savedItems.map((item) => [item.questionKey, item])),
        [savedItems]
    );

    const questionEntries = useMemo<VisualizationSlideEntry[]>(() => {
        return getDocumentQuestions(selectedDocument).map((question, index) => {
            const snapshot = buildSlideVisualizationQuestionSnapshot(question);
            const key = getSlideVisualizationQuestionKey(question, index);
            const saved = savedByKey.get(key) || null;
            return {
                key,
                index,
                number: getQuestionNumber(question, index),
                preview: getSlideVisualizationQuestionPreview(question, 130),
                snapshot,
                saved,
            };
        });
    }, [savedByKey, selectedDocument]);

    const topicEntries = useMemo<VisualizationSlideEntry[]>(() => {
        return getDocumentTopicSlides(selectedDocument).map((topic, index) => {
            const snapshot = buildTopicSlideSnapshot(topic, index) || topic;
            const key = getTopicSlideKey(snapshot, index);
            const saved = savedByKey.get(key) || null;
            return {
                key,
                index,
                number: sanitizeInlineText(snapshot.number) || String(index + 1),
                preview: getTopicSlidePreview(snapshot, 130),
                snapshot,
                saved,
            };
        });
    }, [savedByKey, selectedDocument]);

    const topicSourceCount = useMemo(
        () => getDocumentTopicSourceCount(selectedDocument),
        [selectedDocument]
    );
    const currentEntries = contentMode === "topic" ? topicEntries : questionEntries;

    useEffect(() => {
        if (contentMode === "question" && questionEntries.length === 0 && (topicEntries.length > 0 || topicSourceCount > 0)) {
            setContentMode("topic");
        }
    }, [contentMode, questionEntries.length, topicEntries.length, topicSourceCount]);

    useEffect(() => {
        if (!currentEntries.length) {
            setActiveQuestionKey(null);
            return;
        }

        if (activeQuestionKey && currentEntries.some((entry) => entry.key === activeQuestionKey)) {
            return;
        }

        const firstRemaining = currentEntries.find((entry) => !entry.saved?.assetUrl);
        setActiveQuestionKey(firstRemaining?.key || currentEntries[0]?.key || null);
    }, [activeQuestionKey, currentEntries]);

    const selectedDocumentCard = useMemo(
        () => documents.find((document) => document.id === selectedDocumentId) || null,
        [documents, selectedDocumentId]
    );

    const activeQuestion = useMemo(
        () => currentEntries.find((entry) => entry.key === activeQuestionKey) || null,
        [activeQuestionKey, currentEntries]
    );

    const generatedCount = useMemo(
        () => currentEntries.filter((entry) => entry.saved?.assetUrl).length,
        [currentEntries]
    );
    const remainingCount = Math.max(0, currentEntries.length - generatedCount);
    const batchConcurrency = getGenerationConcurrency(usage, remainingCount);
    const instituteName = getInstituteName(selectedDocument);

    const handleGenerateTopicChunks = async (force = false) => {
        if (!selectedDocumentId) {
            toast.error("Select a document first.");
            return;
        }

        setChunkingTopics(true);
        try {
            const response = await fetch("/api/content-studio/slides-visualizations/topic-chunks", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({
                    documentId: selectedDocumentId,
                    force,
                }),
            });
            const data = await response.json().catch(() => ({}));
            if (!response.ok) {
                throw new Error(data.error || "Failed to prepare topic chunks.");
            }

            setSelectedDocument((current) =>
                current
                    ? {
                          ...current,
                          jsonData: {
                              ...(current.jsonData || {}),
                              topicSlides: Array.isArray(data.topicSlides) ? data.topicSlides : [],
                              topicSlidesGeneratedAt: new Date().toISOString(),
                          },
                      }
                    : current
            );
            handleSelectMode("topic");
            toast.success(
                data.generated === false
                    ? "Saved topic chunks are already available."
                    : "Topic chunks prepared and saved."
            );
        } catch (error) {
            console.error(error);
            toast.error(error instanceof Error ? error.message : "Failed to prepare topic chunks.");
        } finally {
            setChunkingTopics(false);
        }
    };

    const generateQuestion = async (entry: VisualizationSlideEntry, options?: { silent?: boolean }) => {
        if (!selectedDocument) {
            throw new Error("Select a document first.");
        }

        setGeneratingKeys((previous) => (previous.includes(entry.key) ? previous : [...previous, entry.key]));
        try {
            const generationResponse = await fetch("/api/content-studio/slides-visualizations/generate", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({
                    documentId: selectedDocumentId,
                    contentType: contentMode,
                    questionKey: entry.key,
                    questionIndex: entry.index,
                    questionNumber: entry.number,
                    questionPreview: entry.preview,
                    questionSnapshot: entry.snapshot,
                }),
            });
            const generation = await generationResponse.json();
            if (!generationResponse.ok) {
                throw new Error(generation.error || generation.message || "Failed to generate slide visual.");
            }

            const savedItem = generation.item as SlidesVisualizationItem;
            setSavedItems((previous) => {
                const next = [savedItem, ...previous.filter((item) => item.questionKey !== savedItem.questionKey)];
                return next.sort((left, right) => left.questionIndex - right.questionIndex);
            });
            if (generation.usage) {
                setUsage(generation.usage);
            }
            if (!options?.silent) {
                const label = contentMode === "topic" ? "Slide" : "Question";
                toast.success(
                    generation.fallbackUsed
                        ? `${label} ${entry.number} saved with visual fallback.`
                        : `${label} ${entry.number} visualized.`
                );
            }
            return savedItem;
        } finally {
            setGeneratingKeys((previous) => previous.filter((key) => key !== entry.key));
        }
    };

    const handleGenerateRemaining = async () => {
        const targets = currentEntries.filter((entry) => !entry.saved?.assetUrl);
        if (!targets.length) {
            toast.success(
                contentMode === "topic"
                    ? "All topic slides already have visualized artwork."
                    : "All questions already have visualized slides."
            );
            return;
        }
        if (usage?.blocked) {
            toast.error(
                usage.blockedUntil
                    ? `Gemini is cooling down till ${formatDateTime(usage.blockedUntil)}.`
                    : "Gemini usage is currently paused due to limits."
            );
            return;
        }

        const concurrency = getGenerationConcurrency(usage, targets.length);
        if (concurrency <= 0) {
            toast.error("Generation throughput is paused right now due to limit pressure.");
            return;
        }

        let cursor = 0;
        const batch = {
            total: targets.length,
            completed: 0,
            failed: 0,
            currentLabel: "",
        };
        setBatchState(batch);

        const worker = async () => {
            while (true) {
                const nextIndex = cursor;
                cursor += 1;
                if (nextIndex >= targets.length) break;
                const entry = targets[nextIndex];

                setBatchState((previous) =>
                    previous
                        ? {
                              ...previous,
                              currentLabel: `${contentMode === "topic" ? "Slide" : "Question"} ${entry.number}`,
                          }
                        : previous
                );

                try {
                    await generateQuestion(entry, { silent: true });
                    batch.completed += 1;
                } catch (error) {
                    console.error(error);
                    batch.failed += 1;
                    const message =
                        error instanceof Error ? error.message : "Slide generation failed.";
                    if (/quota|limit|429/i.test(message)) {
                        toast.error(message);
                        cursor = targets.length;
                    }
                } finally {
                    setBatchState({
                        ...batch,
                        currentLabel:
                            cursor < targets.length
                                ? `${contentMode === "topic" ? "Slide" : "Question"} ${targets[Math.min(cursor, targets.length - 1)].number}`
                                : "",
                    });
                }
            }
        };

        await Promise.all(Array.from({ length: concurrency }, () => worker()));

        setBatchState((previous) =>
            previous
                ? {
                      ...previous,
                      currentLabel: "",
                  }
                : previous
        );

        const completed = batch.completed;
        const failed = batch.failed;
        setBatchState(null);

        if (completed && !failed) {
            toast.success(`${completed} visualized slide${completed === 1 ? "" : "s"} ready.`);
        } else if (completed || failed) {
            toast.success(`${completed} completed · ${failed} failed.`);
        }
    };

    const handleExportPdf = async () => {
        if (!selectedDocumentId) {
            toast.error("Select a document first.");
            return;
        }

        setExporting(true);
        try {
            const response = await fetch(
                `/api/content-studio/slides-visualizations/export?documentId=${encodeURIComponent(selectedDocumentId)}&contentType=${contentMode}`,
                { cache: "no-store" }
            );
            if (!response.ok) {
                const data = await response.json().catch(() => ({}));
                throw new Error(data.error || "Failed to export visualized slides PDF.");
            }
            const blob = await response.blob();
            downloadBlobAsFile(blob, `${selectedDocument?.title || "visualized-slides"}-visualized-slides.pdf`);
        } catch (error) {
            console.error(error);
            toast.error(error instanceof Error ? error.message : "Failed to export visualized slides PDF.");
        } finally {
            setExporting(false);
        }
    };

    const activeTopicLayout =
        activeQuestion && isTopicSnapshot(activeQuestion.snapshot)
            ? resolveTopicTextLayout(activeQuestion.snapshot)
            : null;
    const activeQuestionLayout =
        activeQuestion && !isTopicSnapshot(activeQuestion.snapshot)
            ? resolveQuestionTextLayout(activeQuestion.snapshot)
            : null;
    const activeDirection = activeQuestion
        ? getSlideVisualizationDirection(
              isTopicSnapshot(activeQuestion.snapshot)
                  ? ({
                        number: activeQuestion.snapshot.number,
                        questionHindi: activeQuestion.snapshot.title,
                        questionEnglish: activeQuestion.snapshot.summary,
                        options: activeQuestion.snapshot.bulletPoints.map((line) => ({
                            hindi: line,
                            english: line,
                        })),
                    } as SlideVisualizationQuestionSnapshot)
                  : activeQuestion.snapshot
          )
        : null;
    const activeIsGenerating = Boolean(activeQuestion && generatingKeys.includes(activeQuestion.key));

    return (
        <div className="page-container" style={{ width: "min(1600px, calc(100% - 2rem))" }}>
            <StudioWorkspaceHero
                theme="slides"
                eyebrow="Institute Suite · Slides Visuals"
                title="Question-and-topic visual slide pipeline"
                description="Load a saved document, switch between questions and topic-note chunks, generate premium 16:9 visual slides, save them one-by-one or in batches, and export the finished branded deck as PDF."
                highlights={["Nexen 2 visual slides", "Topic-note chunk mode", "Batch remaining slides", "Saved visual PDF export"]}
                actions={[
                    { href: "/content-studio/slides", label: "Slides Workspace", tone: "secondary" },
                    { href: "/content-studio", label: "Tool Hub", tone: "ghost" },
                    { href: "/content-studio/media", label: "Media Studio", tone: "ghost" },
                ]}
                helperText="Every saved asset is now a complete 16:9 slide image. The generator aims for illustrated coaching-style visuals with exact question or topic text, shared institute branding, richer composition, and export-ready layout."
            />

            <section className="mb-5 grid gap-4 xl:grid-cols-[320px_minmax(0,1.22fr)_380px]">
                <aside className="flex flex-col rounded-[30px] border border-slate-200 bg-[linear-gradient(180deg,#fff,rgba(248,250,252,0.98))] p-4 shadow-[0_28px_80px_-48px_rgba(15,23,42,0.26)] xl:max-h-[calc(100vh-180px)]">
                    <div className="flex items-center justify-between gap-2">
                        <div>
                            <span className="eyebrow">Slides Browser</span>
                            <h3 className="mt-2 text-lg font-bold text-slate-950">Select document</h3>
                        </div>
                        <span className="rounded-full border border-slate-200 bg-white px-3 py-1 text-[11px] font-semibold text-slate-500">
                            {pagination.total} total
                        </span>
                    </div>

                    <div className="mt-4 flex gap-2">
                        <input
                            value={searchInput}
                            onChange={(event) => setSearchInput(event.target.value)}
                            onKeyDown={(event) => {
                                if (event.key === "Enter") {
                                    setPagination((previous) => ({ ...previous, page: 1 }));
                                    setAppliedQuery(searchInput.trim());
                                }
                            }}
                            placeholder="Search title or subject..."
                            className="h-11 flex-1 rounded-2xl border border-slate-200 bg-white px-3 text-sm text-slate-700 outline-none transition focus:border-sky-300 focus:ring-4 focus:ring-sky-100"
                        />
                        <button
                            type="button"
                            onClick={() => {
                                setPagination((previous) => ({ ...previous, page: 1 }));
                                setAppliedQuery(searchInput.trim());
                            }}
                            className="btn btn-secondary text-xs"
                        >
                            Search
                        </button>
                    </div>

                    <div className="mt-4 flex-1 space-y-3 overflow-y-auto pr-1">
                        {documentsLoading ? (
                            <LoadingPanel label="Loading slide documents..." />
                        ) : documents.length === 0 ? (
                            <div className="rounded-[24px] border border-dashed border-slate-200 bg-slate-50 p-5 text-sm text-slate-500">
                                No saved slide-ready documents मिले. Extractor me koi deck save karke yahan wapas aao.
                            </div>
                        ) : (
                            documents.map((document) => (
                                <button
                                    key={document.id}
                                    type="button"
                                    onClick={() => handleSelectDocument(document.id)}
                                    className={`w-full rounded-[24px] border p-4 text-left transition ${
                                        document.id === selectedDocumentId
                                            ? "border-sky-300 bg-[linear-gradient(180deg,#eff6ff,#fff)] shadow-[0_24px_60px_-42px_rgba(59,130,246,0.35)]"
                                            : "border-slate-200 bg-white hover:border-sky-200 hover:bg-slate-50"
                                    }`}
                                >
                                    <div className="flex items-start justify-between gap-3">
                                        <div className="min-w-0">
                                            <p className="text-sm font-semibold text-slate-900">{document.title}</p>
                                            <p className="mt-1 text-xs text-slate-500">
                                                {document.subject} · {document.date}
                                            </p>
                                        </div>
                                        <span className={`shrink-0 rounded-full border px-2 py-1 text-[10px] font-bold uppercase ${statusTone(document.workspaceStats?.extractionState)}`}>
                                            {document.workspaceStats?.extractionState || "ready"}
                                        </span>
                                    </div>

                                    <div className="mt-4 grid grid-cols-2 gap-2 text-[11px] text-slate-500">
                                        <div className="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2">
                                            <span className="block text-[10px] font-semibold uppercase tracking-[0.22em] text-slate-400">Pages</span>
                                            <span className="mt-1 block text-sm font-semibold text-slate-900">{document.workspaceStats?.pageCount || 0}</span>
                                        </div>
                                        <div className="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2">
                                            <span className="block text-[10px] font-semibold uppercase tracking-[0.22em] text-slate-400">
                                                {contentMode === "topic" ? "Topics" : "Questions"}
                                            </span>
                                            <span className="mt-1 block text-sm font-semibold text-slate-900">
                                                {contentMode === "topic"
                                                    ? document.workspaceStats?.topicCount || 0
                                                    : document.workspaceStats?.questionCount || 0}
                                            </span>
                                        </div>
                                    </div>
                                </button>
                            ))
                        )}
                    </div>

                    <div className="mt-4 flex items-center justify-between gap-3 rounded-[20px] border border-slate-200 bg-slate-50 px-3 py-2">
                        <button
                            type="button"
                            onClick={() => setPagination((previous) => ({ ...previous, page: Math.max(previous.page - 1, 1) }))}
                            disabled={pagination.page <= 1}
                            className="btn btn-ghost text-xs disabled:opacity-50"
                        >
                            <ChevronLeft className="mr-1 h-4 w-4" />
                            Prev
                        </button>
                        <span className="text-xs font-semibold text-slate-500">
                            Page {pagination.page} / {pagination.totalPages}
                        </span>
                        <button
                            type="button"
                            onClick={() =>
                                setPagination((previous) => ({
                                    ...previous,
                                    page: Math.min(previous.page + 1, pagination.totalPages),
                                }))
                            }
                            disabled={pagination.page >= pagination.totalPages}
                            className="btn btn-ghost text-xs disabled:opacity-50"
                        >
                            Next
                            <ChevronRight className="ml-1 h-4 w-4" />
                        </button>
                    </div>
                </aside>

                <section className="flex min-h-[760px] flex-col rounded-[30px] border border-slate-200 bg-[linear-gradient(180deg,#fff,rgba(248,250,252,0.98))] p-4 shadow-[0_28px_80px_-48px_rgba(15,23,42,0.26)]">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                            <span className="eyebrow">Visualization Lane</span>
                            <h3 className="mt-2 text-xl font-bold tracking-tight text-slate-950">
                                {selectedDocumentCard?.title || "Choose a document to start"}
                            </h3>
                            <p className="mt-1 text-sm text-slate-500">
                                {selectedDocumentCard
                                    ? `${selectedDocumentCard.subject} · ${selectedDocumentCard.date} · ${getContentTypeLabel(contentMode, currentEntries.length)}`
                                    : "Switch between question visuals and topic-note visuals after loading a document."}
                            </p>
                        </div>

                        <div className="flex flex-wrap gap-2">
                            <div className="flex items-center gap-1 rounded-full border border-slate-200 bg-white p-1">
                                <button
                                    type="button"
                                    onClick={() => handleSelectMode("question")}
                                    disabled={!questionEntries.length}
                                    className={`btn text-xs ${contentMode === "question" ? "btn-primary" : "btn-ghost"} disabled:opacity-50`}
                                >
                                    Questions
                                </button>
                                <button
                                    type="button"
                                    onClick={() => handleSelectMode("topic")}
                                    disabled={!topicEntries.length && topicSourceCount === 0}
                                    className={`btn text-xs ${contentMode === "topic" ? "btn-primary" : "btn-ghost"} disabled:opacity-50`}
                                >
                                    Topics / Notes
                                </button>
                            </div>
                            {contentMode === "topic" ? (
                                <button
                                    type="button"
                                    onClick={() => void handleGenerateTopicChunks(topicEntries.length > 0)}
                                    disabled={!topicSourceCount || chunkingTopics}
                                    className="btn btn-secondary text-xs"
                                >
                                    {chunkingTopics ? <LoaderCircle className="mr-2 h-4 w-4 animate-spin" /> : <Layers3 className="mr-2 h-4 w-4" />}
                                    {topicEntries.length > 0 ? "Refresh Topic Chunks" : "Build Topic Chunks"}
                                </button>
                            ) : null}
                            <button
                                type="button"
                                onClick={() => activeQuestion && void generateQuestion(activeQuestion)}
                                disabled={!activeQuestion || activeIsGenerating}
                                className="btn btn-secondary text-xs"
                            >
                                {activeIsGenerating ? <LoaderCircle className="mr-2 h-4 w-4 animate-spin" /> : <Wand2 className="mr-2 h-4 w-4" />}
                                {contentMode === "topic" ? "Generate This Topic Slide" : "Generate This Slide"}
                            </button>
                            <button
                                type="button"
                                onClick={() => void handleGenerateRemaining()}
                                disabled={!remainingCount || Boolean(batchState)}
                                className="btn btn-primary text-xs"
                            >
                                {batchState ? <LoaderCircle className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}
                                Generate Remaining ({remainingCount})
                            </button>
                            <button
                                type="button"
                                onClick={() => void handleExportPdf()}
                                disabled={!generatedCount || exporting}
                                className="btn btn-ghost text-xs"
                            >
                                {exporting ? <LoaderCircle className="mr-2 h-4 w-4 animate-spin" /> : <Download className="mr-2 h-4 w-4" />}
                                Download Visual PDF
                            </button>
                        </div>
                    </div>

                    <div className="mt-4 grid gap-3 md:grid-cols-4">
                        <MetricCard label="Saved Visual Slides" value={String(generatedCount)} detail="Already generated and reusable." icon={FileImage} />
                        <MetricCard
                            label="Remaining"
                            value={String(remainingCount)}
                            detail={contentMode === "topic" ? "Topic slides still waiting for visual generation." : "Questions still waiting for visual generation."}
                            icon={Layers3}
                        />
                        <MetricCard label="Throughput" value={batchConcurrency ? `${batchConcurrency}x` : "Paused"} detail="Batch workers chosen from Gemini load." icon={Sparkles} />
                        <MetricCard
                            label="Gemini Load"
                            value={usage ? `${usage.usedWeightedUsage}/${usage.usedWeightedUsage + usage.remainingWeightedUsage}` : "—"}
                            detail={
                                usage?.blocked
                                    ? `Cooldown till ${usage.blockedUntil ? formatDateTime(usage.blockedUntil) : "later"}`
                                    : usage
                                        ? `${usage.hourlyPercent}% hourly · resets ${formatDateTime(usage.nextResetAt)}`
                                        : "Usage sync pending."
                            }
                            icon={RefreshCcw}
                        />
                    </div>

                    {batchState && (
                        <div className="mt-4 rounded-[24px] border border-sky-200 bg-[linear-gradient(180deg,#eff6ff,#fff)] p-4">
                            <div className="flex flex-wrap items-center justify-between gap-3">
                                <div>
                                    <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-sky-600">Batch Generation Live</p>
                                    <p className="mt-1 text-sm font-medium text-slate-900">
                                        {batchState.currentLabel ? `${batchState.currentLabel} in progress` : "Finalizing queue"}
                                    </p>
                                </div>
                                <span className="rounded-full border border-sky-200 bg-white px-3 py-1 text-xs font-semibold text-sky-700">
                                    {batchState.completed}/{batchState.total} complete
                                </span>
                            </div>
                            <div className="mt-3 h-2 overflow-hidden rounded-full bg-sky-100">
                                <div
                                    className="h-full rounded-full bg-sky-500 transition-all"
                                    style={{
                                        width: `${batchState.total ? ((batchState.completed + batchState.failed) / batchState.total) * 100 : 0}%`,
                                    }}
                                />
                            </div>
                        </div>
                    )}

                    <div className="mt-4 grid flex-1 gap-4 xl:grid-cols-[320px_minmax(0,1fr)]">
                        <div className="flex min-h-0 flex-col rounded-[26px] border border-slate-200 bg-slate-50 p-3">
                            <div className="flex items-center justify-between gap-2">
                                <div>
                                    <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-500">
                                        {contentMode === "topic" ? "Topic Queue" : "Question Queue"}
                                    </p>
                                    <p className="mt-1 text-sm font-semibold text-slate-900">
                                        {currentEntries.length
                                            ? `${getContentTypeLabel(contentMode, currentEntries.length)} ready`
                                            : contentMode === "topic"
                                                ? "No topic chunks yet"
                                                : "No questions yet"}
                                    </p>
                                </div>
                                {visualizationsLoading ? <LoaderCircle className="h-4 w-4 animate-spin text-slate-400" /> : null}
                            </div>

                            <div className="mt-3 flex-1 space-y-2 overflow-y-auto pr-1">
                                {documentLoading ? (
                                    <LoadingPanel label={contentMode === "topic" ? "Loading topic chunks..." : "Loading questions..."} />
                                ) : currentEntries.length === 0 ? (
                                    <div className="rounded-[20px] border border-dashed border-slate-200 bg-white p-4 text-sm text-slate-500">
                                        {contentMode === "topic"
                                            ? topicSourceCount > 0
                                                ? "This document has topic-source pages. Click Build Topic Chunks to prepare slide-fitted notes."
                                                : "This document does not have topic-source pages yet."
                                            : "This document does not have structured questions yet."}
                                    </div>
                                ) : (
                                    currentEntries.map((entry) => {
                                        const active = entry.key === activeQuestionKey;
                                        const generated = isSlideGenerated(entry);
                                        const isGenerating = generatingKeys.includes(entry.key);
                                        return (
                                            <button
                                                key={entry.key}
                                                type="button"
                                                onClick={() => setActiveQuestionKey(entry.key)}
                                                className={`w-full rounded-[22px] border p-3 text-left transition ${
                                                    active
                                                        ? "border-sky-300 bg-white shadow-[0_16px_40px_-30px_rgba(59,130,246,0.28)]"
                                                        : "border-slate-200 bg-white hover:border-sky-200"
                                                }`}
                                            >
                                                <div className="flex items-start justify-between gap-3">
                                                    <div className="min-w-0 flex-1">
                                                        <div className="flex items-center gap-2">
                                                            <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.18em] text-slate-500">
                                                                {contentMode === "topic" ? "Slide" : "Q"} {entry.number}
                                                            </span>
                                                            {generated ? (
                                                                <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.18em] text-emerald-700">
                                                                    Saved
                                                                </span>
                                                            ) : (
                                                                <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.18em] text-amber-700">
                                                                    Pending
                                                                </span>
                                                            )}
                                                        </div>
                                                        <p className="mt-2 truncate text-sm font-medium text-slate-900">
                                                            {getSlideListLabel(entry)}
                                                        </p>
                                                    </div>
                                                    <div className="shrink-0">
                                                        {isGenerating ? (
                                                            <LoaderCircle className="h-4 w-4 animate-spin text-sky-500" />
                                                        ) : generated ? (
                                                            <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                                                        ) : (
                                                            <Wand2 className="h-4 w-4 text-slate-400" />
                                                        )}
                                                    </div>
                                                </div>
                                            </button>
                                        );
                                    })
                                )}
                            </div>
                        </div>

                        <div className="grid min-h-0 gap-4 xl:grid-cols-[minmax(0,0.98fr)_360px]">
                            <div className="flex min-h-0 flex-col rounded-[26px] border border-slate-200 bg-white p-4 shadow-[0_20px_60px_-46px_rgba(15,23,42,0.28)]">
                                <div className="flex items-start justify-between gap-3">
                                    <div>
                                        <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-500">
                                            {contentMode === "topic" ? "Full Topic Slide" : "Full Question"}
                                        </p>
                                        <h4 className="mt-2 text-lg font-bold text-slate-950">
                                            {activeQuestion
                                                ? `${contentMode === "topic" ? "Slide" : "Question"} ${activeQuestion.number}`
                                                : `Pick a ${contentMode === "topic" ? "topic" : "question"}`}
                                        </h4>
                                    </div>
                                    {activeQuestion ? (
                                        <button
                                            type="button"
                                            onClick={() => void generateQuestion(activeQuestion)}
                                            disabled={activeIsGenerating}
                                            className="btn btn-primary text-xs"
                                        >
                                            {activeIsGenerating ? <LoaderCircle className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}
                                            Generate visualized slide
                                        </button>
                                    ) : null}
                                </div>

                            <div className="mt-4 flex-1 overflow-y-auto pr-1">
                                    {!activeQuestion || (!activeTopicLayout && !activeQuestionLayout) ? (
                                        <div className="flex min-h-[320px] items-center justify-center rounded-[24px] border border-dashed border-slate-200 bg-slate-50 text-sm text-slate-500">
                                            {contentMode === "topic"
                                                ? "Pick any saved topic chunk from the left rail to open the full prompt."
                                                : "Pick any single-line question from the left rail to open the full prompt."}
                                        </div>
                                    ) : (
                                        <div className="rounded-[24px] border border-slate-200 bg-[linear-gradient(180deg,#fff,#f8fafc)] p-5">
                                            {activeDirection ? (
                                                <div className="mb-4 grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,0.92fr)]">
                                                    <div className="rounded-[20px] border border-sky-100 bg-sky-50 px-4 py-4">
                                                        <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-sky-700">Visual Direction</p>
                                                        <p className="mt-2 text-base font-bold text-slate-950">{activeDirection.layoutName}</p>
                                                        <p className="mt-2 text-sm leading-relaxed text-slate-600">{activeDirection.styleSummary}</p>
                                                    </div>
                                                    <div className="rounded-[20px] border border-emerald-100 bg-emerald-50 px-4 py-4">
                                                        <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-emerald-700">Prompt Intent</p>
                                                        <div className="mt-2 space-y-2 text-sm leading-relaxed text-slate-700">
                                                            <p>{activeDirection.visualCue}</p>
                                                            <p>{activeDirection.optionHint}</p>
                                                        </div>
                                                    </div>
                                                </div>
                                            ) : null}
                                            <div className="rounded-[18px] border border-sky-100 bg-sky-50 px-4 py-3 text-[11px] font-semibold uppercase tracking-[0.22em] text-sky-700">
                                                Exact exported text
                                            </div>
                                            <div className="mt-4 space-y-5">
                                                {isTopicSnapshot(activeQuestion.snapshot) ? (
                                                    <>
                                                        <div>
                                                            <p className="text-2xl font-bold leading-relaxed text-slate-950">
                                                                {activeTopicLayout?.title}
                                                            </p>
                                                            <p className="mt-3 text-base leading-relaxed text-slate-600">
                                                                {activeTopicLayout?.summary}
                                                            </p>
                                                        </div>
                                                        <div className="grid gap-3 md:grid-cols-2">
                                                            {activeTopicLayout?.bulletPoints.map((line) => (
                                                                <div key={line} className="rounded-[20px] border border-slate-200 bg-white px-4 py-3 text-sm font-medium leading-relaxed text-slate-900">
                                                                    {line}
                                                                </div>
                                                            ))}
                                                        </div>
                                                        {activeTopicLayout?.noteLines.length ? (
                                                            <div className="rounded-[20px] border border-emerald-100 bg-emerald-50 px-4 py-4">
                                                                <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-emerald-700">Teaching Notes</p>
                                                                <div className="mt-3 space-y-2 text-sm leading-relaxed text-slate-800">
                                                                    {activeTopicLayout.noteLines.map((line) => (
                                                                        <p key={line}>{line}</p>
                                                                    ))}
                                                                </div>
                                                                {activeTopicLayout.sourcePageLabel ? (
                                                                    <p className="mt-3 text-xs font-medium text-emerald-800">
                                                                        Source: {activeTopicLayout.sourcePageLabel}
                                                                    </p>
                                                                ) : null}
                                                            </div>
                                                        ) : null}
                                                    </>
                                                ) : activeQuestionLayout?.optionBlock.type === "match" ? (
                                                    <div className="grid gap-4 md:grid-cols-2">
                                                        <div className="rounded-[20px] border border-slate-200 bg-white p-4">
                                                            <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-500">Column I</p>
                                                            <div className="mt-3 space-y-2 text-sm leading-relaxed text-slate-900">
                                                                {activeQuestionLayout.optionBlock.leftLines.map((line) => (
                                                                    <p key={line}>{line}</p>
                                                                ))}
                                                            </div>
                                                        </div>
                                                        <div className="rounded-[20px] border border-slate-200 bg-white p-4">
                                                            <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-500">Column II</p>
                                                            <div className="mt-3 space-y-2 text-sm leading-relaxed text-slate-900">
                                                                {activeQuestionLayout.optionBlock.rightLines.map((line) => (
                                                                    <p key={line}>{line}</p>
                                                                ))}
                                                            </div>
                                                        </div>
                                                    </div>
                                                ) : (
                                                    <>
                                                        <div>
                                                            <p className="text-xl font-bold leading-relaxed text-slate-950">
                                                                {activeQuestionLayout?.primaryQuestion}
                                                            </p>
                                                        </div>
                                                        <div className="grid gap-3 md:grid-cols-2">
                                                            {activeQuestionLayout?.optionBlock.optionLines?.map((line) => (
                                                                <div key={line} className="rounded-[20px] border border-slate-200 bg-white px-4 py-3 text-sm font-medium leading-relaxed text-slate-900">
                                                                    {line}
                                                                </div>
                                                            ))}
                                                        </div>
                                                    </>
                                                )}
                                            </div>
                                        </div>
                                    )}
                                </div>
                            </div>

                            <div className="flex min-h-0 flex-col gap-4">
                                <div className="rounded-[26px] border border-slate-200 bg-white p-4 shadow-[0_20px_60px_-46px_rgba(15,23,42,0.28)]">
                                    <div className="flex items-start justify-between gap-2">
                                        <div>
                                            <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-500">Saved Slide Preview</p>
                            <h4 className="mt-2 text-lg font-bold text-slate-950">
                                {activeQuestion?.saved?.assetUrl ? "Full slide ready" : "Awaiting generation"}
                            </h4>
                                        </div>
                                        {activeQuestion?.saved?.assetUrl ? (
                                            <a
                                                href={activeQuestion.saved.assetUrl || "#"}
                                                target="_blank"
                                                rel="noreferrer"
                                                className="btn btn-ghost text-xs"
                                            >
                                                Open asset
                                                <ArrowUpRight className="ml-2 h-4 w-4" />
                                            </a>
                                        ) : null}
                                    </div>

                                    <div className="mt-4 overflow-hidden rounded-[24px] border border-slate-200 bg-slate-950">
                                        {activeQuestion?.saved?.assetUrl ? (
                                            <div className="relative aspect-video bg-slate-950">
                                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                                <img
                                                    src={activeQuestion.saved.assetUrl || ""}
                                                    alt={`${contentMode === "topic" ? "Topic slide" : "Question"} ${activeQuestion.number} visual`}
                                                    className="h-full w-full object-contain"
                                                />
                                            </div>
                                        ) : (
                                            <div className="flex aspect-video flex-col items-center justify-center gap-3 bg-[radial-gradient(circle_at_top,_rgba(56,189,248,0.12),_transparent_42%),linear-gradient(180deg,#0f172a,#020617)] p-6 text-center">
                                                <div className="flex h-16 w-16 items-center justify-center rounded-[22px] border border-white/10 bg-white/5">
                                                    <ImageIcon className="h-8 w-8 text-sky-300" />
                                                </div>
                                                <div>
                                                    <p className="text-sm font-semibold text-white">No saved slide yet</p>
                                                    <p className="mt-1 text-xs text-slate-300">
                                                        {contentMode === "topic"
                                                            ? "Generate this topic slide to save its art and include it in the export PDF."
                                                            : "Generate this question to save its art and include it in the export PDF."}
                                                    </p>
                                                </div>
                                            </div>
                                        )}
                                    </div>

                                    {activeQuestion?.saved ? (
                                        <div className="mt-4 space-y-2 text-xs text-slate-500">
                                            <div className="flex items-center justify-between gap-2">
                                                <span>Saved at</span>
                                                <span className="font-medium text-slate-700">{formatDateTime(activeQuestion.saved.updatedAt)}</span>
                                            </div>
                                            <div className="flex items-center justify-between gap-2">
                                                <span>Generation mode</span>
                                                <span className="font-medium text-slate-700">{activeQuestion.saved.imageModel || "nexen_2"}</span>
                                            </div>
                                            <div className="flex items-center justify-between gap-2">
                                                <span>Visual style</span>
                                                <span className="font-medium text-slate-700">{activeDirection?.layoutName || "Infographic slide"}</span>
                                            </div>
                                        </div>
                                    ) : null}
                                </div>

                                <div className="rounded-[26px] border border-slate-200 bg-white p-4 shadow-[0_20px_60px_-46px_rgba(15,23,42,0.28)]">
                                    <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-500">Generation Standards</p>
                                    <div className="mt-3 space-y-3 text-sm text-slate-600">
                                        <p>Nexen 2 output should feel like a premium coaching infographic slide, not a plain document page.</p>
                                        <p>Every new slide now carries institute branding with the logo on the left, institute name beside it, and one shared short intro line in the footer.</p>
                                        <p>If the first visual comes back weak or document-like, the pipeline retries with a stronger visual brief before falling back.</p>
                                        <p>
                                            {`Batch generation targets only remaining ${contentMode === "topic" ? "topic slides" : "questions"} and still respects Gemini load pressure.`}
                                        </p>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </section>
            </section>
        </div>
    );
}

function MetricCard({
    label,
    value,
    detail,
    icon: Icon,
}: {
    label: string;
    value: string;
    detail: string;
    icon: typeof FileStack;
}) {
    return (
        <div className="rounded-[24px] border border-slate-200 bg-white p-4 shadow-[0_18px_50px_-40px_rgba(15,23,42,0.28)]">
            <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-500">{label}</span>
                <Icon className="h-4 w-4 text-sky-500" />
            </div>
            <p className="mt-3 text-[1.75rem] font-bold tracking-tight text-slate-950">{value}</p>
            <p className="mt-1 text-xs leading-relaxed text-slate-500">{detail}</p>
        </div>
    );
}
