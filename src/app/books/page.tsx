"use client";

import { useState, useRef, useEffect } from "react";
import { toast } from "sonner";

interface Book {
    id: string;
    title: string;
    description?: string;
    fileName: string;
    filePath: string;
    fileSize: number;
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
    "1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "12",
    "College", "Competitive", "Professional"
];

export default function BooksPage() {
    const [books, setBooks] = useState<Book[]>([]);
    const [loading, setLoading] = useState(true);
    const [uploading, setUploading] = useState(false);
    const [searchQuery, setSearchQuery] = useState("");
    const [selectedCategory, setSelectedCategory] = useState("");
    const [selectedClass, setSelectedClass] = useState("");
    const [showUploadModal, setShowUploadModal] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);

    // Form state for upload
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

            const response = await fetch(`/api/books?${params}`);
            const data = await response.json();
            setBooks(data.books || []);
        } catch (error) {
            toast.error("Failed to load books");
        } finally {
            setLoading(false);
        }
    };

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) {
            if (file.type !== "application/pdf") {
                toast.error("Only PDF files are allowed");
                return;
            }
            setUploadForm((prev) => ({ ...prev, file }));
        }
    };

    const handleUpload = async (e: React.FormEvent) => {
        e.preventDefault();

        if (!uploadForm.file || !uploadForm.title) {
            toast.error("Please provide a file and title");
            return;
        }

        setUploading(true);
        try {
            const formData = new FormData();
            formData.append("file", uploadForm.file);
            formData.append("title", uploadForm.title);
            formData.append("description", uploadForm.description);
            formData.append("category", uploadForm.category);
            if (uploadForm.classLevel) {
                formData.append("classLevel", uploadForm.classLevel);
            }

            const response = await fetch("/api/books/upload", {
                method: "POST",
                body: formData,
            });

            if (!response.ok) throw new Error("Upload failed");

            toast.success("Book uploaded successfully!");
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

            const data = await response.json();
            setBooks(data.books || []);
        } catch (error) {
            toast.error("Search failed");
        } finally {
            setLoading(false);
        }
    };

    const formatFileSize = (bytes: number) => {
        if (bytes < 1024) return bytes + " B";
        if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
        return (bytes / (1024 * 1024)).toFixed(1) + " MB";
    };

    return (
        <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50 to-indigo-50">
            {/* Header */}
            <div className="bg-white border-b border-slate-200 sticky top-0 z-10">
                <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
                    <div className="flex items-center justify-between">
                        <div>
                            <h1 className="text-2xl font-bold text-slate-900">📚 Book Library</h1>
                            <p className="text-sm text-slate-600 mt-1">
                                Upload and manage educational PDFs
                            </p>
                        </div>
                        <button
                            onClick={() => setShowUploadModal(true)}
                            className="bg-gradient-to-r from-blue-600 to-indigo-600 text-white px-6 py-3 rounded-lg font-medium hover:from-blue-700 hover:to-indigo-700 transition-all shadow-lg hover:shadow-xl"
                        >
                            + Upload Book
                        </button>
                    </div>
                </div>
            </div>

            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
                {/* Search and Filters */}
                <div className="bg-white rounded-xl shadow-sm p-6 mb-6">
                    <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                        <div className="md:col-span-2">
                            <label className="block text-sm font-medium text-slate-700 mb-2">
                                Search Books
                            </label>
                            <div className="flex gap-2">
                                <input
                                    type="text"
                                    value={searchQuery}
                                    onChange={(e) => setSearchQuery(e.target.value)}
                                    onKeyDown={(e) => e.key === "Enter" && handleSearch()}
                                    placeholder="Enter query..."
                                    className="flex-1 px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                                />
                                <button
                                    onClick={handleSearch}
                                    className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                                >
                                    Search
                                </button>
                            </div>
                        </div>

                        <div>
                            <label className="block text-sm font-medium text-slate-700 mb-2">
                                Category
                            </label>
                            <select
                                value={selectedCategory}
                                onChange={(e) => setSelectedCategory(e.target.value)}
                                className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                            >
                                <option value="">All Categories</option>
                                {CATEGORIES.map((cat) => (
                                    <option key={cat.value} value={cat.value}>
                                        {cat.label}
                                    </option>
                                ))}
                            </select>
                        </div>

                        <div>
                            <label className="block text-sm font-medium text-slate-700 mb-2">
                                Class Level
                            </label>
                            <select
                                value={selectedClass}
                                onChange={(e) => setSelectedClass(e.target.value)}
                                className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                            >
                                <option value="">All Levels</option>
                                {CLASS_LEVELS.map((level) => (
                                    <option key={level} value={level}>
                                        {level}
                                    </option>
                                ))}
                            </select>
                        </div>
                    </div>
                </div>

                {/* Books Grid */}
                {loading ? (
                    <div className="text-center py-12">
                        <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
                        <p className="mt-4 text-slate-600">Loading books...</p>
                    </div>
                ) : books.length === 0 ? (
                    <div className="text-center py-12 bg-white rounded-xl">
                        <p className="text-slate-600">No books found. Upload your first book!</p>
                    </div>
                ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                        {books.map((book) => (
                            <div
                                key={book.id}
                                className="bg-white rounded-xl shadow-sm hover:shadow-md transition-shadow p-6 cursor-pointer"
                                onClick={() => (window.location.href = `/books/${book.id}`)}
                            >
                                <div className="flex items-start justify-between mb-3">
                                    <div className="bg-gradient-to-br from-blue-100 to-indigo-100 p-3 rounded-lg">
                                        <svg
                                            className="w-6 h-6 text-blue-600"
                                            fill="none"
                                            viewBox="0 0 24 24"
                                            stroke="currentColor"
                                        >
                                            <path
                                                strokeLinecap="round"
                                                strokeLinejoin="round"
                                                strokeWidth={2}
                                                d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253"
                                            />
                                        </svg>
                                    </div>
                                    <span className="text-xs font-medium px-2 py-1 bg-blue-100 text-blue-700 rounded">
                                        {book.category}
                                    </span>
                                </div>
                                <h3 className="font-semibold text-slate-900 mb-2 line-clamp-2">
                                    {book.title}
                                </h3>
                                {book.description && (
                                    <p className="text-sm text-slate-600 mb-3 line-clamp-2">
                                        {book.description}
                                    </p>
                                )}
                                <div className="flex items-center justify-between text-xs text-slate-500">
                                    <span>{book.pageCount || "?"} pages</span>
                                    <span>{formatFileSize(book.fileSize)}</span>
                                </div>
                                {book.classLevel && (
                                    <div className="mt-3">
                                        <span className="text-xs bg-slate-100 text-slate-700 px-2 py-1 rounded">
                                            Class {book.classLevel}
                                        </span>
                                    </div>
                                )}
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {/* Upload Modal */}
            {showUploadModal && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
                    <div className="bg-white rounded-xl shadow-2xl max-w-md w-full p-6">
                        <h2 className="text-xl font-bold text-slate-900 mb-4">Upload Book</h2>
                        <form onSubmit={handleUpload} className="space-y-4">
                            <div>
                                <label className="block text-sm font-medium text-slate-700 mb-2">
                                    Title *
                                </label>
                                <input
                                    type="text"
                                    value={uploadForm.title}
                                    onChange={(e) =>
                                        setUploadForm((prev) => ({ ...prev, title: e.target.value }))
                                    }
                                    className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                                    required
                                />
                            </div>

                            <div>
                                <label className="block text-sm font-medium text-slate-700 mb-2">
                                    Description
                                </label>
                                <textarea
                                    value={uploadForm.description}
                                    onChange={(e) =>
                                        setUploadForm((prev) => ({
                                            ...prev,
                                            description: e.target.value,
                                        }))
                                    }
                                    className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                                    rows={3}
                                />
                            </div>

                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-sm font-medium text-slate-700 mb-2">
                                        Category *
                                    </label>
                                    <select
                                        value={uploadForm.category}
                                        onChange={(e) =>
                                            setUploadForm((prev) => ({
                                                ...prev,
                                                category: e.target.value,
                                            }))
                                        }
                                        className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                                    >
                                        {CATEGORIES.map((cat) => (
                                            <option key={cat.value} value={cat.value}>
                                                {cat.label}
                                            </option>
                                        ))}
                                    </select>
                                </div>

                                <div>
                                    <label className="block text-sm font-medium text-slate-700 mb-2">
                                        Class Level
                                    </label>
                                    <select
                                        value={uploadForm.classLevel}
                                        onChange={(e) =>
                                            setUploadForm((prev) => ({
                                                ...prev,
                                                classLevel: e.target.value,
                                            }))
                                        }
                                        className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500"
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
                                <label className="block text-sm font-medium text-slate-700 mb-2">
                                    PDF File *
                                </label>
                                <input
                                    ref={fileInputRef}
                                    type="file"
                                    accept="application/pdf"
                                    onChange={handleFileChange}
                                    className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                                    required
                                />
                                {uploadForm.file && (
                                    <p className="mt-2 text-sm text-slate-600">
                                        Selected: {uploadForm.file.name}
                                    </p>
                                )}
                            </div>

                            <div className="flex gap-3 pt-4">
                                <button
                                    type="submit"
                                    disabled={uploading}
                                    className="flex-1 bg-blue-600 text-white py-2 rounded-lg hover:bg-blue-700 disabled:bg-slate-300 transition-colors"
                                >
                                    {uploading ? "Uploading..." : "Upload"}
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setShowUploadModal(false)}
                                    className="px-6 py-2 border border-slate-300 rounded-lg hover:bg-slate-50 transition-colors"
                                >
                                    Cancel
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
}
