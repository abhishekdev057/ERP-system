"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";
import Modal from "@/components/ui/Modal";
import BookReaderWorkspace from "@/components/books/BookReaderWorkspace";

interface Book {
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
}

export default function BookDetailPage({ params }: { params: { id: string } }) {
    const [book, setBook] = useState<Book | null>(null);
    const [liveWorkspaceStats, setLiveWorkspaceStats] = useState<Book["workspaceStats"] | null>(null);
    const [livePageCount, setLivePageCount] = useState<number | null>(null);
    const [livePreparedSetName, setLivePreparedSetName] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    const [deleting, setDeleting] = useState(false);
    const [confirmOpen, setConfirmOpen] = useState(false);
    const router = useRouter();

    useEffect(() => {
        fetchBook();
    }, [params.id]);

    const fetchBook = async () => {
        try {
            const response = await fetch(`/api/books/${params.id}`);
            if (!response.ok) throw new Error("Book not found");
            const data = await response.json();
            setBook(data.book);
        } catch (error) {
            console.error(error);
            toast.error("Failed to load book");
            router.push("/books");
        } finally {
            setLoading(false);
        }
    };

    const handleDelete = async () => {
        setDeleting(true);
        try {
            const response = await fetch(`/api/books/${params.id}`, {
                method: "DELETE",
            });

            if (!response.ok) throw new Error("Delete failed");

            toast.success("Book deleted");
            router.push("/books");
        } catch (error) {
            console.error(error);
            toast.error("Failed to delete book");
            setDeleting(false);
        }
    };

    const formatFileSize = (bytes: number) => {
        if (bytes < 1024) return `${bytes} B`;
        if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
        return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    };

    if (loading) {
        return (
            <div
                className="page-container"
                style={{
                    width: "min(1500px, calc(100% - 2rem))",
                    minHeight: "calc(100vh - 7.75rem)",
                }}
            >
                <header className="page-header">
                    <div>
                        <div className="skeleton skeleton-text w-32 mb-3" />
                        <div className="skeleton skeleton-text w-[26rem]" />
                        <div className="skeleton skeleton-text w-[32rem] mt-3" />
                        <div className="mt-4 flex flex-wrap gap-2">
                            {Array.from({ length: 5 }).map((_, index) => (
                                <span key={index} className="skeleton skeleton-chip w-24" />
                            ))}
                        </div>
                    </div>
                    <div className="flex items-center gap-2">
                        <span className="skeleton skeleton-chip w-28" />
                        <span className="skeleton skeleton-chip w-20" />
                    </div>
                </header>

                <section className="grid grid-cols-1 gap-4 xl:grid-cols-[1.2fr_0.8fr]">
                    <article className="workspace-panel">
                        <div className="workspace-panel-header">
                            <p className="text-xs font-bold uppercase tracking-wide text-slate-500">PDF Preview</p>
                        </div>
                        <div className="workspace-scroll p-4" style={{ minHeight: "min(720px, 70vh)" }}>
                            <div className="skeleton skeleton-block h-full min-h-[680px]" />
                        </div>
                    </article>

                    <article className="workspace-panel">
                        <div className="workspace-panel-header">
                            <p className="text-xs font-bold uppercase tracking-wide text-slate-500">Extracted Text</p>
                        </div>
                        <div className="workspace-scroll p-4 space-y-3" style={{ minHeight: "min(720px, 70vh)" }}>
                            {Array.from({ length: 8 }).map((_, index) => (
                                <div key={index} className="skeleton skeleton-text w-full" />
                            ))}
                        </div>
                    </article>
                </section>
            </div>
        );
    }

    if (!book) return null;

    const effectiveStats = liveWorkspaceStats || book.workspaceStats;
    const effectivePageCount = livePageCount || book.pageCount;
    const coverage =
        effectiveStats?.totalPages && effectiveStats.totalPages > 0
            ? Math.round((effectiveStats.extractedPages / effectiveStats.totalPages) * 100)
            : 0;

    return (
        <div
            className="page-container"
            style={{
                width: "min(1500px, calc(100% - 2rem))",
                minHeight: "calc(100vh - 7.75rem)",
                paddingBottom: "2rem",
            }}
        >
            <header className="page-header surface-premium" style={{ padding: "1.25rem 1.4rem" }}>
                <div className="w-full">
                    <div className="flex flex-wrap items-start justify-between gap-4">
                        <div>
                            <button onClick={() => router.push("/books")} className="btn btn-ghost mb-3">
                                Back to Library
                            </button>
                            <h1 className="heading-xl">{book.title}</h1>
                            {book.description && <p className="text-sm text-muted mt-3 max-w-3xl">{book.description}</p>}

                            <div className="mt-4 flex flex-wrap gap-2">
                                <span className="status-badge">{book.category}</span>
                                {book.classLevel && <span className="status-badge">Class {book.classLevel}</span>}
                                <span className="status-badge">{effectivePageCount || "?"} pages</span>
                                <span className="status-badge">{formatFileSize(book.fileSize)}</span>
                                <span className="status-badge">
                                    Uploaded {new Date(book.uploadedAt).toLocaleDateString("en-IN", {
                                        day: "2-digit",
                                        month: "short",
                                        year: "numeric",
                                    })}
                                </span>
                            </div>
                        </div>

                        <div className="flex flex-wrap items-center gap-2">
                            <a
                                href={book.filePath}
                                target="_blank"
                                rel="noopener noreferrer"
                                download
                                className="btn btn-primary"
                            >
                                Download PDF
                            </a>
                            <button onClick={() => setConfirmOpen(true)} className="btn btn-danger" disabled={deleting}>
                                {deleting ? "Deleting..." : "Delete"}
                            </button>
                        </div>
                    </div>

                    <div className="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-5">
                        <article className="rounded-[24px] border border-slate-200 bg-white/88 px-4 py-3">
                            <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-400">Status</p>
                            <p className="mt-2 text-lg font-bold text-slate-900">
                                {effectiveStats?.statusLabel || "Nothing extracted yet"}
                            </p>
                            <p className="text-xs text-slate-500">{coverage}% extraction coverage</p>
                        </article>
                        <article className="rounded-[24px] border border-slate-200 bg-white/88 px-4 py-3">
                            <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-400">Pages</p>
                            <p className="mt-2 text-lg font-bold text-slate-900">{effectiveStats?.totalPages || effectivePageCount || 0}</p>
                            <p className="text-xs text-slate-500">{effectiveStats?.notExtractedPages || 0} not extracted</p>
                        </article>
                        <article className="rounded-[24px] border border-slate-200 bg-white/88 px-4 py-3">
                            <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-400">Extracted</p>
                            <p className="mt-2 text-lg font-bold text-slate-900">{effectiveStats?.extractedPages || 0}</p>
                            <p className="text-xs text-slate-500">
                                {effectiveStats?.searchablePages || 0} searchable • {effectiveStats?.ocrPages || 0} OCR
                            </p>
                        </article>
                        <article className="rounded-[24px] border border-slate-200 bg-white/88 px-4 py-3">
                            <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-400">Questions</p>
                            <p className="mt-2 text-lg font-bold text-slate-900">{effectiveStats?.extractedQuestionCount || 0}</p>
                            <p className="text-xs text-slate-500">Structured from pages and selections</p>
                        </article>
                        <article className="rounded-[24px] border border-slate-200 bg-white/88 px-4 py-3">
                            <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-400">Prepared Sets</p>
                            <p className="mt-2 text-lg font-bold text-slate-900">{effectiveStats?.preparedSetCount || 0}</p>
                            <p className="text-xs text-slate-500">{livePreparedSetName || "No prepared set saved yet"}</p>
                        </article>
                    </div>
                </div>
            </header>

            <BookReaderWorkspace
                book={book}
                onWorkspaceChange={({ pageCount, workspaceStats, preparedSetName }) => {
                    setLivePageCount(pageCount || null);
                    setLiveWorkspaceStats(workspaceStats || null);
                    setLivePreparedSetName(preparedSetName || null);
                }}
            />

            <Modal
                isOpen={confirmOpen}
                onClose={() => setConfirmOpen(false)}
                onConfirm={handleDelete}
                title="Delete this book"
                message="This will remove both the database record and uploaded PDF file."
                type="danger"
                confirmText="Delete"
                cancelText="Cancel"
            />
        </div>
    );
}
