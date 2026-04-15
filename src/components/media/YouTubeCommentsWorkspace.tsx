"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { useSession } from "next-auth/react";
import { Bot, LoaderCircle, MessageCircleReply, MessagesSquare, PenSquare, PlaySquare, RefreshCcw, SendHorizonal } from "lucide-react";
import toast from "react-hot-toast";
import {
    buildAllBroadcasts,
    formatDateTime,
    formatPercent,
    statusTone,
    usePageVisibility,
    YouTubeCommentsFeed,
    YouTubeDashboard,
    YouTubeLiveChatMessageSummary,
    YouTubeVideoCommentSummary,
    YouTubeVideoCommentReplySummary,
} from "@/components/media/youtube/shared";

const COMMENTS_REFRESH_MS = 8000;
const COMMENTS_IDLE_REFRESH_MS = 60000;
const COMMENTS_VIDEO_REFRESH_ACTIVE_MS = 25000;
const COMMENTS_DASHBOARD_REFRESH_MS = 150000;

function buildReplyKey(kind: "live" | "comment", id: string) {
    return `${kind}:${id}`;
}

function normalizeMentionName(value: string | undefined) {
    return String(value || "").trim().replace(/^@+/, "");
}

function escapeRegExp(value: string) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function stripRepeatedLeadingMention(messageText: string, authorName?: string) {
    const trimmed = String(messageText || "").trim();
    const normalizedAuthor = normalizeMentionName(authorName);
    if (!trimmed || !normalizedAuthor) return trimmed;
    const mentionPattern = new RegExp(`^(?:@+${escapeRegExp(normalizedAuthor)}\\s+)+`, "i");
    return trimmed.replace(mentionPattern, "").trim();
}

function ensureTaggedReply(messageText: string, authorName?: string) {
    const trimmed = stripRepeatedLeadingMention(messageText, authorName);
    const normalizedAuthor = normalizeMentionName(authorName);
    if (!trimmed || !normalizedAuthor) return trimmed;
    return `@${normalizedAuthor} ${trimmed}`.trim();
}

function mergeLiveMessages(
    current: YouTubeLiveChatMessageSummary[],
    incoming: YouTubeLiveChatMessageSummary[]
) {
    const merged = new Map<string, YouTubeLiveChatMessageSummary>();
    [...current, ...incoming]
        .sort(
            (left, right) =>
                new Date(left.publishedAt || 0).getTime() - new Date(right.publishedAt || 0).getTime()
        )
        .forEach((message) => {
            merged.set(message.id, message);
        });

    return Array.from(merged.values()).slice(-120);
}

function buildLocalLiveMessage(
    messageText: string,
    authorName: string
): YouTubeLiveChatMessageSummary {
    return {
        id: `local_live_${Date.now()}`,
        type: "textMessageEvent",
        publishedAt: new Date().toISOString(),
        messageText,
        authorName,
        isOwner: true,
        isModerator: false,
        isSponsor: false,
        isVerified: false,
    };
}

function buildLocalCommentReply(
    messageText: string,
    authorName: string,
    parentId?: string
): YouTubeVideoCommentReplySummary {
    return {
        id: `local_reply_${Date.now()}`,
        parentId,
        text: messageText,
        publishedAt: new Date().toISOString(),
        authorName,
    };
}

function buildLocalCommentThread(
    messageText: string,
    authorName: string,
    videoId: string
): YouTubeVideoCommentSummary {
    const localId = `local_thread_${Date.now()}`;
    return {
        id: localId,
        threadId: localId,
        videoId,
        text: messageText,
        publishedAt: new Date().toISOString(),
        likeCount: 0,
        replyCount: 0,
        canReply: true,
        authorName,
        replies: [],
    };
}

function mergeVideoComments(
    current: YouTubeVideoCommentSummary[],
    incoming: YouTubeVideoCommentSummary[]
) {
    const normalizedIncoming = [...incoming].sort(
        (left, right) => new Date(right.publishedAt || 0).getTime() - new Date(left.publishedAt || 0).getTime()
    );

    const optimisticToKeep = current.filter((comment) => {
        if (!comment.id.startsWith("local_thread_")) return false;
        return !normalizedIncoming.some(
            (incomingComment) =>
                incomingComment.authorName === comment.authorName &&
                incomingComment.text === comment.text &&
                incomingComment.videoId === comment.videoId
        );
    });

    return [...optimisticToKeep, ...normalizedIncoming];
}

