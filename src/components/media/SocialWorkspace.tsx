"use client";

import { useEffect, useMemo, useState } from "react";
import { useSession } from "next-auth/react";
import toast from "react-hot-toast";
import {
    BadgeCheck,
    ExternalLink,
    Facebook,
    ImageIcon,
    Instagram,
    KeyRound,
    Loader2,
    RadioTower,
    RefreshCw,
    Send,
    ShieldCheck,
    Sparkles,
    Trash2,
    WandSparkles,
} from "lucide-react";

type SocialPlatform = "instagram" | "facebook" | "x";

type SocialConnectionField = {
    key: string;
    label: string;
    placeholder: string;
    required?: boolean;
    secret?: boolean;
    helper?: string;
};

type SocialRecentContent = {
    id: string;
    title: string;
    subtitle?: string;
    mediaUrl?: string;
    permalink?: string;
    createdAt?: string;
};

type SocialRecentMedia = {
    id: string;
    prompt: string;
    type: string;
    assetUrl?: string;
    createdAt: string;
};

type SocialActivityRecord = {
    id: string;
    action: string;
    status: string;
    targetLabel?: string;
    textBody?: string;
    assetUrl?: string;
    externalUrl?: string;
    createdAt: string;
};

type SocialDashboard = {
    platform: SocialPlatform;
    connected: boolean;
    connectionSource?: "saved" | "env";
    profile?: {
        title: string;
        subtitle?: string;
        avatarUrl?: string;
    };
    connectionSummary: {
        tokenPreview?: string;
        accountIdPreview?: string;
        pageIdPreview?: string;
        lastSyncAt?: string;
    };
    analytics: {
        recentOutboundCount: number;
        recentContentCount: number;
        savedMediaCount: number;
    };
    capabilities: string[];
    fields: SocialConnectionField[];
    recentContent: SocialRecentContent[];
    recentMedia: SocialRecentMedia[];
    recentActivity: SocialActivityRecord[];
    warning?: string;
};

type SocialWorkspaceProps = {
    platform: SocialPlatform;
};

type PlatformMeta = {
    label: string;
    eyebrow: string;
    accent: string;
    description: string;
    publishLabel: string;
    primaryActionLabel: string;
    secondaryActionLabel: string;
};

const PLATFORM_META: Record<SocialPlatform, PlatformMeta> = {
    instagram: {
        label: "Instagram",
        eyebrow: "Meta Graph publishing",
        accent: "border-pink-200 bg-[linear-gradient(180deg,#fdf2f8,#fff)]",
        description: "Publish feed visuals and reels using the saved Instagram Graph connection.",
        publishLabel: "Caption",
        primaryActionLabel: "Publish to Instagram",
        secondaryActionLabel: "Connect Instagram",
    },
    facebook: {
        label: "Facebook",
        eyebrow: "Meta Page publishing",
        accent: "border-blue-200 bg-[linear-gradient(180deg,#eff6ff,#fff)]",
        description: "Push page posts, photos, and videos directly to your connected Facebook page.",
        publishLabel: "Message",
        primaryActionLabel: "Publish to Facebook",
        secondaryActionLabel: "Connect Facebook",
    },
    x: {
        label: "X",
        eyebrow: "X API publishing",
        accent: "border-slate-200 bg-[linear-gradient(180deg,#f8fafc,#fff)]",
        description: "Send posts with or without media using your X app and user access tokens.",
        publishLabel: "Post text",
        primaryActionLabel: "Post to X",
        secondaryActionLabel: "Connect X",
    },
};

function XLogo({ className = "h-4 w-4" }: { className?: string }) {
    return (
        <svg viewBox="0 0 24 24" aria-hidden="true" className={className} fill="currentColor">
            <path d="M18.244 2H21.5l-7.11 8.128L22.75 22h-6.54l-5.12-6.69L5.24 22H2l7.61-8.69L1.5 2h6.71l4.63 6.11L18.244 2Zm-1.146 18h1.804L7.23 3.896H5.294L17.098 20Z" />
        </svg>
    );
}

function formatDateTime(value?: string) {
    if (!value) return "Unknown";
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return value;
    return parsed.toLocaleString("en-IN", {
        day: "2-digit",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
    });
}

function platformIcon(platform: SocialPlatform) {
    if (platform === "instagram") return Instagram;
    if (platform === "facebook") return Facebook;
    return XLogo;
}

