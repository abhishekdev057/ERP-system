"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { formatDateTime, downloadBlobAsFile } from "@/lib/utils";
import toast from "react-hot-toast";
import Modal from "@/components/ui/Modal";

interface Document {
    id: string;
    title: string;
    subject: string;
    date: string;
    createdAt: string;
}

export default function HistoryPage() {
    const [documents, setDocuments] = useState<Document[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");
    const [searchQuery, setSearchQuery] = useState("");

    // Modal state
    const [modalConfig, setModalConfig] = useState<{
        isOpen: boolean;
        title: string;
        message: string;
        onConfirm: () => void;
        type: "danger" | "warning" | "info" | "success";
    }>({
        isOpen: false,
        title: "",
        message: "",
        onConfirm: () => { },
        type: "info"
    });

    useEffect(() => {
        fetchDocuments();
    }, []);

    const fetchDocuments = async () => {
        try {
            const res = await fetch("/api/documents?minimal=true");
            const data = await res.json();
            setDocuments(data.documents || []);
        } catch {
            setError("Failed to load document history");
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
            toast.success("PDF downloaded successfully!");
        } catch {
            toast.error("Failed to regenerate PDF");
        }
    };

    const handleDelete = async (id: string) => {
        setModalConfig({
            isOpen: true,
            title: "Delete Document",
            message: "Are you sure you want to delete this document? This action cannot be undone.",
            type: "danger",
            onConfirm: async () => {
                try {
                    await fetch(`/api/documents/${id}`, { method: "DELETE" });
                    setDocuments((prev) => prev.filter((d) => d.id !== id));
                    toast.success("Document deleted successfully!");
                } catch {
                    toast.error("Failed to delete document");
                }
            }
        });
    };

    const filteredDocs = documents.filter((doc) =>
        doc.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
        doc.subject.toLowerCase().includes(searchQuery.toLowerCase())
    );

    return (
        <div className="max-w-7xl mx-auto px-5 py-8">
            {/* Page Header */}
            <div className="flex items-center justify-between mb-6 animate-fade-in-up">
                <div>
                    <h1 className="text-4xl font-black text-slate-800 mb-2">
                        Document <span className="gradient-text-cyan">History</span>
                    </h1>
                    <p className="text-sm text-slate-500">
                        All your previously generated PDFs
                    </p>
                </div>
                <div className="badge badge-gold text-xs px-4 py-2">
                    {documents.length} Documents
                </div>
            </div>

            {/* Search Bar */}
            {!loading && documents.length > 0 && (
                <div className="glass-card p-3 mb-5 animate-fade-in-up">
                    <div className="flex items-center gap-2.5">
                        <div className="icon-circle-cyan w-8 h-8">
                            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"></circle><path d="m21 21-4.3-4.3"></path></svg>
                        </div>
                        <input
                            type="text"
                            placeholder="Search documents by title or subject..."
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            className="flex-1 bg-transparent text-xs outline-none placeholder:text-slate-400"
                        />
                        {searchQuery && (
                            <button
                                onClick={() => setSearchQuery("")}
                                className="text-slate-400 hover:text-slate-600"
                            >
                                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18"></path><path d="m6 6 12 12"></path></svg>
                            </button>
                        )}
                    </div>
                </div>
            )}

            {/* Loading */}
            {loading && (
                <div className="glass-card p-12 text-center">
                    <div className="spinner mx-auto mb-3" />
                    <p className="text-slate-400 text-xs">Loading documents...</p>
                </div>
            )}

            {/* Error */}
            {error && (
                <div className="bg-red-50 border border-red-100 rounded-xl px-4 py-3 mb-5">
                    <p className="text-red-500 text-xs flex items-center gap-2">
                        <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>
                        {error}
                    </p>
                </div>
            )}

            {/* Empty State */}
            {!loading && documents.length === 0 && (
                <div className="glass-card p-12 text-center animate-fade-in-up">
                    <div className="empty-state-illustration w-20 h-20">
                        <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#8b5cf6" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                            <polyline points="14 2 14 8 20 8" />
                        </svg>
                    </div>
                    <h3 className="text-base font-bold text-slate-800 mb-1.5">
                        No documents yet
                    </h3>
                    <p className="text-xs text-slate-500 mb-5">
                        Generate your first PDF from the Generate page
                    </p>
                    <Link href="/generate" className="glow-btn px-5 py-2.5 text-xs">
                        Generate First PDF
                    </Link>
                </div>
            )}

            {/* No Search Results */}
            {!loading && documents.length > 0 && filteredDocs.length === 0 && (
                <div className="glass-card p-12 text-center animate-fade-in-up">
                    <div className="icon-circle-cyan w-12 h-12 mx-auto mb-3">
                        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"></circle><path d="m21 21-4.3-4.3"></path></svg>
                    </div>
                    <h3 className="text-base font-bold text-slate-800 mb-1.5">
                        No matching documents
                    </h3>
                    <p className="text-xs text-slate-500 mb-5">
                        Try a different search term
                    </p>
                    <button onClick={() => setSearchQuery("")} className="glow-btn-secondary px-5 py-2.5 text-xs">
                        Clear Search
                    </button>
                </div>
            )}

            {/* Documents Table */}
            {!loading && filteredDocs.length > 0 && (
                <div className="glass-card overflow-hidden animate-fade-in-up">
                    <table className="history-table">
                        {/* ... table content remains same ... */}
                        <thead>
                            <tr>
                                <th className="text-xs">Title</th>
                                <th className="text-xs">Subject</th>
                                <th className="text-xs">Date</th>
                                <th className="text-xs">Created</th>
                                <th className="text-right text-xs">Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            {filteredDocs.map((doc, index) => (
                                <tr key={doc.id} className="animate-fade-in-up" style={{ animationDelay: `${index * 0.03}s` }}>
                                    <td>
                                        <div className="flex items-center gap-2.5">
                                            <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-amber-200 via-yellow-300 to-orange-300 flex items-center justify-center flex-shrink-0 shadow-sm">
                                                <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#92400e" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                                                    <polyline points="14 2 14 8 20 8" />
                                                </svg>
                                            </div>
                                            <span className="text-slate-800 font-medium text-xs">
                                                {doc.title}
                                            </span>
                                        </div>
                                    </td>
                                    <td>
                                        <span className="badge badge-violet text-[10px] py-1">{doc.subject}</span>
                                    </td>
                                    <td className="text-xs text-slate-500">{doc.date}</td>
                                    <td className="text-[10px] text-slate-400">
                                        {formatDateTime(doc.createdAt)}
                                    </td>
                                    <td>
                                        <div className="flex items-center justify-end gap-1.5">
                                            <Link
                                                href={`/generate?load=${doc.id}`}
                                                className="px-3 py-1.5 rounded-lg bg-gradient-to-r from-emerald-50 to-emerald-100 text-emerald-700 text-[10px] font-semibold hover:from-emerald-100 hover:to-emerald-150 transition-colors"
                                            >
                                                Use This
                                            </Link>
                                            <button
                                                onClick={() => handleRegenerate(doc.id, doc.title)}
                                                className="px-3 py-1.5 rounded-lg bg-gradient-to-r from-cyan-50 to-cyan-100 text-cyan-700 text-[10px] font-semibold hover:from-cyan-100 hover:to-cyan-150 transition-colors"
                                            >
                                                Download
                                            </button>
                                            <button
                                                onClick={() => {
                                                    const url = `${window.location.origin}/api/documents/${doc.id}`;
                                                    navigator.clipboard.writeText(url);
                                                    toast.success("Link copied to clipboard!");
                                                }}
                                                className="px-3 py-1.5 rounded-lg bg-gradient-to-r from-violet-50 to-violet-100 text-violet-700 text-[10px] font-semibold hover:from-violet-100 hover:to-violet-150 transition-colors"
                                            >
                                                Share
                                            </button>
                                            <button
                                                onClick={() => handleDelete(doc.id)}
                                                className="px-3 py-1.5 rounded-lg bg-gradient-to-r from-red-50 to-red-100 text-red-600 text-[10px] font-semibold hover:from-red-100 hover:to-red-150 transition-colors"
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
            )}

            <Modal
                isOpen={modalConfig.isOpen}
                onClose={() => setModalConfig({ ...modalConfig, isOpen: false })}
                onConfirm={modalConfig.onConfirm}
                title={modalConfig.title}
                message={modalConfig.message}
                type={modalConfig.type}
                confirmText="Yes, Delete"
                cancelText="No, Keep it"
            />
        </div>
    );
}