export function YouTubeCommentsWorkspace() {
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
    const [commentsFeed, setCommentsFeed] = useState<YouTubeCommentsFeed | null>(null);
    const [dashboardLoading, setDashboardLoading] = useState(false);
    const [commentsLoading, setCommentsLoading] = useState(false);
    const [action, setAction] = useState<"connect" | "reply" | null>(null);
    const [selectedBroadcastId, setSelectedBroadcastId] = useState("");
    const [replyDrafts, setReplyDrafts] = useState<Record<string, string>>({});
    const [newThreadDraft, setNewThreadDraft] = useState("");
    const [aiLoadingKeys, setAiLoadingKeys] = useState<string[]>([]);
    const [sendLoadingKey, setSendLoadingKey] = useState<string | null>(null);
    const [lastFeedSyncAt, setLastFeedSyncAt] = useState<string | null>(null);
    const pageVisible = usePageVisibility();

    const allBroadcasts = useMemo(() => buildAllBroadcasts(dashboard), [dashboard]);
    const selectedBroadcast = useMemo(
        () => allBroadcasts.find((broadcast) => broadcast.id === selectedBroadcastId) || null,
        [allBroadcasts, selectedBroadcastId]
    );
    const quotaBlocked = Boolean(
        dashboard?.quota.exhausted &&
        dashboard?.quota.nextResetAt &&
        new Date(dashboard.quota.nextResetAt).getTime() > Date.now()
    );

    const loadDashboard = async (quiet = false) => {
        if (!quiet) setDashboardLoading(true);
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
            if (!quiet) setDashboardLoading(false);
        }
    };

    const loadComments = async (options?: {
        quiet?: boolean;
        liveOnly?: boolean;
        commentsOnly?: boolean;
        resetLivePageToken?: boolean;
    }) => {
        const quiet = options?.quiet || false;
        if (!selectedBroadcastId) {
            setCommentsFeed(null);
            return;
        }
        if (quotaBlocked) {
            if (!quiet) {
                toast.error(
                    `YouTube quota is exhausted right now. Comments should resume around ${formatDateTime(dashboard?.quota.nextResetAt)}.`
                );
            }
            return;
        }

        if (!quiet) setCommentsLoading(true);
        try {
            const params = new URLSearchParams({
                broadcastId: selectedBroadcastId,
            });
            if (options?.liveOnly) {
                params.set("includeVideoComments", "0");
            }
            if (options?.commentsOnly) {
                params.set("includeLiveChat", "0");
            }
            const pageToken =
                options?.resetLivePageToken || options?.commentsOnly
                    ? ""
                    : commentsFeed?.liveChat?.nextPageToken || "";
            if (pageToken) {
                params.set("liveChatPageToken", pageToken);
            }

            const response = await fetch(`/api/youtube/comments?${params.toString()}`, {
                cache: "no-store",
            });
            const data = await response.json().catch(() => ({}));
            if (!response.ok) {
                throw new Error(data.error || "Failed to load YouTube comments.");
            }
            const nextFeed = data as YouTubeCommentsFeed;
            setLastFeedSyncAt(nextFeed.syncedAt || new Date().toISOString());
            setCommentsFeed((current) => {
                if (!current || options?.resetLivePageToken || (!options?.liveOnly && !options?.commentsOnly)) {
                    return nextFeed;
                }

                return {
                    ...current,
                    broadcast: nextFeed.broadcast || current.broadcast,
                    liveChat:
                        nextFeed.liveChatFetched === false
                            ? current.liveChat
                            : {
                                ...current.liveChat,
                                enabled: nextFeed.liveChat.enabled,
                                nextPageToken: nextFeed.liveChat.nextPageToken,
                                pollingIntervalMillis:
                                    nextFeed.liveChat.pollingIntervalMillis || current.liveChat.pollingIntervalMillis,
                                messages: mergeLiveMessages(current.liveChat.messages, nextFeed.liveChat.messages || []),
                            },
                    videoComments:
                        nextFeed.videoCommentsFetched === false
                            ? current.videoComments
                            : mergeVideoComments(current.videoComments, nextFeed.videoComments),
                    syncedAt: nextFeed.syncedAt,
                    liveChatFetched: nextFeed.liveChatFetched,
                    videoCommentsFetched: nextFeed.videoCommentsFetched,
                };
            });
        } catch (error: any) {
            console.error(error);
            if (!quiet) {
                toast.error(error.message || "Failed to load YouTube comments.");
            }
        } finally {
            if (!quiet) setCommentsLoading(false);
        }
    };

    const handleConnectYouTube = (mode: "connect" | "poll" = "connect") => {
        setAction("connect");
        window.location.href = `/api/youtube/connect?returnTo=${encodeURIComponent("/content-studio/youtube/comments")}&mode=${mode}`;
    };

    const setDraft = (key: string, value: string) => {
        setReplyDrafts((current) => ({ ...current, [key]: value }));
    };

    const handleGenerateReply = async (options: {
        key: string;
        commentText: string;
        commentAuthorName: string;
        commentKind: string;
    }) => {
        setAiLoadingKeys((current) => (current.includes(options.key) ? current : [...current, options.key]));
        try {
            const response = await fetch("/api/youtube/comments/suggest", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({
                    commentText: options.commentText,
                    commentAuthorName: options.commentAuthorName,
                    commentKind: options.commentKind,
                    broadcastTitle: commentsFeed?.broadcast?.title || selectedBroadcast?.title || "",
                }),
            });
            const data = await response.json().catch(() => ({}));
            if (!response.ok) {
                throw new Error(data.error || "Failed to generate AI reply.");
            }
            setDraft(options.key, String(data.reply || ""));
        } catch (error: any) {
            console.error(error);
            toast.error(error.message || "Failed to generate AI reply.");
        } finally {
            setAiLoadingKeys((current) => current.filter((key) => key !== options.key));
        }
    };

    const handleSendReply = async (options: {
        key: string;
        liveChatId?: string;
        broadcastId?: string;
        parentCommentId?: string;
        parentThreadId?: string;
        videoId?: string;
        authorName?: string;
    }) => {
        const messageText = String(
            options.videoId && !options.parentCommentId
                ? newThreadDraft
                : replyDrafts[options.key] || ""
        ).trim();
        if (!messageText) {
            toast.error(options.videoId && !options.parentCommentId ? "Write a comment first." : "Write or generate a reply first.");
            return;
        }

        setSendLoadingKey(options.key);
        try {
            const finalMessageText =
                options.parentCommentId
                    ? ensureTaggedReply(messageText, options.authorName)
                    : messageText;

            const response = await fetch("/api/youtube/comments/reply", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({
                    messageText: finalMessageText,
                    liveChatId: options.liveChatId,
                    broadcastId: options.broadcastId,
                    parentCommentId: options.parentCommentId,
                    parentThreadId: options.parentThreadId,
                    videoId: options.videoId,
                    authorName: options.authorName,
                }),
            });
            const data = await response.json().catch(() => ({}));
            if (!response.ok) {
                if (data.code === "youtube_scope_upgrade_required") {
                    toast.error("Extra YouTube permission is required for replies. Redirecting to approval.");
                    handleConnectYouTube("poll");
                    return;
                }
                throw new Error(data.error || "Failed to send reply.");
            }
            const sentText = String(data.sentText || finalMessageText || messageText).trim();
            const ownAuthorName = dashboard?.channel?.title || "Institute Team";
            toast.success(
                options.liveChatId
                    ? "Message posted to live chat."
                    : options.parentCommentId
                        ? `Reply posted under ${options.authorName || "that viewer"}'s comment.`
                        : "New public comment posted."
            );
            if (options.videoId && !options.parentCommentId) {
                setNewThreadDraft("");
            } else {
                setReplyDrafts((current) => {
                    const next = { ...current };
                    delete next[options.key];
                    return next;
                });
            }
            setLastFeedSyncAt(new Date().toISOString());
            setCommentsFeed((current) => {
                if (!current) return current;

                if (options.liveChatId) {
                    return {
                        ...current,
                        liveChat: {
                            ...current.liveChat,
                            messages: mergeLiveMessages(current.liveChat.messages, [
                                buildLocalLiveMessage(sentText, ownAuthorName),
                            ]),
                        },
                    };
                }

                if (options.parentCommentId) {
                    return {
                        ...current,
                        videoComments: current.videoComments.map((comment) =>
                            comment.id === options.parentCommentId
                                ? {
                                    ...comment,
                                    replyCount: comment.replyCount + 1,
                                    replies: [
                                        buildLocalCommentReply(sentText, ownAuthorName, comment.id),
                                        ...comment.replies,
                                    ],
                                }
                                : comment
                        ),
                    };
                }

                if (options.videoId) {
                    const localThread = buildLocalCommentThread(sentText, ownAuthorName, options.videoId);
                    return {
                        ...current,
                        videoComments: [
                            localThread,
                            ...current.videoComments,
                        ],
                    };
                }

                return current;
            });
            void loadComments({
                quiet: true,
                liveOnly: Boolean(options.liveChatId),
                commentsOnly: Boolean(options.parentCommentId || options.videoId),
                resetLivePageToken: Boolean(options.videoId || options.parentCommentId),
            });
            void loadDashboard(true);
        } catch (error: any) {
            console.error(error);
            toast.error(error.message || "Failed to send reply.");
        } finally {
            setSendLoadingKey(null);
        }
    };

    useEffect(() => {
        if (!hasAccess) return;
        void loadDashboard();
    }, [hasAccess]);

    useEffect(() => {
        if (allBroadcasts.length === 0) {
            setSelectedBroadcastId("");
            return;
        }
        if (selectedBroadcastId && allBroadcasts.some((broadcast) => broadcast.id === selectedBroadcastId)) {
            return;
        }
        const nextBroadcast =
            dashboard?.liveBroadcasts.active[0] ||
            dashboard?.liveBroadcasts.upcoming[0] ||
            dashboard?.liveBroadcasts.completed[0] ||
            null;
        setSelectedBroadcastId(nextBroadcast?.id || "");
    }, [allBroadcasts, dashboard, selectedBroadcastId]);

    useEffect(() => {
        if (!selectedBroadcastId) {
            setCommentsFeed(null);
            setLastFeedSyncAt(null);
            return;
        }
        if (quotaBlocked) {
            return;
        }
        void loadComments({ resetLivePageToken: true });
    }, [selectedBroadcastId, quotaBlocked]);

    useEffect(() => {
        if (!selectedBroadcastId) return;
        if (quotaBlocked) return;
        if (!pageVisible) return;
        if (!commentsFeed?.liveChat?.enabled) return;
        const refreshMs = Math.max(commentsFeed.liveChat.pollingIntervalMillis || COMMENTS_REFRESH_MS, COMMENTS_REFRESH_MS);
        const timer = window.setTimeout(() => {
            void loadComments({ quiet: true, liveOnly: true });
        }, refreshMs);
        return () => window.clearTimeout(timer);
    }, [selectedBroadcastId, commentsFeed?.liveChat?.enabled, commentsFeed?.liveChat?.pollingIntervalMillis, commentsFeed?.liveChat?.nextPageToken, pageVisible, quotaBlocked]);

    useEffect(() => {
        if (!selectedBroadcastId) return;
        if (quotaBlocked) return;
        if (!pageVisible) return;
        const refreshMs = commentsFeed?.liveChat?.enabled ? COMMENTS_VIDEO_REFRESH_ACTIVE_MS : COMMENTS_IDLE_REFRESH_MS;
        const timer = window.setTimeout(() => {
            void loadComments({ quiet: true, commentsOnly: true, resetLivePageToken: true });
        }, refreshMs);
        return () => window.clearTimeout(timer);
    }, [selectedBroadcastId, commentsFeed?.liveChat?.enabled, commentsFeed?.videoComments.length, pageVisible, quotaBlocked, lastFeedSyncAt]);

    useEffect(() => {
        if (!hasAccess) return;
        if (quotaBlocked) return;
        if (!pageVisible) return;
        const timer = window.setInterval(() => {
            void loadDashboard(true);
        }, COMMENTS_DASHBOARD_REFRESH_MS);
        return () => window.clearInterval(timer);
    }, [hasAccess, pageVisible, quotaBlocked]);

    useEffect(() => {
        if (!pageVisible || !selectedBroadcastId || quotaBlocked) return;
        void loadComments({ quiet: true, resetLivePageToken: true });
    }, [pageVisible, selectedBroadcastId, quotaBlocked]);

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
        router.replace("/content-studio/youtube/comments");
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
    const activeBroadcastForView = commentsFeed?.broadcast || selectedBroadcast;
    const playerVideoId = activeBroadcastForView?.id || "";
    const playerEmbedUrl = playerVideoId
        ? `https://www.youtube.com/embed/${encodeURIComponent(playerVideoId)}?autoplay=0&rel=0&modestbranding=1`
        : "";

    return (
        <section className="grid grid-cols-1 gap-5 xl:grid-cols-[360px,minmax(0,1fr)]">
            <article className="space-y-5">
                <div className="overflow-hidden rounded-[30px] border border-sky-100 bg-[linear-gradient(180deg,#eff6ff,#fff)] p-5 shadow-[0_24px_60px_rgba(15,23,42,0.08)]">
                    <div className="inline-flex items-center gap-2 rounded-full border border-sky-200 bg-white px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.24em] text-sky-700">
                        <MessagesSquare className="h-4 w-4" />
                        Comment Desk
                    </div>
                    <h3 className="mt-4 text-2xl font-semibold text-slate-950">Live chat + video comment workflow</h3>
                    <p className="mt-2 text-sm leading-6 text-slate-600">
                        Monitor live stream conversations, generate institute-aware replies, and send them from one realtime desk.
                    </p>
                    <button
                        type="button"
                        onClick={() => {
                            void loadDashboard();
                            void loadComments({ resetLivePageToken: true });
                        }}
                        className="btn btn-ghost mt-4 text-xs"
                    >
                        <RefreshCcw className="mr-2 h-4 w-4" />
                        {dashboardLoading || commentsLoading ? "Refreshing..." : "Refresh desk"}
                    </button>
                    <p className="mt-3 text-[11px] text-slate-500">
                        {quotaBlocked
                            ? `Auto refresh paused until quota resets around ${formatDateTime(dashboard?.quota.nextResetAt)}`
                            : pageVisible
                            ? `Live chat refresh follows YouTube polling guidance. Dashboard sync every ${Math.round(COMMENTS_DASHBOARD_REFRESH_MS / 1000)}s.`
                            : "Auto refresh paused while this tab is hidden"}
                    </p>
                </div>

                <div className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-[0_24px_60px_rgba(15,23,42,0.08)]">
                    <div className="flex items-center justify-between gap-3">
                        <div>
                            <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-500">Reply controls</p>
                            <h3 className="mt-2 text-lg font-semibold text-slate-950">
                                {dashboard?.channel?.title || "Connect YouTube"}
                            </h3>
                        </div>
                        <span className="status-badge">
                            {dashboard?.connected ? "Connected" : dashboardLoading ? "Loading" : "Disconnected"}
                        </span>
                    </div>
                    <div className="mt-4 flex flex-wrap gap-2">
                        {!dashboard?.connected ? (
                            <button
                                type="button"
                                onClick={() => handleConnectYouTube("connect")}
                                disabled={action !== null}
                                className="btn btn-primary text-xs"
                            >
                                {action === "connect" ? "Redirecting..." : "Connect YouTube"}
                            </button>
                        ) : !dashboard.canManageLiveChat ? (
                            <button
                                type="button"
                                onClick={() => handleConnectYouTube("poll")}
                                disabled={action !== null}
                                className="btn btn-secondary text-xs"
                            >
                                Enable comment replies
                            </button>
                        ) : (
                            <div className="tool-chip bg-emerald-100 text-emerald-700 border-emerald-200">
                                Reply permissions ready
                            </div>
                        )}
                    </div>
                    {dashboard?.warning && (
                        <p className="mt-3 text-xs text-amber-700">{dashboard.warning}</p>
                    )}
                </div>

                <div className="rounded-[28px] border border-amber-100 bg-[linear-gradient(180deg,#fffaf0,#fff)] p-5 shadow-[0_24px_60px_rgba(15,23,42,0.08)]">
                    <div className="flex items-start justify-between gap-3">
                        <div>
                            <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-500">Quota guard</p>
                            <h3 className="mt-2 text-lg font-semibold text-slate-950">{formatPercent(quota.usagePercent)} used today</h3>
                        </div>
                        <span className="status-badge">{quota.usedUnits}/{quota.dailyLimit}</span>
                    </div>
                    <div className="mt-4 h-2.5 overflow-hidden rounded-full bg-slate-100">
                        <div
                            className={`h-full rounded-full ${
                                quota.usagePercent >= 80
                                    ? "bg-[linear-gradient(90deg,#ef4444,#f97316)]"
                                    : quota.usagePercent >= 50
                                        ? "bg-[linear-gradient(90deg,#f59e0b,#f97316)]"
                                        : "bg-[linear-gradient(90deg,#22c55e,#84cc16)]"
                            }`}
                            style={{ width: `${Math.min(quota.usagePercent, 100)}%` }}
                        />
                    </div>
                    {quota.topConsumers[0] && (
                        <p className="mt-3 text-xs text-slate-600">
                            Current top consumer: <span className="font-semibold text-slate-900">{quota.topConsumers[0].label}</span>
                        </p>
                    )}
                    {quota.nextResetAt && (
                        <p className="mt-2 text-xs text-slate-500">
                            Next reset window: {formatDateTime(quota.nextResetAt)}
                        </p>
                    )}
                </div>

                <div className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-[0_24px_60px_rgba(15,23,42,0.08)]">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-500">Stream selector</p>
                    <div className="mt-4 space-y-3 max-h-[72vh] overflow-auto pr-1">
                        {allBroadcasts.length === 0 ? (
                            <div className="rounded-[24px] border border-dashed border-slate-200 bg-slate-50 p-8 text-center">
                                <p className="text-lg font-semibold text-slate-900">No streams loaded</p>
                                <p className="mt-2 text-sm text-slate-500">
                                    Active, upcoming, and completed streams will appear here after connection.
                                </p>
                            </div>
                        ) : (
                            allBroadcasts.map((broadcast) => (
                                <button
                                    key={broadcast.id}
                                    type="button"
                                    onClick={() => setSelectedBroadcastId(broadcast.id)}
                                    className={`w-full rounded-[24px] border p-4 text-left transition ${
                                        selectedBroadcastId === broadcast.id
                                            ? "border-sky-200 bg-sky-50 shadow-[0_18px_40px_rgba(59,130,246,0.12)]"
                                            : "border-slate-200 bg-[linear-gradient(180deg,#fff,#f8fafc)] hover:border-slate-300"
                                    }`}
                                >
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
                                </button>
                            ))
                        )}
                    </div>
                </div>
            </article>

            <article className="space-y-5">
                <div className="rounded-[30px] border border-slate-200 bg-white p-5 shadow-[0_24px_60px_rgba(15,23,42,0.08)]">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                        <div>
                            <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-500">Realtime context</p>
                            <h3 className="mt-2 text-xl font-semibold text-slate-950">
                                {commentsFeed?.broadcast?.title || selectedBroadcast?.title || "No stream selected"}
                            </h3>
                            <p className="mt-2 text-sm text-slate-500">
                                {commentsFeed?.broadcast?.status === "active"
                                    ? `Live since ${formatDateTime(commentsFeed.broadcast.actualStartTime || commentsFeed.broadcast.scheduledStartTime)}`
                                    : commentsFeed?.broadcast?.status === "upcoming"
                                        ? `Scheduled for ${formatDateTime(commentsFeed.broadcast.scheduledStartTime)}`
                                        : commentsFeed?.broadcast
                                            ? `Ended ${formatDateTime(commentsFeed.broadcast.actualEndTime || commentsFeed.broadcast.actualStartTime)}`
                                            : "Select a broadcast from the left side."}
                            </p>
                            <p className="mt-2 text-xs text-slate-400">
                                {commentsLoading
                                    ? "Syncing comments now..."
                                    : lastFeedSyncAt
                                        ? `Last synced ${formatDateTime(lastFeedSyncAt)}`
                                        : "Waiting for first sync"}
                            </p>
                        </div>
                        <div className="flex flex-wrap gap-2">
                            {commentsFeed?.broadcast?.concurrentViewers && (
                                <span className="tool-chip">{commentsFeed.broadcast.concurrentViewers} viewers</span>
                            )}
                            {commentsFeed?.broadcast?.commentCount && (
                                <span className="tool-chip">{commentsFeed.broadcast.commentCount} comments</span>
                            )}
                            {commentsFeed?.broadcast?.activePoll?.id && (
                                <span className="tool-chip bg-emerald-100 text-emerald-700 border-emerald-200">Poll live</span>
                            )}
                        </div>
                    </div>
                </div>

                <div className="grid gap-5 xl:grid-cols-[1.05fr,0.95fr]">
                    <div className="overflow-hidden rounded-[30px] border border-slate-200 bg-white shadow-[0_24px_60px_rgba(15,23,42,0.08)]">
                        <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-5 py-4">
                            <div>
                                <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-500">Selected stream player</p>
                                <h3 className="mt-2 text-xl font-semibold text-slate-950">
                                    {activeBroadcastForView?.title || "No stream selected"}
                                </h3>
                            </div>
                            {activeBroadcastForView?.watchUrl ? (
                                <a
                                    href={activeBroadcastForView.watchUrl}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="btn btn-ghost text-xs"
                                >
                                    <PlaySquare className="mr-2 h-4 w-4" />
                                    Open on YouTube
                                </a>
                            ) : null}
                        </div>

                        {playerEmbedUrl ? (
                            <div className="aspect-video w-full bg-slate-950">
                                <iframe
                                    src={playerEmbedUrl}
                                    title={activeBroadcastForView?.title || "Selected YouTube stream"}
                                    className="h-full w-full"
                                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                                    allowFullScreen
                                />
                            </div>
                        ) : (
                            <div className="flex aspect-video items-center justify-center bg-[linear-gradient(180deg,#f8fafc,#eef2ff)] px-6 text-center text-sm text-slate-500">
                                Select any stream from the left to preview it here with full YouTube controls.
                            </div>
                        )}
                    </div>

                    <div className="rounded-[30px] border border-slate-200 bg-white p-5 shadow-[0_24px_60px_rgba(15,23,42,0.08)]">
                        <div className="flex items-center justify-between gap-3">
                            <div>
                                <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-500">Sync pulse</p>
                                <h3 className="mt-2 text-xl font-semibold text-slate-950">Fast but quota-aware</h3>
                            </div>
                            {commentsLoading ? (
                                <span className="inline-flex items-center gap-2 rounded-full border border-sky-200 bg-sky-50 px-3 py-1 text-[11px] font-semibold text-sky-700">
                                    <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
                                    Syncing
                                </span>
                            ) : (
                                <span className="inline-flex items-center gap-2 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-[11px] font-semibold text-emerald-700">
                                    <span className="h-2 w-2 rounded-full bg-emerald-500" />
                                    Live
                                </span>
                            )}
                        </div>
                        <div className="mt-5 grid gap-3 sm:grid-cols-2">
                            <div className="rounded-[22px] border border-slate-200 bg-[linear-gradient(180deg,#fff,#f8fafc)] p-4">
                                <p className="text-[10px] font-semibold uppercase tracking-[0.24em] text-slate-500">Chat cadence</p>
                                <p className="mt-2 text-sm font-semibold text-slate-950">
                                    {commentsFeed?.liveChat?.enabled
                                        ? `${Math.max(commentsFeed.liveChat.pollingIntervalMillis || COMMENTS_REFRESH_MS, COMMENTS_REFRESH_MS) / 1000}s guided refresh`
                                        : `Idle ${COMMENTS_IDLE_REFRESH_MS / 1000}s`}
                                </p>
                                <p className="mt-2 text-xs text-slate-500">
                                    Live chat uses YouTube pacing. Video comments refresh on a slower separate lane.
                                </p>
                            </div>
                            <div className="rounded-[22px] border border-slate-200 bg-[linear-gradient(180deg,#fff,#f8fafc)] p-4">
                                <p className="text-[10px] font-semibold uppercase tracking-[0.24em] text-slate-500">Reply behavior</p>
                                <p className="mt-2 text-sm font-semibold text-slate-950">Tagged + optimistic</p>
                                <p className="mt-2 text-xs text-slate-500">
                                    Replies auto-tag the viewer name and appear instantly in the desk before background reconciliation.
                                </p>
                            </div>
                        </div>
                    </div>
                </div>

                <div className="grid gap-5 xl:grid-cols-2">
                    <div className="rounded-[30px] border border-slate-200 bg-white p-5 shadow-[0_24px_60px_rgba(15,23,42,0.08)]">
                        <div className="flex items-center justify-between gap-3">
                            <div>
                                <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-500">Live chat</p>
                                <h3 className="mt-2 text-xl font-semibold text-slate-950">Realtime stream messages</h3>
                            </div>
                            <span className="status-badge">
                                {commentsFeed?.liveChat?.enabled ? `${commentsFeed.liveChat.messages.length} loaded` : "Unavailable"}
                            </span>
                        </div>

                        {!commentsFeed ? (
                            <div className="mt-6 rounded-[24px] border border-dashed border-slate-200 bg-slate-50 p-8 text-center">
                                <p className="text-lg font-semibold text-slate-900">Select a stream</p>
                                <p className="mt-2 text-sm text-slate-500">Live chat messages will appear here once a stream is selected.</p>
                            </div>
                        ) : !commentsFeed.liveChat.enabled ? (
                            <div className="mt-6 rounded-[24px] border border-dashed border-slate-200 bg-slate-50 p-8 text-center">
                                <p className="text-lg font-semibold text-slate-900">Live chat is not active</p>
                                <p className="mt-2 text-sm text-slate-500">
                                    For upcoming or completed streams without an active chat, use the video comments panel instead.
                                </p>
                            </div>
                        ) : (
                            <div className="mt-5 space-y-4 max-h-[78vh] overflow-auto pr-1">
                                {commentsFeed.liveChat.messages.map((message) => {
                                    const key = buildReplyKey("live", message.id);
                                    return (
                                        <LiveChatCard
                                            key={message.id}
                                            message={message}
                                            draft={replyDrafts[key] || ""}
                                            loadingAi={aiLoadingKeys.includes(key)}
                                            sending={sendLoadingKey === key}
                                            canReply={Boolean(dashboard?.canManageLiveChat && commentsFeed.broadcast.liveChatId)}
                                            onDraftChange={(value) => setDraft(key, value)}
                                            onAiReply={() =>
                                                void handleGenerateReply({
                                                    key,
                                                    commentText: message.messageText,
                                                    commentAuthorName: message.authorName,
                                                    commentKind: "live chat",
                                                })
                                            }
                                            onSend={() =>
                                                void handleSendReply({
                                                    key,
                                                    liveChatId: commentsFeed.broadcast.liveChatId,
                                                    broadcastId: commentsFeed.broadcast.id,
                                                    authorName: message.authorName,
                                                })
                                            }
                                        />
                                    );
                                })}
                            </div>
                        )}
                    </div>

                    <div className="rounded-[30px] border border-slate-200 bg-white p-5 shadow-[0_24px_60px_rgba(15,23,42,0.08)]">
                        <div className="flex items-center justify-between gap-3">
                            <div>
                                <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-500">Video comments</p>
                                <h3 className="mt-2 text-xl font-semibold text-slate-950">Public comment threads</h3>
                            </div>
                            <span className="status-badge">{commentsFeed?.videoComments.length || 0} threads</span>
                        </div>

                        {!commentsFeed ? (
                            <div className="mt-6 rounded-[24px] border border-dashed border-slate-200 bg-slate-50 p-8 text-center">
                                <p className="text-lg font-semibold text-slate-900">Select a stream</p>
                                <p className="mt-2 text-sm text-slate-500">Comment threads will appear here once a stream is selected.</p>
                            </div>
                        ) : commentsFeed.videoComments.length === 0 ? (
                            <div className="mt-5 space-y-4">
                                <NewCommentThreadCard
                                    draft={newThreadDraft}
                                    sending={sendLoadingKey === "new-thread"}
                                    canReply={Boolean(dashboard?.canManageLiveChat && commentsFeed.broadcast.id)}
                                    onDraftChange={setNewThreadDraft}
                                    onSend={() =>
                                        void handleSendReply({
                                            key: "new-thread",
                                            videoId: commentsFeed.broadcast.id,
                                        })
                                    }
                                />
                                <div className="rounded-[24px] border border-dashed border-slate-200 bg-slate-50 p-8 text-center">
                                    <p className="text-lg font-semibold text-slate-900">No comments found</p>
                                    <p className="mt-2 text-sm text-slate-500">This stream does not have visible comment threads yet.</p>
                                </div>
                            </div>
                        ) : (
                            <div className="mt-5 space-y-4 max-h-[78vh] overflow-auto pr-1">
                                <NewCommentThreadCard
                                    draft={newThreadDraft}
                                    sending={sendLoadingKey === "new-thread"}
                                    canReply={Boolean(dashboard?.canManageLiveChat && commentsFeed.broadcast.id)}
                                    onDraftChange={setNewThreadDraft}
                                    onSend={() =>
                                        void handleSendReply({
                                            key: "new-thread",
                                            videoId: commentsFeed.broadcast.id,
                                        })
                                    }
                                />
                                {commentsFeed.videoComments.map((comment) => {
                                    const key = buildReplyKey("comment", comment.id);
                                    return (
                                        <VideoCommentCard
                                            key={comment.id}
                                            comment={comment}
                                            draft={replyDrafts[key] || ""}
                                            loadingAi={aiLoadingKeys.includes(key)}
                                            sending={sendLoadingKey === key}
                                            canReply={Boolean(dashboard?.canManageLiveChat && comment.canReply)}
                                            onDraftChange={(value) => setDraft(key, value)}
                                            onAiReply={() =>
                                                void handleGenerateReply({
                                                    key,
                                                    commentText: comment.text,
                                                    commentAuthorName: comment.authorName,
                                                    commentKind: "video comment",
                                                })
                                            }
                                            onSend={() =>
                                                void handleSendReply({
                                                    key,
                                                    parentCommentId: comment.id,
                                                    parentThreadId: comment.threadId,
                                                    authorName: comment.authorName,
                                                })
                                            }
                                        />
                                    );
                                })}
                            </div>
                        )}
                    </div>
                </div>
            </article>
        </section>
    );
}