function statusPill(label: string, tone: "sky" | "emerald" | "amber" | "slate" = "slate") {
    const toneClass =
        tone === "sky"
            ? "border-sky-200 bg-sky-50 text-sky-700"
            : tone === "emerald"
                ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                : tone === "amber"
                    ? "border-amber-200 bg-amber-50 text-amber-700"
                    : "border-slate-200 bg-slate-50 text-slate-600";
    return <span className={`rounded-full border px-3 py-1 text-xs font-semibold ${toneClass}`}>{label}</span>;
}

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

export function SocialWorkspace({ platform }: SocialWorkspaceProps) {
    const meta = PLATFORM_META[platform];
    const Icon = platformIcon(platform);
    const { data: session } = useSession();
    const allowedTools = Array.isArray((session?.user as any)?.allowedTools)
        ? ((session?.user as any)?.allowedTools as string[])
        : [];
    const hasAccess = allowedTools.includes("media-studio") || allowedTools.includes("pdf-to-pdf");

    const [dashboard, setDashboard] = useState<SocialDashboard | null>(null);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [saving, setSaving] = useState(false);
    const [disconnecting, setDisconnecting] = useState(false);
    const [publishing, setPublishing] = useState(false);
    const [selectedMediaId, setSelectedMediaId] = useState("");
    const [externalAssetUrl, setExternalAssetUrl] = useState("");
    const [title, setTitle] = useState("");
    const [message, setMessage] = useState("");
    const [formValues, setFormValues] = useState<Record<string, string>>({});

    const loadDashboard = async (busy = false) => {
        try {
            if (busy) {
                setRefreshing(true);
            } else {
                setLoading(true);
            }
            const response = await fetch(`/api/social/${platform}/dashboard`, { cache: "no-store" });
            const data = await response.json().catch(() => ({}));
            if (!response.ok) {
                throw new Error(data.error || `Failed to load ${meta.label} workspace.`);
            }
            setDashboard(data as SocialDashboard);
        } catch (error) {
            console.error(error);
            toast.error(error instanceof Error ? error.message : `Failed to load ${meta.label} workspace.`);
        } finally {
            setLoading(false);
            setRefreshing(false);
        }
    };

    useEffect(() => {
        if (!hasAccess) return;
        void loadDashboard(false);
    }, [hasAccess, platform]);

    useEffect(() => {
        if (!dashboard) return;
        setFormValues((current) => {
            const next = { ...current };
            dashboard.fields.forEach((field) => {
                if (!(field.key in next)) next[field.key] = "";
            });
            return next;
        });
        if (!selectedMediaId && dashboard.recentMedia[0]?.id) {
            setSelectedMediaId(dashboard.recentMedia[0].id);
        }
    }, [dashboard, selectedMediaId]);

    const selectedMedia = useMemo(
        () => dashboard?.recentMedia.find((item) => item.id === selectedMediaId) || null,
        [dashboard?.recentMedia, selectedMediaId]
    );

    const resolvedAssetUrl = externalAssetUrl.trim() || selectedMedia?.assetUrl || "";

    const handleSaveConnection = async () => {
        setSaving(true);
        try {
            const response = await fetch(`/api/social/${platform}/connection`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(formValues),
            });
            const data = await response.json().catch(() => ({}));
            if (!response.ok) {
                throw new Error(data.error || `Failed to connect ${meta.label}.`);
            }
            setDashboard(data as SocialDashboard);
            toast.success(`${meta.label} connection saved.`);
        } catch (error) {
            console.error(error);
            toast.error(error instanceof Error ? error.message : `Failed to connect ${meta.label}.`);
        } finally {
            setSaving(false);
        }
    };

    const handleDisconnect = async () => {
        setDisconnecting(true);
        try {
            const response = await fetch(`/api/social/${platform}/connection`, { method: "DELETE" });
            const data = await response.json().catch(() => ({}));
            if (!response.ok) {
                throw new Error(data.error || `Failed to disconnect ${meta.label}.`);
            }
            await loadDashboard(false);
            toast.success(`${meta.label} connection removed.`);
        } catch (error) {
            console.error(error);
            toast.error(error instanceof Error ? error.message : `Failed to disconnect ${meta.label}.`);
        } finally {
            setDisconnecting(false);
        }
    };

    const handlePublish = async () => {
        setPublishing(true);
        try {
            const response = await fetch(`/api/social/${platform}/publish`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    title,
                    text: message,
                    assetUrl: resolvedAssetUrl || undefined,
                    action: platform === "x" ? "post" : "publish",
                }),
            });
            const data = await response.json().catch(() => ({}));
            if (!response.ok) {
                throw new Error(data.error || `Failed to publish to ${meta.label}.`);
            }
            toast.success(`${meta.label} publish request completed.`);
            setMessage("");
            setTitle("");
            await loadDashboard(true);
        } catch (error) {
            console.error(error);
            toast.error(error instanceof Error ? error.message : `Failed to publish to ${meta.label}.`);
        } finally {
            setPublishing(false);
        }
    };

    if (!hasAccess) {
        return (
            <div className="surface p-10 text-center">
                <h2 className="heading-xl">{meta.label} Workspace Access Required</h2>
                <p className="mt-2 text-sm text-slate-500">
                    Ask your workspace admin to grant `media-studio` access.
                </p>
            </div>
        );
    }

    if (loading && !dashboard) {
        return (
            <div className="rounded-[32px] border border-slate-200 bg-white p-10 shadow-[0_28px_80px_-50px_rgba(15,23,42,0.28)]">
                <div className="flex items-center gap-3 text-slate-600">
                    <Loader2 className="h-5 w-5 animate-spin" />
                    Loading {meta.label} workspace...
                </div>
            </div>
        );
    }

    return (
        <div className="space-y-6">
            <div className="grid gap-4 lg:grid-cols-3">
                {statCard("Connection", dashboard?.connected ? "Live" : "Setup", meta.description, meta.accent)}
                {statCard(
                    "Recent Content",
                    String(dashboard?.analytics.recentContentCount || 0),
                    `${meta.label} items synced from the connected account`,
                    "border-slate-200 bg-[linear-gradient(180deg,#f8fafc,#fff)]"
                )}
                {statCard(
                    "Saved Media",
                    String(dashboard?.analytics.savedMediaCount || 0),
                    "Generated assets ready to publish from Media Hub",
                    "border-slate-200 bg-[linear-gradient(180deg,#fff,#f8fafc)]"
                )}
            </div>

            <div className="grid gap-6 xl:grid-cols-[380px_minmax(0,1fr)]">
                <div className="space-y-6">
                    <section className="rounded-[30px] border border-slate-200 bg-white p-6 shadow-[0_28px_80px_-50px_rgba(15,23,42,0.28)]">
                        <div className="flex items-start justify-between gap-4">
                            <div>
                                <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-slate-500">
                                    {meta.eyebrow}
                                </p>
                                <div className="mt-3 flex items-center gap-3">
                                    <div className={`flex h-12 w-12 items-center justify-center rounded-2xl border ${meta.accent}`}>
                                        <Icon className="h-5 w-5 text-slate-700" />
                                    </div>
                                    <div>
                                        <h3 className="text-xl font-semibold text-slate-950">{meta.label}</h3>
                                        <p className="text-sm text-slate-500">{dashboard?.profile?.subtitle || meta.description}</p>
                                    </div>
                                </div>
                            </div>
                            {dashboard?.connected ? statusPill("Connected", "emerald") : statusPill("Not connected", "amber")}
                        </div>

                        {dashboard?.profile?.title ? (
                            <div className="mt-5 rounded-[22px] border border-slate-100 bg-slate-50/70 p-4">
                                <div className="flex items-center gap-3">
                                    {dashboard.profile.avatarUrl ? (
                                        <img
                                            src={dashboard.profile.avatarUrl}
                                            alt={dashboard.profile.title}
                                            className="h-12 w-12 rounded-2xl object-cover"
                                        />
                                    ) : (
                                        <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-200 text-slate-500">
                                            <BadgeCheck className="h-5 w-5" />
                                        </div>
                                    )}
                                    <div>
                                        <p className="font-semibold text-slate-900">{dashboard.profile.title}</p>
                                        <p className="text-sm text-slate-500">{dashboard.profile.subtitle || "Connected account"}</p>
                                    </div>
                                </div>
                            </div>
                        ) : null}

                        {dashboard?.warning ? (
                            <div className="mt-5 rounded-[20px] border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                                {dashboard.warning}
                            </div>
                        ) : null}

                        <div className="mt-5 space-y-3">
                            {dashboard?.fields.map((field) => (
                                <label key={field.key} className="block">
                                    <span className="mb-1.5 block text-sm font-semibold text-slate-700">
                                        {field.label}
                                        {field.required ? <span className="text-rose-500"> *</span> : null}
                                    </span>
                                    <input
                                        type={field.secret ? "password" : "text"}
                                        value={formValues[field.key] || ""}
                                        onChange={(event) =>
                                            setFormValues((current) => ({
                                                ...current,
                                                [field.key]: event.target.value,
                                            }))
                                        }
                                        placeholder={field.placeholder}
                                        className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700 outline-none transition focus:border-sky-300 focus:ring-4 focus:ring-sky-100"
                                    />
                                    {field.helper ? <p className="mt-1 text-xs text-slate-500">{field.helper}</p> : null}
                                </label>
                            ))}
                        </div>

                        <div className="mt-5 flex flex-wrap gap-3">
                            <button
                                type="button"
                                onClick={handleSaveConnection}
                                disabled={saving}
                                className="btn btn-primary"
                            >
                                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <KeyRound className="h-4 w-4" />}
                                {meta.secondaryActionLabel}
                            </button>
                            <button
                                type="button"
                                onClick={() => void loadDashboard(true)}
                                disabled={refreshing}
                                className="btn btn-secondary"
                            >
                                {refreshing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                                Refresh
                            </button>
                            <button
                                type="button"
                                onClick={handleDisconnect}
                                disabled={disconnecting}
                                className="btn btn-ghost text-rose-600 hover:border-rose-200 hover:bg-rose-50"
                            >
                                {disconnecting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                                Disconnect
                            </button>
                        </div>

                        <div className="mt-5 flex flex-wrap gap-2">
                            {(dashboard?.capabilities || []).map((item) => (
                                <span
                                    key={item}
                                    className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-semibold text-slate-600"
                                >
                                    {item}
                                </span>
                            ))}
                        </div>
                    </section>

                    <section className="rounded-[30px] border border-slate-200 bg-white p-6 shadow-[0_28px_80px_-50px_rgba(15,23,42,0.28)]">
                        <div className="flex items-center justify-between gap-3">
                            <div>
                                <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-slate-500">Recent activity</p>
                                <h3 className="mt-2 text-lg font-semibold text-slate-950">Outbound log</h3>
                            </div>
                            <RadioTower className="h-5 w-5 text-slate-400" />
                        </div>
                        <div className="mt-4 space-y-3">
                            {dashboard?.recentActivity.length ? (
                                dashboard.recentActivity.map((item) => (
                                    <div key={item.id} className="rounded-[22px] border border-slate-100 bg-slate-50/70 p-4">
                                        <div className="flex items-center justify-between gap-3">
                                            <p className="text-sm font-semibold text-slate-900">{item.action}</p>
                                            {statusPill(item.status === "sent" ? "Sent" : "Failed", item.status === "sent" ? "emerald" : "amber")}
                                        </div>
                                        <p className="mt-2 text-xs text-slate-500">{formatDateTime(item.createdAt)}</p>
                                        {item.textBody ? <p className="mt-2 text-sm text-slate-700 line-clamp-3">{item.textBody}</p> : null}
                                        {item.externalUrl ? (
                                            <a
                                                href={item.externalUrl}
                                                target="_blank"
                                                rel="noreferrer"
                                                className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-sky-700"
                                            >
                                                Open published item
                                                <ExternalLink className="h-3.5 w-3.5" />
                                            </a>
                                        ) : null}
                                    </div>
                                ))
                            ) : (
                                <div className="rounded-[22px] border border-dashed border-slate-200 bg-slate-50/60 px-4 py-6 text-sm text-slate-500">
                                    No outbound activity yet. Publish once to start seeing a delivery trail here.
                                </div>
                            )}
                        </div>
                    </section>
                </div>

                <div className="space-y-6">
                    <section className="rounded-[30px] border border-slate-200 bg-white p-6 shadow-[0_28px_80px_-50px_rgba(15,23,42,0.28)]">
                        <div className="flex flex-wrap items-start justify-between gap-4">
                            <div>
                                <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-slate-500">Publish deck</p>
                                <h3 className="mt-2 text-lg font-semibold text-slate-950">Push Media Hub assets live</h3>
                                <p className="mt-2 max-w-2xl text-sm text-slate-600">
                                    Pick a saved asset, refine the final copy, and send it straight to {meta.label}.
                                </p>
                            </div>
                            <div className="flex items-center gap-2">
                                <ShieldCheck className="h-5 w-5 text-emerald-500" />
                                <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">
                                    {dashboard?.connectionSource === "env" ? "Env linked" : dashboard?.connectionSource === "saved" ? "Workspace linked" : "Disconnected"}
                                </p>
                            </div>
                        </div>

                        <div className="mt-6 grid gap-6 xl:grid-cols-[1.15fr_0.85fr]">
                            <div className="space-y-4">
                                {platform === "x" ? (
                                    <label className="block">
                                        <span className="mb-1.5 block text-sm font-semibold text-slate-700">Optional title / hook</span>
                                        <input
                                            value={title}
                                            onChange={(event) => setTitle(event.target.value)}
                                            placeholder="Short hook before the main post copy"
                                            className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none transition focus:border-sky-300 focus:ring-4 focus:ring-sky-100"
                                        />
                                    </label>
                                ) : null}

                                <label className="block">
                                    <span className="mb-1.5 block text-sm font-semibold text-slate-700">{meta.publishLabel}</span>
                                    <textarea
                                        value={message}
                                        onChange={(event) => setMessage(event.target.value)}
                                        rows={7}
                                        placeholder={`Write the final ${meta.publishLabel.toLowerCase()} for ${meta.label}...`}
                                        className="w-full rounded-[24px] border border-slate-200 px-4 py-4 text-sm outline-none transition focus:border-sky-300 focus:ring-4 focus:ring-sky-100"
                                    />
                                </label>

                                <label className="block">
                                    <span className="mb-1.5 block text-sm font-semibold text-slate-700">Public asset URL override</span>
                                    <input
                                        value={externalAssetUrl}
                                        onChange={(event) => setExternalAssetUrl(event.target.value)}
                                        placeholder="Optional public URL if you want to override the selected asset"
                                        className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none transition focus:border-sky-300 focus:ring-4 focus:ring-sky-100"
                                    />
                                    <p className="mt-1 text-xs text-slate-500">
                                        Leave this empty to publish the selected generated asset below.
                                    </p>
                                </label>

                                <div className="flex flex-wrap items-center gap-3">
                                    <button
                                        type="button"
                                        onClick={handlePublish}
                                        disabled={publishing || !dashboard?.connected}
                                        className="btn btn-primary"
                                    >
                                        {publishing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                                        {meta.primaryActionLabel}
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => {
                                            setMessage("");
                                            setTitle("");
                                            setExternalAssetUrl("");
                                        }}
                                        className="btn btn-ghost"
                                    >
                                        Reset composer
                                    </button>
                                </div>
                            </div>

                            <div className="rounded-[26px] border border-slate-200 bg-slate-50/80 p-4">
                                <div className="flex items-center justify-between gap-3">
                                    <div>
                                        <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-slate-500">
                                            Recent media
                                        </p>
                                        <h4 className="mt-2 text-base font-semibold text-slate-950">Choose a generated asset</h4>
                                    </div>
                                    <Sparkles className="h-4 w-4 text-slate-400" />
                                </div>

                                <div className="mt-4 space-y-3">
                                    {dashboard?.recentMedia.length ? (
                                        dashboard.recentMedia.map((item) => (
                                            <button
                                                key={item.id}
                                                type="button"
                                                onClick={() => {
                                                    setSelectedMediaId(item.id);
                                                    setExternalAssetUrl("");
                                                }}
                                                className={`flex w-full items-center gap-3 rounded-[22px] border px-3 py-3 text-left transition ${
                                                    selectedMediaId === item.id
                                                        ? "border-sky-300 bg-white shadow-[0_18px_40px_-28px_rgba(59,130,246,0.45)]"
                                                        : "border-slate-200 bg-white/90 hover:border-slate-300"
                                                }`}
                                            >
                                                <div className="flex h-16 w-16 items-center justify-center overflow-hidden rounded-2xl bg-slate-100">
                                                    {item.assetUrl ? (
                                                        <img src={item.assetUrl} alt={item.prompt} className="h-full w-full object-cover" />
                                                    ) : (
                                                        <ImageIcon className="h-5 w-5 text-slate-400" />
                                                    )}
                                                </div>
                                                <div className="min-w-0 flex-1">
                                                    <p className="text-sm font-semibold text-slate-900 line-clamp-2">{item.prompt}</p>
                                                    <p className="mt-1 text-xs text-slate-500">
                                                        {item.type} · {formatDateTime(item.createdAt)}
                                                    </p>
                                                </div>
                                            </button>
                                        ))
                                    ) : (
                                        <div className="rounded-[20px] border border-dashed border-slate-200 bg-white px-4 py-6 text-sm text-slate-500">
                                            Generate media in Media Studio first. The latest assets appear here automatically.
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>
                    </section>

                    <section className="grid gap-6 xl:grid-cols-2">
                        <div className="rounded-[30px] border border-slate-200 bg-white p-6 shadow-[0_28px_80px_-50px_rgba(15,23,42,0.28)]">
                            <div className="flex items-center justify-between gap-3">
                                <div>
                                    <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-slate-500">Platform content</p>
                                    <h3 className="mt-2 text-lg font-semibold text-slate-950">Recent published items</h3>
                                </div>
                                <WandSparkles className="h-4 w-4 text-slate-400" />
                            </div>
                            <div className="mt-4 space-y-3">
                                {dashboard?.recentContent.length ? (
                                    dashboard.recentContent.map((item) => (
                                        <div key={item.id} className="rounded-[22px] border border-slate-100 bg-slate-50/70 p-4">
                                            <div className="flex items-start gap-3">
                                                <div className="flex h-12 w-12 items-center justify-center overflow-hidden rounded-2xl bg-slate-100">
                                                    {item.mediaUrl ? (
                                                        <img src={item.mediaUrl} alt={item.title} className="h-full w-full object-cover" />
                                                    ) : (
                                                        <Icon className="h-4 w-4 text-slate-500" />
                                                    )}
                                                </div>
                                                <div className="min-w-0 flex-1">
                                                    <p className="text-sm font-semibold text-slate-900 line-clamp-2">{item.title}</p>
                                                    <p className="mt-1 text-xs text-slate-500">
                                                        {item.subtitle || "Published item"} · {formatDateTime(item.createdAt)}
                                                    </p>
                                                    {item.permalink ? (
                                                        <a
                                                            href={item.permalink}
                                                            target="_blank"
                                                            rel="noreferrer"
                                                            className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-sky-700"
                                                        >
                                                            Open on {meta.label}
                                                            <ExternalLink className="h-3.5 w-3.5" />
                                                        </a>
                                                    ) : null}
                                                </div>
                                            </div>
                                        </div>
                                    ))
                                ) : (
                                    <div className="rounded-[22px] border border-dashed border-slate-200 bg-slate-50/60 px-4 py-6 text-sm text-slate-500">
                                        Nothing synced yet. Connect the account and refresh to see recent platform items here.
                                    </div>
                                )}
                            </div>
                        </div>

                        <div className="rounded-[30px] border border-slate-200 bg-white p-6 shadow-[0_28px_80px_-50px_rgba(15,23,42,0.28)]">
                            <div className="flex items-center justify-between gap-3">
                                <div>
                                    <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-slate-500">Selected asset</p>
                                    <h3 className="mt-2 text-lg font-semibold text-slate-950">Publish preview</h3>
                                </div>
                                <ImageIcon className="h-4 w-4 text-slate-400" />
                            </div>

                            <div className="mt-4 overflow-hidden rounded-[26px] border border-slate-200 bg-slate-50">
                                {resolvedAssetUrl ? (
                                    <img src={resolvedAssetUrl} alt="Selected media asset" className="aspect-[4/3] w-full object-cover" />
                                ) : (
                                    <div className="flex aspect-[4/3] items-center justify-center text-sm text-slate-500">
                                        Pick a recent asset or paste a public URL to preview it here.
                                    </div>
                                )}
                            </div>

                            <div className="mt-4 rounded-[22px] border border-slate-100 bg-slate-50/70 p-4">
                                <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">Routing notes</p>
                                <ul className="mt-3 space-y-2 text-sm text-slate-600">
                                    <li>• Media Hub asset selection is linked directly with this workspace.</li>
                                    <li>• Instagram posts need a public asset URL on the deployed app.</li>
                                    <li>• Facebook and X can upload from saved generated media files.</li>
                                </ul>
                            </div>
                        </div>
                    </section>
                </div>
            </div>
        </div>
    );
}
