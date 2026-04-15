"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import toast from "react-hot-toast";
import { formatDateTime } from "@/lib/utils";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";

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

const DASHBOARD_TIME_ZONE = "Asia/Kolkata";

function formatDayKey(date: Date) {
    const parts = new Intl.DateTimeFormat("en-CA", {
        timeZone: DASHBOARD_TIME_ZONE,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
    }).formatToParts(date);

    const year = parts.find((part) => part.type === "year")?.value || "0000";
    const month = parts.find((part) => part.type === "month")?.value || "00";
    const day = parts.find((part) => part.type === "day")?.value || "00";
    return `${year}-${month}-${day}`;
}

const QUICK_ACTIONS = [
    {
        title: "Slides Workspace",
        href: "/content-studio/slides",
        description: "Preview decks, tune slide themes, and export PDFs from saved extractor documents.",
    },
    {
        title: "Question Extractor",
        href: "/content-studio/extractor",
        description: "Convert raw PDFs into structured bilingual question workspaces.",
    },
    {
        title: "Media Studio",
        href: "/content-studio/media",
        description: "Generate institute-ready visuals and videos with brand context.",
    },
    {
        title: "Library Stack",
        href: "/books",
        description: "Manage books and references the workspace can reuse everywhere.",
    },
];

function buildDayPulse(docs: Document[]): DayPulse[] {
    const now = new Date();
    const days: DayPulse[] = [];
    const weekdayFormatter = new Intl.DateTimeFormat("en-IN", {
        weekday: "short",
        timeZone: DASHBOARD_TIME_ZONE,
    });

    for (let i = 6; i >= 0; i -= 1) {
        const day = new Date(now);
        day.setDate(now.getDate() - i);
        const iso = formatDayKey(day);

        days.push({
            iso,
            label: weekdayFormatter.format(day).slice(0, 2),
            count: 0,
        });
    }

    for (const doc of docs) {
        const iso = formatDayKey(new Date(doc.createdAt));
        const match = days.find((day) => day.iso === iso);
        if (match) match.count += 1;
    }

    return days;
}

