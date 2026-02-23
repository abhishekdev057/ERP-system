"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import toast from "react-hot-toast";
import Modal from "@/components/ui/Modal";
import { downloadBlobAsFile, formatDateTime } from "@/lib/utils";

interface Document {
    id: string;
    title: string;
    subject: string;
    date: string;
    createdAt: string;
    workspaceType: "IMAGE_TO_PDF" | "JSON_TO_PDF";
}

export default function HistoryPage() {
    const router = useRouter();
    const [documents, setDocuments] = useState<Document[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");
    const [searchQuery, setSearchQuery] = useState("");
    const [usingDocId, setUsingDocId] = useState<string | null>(null);

    const [modalConfig, setModalConfig] = useState<{
        isOpen: boolean;
        title: string;
        message: string;
        onConfirm?: () => void;
        type: "danger" | "warning" | "info" | "success";
    }>({
        isOpen: false,
        title: "",
        message: "",
        onConfirm: undefined,
        type: "info",
    });

    useEffect(() => {
        fetchDocuments();
    }, []);

    const fetchDocuments = async () => {
        try {
            const res = await fetch("/api/documents?minimal=true");
            if (!res.ok) throw new Error("History request failed");
            const data = await res.json();
            if (data?.error) throw new Error(String(data.error));
            setDocuments(data.documents || []);
        } catch (err) {
            setError(err instanceof Error ? err.message : "Failed to load document history");
            toast.error("Failed to load document history");
        } finally {
            setLoading(false);
        }
    };

    const handleRegenerate = async (id: string, title: string) => {
        try {
            const res = await fetch(`/api/documents/${id}`, { method: "POST" });
            if (!res.ok) throw new Error("Regeneration failed");
            const blob = await res.blob();
            downloadBlobAsFile(blob, `${title}.pdf`);
            toast.success("PDF downloaded successfully");
        } catch {
            toast.error("Failed to regenerate PDF");
        }
    };

    const handleDelete = (id: string) => {
        setModalConfig({
            isOpen: true,
            title: "Delete document",
            message: "This action permanently removes the document from history.",
            type: "danger",
            onConfirm: async () => {
                try {
                    const res = await fetch(`/api/documents/${id}`, { method: "DELETE" });
                    if (!res.ok) throw new Error("Delete failed");
                    setDocuments((prev) => prev.filter((d) => d.id !== id));
                    toast.success("Document deleted");
                } catch {
                    toast.error("Failed to delete document");
                }
            },
        });
    };

    const handleUseWorkspace = async (
        id: string,
        workspaceType: "IMAGE_TO_PDF" | "JSON_TO_PDF"
    ) => {
        setUsingDocId(id);
        try {
            router.push(
                workspaceType === "IMAGE_TO_PDF"
                    ? `/image-to-pdf?load=${id}`
                    : `/generate?load=${id}`
            );
        } catch (err) {
            console.error("Failed to route workspace:", err);
            toast.error("Failed to open document workspace");
        } finally {
            setUsingDocId(null);
        }
    };

    const handleShare = async (id: string) => {
        const url = `${window.location.origin}/api/documents/${id}`;

        try {
            if (navigator.clipboard?.writeText) {
                await navigator.clipboard.writeText(url);
                toast.success("Link copied");
                return;
            }

            const helper = document.createElement("textarea");
            helper.value = url;
            helper.setAttribute("readonly", "");
            helper.style.position = "absolute";
            helper.style.left = "-9999px";
            document.body.appendChild(helper);
            helper.select();
            document.execCommand("copy");
            document.body.removeChild(helper);
            toast.success("Link copied");
        } catch (error) {
            console.error("Share copy failed:", error);
            toast.error("Failed to copy link");
        }
    };

    const filteredDocs = useMemo(
        () =>
            documents.filter((doc) =>
                `${doc.title} ${doc.subject}`.toLowerCase().includes(searchQuery.toLowerCase())
            ),
        [documents, searchQuery]
    );

    return (
        <div className="page-container">
            <header className="page-header fade-in-up">
                <div>
                    <span className="eyebrow">Records</span>
                    <h1 className="heading-xl mt-3">Document History</h1>
                    <p className="text-sm text-muted mt-3">Search, reuse, share, and clean previously generated documents.</p>
                </div>
                <div className="flex items-center gap-2">
                    {loading ? (
                        <span className="status-badge">
                            <span className="skeleton skeleton-chip w-20" />
                        </span>
                    ) : error ? (
                        <span className="status-badge">Data unavailable</span>
                    ) : (
                        <span className="status-badge">
                            <span className="status-dot" />
                            {documents.length} total
                        </span>
                    )}
                    <Link href="/generate" className="btn btn-primary">
                        New Document
                    </Link>
                </div>
            </header>

            <section className="surface p-4 md:p-5 mb-4">
                <div className="flex flex-wrap items-center gap-2">
                    <input
                        type="text"
                        placeholder="Search by title or subject"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="input max-w-xl"
                    />
                    {searchQuery && (
                        <button onClick={() => setSearchQuery("")} className="btn btn-secondary">
                            Clear
                        </button>
                    )}
                </div>
            </section>

            {loading ? (
                <section className="surface p-4 md:p-5 fade-in-up">
                    <div className="table-shell">
                        <table className="table min-w-[1180px]">
                            <thead>
                                <tr>
                                    <th>Title</th>
                                    <th>Workspace</th>
                                    <th>Subject</th>
                                    <th>Date</th>
                                    <th>Created</th>
                                    <th className="text-right">Actions</th>
                                </tr>
                            </thead>
                            <tbody>
                                {Array.from({ length: 7 }).map((_, index) => (
                                    <tr key={index}>
                                        <td><div className="skeleton skeleton-text w-48" /></td>
                                        <td><div className="skeleton skeleton-chip w-24" /></td>
                                        <td><div className="skeleton skeleton-chip w-24" /></td>
                                        <td><div className="skeleton skeleton-text w-20" /></td>
                                        <td><div className="skeleton skeleton-text w-32" /></td>
                                        <td>
                                            <div className="flex justify-end gap-2 flex-nowrap whitespace-nowrap">
                                                <div className="skeleton skeleton-chip w-14" />
                                                <div className="skeleton skeleton-chip w-20" />
                                                <div className="skeleton skeleton-chip w-16" />
                                                <div className="skeleton skeleton-chip w-16" />
                                            </div>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </section>
            ) : error ? (
                <section className="surface p-8">
                    <div className="empty-state">
                        <h3>Could not load history</h3>
                        <p className="text-sm">{error}</p>
                    </div>
                </section>
            ) : filteredDocs.length === 0 ? (
                <section className="surface p-8">
                    <div className="empty-state">
                        <h3>{documents.length === 0 ? "No documents yet" : "No matching results"}</h3>
                        <p className="text-sm mb-4">
                            {documents.length === 0
                                ? "Create your first PDF to populate history."
                                : "Try a broader query or clear the current search."}
                        </p>
                        {documents.length === 0 ? (
                            <Link href="/generate" className="btn btn-primary text-xs">
                                Generate PDF
                            </Link>
                        ) : (
                            <button onClick={() => setSearchQuery("")} className="btn btn-secondary text-xs">
                                Reset Search
                            </button>
                        )}
                    </div>
                </section>
            ) : (
                <section className="surface p-4 md:p-5 fade-in-up">
                    <div className="table-shell">
                        <table className="table min-w-[1180px]">
                            <thead>
                                <tr>
                                    <th>Title</th>
                                    <th>Workspace</th>
                                    <th>Subject</th>
                                    <th>Date</th>
                                    <th>Created</th>
                                    <th className="text-right">Actions</th>
                                </tr>
                            </thead>
                            <tbody>
                                {filteredDocs.map((doc) => (
                                    <tr key={doc.id}>
                                        <td className="font-semibold text-slate-900">{doc.title}</td>
                                        <td>
                                            <span className="status-badge whitespace-nowrap">
                                                {doc.workspaceType === "IMAGE_TO_PDF"
                                                    ? "Image to PDF"
                                                    : "JSON to PDF"}
                                            </span>
                                        </td>
                                        <td>
                                            <span className="status-badge whitespace-nowrap">{doc.subject}</span>
                                        </td>
                                        <td className="text-slate-600 whitespace-nowrap">{doc.date}</td>
                                        <td className="text-slate-600 whitespace-nowrap">{formatDateTime(doc.createdAt)}</td>
                                        <td>
                                            <div className="flex justify-end gap-2 flex-nowrap whitespace-nowrap">
                                                <button
                                                    onClick={() =>
                                                        handleUseWorkspace(doc.id, doc.workspaceType)
                                                    }
                                                    className="btn btn-secondary text-xs whitespace-nowrap"
                                                    disabled={usingDocId === doc.id}
                                                >
                                                    {usingDocId === doc.id ? "Opening..." : "Use"}
                                                </button>
                                                <button
                                                    onClick={() => handleRegenerate(doc.id, doc.title)}
                                                    className="btn btn-primary text-xs whitespace-nowrap"
                                                >
                                                    Download
                                                </button>
                                                <button
                                                    onClick={() => handleShare(doc.id)}
                                                    className="btn btn-secondary text-xs whitespace-nowrap"
                                                >
                                                    Share
                                                </button>
                                                <button
                                                    onClick={() => handleDelete(doc.id)}
                                                    className="btn btn-danger text-xs whitespace-nowrap"
                                                >
                                                    Delete
                                                </button>
                                            </div>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </section>
            )}

            <Modal
                isOpen={modalConfig.isOpen}
                onClose={() => setModalConfig((prev) => ({ ...prev, isOpen: false }))}
                onConfirm={modalConfig.onConfirm}
                title={modalConfig.title}
                message={modalConfig.message}
                type={modalConfig.type}
                confirmText="Delete"
                cancelText="Cancel"
            />
        </div>
    );
}
