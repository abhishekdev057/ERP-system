"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { formatDateTime, downloadBlobAsFile } from "@/lib/utils";
import toast from "react-hot-toast";

interface Document {
    id: string;
    title: string;
    subject: string;
    createdAt: string;
}

interface Stats {
    totalDocs: number;
    todayDocs: number;
}

export default function DashboardPage() {
    const [stats, setStats] = useState<Stats>({ totalDocs: 0, todayDocs: 0 });
    const [recentDocs, setRecentDocs] = useState<Document[]>([]);
    const [isLoading, setIsLoading] = useState(true);

    useEffect(() => {
        async function fetchData() {
            try {
                const statsRes = await fetch("/api/stats");
                const statsData = await statsRes.json();
                setStats(statsData);

                const docsRes = await fetch("/api/documents?minimal=true&limit=5");
                const docsData = await docsRes.json();
                setRecentDocs(docsData.documents || []);
            } catch (err) {
                console.error("Failed to fetch dashboard data:", err);
            } finally {
                setIsLoading(false);
            }
        }
        fetchData();
    }, []);

    const handleRegenerate = async (id: string, title: string) => {
        try {
            const response = await fetch(`/api/documents/${id}`, { method: "POST" });
            if (!response.ok) throw new Error("Failed to generate PDF");

            const blob = await response.blob();
            downloadBlobAsFile(blob, `${title}.pdf`);
            toast.success("PDF downloaded successfully!");
        } catch (error) {
            console.error("Error downloading PDF:", error);
            toast.error("Failed to download PDF");
        }
    };

    return (
        <div className="max-w-7xl mx-auto px-5 py-8">
            {/* Dashboard Header */}
            <header className="mb-8 animate-fade-in-up">
                <div className="flex flex-col md:flex-row md:items-end justify-between gap-5">
                    <div>
                        <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-xl bg-white/80 border border-white shadow-sm mb-4">
                            <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
                            <span className="text-[10px] font-bold text-slate-600 uppercase tracking-widest">
                                NACC Control Center
                            </span>
                        </div>
                        <h1 className="text-4xl md:text-5xl font-black text-slate-800 leading-tight mb-2">
                            Welcome to <span className="gradient-text">Dashboard</span>
                        </h1>
                        <p className="text-sm text-slate-500 max-w-xl">
                            Monitor your generated PDFs, manage history, and create new presentation-style documents for NACC Institute.
                        </p>
                    </div>

                    <div className="flex gap-3">
                        <Link href="/generate" className="glow-btn px-6 py-3 text-sm group">
                            <div className="w-6 h-6 rounded-lg bg-white/40 flex items-center justify-center group-hover:bg-white/60 transition-colors">
                                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                                    <line x1="12" y1="5" x2="12" y2="19"></line>
                                    <line x1="5" y1="12" x2="19" y2="12"></line>
                                </svg>
                            </div>
                            Create New PDF
                        </Link>
                        <Link href="/image-to-pdf" className="px-6 py-3 text-sm font-semibold text-slate-700 bg-white border border-slate-200 rounded-2xl shadow-sm hover:border-indigo-300 hover:text-indigo-600 transition-all flex items-center gap-2">
                            <div className="w-6 h-6 rounded-lg bg-indigo-50 text-indigo-500 flex items-center justify-center">
                                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2" /><circle cx="8.5" cy="8.5" r="1.5" /><polyline points="21 15 16 10 5 21" /></svg>
                            </div>
                            Image to PDF
                        </Link>
                    </div>
                </div>
            </header>

            {/* Stats Overview */}
            <section className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
                <div className="glass-card p-5 animate-fade-in-up animate-delay-100">
                    <div className="flex items-start justify-between mb-3">
                        <div>
                            <p className="text-slate-500 text-[10px] font-bold uppercase tracking-widest mb-1.5">Total Generated</p>
                            <h2 className="stat-number text-3xl">{stats.totalDocs}</h2>
                        </div>
                        <div className="icon-circle w-9 h-9">
                            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line><polyline points="10 9 9 9 8 9"></polyline></svg>
                        </div>
                    </div>
                    <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
                        <div className="h-full w-3/4 bg-gradient-to-r from-amber-300 to-amber-500 rounded-full" />
                    </div>
                </div>

                <div className="glass-card p-5 animate-fade-in-up animate-delay-200">
                    <div className="flex items-start justify-between mb-3">
                        <div>
                            <p className="text-slate-500 text-[10px] font-bold uppercase tracking-widest mb-1.5">Generated Today</p>
                            <h2 className="stat-number text-3xl">{stats.todayDocs}</h2>
                        </div>
                        <div className="icon-circle-cyan w-9 h-9">
                            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>
                        </div>
                    </div>
                    <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
                        <div className="h-full w-1/2 bg-gradient-to-r from-cyan-300 to-cyan-500 rounded-full" />
                    </div>
                </div>

                <div className="glass-card p-5 animate-fade-in-up animate-delay-250 cursor-pointer hover:shadow-lg transition-shadow" onClick={() => window.location.href = "/books"}>
                    <div className="flex items-start justify-between mb-3">
                        <div>
                            <p className="text-slate-500 text-[10px] font-bold uppercase tracking-widest mb-1.5">Books Library</p>
                            <Link href="/books" className="text-base font-bold text-slate-800 hover:text-blue-600 transition-colors">
                                Browse Books
                            </Link>
                        </div>
                        <div className="icon-circle w-9 h-9 bg-gradient-to-br from-blue-100 to-indigo-100">
                            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-blue-600"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"></path><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"></path></svg>
                        </div>
                    </div>
                    <p className="text-xs text-slate-500">Upload & search educational PDFs</p>
                </div>

                <div className="glass-card p-5 animate-fade-in-up animate-delay-300">
                    <div className="flex items-start justify-between mb-3">
                        <div>
                            <p className="text-slate-500 text-[10px] font-bold uppercase tracking-widest mb-1.5">Quick Shortcut</p>
                            <Link href="/history" className="text-base font-bold text-slate-800 hover:text-amber-600 transition-colors">
                                View All History
                            </Link>
                        </div>
                        <div className="icon-circle-violet w-9 h-9">
                            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14"></path><path d="m12 5 7 7-7 7"></path></svg>
                        </div>
                    </div>
                    <p className="text-xs text-slate-500">Access all your previously generated documents</p>
                </div>
            </section>

            {/* Recent Documents */}
            <section className="glass-card overflow-hidden animate-fade-in-up">
                <div className="p-4 border-b border-slate-100 flex items-center justify-between">
                    <h2 className="text-lg font-bold text-slate-800">
                        Recent <span className="gradient-text-cyan">Activity</span>
                    </h2>
                    <Link href="/history" className="text-xs text-slate-500 hover:text-slate-800 transition-colors flex items-center gap-1">
                        View Full History
                        <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14"></path><path d="m12 5 7 7-7 7"></path></svg>
                    </Link>
                </div>

                <div className="overflow-x-auto">
                    {isLoading ? (
                        <div className="p-14 text-center">
                            <div className="spinner mx-auto mb-3" />
                            <p className="text-slate-400 text-xs">Loading recent documents...</p>
                        </div>
                    ) : recentDocs.length > 0 ? (
                        <table className="w-full">
                            <thead>
                                <tr className="bg-slate-50/50">
                                    <th className="px-4 py-3 text-left text-[9px] font-black text-slate-500 uppercase tracking-widest">Document</th>
                                    <th className="px-4 py-3 text-left text-[9px] font-black text-slate-500 uppercase tracking-widest hidden md:table-cell">Subject</th>
                                    <th className="px-4 py-3 text-left text-[9px] font-black text-slate-500 uppercase tracking-widest hidden sm:table-cell">Generated On</th>
                                    <th className="px-4 py-3 text-right text-[9px] font-black text-slate-500 uppercase tracking-widest">Actions</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-50">
                                {recentDocs.map((doc, index) => (
                                    <tr key={doc.id} className="hover:bg-amber-50/50 transition-colors group animate-fade-in-up" style={{ animationDelay: `${index * 0.05}s` }}>
                                        <td className="px-4 py-3.5">
                                            <div className="flex items-center gap-2.5">
                                                <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-amber-200 to-orange-200 flex items-center justify-center text-amber-800 text-[10px] font-bold shadow-sm">
                                                    PDF
                                                </div>
                                                <p className="text-slate-800 font-medium text-xs group-hover:text-amber-700 transition-colors">
                                                    {doc.title}
                                                </p>
                                            </div>
                                        </td>
                                        <td className="px-4 py-3.5 hidden md:table-cell">
                                            <span className="badge badge-gold text-[10px] py-1">
                                                {doc.subject}
                                            </span>
                                        </td>
                                        <td className="px-4 py-3.5 hidden sm:table-cell text-xs text-slate-500">
                                            {formatDateTime(doc.createdAt)}
                                        </td>
                                        <td className="px-4 py-3.5 text-right">
                                            <div className="flex items-center justify-end gap-1.5">
                                                <Link
                                                    href={`/generate?load=${doc.id}`}
                                                    className="action-btn action-btn-primary w-8 h-8"
                                                    title="Edit & Regenerate"
                                                >
                                                    <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"></path></svg>
                                                </Link>
                                                <button
                                                    onClick={() => handleRegenerate(doc.id, doc.title)}
                                                    className="action-btn action-btn-secondary w-8 h-8"
                                                    title="Download"
                                                >
                                                    <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
                                                </button>
                                            </div>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    ) : (
                        <div className="p-14 text-center">
                            <div className="empty-state-illustration w-20 h-20">
                                <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#8b5cf6" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"></path><polyline points="14 2 14 8 20 8"></polyline></svg>
                            </div>
                            <h3 className="text-base font-bold text-slate-800 mb-1.5">No Documents Found</h3>
                            <p className="text-xs text-slate-500 mb-5 px-8">You haven't generated any PDFs yet. Start by uploading a JSON file.</p>
                            <Link href="/generate" className="glow-btn px-5 py-2.5 text-xs">
                                Get Started
                            </Link>
                        </div>
                    )}
                </div>
            </section>
        </div>
    );
}
