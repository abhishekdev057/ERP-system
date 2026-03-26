"use client";

import { useEffect, useState } from "react";

export type YouTubePollSummary = {
    id: string;
    questionText: string;
    status: string;
    options: Array<{
        optionText: string;
        tally?: string;
    }>;
};

export type YouTubeChannelSummary = {
    id: string;
    title: string;
    description: string;
    customUrl?: string;
    thumbnailUrl?: string;
    subscriberCount?: string;
    videoCount?: string;
    viewCount?: string;
};

export type YouTubeVideoSummary = {
    id: string;
    title: string;
    description: string;
    publishedAt?: string;
    thumbnailUrl?: string;
    watchUrl: string;
    viewCount?: string;
    likeCount?: string;
    commentCount?: string;
};

export type YouTubeLiveBroadcastSummary = {
    id: string;
    title: string;
    description: string;
    status: "active" | "upcoming" | "completed";
    lifeCycleStatus?: string;
    privacyStatus?: string;
    liveChatId?: string;
    scheduledStartTime?: string;
    actualStartTime?: string;
    actualEndTime?: string;
    thumbnailUrl?: string;
    watchUrl: string;
    activePoll?: YouTubePollSummary | null;
    concurrentViewers?: string;
    viewCount?: string;
    likeCount?: string;
    commentCount?: string;
};

export type YouTubeAnalyticsSummary = {
    activeBroadcastCount: number;
    upcomingBroadcastCount: number;
    completedBroadcastCount: number;
    uploadsLoadedCount: number;
    activePollCount: number;
    liveViewersNow: number;
    recentUploadViews: number;
    recentUploadLikes: number;
    recentUploadComments: number;
};

export type YouTubeQuotaConsumer = {
    key: string;
    label: string;
    method: string;
    path: string;
    unitsPerCall: number;
    calls: number;
    units: number;
    sharePercent: number;
    lastCalledAt?: string;
};

export type YouTubeQuotaActionGuide = {
    key: string;
    label: string;
    unitsPerCall: number;
    method: string;
    path: string;
    note: string;
};

export type YouTubeQuotaSummary = {
    estimated: boolean;
    dailyLimit: number;
    usedUnits: number;
    remainingUnits: number;
    usagePercent: number;
    exhausted: boolean;
    totalCalls: number;
    dayKey: string;
    timezone: string;
    nextResetAt: string;
    blockedUntil?: string;
    blockedReason?: string;
    topConsumers: YouTubeQuotaConsumer[];
    expensiveActions: YouTubeQuotaActionGuide[];
    warnings: string[];
    lastUpdatedAt?: string;
};

export type YouTubeDashboard = {
    connected: boolean;
    needsReconnect?: boolean;
    canManageLiveChat?: boolean;
    channel?: YouTubeChannelSummary;
    uploads: YouTubeVideoSummary[];
    liveBroadcasts: {
        active: YouTubeLiveBroadcastSummary[];
        upcoming: YouTubeLiveBroadcastSummary[];
        completed: YouTubeLiveBroadcastSummary[];
    };
    analytics: YouTubeAnalyticsSummary;
    quota: YouTubeQuotaSummary;
    warning?: string;
};

export type DocumentOption = {
    id: string;
    title: string;
    subject: string;
    date: string;
    updatedAt?: string;
};

export type PollCandidate = {
    id: string;
    questionNumber: string;
    prompt: string;
    promptLanguage: "English" | "Hindi";
    options: string[];
    optionLanguage: "English" | "Hindi" | "Mixed";
    wasAiShortened?: boolean;
    shorteningNotes?: string[];
};

export type PollSkip = {
    questionNumber: string;
    reason: string;
};

export type YouTubeLiveChatMessageSummary = {
    id: string;
    type: string;
    publishedAt?: string;
    messageText: string;
    amountText?: string;
    authorName: string;
    authorChannelId?: string;
    authorChannelUrl?: string;
    authorProfileImageUrl?: string;
    isOwner: boolean;
    isModerator: boolean;
    isSponsor: boolean;
    isVerified: boolean;
};

export type YouTubeVideoCommentReplySummary = {
    id: string;
    parentId?: string;
    text: string;
    publishedAt?: string;
    likeCount?: number;
    authorName: string;
    authorChannelId?: string;
    authorProfileImageUrl?: string;
};

export type YouTubeVideoCommentSummary = {
    id: string;
    threadId: string;
    videoId: string;
    text: string;
    publishedAt?: string;
    likeCount?: number;
    replyCount: number;
    canReply: boolean;
    authorName: string;
    authorChannelId?: string;
    authorProfileImageUrl?: string;
    replies: YouTubeVideoCommentReplySummary[];
};

export type YouTubeCommentsFeed = {
    broadcast: YouTubeLiveBroadcastSummary;
    liveChat: {
        enabled: boolean;
        nextPageToken?: string;
        pollingIntervalMillis?: number;
        messages: YouTubeLiveChatMessageSummary[];
    };
    videoComments: YouTubeVideoCommentSummary[];
    syncedAt?: string;
    liveChatFetched?: boolean;
    videoCommentsFetched?: boolean;
};

export function formatDateTime(value: string | undefined) {
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

export function formatNumberCompact(value: number | undefined) {
    if (!Number.isFinite(Number(value))) return "0";
    return new Intl.NumberFormat("en-IN", {
        notation: "compact",
        maximumFractionDigits: 1,
    }).format(Number(value));
}

export function formatPercent(value: number | undefined, digits = 1) {
    if (!Number.isFinite(Number(value))) return "0%";
    return `${Number(value).toFixed(digits)}%`;
}

export function statusTone(status: string) {
    if (status === "active") return "bg-emerald-100 text-emerald-700";
    if (status === "upcoming") return "bg-amber-100 text-amber-700";
    if (status === "completed") return "bg-slate-100 text-slate-700";
    return "bg-slate-100 text-slate-700";
}

export function normalizePollText(value: string | undefined | null) {
    return String(value || "").replace(/\s+/g, " ").trim();
}

export function matchesActivePoll(candidate: PollCandidate, activePoll: YouTubePollSummary | null | undefined) {
    if (!activePoll) return false;

    const candidateQuestion = normalizePollText(candidate.prompt);
    const activeQuestion = normalizePollText(activePoll.questionText);
    if (!candidateQuestion || !activeQuestion || candidateQuestion !== activeQuestion) {
        return false;
    }

    const activeOptions = Array.isArray(activePoll.options)
        ? activePoll.options.map((option) => normalizePollText(option.optionText))
        : [];
    const candidateOptions = candidate.options.map((option) => normalizePollText(option));

    if (activeOptions.length !== candidateOptions.length) {
        return false;
    }

    return candidateOptions.every((option, index) => option === activeOptions[index]);
}

export function buildAllBroadcasts(dashboard: YouTubeDashboard | null) {
    return [
        ...(dashboard?.liveBroadcasts.active || []),
        ...(dashboard?.liveBroadcasts.upcoming || []),
        ...(dashboard?.liveBroadcasts.completed || []),
    ];
}

export function usePageVisibility() {
    const [visible, setVisible] = useState(true);

    useEffect(() => {
        if (typeof document === "undefined") return;

        const updateVisibility = () => {
            setVisible(document.visibilityState !== "hidden");
        };

        updateVisibility();
        document.addEventListener("visibilitychange", updateVisibility);
        return () => document.removeEventListener("visibilitychange", updateVisibility);
    }, []);

    return visible;
}
