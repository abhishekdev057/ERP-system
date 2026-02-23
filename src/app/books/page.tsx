"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import toast from "react-hot-toast";

interface Book {
    id: string;
    title: string;
    description?: string;
    fileName: string;
    filePath: string;
    fileSize?: number;
    category: string;
    classLevel?: string;
    pageCount?: number;
    uploadedAt: string;
}

const CATEGORIES = [
    { value: "CLASSES", label: "Classes" },
    { value: "COURSES", label: "Courses" },
    { value: "COACHING", label: "Coaching" },
    { value: "NOTES", label: "Notes" },
    { value: "REFERENCE", label: "Reference" },
    { value: "OTHER", label: "Other" },
];

const CLASS_LEVELS = [
    "1",
    "2",
    "3",
    "4",
    "5",
    "6",
    "7",
    "8",
    "9",
    "10",
    "11",
    "12",
    "College",
    "Competitive",
    "Professional",
];

export default function BooksPage() {
    const [books, setBooks] = useState<Book[]>([]);
    const [loading, setLoading] = useState(true);
    const [uploading, setUploading] = useState(false);
    const [searchQuery, setSearchQuery] = useState("");
    const [selectedCategory, setSelectedCategory] = useState("");
    const [selectedClass, setSelectedClass] = useState("");
    const [showUploadModal, setShowUploadModal] = useState(false);

    const [uploadForm, setUploadForm] = useState({
        title: "",
        description: "",
        category: "CLASSES",
        classLevel: "",
        file: null as File | null,
    });

    useEffect(() => {
        fetchBooks();
    }, [selectedCategory, selectedClass]);

    const fetchBooks = async () => {
        setLoading(true);
        try {
            const params = new URLSearchParams();
            if (selectedCategory) params.append("category", selectedCategory);
            if (selectedClass) params.append("classLevel", selectedClass);

            const response = await fetch(`/api/books?${params.toString()}`);
            if (!response.ok) throw new Error("Books fetch failed");
            const data = await response.json();
            setBooks(data.books || []);
        } catch (error) {
            console.error(error);
            toast.error("Failed to load books");
        } finally {
            setLoading(false);
        }
    };

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        if (file.type !== "application/pdf") {
            toast.error("Only PDF files are allowed");
            return;
        }

        setUploadForm((prev) => ({ ...prev, file }));
    };

    const handleUpload = async (e: React.FormEvent) => {
        e.preventDefault();

        if (!uploadForm.file || !uploadForm.title.trim()) {
            toast.error("Please add title and file");
            return;
        }

        setUploading(true);
        try {
            const formData = new FormData();
            formData.append("file", uploadForm.file);
            formData.append("title", uploadForm.title.trim());
            formData.append("description", uploadForm.description.trim());
            formData.append("category", uploadForm.category);
            if (uploadForm.classLevel) formData.append("classLevel", uploadForm.classLevel);

            const response = await fetch("/api/books/upload", {
                method: "POST",
                body: formData,
            });

            if (!response.ok) throw new Error("Upload failed");

            toast.success("Book uploaded");
            setShowUploadModal(false);
            setUploadForm({
                title: "",
                description: "",
                category: "CLASSES",
                classLevel: "",
                file: null,
            });
            fetchBooks();
        } catch (error) {
            console.error(error);
            toast.error("Failed to upload book");
        } finally {
            setUploading(false);
        }
    };

    const handleSearch = async () => {
        if (!searchQuery.trim()) {
            fetchBooks();
            return;
        }

        setLoading(true);
        try {
            const response = await fetch("/api/books/search", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    query: searchQuery,
                    category: selectedCategory || undefined,
                    classLevel: selectedClass || undefined,
                }),
            });

            if (!response.ok) throw new Error("Search failed");
            const data = await response.json();
            setBooks(data.books || []);
        } catch (error) {
            console.error(error);
            toast.error("Search failed");
        } finally {
            setLoading(false);
        }
    };

    const formatFileSize = (bytes?: number) => {
        if (!bytes && bytes !== 0) return "Size unavailable";
        if (bytes < 1024) return `${bytes} B`;
        if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
        return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    };

    const categoryCounts = useMemo(() => {
        const counts = new Map<string, number>();
        books.forEach((book) => {
            counts.set(book.category, (counts.get(book.category) || 0) + 1);
        });
        return counts;
    }, [books]);

    return (
        <div className="page-container">
            <header className="page-header fade-in-up">
                <div>
                    <span className="eyebrow">Library</span>
                    <h1 className="heading-xl mt-3">Book Repository</h1>
                    <p className="text-sm text-muted mt-3 max-w-2xl">
                        Upload educational PDFs, classify by category and class, and use extracted text search across your library.
                    </p>
                </div>

                <div className="flex items-center gap-2">
                    {loading ? (
                        <span className="status-badge">
                            <span className="skeleton skeleton-chip w-24" />
                        </span>
                    ) : (
                        <span className="status-badge">
                            <span className="status-dot" />
                            {books.length} results
                        </span>
                    )}
                    <button onClick={() => setShowUploadModal(true)} className="btn btn-primary">
                        Upload Book
                    </button>
                </div>
            </header>

            <section className="surface p-4 md:p-5 mb-4">
                <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                    <div className="md:col-span-2">
                        <label className="text-xs font-semibold text-slate-600 block mb-1">Search</label>
                        <div className="flex gap-2">
                            <input
                                type="text"
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                onKeyDown={(e) => e.key === "Enter" && handleSearch()}
                                placeholder="Search title, description, or extracted text"
                                className="input"
                            />
                            <button onClick={handleSearch} className="btn btn-secondary">
                                Search
                            </button>
                        </div>
                    </div>

                    <div>
                        <label className="text-xs font-semibold text-slate-600 block mb-1">Category</label>
                        <select
                            value={selectedCategory}
                            onChange={(e) => setSelectedCategory(e.target.value)}
                            className="select"
                        >
                            <option value="">All categories</option>
                            {CATEGORIES.map((cat) => (
                                <option key={cat.value} value={cat.value}>
                                    {cat.label}
                                </option>
                            ))}
                        </select>
                    </div>

                    <div>
                        <label className="text-xs font-semibold text-slate-600 block mb-1">Class Level</label>
                        <select
                            value={selectedClass}
                            onChange={(e) => setSelectedClass(e.target.value)}
                            className="select"
                        >
                            <option value="">All levels</option>
                            {CLASS_LEVELS.map((level) => (
                                <option key={level} value={level}>
                                    {level}
                                </option>
                            ))}
                        </select>
                    </div>
                </div>

                <div className="mt-3 flex flex-wrap gap-2">
                    {loading && books.length === 0
                        ? CATEGORIES.map((cat) => (
                              <span key={cat.value} className="status-badge">
                                  <span className="skeleton skeleton-chip w-24" />
                              </span>
                          ))
                        : CATEGORIES.map((cat) => {
                              const count = categoryCounts.get(cat.value) || 0;
                              return (
                                  <span key={cat.value} className="status-badge">
                                      {cat.label}: {count}
                                  </span>
                              );
                          })}
                    {(selectedCategory || selectedClass || searchQuery) && (
                        <button
                            onClick={() => {
                                setSearchQuery("");
                                setSelectedCategory("");
                                setSelectedClass("");
                            }}
                            className="btn btn-ghost text-xs"
                        >
                            Reset Filters
                        </button>
                    )}
                </div>
            </section>

            {loading ? (
                <section className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
                    {Array.from({ length: 6 }).map((_, index) => (
                        <article key={index} className="surface p-4">
                            <div className="flex items-start justify-between gap-2">
                                <span className="skeleton skeleton-chip w-20" />
                                <span className="skeleton skeleton-chip w-16" />
                            </div>
                            <div className="skeleton skeleton-text w-5/6 mt-4" />
                            <div className="skeleton skeleton-text w-3/4 mt-2" />
                            <div className="mt-4 flex flex-wrap items-center gap-2">
                                <span className="skeleton skeleton-chip w-20" />
                                <span className="skeleton skeleton-chip w-24" />
                                <span className="skeleton skeleton-chip w-24" />
                            </div>
                        </article>
                    ))}
                </section>
            ) : books.length === 0 ? (
                <section className="surface p-8">
                    <div className="empty-state">
                        <h3>No books found</h3>
                        <p className="text-sm mb-4">Try changing filters or upload your first PDF file.</p>
                        <button onClick={() => setShowUploadModal(true)} className="btn btn-primary text-xs">
                            Upload First Book
                        </button>
                    </div>
                </section>
            ) : (
                <section className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
                    {books.map((book) => (
                        <Link
                            key={book.id}
                            href={`/books/${book.id}`}
                            className="surface p-4 transition-transform hover:-translate-y-1"
                        >
                            <div className="flex items-start justify-between gap-2">
                                <span className="status-badge">{book.category}</span>
                                {book.classLevel && <span className="status-badge">Class {book.classLevel}</span>}
                            </div>

                            <h3 className="mt-3 text-base font-bold text-slate-900 line-clamp-2">{book.title}</h3>
                            {book.description && (
                                <p className="mt-2 text-sm text-slate-600 line-clamp-2">{book.description}</p>
                            )}

                            <div className="mt-4 flex flex-wrap items-center gap-2 text-xs text-slate-600">
                                <span className="status-badge">{book.pageCount || "?"} pages</span>
                                <span className="status-badge">{formatFileSize(book.fileSize)}</span>
                                <span className="status-badge">
                                    {new Date(book.uploadedAt).toLocaleDateString("en-IN", {
                                        day: "2-digit",
                                        month: "short",
                                        year: "numeric",
                                    })}
                                </span>
                            </div>
                        </Link>
                    ))}
                </section>
            )}

            {showUploadModal && (
                <div className="fixed inset-0 z-[90] flex items-center justify-center p-4">
                    <button
                        className="absolute inset-0 modal-backdrop border-0"
                        onClick={() => setShowUploadModal(false)}
                        aria-label="Close upload dialog"
                    />

                    <div className="relative w-full max-w-xl bg-white border border-slate-200 rounded-3xl shadow-2xl p-6">
                        <div className="flex items-start justify-between gap-3 mb-4">
                            <div>
                                <h2 className="text-xl font-bold text-slate-900">Upload PDF Book</h2>
                                <p className="text-sm text-slate-600 mt-1">Add metadata so search and filtering remain accurate.</p>
                            </div>
                            <button onClick={() => setShowUploadModal(false)} className="btn btn-ghost text-xs">
                                Close
                            </button>
                        </div>

                        <form onSubmit={handleUpload} className="space-y-3">
                            <div>
                                <label className="text-xs font-semibold text-slate-600 block mb-1">Title</label>
                                <input
                                    type="text"
                                    value={uploadForm.title}
                                    onChange={(e) => setUploadForm((prev) => ({ ...prev, title: e.target.value }))}
                                    className="input"
                                    required
                                />
                            </div>

                            <div>
                                <label className="text-xs font-semibold text-slate-600 block mb-1">Description</label>
                                <textarea
                                    value={uploadForm.description}
                                    onChange={(e) =>
                                        setUploadForm((prev) => ({ ...prev, description: e.target.value }))
                                    }
                                    className="textarea"
                                    rows={3}
                                />
                            </div>

                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                <div>
                                    <label className="text-xs font-semibold text-slate-600 block mb-1">Category</label>
                                    <select
                                        value={uploadForm.category}
                                        onChange={(e) =>
                                            setUploadForm((prev) => ({ ...prev, category: e.target.value }))
                                        }
                                        className="select"
                                    >
                                        {CATEGORIES.map((cat) => (
                                            <option key={cat.value} value={cat.value}>
                                                {cat.label}
                                            </option>
                                        ))}
                                    </select>
                                </div>

                                <div>
                                    <label className="text-xs font-semibold text-slate-600 block mb-1">Class Level</label>
                                    <select
                                        value={uploadForm.classLevel}
                                        onChange={(e) =>
                                            setUploadForm((prev) => ({ ...prev, classLevel: e.target.value }))
                                        }
                                        className="select"
                                    >
                                        <option value="">None</option>
                                        {CLASS_LEVELS.map((level) => (
                                            <option key={level} value={level}>
                                                {level}
                                            </option>
                                        ))}
                                    </select>
                                </div>
                            </div>

                            <div>
                                <label className="text-xs font-semibold text-slate-600 block mb-1">PDF File</label>
                                <input
                                    type="file"
                                    accept="application/pdf"
                                    onChange={handleFileChange}
                                    className="input"
                                    required
                                />
                                {uploadForm.file && (
                                    <p className="text-xs text-slate-600 mt-1">Selected: {uploadForm.file.name}</p>
                                )}
                            </div>

                            <div className="pt-2 flex items-center justify-end gap-2">
                                <button
                                    type="button"
                                    onClick={() => setShowUploadModal(false)}
                                    className="btn btn-ghost"
                                >
                                    Cancel
                                </button>
                                <button type="submit" className="btn btn-primary" disabled={uploading}>
                                    {uploading ? "Uploading..." : "Upload"}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
}