function LiveChatCard(props: {
    message: YouTubeLiveChatMessageSummary;
    draft: string;
    loadingAi: boolean;
    sending: boolean;
    canReply: boolean;
    onDraftChange: (value: string) => void;
    onAiReply: () => void;
    onSend: () => void;
}) {
    return (
        <div className="rounded-[24px] border border-slate-200 bg-[linear-gradient(180deg,#fff,#f8fafc)] p-4">
            <div className="flex items-start gap-3">
                {props.message.authorProfileImageUrl ? (
                    <img
                        src={props.message.authorProfileImageUrl}
                        alt={props.message.authorName}
                        className="h-11 w-11 rounded-2xl border border-slate-200 object-cover"
                    />
                ) : (
                    <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-slate-100 text-xs font-semibold text-slate-600">
                        {props.message.authorName.slice(0, 1).toUpperCase()}
                    </div>
                )}
                <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                        <p className="text-sm font-semibold text-slate-950">{props.message.authorName}</p>
                        {props.message.isOwner && <span className="tool-chip bg-red-100 text-red-700 border-red-200">Owner</span>}
                        {props.message.isModerator && <span className="tool-chip bg-indigo-100 text-indigo-700 border-indigo-200">Moderator</span>}
                        {props.message.isVerified && <span className="tool-chip bg-emerald-100 text-emerald-700 border-emerald-200">Verified</span>}
                    </div>
                    <p className="mt-1 text-xs text-slate-500">{formatDateTime(props.message.publishedAt)}</p>
                    <p className="mt-3 text-sm leading-6 text-slate-700">{props.message.messageText}</p>
                    {props.message.amountText && (
                        <p className="mt-2 text-xs font-semibold text-emerald-700">{props.message.amountText}</p>
                    )}

                    <div className="mt-4 space-y-3">
                        <textarea
                            value={props.draft}
                            onChange={(event) => props.onDraftChange(event.target.value)}
                            rows={3}
                            className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-3 text-sm text-slate-700 outline-none transition focus:border-sky-300"
                            placeholder={`Reply to @${normalizeMentionName(props.message.authorName)}...`}
                        />
                        {props.loadingAi && (
                            <div className="flex items-center gap-2 rounded-2xl border border-sky-100 bg-sky-50 px-3 py-2 text-[11px] font-medium text-sky-700">
                                <span className="h-2 w-2 animate-pulse rounded-full bg-sky-500" />
                                Gemini is preparing a reply for this comment card only.
                            </div>
                        )}
                        <div className="flex flex-wrap gap-2">
                            <button type="button" onClick={props.onAiReply} className="btn btn-secondary text-xs" disabled={props.loadingAi}>
                                <Bot className="mr-2 h-4 w-4" />
                                {props.loadingAi ? "Generating..." : "AI Reply"}
                            </button>
                            <button type="button" onClick={props.onSend} className="btn btn-primary text-xs" disabled={!props.canReply || props.sending}>
                                <SendHorizonal className="mr-2 h-4 w-4" />
                                {props.sending ? "Sending..." : "Send to Chat"}
                            </button>
                        </div>
                        {!props.canReply && (
                            <p className="text-[11px] text-amber-700">
                                Enable the extra YouTube manage permission to post messages from this workspace.
                            </p>
                        )}
                        <p className="text-[11px] text-slate-500">
                            YouTube live chat does not support threaded replies, so this sends a normal chat message.
                        </p>
                    </div>
                </div>
            </div>
        </div>
    );
}

