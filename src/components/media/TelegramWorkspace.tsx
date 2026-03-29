"use client";

import { type ReactNode, useEffect, useMemo, useState } from "react";
import { useSession } from "next-auth/react";
import toast from "react-hot-toast";
import {
    Bot,
    CircleDashed,
    Compass,
    ImageIcon,
    KeyRound,
    Loader2,
    Pin,
    QrCode,
    RefreshCw,
    Rocket,
    Send,
    Trash2,
    UserRound,
    Video,
    Webhook,
} from "lucide-react";

type TelegramTargetSummary = {
    id: string;
    chatId: string;
    title: string;
    username?: string;
    type: string;
    source: string;
    isPinned: boolean;
    lastSeenAt?: string;
};

type TelegramActivitySummary = {
    id: string;
    direction: string;
    method: string;
    status: string;
    updateType?: string;
    targetChatId: string;
    targetLabel?: string;
    authorName?: string;
    authorUsername?: string;
    textBody?: string;
    mediaUrl?: string;
    createdAt: string;
};

type TelegramMediaAssetSummary = {
    id: string;
    type: string;
    prompt: string;
    assetUrl?: string;
    createdAt: string;
};

type TelegramDashboard = {
    connected: boolean;
    configuredBotAvailable: boolean;
    connection?: {
        id: string;
        tokenPreview: string;
        lastSyncAt?: string;
        lastUpdateId?: number;
    };
    bot?: {
        id: string;
        username?: string;
        firstName: string;
        canJoinGroups: boolean;
        canReadAllGroupMessages: boolean;
        supportsInlineQueries: boolean;
    };
    webhook?: {
        url?: string;
        pendingUpdateCount: number;
        lastErrorMessage?: string;
        lastErrorAt?: string;
        canPoll: boolean;
    };
    targets: TelegramTargetSummary[];
    recentActivity: TelegramActivitySummary[];
    recentMedia: TelegramMediaAssetSummary[];
    analytics: {
        savedTargets: number;
        inboundToday: number;
        outboundToday: number;
        pendingWebhookUpdates: number;
        recentActivityCount: number;
    };
    capabilities: string[];
    warning?: string;
};

type TelegramUserDialogSummary = {
    id: string;
    peerRef: string;
    title: string;
    username?: string;
    type: "direct" | "group" | "channel";
    unreadCount: number;
    lastMessageAt?: string;
};

type TelegramUserActivitySummary = {
    id: string;
    direction: "OUTBOUND";
    method: "sendMessage" | "sendPhoto" | "sendVideo";
    status: "sent" | "failed";
    targetPeer: string;
    targetLabel?: string;
    textBody?: string;
    mediaUrl?: string;
    error?: string;
    createdAt: string;
};

type TelegramUserConnectionState = {
    configured: boolean;
    connected: boolean;
    status: "idle" | "awaiting_qr" | "awaiting_scan" | "awaiting_password" | "connected" | "error";
    telegramUserId?: string;
    displayName?: string;
    username?: string;
    phone?: string;
    qrCodeDataUrl?: string;
    qrLink?: string;
    qrExpiresAt?: string;
    passwordHint?: string;
    lastSyncAt?: string;
    warning?: string;
    recentDialogs: TelegramUserDialogSummary[];
    recentActivity: TelegramUserActivitySummary[];
};

type SendMode = "text" | "photo" | "video";
type ConnectionMode = "bot" | "user";

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

function workspaceShell(children: ReactNode) {
    return (
        <div className="rounded-[34px] border border-sky-100/80 bg-[linear-gradient(180deg,rgba(255,255,255,0.98),rgba(248,250,252,0.98))] p-6 shadow-[0_32px_90px_-54px_rgba(15,23,42,0.45)]">
            {children}
        </div>
    );
}

function statusPill(label: string, tone: "sky" | "emerald" | "amber" | "rose" | "slate" = "slate") {
    const toneClass =
        tone === "sky"
            ? "border-sky-200 bg-sky-50 text-sky-700"
            : tone === "emerald"
                ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                : tone === "amber"
                    ? "border-amber-200 bg-amber-50 text-amber-700"
                    : tone === "rose"
                        ? "border-rose-200 bg-rose-50 text-rose-700"
                        : "border-slate-200 bg-slate-50 text-slate-600";

    return (
        <span className={`rounded-full border px-3 py-1 text-xs font-semibold ${toneClass}`}>
            {label}
        </span>
    );
}

