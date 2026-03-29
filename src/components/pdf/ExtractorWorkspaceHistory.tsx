"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import toast from "react-hot-toast";
import {
    CalendarDays,
    ChevronLeft,
    ChevronRight,
    Eye,
    FileStack,
    FolderOpen,
    LayoutGrid,
    List,
    Loader2,
    RefreshCw,
    ScrollText,
} from "lucide-react";
import { formatDateTime } from "@/lib/utils";

type WorkspaceType = "IMAGE_TO_PDF" | "JSON_TO_PDF" | "PDF_TO_PDF";
type HistoryViewMode = "cards" | "calendar";

type WorkspaceStats = {
    pageCount: number;
    questionCount: number;
    extractedPageCount: number;
    pendingPageCount: number;
    extractionState: "not_started" | "partial" | "extracted";
};

type ExtractorWorkspaceRecord = {
    id: string;
    title: string;
    subject: string;
    date: string;
    updatedAt: string;
    workspaceType?: WorkspaceType;
    correctionMarkCount?: number;
    workspaceStats?: WorkspaceStats;
};

type WorkspacePagination = {
    total: number;
    limit: number;
    offset: number;
    page: number;
    totalPages: number;
    hasMore: boolean;
};

const WORKSPACE_TYPE_LABELS: Record<WorkspaceType, string> = {
    IMAGE_TO_PDF: "Image Workspace",
    JSON_TO_PDF: "JSON Workspace",
    PDF_TO_PDF: "PDF Workspace",
};

type ExtractorWorkspaceHistoryProps = {
    currentDocumentId?: string | null;
    isLoadingCurrentDocument?: boolean;
    limit?: number;
};

function formatMonthKey(value: string) {
    return `${value.slice(0, 4)}-${value.slice(5, 7)}`;
}

function formatMonthLabel(key: string) {
    const parsed = new Date(`${key}-01T00:00:00`);
    if (Number.isNaN(parsed.getTime())) return key;
    return parsed.toLocaleString("en-IN", {
        month: "long",
        year: "numeric",
    });
}

function formatDayLabel(value: string) {
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return value;
    return parsed.toLocaleString("en-IN", {
        day: "2-digit",
        month: "short",
    });
}

function buildPaginationItems(currentPage: number, totalPages: number): Array<number | "ellipsis"> {
    if (totalPages <= 5) {
        return Array.from({ length: totalPages }, (_, index) => index + 1);
    }

    const visiblePages = new Set([1, totalPages, currentPage - 1, currentPage, currentPage + 1]);
    const sortedPages = Array.from(visiblePages)
        .filter((page) => page >= 1 && page <= totalPages)
        .sort((left, right) => left - right);

    const items: Array<number | "ellipsis"> = [];
    sortedPages.forEach((page, index) => {
        const previous = sortedPages[index - 1];
        if (index > 0 && previous !== undefined && page - previous > 1) {
            items.push("ellipsis");
        }
        items.push(page);
    });

    return items;
}

function getWorkspaceStatus(workspace: ExtractorWorkspaceRecord) {
    const stats = workspace.workspaceStats;
    if (!stats || stats.pageCount === 0) {
        return {
            label: "No pages yet",
            tone: "border-slate-200 bg-slate-50 text-slate-600",
            helper: "Open to start adding or extracting pages.",
        };
    }

    if (stats.questionCount === 0) {
        return {
            label: "Nothing extracted yet",
            tone: "border-amber-200 bg-amber-50 text-amber-700",
            helper: `${stats.pageCount} page(s) waiting for extraction.`,
        };
    }

    if (stats.pendingPageCount > 0) {
        return {
            label: "Partially extracted",
            tone: "border-sky-200 bg-sky-50 text-sky-700",
            helper: `${stats.questionCount} question(s) ready, ${stats.pendingPageCount} page(s) still pending.`,
        };
    }

    return {
        label: "Fully extracted",
        tone: "border-emerald-200 bg-emerald-50 text-emerald-700",
        helper: `${stats.questionCount} question(s) extracted across ${stats.pageCount} page(s).`,
    };
}

function getCalendarGrid(monthKey: string) {
    const monthStart = new Date(`${monthKey}-01T00:00:00`);
    if (Number.isNaN(monthStart.getTime())) return [];

    const firstDayOffset = (monthStart.getDay() + 6) % 7;
    const gridStart = new Date(monthStart);
    gridStart.setDate(monthStart.getDate() - firstDayOffset);

    return Array.from({ length: 35 }, (_, index) => {
        const cellDate = new Date(gridStart);
        cellDate.setDate(gridStart.getDate() + index);
        return cellDate;
    });
}

