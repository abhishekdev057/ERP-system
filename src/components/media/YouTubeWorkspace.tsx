"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { useSession } from "next-auth/react";
import {
    Activity,
    ArrowUpRight,
    BarChart3,
    CirclePlay,
    Command,
    Gauge,
    MessagesSquare,
    RadioTower,
    RefreshCcw,
    Sparkles,
    TrendingUp,
    Vote,
    Zap,
} from "lucide-react";
import toast from "react-hot-toast";
import {
    buildAllBroadcasts,
    formatDateTime,
    formatNumberCompact,
    formatPercent,
    statusTone,
    usePageVisibility,
    YouTubeDashboard,
} from "@/components/media/youtube/shared";

const DASHBOARD_REFRESH_MS = 60000;

function statCard(label: string, value: string, meta: string, tone: string) {
    return (
        <div className={`relative overflow-hidden rounded-[28px] border p-5 shadow-[0_30px_60px_rgba(15,23,42,0.08)] ${tone}`}>
            <div className="absolute right-4 top-4 h-16 w-16 rounded-full bg-white/40 blur-2xl" />
            <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-slate-500">{label}</p>
            <p className="mt-4 text-3xl font-semibold text-slate-950">{value}</p>
            <p className="mt-2 text-sm text-slate-600">{meta}</p>
        </div>
    );
}

