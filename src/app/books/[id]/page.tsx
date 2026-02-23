"use client";

import { useState, useEffect } from "react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";

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
}

export default function BookDetailPage({ params }: { params: { id: string } }) {
    const [book, setBook] = useState<Book | null>(null);
    const [loading, setLoading] = useState(true);
    const [deleting, setDeleting] = useState(false);
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
            toast.error("Failed to load book");
            router.push("/books");
        } finally {
            setLoading(false);
        }
    };

    const handleDelete = async () => {
        if (!confirm("Are you sure you want to delete this book?")) return;

        setDeleting(true);
        try {
            const response = await fetch(`/api/books/${params.id}`, {
                method: "DELETE",
            });

            if (!response.ok) throw new Error("Delete failed");

            toast.success("Book deleted successfully");
            router.push("/books");
        } catch (error) {
            toast.error("Failed to delete book");
            setDeleting(false);
        }
    };

    const formatFileSize = (bytes: number) => {
        if (bytes < 1024) return bytes + " B";
        if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
        return (bytes / (1024 * 1024)).toFixed(1) + " MB";
    };

    if (loading) {
        return (
            <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50 to-indigo-50 flex items-center justify-center">
                <div className="text-center">
                    <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
                    <p className="mt-4 text-slate-600">Loading book...</p>
                </div>
            </div>
        );
    }

    if (!book) return null;

    return (
        <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50 to-indigo-50">
            {/* Header */}
            <div className="bg-white border-b border-slate-200">
                <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
                    <button
                        onClick={() => router.push("/books")}
                        className="text-blue-600 hover:text-blue-700 font-medium mb-4 flex items-center gap-2"
                    >
                        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                        </svg>
                        Back to Library
                    </button>
                    <div className="flex items-start justify-between">
                        <div className="flex-1">
                            <h1 className="text-3xl font-bold text-slate-900 mb-2">{book.title}</h1>
                            {book.description && (
                                <p className="text-slate-600 mb-4">{book.description}</p>
                            )}
                            <div className="flex flex-wrap gap-3">
                                <span className="px-3 py-1 bg-blue-100 text-blue-700 rounded-full text-sm font-medium">
                                    {book.category}
                                </span>
                                {book.classLevel && (
                                    <span className="px-3 py-1 bg-slate-100 text-slate-700 rounded-full text-sm font-medium">
                                        Class {book.classLevel}
                                    </span>
                                )}
                                <span className="px-3 py-1 bg-slate-100 text-slate-700 rounded-full text-sm">
                                    {book.pageCount || "?"} pages
                                </span>
                                <span className="px-3 py-1 bg-slate-100 text-slate-700 rounded-full text-sm">
                                    {formatFileSize(book.fileSize)}
                                </span>
                            </div>
                        </div>
                        <button
                            onClick={handleDelete}
                            disabled={deleting}
                            className="ml-4 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:bg-slate-300 transition-colors"
                        >
                            {deleting ? "Deleting..." : "Delete"}
                        </button>
                    </div>
                </div>
            </div>

            <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
                {/* PDF Viewer */}
                <div className="bg-white rounded-xl shadow-sm mb-6">
                    <div className="p-4 border-b border-slate-200 flex items-center justify-between">
                        <h2 className="text-lg font-semibold text-slate-900">PDF Preview</h2>
                        <a
                            href={book.filePath}
                            target="_blank"
                            rel="noopener noreferrer"
                            download
                            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors flex items-center gap-2"
                        >
                            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                            </svg>
                            Download PDF
                        </a>
                    </div>
                    <div className="p-4">
                        <iframe
                            src={book.filePath}
                            className="w-full h-[600px] border border-slate-200 rounded-lg"
                            title={book.title}
                        />
                    </div>
                </div>

                {/* Extracted Text */}
                {book.extractedText && (
                    <div className="bg-white rounded-xl shadow-sm">
                        <div className="p-4 border-b border-slate-200">
                            <h2 className="text-lg font-semibold text-slate-900">Extracted Text</h2>
                            <p className="text-sm text-slate-600 mt-1">
                                This text is automatically extracted and searchable
                            </p>
                        </div>
                        <div className="p-6">
                            <div className="prose max-w-none">
                                <pre className="whitespace-pre-wrap font-sans text-sm text-slate-700 leading-relaxed">
                                    {book.extractedText.length > 5000
                                        ? book.extractedText.substring(0, 5000) + "..."
                                        : book.extractedText}
                                </pre>
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