export function TelegramWorkspace() {
    const { data: session } = useSession();
    const allowedTools = Array.isArray((session?.user as any)?.allowedTools)
        ? ((session?.user as any)?.allowedTools as string[])
        : [];
    const hasAccess = allowedTools.includes("media-studio") || allowedTools.includes("pdf-to-pdf");

    const [dashboard, setDashboard] = useState<TelegramDashboard | null>(null);
    const [userConnection, setUserConnection] = useState<TelegramUserConnectionState | null>(null);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [connecting, setConnecting] = useState(false);
    const [disconnecting, setDisconnecting] = useState(false);
    const [savingTarget, setSavingTarget] = useState(false);
    const [sending, setSending] = useState(false);
    const [startingUserConnection, setStartingUserConnection] = useState(false);
    const [disconnectingUserConnection, setDisconnectingUserConnection] = useState(false);
    const [submittingUserPassword, setSubmittingUserPassword] = useState(false);
    const [botToken, setBotToken] = useState("");
    const [targetInput, setTargetInput] = useState("");
    const [targetTitle, setTargetTitle] = useState("");
    const [sendMode, setSendMode] = useState<SendMode>("text");
    const [connectionMode, setConnectionMode] = useState<ConnectionMode>("bot");
    const [body, setBody] = useState("");
    const [mediaUrl, setMediaUrl] = useState("");
    const [caption, setCaption] = useState("");
    const [pinTargets, setPinTargets] = useState(true);
    const [removingTargetId, setRemovingTargetId] = useState<string | null>(null);
    const [userPassword, setUserPassword] = useState("");

    const loadWorkspace = async (showBusyState = false) => {
        try {
            if (showBusyState) {
                setRefreshing(true);
            } else {
                setLoading(true);
            }

            const [dashboardResponse, userConnectionResponse] = await Promise.all([
                fetch("/api/telegram/dashboard", { cache: "no-store" }),
                fetch("/api/telegram/user-connection", { cache: "no-store" }),
            ]);

            const dashboardData = await dashboardResponse.json().catch(() => ({}));
            const userConnectionData = await userConnectionResponse.json().catch(() => ({}));

            if (!dashboardResponse.ok) {
                throw new Error(dashboardData.error || "Failed to load Telegram workspace.");
            }

            if (!userConnectionResponse.ok) {
                throw new Error(userConnectionData.error || "Failed to load Telegram user connection.");
            }

            setDashboard(dashboardData as TelegramDashboard);
            setUserConnection(userConnectionData as TelegramUserConnectionState);
        } catch (error) {
            console.error(error);
            toast.error(error instanceof Error ? error.message : "Failed to load Telegram workspace.");
        } finally {
            setLoading(false);
            setRefreshing(false);
        }
    };

    useEffect(() => {
        if (!hasAccess) return;
        void loadWorkspace(false);
    }, [hasAccess]);

    useEffect(() => {
        if (userConnection?.connected) {
            setConnectionMode("user");
            return;
        }
        if (dashboard?.connected) {
            setConnectionMode("bot");
        }
    }, [dashboard?.connected, userConnection?.connected]);

    useEffect(() => {
        if (!hasAccess) return;

        const fastPolling =
            userConnection?.status === "awaiting_qr" ||
            userConnection?.status === "awaiting_scan" ||
            userConnection?.status === "awaiting_password";
        const shouldPoll =
            dashboard?.connected ||
            Boolean(userConnection?.connected) ||
            fastPolling;

        if (!shouldPoll) return;

        const interval = window.setInterval(() => {
            if (document.visibilityState !== "visible") return;
            void loadWorkspace(true);
        }, fastPolling ? 4000 : 25000);

        return () => window.clearInterval(interval);
    }, [dashboard?.connected, hasAccess, userConnection?.connected, userConnection?.status]);

    const targetsPreview = useMemo(() => dashboard?.targets.slice(0, 8) || [], [dashboard?.targets]);
    const dialogPreview = useMemo(
        () => userConnection?.recentDialogs.slice(0, 10) || [],
        [userConnection?.recentDialogs]
    );
    const userActivityPreview = useMemo(
        () => userConnection?.recentActivity.slice(0, 8) || [],
        [userConnection?.recentActivity]
    );

    const appendTarget = (value: string) => {
        const clean = String(value || "").trim();
        if (!clean) return;
        setTargetInput((current) => {
            const existing = current
                .split(/[\n,]/)
                .map((entry) => entry.trim())
                .filter(Boolean);
            if (existing.includes(clean)) return current;
            return existing.length ? `${current.trim()}, ${clean}` : clean;
        });
    };

    const handleConnect = async (useConfiguredBot = false) => {
        setConnecting(true);
        try {
            const response = await fetch("/api/telegram/connection", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    botToken: useConfiguredBot ? "" : botToken.trim(),
                }),
            });
            const data = await response.json().catch(() => ({}));
            if (!response.ok) {
                throw new Error(data.error || "Failed to connect Telegram bot.");
            }
            toast.success("Telegram bot connected.");
            setBotToken("");
            await loadWorkspace(true);
        } catch (error) {
            console.error(error);
            toast.error(error instanceof Error ? error.message : "Failed to connect Telegram bot.");
        } finally {
            setConnecting(false);
        }
    };

    const handleDisconnect = async () => {
        setDisconnecting(true);
        try {
            const response = await fetch("/api/telegram/connection", {
                method: "DELETE",
            });
            const data = await response.json().catch(() => ({}));
            if (!response.ok) {
                throw new Error(data.error || "Failed to disconnect Telegram bot.");
            }
            toast.success("Telegram bot disconnected.");
            await loadWorkspace(true);
        } catch (error) {
            console.error(error);
            toast.error(error instanceof Error ? error.message : "Failed to disconnect Telegram bot.");
        } finally {
            setDisconnecting(false);
        }
    };

    const handleStartUserConnection = async () => {
        setStartingUserConnection(true);
        try {
            const response = await fetch("/api/telegram/user-connection", {
                method: "POST",
            });
            const data = await response.json().catch(() => ({}));
            if (!response.ok) {
                throw new Error(data.error || "Failed to start Telegram QR login.");
            }
            setUserConnection(data as TelegramUserConnectionState);
            toast.success("Telegram QR connect started.");
        } catch (error) {
            console.error(error);
            toast.error(error instanceof Error ? error.message : "Failed to start Telegram QR login.");
        } finally {
            setStartingUserConnection(false);
        }
    };

    const handleSubmitUserPassword = async () => {
        setSubmittingUserPassword(true);
        try {
            const response = await fetch("/api/telegram/user-connection", {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ password: userPassword.trim() }),
            });
            const data = await response.json().catch(() => ({}));
            if (!response.ok) {
                throw new Error(data.error || "Failed to submit Telegram password.");
            }
            setUserPassword("");
            setUserConnection(data as TelegramUserConnectionState);
            toast.success("Password submitted.");
        } catch (error) {
            console.error(error);
            toast.error(error instanceof Error ? error.message : "Failed to submit Telegram password.");
        } finally {
            setSubmittingUserPassword(false);
        }
    };

    const handleDisconnectUserConnection = async () => {
        setDisconnectingUserConnection(true);
        try {
            const response = await fetch("/api/telegram/user-connection", {
                method: "DELETE",
            });
            const data = await response.json().catch(() => ({}));
            if (!response.ok) {
                throw new Error(data.error || "Failed to disconnect Telegram user account.");
            }
            setUserConnection(data.disconnected ? null : buildIdleUserConnection());
            setConnectionMode(dashboard?.connected ? "bot" : "user");
            toast.success("Telegram user account disconnected.");
            await loadWorkspace(true);
        } catch (error) {
            console.error(error);
            toast.error(error instanceof Error ? error.message : "Failed to disconnect Telegram user account.");
        } finally {
            setDisconnectingUserConnection(false);
        }
    };

    const handleSaveTarget = async () => {
        setSavingTarget(true);
        try {
            const response = await fetch("/api/telegram/targets", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    chatId: targetInput.trim(),
                    title: targetTitle.trim(),
                    isPinned: true,
                }),
            });
            const data = await response.json().catch(() => ({}));
            if (!response.ok) {
                throw new Error(data.error || "Failed to save Telegram target.");
            }
            toast.success("Target pinned.");
            await loadWorkspace(true);
        } catch (error) {
            console.error(error);
            toast.error(error instanceof Error ? error.message : "Failed to save Telegram target.");
        } finally {
            setSavingTarget(false);
        }
    };

    const handleRemoveTarget = async (targetId: string) => {
        setRemovingTargetId(targetId);
        try {
            const response = await fetch(`/api/telegram/targets/${targetId}`, {
                method: "DELETE",
            });
            const data = await response.json().catch(() => ({}));
            if (!response.ok) {
                throw new Error(data.error || "Failed to remove target.");
            }
            toast.success("Target removed.");
            await loadWorkspace(true);
        } catch (error) {
            console.error(error);
            toast.error(error instanceof Error ? error.message : "Failed to remove target.");
        } finally {
            setRemovingTargetId(null);
        }
    };

    const handleSend = async () => {
        setSending(true);
        try {
            const response = await fetch("/api/telegram/messages/send", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    connectionMode,
                    type: sendMode,
                    targets: targetInput,
                    body,
                    mediaUrl,
                    caption,
                    pinTargets,
                }),
            });
            const data = await response.json().catch(() => ({}));
            if (!response.ok) {
                throw new Error(data.error || "Failed to send Telegram payload.");
            }
            const result = data.result as { sentCount: number; failedCount: number };
            toast.success(
                result.failedCount
                    ? `Sent ${result.sentCount}, failed ${result.failedCount}.`
                    : `Sent to ${result.sentCount} target${result.sentCount === 1 ? "" : "s"}.`
            );
            await loadWorkspace(true);
        } catch (error) {
            console.error(error);
            toast.error(error instanceof Error ? error.message : "Failed to send Telegram payload.");
        } finally {
            setSending(false);
        }
    };

    const connectionModeReady =
        connectionMode === "bot" ? Boolean(dashboard?.connected) : Boolean(userConnection?.connected);

    if (!hasAccess) {
        return workspaceShell(
            <div className="rounded-[28px] border border-amber-200 bg-amber-50/90 p-6 text-amber-900">
                <h2 className="text-xl font-semibold">Telegram Workspace Access Required</h2>
                <p className="mt-2 text-sm text-amber-800/80">
                    Ask an admin to enable `media-studio` or `pdf-to-pdf` access for your account to use Telegram publishing tools.
                </p>
            </div>
        );
    }

    if (loading && !dashboard) {
        return workspaceShell(
            <div className="grid gap-4 lg:grid-cols-[1.05fr_1.2fr_0.95fr]">
                {Array.from({ length: 3 }).map((_, index) => (
                    <div key={index} className="rounded-[30px] border border-slate-200 bg-white/80 p-6 shadow-[0_28px_70px_-45px_rgba(15,23,42,0.38)]">
                        <div className="h-4 w-32 animate-pulse rounded-full bg-slate-200" />
                        <div className="mt-4 h-24 animate-pulse rounded-[24px] bg-slate-100" />
                        <div className="mt-4 h-24 animate-pulse rounded-[24px] bg-slate-100" />
                    </div>
                ))}
            </div>
        );
    }

    return workspaceShell(
        <div className="space-y-6">
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
                {statCard(
                    "Bot Targets",
                    String(dashboard?.analytics.savedTargets || 0),
                    "Pinned bot targets for fast channel and group pushes.",
                    "border-sky-200 bg-sky-50/90"
                )}
                {statCard(
                    "Bot Flow",
                    String(dashboard?.analytics.outboundToday || 0),
                    "Outbound bot sends recorded today.",
                    "border-cyan-200 bg-cyan-50/90"
                )}
                {statCard(
                    "User Dialogs",
                    String(userConnection?.recentDialogs.length || 0),
                    "Recent direct chats, groups, and channels from QR login.",
                    "border-emerald-200 bg-emerald-50/90"
                )}
                {statCard(
                    "User Relay",
                    String(userConnection?.recentActivity.length || 0),
                    "Recent user-account sends stored in this workspace.",
                    "border-indigo-200 bg-indigo-50/90"
                )}
                {statCard(
                    "Webhook Queue",
                    String(dashboard?.analytics.pendingWebhookUpdates || 0),
                    dashboard?.webhook?.canPoll
                        ? "Polling mode is active for the bot relay."
                        : "Webhook mode is active on the bot relay.",
                    "border-violet-200 bg-violet-50/90"
                )}
            </div>

            {(dashboard?.warning || userConnection?.warning) && (
                <div className="grid gap-3 lg:grid-cols-2">
                    {dashboard?.warning ? (
                        <div className="rounded-[24px] border border-amber-200 bg-amber-50/90 px-5 py-4 text-sm text-amber-900 shadow-[0_20px_50px_-38px_rgba(217,119,6,0.4)]">
                            {dashboard.warning}
                        </div>
                    ) : null}
                    {userConnection?.warning ? (
                        <div className="rounded-[24px] border border-amber-200 bg-amber-50/90 px-5 py-4 text-sm text-amber-900 shadow-[0_20px_50px_-38px_rgba(217,119,6,0.4)]">
                            {userConnection.warning}
                        </div>
                    ) : null}
                </div>
            )}

            <div className="grid gap-5 xl:grid-cols-[1.05fr_1.15fr_0.98fr]">
                <section className="space-y-5">
                    <div className="rounded-[30px] border border-slate-200 bg-white/90 p-6 shadow-[0_30px_80px_-48px_rgba(15,23,42,0.42)]">
                        <div className="flex items-start justify-between gap-4">
                            <div>
                                <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-slate-400">Bot Relay</p>
                                <h3 className="mt-2 text-2xl font-semibold text-slate-950">
                                    {dashboard?.connected ? dashboard.bot?.firstName || "Telegram Bot" : "Connect Bot"}
                                </h3>
                            </div>
                            {dashboard?.connected ? statusPill("Connected", "sky") : statusPill("Idle")}
                        </div>

                        {dashboard?.connected ? (
                            <div className="mt-5 space-y-4">
                                <div className="rounded-[24px] border border-slate-200 bg-slate-50/90 p-4">
                                    <div className="flex items-center gap-3">
                                        <div className="flex h-12 w-12 items-center justify-center rounded-[18px] bg-sky-100 text-sky-700">
                                            <Bot className="h-5 w-5" />
                                        </div>
                                        <div className="min-w-0">
                                            <p className="truncate text-lg font-semibold text-slate-900">
                                                {dashboard.bot?.username ? `@${dashboard.bot.username}` : dashboard.bot?.firstName}
                                            </p>
                                            <p className="text-sm text-slate-500">Token preview: {dashboard.connection?.tokenPreview}</p>
                                        </div>
                                    </div>
                                    <div className="mt-4 flex flex-wrap gap-2">
                                        <span className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-semibold text-slate-600">
                                            {dashboard.bot?.canJoinGroups ? "Can join groups" : "Groups restricted"}
                                        </span>
                                        <span className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-semibold text-slate-600">
                                            {dashboard.bot?.supportsInlineQueries ? "Inline ready" : "Inline off"}
                                        </span>
                                        <span className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-semibold text-slate-600">
                                            {dashboard.webhook?.canPoll ? "Polling active" : "Webhook active"}
                                        </span>
                                    </div>
                                </div>

                                <div className="rounded-[24px] border border-slate-200 bg-white p-4">
                                    <div className="flex items-center gap-2 text-sm font-semibold text-slate-700">
                                        <Webhook className="h-4 w-4 text-sky-500" />
                                        Webhook + sync
                                    </div>
                                    <p className="mt-3 text-sm text-slate-600">
                                        URL: {dashboard.webhook?.url || "No webhook configured. Polling via getUpdates is active."}
                                    </p>
                                    <p className="mt-2 text-xs text-slate-500">
                                        Last sync: {formatDateTime(dashboard.connection?.lastSyncAt)} · Pending: {dashboard.webhook?.pendingUpdateCount || 0}
                                    </p>
                                </div>

                                <div className="grid gap-3 sm:grid-cols-2">
                                    <button
                                        type="button"
                                        className="btn btn-secondary text-xs"
                                        onClick={() => void loadWorkspace(true)}
                                        disabled={refreshing}
                                    >
                                        {refreshing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                                        Refresh status
                                    </button>
                                    <button
                                        type="button"
                                        className="btn btn-ghost text-xs"
                                        onClick={handleDisconnect}
                                        disabled={disconnecting}
                                    >
                                        {disconnecting ? <Loader2 className="h-4 w-4 animate-spin" /> : <CircleDashed className="h-4 w-4" />}
                                        Disconnect
                                    </button>
                                </div>
                            </div>
                        ) : (
                            <div className="mt-5 space-y-4">
                                <div className="rounded-[24px] border border-slate-200 bg-slate-50/90 p-4">
                                    <p className="text-sm text-slate-600">
                                        Paste a BotFather token to connect your bot, or use the server-level configured token if one is already available.
                                    </p>
                                </div>
                                <input
                                    type="password"
                                    value={botToken}
                                    onChange={(event) => setBotToken(event.target.value)}
                                    className="input w-full border-slate-200 bg-white"
                                    placeholder="1234567890:AAExampleBotToken"
                                />
                                <div className="grid gap-3 sm:grid-cols-2">
                                    <button
                                        type="button"
                                        className="btn btn-primary text-xs"
                                        onClick={() => handleConnect(false)}
                                        disabled={connecting}
                                    >
                                        {connecting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Rocket className="h-4 w-4" />}
                                        Connect bot
                                    </button>
                                    <button
                                        type="button"
                                        className="btn btn-secondary text-xs"
                                        onClick={() => handleConnect(true)}
                                        disabled={connecting || !dashboard?.configuredBotAvailable}
                                    >
                                        Use configured bot
                                    </button>
                                </div>
                            </div>
                        )}
                    </div>

                    <div className="rounded-[30px] border border-slate-200 bg-white/90 p-6 shadow-[0_30px_80px_-48px_rgba(15,23,42,0.42)]">
                        <div className="flex items-start justify-between gap-4">
                            <div>
                                <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-slate-400">User Account Relay</p>
                                <h3 className="mt-2 text-2xl font-semibold text-slate-950">
                                    {userConnection?.connected ? userConnection.displayName || userConnection.username || "Telegram User" : "Connect with QR"}
                                </h3>
                            </div>
                            {userConnection?.connected
                                ? statusPill("Connected", "emerald")
                                : userConnection?.status === "awaiting_scan"
                                    ? statusPill("Scan QR", "amber")
                                    : userConnection?.status === "awaiting_password"
                                        ? statusPill("2FA needed", "amber")
                                        : statusPill(userConnection?.configured ? "Ready" : "Config needed", userConnection?.configured ? "slate" : "rose")}
                        </div>

                        {!userConnection?.configured ? (
                            <div className="mt-5 rounded-[24px] border border-rose-200 bg-rose-50/90 p-4 text-sm text-rose-800">
                                Set `TELEGRAM_USER_API_ID` and `TELEGRAM_USER_API_HASH` on the server to unlock QR login for direct chats, groups, and channels.
                            </div>
                        ) : userConnection.connected ? (
                            <div className="mt-5 space-y-4">
                                <div className="rounded-[24px] border border-slate-200 bg-slate-50/90 p-4">
                                    <div className="flex items-center gap-3">
                                        <div className="flex h-12 w-12 items-center justify-center rounded-[18px] bg-emerald-100 text-emerald-700">
                                            <UserRound className="h-5 w-5" />
                                        </div>
                                        <div className="min-w-0">
                                            <p className="truncate text-lg font-semibold text-slate-900">
                                                {userConnection.displayName || userConnection.username || "Telegram User"}
                                            </p>
                                            <p className="text-sm text-slate-500">
                                                {[userConnection.username, userConnection.phone].filter(Boolean).join(" · ") || "User account relay"}
                                            </p>
                                        </div>
                                    </div>
                                    <p className="mt-3 text-xs text-slate-500">
                                        Last sync: {formatDateTime(userConnection.lastSyncAt)}
                                    </p>
                                </div>

                                <div className="grid gap-3 sm:grid-cols-2">
                                    <button
                                        type="button"
                                        className="btn btn-secondary text-xs"
                                        onClick={() => void loadWorkspace(true)}
                                        disabled={refreshing}
                                    >
                                        {refreshing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                                        Refresh dialogs
                                    </button>
                                    <button
                                        type="button"
                                        className="btn btn-ghost text-xs"
                                        onClick={handleDisconnectUserConnection}
                                        disabled={disconnectingUserConnection}
                                    >
                                        {disconnectingUserConnection ? <Loader2 className="h-4 w-4 animate-spin" /> : <CircleDashed className="h-4 w-4" />}
                                        Disconnect user
                                    </button>
                                </div>
                            </div>
                        ) : userConnection.status === "awaiting_password" ? (
                            <div className="mt-5 space-y-4">
                                <div className="rounded-[24px] border border-amber-200 bg-amber-50/90 p-4 text-sm text-amber-900">
                                    Telegram needs your 2FA password before the session can finish connecting.
                                    {userConnection.passwordHint ? ` Hint: ${userConnection.passwordHint}` : ""}
                                </div>
                                <div className="flex items-center gap-3 rounded-[22px] border border-slate-200 bg-slate-50/80 px-4 py-3">
                                    <KeyRound className="h-4 w-4 text-slate-500" />
                                    <input
                                        type="password"
                                        value={userPassword}
                                        onChange={(event) => setUserPassword(event.target.value)}
                                        className="w-full bg-transparent text-sm text-slate-900 outline-none placeholder:text-slate-400"
                                        placeholder="Enter Telegram 2FA password"
                                    />
                                </div>
                                <button
                                    type="button"
                                    className="btn btn-primary text-xs w-full"
                                    onClick={handleSubmitUserPassword}
                                    disabled={submittingUserPassword || !userPassword.trim()}
                                >
                                    {submittingUserPassword ? <Loader2 className="h-4 w-4 animate-spin" /> : <KeyRound className="h-4 w-4" />}
                                    Submit password
                                </button>
                            </div>
                        ) : userConnection.status === "awaiting_scan" && userConnection.qrCodeDataUrl ? (
                            <div className="mt-5 space-y-4">
                                <div className="rounded-[24px] border border-slate-200 bg-slate-50/90 p-4">
                                    <div className="flex items-start gap-4">
                                        <div className="overflow-hidden rounded-[18px] border border-slate-200 bg-white p-2">
                                            {/* eslint-disable-next-line @next/next/no-img-element */}
                                            <img
                                                src={userConnection.qrCodeDataUrl}
                                                alt="Telegram QR code"
                                                className="h-40 w-40 rounded-[12px] object-cover"
                                            />
                                        </div>
                                        <div className="min-w-0 flex-1">
                                            <p className="text-sm font-semibold text-slate-900">Scan this QR in Telegram</p>
                                            <p className="mt-2 text-sm text-slate-600">
                                                Open Telegram on your phone, use QR login, and scan this code to connect your actual user account.
                                            </p>
                                            <p className="mt-3 text-xs text-slate-500">
                                                Expires: {formatDateTime(userConnection.qrExpiresAt)}
                                            </p>
                                            {userConnection.qrLink ? (
                                                <a
                                                    href={userConnection.qrLink}
                                                    className="mt-4 inline-flex rounded-full border border-sky-200 bg-sky-50 px-4 py-2 text-xs font-semibold text-sky-700"
                                                >
                                                    Open in Telegram
                                                </a>
                                            ) : null}
                                        </div>
                                    </div>
                                </div>
                                <button
                                    type="button"
                                    className="btn btn-secondary text-xs w-full"
                                    onClick={handleStartUserConnection}
                                    disabled={startingUserConnection}
                                >
                                    {startingUserConnection ? <Loader2 className="h-4 w-4 animate-spin" /> : <QrCode className="h-4 w-4" />}
                                    Refresh QR code
                                </button>
                            </div>
                        ) : (
                            <div className="mt-5 space-y-4">
                                <div className="rounded-[24px] border border-slate-200 bg-slate-50/90 p-4">
                                    <p className="text-sm text-slate-600">
                                        Connect your real Telegram user account by QR. That unlocks direct sends to personal chats, groups, and channels you already use.
                                    </p>
                                </div>
                                <button
                                    type="button"
                                    className="btn btn-primary text-xs w-full"
                                    onClick={handleStartUserConnection}
                                    disabled={startingUserConnection || !userConnection?.configured}
                                >
                                    {startingUserConnection ? <Loader2 className="h-4 w-4 animate-spin" /> : <QrCode className="h-4 w-4" />}
                                    Start QR connect
                                </button>
                            </div>
                        )}
                    </div>

                    <div className="rounded-[30px] border border-slate-200 bg-white/90 p-6 shadow-[0_30px_80px_-48px_rgba(15,23,42,0.42)]">
                        <div className="flex items-center justify-between gap-3">
                            <div>
                                <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-slate-400">User Dialog Deck</p>
                                <h3 className="mt-2 text-xl font-semibold text-slate-950">Recent directs, groups, and channels</h3>
                            </div>
                            <div className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-semibold text-slate-600">
                                {dialogPreview.length} dialog(s)
                            </div>
                        </div>

                        <div className="mt-5 space-y-3">
                            {dialogPreview.length ? dialogPreview.map((dialog) => (
                                <button
                                    key={dialog.id}
                                    type="button"
                                    onClick={() => appendTarget(dialog.username || dialog.peerRef)}
                                    className="w-full rounded-[22px] border border-slate-200 bg-slate-50/70 p-4 text-left transition hover:border-emerald-200 hover:bg-emerald-50/70"
                                >
                                    <div className="flex items-start justify-between gap-3">
                                        <div className="min-w-0">
                                            <p className="truncate text-sm font-semibold text-slate-900">{dialog.title}</p>
                                            <p className="mt-1 truncate text-xs text-slate-500">
                                                {dialog.username || dialog.peerRef} · {dialog.type}
                                            </p>
                                        </div>
                                        {dialog.unreadCount ? (
                                            <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[11px] font-semibold text-emerald-700">
                                                {dialog.unreadCount} unread
                                            </span>
                                        ) : null}
                                    </div>
                                    <p className="mt-3 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">
                                        Tap to add target · {formatDateTime(dialog.lastMessageAt)}
                                    </p>
                                </button>
                            )) : (
                                <div className="rounded-[24px] border border-dashed border-slate-200 bg-slate-50/70 p-5 text-sm text-slate-500">
                                    Connect a Telegram user account to surface recent personal chats, groups, and channels here.
                                </div>
                            )}
                        </div>
                    </div>
                </section>

                <section className="space-y-5">
                    <div className="rounded-[30px] border border-slate-200 bg-white/90 p-6 shadow-[0_30px_80px_-48px_rgba(15,23,42,0.42)]">
                        <div className="flex items-center justify-between gap-3">
                            <div>
                                <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-slate-400">Activity Stream</p>
                                <h3 className="mt-2 text-xl font-semibold text-slate-950">Bot updates and user-account sends</h3>
                            </div>
                            <div className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-semibold text-slate-600">
                                {(dashboard?.recentActivity.length || 0) + userActivityPreview.length} events
                            </div>
                        </div>

                        <div className="mt-5 space-y-3">
                            {dashboard?.recentActivity.length ? dashboard.recentActivity.map((item) => (
                                <div
                                    key={item.id}
                                    className={`rounded-[24px] border p-4 ${item.direction === "INBOUND" ? "border-cyan-200 bg-cyan-50/70" : item.status === "failed" ? "border-rose-200 bg-rose-50/70" : "border-indigo-200 bg-indigo-50/70"}`}
                                >
                                    <div className="flex items-center justify-between gap-3">
                                        <div className="min-w-0">
                                            <p className="truncate text-sm font-semibold text-slate-900">
                                                {item.targetLabel || item.targetChatId}
                                            </p>
                                            <p className="mt-1 text-xs text-slate-500">
                                                {item.authorUsername ? `@${item.authorUsername}` : item.authorName || "Telegram"} · {item.method}
                                            </p>
                                        </div>
                                        <div className="rounded-full border border-white/80 bg-white/90 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-600">
                                            {item.direction}
                                        </div>
                                    </div>
                                    <p className="mt-3 line-clamp-3 text-sm leading-relaxed text-slate-700">
                                        {item.textBody || (item.mediaUrl ? "Media payload sent." : "No message preview available.")}
                                    </p>
                                    <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                                        <span>{item.status}</span>
                                        {item.updateType ? <span>· {item.updateType}</span> : null}
                                        <span>· {formatDateTime(item.createdAt)}</span>
                                    </div>
                                </div>
                            )) : null}

                            {userActivityPreview.length ? userActivityPreview.map((item) => (
                                <div
                                    key={item.id}
                                    className={`rounded-[24px] border p-4 ${item.status === "failed" ? "border-rose-200 bg-rose-50/70" : "border-emerald-200 bg-emerald-50/70"}`}
                                >
                                    <div className="flex items-center justify-between gap-3">
                                        <div className="min-w-0">
                                            <p className="truncate text-sm font-semibold text-slate-900">
                                                {item.targetLabel || item.targetPeer}
                                            </p>
                                            <p className="mt-1 text-xs text-slate-500">
                                                User relay · {item.method}
                                            </p>
                                        </div>
                                        <div className="rounded-full border border-white/80 bg-white/90 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-600">
                                            {item.status}
                                        </div>
                                    </div>
                                    <p className="mt-3 line-clamp-3 text-sm leading-relaxed text-slate-700">
                                        {item.textBody || (item.mediaUrl ? "Media payload sent from user account." : "No preview available.")}
                                    </p>
                                    <div className="mt-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                                        {formatDateTime(item.createdAt)}
                                    </div>
                                </div>
                            )) : null}

                            {!dashboard?.recentActivity.length && !userActivityPreview.length ? (
                                <div className="rounded-[24px] border border-dashed border-slate-200 bg-slate-50/70 p-6 text-sm text-slate-500">
                                    Activity will appear here as soon as the bot receives updates or the QR-connected user account sends content.
                                </div>
                            ) : null}
                        </div>
                    </div>
                </section>

                <section className="space-y-5">
                    <div className="rounded-[30px] border border-slate-200 bg-white/90 p-6 shadow-[0_30px_80px_-48px_rgba(15,23,42,0.42)]">
                        <div className="flex items-center justify-between gap-3">
                            <div>
                                <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-slate-400">Composer</p>
                                <h3 className="mt-2 text-xl font-semibold text-slate-950">Send text, images, or videos</h3>
                            </div>
                            <button
                                type="button"
                                className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600"
                                onClick={() => void loadWorkspace(true)}
                                disabled={refreshing}
                            >
                                {refreshing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                            </button>
                        </div>

                        <div className="mt-5 space-y-4">
                            <div className="grid gap-3 sm:grid-cols-2">
                                <button
                                    type="button"
                                    onClick={() => setConnectionMode("bot")}
                                    className={`rounded-[20px] border px-4 py-3 text-left transition ${connectionMode === "bot" ? "border-sky-300 bg-sky-50 shadow-[0_18px_40px_-28px_rgba(14,165,233,0.5)]" : "border-slate-200 bg-white"}`}
                                >
                                    <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                                        <Bot className="h-4 w-4 text-sky-600" />
                                        Bot mode
                                    </div>
                                    <p className="mt-2 text-xs text-slate-500">
                                        Best for saved targets, bot channels, and automated pushes.
                                    </p>
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setConnectionMode("user")}
                                    className={`rounded-[20px] border px-4 py-3 text-left transition ${connectionMode === "user" ? "border-emerald-300 bg-emerald-50 shadow-[0_18px_40px_-28px_rgba(16,185,129,0.5)]" : "border-slate-200 bg-white"}`}
                                >
                                    <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                                        <UserRound className="h-4 w-4 text-emerald-600" />
                                        User account
                                    </div>
                                    <p className="mt-2 text-xs text-slate-500">
                                        Best for personal directs, joined groups, and user-managed channels.
                                    </p>
                                </button>
                            </div>

                            <div className="flex flex-wrap gap-2">
                                {(["text", "photo", "video"] as SendMode[]).map((mode) => (
                                    <button
                                        key={mode}
                                        type="button"
                                        onClick={() => setSendMode(mode)}
                                        className={`rounded-full px-3 py-1.5 text-xs font-semibold transition ${sendMode === mode ? "bg-slate-900 text-white shadow-[0_18px_35px_-24px_rgba(15,23,42,0.5)]" : "border border-slate-200 bg-white text-slate-600"}`}
                                    >
                                        {mode === "text" ? "Text" : mode === "photo" ? "Photo" : "Video"}
                                    </button>
                                ))}
                            </div>

                            <textarea
                                value={targetInput}
                                onChange={(event) => setTargetInput(event.target.value)}
                                className="input min-h-[84px] w-full border-slate-200 bg-white py-3"
                                placeholder={
                                    connectionMode === "user"
                                        ? "@username, @groupname, @channelname, or peer ids from user dialogs"
                                        : "@channelusername, -1001234567890, @groupusername"
                                }
                            />

                            <div className="flex flex-wrap gap-2">
                                {targetsPreview.map((target) => (
                                    <button
                                        key={target.id}
                                        type="button"
                                        onClick={() => appendTarget(target.username || target.chatId)}
                                        className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-semibold text-slate-600 transition hover:border-sky-200 hover:bg-sky-50"
                                    >
                                        {target.title}
                                    </button>
                                ))}
                                {dialogPreview.slice(0, 6).map((dialog) => (
                                    <button
                                        key={dialog.id}
                                        type="button"
                                        onClick={() => appendTarget(dialog.username || dialog.peerRef)}
                                        className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-700 transition hover:border-emerald-300"
                                    >
                                        {dialog.title}
                                    </button>
                                ))}
                            </div>

                            {sendMode === "text" ? (
                                <textarea
                                    value={body}
                                    onChange={(event) => setBody(event.target.value)}
                                    className="input min-h-[140px] w-full border-slate-200 bg-white py-3"
                                    placeholder="Write the Telegram message..."
                                />
                            ) : (
                                <>
                                    <input
                                        value={mediaUrl}
                                        onChange={(event) => setMediaUrl(event.target.value)}
                                        className="input w-full border-slate-200 bg-white"
                                        placeholder="/uploads/generated-media/... or a public image/video URL"
                                    />
                                    <textarea
                                        value={caption}
                                        onChange={(event) => setCaption(event.target.value)}
                                        className="input min-h-[120px] w-full border-slate-200 bg-white py-3"
                                        placeholder="Optional caption..."
                                    />
                                </>
                            )}

                            <label className="flex items-center gap-3 rounded-[18px] border border-slate-200 bg-slate-50/80 px-4 py-3 text-sm text-slate-600">
                                <input
                                    type="checkbox"
                                    checked={pinTargets}
                                    onChange={(event) => setPinTargets(event.target.checked)}
                                    className="h-4 w-4 rounded border-slate-300 text-sky-600 focus:ring-sky-500"
                                    disabled={connectionMode === "user"}
                                />
                                {connectionMode === "user"
                                    ? "Bot-only pinning is disabled while sending from the user account relay."
                                    : "Save these targets to the bot deck after send"}
                            </label>

                            <button
                                type="button"
                                className="btn btn-primary text-sm w-full"
                                onClick={handleSend}
                                disabled={!connectionModeReady || sending}
                            >
                                {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                                {connectionMode === "user" ? "Send via user account" : "Send via bot"}
                            </button>
                        </div>
                    </div>

                    <div className="rounded-[30px] border border-slate-200 bg-white/90 p-6 shadow-[0_30px_80px_-48px_rgba(15,23,42,0.42)]">
                        <div className="flex items-center justify-between gap-3">
                            <div>
                                <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-slate-400">Target Deck</p>
                                <h3 className="mt-2 text-xl font-semibold text-slate-950">Pinned bot chats, groups, and channels</h3>
                            </div>
                            <div className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-semibold text-slate-600">
                                {dashboard?.targets.length || 0} target(s)
                            </div>
                        </div>

                        <div className="mt-5 space-y-3">
                            <input
                                value={targetTitle}
                                onChange={(event) => setTargetTitle(event.target.value)}
                                className="input w-full border-slate-200 bg-white"
                                placeholder="Optional label like NACC Biology Channel"
                            />
                            <button
                                type="button"
                                className="btn btn-secondary text-xs w-full"
                                onClick={handleSaveTarget}
                                disabled={savingTarget || !dashboard?.connected || !targetInput.trim()}
                            >
                                {savingTarget ? <Loader2 className="h-4 w-4 animate-spin" /> : <Pin className="h-4 w-4" />}
                                Pin current targets to bot deck
                            </button>
                        </div>

                        <div className="mt-5 space-y-3">
                            {targetsPreview.length ? targetsPreview.map((target) => (
                                <div key={target.id} className="rounded-[22px] border border-slate-200 bg-slate-50/70 p-4">
                                    <div className="flex items-start justify-between gap-3">
                                        <button
                                            type="button"
                                            onClick={() => appendTarget(target.username || target.chatId)}
                                            className="min-w-0 flex-1 text-left"
                                        >
                                            <p className="truncate text-sm font-semibold text-slate-900">{target.title}</p>
                                            <p className="mt-1 truncate text-xs text-slate-500">
                                                {target.username ? `@${target.username}` : target.chatId} · {target.type}
                                            </p>
                                        </button>
                                        <button
                                            type="button"
                                            className="rounded-full border border-slate-200 bg-white p-2 text-slate-500 transition hover:text-rose-600"
                                            onClick={() => void handleRemoveTarget(target.id)}
                                            disabled={removingTargetId === target.id}
                                        >
                                            {removingTargetId === target.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                                        </button>
                                    </div>
                                    <div className="mt-3 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                                        <span>{target.isPinned ? "Pinned" : "Saved"}</span>
                                        <span>·</span>
                                        <span>{target.source}</span>
                                        <span>·</span>
                                        <span>{formatDateTime(target.lastSeenAt)}</span>
                                    </div>
                                </div>
                            )) : (
                                <div className="rounded-[24px] border border-dashed border-slate-200 bg-slate-50/70 p-5 text-sm text-slate-500">
                                    No bot targets saved yet. Pin your first Telegram channel, group, or direct chat to make automated sending faster.
                                </div>
                            )}
                        </div>
                    </div>

                    <div className="rounded-[30px] border border-slate-200 bg-white/90 p-6 shadow-[0_30px_80px_-48px_rgba(15,23,42,0.42)]">
                        <div className="flex items-center justify-between gap-3">
                            <div>
                                <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-slate-400">Recent Media</p>
                                <h3 className="mt-2 text-xl font-semibold text-slate-950">Attach saved creative outputs fast</h3>
                            </div>
                            <div className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-semibold text-slate-600">
                                {dashboard?.recentMedia.length || 0} asset(s)
                            </div>
                        </div>

                        <div className="mt-5 space-y-3">
                            {dashboard?.recentMedia.length ? dashboard.recentMedia.map((asset) => (
                                <button
                                    key={asset.id}
                                    type="button"
                                    onClick={() => {
                                        setMediaUrl(asset.assetUrl || "");
                                        setSendMode(asset.type === "video" ? "video" : "photo");
                                    }}
                                    className="group flex w-full items-start gap-3 rounded-[22px] border border-slate-200 bg-slate-50/70 p-4 text-left transition hover:border-sky-200 hover:bg-sky-50/70"
                                >
                                    <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-[16px] ${asset.type === "video" ? "bg-indigo-100 text-indigo-700" : "bg-sky-100 text-sky-700"}`}>
                                        {asset.type === "video" ? <Video className="h-5 w-5" /> : <ImageIcon className="h-5 w-5" />}
                                    </div>
                                    <div className="min-w-0">
                                        <p className="line-clamp-2 text-sm font-semibold text-slate-900">{asset.prompt}</p>
                                        <p className="mt-1 text-xs text-slate-500">
                                            {asset.type} · {formatDateTime(asset.createdAt)}
                                        </p>
                                    </div>
                                </button>
                            )) : (
                                <div className="rounded-[24px] border border-dashed border-slate-200 bg-slate-50/70 p-5 text-sm text-slate-500">
                                    As soon as your team generates new media in Media Studio, it will appear here for Telegram pushes.
                                </div>
                            )}
                        </div>

                        <div className="mt-5 rounded-[24px] border border-slate-200 bg-slate-50/80 p-4">
                            <div className="flex items-center gap-2 text-sm font-semibold text-slate-700">
                                <Compass className="h-4 w-4 text-sky-500" />
                                Telegram methods live in this workspace
                            </div>
                            <div className="mt-3 flex flex-wrap gap-2">
                                {(dashboard?.capabilities || []).map((capability) => (
                                    <span key={capability} className="rounded-full border border-white/90 bg-white px-3 py-1 text-[11px] font-semibold text-slate-600">
                                        {capability}
                                    </span>
                                ))}
                            </div>
                        </div>
                    </div>
                </section>
            </div>
        </div>
    );
}

function buildIdleUserConnection(): TelegramUserConnectionState {
    return {
        configured: false,
        connected: false,
        status: "idle",
        recentDialogs: [],
        recentActivity: [],
    };
}