function NewCommentThreadCard(props: {
    draft: string;
    sending: boolean;
    canReply: boolean;
    onDraftChange: (value: string) => void;
    onSend: () => void;
}) {
    return (
        <div className="rounded-[24px] border border-slate-200 bg-[linear-gradient(180deg,#fff,#f8fafc)] p-4">
            <div className="flex items-start gap-3">
                <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-sky-50 text-sky-600">
                    <PenSquare className="h-5 w-5" />
                </div>
                <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                        <p className="text-sm font-semibold text-slate-950">New public comment</p>
                        <span className="tool-chip">Fresh thread</span>
                    </div>
                    <p className="mt-2 text-xs text-slate-500">
                        Use this only when you want to start a new public comment thread on the video.
                    </p>
                    <div className="mt-4 space-y-3">
                        <textarea
                            value={props.draft}
                            onChange={(event) => props.onDraftChange(event.target.value)}
                            rows={3}
                            className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-3 text-sm text-slate-700 outline-none transition focus:border-sky-300"
                            placeholder="Write a fresh public comment..."
                        />
                        <div className="flex flex-wrap gap-2">
                            <button type="button" onClick={props.onSend} className="btn btn-secondary text-xs" disabled={!props.canReply || props.sending}>
                                <PenSquare className="mr-2 h-4 w-4" />
                                {props.sending ? "Posting..." : "Post New Thread"}
                            </button>
                        </div>
                        {!props.canReply && (
                            <p className="text-[11px] text-amber-700">
                                Enable the extra YouTube manage permission to post public comments from this workspace.
                            </p>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}

function VideoCommentCard(props: {
    comment: YouTubeVideoCommentSummary;
    draft: string;
    loadingAi: boolean;
    sending: boolean;
    canReply: boolean;
    onDraftChange: (value: string) => void;
    onAiReply: () => void;
    onSend: () => void;
}) {
    return (
        <div className="rounded-[24px] border border-slate-200 bg-[linear-gradient(180deg,#fff,#f8fafc)] p-4">
            <div className="flex items-start gap-3">
                {props.comment.authorProfileImageUrl ? (
                    <img
                        src={props.comment.authorProfileImageUrl}
                        alt={props.comment.authorName}
                        className="h-11 w-11 rounded-2xl border border-slate-200 object-cover"
                    />
                ) : (
                    <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-slate-100 text-xs font-semibold text-slate-600">
                        {props.comment.authorName.slice(0, 1).toUpperCase()}
                    </div>
                )}
                <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                        <p className="text-sm font-semibold text-slate-950">{props.comment.authorName}</p>
                        <span className="tool-chip">{props.comment.replyCount} replies</span>
                        {typeof props.comment.likeCount === "number" && <span className="tool-chip">{props.comment.likeCount} likes</span>}
                    </div>
                    <p className="mt-1 text-xs text-slate-500">{formatDateTime(props.comment.publishedAt)}</p>
                    <p className="mt-3 text-sm leading-6 text-slate-700">{props.comment.text}</p>
                    <p className="mt-2 text-[11px] font-medium text-sky-700">
                        Sending here goes as a reply under {props.comment.authorName}&apos;s existing YouTube comment.
                    </p>

                    {props.comment.replies.length > 0 && (
                        <div className="mt-4 space-y-2 rounded-2xl border border-slate-200 bg-white p-3">
                            {props.comment.replies.slice(0, 3).map((reply) => (
                                <div key={reply.id} className="rounded-2xl bg-slate-50 px-3 py-2">
                                    <p className="text-xs font-semibold text-slate-900">{reply.authorName}</p>
                                    <p className="mt-1 text-xs text-slate-600">{reply.text}</p>
                                </div>
                            ))}
                        </div>
                    )}

                    <div className="mt-4 space-y-3">
                        <textarea
                            value={props.draft}
                            onChange={(event) => props.onDraftChange(event.target.value)}
                            rows={3}
                            className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-3 text-sm text-slate-700 outline-none transition focus:border-sky-300"
                            placeholder={`Reply to @${normalizeMentionName(props.comment.authorName)}...`}
                        />
                        {props.loadingAi && (
                            <div className="flex items-center gap-2 rounded-2xl border border-sky-100 bg-sky-50 px-3 py-2 text-[11px] font-medium text-sky-700">
                                <span className="h-2 w-2 animate-pulse rounded-full bg-sky-500" />
                                Gemini is drafting a reply here without interrupting the rest of the desk.
                            </div>
                        )}
                        <div className="flex flex-wrap gap-2">
                            <button type="button" onClick={props.onAiReply} className="btn btn-secondary text-xs" disabled={props.loadingAi}>
                                <Bot className="mr-2 h-4 w-4" />
                                {props.loadingAi ? "Generating..." : "AI Reply"}
                            </button>
                            <button type="button" onClick={props.onSend} className="btn btn-primary text-xs" disabled={!props.canReply || props.sending}>
                                <MessageCircleReply className="mr-2 h-4 w-4" />
                                {props.sending ? "Sending..." : `Reply to ${props.comment.authorName}`}
                            </button>
                        </div>
                        {!props.canReply && (
                            <p className="text-[11px] text-amber-700">
                                This comment cannot be replied to right now, or YouTube manage permission is still missing.
                            </p>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}