export default function DashboardPage() {
    const [stats, setStats] = useState<Stats | null>(null);
    const [recentDocs, setRecentDocs] = useState<Document[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [loadError, setLoadError] = useState<string | null>(null);
    const [localTime, setLocalTime] = useState(() => new Date());
    const [isMounted, setIsMounted] = useState(false);
    const { data: session, status } = useSession();
    const router = useRouter();

    useEffect(() => {
        if (status === "authenticated" && session?.user?.role === "SYSTEM_ADMIN") {
            router.replace("/admin/dashboard");
        }
    }, [status, session, router]);

    useEffect(() => {
        setIsMounted(true);
    }, []);

    useEffect(() => {
        async function fetchData() {
            try {
                setLoadError(null);
                const [statsRes, docsRes] = await Promise.all([
                    fetch("/api/stats"),
                    fetch("/api/documents?minimal=true&limit=20"),
                ]);

                if (!statsRes.ok || !docsRes.ok) {
                    throw new Error("Unable to fetch dashboard data");
                }

                const statsData = await statsRes.json();
                const docsData = await docsRes.json();

                if (statsData?.error || docsData?.error) {
                    throw new Error("Dashboard data source unavailable");
                }

                setStats(statsData);
                setRecentDocs(docsData.documents || []);
            } catch (err) {
                console.error("Failed to fetch dashboard data:", err);
                setLoadError("Live dashboard data is temporarily unavailable.");
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

    const hasStats = Boolean(stats);
    const statsView = stats || { totalDocs: 0, todayDocs: 0 };

    const completionRate = useMemo(() => {
        if (!statsView.totalDocs) return 0;
        const ratio = (statsView.todayDocs / statsView.totalDocs) * 100;
        return Math.round(Math.min(100, ratio));
    }, [statsView]);

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
        `${statsView.totalDocs} total PDFs stored`,
        `${statsView.todayDocs} PDFs generated today`,
        `Peak day this week: ${peakPulse.label} (${peakPulse.count})`,
        "Use Ctrl/Cmd + K for instant commands",
        "Preview engine and exports are live",
    ];

    const weeklyTotal = useMemo(
        () => pulseData.reduce((sum, item) => sum + item.count, 0),
        [pulseData]
    );

    const placeholderPulseData = useMemo(
        () =>
            Array.from({ length: 7 }, (_, index) => ({
                iso: `placeholder-${index}`,
                label: "--",
                count: 0,
            })),
        []
    );

    const hydratedPulseData = isMounted ? pulseData : placeholderPulseData;

    const latestDocument = recentDocs[0];

    return (
        <div className="page-container">
            <section className="ticker-strip">
                {isLoading ? (
                    <div className="flex gap-2 overflow-hidden">
                        {Array.from({ length: 6 }).map((_, index) => (
                            <span key={index} className="ticker-chip">
                                <span className="skeleton skeleton-chip w-32" />
                            </span>
                        ))}
                    </div>
                ) : loadError ? (
                    <div className="flex gap-2 overflow-hidden">
                        <span className="ticker-chip">{loadError}</span>
                    </div>
                ) : (
                    <div className="ticker-track">
                        {[...tickerItems, ...tickerItems].map((item, index) => (
                            <span key={`${item}-${index}`} className="ticker-chip">
                                {item}
                            </span>
                        ))}
                    </div>
                )}
            </section>

            <section className="dashboard-hero surface-premium fade-in-up">
                <div className="dashboard-hero-copy">
                    <span className="eyebrow">Mission Control</span>
                    <h1 className="heading-xl mt-4">Nexora Workspace Command Deck</h1>
                    <p className="text-sm text-muted mt-3 max-w-2xl">
                        Launch extractor flows, monitor live production rhythm, and jump into the studio stack from one polished command surface.
                    </p>

                    <div className="dashboard-hero-actions">
                        <Link href="/content-studio/extractor" className="btn btn-primary">
                            New Studio Run
                        </Link>
                        <Link href="/content-studio" className="btn btn-secondary">
                            Open Institute Suite
                        </Link>
                        <button
                            type="button"
                            className="btn btn-ghost"
                            onClick={() => window.dispatchEvent(new CustomEvent("open-command-palette"))}
                        >
                            Open Command K
                        </button>
                    </div>

                    <div className="dashboard-quick-grid">
                        {QUICK_ACTIONS.map((action) => (
                            <Link key={action.href} href={action.href} className="dashboard-quick-card">
                                <span className="dashboard-quick-kicker">Workspace Tool</span>
                                <strong>{action.title}</strong>
                                <span>{action.description}</span>
                            </Link>
                        ))}
                    </div>
                </div>

                <div className="dashboard-hero-side">
                    <div className="dashboard-live-card">
                        <p className="dashboard-side-label">Live Ops Clock</p>
                        <p className="dashboard-live-time" suppressHydrationWarning>
                            {isMounted ? localTime.toLocaleTimeString("en-IN", {
                                hour: "2-digit",
                                minute: "2-digit",
                                second: "2-digit",
                            }) : "--:--:--"}
                        </p>
                        <p className="text-xs text-slate-500">
                            {isMounted ? localTime.toLocaleDateString("en-IN", {
                                weekday: "long",
                                day: "numeric",
                                month: "long",
                                year: "numeric",
                            }) : "Loading..."}
                        </p>
                    </div>

                    <div className="dashboard-mini-grid">
                        <article className="dashboard-mini-card">
                            <span className="dashboard-side-label">Today</span>
                            <strong>{isLoading ? "—" : statsView.todayDocs}</strong>
                            <p>Fresh outputs created in the last 24 hours.</p>
                        </article>
                        <article className="dashboard-mini-card">
                            <span className="dashboard-side-label">This Week</span>
                            <strong>{isLoading ? "—" : weeklyTotal}</strong>
                            <p>Generation volume captured by the 7-day pulse.</p>
                        </article>
                        <article className="dashboard-mini-card">
                            <span className="dashboard-side-label">Latest Drop</span>
                            <strong>{latestDocument ? latestDocument.subject || "Workspace file" : "No files yet"}</strong>
                            <p>{latestDocument ? formatDateTime(latestDocument.createdAt) : "Start a new extractor run to populate activity."}</p>
                        </article>
                    </div>
                </div>

                <div className="dashboard-hero-orb dashboard-hero-orb-a" />
                <div className="dashboard-hero-orb dashboard-hero-orb-b" />
            </section>

            <section className="card-grid mb-4">
                <article className="kpi-card surface-premium stagger-in">
                    <p className="kpi-label">Total Generated</p>
                    <p className="kpi-value">
                        {isLoading ? (
                            <span className="skeleton skeleton-text skeleton-kpi" />
                        ) : hasStats ? (
                            statsView.totalDocs
                        ) : (
                            "—"
                        )}
                    </p>
                    <p className="kpi-footnote">Documents available across workspace records</p>
                </article>

                <article className="kpi-card surface-premium stagger-in stagger-delay-1">
                    <p className="kpi-label">Generated Today</p>
                    <p className="kpi-value">
                        {isLoading ? (
                            <span className="skeleton skeleton-text skeleton-kpi" />
                        ) : hasStats ? (
                            statsView.todayDocs
                        ) : (
                            "—"
                        )}
                    </p>
                    <p className="kpi-footnote">New outputs created in the last 24 hours</p>
                </article>

                <article className="kpi-card surface-premium stagger-in stagger-delay-2">
                    <p className="kpi-label">Recent Documents</p>
                    <p className="kpi-value">
                        {isLoading ? (
                            <span className="skeleton skeleton-text skeleton-kpi" />
                        ) : (
                            recentDocs.length
                        )}
                    </p>
                    <p className="kpi-footnote">Loaded from document API</p>
                </article>

                <article className="kpi-card surface-premium stagger-in stagger-delay-3">
                    <p className="kpi-label">Peak Day</p>
                    <p className="kpi-value text-lg">
                        {isLoading ? <span className="skeleton skeleton-text skeleton-kpi" /> : peakPulse.label}
                    </p>
                    <p className="kpi-footnote">Highest generation day this week</p>
                </article>
            </section>

            <section className="widget-grid">
                <article className="widget-card surface-premium hover-lift stagger-in">
                    <p className="widget-title">Output Velocity</p>
                    <div className="widget-main">
                        {isLoading ? (
                            <>
                                <div className="skeleton skeleton-circle mx-auto" />
                                <div className="skeleton skeleton-text w-2/3 mx-auto mt-3" />
                            </>
                        ) : loadError ? (
                            <p className="text-xs text-slate-600 mt-3 text-center">
                                {loadError}
                            </p>
                        ) : (
                            <>
                                <div className="meter-ring" style={{ ["--meter" as any]: `${Math.max(completionRate, 2)}%` }}>
                                    <div className="meter-value">
                                        <strong>{completionRate}%</strong>
                                        <span>today/total ratio</span>
                                    </div>
                                </div>
                                <p className="text-xs text-slate-600 mt-3 text-center">
                                    {statsView.todayDocs > 0
                                        ? "Strong momentum: pipeline is actively producing new files."
                                        : "No output today yet. Trigger a new run from Institute Suite."}
                                </p>
                            </>
                        )}
                    </div>
                </article>

                <article className="widget-card surface-premium hover-lift stagger-in stagger-delay-1">
                    <p className="widget-title">7-Day Activity Pulse</p>
                    <div className="widget-main">
                        <div className="spark-bars">
                            {(isLoading ? placeholderPulseData : hydratedPulseData).map((item, index) => {
                                const barHeight = 10 + Math.round((item.count / maxPulseCount) * 90);
                                return (
                                    <div key={item.iso} className="spark-bar-wrap">
                                        <div
                                            className={`spark-bar ${isLoading ? "skeleton" : ""}`}
                                            style={{
                                                height: `${isLoading ? 20 + index * 8 : barHeight}px`,
                                                animationDelay: `${index * 0.05}s`,
                                            }}
                                        />
                                        <span className="spark-label">{item.label}</span>
                                    </div>
                                );
                            })}
                        </div>
                        <p className="text-xs text-slate-600 mt-3">
                            {isLoading ? (
                                <span className="skeleton skeleton-text w-56 inline-block" />
                            ) : loadError ? (
                                loadError
                            ) : (
                                <>
                                    Peak this week: <strong>{peakPulse.label}</strong> with <strong>{peakPulse.count}</strong> generated files.
                                </>
                            )}
                        </p>
                    </div>
                </article>

                <article className="widget-card surface-premium hover-lift stagger-in stagger-delay-2">
                    <p className="widget-title">Live Ops Deck</p>
                    <div className="widget-main">
                        <p className="text-2xl font-bold tracking-tight text-slate-900" suppressHydrationWarning>
                            {isMounted ? localTime.toLocaleTimeString("en-IN", {
                                hour: "2-digit",
                                minute: "2-digit",
                                second: "2-digit",
                            }) : "--:--:--"}
                        </p>
                        <p className="text-xs text-slate-500 mt-1">
                            {isMounted ? localTime.toLocaleDateString("en-IN", {
                                weekday: "long",
                                day: "numeric",
                                month: "long",
                                year: "numeric",
                            }) : "Loading..."}
                        </p>

                        <div className="insight-feed">
                            {isLoading
                                ? Array.from({ length: 3 }).map((_, index) => (
                                    <div key={index} className="insight-item">
                                        <div className="skeleton skeleton-text w-48" />
                                        <div className="skeleton skeleton-text w-32 mt-2" />
                                    </div>
                                ))
                                : loadError
                                    ? [<div key="error" className="insight-item">{loadError}</div>]
                                    : recentDocs.slice(0, 3).map((doc) => (
                                        <div key={doc.id} className="insight-item">
                                            <strong>{doc.title}</strong>
                                            <div className="text-slate-500 mt-1">{formatDateTime(doc.createdAt)}</div>
                                        </div>
                                    ))}
                            {!isLoading && recentDocs.length === 0 && (
                                <div className="insight-item">No recent documents yet.</div>
                            )}
                        </div>
                    </div>
                </article>
            </section>

        </div>
    );
}