function tinyMetric(label: string, value: number, tone = "bg-slate-100 text-slate-600") {
    return (
        <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${tone}`}>
            {label}: {value}
        </span>
    );
}

export function ExtractorWorkspaceHistory({
    currentDocumentId,
    isLoadingCurrentDocument = false,
    limit = 12,
}: ExtractorWorkspaceHistoryProps) {
    const router = useRouter();
    const [workspaces, setWorkspaces] = useState<ExtractorWorkspaceRecord[]>([]);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [openingWorkspaceId, setOpeningWorkspaceId] = useState<string | null>(null);
    const [reloadToken, setReloadToken] = useState(0);
    const [viewMode, setViewMode] = useState<HistoryViewMode>("cards");
    const [currentPage, setCurrentPage] = useState(1);
    const [pagination, setPagination] = useState<WorkspacePagination>({
        total: 0,
        limit,
        offset: 0,
        page: 1,
        totalPages: 1,
        hasMore: false,
    });
    const [selectedMonthKey, setSelectedMonthKey] = useState<string | null>(null);

    useEffect(() => {
        if (!openingWorkspaceId || openingWorkspaceId === currentDocumentId) {
            setOpeningWorkspaceId(null);
        }
    }, [currentDocumentId, openingWorkspaceId]);

    useEffect(() => {
        const controller = new AbortController();
        let active = true;

        async function loadWorkspaces() {
            try {
                if (workspaces.length === 0) {
                    setLoading(true);
                } else {
                    setRefreshing(true);
                }

                const offset = Math.max(currentPage - 1, 0) * Math.max(limit, 1);
                const params = new URLSearchParams({
                    minimal: "true",
                    workspaceStats: "true",
                    sortBy: "updatedAt",
                    sortOrder: "desc",
                    limit: String(Math.max(limit, 1)),
                    offset: String(offset),
                });

                const response = await fetch(`/api/documents?${params.toString()}`, {
                    cache: "no-store",
                    signal: controller.signal,
                });
                const payload = await response.json().catch(() => ({}));
                if (!response.ok) {
                    throw new Error(payload.error || "Failed to load recent workspaces.");
                }

                if (!active) return;
                const documents = Array.isArray(payload.documents) ? payload.documents : [];
                const nextPagination = payload.pagination || {};
                setWorkspaces(documents);
                setPagination({
                    total: Number(nextPagination.total || 0),
                    limit: Number(nextPagination.limit || limit),
                    offset: Number(nextPagination.offset || offset),
                    page: Number(nextPagination.page || currentPage),
                    totalPages: Math.max(1, Number(nextPagination.totalPages || 1)),
                    hasMore: Boolean(nextPagination.hasMore),
                });
            } catch (error: any) {
                if (error?.name === "AbortError" || !active) return;
                console.error(error);
                toast.error(error.message || "Failed to load recent workspaces.");
            } finally {
                if (!active) return;
                setLoading(false);
                setRefreshing(false);
            }
        }

        void loadWorkspaces();

        return () => {
            active = false;
            controller.abort();
        };
    }, [currentDocumentId, currentPage, limit, reloadToken]);

    const monthOptions = useMemo(() => {
        const unique = new Set<string>();
        workspaces.forEach((workspace) => {
            const key = formatMonthKey(workspace.updatedAt);
            if (key) unique.add(key);
        });
        return Array.from(unique).sort((left, right) => right.localeCompare(left));
    }, [workspaces]);

    useEffect(() => {
        if (!monthOptions.length) {
            setSelectedMonthKey(null);
            return;
        }
        if (!selectedMonthKey || !monthOptions.includes(selectedMonthKey)) {
            setSelectedMonthKey(monthOptions[0]);
        }
    }, [monthOptions, selectedMonthKey]);

    const visibleWorkspaces = useMemo(() => {
        if (!selectedMonthKey) return workspaces;
        return workspaces.filter((workspace) => formatMonthKey(workspace.updatedAt) === selectedMonthKey);
    }, [selectedMonthKey, workspaces]);

    const summary = useMemo(() => {
        return visibleWorkspaces.reduce(
            (acc, workspace) => {
                const stats = workspace.workspaceStats;
                acc.docs += 1;
                acc.pages += stats?.pageCount || 0;
                acc.questions += stats?.questionCount || 0;
                if (!stats || stats.questionCount === 0) {
                    acc.notExtracted += 1;
                } else if ((stats.pendingPageCount || 0) > 0) {
                    acc.partial += 1;
                } else {
                    acc.ready += 1;
                }
                return acc;
            },
            { docs: 0, pages: 0, questions: 0, ready: 0, partial: 0, notExtracted: 0 }
        );
    }, [visibleWorkspaces]);

    const paginationItems = useMemo(
        () => buildPaginationItems(currentPage, Math.max(pagination.totalPages, 1)),
        [currentPage, pagination.totalPages]
    );

    const calendarGrid = useMemo(
        () => (selectedMonthKey ? getCalendarGrid(selectedMonthKey) : []),
        [selectedMonthKey]
    );

    const documentsByDay = useMemo(() => {
        const next = new Map<string, ExtractorWorkspaceRecord[]>();
        visibleWorkspaces.forEach((workspace) => {
            const key = workspace.updatedAt.slice(0, 10);
            const items = next.get(key) || [];
            items.push(workspace);
            next.set(key, items);
        });
        return next;
    }, [visibleWorkspaces]);

    const openWorkspace = (workspaceId: string) => {
        const targetHref = `/content-studio/extractor?load=${workspaceId}#extractor-workspace-review`;
        if (!workspaceId) return;

        if (workspaceId === currentDocumentId) {
            document.getElementById("extractor-workspace-review")?.scrollIntoView({
                behavior: "smooth",
                block: "start",
            });
            return;
        }

        setOpeningWorkspaceId(workspaceId);
        router.push(targetHref);
    };

    return (
        <section className="mx-4 mt-4 rounded-[30px] border border-slate-200 bg-white/94 px-4 py-4 shadow-[0_18px_40px_-28px_rgba(15,23,42,0.25)] backdrop-blur-md">
            <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                <div className="min-w-0">
                    <p className="text-[11px] font-bold uppercase tracking-[0.24em] text-slate-500">
                        Workspace Browser
                    </p>
                    <h2 className="mt-1 text-lg font-bold text-slate-900">
                        Browse saved extractor workspaces with stats, pages, and extraction state
                    </h2>
                    <p className="mt-1 max-w-3xl text-sm leading-relaxed text-slate-500">
                        View compact workspace cards or switch to a calendar lens. Clicking any saved deck loads it into the live extractor workspace and jumps you straight back into review.
                    </p>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                    <button
                        type="button"
                        onClick={() => setViewMode("cards")}
                        className={`btn text-xs ${viewMode === "cards" ? "btn-primary" : "btn-secondary"}`}
                    >
                        <LayoutGrid className="h-4 w-4" />
                        Cards
                    </button>
                    <button
                        type="button"
                        onClick={() => setViewMode("calendar")}
                        className={`btn text-xs ${viewMode === "calendar" ? "btn-primary" : "btn-secondary"}`}
                    >
                        <CalendarDays className="h-4 w-4" />
                        Calendar
                    </button>
                    <button
                        type="button"
                        onClick={() => setReloadToken((value) => value + 1)}
                        className="btn btn-ghost text-xs"
                        disabled={loading || refreshing}
                    >
                        {refreshing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                        Refresh
                    </button>
                </div>
            </div>

            <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-5">
                <div className="rounded-[24px] border border-slate-200 bg-slate-50/80 px-4 py-4">
                    <p className="text-[11px] font-bold uppercase tracking-[0.22em] text-slate-500">Visible decks</p>
                    <p className="mt-3 text-3xl font-semibold text-slate-950">{summary.docs}</p>
                    <p className="mt-1 text-sm text-slate-500">
                        {pagination.total} total workspace(s) saved
                    </p>
                </div>
                <div className="rounded-[24px] border border-slate-200 bg-slate-50/80 px-4 py-4">
                    <p className="text-[11px] font-bold uppercase tracking-[0.22em] text-slate-500">Pages</p>
                    <p className="mt-3 text-3xl font-semibold text-slate-950">{summary.pages}</p>
                    <p className="mt-1 text-sm text-slate-500">Combined pages in the current view</p>
                </div>
                <div className="rounded-[24px] border border-slate-200 bg-slate-50/80 px-4 py-4">
                    <p className="text-[11px] font-bold uppercase tracking-[0.22em] text-slate-500">Questions extracted</p>
                    <p className="mt-3 text-3xl font-semibold text-slate-950">{summary.questions}</p>
                    <p className="mt-1 text-sm text-slate-500">Question count across visible workspaces</p>
                </div>
                <div className="rounded-[24px] border border-slate-200 bg-emerald-50/70 px-4 py-4">
                    <p className="text-[11px] font-bold uppercase tracking-[0.22em] text-emerald-700">Ready</p>
                    <p className="mt-3 text-3xl font-semibold text-slate-950">{summary.ready}</p>
                    <p className="mt-1 text-sm text-slate-500">Fully extracted workspaces</p>
                </div>
                <div className="rounded-[24px] border border-slate-200 bg-amber-50/80 px-4 py-4">
                    <p className="text-[11px] font-bold uppercase tracking-[0.22em] text-amber-700">Need attention</p>
                    <p className="mt-3 text-3xl font-semibold text-slate-950">{summary.partial + summary.notExtracted}</p>
                    <p className="mt-1 text-sm text-slate-500">Partial or not extracted yet</p>
                </div>
            </div>

            <div className="mt-5 flex flex-col gap-3 rounded-[24px] border border-slate-200 bg-slate-50/70 px-4 py-4 xl:flex-row xl:items-center xl:justify-between">
                <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-semibold text-slate-600">
                        Page {pagination.page}/{Math.max(pagination.totalPages, 1)}
                    </span>
                    <span className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-semibold text-slate-600">
                        {loading ? "Loading..." : `${workspaces.length} workspace(s) on this page`}
                    </span>
                    {monthOptions.map((monthKey) => (
                        <button
                            key={monthKey}
                            type="button"
                            onClick={() => setSelectedMonthKey(monthKey)}
                            className={`rounded-full border px-3 py-1 text-xs font-semibold transition ${
                                selectedMonthKey === monthKey
                                    ? "border-indigo-200 bg-indigo-50 text-indigo-700"
                                    : "border-slate-200 bg-white text-slate-600 hover:border-slate-300"
                            }`}
                        >
                            {formatMonthLabel(monthKey)}
                        </button>
                    ))}
                </div>

                <div className="flex flex-wrap items-center gap-2">
                    {paginationItems.map((item, index) =>
                        item === "ellipsis" ? (
                            <span key={`ellipsis-${index}`} className="px-2 text-sm text-slate-400">
                                …
                            </span>
                        ) : (
                            <button
                                key={`page-${item}`}
                                type="button"
                                onClick={() => setCurrentPage(item)}
                                className={`min-w-[38px] rounded-full border px-3 py-1.5 text-xs font-semibold transition ${
                                    item === currentPage
                                        ? "border-indigo-200 bg-indigo-50 text-indigo-700"
                                        : "border-slate-200 bg-white text-slate-600 hover:border-slate-300"
                                }`}
                            >
                                {item}
                            </button>
                        )
                    )}
                    <button
                        type="button"
                        onClick={() => setCurrentPage((value) => Math.max(value - 1, 1))}
                        disabled={currentPage <= 1}
                        className="btn btn-ghost text-xs"
                    >
                        <ChevronLeft className="h-4 w-4" />
                        Previous
                    </button>
                    <button
                        type="button"
                        onClick={() => setCurrentPage((value) => Math.min(value + 1, Math.max(pagination.totalPages, 1)))}
                        disabled={currentPage >= Math.max(pagination.totalPages, 1)}
                        className="btn btn-ghost text-xs"
                    >
                        Next
                        <ChevronRight className="h-4 w-4" />
                    </button>
                </div>
            </div>

            {loading && workspaces.length === 0 ? (
                <div className="mt-5 grid grid-cols-1 gap-3 xl:grid-cols-3">
                    {Array.from({ length: 6 }).map((_, index) => (
                        <div
                            key={`workspace-skeleton-${index}`}
                            className="rounded-[24px] border border-slate-200 bg-slate-50/80 px-4 py-4"
                        >
                            <div className="skeleton skeleton-text h-4 w-40" />
                            <div className="mt-3 skeleton skeleton-text h-3 w-52" />
                            <div className="mt-3 flex gap-2">
                                <div className="skeleton skeleton-chip h-7 w-20" />
                                <div className="skeleton skeleton-chip h-7 w-20" />
                                <div className="skeleton skeleton-chip h-7 w-24" />
                            </div>
                        </div>
                    ))}
                </div>
            ) : workspaces.length === 0 ? (
                <div className="mt-5 rounded-[24px] border border-dashed border-slate-300 bg-slate-50/80 px-4 py-6 text-sm text-slate-500">
                    No saved extractor workspace found yet. Upload a PDF or image set and save once to build your recent history here.
                </div>
            ) : viewMode === "cards" ? (
                <div className="mt-5 grid grid-cols-1 gap-3 xl:grid-cols-3">
                    {visibleWorkspaces.map((workspace) => {
                        const isCurrent = workspace.id === currentDocumentId;
                        const isOpening = openingWorkspaceId === workspace.id;
                        const workspaceLabel =
                            WORKSPACE_TYPE_LABELS[workspace.workspaceType || "PDF_TO_PDF"] || "Saved Workspace";
                        const stats = workspace.workspaceStats;
                        const status = getWorkspaceStatus(workspace);

                        return (
                            <article
                                key={workspace.id}
                                className={`rounded-[24px] border px-4 py-4 transition ${
                                    isCurrent
                                        ? "border-indigo-200 bg-indigo-50/65 shadow-[0_12px_30px_-24px_rgba(79,70,229,0.55)]"
                                        : "border-slate-200 bg-slate-50/85 hover:border-slate-300"
                                }`}
                            >
                                <div className="flex items-start justify-between gap-3">
                                    <div className="min-w-0">
                                        <div className="flex flex-wrap items-center gap-2">
                                            <span className="tool-chip">{workspaceLabel}</span>
                                            {typeof workspace.correctionMarkCount === "number" ? (
                                                <span className="tool-chip">Marks: {workspace.correctionMarkCount}</span>
                                            ) : null}
                                            {isCurrent ? (
                                                <span className="status-badge bg-indigo-100 text-indigo-700">
                                                    {isLoadingCurrentDocument ? "Loading current" : "Loaded now"}
                                                </span>
                                            ) : null}
                                        </div>
                                        <h3 className="mt-3 line-clamp-2 text-base font-bold text-slate-900">
                                            {workspace.title || "Untitled Workspace"}
                                        </h3>
                                        <p className="mt-1 text-xs text-slate-500">
                                            {workspace.subject || "No subject"} {workspace.date ? `• ${workspace.date}` : ""}
                                        </p>
                                        <p className="mt-2 text-xs text-slate-500">
                                            Updated {formatDateTime(workspace.updatedAt)}
                                        </p>
                                    </div>

                                    <button
                                        type="button"
                                        onClick={() => openWorkspace(workspace.id)}
                                        disabled={isOpening}
                                        className={`btn text-xs ${isCurrent ? "btn-secondary" : "btn-primary"}`}
                                    >
                                        {isOpening ? (
                                            <>
                                                <Loader2 className="h-4 w-4 animate-spin" />
                                                Opening...
                                            </>
                                        ) : isCurrent ? (
                                            <>
                                                <Eye className="h-4 w-4" />
                                                View
                                            </>
                                        ) : (
                                            <>
                                                <FolderOpen className="h-4 w-4" />
                                                Open
                                            </>
                                        )}
                                    </button>
                                </div>

                                <div className={`mt-4 rounded-[20px] border px-3 py-3 ${status.tone}`}>
                                    <p className="text-sm font-semibold">{status.label}</p>
                                    <p className="mt-1 text-xs opacity-80">{status.helper}</p>
                                </div>

                                <div className="mt-4 flex flex-wrap gap-2">
                                    {tinyMetric("Pages", stats?.pageCount || 0)}
                                    {tinyMetric("Questions", stats?.questionCount || 0, "bg-indigo-100 text-indigo-700")}
                                    {tinyMetric("Ready pages", stats?.extractedPageCount || 0, "bg-emerald-100 text-emerald-700")}
                                    {tinyMetric("Pending", stats?.pendingPageCount || 0, "bg-amber-100 text-amber-700")}
                                </div>
                            </article>
                        );
                    })}
                </div>
            ) : (
                <div className="mt-5 grid gap-4 xl:grid-cols-[1.15fr_0.85fr]">
                    <div className="rounded-[26px] border border-slate-200 bg-slate-50/85 p-4">
                        <div className="grid grid-cols-7 gap-2 text-center text-[11px] font-bold uppercase tracking-[0.2em] text-slate-500">
                            {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((label) => (
                                <div key={label} className="py-2">
                                    {label}
                                </div>
                            ))}
                        </div>
                        <div className="grid grid-cols-7 gap-2">
                            {calendarGrid.map((cellDate) => {
                                const key = cellDate.toISOString().slice(0, 10);
                                const items = documentsByDay.get(key) || [];
                                const isInMonth = formatMonthKey(key) === selectedMonthKey;
                                return (
                                    <div
                                        key={key}
                                        className={`min-h-[120px] rounded-[20px] border p-2 ${
                                            isInMonth
                                                ? "border-slate-200 bg-white"
                                                : "border-slate-100 bg-slate-100/60 text-slate-400"
                                        }`}
                                    >
                                        <div className="flex items-center justify-between">
                                            <span className="text-xs font-bold">{cellDate.getDate()}</span>
                                            {items.length ? (
                                                <span className="rounded-full bg-indigo-100 px-2 py-0.5 text-[10px] font-bold text-indigo-700">
                                                    {items.length}
                                                </span>
                                            ) : null}
                                        </div>
                                        <div className="mt-2 space-y-1.5">
                                            {items.slice(0, 2).map((workspace) => (
                                                <button
                                                    key={workspace.id}
                                                    type="button"
                                                    onClick={() => openWorkspace(workspace.id)}
                                                    className="block w-full rounded-xl border border-slate-200 bg-slate-50 px-2 py-1.5 text-left text-[11px] font-semibold text-slate-700 hover:border-indigo-200 hover:bg-indigo-50"
                                                >
                                                    <span className="line-clamp-2">{workspace.title || "Untitled Workspace"}</span>
                                                </button>
                                            ))}
                                            {items.length > 2 ? (
                                                <div className="rounded-xl bg-slate-100 px-2 py-1 text-[10px] font-semibold text-slate-500">
                                                    +{items.length - 2} more workspace(s)
                                                </div>
                                            ) : null}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>

                    <div className="rounded-[26px] border border-slate-200 bg-white p-4">
                        <div className="flex items-center justify-between gap-3">
                            <div>
                                <p className="text-[11px] font-bold uppercase tracking-[0.22em] text-slate-500">
                                    Month agenda
                                </p>
                                <h3 className="mt-1 text-lg font-bold text-slate-900">
                                    {selectedMonthKey ? formatMonthLabel(selectedMonthKey) : "No month selected"}
                                </h3>
                            </div>
                            <CalendarDays className="h-5 w-5 text-slate-400" />
                        </div>

                        <div className="mt-4 space-y-3">
                            {visibleWorkspaces.length ? (
                                visibleWorkspaces.map((workspace) => {
                                    const status = getWorkspaceStatus(workspace);
                                    return (
                                        <div
                                            key={workspace.id}
                                            className="rounded-[20px] border border-slate-200 bg-slate-50/80 px-3 py-3"
                                        >
                                            <div className="flex items-start justify-between gap-3">
                                                <div className="min-w-0">
                                                    <p className="text-xs font-bold uppercase tracking-[0.16em] text-slate-500">
                                                        {formatDayLabel(workspace.updatedAt)}
                                                    </p>
                                                    <h4 className="mt-1 line-clamp-2 text-sm font-semibold text-slate-900">
                                                        {workspace.title || "Untitled Workspace"}
                                                    </h4>
                                                    <p className="mt-1 text-xs text-slate-500">{status.label}</p>
                                                </div>
                                                <button
                                                    type="button"
                                                    onClick={() => openWorkspace(workspace.id)}
                                                    className="btn btn-ghost text-xs"
                                                >
                                                    <ScrollText className="h-4 w-4" />
                                                    Load
                                                </button>
                                            </div>
                                            <div className="mt-3 flex flex-wrap gap-2">
                                                {tinyMetric("Pages", workspace.workspaceStats?.pageCount || 0)}
                                                {tinyMetric("Questions", workspace.workspaceStats?.questionCount || 0, "bg-indigo-100 text-indigo-700")}
                                            </div>
                                        </div>
                                    );
                                })
                            ) : (
                                <div className="rounded-[22px] border border-dashed border-slate-200 bg-slate-50 px-4 py-6 text-sm text-slate-500">
                                    No workspace entries on the currently visible page for this month.
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            )}
        </section>
    );
}
