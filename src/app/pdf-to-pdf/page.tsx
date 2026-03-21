"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useDeferredValue, useEffect, useMemo, useState } from "react";
import { useSession } from "next-auth/react";
import toast from "react-hot-toast";
import Modal from "@/components/ui/Modal";
import { downloadBlobAsFile, formatDateTime } from "@/lib/utils";

type WorkspaceType = "IMAGE_TO_PDF" | "JSON_TO_PDF" | "PDF_TO_PDF";
type DocumentSortField = "createdAt" | "updatedAt" | "title" | "subject" | "date";
type DocumentSortDirection = "asc" | "desc";

type DocumentRecord = {
    id: string;
    title: string;
    subject: string;
    date: string;
    createdAt: string;
    workspaceType?: WorkspaceType;
    assignedUserIds?: string[];
    correctionMarkCount?: number;
};

type DocumentPagination = {
    total: number;
    limit: number;
    offset: number;
    page: number;
    totalPages: number;
    hasMore: boolean;
};

type OrgMember = {
    id: string;
    name: string | null;
    email: string | null;
    username: string | null;
    designation: string | null;
};

type StudioTool = {
    id: string;
    title: string;
    description: string;
    category: "Extraction" | "Creative" | "Publishing" | "Automation";
    status: "Live" | "Beta" | "Planned";
    href?: string;
    permission?: string;
    badge: string;
};

const STUDIO_TOOLS: StudioTool[] = [
    {
        id: "question-extractor",
        title: "Question Extractor",
        description:
            "Upload PDFs or images (single/multi), extract structure-aware questions, crop diagrams, and generate bilingual slides.",
        category: "Extraction",
        status: "Live",
        href: "/pdf-to-pdf/new",
        permission: "pdf-to-pdf",
        badge: "PDF + Images",
    },
    {
        id: "media-studio",
        title: "Media Studio",
        description:
            "Generate institute-ready visuals and video drafts from text/reference inputs for campaigns and classroom content.",
        category: "Creative",
        status: "Beta",
        href: "/pdf-to-pdf/media",
        permission: "media-studio",
        badge: "AI Media",
    },
];

const DOCUMENTS_PAGE_SIZE = 10;
const DEFAULT_DOCUMENT_PAGINATION: DocumentPagination = {
    total: 0,
    limit: DOCUMENTS_PAGE_SIZE,
    offset: 0,
    page: 1,
    totalPages: 1,
    hasMore: false,
};

function statusTone(status: StudioTool["status"]) {
    if (status === "Live") return "bg-emerald-50 text-emerald-700 border-emerald-200";
    if (status === "Beta") return "bg-amber-50 text-amber-700 border-amber-200";
    return "bg-slate-100 text-slate-500 border-slate-200";
}

function normalizeSortByParam(value: string | null): DocumentSortField {
    const candidate = String(value || "").trim();
    if (candidate === "updatedAt") return "updatedAt";
    if (candidate === "title") return "title";
    if (candidate === "subject") return "subject";
    if (candidate === "date") return "date";
    return "createdAt";
}

function normalizeSortOrderParam(value: string | null): DocumentSortDirection {
    return String(value || "").trim().toLowerCase() === "asc" ? "asc" : "desc";
}

function normalizeQueryParam(value: string | null): string {
    return String(value || "").slice(0, 160);
}

function normalizePageParam(value: string | null): number {
    const parsed = Number.parseInt(String(value || "1"), 10);
    return Number.isFinite(parsed) ? Math.max(parsed, 1) : 1;
}

function normalizeAssigneeParam(value: string | null, canAssign: boolean): string {
    if (!canAssign) return "all";
    const parsed = String(value || "").trim();
    return parsed ? parsed : "all";
}

