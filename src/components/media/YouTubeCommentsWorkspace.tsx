"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { useSession } from "next-auth/react";
import { Bot, MessageCircleReply, MessagesSquare, PenSquare, RefreshCcw, SendHorizonal } from "lucide-react";
import toast from "react-hot-toast";
import {
    buildAllBroadcasts,
    formatDateTime,
    statusTone,
    YouTubeCommentsFeed,
    YouTubeDashboard,
    YouTubeLiveChatMessageSummary,
    YouTubeVideoCommentSummary,
} from "@/components/media/youtube/shared";

const COMMENTS_REFRESH_MS = 12000;

function buildReplyKey(kind: "live" | "comment", id: string) {
    return `${kind}:${id}`;
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
    const [aiLoadingKey, setAiLoadingKey] = useState<string | null>(null);
    const [sendLoadingKey, setSendLoadingKey] = useState<string | null>(null);

    const allBroadcasts = useMemo(() => buildAllBroadcasts(dashboard), [dashboard]);
    const selectedBroadcast = useMemo(
        () => allBroadcasts.find((broadcast) => broadcast.id === selectedBroadcastId) || null,
        [allBroadcasts, selectedBroadcastId]
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

    const loadComments = async (quiet = false) => {
        if (!selectedBroadcastId) {
            setCommentsFeed(null);
            return;
        }

        if (!quiet) setCommentsLoading(true);
        try {
            const response = await fetch(`/api/youtube/comments?broadcastId=${encodeURIComponent(selectedBroadcastId)}`, {
                cache: "no-store",
            });
            const data = await response.json().catch(() => ({}));
            if (!response.ok) {
                throw new Error(data.error || "Failed to load YouTube comments.");
            }
            setCommentsFeed(data as YouTubeCommentsFeed);
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
        setAiLoadingKey(options.key);
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
            setAiLoadingKey(null);
        }
    };

    const handleSendReply = async (options: {
        key: string;
        liveChatId?: string;
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
            const response = await fetch("/api/youtube/comments/reply", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({
                    messageText,
                    liveChatId: options.liveChatId,
                    parentCommentId: options.parentCommentId,
                    parentThreadId: options.parentThreadId,
                    videoId: options.videoId,
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
            await loadComments(true);
            await loadDashboard(true);
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
            return;
        }
        void loadComments();
    }, [selectedBroadcastId]);

    useEffect(() => {
        if (!selectedBroadcastId) return;
        const timer = window.setInterval(() => {
            void loadComments(true);
            void loadDashboard(true);
        }, commentsFeed?.liveChat?.pollingIntervalMillis || COMMENTS_REFRESH_MS);
        return () => window.clearInterval(timer);
    }, [selectedBroadcastId, commentsFeed?.liveChat?.pollingIntervalMillis]);

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
                            void loadComments();
                        }}
                        className="btn btn-ghost mt-4 text-xs"
                    >
                        <RefreshCcw className="mr-2 h-4 w-4" />
                        {dashboardLoading || commentsLoading ? "Refreshing..." : "Refresh desk"}
                    </button>
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
                                            loadingAi={aiLoadingKey === key}
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
                                            loadingAi={aiLoadingKey === key}
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
                            placeholder="Write or generate a reply..."
                        />
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
                            placeholder="Write or generate a reply..."
                        />
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
