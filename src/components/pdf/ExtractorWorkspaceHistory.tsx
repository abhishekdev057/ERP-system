"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import toast from "react-hot-toast";
import { formatDateTime } from "@/lib/utils";

type WorkspaceType = "IMAGE_TO_PDF" | "JSON_TO_PDF" | "PDF_TO_PDF";

type ExtractorWorkspaceRecord = {
    id: string;
    title: string;
    subject: string;
    date: string;
    updatedAt: string;
    workspaceType?: WorkspaceType;
    correctionMarkCount?: number;
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

export function ExtractorWorkspaceHistory({
    currentDocumentId,
    isLoadingCurrentDocument = false,
    limit = 8,
}: ExtractorWorkspaceHistoryProps) {
    const router = useRouter();
    const [workspaces, setWorkspaces] = useState<ExtractorWorkspaceRecord[]>([]);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [openingWorkspaceId, setOpeningWorkspaceId] = useState<string | null>(null);
    const [reloadToken, setReloadToken] = useState(0);

    const visibleWorkspaces = useMemo(() => workspaces.slice(0, Math.max(limit, 1)), [limit, workspaces]);

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

                const params = new URLSearchParams({
                    minimal: "true",
                    sortBy: "updatedAt",
                    sortOrder: "desc",
                    limit: String(Math.max(limit, 1)),
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
                setWorkspaces(Array.isArray(payload.documents) ? payload.documents : []);
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
    }, [currentDocumentId, limit, reloadToken]);

    const openWorkspace = (workspaceId: string) => {
        if (!workspaceId || workspaceId === currentDocumentId) return;
        setOpeningWorkspaceId(workspaceId);
        router.push(`/content-studio/extractor?load=${workspaceId}`);
    };

    return (
        <section className="mx-4 mt-4 rounded-[28px] border border-slate-200 bg-white/92 px-4 py-4 shadow-sm backdrop-blur-md">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                <div className="min-w-0">
                    <p className="text-[11px] font-bold uppercase tracking-[0.24em] text-slate-500">
                        Recent Workspaces
                    </p>
                    <h2 className="mt-1 text-lg font-bold text-slate-900">
                        Continue extracted question-review workspaces here
                    </h2>
                    <p className="mt-1 text-sm leading-relaxed text-slate-500">
                        Saved extractor history now stays inside Question Extractor, so you can reopen recent decks without jumping back to the Tool Hub.
                    </p>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                    <span className="status-badge">
                        {loading ? "Loading..." : `${workspaces.length} recent workspace(s)`}
                    </span>
                    <button
                        type="button"
                        onClick={() => setReloadToken((value) => value + 1)}
                        className="btn btn-ghost text-xs"
                        disabled={loading || refreshing}
                    >
                        {refreshing ? "Refreshing..." : "Refresh"}
                    </button>
                </div>
            </div>

            {loading && visibleWorkspaces.length === 0 ? (
                <div className="mt-4 grid grid-cols-1 gap-3 xl:grid-cols-2">
                    {Array.from({ length: Math.min(limit, 4) }).map((_, index) => (
                        <div
                            key={`workspace-skeleton-${index}`}
                            className="rounded-2xl border border-slate-200 bg-slate-50/80 px-4 py-4"
                        >
                            <div className="skeleton skeleton-text h-4 w-40" />
                            <div className="mt-2 skeleton skeleton-text h-3 w-52" />
                            <div className="mt-3 flex gap-2">
                                <div className="skeleton skeleton-chip h-7 w-24" />
                                <div className="skeleton skeleton-chip h-7 w-20" />
                            </div>
                        </div>
                    ))}
                </div>
            ) : visibleWorkspaces.length === 0 ? (
                <div className="mt-4 rounded-2xl border border-dashed border-slate-300 bg-slate-50/80 px-4 py-5 text-sm text-slate-500">
                    No saved extractor workspace found yet. Upload a PDF or image set and save once to build your recent history here.
                </div>
            ) : (
                <div className="mt-4 grid grid-cols-1 gap-3 xl:grid-cols-2">
                    {visibleWorkspaces.map((workspace) => {
                        const isCurrent = workspace.id === currentDocumentId;
                        const isOpening = openingWorkspaceId === workspace.id;
                        const workspaceLabel =
                            WORKSPACE_TYPE_LABELS[workspace.workspaceType || "PDF_TO_PDF"] ||
                            "Saved Workspace";

                        return (
                            <article
                                key={workspace.id}
                                className={`rounded-2xl border px-4 py-4 transition ${
                                    isCurrent
                                        ? "border-indigo-200 bg-indigo-50/70 shadow-[0_12px_30px_-24px_rgba(79,70,229,0.6)]"
                                        : "border-slate-200 bg-slate-50/85 hover:border-slate-300"
                                }`}
                            >
                                <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                                    <div className="min-w-0">
                                        <div className="flex flex-wrap items-center gap-2">
                                            <span className="tool-chip">{workspaceLabel}</span>
                                            {typeof workspace.correctionMarkCount === "number" && (
                                                <span className="tool-chip">
                                                    Marks: {workspace.correctionMarkCount}
                                                </span>
                                            )}
                                            {isCurrent && (
                                                <span className="status-badge bg-indigo-100 text-indigo-700">
                                                    {isLoadingCurrentDocument ? "Loading Current" : "Current Workspace"}
                                                </span>
                                            )}
                                        </div>
                                        <h3 className="mt-3 text-sm font-bold text-slate-900">
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
                                        disabled={isCurrent || isOpening}
                                        className={`btn text-xs w-full lg:w-auto ${
                                            isCurrent ? "btn-secondary" : "btn-primary"
                                        }`}
                                    >
                                        {isCurrent
                                            ? "Loaded"
                                            : isOpening
                                                ? "Opening..."
                                                : "Open Workspace"}
                                    </button>
                                </div>
                            </article>
                        );
                    })}
                </div>
            )}
        </section>
    );
}
