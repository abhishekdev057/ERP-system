"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useState } from "react";
import { useSession } from "next-auth/react";
import toast from "react-hot-toast";
import { Question } from "@/types/pdf";

type MediaMode =
    | "text_to_image"
    | "text_to_video"
    | "image_from_reference"
    | "video_from_reference";

type MediaResult = {
    id: string;
    mode: MediaMode;
    status: string;
    type: "image" | "video_plan";
    prompt: string;
    style: string;
    aspectRatio: string;
    durationSec?: number;
    referenceName?: string | null;
    assetUrl?: string;
    storyboard?: string[];
    note?: string;
};

type YouTubePollSummary = {
    id: string;
    questionText: string;
    status: string;
    options: Array<{
        optionText: string;
        tally?: string;
    }>;
};

type YouTubeChannelSummary = {
    id: string;
    title: string;
    description: string;
    customUrl?: string;
    thumbnailUrl?: string;
    subscriberCount?: string;
    videoCount?: string;
    viewCount?: string;
};

type YouTubeVideoSummary = {
    id: string;
    title: string;
    description: string;
    publishedAt?: string;
    thumbnailUrl?: string;
    watchUrl: string;
};

type YouTubeLiveBroadcastSummary = {
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
};

type YouTubeDashboard = {
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
    warning?: string;
};

type DocumentOption = {
    id: string;
    title: string;
    subject: string;
    date: string;
    updatedAt?: string;
};

type PollCandidate = {
    id: string;
    questionNumber: string;
    prompt: string;
    promptLanguage: "English" | "Hindi";
    options: string[];
    optionLanguage: "English" | "Hindi" | "Mixed";
};

type PollSkip = {
    questionNumber: string;
    reason: string;
};

const MODES: Array<{ id: MediaMode; label: string; hint: string }> = [
    { id: "text_to_image", label: "Text to Image", hint: "Prompt-driven visual generation" },
    { id: "text_to_video", label: "Text to Video", hint: "Storyboard-first video planning" },
    { id: "image_from_reference", label: "Image from Reference", hint: "Generate image variant from reference direction" },
    { id: "video_from_reference", label: "Video from Reference", hint: "Generate video plan from reference direction" },
];

function normalizeInlineText(value: string | undefined | null): string {
    return String(value || "").replace(/\s+/g, " ").trim();
}

function chooseBestVariant(
    english: string | undefined | null,
    hindi: string | undefined | null,
    maxLength: number
): { text: string; language: "English" | "Hindi" } | null {
    const variants = [
        { text: normalizeInlineText(english), language: "English" as const },
        { text: normalizeInlineText(hindi), language: "Hindi" as const },
    ].filter((item) => item.text.length > 0);

    if (variants.length === 0) return null;

    const fitting = [...variants]
        .sort((left, right) => left.text.length - right.text.length)
        .find((item) => item.text.length <= maxLength);

    return fitting || null;
}

function buildPollCandidates(questions: Question[]) {
    const eligible: PollCandidate[] = [];
    const skipped: PollSkip[] = [];

    questions.forEach((question, index) => {
        const questionNumber = String(question.number || index + 1);
        const prompt = chooseBestVariant(question.questionEnglish, question.questionHindi, 100);
        const options = Array.isArray(question.options) ? question.options : [];

        if (!prompt) {
            skipped.push({
                questionNumber,
                reason: "Question text is longer than 100 characters in both English and Hindi.",
            });
            return;
        }

        if (options.length < 2 || options.length > 4) {
            skipped.push({
                questionNumber,
                reason: "YouTube poll supports only 2 to 4 options.",
            });
            return;
        }

        const pickedOptions = options.map((option) => chooseBestVariant(option.english, option.hindi, 35));
        if (pickedOptions.some((option) => !option)) {
            skipped.push({
                questionNumber,
                reason: "At least one option is longer than 35 characters in both English and Hindi.",
            });
            return;
        }

        const resolvedOptions = pickedOptions.filter(
            (item): item is { text: string; language: "English" | "Hindi" } => Boolean(item)
        );
        const languages = Array.from(new Set(resolvedOptions.map((item) => item.language)));

        eligible.push({
            id: `${questionNumber}_${index}`,
            questionNumber,
            prompt: prompt.text,
            promptLanguage: prompt.language,
            options: resolvedOptions.map((item) => item.text),
            optionLanguage:
                languages.length === 1
                    ? languages[0]
                    : "Mixed",
        });
    });

    return { eligible, skipped };
}