export function YouTubeWorkspace() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const { data: session } = useSession();
    const role = (session?.user as any)?.role || "MEMBER";
    const allowedTools = Array.isArray((session?.user as any)?.allowedTools)
        ? ((session?.user as any)?.allowedTools as string[])
        : [];

    const hasAccess =
        role === "SYSTEM_ADMIN" ||
        role === "ORG_ADMIN" ||
        allowedTools.includes("media-studio") ||
        allowedTools.includes("pdf-to-pdf");

    const [dashboard, setDashboard] = useState<YouTubeDashboard | null>(null);
    const [loading, setLoading] = useState(false);
    const [action, setAction] = useState<"connect" | "disconnect" | null>(null);
    const pageVisible = usePageVisibility();

    const allBroadcasts = useMemo(() => buildAllBroadcasts(dashboard), [dashboard]);
    const spotlightBroadcast = allBroadcasts[0] || null;
    const quotaBlocked = Boolean(
        dashboard?.quota.exhausted &&
        dashboard?.quota.nextResetAt &&
        new Date(dashboard.quota.nextResetAt).getTime() > Date.now()
    );

    const loadDashboard = async (quiet = false) => {
        if (!quiet) setLoading(true);
        try {
            const response = await fetch("/api/youtube/dashboard", { cache: "no-store" });
            const data = await response.json().catch(() => ({}));
            if (!response.ok) {
                throw new Error(data.error || "Failed to load YouTube dashboard.");
            }
            setDashboard(data as YouTubeDashboard);
        } catch (error: any) {
            console.error(error);
            if (!quiet) {
                toast.error(error.message || "Failed to load YouTube dashboard.");
            }
        } finally {
            if (!quiet) setLoading(false);
        }
    };

    const handleConnectYouTube = (mode: "connect" | "poll" = "connect") => {
        setAction("connect");
        window.location.href = `/api/youtube/connect?returnTo=${encodeURIComponent("/content-studio/youtube")}&mode=${mode}`;
    };

    const handleDisconnectYouTube = async () => {
        setAction("disconnect");
        try {
            const response = await fetch("/api/youtube/connection", { method: "DELETE" });
            const data = await response.json().catch(() => ({}));
            if (!response.ok) {
                throw new Error(data.error || "Failed to disconnect YouTube.");
            }
            setDashboard({
                connected: false,
                canManageLiveChat: false,
                uploads: [],
                liveBroadcasts: { active: [], upcoming: [], completed: [] },
                analytics: {
                    activeBroadcastCount: 0,
                    upcomingBroadcastCount: 0,
                    completedBroadcastCount: 0,
                    uploadsLoadedCount: 0,
                    activePollCount: 0,
                    liveViewersNow: 0,
                    recentUploadViews: 0,
                    recentUploadLikes: 0,
                    recentUploadComments: 0,
                },
                quota: {
                    estimated: true,
                    dailyLimit: 10000,
                    usedUnits: 0,
                    remainingUnits: 10000,
                    usagePercent: 0,
                    exhausted: false,
                    totalCalls: 0,
                    dayKey: "",
                    timezone: "America/Los_Angeles",
                    nextResetAt: "",
                    topConsumers: [],
                    expensiveActions: [],
                    warnings: [],
                },
            });
            toast.success("YouTube channel disconnected.");
        } catch (error: any) {
            console.error(error);
            toast.error(error.message || "Failed to disconnect YouTube.");
        } finally {
            setAction(null);
        }
    };

    useEffect(() => {
        if (!hasAccess) return;
        void loadDashboard();
    }, [hasAccess]);

    useEffect(() => {
        if (!hasAccess) return;
        if (!pageVisible) return;
        if (quotaBlocked) return;
        const timer = window.setInterval(() => {
            void loadDashboard(true);
        }, DASHBOARD_REFRESH_MS);
        return () => window.clearInterval(timer);
    }, [hasAccess, pageVisible, quotaBlocked]);

    useEffect(() => {
        const youtubeStatus = searchParams.get("youtube");
        const youtubeMessage = searchParams.get("youtubeMessage");
        if (!youtubeStatus) return;

        if (youtubeStatus === "connected") {
            toast.success("YouTube channel connected successfully.");
        } else if (youtubeStatus === "error") {
            toast.error(youtubeMessage || "YouTube connection failed.");
        }

        setAction(null);
        void loadDashboard(true);
        router.replace("/content-studio/youtube");
    }, [router, searchParams]);

    if (!hasAccess) {
        return (
            <div className="surface p-10 text-center">
                <h2 className="heading-xl">YouTube Workspace Access Required</h2>
                <p className="mt-2 text-sm text-slate-500">
                    Ask your workspace admin to grant `media-studio` or `pdf-to-pdf` access.
                </p>
            </div>
        );
    }

    const analytics = dashboard?.analytics || {
        activeBroadcastCount: 0,
        upcomingBroadcastCount: 0,
        completedBroadcastCount: 0,
        uploadsLoadedCount: 0,
        activePollCount: 0,
        liveViewersNow: 0,
        recentUploadViews: 0,
        recentUploadLikes: 0,
        recentUploadComments: 0,
    };
    const quota = dashboard?.quota || {
        estimated: true,
        dailyLimit: 10000,
        usedUnits: 0,
        remainingUnits: 10000,
        usagePercent: 0,
        exhausted: false,
        totalCalls: 0,
        dayKey: "",
        timezone: "America/Los_Angeles",
        nextResetAt: "",
        topConsumers: [],
        expensiveActions: [],
        warnings: [],
    };

    return (
        <section className="space-y-6">
            <div className="relative overflow-hidden rounded-[34px] border border-red-100 bg-[linear-gradient(135deg,#fff8f7_0%,#fff_45%,#f6fbff_100%)] p-6 shadow-[0_40px_90px_rgba(15,23,42,0.08)]">
                <div className="absolute inset-y-0 right-0 hidden w-[34%] lg:block">
                    <div className="absolute right-10 top-10 h-40 w-40 rounded-[32px] border border-white/60 bg-[linear-gradient(180deg,rgba(255,255,255,0.82),rgba(255,223,225,0.5))] shadow-[0_30px_60px_rgba(239,68,68,0.14)] [transform:rotate(-10deg)]" />
                    <div className="absolute right-24 top-24 h-44 w-44 rounded-[36px] border border-sky-100 bg-[linear-gradient(180deg,rgba(255,255,255,0.82),rgba(219,234,254,0.72))] shadow-[0_30px_60px_rgba(59,130,246,0.16)] [transform:rotate(8deg)]" />
                    <div className="absolute bottom-10 right-12 h-24 w-56 rounded-[26px] border border-slate-200 bg-slate-950 px-5 py-4 text-white shadow-[0_40px_80px_rgba(15,23,42,0.24)]">
                        <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-slate-400">Realtime Pulse</p>
                        <div className="mt-3 flex items-end justify-between gap-3">
                            <div>
                                <p className="text-3xl font-semibold">{formatNumberCompact(analytics.liveViewersNow)}</p>
                                <p className="text-xs text-slate-400">live viewers now</p>
                            </div>
                            <div className="grid grid-cols-3 gap-2">
                                {[analytics.activeBroadcastCount, analytics.activePollCount, analytics.recentUploadComments].map((value, index) => (
                                    <div key={index} className="h-10 w-10 rounded-2xl bg-white/10" />
                                ))}
                            </div>
                        </div>
                    </div>
                </div>

                <div className="relative z-10 grid gap-6 xl:grid-cols-[1.35fr,0.9fr]">
                    <div className="space-y-5">
                        <div className="inline-flex items-center gap-2 rounded-full border border-red-200 bg-white/80 px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.28em] text-red-600">
                            <RadioTower className="h-4 w-4" />
                            YouTube Command Center
                        </div>
                        <div className="max-w-3xl">
                            <h2 className="text-4xl font-semibold tracking-tight text-slate-950 md:text-5xl">
                                Run channel growth, live polls, comments, and institute voice from one deck.
                            </h2>
                            <p className="mt-4 max-w-2xl text-base leading-7 text-slate-600">
                                This workspace now keeps your live broadcasts, poll operations, comment response workflow,
                                and upload performance in one organized control surface.
                            </p>
                        </div>

                        <div className="flex flex-wrap gap-3">
                            <Link href="/content-studio/youtube" className="btn btn-primary text-sm">
                                Overview
                            </Link>
                            <Link href="/content-studio/youtube/polls" className="btn btn-secondary text-sm">
                                Poll Command
                            </Link>
                            <Link href="/content-studio/youtube/comments" className="btn btn-ghost text-sm">
                                Comment Desk
                            </Link>
                            <button
                                type="button"
                                onClick={() => void loadDashboard()}
                                disabled={loading}
                                className="btn btn-ghost text-sm"
                            >
                                {loading ? "Refreshing..." : "Refresh"}
                            </button>
                        </div>

                        <div className="flex flex-wrap gap-3 text-xs text-slate-600">
                            <span className="tool-chip bg-white/90">Realtime dashboard refresh</span>
                            <span className="tool-chip bg-white/90">Dedicated poll queue</span>
                            <span className="tool-chip bg-white/90">AI replies with institute context</span>
                            <span className="tool-chip bg-white/90">Quota-aware refresh guardrails</span>
                        </div>
                    </div>

                    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-1">
                        <div className="rounded-[28px] border border-slate-200 bg-white/85 p-5 shadow-[0_24px_60px_rgba(15,23,42,0.08)]">
                            <div className="flex items-start gap-4">
                                {dashboard?.channel?.thumbnailUrl ? (
                                    <img
                                        src={dashboard.channel.thumbnailUrl}
                                        alt={dashboard.channel.title}
                                        className="h-16 w-16 rounded-2xl border border-slate-200 object-cover"
                                    />
                                ) : (
                                    <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-red-100 text-red-700">
                                        <CirclePlay className="h-7 w-7" />
                                    </div>
                                )}
                                <div className="min-w-0 flex-1">
                                    <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-slate-500">Connected Channel</p>
                                    <p className="mt-2 truncate text-lg font-semibold text-slate-950">
                                        {dashboard?.channel?.title || "Connect your YouTube channel"}
                                    </p>
                                    {dashboard?.channel?.customUrl && (
                                        <p className="mt-1 truncate text-sm text-slate-500">@{dashboard.channel.customUrl}</p>
                                    )}
                                </div>
                            </div>

                            <div className="mt-4 flex flex-wrap gap-2">
                                {dashboard?.channel?.subscriberCount && (
                                    <span className="tool-chip">{dashboard.channel.subscriberCount} subscribers</span>
                                )}
                                {dashboard?.channel?.videoCount && (
                                    <span className="tool-chip">{dashboard.channel.videoCount} videos</span>
                                )}
                                {dashboard?.channel?.viewCount && (
                                    <span className="tool-chip">{dashboard.channel.viewCount} views</span>
                                )}
                            </div>

                            <div className="mt-5 flex flex-wrap gap-2">
                                {dashboard?.connected ? (
                                    <>
                                        <button
                                            type="button"
                                            onClick={() => handleConnectYouTube("connect")}
                                            disabled={action !== null}
                                            className="btn btn-primary text-xs"
                                        >
                                            {dashboard.needsReconnect || action === "connect" ? "Reconnect YouTube" : "Switch Channel"}
                                        </button>
                                        {!dashboard.canManageLiveChat && (
                                            <button
                                                type="button"
                                                onClick={() => handleConnectYouTube("poll")}
                                                disabled={action !== null}
                                                className="btn btn-secondary text-xs"
                                            >
                                                Enable Poll + Replies
                                            </button>
                                        )}
                                        <button
                                            type="button"
                                            onClick={handleDisconnectYouTube}
                                            disabled={action !== null}
                                            className="btn btn-ghost text-xs"
                                        >
                                            {action === "disconnect" ? "Disconnecting..." : "Disconnect"}
                                        </button>
                                    </>
                                ) : (
                                    <button
                                        type="button"
                                        onClick={() => handleConnectYouTube("connect")}
                                        disabled={action !== null}
                                        className="btn btn-primary text-xs"
                                    >
                                        {action === "connect" ? "Redirecting..." : "Connect YouTube"}
                                    </button>
                                )}
                            </div>
                            {dashboard?.warning && (
                                <p className="mt-4 text-xs text-amber-700">{dashboard.warning}</p>
                            )}
                        </div>

                        <div className="rounded-[28px] border border-slate-200 bg-[linear-gradient(160deg,#0f172a,#1e293b)] p-5 text-white shadow-[0_30px_70px_rgba(15,23,42,0.28)]">
                            <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.28em] text-sky-200">
                                <Sparkles className="h-4 w-4" />
                                Ops Stack
                            </div>
                            <div className="mt-5 grid grid-cols-3 gap-3">
                                {[
                                    { label: "Live", value: analytics.activeBroadcastCount, icon: RadioTower },
                                    { label: "Polls", value: analytics.activePollCount, icon: Vote },
                                    { label: "Replies", value: analytics.recentUploadComments, icon: MessagesSquare },
                                ].map((item) => (
                                    <div key={item.label} className="rounded-2xl border border-white/10 bg-white/5 p-3">
                                        <item.icon className="h-4 w-4 text-sky-200" />
                                        <p className="mt-3 text-2xl font-semibold">{formatNumberCompact(item.value)}</p>
                                        <p className="mt-1 text-[11px] uppercase tracking-[0.22em] text-slate-300">{item.label}</p>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                {statCard("Live viewers", formatNumberCompact(analytics.liveViewersNow), "Concurrent viewers across active live sessions.", "border-red-100 bg-[linear-gradient(160deg,#fff5f5,#ffffff)]")}
                {statCard("Recent upload views", formatNumberCompact(analytics.recentUploadViews), "Combined views from the recent upload stack loaded here.", "border-blue-100 bg-[linear-gradient(160deg,#eff6ff,#ffffff)]")}
                {statCard("Upload likes", formatNumberCompact(analytics.recentUploadLikes), "Quick sentiment signal from the latest content window.", "border-violet-100 bg-[linear-gradient(160deg,#f5f3ff,#ffffff)]")}
                {statCard("Comment load", formatNumberCompact(analytics.recentUploadComments), "Replies and engagement opportunities currently visible.", "border-emerald-100 bg-[linear-gradient(160deg,#ecfdf5,#ffffff)]")}
            </div>

            <div className="grid gap-5 xl:grid-cols-[1.05fr,0.95fr]">
                <article className="rounded-[30px] border border-amber-100 bg-[linear-gradient(145deg,#fffdf7,#ffffff,#fff7ed)] p-6 shadow-[0_24px_60px_rgba(15,23,42,0.08)]">
                    <div className="flex flex-wrap items-start justify-between gap-4">
                        <div>
                            <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-slate-500">Quota Watch</p>
                            <h3 className="mt-2 text-2xl font-semibold text-slate-950">App-tracked daily quota estimate</h3>
                            <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">
                                This is our workspace estimate of the shared YouTube project quota used today. It helps us stay disciplined during the 10,000-unit trial budget.
                            </p>
                        </div>
                        <div className="rounded-[24px] border border-slate-200 bg-white/90 px-4 py-3 text-right shadow-[0_16px_36px_rgba(15,23,42,0.08)]">
                            <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-500">Used today</p>
                            <p className="mt-2 text-3xl font-semibold text-slate-950">{formatNumberCompact(quota.usedUnits)}</p>
                            <p className="mt-1 text-xs text-slate-500">of {formatNumberCompact(quota.dailyLimit)} units</p>
                        </div>
                    </div>

                    <div className="mt-5 rounded-[26px] border border-slate-200 bg-white/90 p-4">
                        <div className="flex flex-wrap items-center justify-between gap-3">
                            <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                                <Gauge className="h-4 w-4 text-amber-600" />
                                Remaining budget {formatNumberCompact(quota.remainingUnits)} units
                            </div>
                            <div className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-500">
                                {formatPercent(quota.usagePercent)} used
                            </div>
                        </div>
                        <div className="mt-4 h-3 overflow-hidden rounded-full bg-slate-100">
                            <div
                                className={`h-full rounded-full transition-all ${
                                    quota.usagePercent >= 80
                                        ? "bg-[linear-gradient(90deg,#ef4444,#f97316)]"
                                        : quota.usagePercent >= 50
                                            ? "bg-[linear-gradient(90deg,#f59e0b,#f97316)]"
                                            : "bg-[linear-gradient(90deg,#22c55e,#84cc16)]"
                                }`}
                                style={{ width: `${Math.min(quota.usagePercent, 100)}%` }}
                            />
                        </div>
                        <div className="mt-4 flex flex-wrap gap-2 text-xs text-slate-600">
                            <span className="tool-chip bg-white">Tracked calls: {formatNumberCompact(quota.totalCalls)}</span>
                            <span className="tool-chip bg-white">Quota day: {quota.dayKey || "Today"}</span>
                            <span className="tool-chip bg-white">Timezone: PT</span>
                        </div>
                        {quota.nextResetAt && (
                            <p className="mt-3 text-xs text-slate-500">
                                Next quota reset window: {formatDateTime(quota.nextResetAt)}
                            </p>
                        )}
                    </div>

                    {quota.warnings.length > 0 && (
                        <div className="mt-4 space-y-2">
                            {quota.warnings.map((warning) => (
                                <div key={warning} className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                                    {warning}
                                </div>
                            ))}
                        </div>
                    )}
                </article>

                <article className="rounded-[30px] border border-slate-200 bg-white p-6 shadow-[0_24px_60px_rgba(15,23,42,0.08)]">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                        <div>
                            <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-slate-500">Top Consumers</p>
                            <h3 className="mt-2 text-2xl font-semibold text-slate-950">Where quota is going</h3>
                        </div>
                        <div className="text-xs text-slate-500">
                            {quotaBlocked
                                ? `Auto refresh paused until ${formatDateTime(dashboard?.quota.nextResetAt)}`
                                : pageVisible
                                    ? `Auto refresh ${Math.round(DASHBOARD_REFRESH_MS / 1000)}s`
                                    : "Auto refresh paused while tab hidden"}
                        </div>
                    </div>

                    <div className="mt-5 space-y-3">
                        {quota.topConsumers.length > 0 ? quota.topConsumers.map((consumer) => (
                            <div key={consumer.key} className="rounded-[22px] border border-slate-200 bg-[linear-gradient(180deg,#fff,#f8fafc)] p-4">
                                <div className="flex items-start justify-between gap-3">
                                    <div>
                                        <p className="text-sm font-semibold text-slate-950">{consumer.label}</p>
                                        <p className="mt-1 text-xs text-slate-500">{consumer.method} {consumer.path}</p>
                                    </div>
                                    <div className="text-right">
                                        <p className="text-sm font-semibold text-slate-950">{formatNumberCompact(consumer.units)} units</p>
                                        <p className="mt-1 text-xs text-slate-500">{formatPercent(consumer.sharePercent)} of today</p>
                                    </div>
                                </div>
                                <div className="mt-3 flex flex-wrap gap-2 text-xs text-slate-600">
                                    <span className="tool-chip">{formatNumberCompact(consumer.calls)} calls</span>
                                    <span className="tool-chip">{consumer.unitsPerCall} units/call</span>
                                </div>
                            </div>
                        )) : (
                            <div className="rounded-[24px] border border-dashed border-slate-200 bg-slate-50 p-8 text-center">
                                <p className="text-lg font-semibold text-slate-900">No tracked usage yet</p>
                                <p className="mt-2 text-sm text-slate-500">
                                    Once the workspace starts hitting YouTube APIs, the biggest quota consumers will appear here.
                                </p>
                            </div>
                        )}
                    </div>

                    {quota.expensiveActions.length > 0 && (
                        <div className="mt-5 rounded-[24px] border border-slate-200 bg-slate-50 p-4">
                            <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                                <Zap className="h-4 w-4 text-amber-500" />
                                Highest-cost actions
                            </div>
                            <div className="mt-3 space-y-2">
                                {quota.expensiveActions.slice(0, 3).map((action) => (
                                    <div key={action.key} className="flex items-start justify-between gap-3 rounded-2xl bg-white px-3 py-2">
                                        <div>
                                            <p className="text-sm font-semibold text-slate-900">{action.label}</p>
                                            <p className="text-xs text-slate-500">{action.note}</p>
                                        </div>
                                        <span className="tool-chip">{action.unitsPerCall} units</span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                </article>
            </div>

            <div className="grid gap-5 xl:grid-cols-[1.2fr,0.9fr]">
                <article className="relative overflow-hidden rounded-[30px] border border-slate-200 bg-white p-6 shadow-[0_24px_60px_rgba(15,23,42,0.08)]">
                    <div className="absolute right-6 top-6 hidden h-28 w-28 rounded-full bg-red-100 blur-3xl md:block" />
                    <div className="flex flex-wrap items-center justify-between gap-3">
                        <div>
                            <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-slate-500">Mission Surfaces</p>
                            <h3 className="mt-2 text-2xl font-semibold text-slate-950">Dedicated command pages</h3>
                        </div>
                    </div>

                    <div className="mt-5 grid gap-4 md:grid-cols-2">
                        <Link
                            href="/content-studio/youtube/polls"
                            className="group relative overflow-hidden rounded-[28px] border border-rose-100 bg-[linear-gradient(145deg,#fff7ed,#fff,#fff1f2)] p-5 transition hover:-translate-y-1 hover:shadow-[0_24px_60px_rgba(244,63,94,0.14)]"
                        >
                            <div className="absolute right-4 top-4 h-16 w-16 rounded-[22px] border border-white/60 bg-white/70 shadow-[0_18px_40px_rgba(244,63,94,0.12)] [transform:rotate(10deg)]" />
                            <Vote className="relative h-5 w-5 text-rose-500" />
                            <h4 className="relative mt-6 text-xl font-semibold text-slate-950">Poll Command</h4>
                            <p className="relative mt-2 text-sm leading-6 text-slate-600">
                                Run Hindi-only live poll queues, track active question status, and move through extractor documents in order.
                            </p>
                            <div className="relative mt-5 flex items-center gap-2 text-sm font-semibold text-rose-600">
                                Open poll desk
                                <ArrowUpRight className="h-4 w-4 transition group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
                            </div>
                        </Link>

                        <Link
                            href="/content-studio/youtube/comments"
                            className="group relative overflow-hidden rounded-[28px] border border-sky-100 bg-[linear-gradient(145deg,#eff6ff,#fff,#f0fdfa)] p-5 transition hover:-translate-y-1 hover:shadow-[0_24px_60px_rgba(59,130,246,0.14)]"
                        >
                            <div className="absolute right-4 top-4 h-16 w-16 rounded-[22px] border border-white/60 bg-white/70 shadow-[0_18px_40px_rgba(59,130,246,0.12)] [transform:rotate(-10deg)]" />
                            <MessagesSquare className="relative h-5 w-5 text-sky-600" />
                            <h4 className="relative mt-6 text-xl font-semibold text-slate-950">Comment Desk</h4>
                            <p className="relative mt-2 text-sm leading-6 text-slate-600">
                                Monitor live chat plus video comments, draft institute-aware replies, and send them without leaving the workspace.
                            </p>
                            <div className="relative mt-5 flex items-center gap-2 text-sm font-semibold text-sky-600">
                                Open comment desk
                                <ArrowUpRight className="h-4 w-4 transition group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
                            </div>
                        </Link>
                    </div>
                </article>

                <article className="rounded-[30px] border border-slate-200 bg-[linear-gradient(180deg,#fff,#f8fafc)] p-6 shadow-[0_24px_60px_rgba(15,23,42,0.08)]">
                    <div className="flex items-start justify-between gap-3">
                        <div>
                            <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-slate-500">Live Spotlight</p>
                            <h3 className="mt-2 text-2xl font-semibold text-slate-950">
                                {spotlightBroadcast ? spotlightBroadcast.title : "No stream selected yet"}
                            </h3>
                        </div>
                        {spotlightBroadcast && (
                            <span className={`rounded-full px-3 py-1 text-[10px] font-bold uppercase ${statusTone(spotlightBroadcast.status)}`}>
                                {spotlightBroadcast.status}
                            </span>
                        )}
                    </div>

                    {spotlightBroadcast ? (
                        <>
                            <p className="mt-3 text-sm leading-6 text-slate-600">
                                {spotlightBroadcast.status === "active"
                                    ? `Live since ${formatDateTime(spotlightBroadcast.actualStartTime || spotlightBroadcast.scheduledStartTime)}`
                                    : spotlightBroadcast.status === "upcoming"
                                        ? `Scheduled for ${formatDateTime(spotlightBroadcast.scheduledStartTime)}`
                                        : `Ended ${formatDateTime(spotlightBroadcast.actualEndTime || spotlightBroadcast.actualStartTime)}`}
                            </p>
                            <div className="mt-5 grid grid-cols-2 gap-3">
                                <div className="rounded-2xl border border-slate-200 bg-white p-4">
                                    <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-500">Viewers</p>
                                    <p className="mt-3 text-2xl font-semibold text-slate-950">{spotlightBroadcast.concurrentViewers || "0"}</p>
                                </div>
                                <div className="rounded-2xl border border-slate-200 bg-white p-4">
                                    <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-500">Comments</p>
                                    <p className="mt-3 text-2xl font-semibold text-slate-950">{spotlightBroadcast.commentCount || "0"}</p>
                                </div>
                            </div>
                            <div className="mt-5 flex flex-wrap gap-2">
                                <a href={spotlightBroadcast.watchUrl} target="_blank" rel="noreferrer" className="btn btn-secondary text-xs">
                                    Open on YouTube
                                </a>
                                <Link href="/content-studio/youtube/polls" className="btn btn-primary text-xs">
                                    Run Polls
                                </Link>
                                <Link href="/content-studio/youtube/comments" className="btn btn-ghost text-xs">
                                    Open Replies
                                </Link>
                            </div>
                            {spotlightBroadcast.activePoll?.questionText && (
                                <div className="mt-5 rounded-2xl border border-emerald-200 bg-emerald-50 p-4">
                                    <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-emerald-700">Active Poll</p>
                                    <p className="mt-2 text-sm font-semibold text-slate-900">{spotlightBroadcast.activePoll.questionText}</p>
                                </div>
                            )}
                        </>
                    ) : (
                        <p className="mt-4 text-sm leading-6 text-slate-600">
                            Connect a channel to see live broadcasts, performance signals, polls, and comments in one place.
                        </p>
                    )}
                </article>
            </div>

            <div className="grid gap-5 xl:grid-cols-[1.08fr,0.92fr]">
                <article className="rounded-[30px] border border-slate-200 bg-white p-6 shadow-[0_24px_60px_rgba(15,23,42,0.08)]">
                    <div className="flex items-center justify-between gap-3">
                        <div>
                            <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-slate-500">Live Broadcast Matrix</p>
                            <h3 className="mt-2 text-2xl font-semibold text-slate-950">Every stream, organized by state</h3>
                        </div>
                        <div className="flex items-center gap-2 text-sm text-slate-500">
                            <Activity className="h-4 w-4" />
                            {quotaBlocked
                                ? `Refresh paused until ${formatDateTime(dashboard?.quota.nextResetAt)}`
                                : `Auto refresh ${Math.round(DASHBOARD_REFRESH_MS / 1000)}s`}
                        </div>
                    </div>

                    <div className="mt-5 grid gap-4 md:grid-cols-2">
                        {allBroadcasts.length ? (
                            allBroadcasts.slice(0, 6).map((broadcast) => (
                                <div key={broadcast.id} className="rounded-[24px] border border-slate-200 bg-[linear-gradient(180deg,#fff,#f8fafc)] p-4">
                                    <div className="flex items-start gap-4">
                                        {broadcast.thumbnailUrl ? (
                                            <img
                                                src={broadcast.thumbnailUrl}
                                                alt={broadcast.title}
                                                className="h-20 w-32 rounded-2xl border border-slate-200 object-cover"
                                            />
                                        ) : (
                                            <div className="flex h-20 w-32 items-center justify-center rounded-2xl border border-slate-200 bg-slate-100 text-xs text-slate-500">
                                                Live
                                            </div>
                                        )}
                                        <div className="min-w-0 flex-1">
                                            <div className="flex items-center justify-between gap-2">
                                                <p className="line-clamp-2 text-sm font-semibold text-slate-950">{broadcast.title}</p>
                                                <span className={`rounded-full px-2 py-1 text-[10px] font-bold uppercase ${statusTone(broadcast.status)}`}>
                                                    {broadcast.status}
                                                </span>
                                            </div>
                                            <p className="mt-2 text-xs text-slate-500">
                                                {broadcast.status === "active"
                                                    ? `Live since ${formatDateTime(broadcast.actualStartTime || broadcast.scheduledStartTime)}`
                                                    : broadcast.status === "upcoming"
                                                        ? `Starts ${formatDateTime(broadcast.scheduledStartTime)}`
                                                        : `Ended ${formatDateTime(broadcast.actualEndTime || broadcast.actualStartTime)}`}
                                            </p>
                                            <div className="mt-3 flex flex-wrap gap-2">
                                                {broadcast.concurrentViewers && <span className="tool-chip">{broadcast.concurrentViewers} viewers</span>}
                                                {broadcast.commentCount && <span className="tool-chip">{broadcast.commentCount} comments</span>}
                                                {broadcast.activePoll?.id && <span className="tool-chip bg-emerald-100 text-emerald-700 border-emerald-200">Poll live</span>}
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            ))
                        ) : (
                            <div className="col-span-full rounded-[28px] border border-dashed border-slate-200 bg-slate-50 p-8 text-center">
                                <p className="text-lg font-semibold text-slate-900">No live broadcasts loaded yet</p>
                                <p className="mt-2 text-sm text-slate-500">
                                    Active, upcoming, and completed streams will appear here once your channel is connected.
                                </p>
                            </div>
                        )}
                    </div>
                </article>

                <article className="rounded-[30px] border border-slate-200 bg-white p-6 shadow-[0_24px_60px_rgba(15,23,42,0.08)]">
                    <div className="flex items-center justify-between gap-3">
                        <div>
                            <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-slate-500">Upload Performance</p>
                            <h3 className="mt-2 text-2xl font-semibold text-slate-950">Recent content stack</h3>
                        </div>
                        <div className="flex items-center gap-2 text-sm text-slate-500">
                            <TrendingUp className="h-4 w-4" />
                            {analytics.uploadsLoadedCount} loaded
                        </div>
                    </div>

                    <div className="mt-5 space-y-3">
                        {dashboard?.uploads.length ? (
                            dashboard.uploads.slice(0, 6).map((video) => (
                                <div key={video.id} className="rounded-[22px] border border-slate-200 bg-[linear-gradient(180deg,#fff,#f8fafc)] p-4">
                                    <div className="flex items-start gap-4">
                                        {video.thumbnailUrl ? (
                                            <img
                                                src={video.thumbnailUrl}
                                                alt={video.title}
                                                className="h-20 w-32 rounded-2xl border border-slate-200 object-cover"
                                            />
                                        ) : (
                                            <div className="flex h-20 w-32 items-center justify-center rounded-2xl border border-slate-200 bg-slate-100 text-xs text-slate-500">
                                                Video
                                            </div>
                                        )}
                                        <div className="min-w-0 flex-1">
                                            <p className="line-clamp-2 text-sm font-semibold text-slate-950">{video.title}</p>
                                            <p className="mt-2 text-xs text-slate-500">Published {formatDateTime(video.publishedAt)}</p>
                                            <div className="mt-3 flex flex-wrap gap-2">
                                                {video.viewCount && <span className="tool-chip">{video.viewCount} views</span>}
                                                {video.likeCount && <span className="tool-chip">{video.likeCount} likes</span>}
                                                {video.commentCount && <span className="tool-chip">{video.commentCount} comments</span>}
                                            </div>
                                            <a
                                                href={video.watchUrl}
                                                target="_blank"
                                                rel="noreferrer"
                                                className="mt-3 inline-flex items-center gap-2 text-xs font-semibold text-indigo-600"
                                            >
                                                Open on YouTube
                                                <ArrowUpRight className="h-4 w-4" />
                                            </a>
                                        </div>
                                    </div>
                                </div>
                            ))
                        ) : (
                            <div className="rounded-[28px] border border-dashed border-slate-200 bg-slate-50 p-8 text-center">
                                <p className="text-lg font-semibold text-slate-900">No uploads loaded</p>
                                <p className="mt-2 text-sm text-slate-500">
                                    Recent uploads will appear here after the channel is connected.
                                </p>
                            </div>
                        )}
                    </div>
                </article>
            </div>

            <div className="grid gap-4 md:grid-cols-3">
                {[
                    {
                        icon: Command,
                        title: "Poll sequencing",
                        description: "Extractor questions now feed a dedicated polling lane with status memory per live broadcast.",
                    },
                    {
                        icon: MessagesSquare,
                        title: "AI comment replies",
                        description: "Generate institution-aware replies from org data, then send to live chat or comment threads.",
                    },
                    {
                        icon: BarChart3,
                        title: "Real-time channel pulse",
                        description: "Viewer count, comment load, active polls, and upload performance stay visible in the same workspace.",
                    },
                ].map((item) => (
                    <div key={item.title} className="rounded-[26px] border border-slate-200 bg-white p-5 shadow-[0_24px_60px_rgba(15,23,42,0.06)]">
                        <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-100 text-slate-700">
                            <item.icon className="h-5 w-5" />
                        </div>
                        <h4 className="mt-4 text-lg font-semibold text-slate-950">{item.title}</h4>
                        <p className="mt-2 text-sm leading-6 text-slate-600">{item.description}</p>
                    </div>
                ))}
            </div>
        </section>
    );
}