function buildViewSearch(
    query: string,
    sortBy: DocumentSortField,
    sortOrder: DocumentSortDirection,
    assigneeFilter: string,
    canAssign: boolean,
    page: number
): string {
    const params = new URLSearchParams();
    const trimmedQuery = query.trim();
    if (trimmedQuery) params.set("q", trimmedQuery);
    if (sortBy !== "createdAt") params.set("sortBy", sortBy);
    if (sortOrder !== "desc") params.set("sortOrder", sortOrder);
    if (canAssign && assigneeFilter !== "all") params.set("assignee", assigneeFilter);
    if (page > 1) params.set("page", String(page));
    return params.toString();
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

export default function ContentStudioHomePage() {
    return (
        <Suspense fallback={<div className="page-container text-sm text-slate-600">Loading content studio...</div>}>
            <ContentStudioHomePageContent />
        </Suspense>
    );
}

function ContentStudioHomePageContent() {
    const pathname = usePathname();
    const router = useRouter();
    const searchParams = useSearchParams();
    const { data: session } = useSession();
    const role = (session?.user as any)?.role || "MEMBER";
    const isAdminRole = role === "ORG_ADMIN" || role === "SYSTEM_ADMIN";
    const allowedTools = Array.isArray((session?.user as any)?.allowedTools)
        ? ((session?.user as any)?.allowedTools as string[])
        : [];

    const [documents, setDocuments] = useState<DocumentRecord[]>([]);
    const [loadingDocs, setLoadingDocs] = useState(true);
    const [isRefreshingDocs, setIsRefreshingDocs] = useState(false);
    const [docPagination, setDocPagination] = useState<DocumentPagination>(
        DEFAULT_DOCUMENT_PAGINATION
    );
    const [query, setQuery] = useState(() => normalizeQueryParam(searchParams.get("q")));
    const [toolQuery, setToolQuery] = useState("");
    const [currentPage, setCurrentPage] = useState(() =>
        normalizePageParam(searchParams.get("page"))
    );
    const [usingDocId, setUsingDocId] = useState<string | null>(null);
    const [sortBy, setSortBy] = useState<DocumentSortField>(() =>
        normalizeSortByParam(searchParams.get("sortBy"))
    );
    const [sortOrder, setSortOrder] = useState<DocumentSortDirection>(() =>
        normalizeSortOrderParam(searchParams.get("sortOrder"))
    );
    const [assigneeFilter, setAssigneeFilter] = useState<string>(() =>
        normalizeAssigneeParam(searchParams.get("assignee"), isAdminRole)
    );
    const [selectedDocumentIds, setSelectedDocumentIds] = useState<string[]>([]);
    const [orgMembers, setOrgMembers] = useState<OrgMember[]>([]);
    const [loadingOrgMembers, setLoadingOrgMembers] = useState(false);
    const [assignmentTargetDocIds, setAssignmentTargetDocIds] = useState<string[]>([]);
    const [assignmentTargetLabel, setAssignmentTargetLabel] = useState<string>("");
    const [assignmentUserIds, setAssignmentUserIds] = useState<string[]>([]);
    const [isSavingAssignment, setIsSavingAssignment] = useState(false);
    const [docsReloadToken, setDocsReloadToken] = useState(0);

    const [modalConfig, setModalConfig] = useState<{
        isOpen: boolean;
        title: string;
        message: string;
        onConfirm?: () => void;
    }>({ isOpen: false, title: "", message: "", onConfirm: undefined });

    const canAccess = (permission?: string) => {
        if (!permission) return true;
        if (role === "SYSTEM_ADMIN" || role === "ORG_ADMIN") return true;
        return allowedTools.includes(permission);
    };

    const hasAnyStudioAccess = canAccess("pdf-to-pdf") || canAccess("media-studio");
    const canAccessDocuments = canAccess("pdf-to-pdf");
    const canAssignDocuments = isAdminRole;
    const canDeleteDocuments = isAdminRole;
    const deferredQuery = useDeferredValue(query);
    const deferredToolQuery = useDeferredValue(toolQuery);

    useEffect(() => {
        const urlQuery = normalizeQueryParam(searchParams.get("q"));
        const urlSortBy = normalizeSortByParam(searchParams.get("sortBy"));
        const urlSortOrder = normalizeSortOrderParam(searchParams.get("sortOrder"));
        const urlAssignee = normalizeAssigneeParam(searchParams.get("assignee"), canAssignDocuments);
        const urlPage = normalizePageParam(searchParams.get("page"));

        if (query !== urlQuery) setQuery(urlQuery);
        if (sortBy !== urlSortBy) setSortBy(urlSortBy);
        if (sortOrder !== urlSortOrder) setSortOrder(urlSortOrder);
        if (assigneeFilter !== urlAssignee) setAssigneeFilter(urlAssignee);
        if (currentPage !== urlPage) setCurrentPage(urlPage);
    }, [searchParams, canAssignDocuments]);

    useEffect(() => {
        const nextSearch = buildViewSearch(
            query,
            sortBy,
            sortOrder,
            assigneeFilter,
            canAssignDocuments,
            currentPage
        );
        const currentSearch = buildViewSearch(
            normalizeQueryParam(searchParams.get("q")),
            normalizeSortByParam(searchParams.get("sortBy")),
            normalizeSortOrderParam(searchParams.get("sortOrder")),
            normalizeAssigneeParam(searchParams.get("assignee"), canAssignDocuments),
            canAssignDocuments,
            normalizePageParam(searchParams.get("page"))
        );
        if (nextSearch === currentSearch) return;
        const nextHref = nextSearch ? `${pathname}?${nextSearch}` : pathname;
        router.replace(nextHref, { scroll: false });
    }, [
        pathname,
        router,
        searchParams,
        query,
        sortBy,
        sortOrder,
        assigneeFilter,
        currentPage,
        canAssignDocuments,
    ]);

    const filteredTools = useMemo(() => {
        const text = deferredToolQuery.trim().toLowerCase();
        if (!text) return STUDIO_TOOLS;
        return STUDIO_TOOLS.filter((tool) =>
            `${tool.title} ${tool.description} ${tool.category} ${tool.badge}`
                .toLowerCase()
                .includes(text)
        );
    }, [deferredToolQuery]);

    const selectedDocSet = useMemo(
        () => new Set(selectedDocumentIds),
        [selectedDocumentIds]
    );
    const visibleDocIds = useMemo(
        () => documents.map((doc) => doc.id),
        [documents]
    );
    const visibleSelectedCount = useMemo(
        () => visibleDocIds.filter((id) => selectedDocSet.has(id)).length,
        [visibleDocIds, selectedDocSet]
    );
    const allVisibleSelected =
        visibleDocIds.length > 0 && visibleSelectedCount === visibleDocIds.length;

    useEffect(() => {
        const controller = new AbortController();
        let isActive = true;

        async function fetchDocuments() {
            try {
                if (documents.length === 0) {
                    setLoadingDocs(true);
                } else {
                    setIsRefreshingDocs(true);
                }
                const params = new URLSearchParams();
                params.set("minimal", "true");
                params.set("limit", String(DOCUMENTS_PAGE_SIZE));
                params.set("offset", String((currentPage - 1) * DOCUMENTS_PAGE_SIZE));
                params.set("sortBy", sortBy);
                params.set("sortOrder", sortOrder);
                const trimmedQuery = deferredQuery.trim();
                if (trimmedQuery) params.set("q", trimmedQuery);
                if (canAssignDocuments && assigneeFilter !== "all") {
                    params.set("assignee", assigneeFilter);
                }

                const res = await fetch(`/api/documents?${params.toString()}`, {
                    signal: controller.signal,
                });
                if (!res.ok) throw new Error("Failed to fetch documents");
                const data = await res.json();
                const nextDocuments = Array.isArray(data.documents) ? data.documents : [];
                const rawPagination =
                    data.pagination && typeof data.pagination === "object"
                        ? data.pagination
                        : {};
                const total = Number(rawPagination.total);
                const limit = Number(rawPagination.limit);
                const offset = Number(rawPagination.offset);
                const totalPages = Number(rawPagination.totalPages);
                const page = Number(rawPagination.page);
                const nextPagination: DocumentPagination = {
                    total: Number.isFinite(total) ? Math.max(total, 0) : nextDocuments.length,
                    limit: Number.isFinite(limit) && limit > 0 ? limit : DOCUMENTS_PAGE_SIZE,
                    offset: Number.isFinite(offset) && offset >= 0 ? offset : 0,
                    page: Number.isFinite(page) && page > 0 ? page : currentPage,
                    totalPages:
                        Number.isFinite(totalPages) && totalPages > 0
                            ? totalPages
                            : 1,
                    hasMore: Boolean(rawPagination.hasMore),
                };

                if (currentPage > nextPagination.totalPages) {
                    if (!isActive) return;
                    setCurrentPage(nextPagination.totalPages);
                    return;
                }

                if (!isActive) return;
                setDocuments(nextDocuments);
                setDocPagination(nextPagination);
            } catch (error) {
                if ((error as Error).name === "AbortError") return;
                if (!isActive) return;
                console.error(error);
                toast.error("Failed to load studio documents");
            } finally {
                if (!isActive) return;
                setLoadingDocs(false);
                setIsRefreshingDocs(false);
            }
        }

        if (canAccessDocuments) {
            fetchDocuments();
        } else {
            setLoadingDocs(false);
            setIsRefreshingDocs(false);
            setDocuments([]);
            setDocPagination(DEFAULT_DOCUMENT_PAGINATION);
        }

        return () => {
            isActive = false;
            controller.abort();
        };
    }, [
        assigneeFilter,
        canAccessDocuments,
        canAssignDocuments,
        currentPage,
        deferredQuery,
        docsReloadToken,
        sortBy,
        sortOrder,
    ]);

    useEffect(() => {
        setSelectedDocumentIds((prev) =>
            prev.filter((id) => documents.some((doc) => doc.id === id))
        );
    }, [documents]);

    useEffect(() => {
        async function fetchMembers() {
            try {
                setLoadingOrgMembers(true);
                const response = await fetch("/api/org/members");
                if (!response.ok) throw new Error("Failed to fetch members");
                const data = await response.json();
                setOrgMembers(Array.isArray(data.members) ? data.members : []);
            } catch (error) {
                console.error(error);
                setOrgMembers([]);
            } finally {
                setLoadingOrgMembers(false);
            }
        }

        if (canAssignDocuments) {
            fetchMembers();
        } else {
            setOrgMembers([]);
        }
    }, [canAssignDocuments]);

    const visibleRangeStart = docPagination.total === 0 ? 0 : docPagination.offset + 1;
    const visibleRangeEnd = docPagination.total === 0
        ? 0
        : docPagination.offset + documents.length;
    const isDocsFiltered = Boolean(deferredQuery.trim()) || assigneeFilter !== "all";
    const paginationItems = useMemo(
        () => buildPaginationItems(currentPage, Math.max(docPagination.totalPages, 1)),
        [currentPage, docPagination.totalPages]
    );

    const handleOpenTool = (tool: StudioTool) => {
        if (!tool.href) {
            toast("This tool is planned and will be enabled soon.");
            return;
        }
        if (!canAccess(tool.permission)) {
            toast.error("Tool access not granted for your account.");
            return;
        }
        router.push(tool.href);
    };

    const handleOpenDocument = (id: string) => {
        setUsingDocId(id);
        router.push(`/pdf-to-pdf/new?load=${id}`);
    };

    const handleDownload = async (id: string, title: string) => {
        try {
            const response = await fetch(`/api/documents/${id}`, { method: "POST" });
            if (!response.ok) throw new Error("Download failed");
            const blob = await response.blob();
            downloadBlobAsFile(blob, `${title}.pdf`);
            toast.success("PDF downloaded");
        } catch (error) {
            console.error(error);
            toast.error("Failed to download PDF");
        }
    };

    const handleDelete = (id: string) => {
        setModalConfig({
            isOpen: true,
            title: "Delete Document",
            message: "This action permanently removes this document.",
            onConfirm: async () => {
                try {
                    const response = await fetch(`/api/documents/${id}`, { method: "DELETE" });
                    if (!response.ok) throw new Error("Delete failed");
                    setSelectedDocumentIds((prev) => prev.filter((item) => item !== id));
                    setDocsReloadToken((prev) => prev + 1);
                    toast.success("Document deleted");
                } catch (error) {
                    console.error(error);
                    toast.error("Failed to delete document");
                }
            },
        });
    };

    const renderDocumentActions = (doc: DocumentRecord, layout: "table" | "card" = "table") => {
        const widthClass = layout === "card" ? "w-full sm:w-auto" : "";

        return (
            <div className={`flex flex-wrap gap-2 ${layout === "table" ? "justify-end" : ""}`}>
                <button
                    type="button"
                    onClick={() => handleOpenDocument(doc.id)}
                    className={`btn btn-secondary text-xs ${widthClass}`}
                    disabled={usingDocId === doc.id}
                >
                    {usingDocId === doc.id ? "Opening..." : "Use"}
                </button>
                <button
                    type="button"
                    onClick={() => handleDownload(doc.id, doc.title)}
                    className={`btn btn-primary text-xs ${widthClass}`}
                >
                    Download
                </button>
                {canAssignDocuments && (
                    <button
                        type="button"
                        onClick={() => openSingleAssignmentModal(doc)}
                        className={`btn btn-secondary text-xs ${widthClass}`}
                    >
                        Assign
                    </button>
                )}
                {canDeleteDocuments && (
                    <button
                        type="button"
                        onClick={() => handleDelete(doc.id)}
                        className={`btn btn-danger text-xs ${widthClass}`}
                    >
                        Delete
                    </button>
                )}
            </div>
        );
    };

    const closeAssignmentModal = () => {
        setAssignmentTargetDocIds([]);
        setAssignmentTargetLabel("");
        setAssignmentUserIds([]);
    };

    const openSingleAssignmentModal = (doc: DocumentRecord) => {
        setAssignmentTargetDocIds([doc.id]);
        setAssignmentTargetLabel(doc.title);
        setAssignmentUserIds(Array.isArray(doc.assignedUserIds) ? doc.assignedUserIds : []);
    };

    const openBulkAssignmentModal = () => {
        if (selectedDocumentIds.length === 0) {
            toast.error("Select at least one document for bulk assignment.");
            return;
        }
        setAssignmentTargetDocIds(selectedDocumentIds);
        setAssignmentTargetLabel(`${selectedDocumentIds.length} selected documents`);
        setAssignmentUserIds([]);
    };

    const toggleAssignmentUser = (userId: string) => {
        setAssignmentUserIds((prev) =>
            prev.includes(userId)
                ? prev.filter((id) => id !== userId)
                : [...prev, userId]
        );
    };

    const toggleDocumentSelection = (docId: string) => {
        setSelectedDocumentIds((prev) =>
            prev.includes(docId)
                ? prev.filter((id) => id !== docId)
                : [...prev, docId]
        );
    };

    const toggleSelectAllVisible = () => {
        if (allVisibleSelected) {
            const visibleSet = new Set(visibleDocIds);
            setSelectedDocumentIds((prev) => prev.filter((id) => !visibleSet.has(id)));
            return;
        }

        setSelectedDocumentIds((prev) => {
            const next = new Set(prev);
            visibleDocIds.forEach((id) => next.add(id));
            return Array.from(next);
        });
    };

    const saveAssignments = async () => {
        if (assignmentTargetDocIds.length === 0) return;
        try {
            setIsSavingAssignment(true);
            let successCount = 0;
            let failedCount = 0;

            for (const docId of assignmentTargetDocIds) {
                try {
                    const response = await fetch(`/api/documents/${docId}/assign`, {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ userIds: assignmentUserIds }),
                    });

                    if (!response.ok) {
                        const payload = await response.json().catch(() => ({}));
                        throw new Error(payload.error || "Failed to save assignments");
                    }

                    successCount += 1;
                } catch (error) {
                    console.error(error);
                    failedCount += 1;
                }
            }

            if (successCount > 0) {
                const targetSet = new Set(assignmentTargetDocIds);
                setDocuments((prev) =>
                    prev.map((doc) =>
                        targetSet.has(doc.id)
                            ? { ...doc, assignedUserIds: assignmentUserIds }
                            : doc
                    )
                );
                toast.success(
                    successCount === 1
                        ? "Document assignment updated"
                        : `${successCount} documents assigned`
                );
                if (assignmentTargetDocIds.length > 1) {
                    setSelectedDocumentIds((prev) =>
                        prev.filter((id) => !targetSet.has(id))
                    );
                }
            }

            if (failedCount > 0) {
                toast.error(`${failedCount} document(s) failed to assign. Retry once.`);
                return;
            }

            closeAssignmentModal();
        } finally {
            setIsSavingAssignment(false);
        }
    };

    if (!hasAnyStudioAccess) {
        return (
            <div className="page-container">
                <section className="surface p-10 text-center">
                    <h1 className="heading-xl">Content Studio Access Required</h1>
                    <p className="text-sm text-slate-500 mt-2">
                        Ask your workspace admin to grant `Content Studio` or `Media Studio` access.
                    </p>
                </section>
            </div>
        );
    }

    return (
        <div className="page-container" style={{ width: "min(1540px, calc(100% - 1.5rem))" }}>
            <header className="surface surface-premium p-4 md:p-5 mb-4">
                <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
                    <div className="space-y-3">
                        <span className="eyebrow">Content Studio</span>
                        <div>
                            <h1 className="heading-xl mt-0">Tool Hub</h1>
                            <p className="text-sm text-muted mt-2 max-w-2xl">
                                Faster access to extractor workspaces, media generation, and saved document history in one compact console.
                            </p>
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                            <span className="status-badge"><span className="status-dot" />Tools: {STUDIO_TOOLS.length}</span>
                            <span className="status-badge"><span className="status-dot" />Saved Docs: {canAccessDocuments ? docPagination.total : 0}</span>
                            <span className="status-badge"><span className="status-dot" />Page: {currentPage}/{Math.max(docPagination.totalPages, 1)}</span>
                        </div>
                    </div>
                    <div className="flex w-full flex-col gap-2 xl:w-auto xl:min-w-[560px]">
                        <div className="flex flex-wrap items-center gap-2 xl:justify-end">
                            <button
                                type="button"
                                className="btn btn-primary text-xs w-full sm:w-auto"
                                onClick={() => {
                                    if (!canAccess("pdf-to-pdf")) {
                                        toast.error("Question Extractor access not granted.");
                                        return;
                                    }
                                    router.push("/pdf-to-pdf/new");
                                }}
                            >
                                Open Question Extractor
                            </button>
                            <button
                                type="button"
                                className="btn btn-secondary text-xs w-full sm:w-auto"
                                onClick={() => {
                                    if (!canAccess("media-studio")) {
                                        toast.error("Media Studio access not granted.");
                                        return;
                                    }
                                    router.push("/pdf-to-pdf/media");
                                }}
                            >
                                Open Media Studio
                            </button>
                        </div>
                        <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto_auto_auto]">
                            <input
                                value={toolQuery}
                                onChange={(event) => setToolQuery(event.target.value)}
                                placeholder="Search tools by name, category, or capability"
                                className="input"
                            />
                            <div className="status-badge justify-center px-3 py-2 text-[11px]">
                                Live: {STUDIO_TOOLS.filter((tool) => tool.status === "Live").length}
                            </div>
                            <div className="status-badge justify-center px-3 py-2 text-[11px]">
                                Beta: {STUDIO_TOOLS.filter((tool) => tool.status === "Beta").length}
                            </div>
                            <div className="status-badge justify-center px-3 py-2 text-[11px]">
                                Planned: {STUDIO_TOOLS.filter((tool) => tool.status === "Planned").length}
                            </div>
                        </div>
                    </div>
                </div>
            </header>

            <section className="grid grid-cols-1 gap-3 md:grid-cols-2 mb-4">
                {filteredTools.map((tool) => {
                    const access = canAccess(tool.permission);
                    return (
                        <article
                            key={tool.id}
                            className="surface p-4 flex flex-col gap-3 border border-slate-200/80 bg-white/80"
                        >
                            <div className="flex items-start justify-between gap-3">
                                <div className="space-y-2">
                                    <div className="flex flex-wrap items-center gap-2">
                                        <span className={`px-2 py-1 rounded-lg text-[10px] font-bold uppercase tracking-wide border ${statusTone(tool.status)}`}>
                                            {tool.status}
                                        </span>
                                        <span className="text-[10px] font-semibold text-slate-500 uppercase tracking-wide">
                                            {tool.category}
                                        </span>
                                        <span className="text-[10px] font-semibold px-2 py-1 rounded-md bg-slate-100 text-slate-600 border border-slate-200">
                                            {tool.badge}
                                        </span>
                                    </div>
                                    <div>
                                        <h3 className="text-sm font-bold text-slate-900">{tool.title}</h3>
                                        <p className="text-xs text-slate-500 mt-1 leading-relaxed max-w-xl">
                                            {tool.description}
                                        </p>
                                    </div>
                                </div>
                                <button
                                    type="button"
                                    onClick={() => handleOpenTool(tool)}
                                    className={`btn shrink-0 text-xs ${tool.href && access ? "btn-primary" : "btn-ghost"}`}
                                >
                                    {tool.href ? (access ? "Open" : "No Access") : "Planned"}
                                </button>
                            </div>
                        </article>
                    );
                })}
            </section>

            <section className="surface p-4 md:p-5">
                <div className="flex flex-col gap-4">
                    <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
                        <div>
                            <div className="flex flex-wrap items-center gap-2">
                                <h2 className="text-lg font-bold text-slate-900">Workspace Documents</h2>
                                <span className="status-badge text-[11px]">
                                    {docPagination.total === 0
                                        ? "No saved documents"
                                        : `Showing ${visibleRangeStart}-${visibleRangeEnd} of ${docPagination.total}`}
                                </span>
                                {isRefreshingDocs && (
                                    <span className="status-badge text-[11px]">
                                        Refreshing...
                                    </span>
                                )}
                            </div>
                            <p className="text-xs text-slate-500 mt-1">
                                History now loads page by page for faster startup and smoother browsing.
                            </p>
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                            <button
                                type="button"
                                className="btn btn-ghost text-xs"
                                onClick={async () => {
                                    try {
                                        await navigator.clipboard.writeText(window.location.href);
                                        toast.success("View link copied");
                                    } catch (error) {
                                        console.error(error);
                                        toast.error("Unable to copy link");
                                    }
                                }}
                            >
                                Copy View Link
                            </button>
                        </div>
                    </div>

                    <div className="surface-subtle p-3 md:p-4">
                        <div className="grid gap-2 lg:grid-cols-[minmax(0,1.45fr)_auto_auto]">
                            <input
                                value={query}
                                onChange={(event) => {
                                    setQuery(event.target.value);
                                    setCurrentPage(1);
                                }}
                                placeholder="Search by title, subject, or date"
                                className="input"
                            />
                            <select
                                value={sortBy}
                                onChange={(event) => {
                                    setSortBy(event.target.value as DocumentSortField);
                                    setCurrentPage(1);
                                }}
                                className="select w-full lg:min-w-[148px]"
                            >
                                <option value="createdAt">Created</option>
                                <option value="updatedAt">Updated</option>
                                <option value="title">Title</option>
                                <option value="subject">Subject</option>
                                <option value="date">Date</option>
                            </select>
                            <select
                                value={sortOrder}
                                onChange={(event) => {
                                    setSortOrder(event.target.value as DocumentSortDirection);
                                    setCurrentPage(1);
                                }}
                                className="select w-full lg:min-w-[112px]"
                            >
                                <option value="desc">Desc</option>
                                <option value="asc">Asc</option>
                            </select>
                        </div>

                        {canAssignDocuments && orgMembers.length > 0 && (
                            <div className="mt-3 flex flex-wrap items-center gap-2">
                                <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-[0.14em] mr-1">
                                    Staff Filter
                                </span>
                                <button
                                    type="button"
                                    onClick={() => {
                                        setAssigneeFilter("all");
                                        setCurrentPage(1);
                                    }}
                                    className={`pill ${assigneeFilter === "all" ? "pill-active" : ""}`}
                                >
                                    All
                                </button>
                                <button
                                    type="button"
                                    onClick={() => {
                                        setAssigneeFilter("unassigned");
                                        setCurrentPage(1);
                                    }}
                                    className={`pill ${assigneeFilter === "unassigned" ? "pill-active" : ""}`}
                                >
                                    Unassigned
                                </button>
                                {orgMembers.map((member) => (
                                    <button
                                        key={member.id}
                                        type="button"
                                        onClick={() => {
                                            setAssigneeFilter(member.id);
                                            setCurrentPage(1);
                                        }}
                                        className={`pill ${assigneeFilter === member.id ? "pill-active" : ""}`}
                                    >
                                        {(member.name || member.username || member.email || "Member").slice(0, 26)}
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>

                    {canAssignDocuments && selectedDocumentIds.length > 0 && (
                        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 bg-slate-50/90 px-3 py-2.5">
                            <p className="text-xs font-semibold text-slate-600">
                                Selected: {selectedDocumentIds.length}
                                {visibleDocIds.length > 0
                                    ? ` • Visible selected: ${visibleSelectedCount}/${visibleDocIds.length}`
                                    : ""}
                            </p>
                            <div className="flex items-center gap-2">
                                <button
                                    type="button"
                                    onClick={openBulkAssignmentModal}
                                    className="btn btn-secondary text-xs"
                                    disabled={selectedDocumentIds.length === 0}
                                >
                                    Assign Selected
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setSelectedDocumentIds([])}
                                    className="btn btn-ghost text-xs"
                                    disabled={selectedDocumentIds.length === 0}
                                >
                                    Clear Selection
                                </button>
                            </div>
                        </div>
                    )}

                    {!canAccessDocuments ? (
                        <div className="empty-state py-10">
                            <h3>Document access disabled</h3>
                            <p className="text-sm">You can use Media Studio. Ask admin for `pdf-to-pdf` to access extractor documents.</p>
                        </div>
                    ) : loadingDocs ? (
                        <>
                            <div className="space-y-3 md:hidden">
                                {Array.from({ length: 4 }).map((_, index) => (
                                    <div key={`doc-skeleton-${index}`} className="surface-subtle p-3">
                                        <div className="space-y-3">
                                            <div className="skeleton skeleton-text w-2/3" />
                                            <div className="flex flex-wrap gap-2">
                                                <span className="skeleton skeleton-chip w-20" />
                                                <span className="skeleton skeleton-chip w-16" />
                                                <span className="skeleton skeleton-chip w-24" />
                                            </div>
                                            <div className="grid grid-cols-2 gap-2">
                                                <div className="skeleton skeleton-chip w-full h-9" />
                                                <div className="skeleton skeleton-chip w-full h-9" />
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                            <div className="hidden md:block table-shell">
                                <table className="table table-compact">
                                    <thead>
                                        <tr>
                                            {canAssignDocuments && <th className="w-10"></th>}
                                            <th>Title</th>
                                            <th>Subject</th>
                                            <th>Date</th>
                                            <th>Created</th>
                                            <th>Assigned</th>
                                            <th className="text-right">Actions</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {Array.from({ length: 5 }).map((_, index) => (
                                            <tr key={index}>
                                                {canAssignDocuments && <td><div className="skeleton skeleton-chip w-5 h-5" /></td>}
                                                <td><div className="skeleton skeleton-text w-44" /></td>
                                                <td><div className="skeleton skeleton-chip w-24" /></td>
                                                <td><div className="skeleton skeleton-text w-20" /></td>
                                                <td><div className="skeleton skeleton-text w-32" /></td>
                                                <td><div className="skeleton skeleton-chip w-16" /></td>
                                                <td><div className="skeleton skeleton-chip w-40 ml-auto" /></td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </>
                    ) : documents.length === 0 ? (
                        <div className="empty-state py-10">
                            <h3>{isDocsFiltered ? "No matching documents" : "No documents found"}</h3>
                            <p className="text-sm">
                                {isDocsFiltered
                                    ? "Try a different search, staff filter, or sort order."
                                    : "Run a tool and save progress to populate this list."}
                            </p>
                        </div>
                    ) : (
                        <>
                            <div className="space-y-3 md:hidden">
                                {documents.map((doc) => (
                                    <article key={`mobile-${doc.id}`} className="surface-subtle p-3 border border-slate-200">
                                        <div className="flex items-start justify-between gap-3">
                                            <div className="min-w-0 flex-1">
                                                <div className="flex flex-wrap items-center gap-2">
                                                    <p className="text-sm font-semibold text-slate-900 break-words">{doc.title}</p>
                                                    {canAssignDocuments && (
                                                        <label className="inline-flex items-center gap-2 text-[11px] font-semibold text-slate-500">
                                                            <input
                                                                type="checkbox"
                                                                checked={selectedDocSet.has(doc.id)}
                                                                onChange={() => toggleDocumentSelection(doc.id)}
                                                                aria-label={`Select ${doc.title}`}
                                                            />
                                                            Select
                                                        </label>
                                                    )}
                                                </div>
                                                <div className="mt-2 flex flex-wrap items-center gap-2">
                                                    <span className="inline-flex rounded-md border border-slate-200 bg-slate-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                                                        {doc.workspaceType || "PDF_TO_PDF"}
                                                    </span>
                                                    <span className="status-badge text-[10px]">
                                                        Assigned: {Array.isArray(doc.assignedUserIds) ? doc.assignedUserIds.length : 0}
                                                    </span>
                                                    {typeof doc.correctionMarkCount === "number" && doc.correctionMarkCount > 0 && (
                                                        <span className="inline-flex rounded-md border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-700">
                                                            Marks: {doc.correctionMarkCount}
                                                        </span>
                                                    )}
                                                </div>
                                            </div>
                                        </div>
                                        <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-slate-600">
                                            <div className="rounded-xl border border-slate-200 bg-white px-3 py-2">
                                                <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Subject</p>
                                                <p className="mt-1 font-semibold text-slate-700 break-words">{doc.subject}</p>
                                            </div>
                                            <div className="rounded-xl border border-slate-200 bg-white px-3 py-2">
                                                <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Date</p>
                                                <p className="mt-1 font-semibold text-slate-700">{doc.date}</p>
                                            </div>
                                            <div className="col-span-2 rounded-xl border border-slate-200 bg-white px-3 py-2">
                                                <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Created</p>
                                                <p className="mt-1 font-semibold text-slate-700">{formatDateTime(doc.createdAt)}</p>
                                            </div>
                                        </div>
                                        <div className="mt-3">
                                            {renderDocumentActions(doc, "card")}
                                        </div>
                                    </article>
                                ))}
                            </div>
                            <div className="hidden md:block relative">
                                {isRefreshingDocs && (
                                    <div className="absolute inset-x-0 top-0 z-10 h-1 overflow-hidden rounded-t-2xl">
                                        <div className="h-full w-full animate-pulse bg-gradient-to-r from-blue-500 via-cyan-400 to-emerald-400" />
                                    </div>
                                )}
                                <div className="table-shell">
                                    <table className="table table-compact">
                                        <thead>
                                            <tr>
                                                {canAssignDocuments && (
                                                    <th className="w-10">
                                                        <input
                                                            type="checkbox"
                                                            checked={allVisibleSelected}
                                                            onChange={toggleSelectAllVisible}
                                                            aria-label="Select all visible documents"
                                                        />
                                                    </th>
                                                )}
                                                <th>Title</th>
                                                <th>Subject</th>
                                                <th>Date</th>
                                                <th>Created</th>
                                                <th>Assigned</th>
                                                <th className="text-right">Actions</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {documents.map((doc) => (
                                                <tr key={doc.id}>
                                                    {canAssignDocuments && (
                                                        <td>
                                                            <input
                                                                type="checkbox"
                                                                checked={selectedDocSet.has(doc.id)}
                                                                onChange={() => toggleDocumentSelection(doc.id)}
                                                                aria-label={`Select ${doc.title}`}
                                                            />
                                                        </td>
                                                    )}
                                                    <td>
                                                        <div className="space-y-1">
                                                            <p className="font-semibold text-slate-900">{doc.title}</p>
                                                            <div className="flex flex-wrap items-center gap-2">
                                                                <span className="inline-flex rounded-md border border-slate-200 bg-slate-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                                                                    {doc.workspaceType || "PDF_TO_PDF"}
                                                                </span>
                                                                {typeof doc.correctionMarkCount === "number" && doc.correctionMarkCount > 0 && (
                                                                    <span className="inline-flex rounded-md border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-700">
                                                                        Marks: {doc.correctionMarkCount}
                                                                    </span>
                                                                )}
                                                            </div>
                                                        </div>
                                                    </td>
                                                    <td>{doc.subject}</td>
                                                    <td>{doc.date}</td>
                                                    <td>{formatDateTime(doc.createdAt)}</td>
                                                    <td>
                                                        <span className="status-badge">
                                                            {Array.isArray(doc.assignedUserIds) ? doc.assignedUserIds.length : 0}
                                                        </span>
                                                    </td>
                                                    <td>
                                                        {renderDocumentActions(doc)}
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        </>
                    )}

                    {canAccessDocuments && docPagination.total > 0 && (
                        <div className="flex flex-col gap-3 border-t border-slate-200 pt-3 md:flex-row md:items-center md:justify-between">
                            <p className="text-xs text-slate-500">
                                Showing {visibleRangeStart}-{visibleRangeEnd} of {docPagination.total} documents
                            </p>
                            <div className="flex flex-wrap items-center gap-2">
                                <button
                                    type="button"
                                    className="btn btn-secondary text-xs"
                                    onClick={() => setCurrentPage((page) => Math.max(1, page - 1))}
                                    disabled={currentPage <= 1}
                                >
                                    Previous
                                </button>
                                <div className="flex flex-wrap items-center gap-1">
                                    {paginationItems.map((item, index) =>
                                        item === "ellipsis" ? (
                                            <span
                                                key={`ellipsis-${index}`}
                                                className="px-2 py-1 text-xs text-slate-400"
                                            >
                                                ...
                                            </span>
                                        ) : (
                                            <button
                                                key={`page-${item}`}
                                                type="button"
                                                onClick={() => setCurrentPage(item)}
                                                className={`min-w-[2.15rem] rounded-xl px-2.5 py-1.5 text-xs font-semibold transition ${item === currentPage
                                                    ? "bg-blue-600 text-white shadow-sm"
                                                    : "bg-slate-100 text-slate-600 hover:bg-slate-200 hover:text-slate-900"
                                                    }`}
                                            >
                                                {item}
                                            </button>
                                        )
                                    )}
                                </div>
                                <button
                                    type="button"
                                    className="btn btn-secondary text-xs"
                                    onClick={() => setCurrentPage((page) => Math.min(docPagination.totalPages, page + 1))}
                                    disabled={!docPagination.hasMore}
                                >
                                    Next
                                </button>
                            </div>
                        </div>
                    )}
                </div>
            </section>

            <Modal
                isOpen={modalConfig.isOpen}
                onClose={() => setModalConfig((prev) => ({ ...prev, isOpen: false }))}
                onConfirm={modalConfig.onConfirm}
                title={modalConfig.title}
                message={modalConfig.message}
                type="danger"
                confirmText="Delete"
                cancelText="Cancel"
            />

            {assignmentTargetDocIds.length > 0 && (
                <div className="fixed inset-0 z-[90] bg-slate-900/45 backdrop-blur-sm flex items-center justify-center p-4">
                    <div className="surface w-full max-w-2xl p-5 max-h-[80vh] flex flex-col">
                        <div className="flex items-start justify-between gap-3 mb-3">
                            <div>
                                <p className="text-xs font-bold uppercase tracking-wide text-slate-500">
                                    Document Assignment
                                </p>
                                <h3 className="text-base font-bold text-slate-900 mt-1">
                                    {assignmentTargetLabel}
                                </h3>
                                <p className="text-xs text-slate-500 mt-1">
                                    Select members allowed to access this document set.
                                </p>
                            </div>
                            <button
                                type="button"
                                className="btn btn-ghost text-xs"
                                onClick={closeAssignmentModal}
                            >
                                Close
                            </button>
                        </div>

                        <div className="border border-slate-200 rounded-xl bg-slate-50 p-3 overflow-auto flex-1">
                            {loadingOrgMembers ? (
                                <div className="space-y-2">
                                    {Array.from({ length: 4 }).map((_, index) => (
                                        <div key={index} className="skeleton skeleton-chip w-full h-10" />
                                    ))}
                                </div>
                            ) : orgMembers.length === 0 ? (
                                <p className="text-sm text-slate-500">
                                    No workspace members found.
                                </p>
                            ) : (
                                <div className="space-y-2">
                                    {orgMembers.map((member) => {
                                        const selected = assignmentUserIds.includes(member.id);
                                        return (
                                            <label
                                                key={member.id}
                                                className={`flex items-center gap-3 rounded-lg border px-3 py-2.5 cursor-pointer transition ${
                                                    selected
                                                        ? "bg-indigo-50 border-indigo-200"
                                                        : "bg-white border-slate-200 hover:border-slate-300"
                                                }`}
                                            >
                                                <input
                                                    type="checkbox"
                                                    checked={selected}
                                                    onChange={() => toggleAssignmentUser(member.id)}
                                                />
                                                <div className="min-w-0">
                                                    <p className="text-sm font-semibold text-slate-900 truncate">
                                                        {member.name || member.username || member.email || "Member"}
                                                    </p>
                                                    <p className="text-xs text-slate-500 truncate">
                                                        {member.email || member.username || "No login ID"}{member.designation ? ` • ${member.designation}` : ""}
                                                    </p>
                                                </div>
                                            </label>
                                        );
                                    })}
                                </div>
                            )}
                        </div>

                        <div className="mt-3 flex items-center justify-between gap-3">
                            <span className="text-xs text-slate-500">
                                Assigned: {assignmentUserIds.length}
                            </span>
                            <div className="flex items-center gap-2">
                                <button
                                    type="button"
                                    className="btn btn-ghost text-xs"
                                    onClick={closeAssignmentModal}
                                >
                                    Cancel
                                </button>
                                <button
                                    type="button"
                                    className="btn btn-primary text-xs"
                                    onClick={saveAssignments}
                                    disabled={isSavingAssignment}
                                >
                                    {isSavingAssignment ? "Saving..." : "Save Assignment"}
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