function formatDateTime(value: string | undefined) {
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

function statusTone(status: string) {
    if (status === "active") return "bg-emerald-100 text-emerald-700";
    if (status === "upcoming") return "bg-amber-100 text-amber-700";
    if (status === "completed") return "bg-slate-100 text-slate-700";
    return "bg-slate-100 text-slate-700";
}

function MediaStudioPageContent() {
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

    const [mode, setMode] = useState<MediaMode>("text_to_image");
    const [prompt, setPrompt] = useState("");
    const [style, setStyle] = useState("cinematic");
    const [aspectRatio, setAspectRatio] = useState("16:9");
    const [durationSec, setDurationSec] = useState(12);
    const [referenceFile, setReferenceFile] = useState<File | null>(null);
    const [loading, setLoading] = useState(false);
    const [results, setResults] = useState<MediaResult[]>([]);

    const [youtubeDashboard, setYoutubeDashboard] = useState<YouTubeDashboard | null>(null);
    const [youtubeLoading, setYoutubeLoading] = useState(false);
    const [youtubeAction, setYoutubeAction] = useState<"connect" | "disconnect" | "start" | "end" | null>(null);
    const [documentsLoading, setDocumentsLoading] = useState(false);
    const [documents, setDocuments] = useState<DocumentOption[]>([]);
    const [selectedDocumentId, setSelectedDocumentId] = useState("");
    const [selectedDocumentTitle, setSelectedDocumentTitle] = useState("");
    const [selectedBroadcastId, setSelectedBroadcastId] = useState("");
    const [pollCandidates, setPollCandidates] = useState<PollCandidate[]>([]);
    const [skippedPolls, setSkippedPolls] = useState<PollSkip[]>([]);
    const [documentLoading, setDocumentLoading] = useState(false);

    const selectedMode = useMemo(() => MODES.find((item) => item.id === mode), [mode]);
    const needsReference = mode === "image_from_reference" || mode === "video_from_reference";

    const allBroadcasts = useMemo(
        () => [
            ...(youtubeDashboard?.liveBroadcasts.active || []),
            ...(youtubeDashboard?.liveBroadcasts.upcoming || []),
            ...(youtubeDashboard?.liveBroadcasts.completed || []),
        ],
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

    const handleGenerate = async () => {
        if (!prompt.trim()) {
            toast.error("Prompt is required");
            return;
        }
        if (needsReference && !referenceFile) {
            toast.error("Reference file is required for this mode");
            return;
        }

        setLoading(true);
        try {
            const response = await fetch("/api/content-studio/media-generate", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    mode,
                    prompt,
                    style,
                    aspectRatio,
                    durationSec,
                    referenceName: referenceFile?.name || null,
                }),
            });

            const data = await response.json();
            if (!response.ok) {
                throw new Error(data.error || "Generation failed");
            }

            const next: MediaResult = {
                id: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
                mode,
                status: data.status,
                type: data.type,
                prompt: data.prompt,
                style: data.style,
                aspectRatio: data.aspectRatio,
                durationSec: data.durationSec,
                referenceName: data.referenceName,
                assetUrl: data.assetUrl,
                storyboard: data.storyboard,
                note: data.note,
            };

            setResults((prev) => [next, ...prev]);
            toast.success(data.type === "image" ? "Image generated" : "Video plan generated");
        } catch (error: any) {
            console.error(error);
            toast.error(error.message || "Media generation failed");
        } finally {
            setLoading(false);
        }
    };

    const loadYouTubeDashboard = async () => {
        setYoutubeLoading(true);
        try {
            const response = await fetch("/api/youtube/dashboard", {
                cache: "no-store",
            });
            const data = await response.json().catch(() => ({}));
            if (!response.ok) {
                throw new Error(data.error || "Failed to load YouTube dashboard.");
            }
            setYoutubeDashboard(data as YouTubeDashboard);
        } catch (error: any) {
            console.error(error);
            setYoutubeDashboard(null);
            toast.error(error.message || "Failed to load YouTube dashboard.");
        } finally {
            setYoutubeLoading(false);
        }
    };

    const loadDocuments = async () => {
        setDocumentsLoading(true);
        try {
            const response = await fetch(
                "/api/documents?minimal=true&limit=50&sortBy=updatedAt&sortOrder=desc",
                {
                    cache: "no-store",
                }
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
        window.location.href = `/api/youtube/connect?returnTo=${encodeURIComponent("/pdf-to-pdf/media")}&mode=${mode}`;
    };

    const handleDisconnectYouTube = async () => {
        setYoutubeAction("disconnect");
        try {
            const response = await fetch("/api/youtube/connection", {
                method: "DELETE",
            });
            const data = await response.json().catch(() => ({}));
            if (!response.ok) {
                throw new Error(data.error || "Failed to disconnect YouTube.");
            }
            setYoutubeDashboard({
                connected: false,
                canManageLiveChat: false,
                uploads: [],
                liveBroadcasts: { active: [], upcoming: [], completed: [] },
            });
            setSelectedBroadcastId("");
            setSelectedDocumentId("");
            setSelectedDocumentTitle("");
            setPollCandidates([]);
            setSkippedPolls([]);
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

        const selectedDocument = documents.find((document) => document.id === documentId);
        setSelectedDocumentTitle(selectedDocument?.title || "");

        if (!documentId) return;

        setDocumentLoading(true);
        try {
            const response = await fetch(`/api/documents/${documentId}`, {
                cache: "no-store",
            });
            const data = await response.json().catch(() => ({}));
            if (!response.ok) {
                throw new Error(data.error || "Failed to load selected document.");
            }

            const questions = Array.isArray(data.document?.jsonData?.questions)
                ? (data.document.jsonData.questions as Question[])
                : [];
            const candidates = buildPollCandidates(questions);
            setPollCandidates(candidates.eligible);
            setSkippedPolls(candidates.skipped);
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
            await loadYouTubeDashboard();
        } catch (error: any) {
            console.error(error);
            toast.error(error.message || "Failed to start poll.");
        } finally {
            setYoutubeAction(null);
        }
    };

    const handleEndPoll = async () => {
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
            await loadYouTubeDashboard();
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
        if (!youtubeDashboard?.connected) {
            setDocuments([]);
            setSelectedDocumentId("");
            setSelectedDocumentTitle("");
            setPollCandidates([]);
            setSkippedPolls([]);
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
        const youtubeStatus = searchParams.get("youtube");
        const youtubeMessage = searchParams.get("youtubeMessage");
        if (!youtubeStatus) return;

        if (youtubeStatus === "connected") {
            toast.success("YouTube channel connected successfully.");
        } else if (youtubeStatus === "error") {
            toast.error(youtubeMessage || "YouTube connection failed.");
        }

        setYoutubeAction(null);
        void loadYouTubeDashboard();
        router.replace("/pdf-to-pdf/media");
    }, [router, searchParams]);

    if (!hasAccess) {
        return (
            <div className="page-container">
                <div className="surface p-10 text-center">
                    <h1 className="heading-xl">Media Studio Access Required</h1>
                    <p className="text-sm text-slate-500 mt-2">
                        Ask your workspace admin to grant `media-studio` access.
                    </p>
                    <Link href="/pdf-to-pdf" className="btn btn-secondary text-xs mt-4">Back to Content Studio</Link>
                </div>
            </div>
        );
    }

    return (
        <div className="page-container" style={{ width: "min(1540px, calc(100% - 2rem))" }}>
            <header className="page-header mb-4">
                <div>
                    <span className="eyebrow">Content Studio · Creative</span>
                    <h1 className="heading-xl mt-3">Media Studio</h1>
                    <p className="text-sm text-muted mt-2 max-w-3xl">
                        Generate institute creative assets, connect one YouTube channel per user, review live streams, and launch YouTube-native polls from eligible question documents.
                    </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                    <Link href="/pdf-to-pdf" className="btn btn-secondary text-xs">Tool Hub</Link>
                    <Link href="/pdf-to-pdf/new" className="btn btn-ghost text-xs">Question Extractor</Link>
                </div>
            </header>

            <section className="grid grid-cols-1 xl:grid-cols-3 gap-4">
                <article className="surface p-4 xl:col-span-1">
                    <p className="text-xs font-bold uppercase tracking-wide text-slate-500 mb-3">Generation Input</p>

                    <div className="space-y-3">
                        <div>
                            <label className="text-xs font-semibold text-slate-600">Mode</label>
                            <div className="grid grid-cols-1 gap-2 mt-2">
                                {MODES.map((item) => (
                                    <button
                                        key={item.id}
                                        type="button"
                                        onClick={() => setMode(item.id)}
                                        className={`text-left px-3 py-2 rounded-lg border text-xs transition ${mode === item.id
                                            ? "bg-indigo-50 border-indigo-200 text-indigo-700"
                                            : "bg-white border-slate-200 text-slate-700"
                                            }`}
                                    >
                                        <p className="font-semibold">{item.label}</p>
                                        <p className="text-[11px] text-slate-500 mt-0.5">{item.hint}</p>
                                    </button>
                                ))}
                            </div>
                        </div>

                        <div>
                            <label className="text-xs font-semibold text-slate-600">Prompt</label>
                            <textarea
                                value={prompt}
                                onChange={(event) => setPrompt(event.target.value)}
                                className="textarea min-h-[120px] mt-1"
                                placeholder="Describe the output. Example: Create an admission campaign poster for B.Sc Agriculture with green premium branding."
                            />
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                            <div>
                                <label className="text-xs font-semibold text-slate-600">Style</label>
                                <input
                                    value={style}
                                    onChange={(event) => setStyle(event.target.value)}
                                    className="input mt-1"
                                    placeholder="cinematic"
                                />
                            </div>
                            <div>
                                <label className="text-xs font-semibold text-slate-600">Aspect Ratio</label>
                                <select
                                    value={aspectRatio}
                                    onChange={(event) => setAspectRatio(event.target.value)}
                                    className="select mt-1"
                                >
                                    <option value="16:9">16:9</option>
                                    <option value="9:16">9:16</option>
                                    <option value="1:1">1:1</option>
                                    <option value="4:5">4:5</option>
                                </select>
                            </div>
                        </div>

                        {(mode === "text_to_video" || mode === "video_from_reference") && (
                            <div>
                                <label className="text-xs font-semibold text-slate-600">Duration (seconds)</label>
                                <input
                                    type="number"
                                    min={3}
                                    max={60}
                                    value={durationSec}
                                    onChange={(event) => setDurationSec(Number(event.target.value || 12))}
                                    className="input mt-1"
                                />
                            </div>
                        )}

                        {needsReference && (
                            <div>
                                <label className="text-xs font-semibold text-slate-600">Reference File</label>
                                <input
                                    type="file"
                                    accept="image/*,video/*"
                                    onChange={(event) => setReferenceFile(event.target.files?.[0] || null)}
                                    className="input mt-1"
                                />
                                {referenceFile && (
                                    <p className="text-[11px] text-slate-500 mt-1">Selected: {referenceFile.name}</p>
                                )}
                            </div>
                        )}

                        <button type="button" onClick={handleGenerate} disabled={loading} className="btn btn-primary w-full text-xs">
                            {loading ? "Generating..." : `Generate ${selectedMode?.label || "Asset"}`}
                        </button>
                    </div>
                </article>

                <article className="surface p-4 xl:col-span-2">
                    <div className="flex items-center justify-between gap-2 mb-3">
                        <p className="text-xs font-bold uppercase tracking-wide text-slate-500">Generated Outputs</p>
                        <span className="status-badge">{results.length} item(s)</span>
                    </div>

                    {results.length === 0 ? (
                        <div className="empty-state py-12">
                            <h3>No media output yet</h3>
                            <p className="text-sm">Run a generation request to see results.</p>
                        </div>
                    ) : (
                        <div className="space-y-3 max-h-[75vh] overflow-auto pr-1">
                            {results.map((result) => (
                                <div key={result.id} className="surface-subtle p-3 border border-slate-200 rounded-xl">
                                    <div className="flex flex-wrap items-center justify-between gap-2">
                                        <div>
                                            <p className="text-sm font-semibold text-slate-900">{MODES.find((item) => item.id === result.mode)?.label}</p>
                                            <p className="text-xs text-slate-500">{result.style} · {result.aspectRatio}</p>
                                        </div>
                                        <span className={`px-2 py-1 rounded-md text-[10px] font-bold uppercase ${result.status === "generated" ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"}`}>
                                            {result.status}
                                        </span>
                                    </div>

                                    <p className="text-xs text-slate-700 mt-2">{result.prompt}</p>

                                    {result.referenceName && (
                                        <p className="text-[11px] text-slate-500 mt-1">Reference: {result.referenceName}</p>
                                    )}

                                    {result.type === "image" && result.assetUrl && (
                                        <div className="mt-3">
                                            <img src={result.assetUrl} alt="Generated output" className="w-full max-h-[420px] object-contain rounded-lg border border-slate-200 bg-white" />
                                            <a href={result.assetUrl} target="_blank" rel="noreferrer" className="text-xs text-indigo-600 font-semibold mt-2 inline-block">
                                                Open full image
                                            </a>
                                        </div>
                                    )}

                                    {result.type === "video_plan" && (
                                        <div className="mt-3">
                                            <p className="text-xs font-semibold text-slate-700 mb-1">Storyboard</p>
                                            <ul className="list-disc pl-5 space-y-1 text-xs text-slate-700">
                                                {(result.storyboard || []).map((line, index) => (
                                                    <li key={`${result.id}-${index}`}>{line}</li>
                                                ))}
                                            </ul>
                                            {result.note && <p className="text-[11px] text-amber-700 mt-2">{result.note}</p>}
                                        </div>
                                    )}
                                </div>
                            ))}
                        </div>
                    )}
                </article>
            </section>

            <section className="mt-6 grid grid-cols-1 xl:grid-cols-3 gap-4">
                <article className="surface p-4 xl:col-span-1">
                    <div className="flex items-center justify-between gap-3 mb-4">
                        <div>
                            <p className="text-xs font-bold uppercase tracking-wide text-slate-500">YouTube Connect</p>
                            <h2 className="text-lg font-semibold text-slate-900 mt-1">Live Poll Workspace</h2>
                        </div>
                        <span className="status-badge">
                            {youtubeDashboard?.connected ? "Connected" : youtubeLoading ? "Loading" : "Disconnected"}
                        </span>
                    </div>

                    {youtubeDashboard?.channel ? (
                        <div className="surface-subtle p-4 rounded-2xl border border-slate-200">
                            <div className="flex items-start gap-3">
                                {youtubeDashboard.channel.thumbnailUrl ? (
                                    <img
                                        src={youtubeDashboard.channel.thumbnailUrl}
                                        alt={youtubeDashboard.channel.title}
                                        className="w-14 h-14 rounded-full border border-slate-200 object-cover"
                                    />
                                ) : (
                                    <div className="w-14 h-14 rounded-full bg-red-100 text-red-700 flex items-center justify-center font-bold">
                                        YT
                                    </div>
                                )}
                                <div className="min-w-0">
                                    <p className="text-sm font-semibold text-slate-900 truncate">{youtubeDashboard.channel.title}</p>
                                    {youtubeDashboard.channel.customUrl && (
                                        <p className="text-xs text-slate-500 truncate">@{youtubeDashboard.channel.customUrl}</p>
                                    )}
                                    <div className="flex flex-wrap gap-2 mt-2">
                                        {youtubeDashboard.channel.subscriberCount && (
                                            <span className="tool-chip">{youtubeDashboard.channel.subscriberCount} subscribers</span>
                                        )}
                                        {youtubeDashboard.channel.videoCount && (
                                            <span className="tool-chip">{youtubeDashboard.channel.videoCount} videos</span>
                                        )}
                                    </div>
                                </div>
                            </div>

                            {youtubeDashboard.warning && (
                                <p className="text-xs text-amber-700 mt-3">{youtubeDashboard.warning}</p>
                            )}

                            <div className="flex flex-wrap gap-2 mt-4">
                                <button
                                    type="button"
                                    onClick={() => handleConnectYouTube("connect")}
                                    disabled={youtubeAction !== null}
                                    className="btn btn-primary text-xs"
                                >
                                    {youtubeDashboard.needsReconnect || youtubeAction === "connect" ? "Reconnect YouTube" : "Connect Another Channel"}
                                </button>
                                {!youtubeDashboard.canManageLiveChat && (
                                    <button
                                        type="button"
                                        onClick={() => handleConnectYouTube("poll")}
                                        disabled={youtubeAction !== null}
                                        className="btn btn-secondary text-xs"
                                    >
                                        Enable Poll Controls
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
                            </div>
                        </div>
                    ) : (
                        <div className="surface-subtle p-4 rounded-2xl border border-dashed border-slate-200">
                            <p className="text-sm text-slate-700">
                                Connect one YouTube channel, see your recent content and live streams, then launch native live polls from eligible document questions.
                            </p>
                            <button
                                type="button"
                                onClick={() => handleConnectYouTube("connect")}
                                disabled={youtubeAction !== null || youtubeLoading}
                                className="btn btn-primary text-xs mt-4"
                            >
                                {youtubeAction === "connect" ? "Redirecting..." : "Connect YouTube"}
                            </button>
                            <p className="text-[11px] text-slate-500 mt-3">
                                Make sure the same Google OAuth client has `http://localhost:3000/api/youtube/callback` added as an authorized redirect URI and YouTube Data API v3 enabled.
                            </p>
                        </div>
                    )}

                    <div className="mt-5">
                        <div className="flex items-center justify-between gap-2 mb-2">
                            <p className="text-xs font-bold uppercase tracking-wide text-slate-500">Active Live Context</p>
                            {selectedBroadcast && (
                                <span className={`px-2 py-1 rounded-md text-[10px] font-bold uppercase ${statusTone(selectedBroadcast.status)}`}>
                                    {selectedBroadcast.status}
                                </span>
                            )}
                        </div>

                        {selectedBroadcast ? (
                            <div className="surface-subtle p-4 rounded-2xl border border-slate-200">
                                <p className="text-sm font-semibold text-slate-900">{selectedBroadcast.title}</p>
                                <p className="text-xs text-slate-500 mt-1">
                                    {selectedBroadcast.status === "active"
                                        ? `Live since ${formatDateTime(selectedBroadcast.actualStartTime || selectedBroadcast.scheduledStartTime)}`
                                        : selectedBroadcast.status === "upcoming"
                                            ? `Scheduled for ${formatDateTime(selectedBroadcast.scheduledStartTime)}`
                                            : `Ended ${formatDateTime(selectedBroadcast.actualEndTime || selectedBroadcast.actualStartTime)}`}
                                </p>
                                <div className="flex flex-wrap gap-2 mt-3">
                                    {selectedBroadcast.lifeCycleStatus && (
                                        <span className="tool-chip">{selectedBroadcast.lifeCycleStatus}</span>
                                    )}
                                    {selectedBroadcast.privacyStatus && (
                                        <span className="tool-chip">{selectedBroadcast.privacyStatus}</span>
                                    )}
                                </div>
                                <div className="flex flex-wrap gap-2 mt-4">
                                    <a href={selectedBroadcast.watchUrl} target="_blank" rel="noreferrer" className="btn btn-secondary text-xs">
                                        Open Live
                                    </a>
                                    {selectedBroadcast.activePoll?.id && (
                                        <button
                                            type="button"
                                            onClick={handleEndPoll}
                                            disabled={youtubeAction !== null}
                                            className="btn btn-ghost text-xs"
                                        >
                                            {youtubeAction === "end" ? "Ending Poll..." : "End Active Poll"}
                                        </button>
                                    )}
                                </div>
                                {selectedBroadcast.activePoll && (
                                    <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 p-3">
                                        <p className="text-xs font-bold uppercase tracking-wide text-emerald-700">Active Poll</p>
                                        <p className="text-sm font-semibold text-slate-900 mt-1">{selectedBroadcast.activePoll.questionText}</p>
                                        <div className="space-y-2 mt-3">
                                            {selectedBroadcast.activePoll.options.map((option, index) => (
                                                <div key={`${selectedBroadcast.activePoll?.id}-${index}`} className="flex items-center justify-between gap-3 text-xs text-slate-700">
                                                    <span>{option.optionText}</span>
                                                    <span className="font-semibold text-slate-500">{option.tally || "-"}</span>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                )}
                            </div>
                        ) : (
                            <div className="empty-state py-10">
                                <h3>No live stream selected</h3>
                                <p className="text-sm">Pick one from the live stream list to enable poll controls.</p>
                            </div>
                        )}
                    </div>

                    <div className="mt-5">
                        <p className="text-xs font-bold uppercase tracking-wide text-slate-500 mb-2">Document Picker</p>
                        <select
                            value={selectedDocumentId}
                            onChange={(event) => void handleDocumentSelect(event.target.value)}
                            disabled={!youtubeDashboard?.connected || documentsLoading || documentLoading}
                            className="select"
                        >
                            <option value="">Select document for poll questions</option>
                            {documents.map((document) => (
                                <option key={document.id} value={document.id}>
                                    {document.title}
                                </option>
                            ))}
                        </select>
                        <div className="flex flex-wrap gap-2 mt-3">
                            <span className="tool-chip">Docs: {documents.length}</span>
                            <span className="tool-chip">Eligible: {pollCandidates.length}</span>
                            <span className="tool-chip">Skipped: {skippedPolls.length}</span>
                        </div>
                        {selectedDocumentTitle && (
                            <p className="text-xs text-slate-500 mt-2">Selected document: {selectedDocumentTitle}</p>
                        )}
                        {!activeBroadcastReady && (
                            <p className="text-xs text-amber-700 mt-3">
                                Poll launcher unlocks only when an active live stream with live chat is selected.
                            </p>
                        )}
                        {youtubeDashboard?.connected && !youtubeDashboard.canManageLiveChat && (
                            <p className="text-xs text-amber-700 mt-2">
                                Channel is connected in readonly mode. Enable Poll Controls to request live poll permissions separately.
                            </p>
                        )}
                    </div>
                </article>

                <article className="surface p-4 xl:col-span-2">
                    <div className="grid grid-cols-1 2xl:grid-cols-2 gap-4">
                        <div>
                            <div className="flex items-center justify-between gap-2 mb-3">
                                <p className="text-xs font-bold uppercase tracking-wide text-slate-500">Live Streams</p>
                                <button
                                    type="button"
                                    onClick={() => void loadYouTubeDashboard()}
                                    disabled={youtubeLoading}
                                    className="btn btn-ghost text-xs"
                                >
                                    {youtubeLoading ? "Refreshing..." : "Refresh"}
                                </button>
                            </div>

                            <div className="space-y-3 max-h-[75vh] overflow-auto pr-1">
                                {allBroadcasts.length === 0 ? (
                                    <div className="empty-state py-10">
                                        <h3>No live broadcasts found</h3>
                                        <p className="text-sm">Once the channel has active, upcoming, or completed live streams, they will appear here.</p>
                                    </div>
                                ) : (
                                    allBroadcasts.map((broadcast) => (
                                        <button
                                            key={broadcast.id}
                                            type="button"
                                            onClick={() => setSelectedBroadcastId(broadcast.id)}
                                            className={`w-full text-left surface-subtle p-3 border rounded-xl transition ${selectedBroadcastId === broadcast.id
                                                ? "border-indigo-300 bg-indigo-50"
                                                : "border-slate-200"
                                                }`}
                                        >
                                            <div className="flex items-start gap-3">
                                                {broadcast.thumbnailUrl ? (
                                                    <img
                                                        src={broadcast.thumbnailUrl}
                                                        alt={broadcast.title}
                                                        className="w-24 h-16 rounded-lg border border-slate-200 object-cover bg-white"
                                                    />
                                                ) : (
                                                    <div className="w-24 h-16 rounded-lg border border-slate-200 bg-slate-100 flex items-center justify-center text-xs text-slate-500">
                                                        Live
                                                    </div>
                                                )}
                                                <div className="min-w-0 flex-1">
                                                    <div className="flex items-center justify-between gap-2">
                                                        <p className="text-sm font-semibold text-slate-900 line-clamp-2">{broadcast.title}</p>
                                                        <span className={`px-2 py-1 rounded-md text-[10px] font-bold uppercase ${statusTone(broadcast.status)}`}>
                                                            {broadcast.status}
                                                        </span>
                                                    </div>
                                                    <p className="text-xs text-slate-500 mt-1">
                                                        {broadcast.status === "active"
                                                            ? `Live since ${formatDateTime(broadcast.actualStartTime || broadcast.scheduledStartTime)}`
                                                            : broadcast.status === "upcoming"
                                                                ? `Starts ${formatDateTime(broadcast.scheduledStartTime)}`
                                                                : `Ended ${formatDateTime(broadcast.actualEndTime || broadcast.actualStartTime)}`}
                                                    </p>
                                                    {broadcast.activePoll?.questionText && (
                                                        <p className="text-xs text-emerald-700 mt-2">Active poll: {broadcast.activePoll.questionText}</p>
                                                    )}
                                                </div>
                                            </div>
                                        </button>
                                    ))
                                )}
                            </div>
                        </div>

                        <div>
                            <div className="flex items-center justify-between gap-2 mb-3">
                                <p className="text-xs font-bold uppercase tracking-wide text-slate-500">Channel Content</p>
                                <span className="status-badge">{youtubeDashboard?.uploads.length || 0} recent upload(s)</span>
                            </div>

                            {youtubeDashboard?.uploads.length ? (
                                <div className="space-y-3 max-h-[75vh] overflow-auto pr-1">
                                    {youtubeDashboard.uploads.map((video) => (
                                        <div key={video.id} className="surface-subtle p-3 border border-slate-200 rounded-xl">
                                            <div className="flex items-start gap-3">
                                                {video.thumbnailUrl ? (
                                                    <img
                                                        src={video.thumbnailUrl}
                                                        alt={video.title}
                                                        className="w-24 h-16 rounded-lg border border-slate-200 object-cover bg-white"
                                                    />
                                                ) : (
                                                    <div className="w-24 h-16 rounded-lg border border-slate-200 bg-slate-100 flex items-center justify-center text-xs text-slate-500">
                                                        Video
                                                    </div>
                                                )}
                                                <div className="min-w-0 flex-1">
                                                    <p className="text-sm font-semibold text-slate-900 line-clamp-2">{video.title}</p>
                                                    <p className="text-xs text-slate-500 mt-1">Published {formatDateTime(video.publishedAt)}</p>
                                                    <a
                                                        href={video.watchUrl}
                                                        target="_blank"
                                                        rel="noreferrer"
                                                        className="text-xs text-indigo-600 font-semibold mt-2 inline-block"
                                                    >
                                                        Open on YouTube
                                                    </a>
                                                </div>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            ) : (
                                <div className="empty-state py-10">
                                    <h3>No uploads loaded</h3>
                                    <p className="text-sm">Recent channel uploads will appear here after the channel is connected.</p>
                                </div>
                            )}
                        </div>
                    </div>

                    <div className="mt-5 border-t border-slate-200 pt-5">
                        <div className="flex items-center justify-between gap-2 mb-3">
                            <div>
                                <p className="text-xs font-bold uppercase tracking-wide text-slate-500">Poll-Ready Questions</p>
                                <p className="text-[11px] text-slate-500 mt-1">
                                    System skips any question over 100 characters or any option over 35 characters. Only 2 to 4 option questions are shown.
                                </p>
                            </div>
                            <span className="status-badge">{pollCandidates.length} eligible</span>
                        </div>

                        {documentLoading ? (
                            <div className="empty-state py-10">
                                <h3>Loading document questions</h3>
                                <p className="text-sm">Checking which questions fit YouTube poll limits.</p>
                            </div>
                        ) : !selectedDocumentId ? (
                            <div className="empty-state py-10">
                                <h3>No document selected</h3>
                                <p className="text-sm">Select a document to prepare live poll questions.</p>
                            </div>
                        ) : pollCandidates.length === 0 ? (
                            <div className="surface-subtle p-4 rounded-xl border border-slate-200">
                                <p className="text-sm font-semibold text-slate-900">No poll-ready questions found</p>
                                <p className="text-xs text-slate-500 mt-2">
                                    This document either has no MCQ-style questions or all available questions exceed YouTube poll limits.
                                </p>
                            </div>
                        ) : (
                            <div className="space-y-3">
                                {pollCandidates.map((candidate) => (
                                    <div key={candidate.id} className="surface-subtle p-4 border border-slate-200 rounded-xl">
                                        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                                            <div className="min-w-0">
                                                <div className="flex flex-wrap gap-2 mb-2">
                                                    <span className="tool-chip">Q{candidate.questionNumber}</span>
                                                    <span className="tool-chip">{candidate.promptLanguage}</span>
                                                    <span className="tool-chip">{candidate.optionLanguage}</span>
                                                </div>
                                                <p className="text-sm font-semibold text-slate-900">{candidate.prompt}</p>
                                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-3">
                                                    {candidate.options.map((option, index) => (
                                                        <div key={`${candidate.id}-${index}`} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-700">
                                                            {index + 1}. {option}
                                                        </div>
                                                    ))}
                                                </div>
                                            </div>
                                            <div className="flex-shrink-0">
                                                <button
                                                    type="button"
                                                    onClick={() => void handleStartPoll(candidate)}
                                                    disabled={
                                                        !activeBroadcastReady ||
                                                        !youtubeDashboard?.canManageLiveChat ||
                                                        youtubeAction !== null ||
                                                        Boolean(selectedBroadcast?.activePoll?.id)
                                                    }
                                                    className="btn btn-primary text-xs"
                                                >
                                                    {youtubeAction === "start" ? "Starting Poll..." : "Start Poll"}
                                                </button>
                                            </div>
                                        </div>
                                        {!activeBroadcastReady && (
                                            <p className="text-[11px] text-amber-700 mt-3">
                                                Select an active live stream first.
                                            </p>
                                        )}
                                        {activeBroadcastReady && !youtubeDashboard?.canManageLiveChat && (
                                            <p className="text-[11px] text-amber-700 mt-3">
                                                Enable Poll Controls first to request the extra YouTube live poll scope.
                                            </p>
                                        )}
                                        {selectedBroadcast?.activePoll?.id && (
                                            <p className="text-[11px] text-amber-700 mt-3">
                                                End the current live poll before starting another one.
                                            </p>
                                        )}
                                    </div>
                                ))}
                            </div>
                        )}

                        {skippedPolls.length > 0 && (
                            <div className="mt-5 rounded-2xl border border-amber-200 bg-amber-50 p-4">
                                <div className="flex items-center justify-between gap-2">
                                    <p className="text-xs font-bold uppercase tracking-wide text-amber-700">Skipped Questions</p>
                                    <span className="status-badge">{skippedPolls.length} skipped</span>
                                </div>
                                <div className="space-y-2 mt-3">
                                    {skippedPolls.slice(0, 8).map((item, index) => (
                                        <div key={`${item.questionNumber}-${index}`} className="text-xs text-amber-900">
                                            Q{item.questionNumber}: {item.reason}
                                        </div>
                                    ))}
                                    {skippedPolls.length > 8 && (
                                        <p className="text-[11px] text-amber-700">
                                            {skippedPolls.length - 8} more question(s) were skipped by the same validation rules.
                                        </p>
                                    )}
                                </div>
                            </div>
                        )}
                    </div>
                </article>
            </section>
        </div>
    );
}

export default function MediaStudioPage() {
    return (
        <Suspense fallback={<div className="page-container">Loading Media Studio...</div>}>
            <MediaStudioPageContent />
        </Suspense>
    );
}
