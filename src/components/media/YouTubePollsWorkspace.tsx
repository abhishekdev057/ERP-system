"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { useSession } from "next-auth/react";
import { ArrowRight, FileText, RadioTower, RefreshCcw, Vote } from "lucide-react";
import toast from "react-hot-toast";
import {
    buildAllBroadcasts,
    DocumentOption,
    formatDateTime,
    formatPercent,
    matchesActivePoll,
    PollCandidate,
    PollSkip,
    statusTone,
    usePageVisibility,
    YouTubeDashboard,
    YouTubeLiveBroadcastSummary,
} from "@/components/media/youtube/shared";

const POLL_REFRESH_MS = 25000;
const POLL_REFRESH_IDLE_MS = 60000;

type PollDocumentCacheEntry = {
    eligible: PollCandidate[];
    skipped: PollSkip[];
    doneCandidateIds: string[];
    documentTitle: string;
};

export function YouTubePollsWorkspace() {
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

    const [youtubeDashboard, setYoutubeDashboard] = useState<YouTubeDashboard | null>(null);
    const [youtubeLoading, setYoutubeLoading] = useState(false);
    const [youtubeAction, setYoutubeAction] = useState<"connect" | "disconnect" | "start" | "end" | "next" | null>(null);
    const [documentsLoading, setDocumentsLoading] = useState(false);
    const [documents, setDocuments] = useState<DocumentOption[]>([]);
    const [selectedDocumentId, setSelectedDocumentId] = useState("");
    const [selectedDocumentTitle, setSelectedDocumentTitle] = useState("");
    const [selectedBroadcastId, setSelectedBroadcastId] = useState("");
    const [pollCandidates, setPollCandidates] = useState<PollCandidate[]>([]);
    const [skippedPolls, setSkippedPolls] = useState<PollSkip[]>([]);
    const [completedPollCandidateIds, setCompletedPollCandidateIds] = useState<string[]>([]);
    const [documentLoading, setDocumentLoading] = useState(false);
    const pageVisible = usePageVisibility();
    const preparedDocumentCacheRef = useRef<Record<string, PollDocumentCacheEntry>>({});

    const allBroadcasts = useMemo(
        () => buildAllBroadcasts(youtubeDashboard),
        [youtubeDashboard]
    );

    const selectedBroadcast = useMemo(
        () => allBroadcasts.find((broadcast) => broadcast.id === selectedBroadcastId) || null,
        [allBroadcasts, selectedBroadcastId]
    );

    const activeBroadcastReady = Boolean(
        selectedBroadcast &&
        selectedBroadcast.status === "active" &&
        selectedBroadcast.liveChatId
    );

    const completedPollCandidateIdSet = useMemo(
        () => new Set(completedPollCandidateIds),
        [completedPollCandidateIds]
    );

    const liveCandidateId = useMemo(() => {
        const activePoll = selectedBroadcast?.activePoll;
        if (!activePoll) return null;
        return pollCandidates.find((candidate) => matchesActivePoll(candidate, activePoll))?.id || null;
    }, [pollCandidates, selectedBroadcast?.activePoll]);

    const liveCandidate = useMemo(
        () => pollCandidates.find((candidate) => candidate.id === liveCandidateId) || null,
        [pollCandidates, liveCandidateId]
    );

    const liveCandidateQueueIndex = useMemo(
        () => (liveCandidateId ? pollCandidates.findIndex((candidate) => candidate.id === liveCandidateId) : -1),
        [pollCandidates, liveCandidateId]
    );

    const nextSequentialCandidate = useMemo(() => {
        const startIndex = liveCandidateQueueIndex >= 0 ? liveCandidateQueueIndex + 1 : 0;
        return (
            pollCandidates
                .slice(startIndex)
                .find((candidate) => !completedPollCandidateIdSet.has(candidate.id) && candidate.id !== liveCandidateId) || null
        );
    }, [completedPollCandidateIdSet, liveCandidateId, liveCandidateQueueIndex, pollCandidates]);

    const nextSequentialCandidateQueueIndex = useMemo(
        () => (nextSequentialCandidate ? pollCandidates.findIndex((candidate) => candidate.id === nextSequentialCandidate.id) : -1),
        [nextSequentialCandidate, pollCandidates]
    );

    const quotaBlocked = Boolean(
        youtubeDashboard?.quota.exhausted &&
        youtubeDashboard?.quota.nextResetAt &&
        new Date(youtubeDashboard.quota.nextResetAt).getTime() > Date.now()
    );

    const markCandidateCompleted = (candidateId: string) => {
        setCompletedPollCandidateIds((current) =>
            current.includes(candidateId) ? current : [...current, candidateId]
        );
        const cacheKey = `${selectedBroadcastId || "no-broadcast"}:${selectedDocumentId || ""}`;
        const cachedEntry = preparedDocumentCacheRef.current[cacheKey];
        if (cachedEntry && !cachedEntry.doneCandidateIds.includes(candidateId)) {
            preparedDocumentCacheRef.current[cacheKey] = {
                ...cachedEntry,
                doneCandidateIds: [...cachedEntry.doneCandidateIds, candidateId],
            };
        }
    };

    const patchSelectedBroadcast = (updater: (current: YouTubeLiveBroadcastSummary) => YouTubeLiveBroadcastSummary) => {
        if (!selectedBroadcastId) return;
        setYoutubeDashboard((current) => {
            if (!current) return current;

            const patchBroadcasts = (broadcasts: typeof current.liveBroadcasts.active) =>
                broadcasts.map((broadcast) =>
                    broadcast.id === selectedBroadcastId
                        ? updater(broadcast)
                        : broadcast
                );

            return {
                ...current,
                liveBroadcasts: {
                    active: patchBroadcasts(current.liveBroadcasts.active),
                    upcoming: patchBroadcasts(current.liveBroadcasts.upcoming),
                    completed: patchBroadcasts(current.liveBroadcasts.completed),
                },
            };
        });
    };

    const loadYouTubeDashboard = async (quiet = false) => {
        if (!quiet) setYoutubeLoading(true);
        try {
            const response = await fetch("/api/youtube/dashboard", { cache: "no-store" });
            const data = await response.json().catch(() => ({}));
            if (!response.ok) {
                throw new Error(data.error || "Failed to load YouTube dashboard.");
            }
            setYoutubeDashboard(data as YouTubeDashboard);
        } catch (error: any) {
            console.error(error);
            if (!quiet) {
                toast.error(error.message || "Failed to load YouTube dashboard.");
            }
        } finally {
            if (!quiet) setYoutubeLoading(false);
        }
    };

    const loadDocuments = async () => {
        setDocumentsLoading(true);
        try {
            const response = await fetch(
                "/api/documents?minimal=true&limit=50&sortBy=updatedAt&sortOrder=desc",
                { cache: "no-store" }
            );
            const data = await response.json().catch(() => ({}));
            if (!response.ok) {
                throw new Error(data.error || "Failed to load documents.");
            }
            setDocuments(
                Array.isArray(data.documents)
                    ? data.documents.map((document: any) => ({
                        id: String(document.id || ""),
                        title: String(document.title || "Untitled document"),
                        subject: String(document.subject || ""),
                        date: String(document.date || ""),
                        updatedAt: String(document.updatedAt || ""),
                    }))
                    : []
            );
        } catch (error: any) {
            console.error(error);
            toast.error(error.message || "Failed to load documents.");
        } finally {
            setDocumentsLoading(false);
        }
    };

    const handleConnectYouTube = (mode: "connect" | "poll" = "connect") => {
        setYoutubeAction("connect");
        window.location.href = `/api/youtube/connect?returnTo=${encodeURIComponent("/content-studio/youtube/polls")}&mode=${mode}`;
    };

    const handleDisconnectYouTube = async () => {
        setYoutubeAction("disconnect");
        try {
            const response = await fetch("/api/youtube/connection", { method: "DELETE" });
            const data = await response.json().catch(() => ({}));
            if (!response.ok) {
                throw new Error(data.error || "Failed to disconnect YouTube.");
            }
            setYoutubeDashboard({
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
            setSelectedBroadcastId("");
            setSelectedDocumentId("");
            setSelectedDocumentTitle("");
            setPollCandidates([]);
            setSkippedPolls([]);
            setCompletedPollCandidateIds([]);
            preparedDocumentCacheRef.current = {};
            toast.success("YouTube channel disconnected.");
        } catch (error: any) {
            console.error(error);
            toast.error(error.message || "Failed to disconnect YouTube.");
        } finally {
            setYoutubeAction(null);
        }
    };

    const handleDocumentSelect = async (documentId: string) => {
        setSelectedDocumentId(documentId);
        setPollCandidates([]);
        setSkippedPolls([]);
        setCompletedPollCandidateIds([]);

        const selectedDocument = documents.find((document) => document.id === documentId);
        setSelectedDocumentTitle(selectedDocument?.title || "");
        if (!documentId) return;

        const cacheKey = `${selectedBroadcastId || "no-broadcast"}:${documentId}`;
        const cachedEntry = preparedDocumentCacheRef.current[cacheKey];
        if (cachedEntry) {
            setSelectedDocumentTitle(cachedEntry.documentTitle || selectedDocument?.title || "");
            setPollCandidates(cachedEntry.eligible);
            setSkippedPolls(cachedEntry.skipped);
            setCompletedPollCandidateIds(cachedEntry.doneCandidateIds);
            return;
        }

        setDocumentLoading(true);
        try {
            const response = await fetch("/api/youtube/polls/candidates", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({
                    documentId,
                    broadcastId: selectedBroadcastId || undefined,
                }),
            });
            const data = await response.json().catch(() => ({}));
            if (!response.ok) {
                throw new Error(data.error || "Failed to load selected document.");
            }
            const entry = {
                eligible: Array.isArray(data.eligible) ? data.eligible : [],
                skipped: Array.isArray(data.skipped) ? data.skipped : [],
                doneCandidateIds: Array.isArray(data.doneCandidateIds)
                    ? data.doneCandidateIds.map((item: unknown) => String(item || "").trim()).filter(Boolean)
                    : [],
                documentTitle: selectedDocument?.title || "",
            } satisfies PollDocumentCacheEntry;
            preparedDocumentCacheRef.current[cacheKey] = entry;
            setPollCandidates(entry.eligible);
            setSkippedPolls(entry.skipped);
            setCompletedPollCandidateIds(entry.doneCandidateIds);
        } catch (error: any) {
            console.error(error);
            toast.error(error.message || "Failed to load poll-ready questions.");
        } finally {
            setDocumentLoading(false);
        }
    };

    const handleStartPoll = async (candidate: PollCandidate) => {
        if (!selectedBroadcast?.liveChatId) {
            toast.error("Select an active live stream first.");
            return;
        }
        setYoutubeAction("start");
        try {
            const response = await fetch("/api/youtube/polls/start", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({
                    liveChatId: selectedBroadcast.liveChatId,
                    questionText: candidate.prompt,
                    optionTexts: candidate.options,
                    documentId: selectedDocumentId || undefined,
                    broadcastId: selectedBroadcast.id,
                    candidateId: candidate.id,
                    questionNumber: candidate.questionNumber,
                }),
            });
            const data = await response.json().catch(() => ({}));
            if (!response.ok) {
                if (data.code === "youtube_scope_upgrade_required") {
                    toast.error("Extra YouTube poll permission is required. Redirecting to approval.");
                    handleConnectYouTube("poll");
                    return;
                }
                throw new Error(data.error || "Failed to start poll.");
            }
            toast.success(`Poll started for Q${candidate.questionNumber}.`);
            patchSelectedBroadcast((broadcast) => ({
                ...broadcast,
                activePoll: data.poll || {
                    id: `local-${candidate.id}`,
                    questionText: candidate.prompt,
                    status: "active",
                    options: candidate.options.map((optionText) => ({ optionText })),
                },
            }));
            markCandidateCompleted(candidate.id);
        } catch (error: any) {
            console.error(error);
            toast.error(error.message || "Failed to start poll.");
        } finally {
            setYoutubeAction(null);
        }
    };

    const handleAdvanceToNextPoll = async () => {
        if (!selectedBroadcast?.liveChatId || !selectedBroadcast?.activePoll?.id || !liveCandidate) {
            toast.error("No active poll is attached to this live stream.");
            return;
        }
        if (!nextSequentialCandidate) {
            toast.error("No next poll is available in the queue.");
            return;
        }

        const broadcastId = selectedBroadcast.id;
        const liveChatId = selectedBroadcast.liveChatId;
        const activePollId = selectedBroadcast.activePoll.id;

        setYoutubeAction("next");
        try {
            const endResponse = await fetch("/api/youtube/polls/end", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({
                    pollId: activePollId,
                    documentId: selectedDocumentId || undefined,
                    broadcastId,
                    candidateId: liveCandidate.id,
                }),
            });
            const endData = await endResponse.json().catch(() => ({}));
            if (!endResponse.ok) {
                if (endData.code === "youtube_scope_upgrade_required") {
                    toast.error("Extra YouTube poll permission is required. Redirecting to approval.");
                    handleConnectYouTube("poll");
                    return;
                }
                throw new Error(endData.error || "Failed to end the current poll.");
            }

            patchSelectedBroadcast((broadcast) => ({
                ...broadcast,
                activePoll: null,
            }));

            const startResponse = await fetch("/api/youtube/polls/start", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({
                    liveChatId,
                    questionText: nextSequentialCandidate.prompt,
                    optionTexts: nextSequentialCandidate.options,
                    documentId: selectedDocumentId || undefined,
                    broadcastId,
                    candidateId: nextSequentialCandidate.id,
                    questionNumber: nextSequentialCandidate.questionNumber,
                }),
            });
            const startData = await startResponse.json().catch(() => ({}));
            if (!startResponse.ok) {
                if (startData.code === "youtube_scope_upgrade_required") {
                    toast.error("Extra YouTube poll permission is required. Redirecting to approval.");
                    handleConnectYouTube("poll");
                    return;
                }
                throw new Error(startData.error || "Failed to start the next poll.");
            }

            patchSelectedBroadcast((broadcast) => ({
                ...broadcast,
                activePoll: startData.poll || {
                    id: `local-${nextSequentialCandidate.id}`,
                    questionText: nextSequentialCandidate.prompt,
                    status: "active",
                    options: nextSequentialCandidate.options.map((optionText) => ({ optionText })),
                },
            }));
            markCandidateCompleted(nextSequentialCandidate.id);
            toast.success(`Moved from Q${liveCandidate.questionNumber} to Q${nextSequentialCandidate.questionNumber}.`);
        } catch (error: any) {
            console.error(error);
            toast.error(error.message || "Failed to move to the next poll.");
        } finally {
            setYoutubeAction(null);
        }
    };

    const handleEndPoll = async (candidate?: PollCandidate) => {
        if (!selectedBroadcast?.activePoll?.id) {
            toast.error("No active poll is attached to this live stream.");
            return;
        }
        setYoutubeAction("end");
        try {
            const response = await fetch("/api/youtube/polls/end", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({
                    pollId: selectedBroadcast.activePoll.id,
                    documentId: selectedDocumentId || undefined,
                    broadcastId: selectedBroadcast.id,
                    candidateId: candidate?.id || undefined,
                }),
            });
            const data = await response.json().catch(() => ({}));
            if (!response.ok) {
                if (data.code === "youtube_scope_upgrade_required") {
                    toast.error("Extra YouTube poll permission is required. Redirecting to approval.");
                    handleConnectYouTube("poll");
                    return;
                }
                throw new Error(data.error || "Failed to end poll.");
            }
            toast.success("Live poll ended.");
            patchSelectedBroadcast((broadcast) => ({
                ...broadcast,
                activePoll: null,
            }));
        } catch (error: any) {
            console.error(error);
            toast.error(error.message || "Failed to end poll.");
        } finally {
            setYoutubeAction(null);
        }
    };

    useEffect(() => {
        if (!hasAccess) return;
        void loadYouTubeDashboard();
    }, [hasAccess]);

    useEffect(() => {
        if (!hasAccess) return;
        if (!pageVisible) return;
        if (quotaBlocked) return;
        const timer = window.setInterval(() => {
            void loadYouTubeDashboard(true);
        }, activeBroadcastReady ? POLL_REFRESH_MS : POLL_REFRESH_IDLE_MS);
        return () => window.clearInterval(timer);
    }, [activeBroadcastReady, hasAccess, pageVisible, quotaBlocked]);

    useEffect(() => {
        if (!youtubeDashboard?.connected) {
            setDocuments([]);
            setSelectedDocumentId("");
            setSelectedDocumentTitle("");
            setPollCandidates([]);
            setSkippedPolls([]);
            setCompletedPollCandidateIds([]);
            preparedDocumentCacheRef.current = {};
            return;
        }
        void loadDocuments();
    }, [youtubeDashboard?.connected]);

    useEffect(() => {
        if (allBroadcasts.length === 0) {
            setSelectedBroadcastId("");
            return;
        }
        if (selectedBroadcastId && allBroadcasts.some((broadcast) => broadcast.id === selectedBroadcastId)) {
            return;
        }
        const nextBroadcast =
            youtubeDashboard?.liveBroadcasts.active[0] ||
            youtubeDashboard?.liveBroadcasts.upcoming[0] ||
            youtubeDashboard?.liveBroadcasts.completed[0] ||
            null;
        setSelectedBroadcastId(nextBroadcast?.id || "");
    }, [allBroadcasts, selectedBroadcastId, youtubeDashboard]);

    useEffect(() => {
        if (!selectedDocumentId) {
            setCompletedPollCandidateIds([]);
            return;
        }
        void handleDocumentSelect(selectedDocumentId);
    }, [selectedBroadcastId]);

    useEffect(() => {
        const youtubeStatus = searchParams.get("youtube");
        const youtubeMessage = searchParams.get("youtubeMessage");
        if (!youtubeStatus) return;

        if (youtubeStatus === "connected") {
            toast.success("YouTube channel connected successfully.");
        } else if (youtubeStatus === "error") {
            toast.error(youtubeMessage || "YouTube connection failed.");
        }

        setYoutubeAction(null);
        void loadYouTubeDashboard(true);
        router.replace("/content-studio/youtube/polls");
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

    const quota = youtubeDashboard?.quota || {
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
        <section className="grid grid-cols-1 gap-5 xl:grid-cols-[360px,minmax(0,1fr)]">
            <article className="space-y-5">
                <div className="overflow-hidden rounded-[30px] border border-red-100 bg-[linear-gradient(180deg,#fff8f7,#fff)] p-5 shadow-[0_24px_60px_rgba(15,23,42,0.08)]">
                    <div className="inline-flex items-center gap-2 rounded-full border border-red-200 bg-white px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.24em] text-red-600">
                        <Vote className="h-4 w-4" />
                        Poll Lane
                    </div>
                    <h3 className="mt-4 text-2xl font-semibold text-slate-950">Document-driven live polling</h3>
                    <p className="mt-2 text-sm leading-6 text-slate-600">
                        Choose a live stream, pull a saved extractor document, and run Hindi-only poll questions in sequence.
                    </p>
                    <button
                        type="button"
                        onClick={() => void loadYouTubeDashboard()}
                        disabled={youtubeLoading}
                        className="btn btn-ghost mt-4 text-xs"
                    >
                        <RefreshCcw className="mr-2 h-4 w-4" />
                        {youtubeLoading ? "Refreshing..." : "Refresh lane"}
                    </button>
                    <p className="mt-3 text-[11px] text-slate-500">
                        {quotaBlocked
                            ? `Auto refresh paused until quota resets around ${formatDateTime(youtubeDashboard?.quota.nextResetAt)}`
                            : pageVisible
                            ? `Quota-aware auto refresh ${Math.round((activeBroadcastReady ? POLL_REFRESH_MS : POLL_REFRESH_IDLE_MS) / 1000)}s`
                            : "Auto refresh paused while this tab is hidden"}
                    </p>
                </div>

                <div className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-[0_24px_60px_rgba(15,23,42,0.08)]">
                    <div className="flex items-center justify-between gap-3">
                        <div>
                            <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-500">Channel</p>
                            <h3 className="mt-2 text-lg font-semibold text-slate-950">
                                {youtubeDashboard?.channel?.title || "Connect YouTube"}
                            </h3>
                        </div>
                        <span className="status-badge">
                            {youtubeDashboard?.connected ? "Connected" : youtubeLoading ? "Loading" : "Disconnected"}
                        </span>
                    </div>

                    <div className="mt-4 flex flex-wrap gap-2">
                        {youtubeDashboard?.connected ? (
                            <>
                                <button
                                    type="button"
                                    onClick={() => handleConnectYouTube("connect")}
                                    disabled={youtubeAction !== null}
                                    className="btn btn-primary text-xs"
                                >
                                    {youtubeDashboard.needsReconnect || youtubeAction === "connect" ? "Reconnect" : "Switch channel"}
                                </button>
                                {!youtubeDashboard.canManageLiveChat && (
                                    <button
                                        type="button"
                                        onClick={() => handleConnectYouTube("poll")}
                                        disabled={youtubeAction !== null}
                                        className="btn btn-secondary text-xs"
                                    >
                                        Enable poll controls
                                    </button>
                                )}
                                <button
                                    type="button"
                                    onClick={handleDisconnectYouTube}
                                    disabled={youtubeAction !== null}
                                    className="btn btn-ghost text-xs"
                                >
                                    {youtubeAction === "disconnect" ? "Disconnecting..." : "Disconnect"}
                                </button>
                            </>
                        ) : (
                            <button
                                type="button"
                                onClick={() => handleConnectYouTube("connect")}
                                disabled={youtubeAction !== null}
                                className="btn btn-primary text-xs"
                            >
                                {youtubeAction === "connect" ? "Redirecting..." : "Connect YouTube"}
                            </button>
                        )}
                    </div>
                    {youtubeDashboard?.warning && (
                        <p className="mt-3 text-xs text-amber-700">{youtubeDashboard.warning}</p>
                    )}
                </div>

                <div className="rounded-[28px] border border-amber-100 bg-[linear-gradient(180deg,#fffaf0,#fff)] p-5 shadow-[0_24px_60px_rgba(15,23,42,0.08)]">
                    <div className="flex items-start justify-between gap-3">
                        <div>
                            <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-500">Quota snapshot</p>
                            <h3 className="mt-2 text-lg font-semibold text-slate-950">
                                {formatPercent(quota.usagePercent)} of daily budget used
                            </h3>
                        </div>
                        <span className="status-badge">
                            {quota.usedUnits}/{quota.dailyLimit}
                        </span>
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
                    <div className="mt-4 flex flex-wrap gap-2">
                        <span className="tool-chip">Remaining: {quota.remainingUnits}</span>
                        <span className="tool-chip">Calls: {quota.totalCalls}</span>
                    </div>
                    {quota.nextResetAt && (
                        <p className="mt-3 text-xs text-slate-500">
                            Next reset window: {formatDateTime(quota.nextResetAt)}
                        </p>
                    )}
                    {quota.topConsumers[0] && (
                        <p className="mt-3 text-xs text-slate-600">
                            Biggest consumer right now: <span className="font-semibold text-slate-900">{quota.topConsumers[0].label}</span>
                        </p>
                    )}
                </div>

                <div className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-[0_24px_60px_rgba(15,23,42,0.08)]">
                    <div className="flex items-center justify-between gap-2">
                        <div>
                            <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-500">Live Context</p>
                            <h3 className="mt-2 text-lg font-semibold text-slate-950">
                                {selectedBroadcast ? selectedBroadcast.title : "No stream selected"}
                            </h3>
                        </div>
                        {selectedBroadcast && (
                            <span className={`rounded-full px-3 py-1 text-[10px] font-bold uppercase ${statusTone(selectedBroadcast.status)}`}>
                                {selectedBroadcast.status}
                            </span>
                        )}
                    </div>
                    {selectedBroadcast ? (
                        <>
                            <p className="mt-3 text-xs text-slate-500">
                                {selectedBroadcast.status === "active"
                                    ? `Live since ${formatDateTime(selectedBroadcast.actualStartTime || selectedBroadcast.scheduledStartTime)}`
                                    : selectedBroadcast.status === "upcoming"
                                        ? `Scheduled for ${formatDateTime(selectedBroadcast.scheduledStartTime)}`
                                        : `Ended ${formatDateTime(selectedBroadcast.actualEndTime || selectedBroadcast.actualStartTime)}`}
                            </p>
                            <div className="mt-4 flex flex-wrap gap-2">
                                {selectedBroadcast.concurrentViewers && <span className="tool-chip">{selectedBroadcast.concurrentViewers} viewers</span>}
                                {selectedBroadcast.commentCount && <span className="tool-chip">{selectedBroadcast.commentCount} comments</span>}
                                {selectedBroadcast.activePoll?.id && (
                                    <span className="tool-chip bg-emerald-100 text-emerald-700 border-emerald-200">Poll active</span>
                                )}
                            </div>
                            {selectedBroadcast.activePoll && (
                                <div className="mt-4 rounded-2xl border border-emerald-200 bg-emerald-50 p-4">
                                    <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-emerald-700">Current poll</p>
                                    <p className="mt-2 text-sm font-semibold text-slate-900">{selectedBroadcast.activePoll.questionText}</p>
                                </div>
                            )}
                        </>
                    ) : (
                        <p className="mt-3 text-sm text-slate-600">Pick a stream from the right side to unlock this lane.</p>
                    )}
                </div>

                <div className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-[0_24px_60px_rgba(15,23,42,0.08)]">
                    <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-500">
                        <FileText className="h-4 w-4" />
                        Document picker
                    </div>
                    <select
                        value={selectedDocumentId}
                        onChange={(event) => void handleDocumentSelect(event.target.value)}
                        disabled={!youtubeDashboard?.connected || documentsLoading || documentLoading}
                        className="select mt-4"
                    >
                        <option value="">Select document for poll questions</option>
                        {documents.map((document) => (
                            <option key={document.id} value={document.id}>
                                {document.title}
                            </option>
                        ))}
                    </select>
                    <div className="mt-4 flex flex-wrap gap-2">
                        <span className="tool-chip">Docs: {documents.length}</span>
                        <span className="tool-chip">Eligible: {pollCandidates.length}</span>
                        <span className="tool-chip">Done: {completedPollCandidateIds.length}</span>
                        <span className="tool-chip">Skipped: {skippedPolls.length}</span>
                    </div>
                    {selectedDocumentTitle && (
                        <p className="mt-3 text-xs text-slate-500">Selected document: {selectedDocumentTitle}</p>
                    )}
                </div>
            </article>

            <article className="space-y-5">
                <div className="grid gap-5 xl:grid-cols-[0.92fr,1.08fr]">
                    <div className="rounded-[30px] border border-slate-200 bg-white p-5 shadow-[0_24px_60px_rgba(15,23,42,0.08)]">
                        <div className="flex items-center justify-between gap-3">
                            <div>
                                <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-500">Live streams</p>
                                <h3 className="mt-2 text-xl font-semibold text-slate-950">Select broadcast</h3>
                            </div>
                            <span className="status-badge">{allBroadcasts.length} total</span>
                        </div>
                        <div className="mt-4 space-y-3 max-h-[74vh] overflow-auto pr-1">
                            {allBroadcasts.length === 0 ? (
                                <div className="rounded-[24px] border border-dashed border-slate-200 bg-slate-50 p-8 text-center">
                                    <p className="text-lg font-semibold text-slate-900">No live broadcasts found</p>
                                    <p className="mt-2 text-sm text-slate-500">
                                        Once the channel has active, upcoming, or completed live streams, they will appear here.
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
                                                ? "border-red-200 bg-red-50 shadow-[0_18px_40px_rgba(239,68,68,0.12)]"
                                                : "border-slate-200 bg-[linear-gradient(180deg,#fff,#f8fafc)] hover:border-slate-300"
                                        }`}
                                    >
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
                                                    {broadcast.activePoll?.id && <span className="tool-chip bg-emerald-100 text-emerald-700 border-emerald-200">Poll live</span>}
                                                </div>
                                            </div>
                                        </div>
                                    </button>
                                ))
                            )}
                        </div>
                    </div>

                    <div className="rounded-[30px] border border-slate-200 bg-white p-5 shadow-[0_24px_60px_rgba(15,23,42,0.08)]">
                        <div className="flex items-center justify-between gap-3">
                            <div>
                                <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-500">Poll queue</p>
                                <h3 className="mt-2 text-xl font-semibold text-slate-950">Eligible questions</h3>
                                <p className="mt-2 text-xs text-slate-500">
                                    Only Hindi question and Hindi options go to YouTube. Over-limit items are auto-shortened with Gemini while preserving meaning.
                                </p>
                            </div>
                            <div className="flex flex-col items-end gap-2">
                                <span className="status-badge">{pollCandidates.length} ready</span>
                                {liveCandidate && (
                                    <span className="status-badge">
                                        Poll {liveCandidateQueueIndex + 1} · Q{liveCandidate.questionNumber}
                                    </span>
                                )}
                                {!liveCandidate && nextSequentialCandidate && (
                                    <span className="status-badge">
                                        Next {nextSequentialCandidateQueueIndex + 1} · Q{nextSequentialCandidate.questionNumber}
                                    </span>
                                )}
                            </div>
                        </div>

                        <div className="mt-4 flex flex-wrap items-center gap-2">
                            <button
                                type="button"
                                className="btn btn-secondary text-xs"
                                onClick={() => void handleAdvanceToNextPoll()}
                                disabled={
                                    !activeBroadcastReady ||
                                    !youtubeDashboard?.canManageLiveChat ||
                                    !liveCandidate ||
                                    !nextSequentialCandidate ||
                                    youtubeAction !== null
                                }
                            >
                                <ArrowRight className="mr-2 h-4 w-4" />
                                {youtubeAction === "next" ? "Ending + Starting..." : "Next Poll"}
                            </button>
                            {liveCandidate && nextSequentialCandidate && (
                                <p className="text-[11px] text-slate-500">
                                    End current poll Q{liveCandidate.questionNumber} and immediately start Q{nextSequentialCandidate.questionNumber}.
                                </p>
                            )}
                        </div>

                        {documentLoading ? (
                            <div className="mt-6 rounded-[24px] border border-dashed border-slate-200 bg-slate-50 p-8 text-center">
                                <p className="text-lg font-semibold text-slate-900">Preparing poll queue</p>
                                <p className="mt-2 text-sm text-slate-500">
                                    Loading Hindi-only candidates and shortening long items where needed.
                                </p>
                            </div>
                        ) : !selectedDocumentId ? (
                            <div className="mt-6 rounded-[24px] border border-dashed border-slate-200 bg-slate-50 p-8 text-center">
                                <p className="text-lg font-semibold text-slate-900">No document selected</p>
                                <p className="mt-2 text-sm text-slate-500">Select a document from the left panel to build the poll queue.</p>
                            </div>
                        ) : pollCandidates.length === 0 ? (
                            <div className="mt-6 rounded-[24px] border border-dashed border-slate-200 bg-slate-50 p-8 text-center">
                                <p className="text-lg font-semibold text-slate-900">No poll-ready questions found</p>
                                <p className="mt-2 text-sm text-slate-500">
                                    This document either has no poll-compatible 2-to-4-option questions, or Gemini could not safely compress them.
                                </p>
                            </div>
                        ) : (
                            <div className="mt-5 space-y-3 max-h-[74vh] overflow-auto pr-1">
                                {pollCandidates.map((candidate, index) => {
                                    const isLiveCandidate = candidate.id === liveCandidateId;
                                    const isCompletedCandidate = completedPollCandidateIdSet.has(candidate.id);
                                    const hasAnyActivePoll = Boolean(selectedBroadcast?.activePoll?.id);
                                    const anotherPollIsActive = hasAnyActivePoll && !isLiveCandidate;
                                    const buttonDisabled =
                                        !activeBroadcastReady ||
                                        !youtubeDashboard?.canManageLiveChat ||
                                        youtubeAction !== null ||
                                        anotherPollIsActive;

                                    return (
                                        <div
                                            key={candidate.id}
                                            className={`rounded-[24px] border p-4 ${
                                                isLiveCandidate
                                                    ? "border-emerald-300 bg-emerald-50/70"
                                                    : isCompletedCandidate
                                                        ? "border-indigo-200 bg-indigo-50/50"
                                                        : "border-slate-200 bg-[linear-gradient(180deg,#fff,#f8fafc)]"
                                            }`}
                                        >
                                            <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                                                <div className="min-w-0">
                                                    <div className="mb-3 flex flex-wrap gap-2">
                                                        <span className="tool-chip">Poll {index + 1}</span>
                                                        <span className="tool-chip">Q{candidate.questionNumber}</span>
                                                        <span className="tool-chip">{candidate.promptLanguage}</span>
                                                        {candidate.wasAiShortened && (
                                                            <span className="tool-chip bg-indigo-50 text-indigo-700 border-indigo-200">AI Shortened</span>
                                                        )}
                                                        {isLiveCandidate && (
                                                            <span className="tool-chip bg-emerald-100 text-emerald-700 border-emerald-200">Live Now</span>
                                                        )}
                                                        {!isLiveCandidate && isCompletedCandidate && (
                                                            <span className="tool-chip bg-slate-100 text-slate-700 border-slate-200">Done</span>
                                                        )}
                                                    </div>
                                                    <p className="text-base font-semibold text-slate-950">{candidate.prompt}</p>
                                                    <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2">
                                                        {candidate.options.map((option, index) => (
                                                            <div key={`${candidate.id}-${index}`} className="rounded-2xl border border-slate-200 bg-white px-3 py-3 text-sm text-slate-700">
                                                                {index + 1}. {option}
                                                            </div>
                                                        ))}
                                                    </div>
                                                    {candidate.shorteningNotes?.length ? (
                                                        <div className="mt-3 space-y-1">
                                                            {candidate.shorteningNotes.map((note, index) => (
                                                                <p key={`${candidate.id}-note-${index}`} className="text-[11px] text-indigo-700">
                                                                    {note}
                                                                </p>
                                                            ))}
                                                        </div>
                                                    ) : null}
                                                </div>

                                                <div className="flex-shrink-0">
                                                    <button
                                                        type="button"
                                                        onClick={() => void (isLiveCandidate ? handleEndPoll(candidate) : handleStartPoll(candidate))}
                                                        disabled={buttonDisabled}
                                                        className={isLiveCandidate ? "btn btn-ghost text-xs" : "btn btn-primary text-xs"}
                                                    >
                                                        {isLiveCandidate
                                                            ? youtubeAction === "end"
                                                                ? "Ending Poll..."
                                                                : "End Poll"
                                                            : youtubeAction === "start"
                                                                ? "Starting Poll..."
                                                                : "Start Poll"}
                                                    </button>
                                                </div>
                                            </div>

                                            {!activeBroadcastReady && (
                                                <p className="mt-3 text-[11px] text-amber-700">Select an active live stream first.</p>
                                            )}
                                            {activeBroadcastReady && !youtubeDashboard?.canManageLiveChat && (
                                                <p className="mt-3 text-[11px] text-amber-700">
                                                    Enable Poll Controls first to request the extra YouTube live poll scope.
                                                </p>
                                            )}
                                            {activeBroadcastReady && youtubeDashboard?.canManageLiveChat && isLiveCandidate && (
                                                <p className="mt-3 text-[11px] text-emerald-700">
                                                    This question is currently live on YouTube. Use the same button to end it.
                                                </p>
                                            )}
                                            {activeBroadcastReady && youtubeDashboard?.canManageLiveChat && anotherPollIsActive && (
                                                <p className="mt-3 text-[11px] text-amber-700">
                                                    Another question is already live on YouTube. End that poll first.
                                                </p>
                                            )}
                                            {activeBroadcastReady &&
                                                youtubeDashboard?.canManageLiveChat &&
                                                !isLiveCandidate &&
                                                !anotherPollIsActive &&
                                                isCompletedCandidate && (
                                                    <p className="mt-3 text-[11px] text-slate-600">
                                                        This question has already been used on the selected live stream.
                                                    </p>
                                                )}
                                        </div>
                                    );
                                })}
                            </div>
                        )}

                        {skippedPolls.length > 0 && (
                            <div className="mt-5 rounded-[24px] border border-amber-200 bg-amber-50 p-4">
                                <div className="flex items-center justify-between gap-2">
                                    <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-amber-700">Skipped questions</p>
                                    <span className="status-badge">{skippedPolls.length} skipped</span>
                                </div>
                                <div className="mt-3 space-y-2">
                                    {skippedPolls.slice(0, 8).map((item, index) => (
                                        <div key={`${item.questionNumber}-${index}`} className="text-xs text-amber-900">
                                            Q{item.questionNumber}: {item.reason}
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            </article>
        </section>
    );
}
