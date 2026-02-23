"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import toast from "react-hot-toast";
import { downloadBlobAsFile, formatDateTime } from "@/lib/utils";

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
                const [statsRes, docsRes] = await Promise.all([
                    fetch("/api/stats"),
                    fetch("/api/documents?minimal=true&limit=6"),
                ]);

                const statsData = await statsRes.json();
                const docsData = await docsRes.json();

                setStats(statsData);
                setRecentDocs(docsData.documents || []);
            } catch (err) {
                console.error("Failed to fetch dashboard data:", err);
                toast.error("Failed to load dashboard");
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
            toast.success("PDF downloaded successfully");
        } catch (error) {
            console.error("Error downloading PDF:", error);
            toast.error("Failed to download PDF");
        }
    };

    return (
        <div className="page-container">
            <header className="page-header fade-in-up">
                <div>
                    <span className="eyebrow">Operations</span>
                    <h1 className="heading-xl mt-3">NACC Document Workspace</h1>
                    <p className="text-sm text-muted mt-3 max-w-2xl">
                        Generate bilingual presentation PDFs, monitor activity, and manage your reusable assets from one SaaS-style control panel.
                    </p>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                    <Link href="/generate" className="btn btn-primary">
                        Create JSON PDF
                    </Link>
                    <Link href="/image-to-pdf" className="btn btn-secondary">
                        Extract from Image
                    </Link>
                    <Link href="/books" className="btn btn-ghost">
                        Open Library
                    </Link>
                </div>
            </header>

            <section className="card-grid mb-4">
                <article className="kpi-card">
                    <p className="kpi-label">Total Generated</p>
                    <p className="kpi-value">{stats.totalDocs}</p>
                    <p className="kpi-footnote">Documents available across workspace history</p>
                </article>

                <article className="kpi-card">
                    <p className="kpi-label">Generated Today</p>
                    <p className="kpi-value">{stats.todayDocs}</p>
                    <p className="kpi-footnote">New outputs created in the last 24 hours</p>
                </article>

                <article className="kpi-card">
                    <p className="kpi-label">Capture Mode</p>
                    <p className="kpi-value text-lg">Image to PDF</p>
                    <p className="kpi-footnote">Vision extraction with manual correction workflow</p>
                </article>

                <article className="kpi-card">
                    <p className="kpi-label">Library Mode</p>
                    <p className="kpi-value text-lg">Books Repository</p>
                    <p className="kpi-footnote">Upload searchable academic PDFs by category</p>
                </article>
            </section>

            <section className="surface p-4 md:p-5 fade-in-up">
                <div className="flex items-center justify-between gap-3 mb-4">
                    <div>
                        <h2 className="text-lg font-bold tracking-tight text-slate-900">Recent Activity</h2>
                        <p className="text-xs text-muted mt-1">Latest generated documents and quick actions</p>
                    </div>
                    <Link href="/history" className="btn btn-ghost text-xs">
                        View All
                    </Link>
                </div>

                {isLoading ? (
                    <div className="empty-state">
                        <div className="spinner mx-auto" />
                        <h3>Loading documents</h3>
                        <p className="text-sm">Fetching latest entries from your history.</p>
                    </div>
                ) : recentDocs.length === 0 ? (
                    <div className="empty-state">
                        <h3>No documents yet</h3>
                        <p className="text-sm mb-4">Start by generating your first PDF from JSON input.</p>
                        <Link href="/generate" className="btn btn-primary text-xs">
                            Generate First PDF
                        </Link>
                    </div>
                ) : (
                    <div className="table-shell">
                        <table className="table">
                            <thead>
                                <tr>
                                    <th>Document</th>
                                    <th>Subject</th>
                                    <th>Created</th>
                                    <th className="text-right">Actions</th>
                                </tr>
                            </thead>
                            <tbody>
                                {recentDocs.map((doc) => (
                                    <tr key={doc.id}>
                                        <td>
                                            <p className="font-semibold text-slate-900">{doc.title}</p>
                                        </td>
                                        <td>
                                            <span className="status-badge">
                                                <span className="status-dot" />
                                                {doc.subject}
                                            </span>
                                        </td>
                                        <td className="text-slate-600">{formatDateTime(doc.createdAt)}</td>
                                        <td>
                                            <div className="flex justify-end flex-wrap gap-2">
                                                <Link href={`/generate?load=${doc.id}`} className="btn btn-secondary text-xs">
                                                    Edit
                                                </Link>
                                                <button
                                                    onClick={() => handleRegenerate(doc.id, doc.title)}
                                                    className="btn btn-primary text-xs"
                                                >
                                                    Download
                                                </button>
                                            </div>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </section>
        </div>
    );
}
