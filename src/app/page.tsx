"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
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

interface DayPulse {
    iso: string;
    label: string;
    count: number;
}

function buildDayPulse(docs: Document[]): DayPulse[] {
    const now = new Date();
    const days: DayPulse[] = [];

    for (let i = 6; i >= 0; i -= 1) {
        const day = new Date(now);
        day.setDate(now.getDate() - i);
        const iso = day.toISOString().slice(0, 10);

        days.push({
            iso,
            label: day.toLocaleDateString("en-IN", { weekday: "short" }).slice(0, 2),
            count: 0,
        });
    }

    for (const doc of docs) {
        const iso = new Date(doc.createdAt).toISOString().slice(0, 10);
        const match = days.find((day) => day.iso === iso);
        if (match) match.count += 1;
    }

    return days;
}

export default function DashboardPage() {
    const [stats, setStats] = useState<Stats>({ totalDocs: 0, todayDocs: 0 });
    const [recentDocs, setRecentDocs] = useState<Document[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [localTime, setLocalTime] = useState(() => new Date());

    useEffect(() => {
        async function fetchData() {
            try {
                const [statsRes, docsRes] = await Promise.all([
                    fetch("/api/stats"),
                    fetch("/api/documents?minimal=true&limit=20"),
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

    useEffect(() => {
        const timer = window.setInterval(() => setLocalTime(new Date()), 1000);
        return () => window.clearInterval(timer);
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

    const completionRate = useMemo(() => {
        if (!stats.totalDocs) return 0;
        const ratio = (stats.todayDocs / stats.totalDocs) * 100;
        return Math.round(Math.min(100, ratio));
    }, [stats]);

    const pulseData = useMemo(() => buildDayPulse(recentDocs), [recentDocs]);

    const peakPulse = useMemo(() => {
        if (!pulseData.length) return { label: "--", count: 0 };
        return pulseData.reduce((peak, item) => (item.count > peak.count ? item : peak), pulseData[0]);
    }, [pulseData]);

    const maxPulseCount = useMemo(() => {
        const max = Math.max(...pulseData.map((item) => item.count), 1);
        return max;
    }, [pulseData]);

    const tickerItems = [
        `${stats.totalDocs} total PDFs stored`,
        `${stats.todayDocs} PDFs generated today`,
        `Peak day this week: ${peakPulse.label} (${peakPulse.count})`,
        "Use Ctrl/Cmd + K for instant commands",
        "Preview engine and exports are live",
    ];

    return (
        <div className="page-container">
            <section className="ticker-strip">
                <div className="ticker-track">
                    {[...tickerItems, ...tickerItems].map((item, index) => (
                        <span key={`${item}-${index}`} className="ticker-chip">
                            {item}
                        </span>
                    ))}
                </div>
            </section>

            <header className="page-header fade-in-up">
                <div>
                    <span className="eyebrow">Mission Control</span>
                    <h1 className="heading-xl mt-3">NACC Document Workspace</h1>
                    <p className="text-sm text-muted mt-3 max-w-2xl">
                        Generate bilingual presentation PDFs, monitor production pulse, and execute workflows fast with command palette shortcuts.
                    </p>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                    <Link href="/generate" className="btn btn-primary">
                        Create JSON PDF
                    </Link>
                    <Link href="/image-to-pdf" className="btn btn-secondary">
                        Extract from Image
                    </Link>
                    <button
                        type="button"
                        className="btn btn-ghost"
                        onClick={() => window.dispatchEvent(new CustomEvent("open-command-palette"))}
                    >
                        Open Command K
                    </button>
                </div>
            </header>

            <section className="card-grid mb-4">
                <article className="kpi-card surface-premium stagger-in">
                    <p className="kpi-label">Total Generated</p>
                    <p className="kpi-value">{stats.totalDocs}</p>
                    <p className="kpi-footnote">Documents available across workspace history</p>
                </article>

                <article className="kpi-card surface-premium stagger-in stagger-delay-1">
                    <p className="kpi-label">Generated Today</p>
                    <p className="kpi-value">{stats.todayDocs}</p>
                    <p className="kpi-footnote">New outputs created in the last 24 hours</p>
                </article>

                <article className="kpi-card surface-premium stagger-in stagger-delay-2">
                    <p className="kpi-label">Capture Mode</p>
                    <p className="kpi-value text-lg">Image to PDF</p>
                    <p className="kpi-footnote">Vision extraction with manual correction workflow</p>
                </article>

                <article className="kpi-card surface-premium stagger-in stagger-delay-3">
                    <p className="kpi-label">Library Mode</p>
                    <p className="kpi-value text-lg">Books Repository</p>
                    <p className="kpi-footnote">Upload searchable academic PDFs by category</p>
                </article>
            </section>

            <section className="widget-grid">
                <article className="widget-card surface-premium hover-lift stagger-in">
                    <p className="widget-title">Output Velocity</p>
                    <div className="widget-main">
                        <div className="meter-ring" style={{ ["--meter" as any]: `${Math.max(completionRate, 2)}%` }}>
                            <div className="meter-value">
                                <strong>{completionRate}%</strong>
                                <span>today/total ratio</span>
                            </div>
                        </div>
                        <p className="text-xs text-slate-600 mt-3 text-center">
                            {stats.todayDocs > 0
                                ? "Strong momentum: pipeline is actively producing new files."
                                : "No output today yet. Trigger a new run from JSON or image workflow."}
                        </p>
                    </div>
                </article>

                <article className="widget-card surface-premium hover-lift stagger-in stagger-delay-1">
                    <p className="widget-title">7-Day Activity Pulse</p>
                    <div className="widget-main">
                        <div className="spark-bars">
                            {pulseData.map((item, index) => {
                                const barHeight = 10 + Math.round((item.count / maxPulseCount) * 90);
                                return (
                                    <div key={item.iso} className="spark-bar-wrap">
                                        <div
                                            className="spark-bar"
                                            style={{
                                                height: `${barHeight}px`,
                                                animationDelay: `${index * 0.05}s`,
                                            }}
                                        />
                                        <span className="spark-label">{item.label}</span>
                                    </div>
                                );
                            })}
                        </div>
                        <p className="text-xs text-slate-600 mt-3">
                            Peak this week: <strong>{peakPulse.label}</strong> with <strong>{peakPulse.count}</strong> generated files.
                        </p>
                    </div>
                </article>

                <article className="widget-card surface-premium hover-lift stagger-in stagger-delay-2">
                    <p className="widget-title">Live Ops Deck</p>
                    <div className="widget-main">
                        <p className="text-2xl font-bold tracking-tight text-slate-900">
                            {localTime.toLocaleTimeString("en-IN", {
                                hour: "2-digit",
                                minute: "2-digit",
                                second: "2-digit",
                            })}
                        </p>
                        <p className="text-xs text-slate-500 mt-1">
                            {localTime.toLocaleDateString("en-IN", {
                                weekday: "long",
                                day: "numeric",
                                month: "long",
                                year: "numeric",
                            })}
                        </p>

                        <div className="insight-feed">
                            {recentDocs.slice(0, 3).map((doc) => (
                                <div key={doc.id} className="insight-item">
                                    <strong>{doc.title}</strong>
                                    <div className="text-slate-500 mt-1">{formatDateTime(doc.createdAt)}</div>
                                </div>
                            ))}
                            {recentDocs.length === 0 && <div className="insight-item">No recent documents yet.</div>}
                        </div>
                    </div>
                </article>
            </section>

            <section className="surface p-4 md:p-5 fade-in-up hover-lift">
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
                                {recentDocs.slice(0, 8).map((doc) => (
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
