"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useSession } from "next-auth/react";
import type { LucideIcon } from "lucide-react";
import { StudioWorkspaceHero } from "@/components/content-studio/StudioWorkspaceHero";
import {
    ArrowUpRight,
    ArrowDown,
    ArrowUp,
    BookOpen,
    Bot,
    BrainCircuit,
    Building2,
    CheckCircle2,
    ChevronDown,
    Clapperboard,
    Database,
    Download,
    Facebook,
    FileText,
    History,
    ImageIcon,
    Instagram,
    LoaderCircle,
    MessageCircle,
    MessagesSquare,
    RefreshCcw,
    Rocket,
    Send,
    Square,
    Sparkles,
    Trash2,
    Upload,
    Video,
    Wand2,
    X,
    Youtube
} from "lucide-react";
import toast from "react-hot-toast";
import { SocialPublishModal, type PublishConfig } from "./SocialPublishModal";

type MediaMode =
    | "text_to_image"
    | "text_to_video"
    | "image_from_reference"
    | "video_from_reference";

type ImageModelSelection = "auto" | "nano_banana";

type MediaKnowledgeReference = {
    type: "organization" | "member" | "student" | "book" | "document" | "media" | "schedule" | "whiteboard";
    title: string;
    summary: string;
    sourceType?: string;
    sourceId?: string;
    score?: number;
    updatedAt?: string;
    metadata?: Record<string, unknown>;
};

type KnowledgeIndexSummary = {
    totalIndexedItems: number;
    lastSyncedAt?: string;
    lastSourceUpdateAt?: string;
    embeddingsEnabled: boolean;
    sourceCounts: Record<string, number>;
};

type MediaResult = {
    id: string;
    mode: MediaMode;
    status: string;
    type: "image" | "video" | "video_plan";
    prompt: string;
    effectivePrompt?: string;
    style: string;
    aspectRatio: string;
    durationSec?: number;
    referenceName?: string | null;
    organizationLogoUrl?: string | null;
    organizationName?: string | null;
    organizationSummary?: string | null;
    institutionContextApplied?: boolean;
    knowledgeReferences?: MediaKnowledgeReference[];
    assetUrl?: string;
    storyboard?: string[];
    note?: string;
    createdAt?: string;
    imageModel?: ImageModelSelection;
    imageModelLabel?: string;
};

type MediaContextState = {
    organizationLogoUrl?: string | null;
    organizationName?: string | null;
    organizationSummary?: string;
    organizationContextApplied: boolean;
    availableBookCount?: number;
    availableDocumentCount?: number;
    availableMemberCount?: number;
    availableStudentCount?: number;
    availableGeneratedMediaCount?: number;
    availableScheduleCount?: number;
    availableWhiteboardCount?: number;
    totalIndexedItems?: number;
    knowledgeReferences?: MediaKnowledgeReference[];
    indexSummary?: KnowledgeIndexSummary | null;
};

type GeminiUsageState = {
    estimated: boolean;
    softDailyLimit: number;
    softHourlyLimit: number;
    usedWeightedUsage: number;
    remainingWeightedUsage: number;
    usagePercent: number;
    lastHourCalls: number;
    lastHourWeightedUsage: number;
    hourlyPercent: number;
    blocked: boolean;
    blockedUntil?: string;
    blockedReason?: string;
    blockedRetryAfterSeconds?: number;
    blockedResetEstimated: boolean;
    dayKey: string;
    nextResetAt: string;
    topConsumers: Array<{
        key: string;
        label: string;
        model: string;
        weightPerCall: number;
        calls: number;
        weightedUsage: number;
        sharePercent: number;
        lastCalledAt?: string;
    }>;
    warnings: string[];
    lastUpdatedAt?: string;
};

type ModeMeta = {
    id: MediaMode;
    label: string;
    hint: string;
    description: string;
    icon: LucideIcon;
    toneClass: string;
};

type AssistantMessage = {
    id: string;
    role: "user" | "assistant";
    content: string;
    createdAt: string;
    knowledgeReferences?: MediaKnowledgeReference[];
    suggestedPrompt?: string;
    kind?: "chat" | "generation";
};

type ActionKind = "assistant" | "generation";

type ActionStage = {
    label: string;
    detail: string;
};

const MODE_META: ModeMeta[] = [
    {
        id: "text_to_image",
        label: "Text to Image",
        hint: "Prompt-first still visuals",
        description: "Posters, campaign graphics, thumbnails, and institute-ready still creatives.",
        icon: ImageIcon,
        toneClass: "border-sky-200 bg-[linear-gradient(180deg,#eff6ff,#fff)] text-sky-700",
    },
    {
        id: "text_to_video",
        label: "Text to Video",
        hint: "Prompt-first motion",
        description: "Short branded videos and motion-led institute narratives from a single brief.",
        icon: Clapperboard,
        toneClass: "border-violet-200 bg-[linear-gradient(180deg,#f5f3ff,#fff)] text-violet-700",
    },
    {
        id: "image_from_reference",
        label: "Image from Reference",
        hint: "Reference-guided stills",
        description: "Follow an existing visual direction while keeping the institute identity intact.",
        icon: Upload,
        toneClass: "border-emerald-200 bg-[linear-gradient(180deg,#ecfdf5,#fff)] text-emerald-700",
    },
    {
        id: "video_from_reference",
        label: "Video from Reference",
        hint: "Reference-guided motion",
        description: "Use an image or video reference while preserving brand direction and message.",
        icon: Wand2,
        toneClass: "border-amber-200 bg-[linear-gradient(180deg,#fffbeb,#fff)] text-amber-700",
    },
];

const ACTION_STAGES: Record<ActionKind, ActionStage[]> = {
    assistant: [
        { label: "Parsing", detail: "Decoding your creative intent..." },
        { label: "Indexing", detail: "Surfacing relevant institute knowledge..." },
        { label: "Drafting", detail: "Formulating a brand-aligned response..." },
        { label: "Polishing", detail: "Prepping the final output for you..." },
    ],
    generation: [
        { label: "Igniting", detail: "Firing up the creative engine..." },
        { label: "Aligning", detail: "Applying strict institute brand constraints..." },
        { label: "Brewing", detail: "Conjuring pixels in Gemini's lab..." },
        { label: "Refining", detail: "Adding the final magical touches..." },
        { label: "Preserving", detail: "Locking masterpiece into shared memory..." },
    ],
};

const ASSISTANT_STORAGE_KEY = "media-studio-assistant-v2";

function createId() {
    return `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function formatSavedAt(value: string | undefined) {
    if (!value) return "Just now";
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

function formatDateTime(value: string | undefined) {
    if (!value) return "—";
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return value;
    return parsed.toLocaleString("en-IN", {
        day: "2-digit",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
    });
}

function buildGalleryAssetUrl(asset: Pick<MediaResult, "assetUrl" | "createdAt" | "id">) {
    const assetUrl = String(asset.assetUrl || "").trim();
    if (!assetUrl) return "";

    const version =
        asset.createdAt && !Number.isNaN(new Date(asset.createdAt).getTime())
            ? new Date(asset.createdAt).getTime()
            : asset.id;
    return `${assetUrl}${assetUrl.includes("?") ? "&" : "?"}v=${version}`;
}

function getModeMeta(mode: MediaMode) {
    return MODE_META.find((item) => item.id === mode) || MODE_META[0];
}

function resultStatusTone(status: string) {
    if (status === "generated") return "bg-emerald-100 text-emerald-700 border-emerald-200";
    if (status === "queued") return "bg-amber-100 text-amber-700 border-amber-200";
    return "bg-slate-100 text-slate-700 border-slate-200";
}

function buildWelcomeMessage(organizationName?: string | null): AssistantMessage {
    return {
        id: createId(),
        role: "assistant",
        kind: "chat",
        createdAt: new Date().toISOString(),
        content: organizationName
            ? `I’m ready to work with ${organizationName}'s media memory. Ask about your books, extracted documents, audience fit, or tell me what to generate and I’ll keep the brief tighter to your institute context.`
            : "I’m ready to work as your media copilot. Ask about your workspace knowledge, or give me a generation brief and I’ll keep it grounded to your institute context.",
    };
}

function summarizeKnowledgeRefs(references: MediaKnowledgeReference[]) {
    if (!references.length) return "No focused knowledge pull yet.";
    return references
        .slice(0, 2)
        .map((reference) => `${formatKnowledgeType(reference.type)} · ${reference.title}`)
        .join(" + ");
}

function formatKnowledgeType(type: MediaKnowledgeReference["type"]) {
    switch (type) {
        case "organization":
            return "Institute";
        case "member":
            return "Member";
        case "student":
            return "Student";
        case "book":
            return "Library";
        case "document":
            return "Document";
        case "media":
            return "Media";
        case "schedule":
            return "Scheduler";
        case "whiteboard":
            return "Whiteboard";
    }
}

const SHARE_OPTIONS = [
    { 
        id: "download", 
        icon: Download, 
        label: "Download",
        actions: ["Download PNG", "Download JPG"]
    },
    { 
        id: "instagram", 
        icon: Instagram, 
        label: "Instagram",
        actions: ["Share to Story", "Create Post", "Share as Reel"]
    },
    { 
        id: "whatsapp", 
        icon: MessageCircle, 
        label: "WhatsApp",
        actions: ["Share to Status", "Send to Broadcast List", "Send 1-on-1"]
    },
    { 
        id: "facebook", 
        icon: Facebook, 
        label: "Facebook",
        actions: ["Create Post", "Share to Story"]
    },
    { 
        id: "youtube", 
        icon: Youtube, 
        label: "YouTube",
        actions: ["Community Post", "Create Short"]
    },
    { 
        id: "telegram", 
        icon: Send, 
        label: "Telegram",
        actions: ["Share to Channel", "Share to Group", "Send Direct"]
    }
];

function AssetActionsBar({ asset, onPublish }: { asset: MediaResult, onPublish: (config: PublishConfig) => void }) {
    const [openMenu, setOpenMenu] = useState<string | null>(null);

    const handleAction = async (platform: string, action: string) => {
        setOpenMenu(null);
        if (platform === "download") {
            const format = action.includes("PNG") ? "png" : "jpg";
            toast.loading(`Preparing ${format.toUpperCase()}...`, { id: "download" });
            try {
                if (!asset.assetUrl) throw new Error("No asset URL");
                const response = await fetch(asset.assetUrl);
                const blob = await response.blob();
                const img = new Image();
                img.crossOrigin = "anonymous";
                const objectUrl = URL.createObjectURL(blob);
                
                await new Promise((resolve, reject) => {
                    img.onload = resolve;
                    img.onerror = reject;
                    img.src = objectUrl;
                });
                
                const canvas = document.createElement("canvas");
                canvas.width = img.width;
                canvas.height = img.height;
                const ctx = canvas.getContext("2d");
                if (ctx) {
                    if (format === "jpg") {
                        ctx.fillStyle = "#ffffff";
                        ctx.fillRect(0, 0, canvas.width, canvas.height);
                    }
                    ctx.drawImage(img, 0, 0);
                    const dataUrl = canvas.toDataURL(`image/${format === 'jpg' ? 'jpeg' : 'png'}`, 1.0);
                    const a = document.createElement("a");
                    a.href = dataUrl;
                    a.download = `NACC_Eduhub_${asset.id}.${format}`;
                    document.body.appendChild(a);
                    a.click();
                    document.body.removeChild(a);
                }
                URL.revokeObjectURL(objectUrl);
                toast.success("Downloaded successfully!", { id: "download" });
            } catch (err) {
                console.error(err);
                toast.error("Download failed.", { id: "download" });
            }
        } else {
            onPublish({
                assetUrl: asset.assetUrl || null,
                platform,
                action,
                prompt: asset.prompt
            });
        }
    };

    return (
        <div className="flex flex-wrap items-center gap-1.5 mt-3 pt-3 border-t border-slate-100/80">
            {SHARE_OPTIONS.map((opt) => {
                const Icon = opt.icon;
                const isOpen = openMenu === opt.id;
                return (
                    <div key={opt.id} className="relative">
                        <button 
                            type="button"
                            onClick={() => setOpenMenu(isOpen ? null : opt.id)}
                            className={`flex h-8 w-8 items-center justify-center rounded-full transition-all duration-200 ${isOpen ? 'bg-sky-100 text-sky-600 ring-2 ring-sky-200 ring-offset-1' : 'bg-slate-50 text-slate-500 hover:bg-slate-100 hover:text-slate-700'}`}
                            title={opt.label}
                        >
                            <Icon className="h-4 w-4" />
                        </button>
                        
                        {isOpen && (
                            <>
                                <div className="fixed inset-0 z-40" onClick={() => setOpenMenu(null)} />
                                <div className="absolute bottom-[calc(100%+8px)] left-1/2 -translate-x-1/2 mb-1 w-44 bg-white rounded-[16px] shadow-[0_8px_30px_rgb(0,0,0,0.12)] border border-slate-100/80 p-1.5 z-50 animate-in fade-in slide-in-from-bottom-2 zoom-in-95">
                                    <p className="px-2.5 py-1 text-[9px] uppercase tracking-[0.15em] font-bold text-slate-400 border-b border-slate-50 mb-1">{opt.label}</p>
                                    <div className="flex flex-col gap-0.5 mt-1.5">
                                        {opt.actions.map(action => (
                                            <button 
                                                key={action}
                                                type="button"
                                                onClick={() => handleAction(opt.id, action)}
                                                className="w-full text-left px-2.5 py-2 text-[11.5px] font-semibold text-slate-600 hover:bg-indigo-50 hover:text-indigo-700 rounded-lg transition-colors"
                                            >
                                                {action}
                                            </button>
                                        ))}
                                    </div>
                                    <div className="absolute -bottom-1.5 left-1/2 -translate-x-1/2 w-3 h-3 bg-white border-b border-r border-slate-100/80 rotate-45 rounded-sm" />
                                </div>
                            </>
                        )}
                    </div>
                );
            })}
        </div>
    );
}

export function MediaGenerationWorkspace() {
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

    const [isContextExpanded, setIsContextExpanded] = useState(true);
    const [mode, setMode] = useState<MediaMode>("text_to_image");
    const [imageModel, setImageModel] = useState<ImageModelSelection>("nano_banana");
    const [composer, setComposer] = useState("");
    const [publishConfig, setPublishConfig] = useState<PublishConfig | null>(null);
    const [durationSec, setDurationSec] = useState(12);
    const [referenceFile, setReferenceFile] = useState<File | null>(null);
    const [loading, setLoading] = useState(false);
    const [activeAction, setActiveAction] = useState<ActionKind | null>(null);
    const [stageIndex, setStageIndex] = useState(0);
    const [results, setResults] = useState<MediaResult[]>([]);
    const [currentResultId, setCurrentResultId] = useState<string | null>(null);
    const [brokenAssetIds, setBrokenAssetIds] = useState<string[]>([]);
    const [mediaContext, setMediaContext] = useState<MediaContextState | null>(null);
    const [mediaContextLoading, setMediaContextLoading] = useState(false);
    const [assistantMessages, setAssistantMessages] = useState<AssistantMessage[]>([]);
    const [liveKnowledgeReferences, setLiveKnowledgeReferences] = useState<MediaKnowledgeReference[]>([]);
    const [suggestedPrompt, setSuggestedPrompt] = useState("");
    const [isChatOnly, setIsChatOnly] = useState(false);
    const [usageState, setUsageState] = useState<GeminiUsageState | null>(null);
    const messageListRef = useRef<HTMLDivElement | null>(null);
    const abortControllerRef = useRef<AbortController | null>(null);

    const selectedMode = useMemo(() => getModeMeta(mode), [mode]);
    const SelectedModeIcon = selectedMode.icon;
    const needsReference = mode === "image_from_reference" || mode === "video_from_reference";
    const generatedImageCount = useMemo(
        () => results.filter((item) => item.type === "image").length,
        [results]
    );
    const generatedVideoCount = useMemo(
        () => results.filter((item) => item.type === "video").length,
        [results]
    );
    const activeStages = activeAction ? ACTION_STAGES[activeAction] : [];
    const activeStage = activeStages[stageIndex] || null;
    const brokenAssetIdSet = useMemo(() => new Set(brokenAssetIds), [brokenAssetIds]);
    const primaryResult = useMemo(() => {
        if (currentResultId) {
            return results.find((item) => item.id === currentResultId) || results[0] || null;
        }
        return results[0] || null;
    }, [currentResultId, results]);
    const visibleKnowledgeReferences = liveKnowledgeReferences.length
        ? liveKnowledgeReferences
        : mediaContext?.knowledgeReferences || [];
    const knowledgeSourceBreakdown = useMemo(() => {
        const sourceCounts = mediaContext?.indexSummary?.sourceCounts || {};
        return [
            { label: "Libraries", value: Number(sourceCounts.BOOK || mediaContext?.availableBookCount || 0) },
            { label: "Documents", value: Number(sourceCounts.DOCUMENT || mediaContext?.availableDocumentCount || 0) },
            { label: "Members", value: Number(sourceCounts.MEMBER || mediaContext?.availableMemberCount || 0) },
            { label: "Students", value: Number(sourceCounts.STUDENT || mediaContext?.availableStudentCount || 0) },
            { label: "Media", value: Number(sourceCounts.GENERATED_MEDIA || mediaContext?.availableGeneratedMediaCount || 0) },
            { label: "Schedules", value: Number(sourceCounts.MEDIA_SCHEDULE || mediaContext?.availableScheduleCount || 0) },
            { label: "Whiteboards", value: Number(sourceCounts.WHITEBOARD || mediaContext?.availableWhiteboardCount || 0) },
        ].filter((item) => item.value > 0);
    }, [mediaContext]);
    const quotaBlocked = Boolean(
        usageState?.blocked &&
        usageState?.blockedUntil &&
        new Date(usageState.blockedUntil).getTime() > Date.now()
    );

    useEffect(() => {
        if (typeof window === "undefined") return;
        const raw = window.sessionStorage.getItem(ASSISTANT_STORAGE_KEY);
        if (!raw) return;

        try {
            const parsed = JSON.parse(raw) as AssistantMessage[];
            if (Array.isArray(parsed) && parsed.length) {
                setAssistantMessages(parsed);
            }
        } catch {
            window.sessionStorage.removeItem(ASSISTANT_STORAGE_KEY);
        }
    }, []);

    useEffect(() => {
        if (typeof window === "undefined") return;
        if (!assistantMessages.length) return;
        window.sessionStorage.setItem(
            ASSISTANT_STORAGE_KEY,
            JSON.stringify(assistantMessages.slice(-24))
        );
    }, [assistantMessages]);

    useEffect(() => {
        if (!loading || !activeAction) {
            setStageIndex(0);
            return;
        }

        const stages = ACTION_STAGES[activeAction];
        const timer = window.setInterval(() => {
            setStageIndex((current) => (current + 1) % stages.length);
        }, 1700);

        return () => window.clearInterval(timer);
    }, [activeAction, loading]);

    useEffect(() => {
        const element = messageListRef.current;
        if (!element) return;
        element.scrollTop = element.scrollHeight;
    }, [assistantMessages, activeStage?.label, loading]);

    const clearBrokenAsset = (assetId: string) => {
        setBrokenAssetIds((current) => current.filter((id) => id !== assetId));
    };

    const markAssetBroken = (assetId: string) => {
        setBrokenAssetIds((current) => (current.includes(assetId) ? current : [...current, assetId]));
    };

    const loadMediaContext = async () => {
        setMediaContextLoading(true);
        try {
            const response = await fetch("/api/content-studio/media-generate", {
                cache: "no-store",
            });
            const data = await response.json().catch(() => ({}));
            if (!response.ok) {
                throw new Error(data.error || "Failed to load media context.");
            }

            const nextContext: MediaContextState = {
                organizationLogoUrl: data.organizationLogoUrl || null,
                organizationName: data.organizationName || null,
                organizationSummary: data.organizationSummary || "",
                organizationContextApplied: Boolean(data.organizationContextApplied),
                availableBookCount: Number(data.availableBookCount || 0),
                availableDocumentCount: Number(data.availableDocumentCount || 0),
                availableMemberCount: Number(data.availableMemberCount || 0),
                availableStudentCount: Number(data.availableStudentCount || 0),
                availableGeneratedMediaCount: Number(data.availableGeneratedMediaCount || 0),
                availableScheduleCount: Number(data.availableScheduleCount || 0),
                availableWhiteboardCount: Number(data.availableWhiteboardCount || 0),
                totalIndexedItems: Number(data.totalIndexedItems || 0),
                knowledgeReferences: Array.isArray(data.knowledgeReferences) ? data.knowledgeReferences : [],
                indexSummary: data.indexSummary || null,
            };

            setMediaContext(nextContext);
            setResults(Array.isArray(data.savedMedia) ? data.savedMedia : []);
            setBrokenAssetIds([]);
            setUsageState(data.usage || null);
            setCurrentResultId((current) => current || data.savedMedia?.[0]?.id || null);
            setAssistantMessages((prev) =>
                prev.length ? prev : [buildWelcomeMessage(nextContext.organizationName)]
            );
            if (Array.isArray(data.warnings) && data.warnings.length) {
                toast((data.warnings as string[]).join(" "), { icon: "⚠️" });
            }
        } catch (error: any) {
            console.error(error);
            setMediaContext(null);
            toast.error(error.message || "Failed to load media context.");
        } finally {
            setMediaContextLoading(false);
        }
    };

    useEffect(() => {
        if (!hasAccess) return;
        void loadMediaContext();
    }, [hasAccess]);

    const handleAskAssistant = async () => {
        const message = composer.trim();
        if (!message) {
            toast.error("Ask something or paste a creative brief first.");
            return;
        }
        if (quotaBlocked) {
            toast.error(
                usageState?.blockedUntil
                    ? `Gemini cooldown active till ${formatDateTime(usageState.blockedUntil)}.`
                    : "Gemini cooldown is active right now."
            );
            return;
        }

        setComposer("");
        setIsContextExpanded(false);

        const userMessage: AssistantMessage = {
            id: createId(),
            role: "user",
            kind: "chat",
            createdAt: new Date().toISOString(),
            content: message,
        };

        setAssistantMessages((prev) => [...prev, userMessage]);
        setLoading(true);
        setActiveAction("assistant");
        setSuggestedPrompt("");
        
        abortControllerRef.current = new AbortController();

        try {
            const response = await fetch("/api/content-studio/media-assistant", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                },
                signal: abortControllerRef.current.signal,
                body: JSON.stringify({
                    mode,
                    message,
                    conversation: assistantMessages
                        .slice(-8)
                        .map((entry) => ({ role: entry.role, content: entry.content })),
                }),
            });

            const data = await response.json().catch(() => ({}));
            if (!response.ok) {
                setUsageState(data.usage || null);
                throw new Error(data.error || "Failed to talk to the media assistant.");
            }
            setUsageState(data.usage || null);

            const assistantMessage: AssistantMessage = {
                id: createId(),
                role: "assistant",
                kind: "chat",
                createdAt: new Date().toISOString(),
                content: String(data.reply || ""),
                knowledgeReferences: Array.isArray(data.knowledgeReferences) ? data.knowledgeReferences : [],
                suggestedPrompt: String(data.suggestedPrompt || ""),
            };

            setAssistantMessages((prev) => [...prev, assistantMessage]);
            setLiveKnowledgeReferences(assistantMessage.knowledgeReferences || []);
            setSuggestedPrompt(assistantMessage.suggestedPrompt || "");
            setMediaContext((current) =>
                current
                    ? {
                          ...current,
                          availableBookCount: Number(data.availableBookCount || current.availableBookCount || 0),
                          availableDocumentCount: Number(data.availableDocumentCount || current.availableDocumentCount || 0),
                          availableMemberCount: Number(data.availableMemberCount || current.availableMemberCount || 0),
                          availableStudentCount: Number(data.availableStudentCount || current.availableStudentCount || 0),
                          availableGeneratedMediaCount: Number(
                              data.availableGeneratedMediaCount || current.availableGeneratedMediaCount || 0
                          ),
                          availableScheduleCount: Number(data.availableScheduleCount || current.availableScheduleCount || 0),
                          availableWhiteboardCount: Number(data.availableWhiteboardCount || current.availableWhiteboardCount || 0),
                          totalIndexedItems: Number(data.totalIndexedItems || current.totalIndexedItems || 0),
                          indexSummary: data.indexSummary || current.indexSummary || null,
                      }
                    : current
            );
            setComposer("");
        } catch (error: any) {
            if (error.name === "AbortError") {
                toast.success("Chat stopped.");
                return;
            }
            console.error(error);
            toast.error(error.message || "Failed to talk to the media assistant.");
            setAssistantMessages((prev) => [
                ...prev,
                {
                    id: createId(),
                    role: "assistant",
                    kind: "chat",
                    createdAt: new Date().toISOString(),
                    content: error.message || "I could not answer that right now. Please try again.",
                },
            ]);
        } finally {
            setLoading(false);
            setActiveAction(null);
        }
    };

    const handleGenerate = async () => {
        const prompt = composer.trim();
        if (!prompt) {
            toast.error("Generation brief is required.");
            return;
        }
        if (needsReference && !referenceFile) {
            toast.error("Reference file is required for this mode.");
            return;
        }
        if (quotaBlocked) {
            toast.error(
                usageState?.blockedUntil
                    ? `Gemini cooldown active till ${formatDateTime(usageState.blockedUntil)}.`
                    : "Gemini cooldown is active right now."
            );
            return;
        }

        setComposer("");
        setIsContextExpanded(false);

        const userMessage: AssistantMessage = {
            id: createId(),
            role: "user",
            kind: "generation",
            createdAt: new Date().toISOString(),
            content: prompt,
        };

        setAssistantMessages((prev) => [...prev, userMessage]);
        setLoading(true);
        setActiveAction("generation");
        
        abortControllerRef.current = new AbortController();

        try {
            const formData = new FormData();
            formData.append("mode", mode);
            formData.append("prompt", prompt);
            formData.append("durationSec", String(durationSec));
            formData.append("imageModel", imageModel);
            if (referenceFile) {
                formData.append("referenceFile", referenceFile);
                formData.append("referenceName", referenceFile.name);
            }

            const response = await fetch("/api/content-studio/media-generate", {
                method: "POST",
                signal: abortControllerRef.current.signal,
                body: formData,
            });

            const data = await response.json().catch(() => ({}));
            if (!response.ok) {
                setUsageState(data.usage || null);
                throw new Error(data.error || "Generation failed");
            }
            setUsageState(data.usage || null);

            const next: MediaResult = {
                id: String(data.id || createId()),
                mode,
                status: data.status,
                type: data.type,
                prompt: data.prompt,
                effectivePrompt: data.effectivePrompt,
                style: data.style,
                aspectRatio: data.aspectRatio,
                durationSec: data.durationSec,
                referenceName: data.referenceName,
                organizationLogoUrl: data.organizationLogoUrl || null,
                organizationName: data.organizationName,
                organizationSummary: data.organizationSummary,
                institutionContextApplied: Boolean(data.institutionContextApplied),
                knowledgeReferences: Array.isArray(data.knowledgeReferences) ? data.knowledgeReferences : [],
                assetUrl: data.assetUrl,
                storyboard: Array.isArray(data.storyboard) ? data.storyboard : [],
                note: data.note,
                createdAt: data.createdAt || new Date().toISOString(),
                imageModel: data.imageModel,
                imageModelLabel: data.imageModelLabel,
            };

            setResults((prev) => [next, ...prev.filter((item) => item.id !== next.id)]);
            clearBrokenAsset(next.id);
            setCurrentResultId(next.id);
            setLiveKnowledgeReferences(next.knowledgeReferences || []);
            setMediaContext((current) =>
                current
                    ? {
                          ...current,
                          availableBookCount: Number(data.availableBookCount || current.availableBookCount || 0),
                          availableDocumentCount: Number(data.availableDocumentCount || current.availableDocumentCount || 0),
                          availableMemberCount: Number(data.availableMemberCount || current.availableMemberCount || 0),
                          availableStudentCount: Number(data.availableStudentCount || current.availableStudentCount || 0),
                          availableGeneratedMediaCount: Number(
                              data.availableGeneratedMediaCount || current.availableGeneratedMediaCount || 0
                          ),
                          availableScheduleCount: Number(data.availableScheduleCount || current.availableScheduleCount || 0),
                          availableWhiteboardCount: Number(data.availableWhiteboardCount || current.availableWhiteboardCount || 0),
                          totalIndexedItems: Number(data.totalIndexedItems || current.totalIndexedItems || 0),
                          indexSummary: data.indexSummary || current.indexSummary || null,
                      }
                    : current
            );
            setAssistantMessages((prev) => [
                ...prev,
                {
                    id: createId(),
                    role: "assistant",
                    kind: "generation",
                    createdAt: new Date().toISOString(),
                    content:
                        next.type === "video"
                            ? `I generated a video output and saved it to the shared creative history.`
                            : next.type === "image"
                                ? `I generated an image output and saved it to the shared creative history.`
                                : `I prepared a structured video plan and saved it to the shared creative history.`,
                    knowledgeReferences: next.knowledgeReferences,
                },
            ]);
            setComposer("");
            toast.success(
                next.type === "image"
                    ? "Image generated and saved"
                    : next.type === "video"
                        ? "Video generated and saved"
                        : "Video plan saved"
            );
        } catch (error: any) {
            if (error.name === "AbortError") {
                toast.success("Generation stopped.");
                return;
            }
            console.error(error);
            toast.error(error.message || "Something went wrong.");
            setAssistantMessages((prev) => [
                ...prev,
                {
                    id: createId(),
                    role: "assistant",
                    kind: "generation",
                    createdAt: new Date().toISOString(),
                    content: error.message || "Generation failed. Please look at the logs or try again.",
                },
            ]);
        } finally {
            setLoading(false);
            setActiveAction(null);
        }
    };

    if (!hasAccess) {
        return (
            <div className="surface p-10 text-center">
                <h2 className="heading-xl">Media Studio Access Required</h2>
                <p className="mt-2 text-sm text-slate-500">
                    Ask your workspace admin to grant `media-studio` access.
                </p>
            </div>
        );
    }

    return (
        <div className={`flex flex-col w-full bg-slate-50 transition-all duration-0 ${
            !isContextExpanded 
                ? "fixed inset-0 z-[100] h-[100dvh]" 
                : "relative h-full"
        }`}>
            {/* COLLAPSE TRIGGER */}
            {!isContextExpanded && (
                <>
                    <style>{`
                        .top-nav { display: none !important; pointer-events: none !important; }
                    `}</style>
                    <div className="absolute top-4 left-1/2 -translate-x-1/2 z-50">
                        <button
                            type="button"
                            onClick={() => setIsContextExpanded(true)}
                            className="flex items-center gap-2 rounded-full border border-slate-200/80 bg-white/95 px-5 py-2 text-xs font-semibold text-slate-700 shadow-lg shadow-sky-900/5 backdrop-blur-xl transition hover:bg-slate-50/90 hover:scale-105 active:scale-95"
                        >
                            <ArrowDown className="h-4 w-4 text-sky-600" />
                            Show Media Hub & Context
                        </button>
                    </div>
                </>
            )}

            {publishConfig && <SocialPublishModal config={publishConfig} onClose={() => setPublishConfig(null)} />}

            {/* COLLAPSIBLE HEADER AREA */}
            <div 
                className={`flex-none w-full transition-all duration-700 ease-[cubic-bezier(0.16,1,0.3,1)] ${
                    isContextExpanded 
                        ? "max-h-[1200px] opacity-100 border-b border-sky-100/60 shadow-[0_12px_40px_-24px_rgba(15,23,42,0.12)] bg-white/40" 
                        : "max-h-0 opacity-0 overflow-hidden border-b-0"
                }`}
            >
                <div className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
                    <div className="relative">
                        <StudioWorkspaceHero
                            theme="media"
                            eyebrow="Institute Suite · Creative"
                            title="Media Studio"
                            description="Work with a chat-style creative copilot that retrieves only relevant institute knowledge, keeps branding tighter, and saves every generation back into shared history."
                            highlights={["Gemini generation", "Saved media history", "Brand-aware prompts"]}
                            actions={[
                                { href: "/content-studio", label: "Tool Hub", tone: "secondary" },
                                { href: "/content-studio/media/scheduler", label: "Scheduler", tone: "ghost" },
                                { href: "/content-studio/extractor", label: "Question Extractor", tone: "ghost" }
                            ]}
                            compact
                        />
                        <button
                            type="button"
                            onClick={() => setIsContextExpanded(false)}
                            className="absolute right-3 top-3 lg:right-5 lg:top-5 btn btn-primary px-4 py-2 text-sm shadow-xl shadow-sky-600/20 z-10 rounded-2xl group"
                        >
                            Jump to the fun part 🚀
                            <X className="ml-2 h-4 w-4 opacity-50 group-hover:opacity-100 transition-opacity" />
                        </button>
                    </div>

                    <div className="mt-8 flex items-center justify-between">
                        <h2 className="text-[11px] font-bold uppercase tracking-[0.24em] text-slate-500 ml-1">Context Parameters Loaded</h2>
                    </div>

                    {usageState?.warnings?.length ? (
                        <div className="mt-4 rounded-[22px] border border-amber-200/80 bg-[linear-gradient(180deg,#fffbeb,#fff)] px-5 py-4 shadow-sm">
                            <div className="flex flex-wrap items-start justify-between gap-3">
                                <div>
                                    <p className="text-[10px] font-bold uppercase tracking-[0.24em] text-amber-600">Gemini request health</p>
                                    <p className="mt-2 text-sm font-semibold text-slate-900">
                                        {quotaBlocked
                                            ? `Cooldown active till ${formatDateTime(usageState.blockedUntil)}`
                                            : usageState.warnings[0]}
                                    </p>
                                    <p className="mt-1 text-xs text-slate-500">
                                        App-tracked estimate. Daily reset window: {formatDateTime(usageState.nextResetAt)}.
                                    </p>
                                </div>
                                <div className="flex flex-wrap gap-2">
                                    <span className="tool-chip bg-white">
                                        Daily load {usageState.usedWeightedUsage}/{usageState.softDailyLimit}
                                    </span>
                                    <span className="tool-chip bg-white">
                                        Hour load {usageState.lastHourWeightedUsage}/{usageState.softHourlyLimit}
                                    </span>
                                </div>
                            </div>
                        </div>
                    ) : null}

                    <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-6">
                        <div className="rounded-[22px] border border-sky-100/60 bg-white/80 px-5 py-5 shadow-sm backdrop-blur-xl transition hover:border-sky-200">
                            <p className="text-[10px] font-bold uppercase tracking-[0.24em] text-slate-400">Institute Context</p>
                            <p className="mt-2 truncate text-sm font-semibold text-slate-900">{mediaContext?.organizationName || "Workspace Mode"}</p>
                            <p className="mt-1 line-clamp-2 text-xs text-slate-500">{mediaContext?.organizationSummary || "Brand guidelines active."}</p>
                        </div>
                        <div className="rounded-[22px] border border-sky-100/60 bg-white/80 px-5 py-5 shadow-sm backdrop-blur-xl transition hover:border-sky-200">
                            <p className="text-[10px] font-bold uppercase tracking-[0.24em] text-slate-400">Enterprise RAG</p>
                            <p className="mt-2 text-sm font-semibold text-slate-900">
                                {mediaContext?.totalIndexedItems || mediaContext?.indexSummary?.totalIndexedItems || 0} indexed chunks
                            </p>
                            <p className="mt-1 line-clamp-2 text-[11px] text-slate-500">{summarizeKnowledgeRefs(visibleKnowledgeReferences)}</p>
                        </div>
                        <div className="rounded-[22px] border border-sky-100/60 bg-white/80 px-5 py-5 shadow-sm backdrop-blur-xl transition hover:border-sky-200">
                            <p className="text-[10px] font-bold uppercase tracking-[0.24em] text-slate-400">Shared History</p>
                            <p className="mt-2 text-sm font-semibold text-slate-900">{results.length} saved assets</p>
                            <p className="mt-1 text-[11px] text-slate-500">{generatedImageCount} images · {generatedVideoCount} videos</p>
                        </div>
                        <div className="rounded-[22px] border border-sky-100/60 bg-indigo-50/50 px-5 py-5 shadow-sm backdrop-blur-xl transition hover:border-indigo-200">
                            <p className="text-[10px] font-bold uppercase tracking-[0.24em] text-indigo-400">Discipline</p>
                            <p className="mt-2 text-[11px] leading-relaxed text-indigo-800">Prompt with exact deliverables. Focus on strict brand adherence. AI will filter irrelevant output.</p>
                        </div>
                        <div className={`rounded-[22px] border px-5 py-5 shadow-sm backdrop-blur-xl transition ${
                            quotaBlocked
                                ? "border-amber-200/80 bg-amber-50/70 hover:border-amber-300"
                                : "border-sky-100/60 bg-white/80 hover:border-sky-200"
                        }`}>
                            <p className="text-[10px] font-bold uppercase tracking-[0.24em] text-slate-400">Gemini Budget</p>
                            <p className="mt-2 text-sm font-semibold text-slate-900">
                                {usageState ? `${usageState.usedWeightedUsage}/${usageState.softDailyLimit}` : "—"}
                            </p>
                            <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-100">
                                <div
                                    className={`h-full rounded-full transition-all ${
                                        (usageState?.usagePercent || 0) >= 80 ? "bg-amber-500" : "bg-sky-500"
                                    }`}
                                    style={{ width: `${Math.min(usageState?.usagePercent || 0, 100)}%` }}
                                />
                            </div>
                            <p className="mt-2 text-[11px] text-slate-500">
                                {usageState ? `${usageState.usagePercent}% daily load used` : "Loading usage..."}
                            </p>
                        </div>
                        <div className={`rounded-[22px] border px-5 py-5 shadow-sm backdrop-blur-xl transition ${
                            quotaBlocked
                                ? "border-amber-200/80 bg-amber-50/70 hover:border-amber-300"
                                : "border-sky-100/60 bg-white/80 hover:border-sky-200"
                        }`}>
                            <p className="text-[10px] font-bold uppercase tracking-[0.24em] text-slate-400">Index Health</p>
                            <p className="mt-2 text-sm font-semibold text-slate-900">
                                {mediaContext?.indexSummary?.embeddingsEnabled ? "Semantic + lexical" : "Lexical-first"}
                            </p>
                            <p className="mt-1 text-[11px] text-slate-500">
                                {mediaContext?.indexSummary?.lastSyncedAt
                                    ? `Last sync ${formatDateTime(mediaContext.indexSummary.lastSyncedAt)}`
                                    : "Index warms up on first retrieval."}
                            </p>
                        </div>
                    </div>

                    {knowledgeSourceBreakdown.length ? (
                        <div className="mt-4 overflow-x-auto rounded-[24px] border border-sky-100/70 bg-white/75 px-4 py-3 shadow-sm backdrop-blur-xl">
                            <div className="flex min-w-max items-center gap-2.5">
                                <span className="rounded-full bg-sky-50 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.22em] text-sky-700">
                                    Indexed Sources
                                </span>
                                {knowledgeSourceBreakdown.map((item) => (
                                    <span
                                        key={item.label}
                                        className="rounded-full border border-slate-200/80 bg-white px-3 py-1.5 text-[11px] font-semibold text-slate-600 shadow-sm"
                                    >
                                        {item.label} · {item.value}
                                    </span>
                                ))}
                            </div>
                        </div>
                    ) : null}
                </div>
            </div>

            {/* MAIN WORKSPACE SPLIT */}
            <div className={`flex flex-1 flex-col overflow-hidden w-full max-w-[1540px] mx-auto xl:flex-row transition-all duration-700 ${
                isContextExpanded 
                    ? "pt-6 pb-12" 
                    : "shadow-[0_-10px_40px_-15px_rgba(15,23,42,0.05)] bg-[linear-gradient(180deg,#f8fbff_0%,#ffffff_100%)] xl:rounded-t-[40px] xl:border xl:border-b-0 xl:border-sky-100/80"
            }`}>
                {/* CHAT AREA (Left Side) */}
                <div className={`flex flex-1 flex-col overflow-hidden ${isContextExpanded ? "" : "border-r border-slate-200/50"}`}>
                    {!isContextExpanded && usageState ? (
                        <div className={`mx-4 mt-4 rounded-[20px] border px-4 py-3 md:mx-8 ${
                            quotaBlocked
                                ? "border-amber-200 bg-[linear-gradient(180deg,#fffbeb,#fff)]"
                                : "border-sky-100 bg-white/80"
                        }`}>
                            <div className="flex flex-wrap items-center justify-between gap-3">
                                <div>
                                    <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-slate-500">
                                        Gemini request health
                                    </p>
                                    <p className="mt-1 text-sm font-semibold text-slate-900">
                                        {quotaBlocked
                                            ? `Cooldown active till ${formatDateTime(usageState.blockedUntil)}`
                                            : `${usageState.usedWeightedUsage}/${usageState.softDailyLimit} daily load · ${usageState.lastHourWeightedUsage}/${usageState.softHourlyLimit} in the last hour`}
                                    </p>
                                </div>
                                <div className="flex flex-wrap gap-2 text-xs text-slate-500">
                                    <span className="tool-chip bg-white">Daily {usageState.usagePercent}%</span>
                                    <span className="tool-chip bg-white">Hour {usageState.hourlyPercent}%</span>
                                </div>
                            </div>
                        </div>
                    ) : null}

                    {/* Chat Messages */}
                    <div ref={messageListRef} className={`flex-1 overflow-y-auto px-4 py-8 md:px-8 space-y-6 ${isContextExpanded ? "hidden" : "block"}`}>
                        {assistantMessages.map((message) => {
                            const isUser = message.role === "user";
                            return (
                                <div key={message.id} className={`flex ${isUser ? "justify-end" : "justify-start"} animate-in fade-in slide-in-from-bottom-2 duration-300`}>
                                    <div className={`max-w-[85%] rounded-[26px] px-5 py-4 shadow-sm ${
                                        isUser
                                            ? "border border-sky-200/60 bg-[linear-gradient(180deg,#eff6ff,#e0f2fe)] text-slate-900"
                                            : "border border-slate-200/60 bg-white text-slate-800"
                                    }`}>
                                        <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400">
                                            {isUser ? <Send className="h-3.5 w-3.5 text-sky-500" /> : <Bot className="h-3.5 w-3.5 text-indigo-400" />}
                                            {isUser ? "You" : message.kind === "generation" ? "Generation Log" : "AI Copilot"}
                                        </div>
                                        <p className="mt-2.5 whitespace-pre-wrap text-[15px] leading-relaxed">
                                            {message.content}
                                        </p>

                                        {message.knowledgeReferences?.length ? (
                                            <div className="mt-4 rounded-[18px] border border-slate-100 bg-slate-50/80 p-3">
                                                <p className="text-[9px] font-bold uppercase tracking-[0.24em] text-slate-400 mb-2">Retrieved for this step</p>
                                                <div className="space-y-1.5">{message.knowledgeReferences.slice(0, 2).map((ref, i) => (
                                                    <div key={i} className="rounded-xl border border-white bg-white/60 px-3 py-2 text-[11px] text-slate-600 shadow-sm">{formatKnowledgeType(ref.type)} · {ref.title}</div>
                                                ))}</div>
                                            </div>
                                        ) : null}

                                        {message.suggestedPrompt ? (
                                            <button type="button" onClick={() => setComposer(message.suggestedPrompt || "")} className="mt-3 inline-flex items-center gap-2 rounded-xl bg-indigo-50 px-3 py-2 text-xs font-semibold text-indigo-700 transition hover:bg-indigo-100">
                                                <Sparkles className="h-3.5 w-3.5" />
                                                Use suggestion
                                            </button>
                                        ) : null}
                                    </div>
                                </div>
                            );
                        })}

                        {loading && activeStage && (
                            <div className="flex justify-start animate-in fade-in duration-300">
                                <div className="max-w-[85%] rounded-[26px] border border-sky-100 bg-[linear-gradient(135deg,#eef6ff_0%,#ffffff_45%,#eef2ff_100%)] px-5 py-4 shadow-sm">
                                    <div className="flex items-center gap-4">
                                        <div className="relative flex h-11 w-11 items-center justify-center rounded-full bg-slate-900 text-white shadow-inner">
                                            <span className="absolute inset-0 rounded-full border border-white/10" />
                                            <span className="absolute inset-1 rounded-full border border-sky-300/40 animate-ping" />
                                            <LoaderCircle className="relative h-4 w-4 animate-spin" />
                                        </div>
                                        <div className="flex-1">
                                            <p className="text-sm font-semibold text-slate-900">{activeStage.label}</p>
                                            <p className="text-xs text-slate-500">{activeStage.detail}</p>
                                            <div className="mt-3 grid grid-cols-4 gap-2">
                                                {activeStages.map((stage, index) => (
                                                    <div
                                                        key={stage.label}
                                                        className={`h-1.5 rounded-full transition-all ${
                                                            index <= stageIndex ? "bg-sky-500" : "bg-slate-200"
                                                        }`}
                                                    />
                                                ))}
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        )}
                        <div className="h-4" />
                    </div>

                    {/* COMPOSER (Static Bottom) */}
                    <div className={`shrink-0 bg-white/80 px-4 py-4 md:px-8 backdrop-blur-xl space-y-3 transition-all duration-500 relative z-20 ${
                        isContextExpanded 
                            ? "w-full max-w-4xl mx-auto rounded-[32px] border border-slate-200/60 shadow-[0_12px_40px_-12px_rgba(0,0,0,0.08)] mt-auto" 
                            : "border-t border-slate-200/60 w-full"
                    }`}>
                        {needsReference ? (
                            <div className="flex items-center gap-3">
                                <label className="flex items-center gap-2 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-700 cursor-pointer shadow-sm hover:bg-emerald-100 transition">
                                    <Upload className="h-3.5 w-3.5" />
                                    <span>{referenceFile ? referenceFile.name : "Attach Reference (Required)"}</span>
                                    <input type="file" accept={mode === "image_from_reference" ? "image/*" : "image/*,video/*"} onChange={(e) => setReferenceFile(e.target.files?.[0] || null)} className="hidden" />
                                </label>
                                {referenceFile && <button type="button" onClick={() => setReferenceFile(null)} className="text-slate-400 hover:text-red-500"><X className="h-4 w-4" /></button>}
                            </div>
                        ) : null}

                        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
                            <div className="relative flex-1 rounded-[24px] border border-slate-200/80 bg-white shadow-[0_4px_20px_-10px_rgba(15,23,42,0.08)] focus-within:border-sky-300 focus-within:ring-4 focus-within:ring-sky-100/50 transition-all">
                                <textarea
                                    value={composer}
                                    onFocus={() => setIsContextExpanded(false)}
                                    onChange={(e) => setComposer(e.target.value)}
                                    onKeyDown={(e) => {
                                        if (e.key === 'Enter' && !e.shiftKey) {
                                            e.preventDefault();
                                            if (composer.trim()) {
                                                if (isChatOnly) handleAskAssistant();
                                                else handleGenerate();
                                            }
                                        }
                                    }}
                                    className="min-h-[56px] max-h-[200px] w-full resize-none border-0 bg-transparent px-5 py-4 text-sm leading-relaxed text-slate-950 placeholder:text-slate-400 focus:ring-0"
                                    placeholder="Message Copilot... Try 'ek biology folder cover banao, use institute logo'"
                                />
                                <div className="absolute right-2 bottom-2">
                                    {loading ? (
                                        <button 
                                            type="button" 
                                            onClick={() => {
                                                if(abortControllerRef.current) {
                                                    abortControllerRef.current.abort();
                                                    abortControllerRef.current = null;
                                                }
                                                setLoading(false);
                                                setActiveAction(null);
                                            }} 
                                            className="flex h-10 w-10 items-center justify-center rounded-full bg-slate-900 border-2 border-slate-900 shadow-md hover:bg-slate-800 transition"
                                        >
                                            <Square className="h-3.5 w-3.5 fill-white text-white" />
                                        </button>
                                    ) : (
                                        <button 
                                            type="button" 
                                            onClick={isChatOnly ? handleAskAssistant : handleGenerate} 
                                            disabled={!composer.trim() || quotaBlocked} 
                                            className="flex h-10 w-10 items-center justify-center rounded-full bg-slate-900 text-white shadow-md hover:bg-slate-800 disabled:opacity-40 transition"
                                        >
                                            <ArrowUp className="h-4 w-4" />
                                        </button>
                                    )}
                                </div>
                            </div>
                            
                            {!isChatOnly && (
                                <div className="flex items-center gap-2 shrink-0">
                                    {(mode === "text_to_image" || mode === "image_from_reference") && (
                                        <div className="relative">
                                            <select
                                                value={imageModel}
                                                onChange={(e) => setImageModel(e.target.value as ImageModelSelection)}
                                                className="h-[56px] appearance-none rounded-[20px] border border-slate-200 bg-white pl-10 pr-10 text-xs font-semibold text-slate-700 shadow-sm focus:border-sky-300 focus:ring-4 focus:ring-sky-100 outline-none cursor-pointer"
                                            >
                                                <option value="nano_banana">Nano Banana</option>
                                                <option value="auto">Auto</option>
                                            </select>
                                            <div className="absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none text-slate-500">
                                                <ImageIcon className="h-4 w-4" />
                                            </div>
                                            <div className="absolute right-3.5 top-1/2 -translate-y-1/2 pointer-events-none text-slate-400">
                                                <ChevronDown className="h-4 w-4" />
                                            </div>
                                        </div>
                                    )}

                                    {/* Simple Dropdown Mode Selector */}
                                    <div className="relative">
                                        <select
                                        value={mode}
                                        onChange={(e) => setMode(e.target.value as MediaMode)}
                                        className="h-[56px] appearance-none rounded-[20px] border border-slate-200 bg-white pl-10 pr-10 text-xs font-semibold text-slate-700 shadow-sm focus:border-sky-300 focus:ring-4 focus:ring-sky-100 outline-none cursor-pointer"
                                    >
                                        {MODE_META.map(m => (
                                            <option key={m.id} value={m.id}>{m.label}</option>
                                        ))}
                                    </select>
                                    <div className="absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none text-slate-500">
                                        <Wand2 className="h-4 w-4" />
                                    </div>
                                    <div className="absolute right-3.5 top-1/2 -translate-y-1/2 pointer-events-none text-slate-400">
                                        <ChevronDown className="h-4 w-4" />
                                    </div>
                                </div>
                            </div>
                            )}
                        </div>
                        <div className="flex items-center justify-between px-2 text-[11px] text-slate-400">
                            <div>
                                {quotaBlocked
                                    ? `Gemini cooldown active till ${formatDateTime(usageState?.blockedUntil)}`
                                    : <>Press <kbd className="rounded border border-slate-200 bg-slate-50 px-1 font-mono">Enter ↵</kbd> to {isChatOnly ? "send" : "generate"}</>}
                            </div>
                            <button type="button" onClick={() => setIsChatOnly(!isChatOnly)} className="font-medium text-sky-600 hover:text-sky-700 transition">
                                {isChatOnly ? "Generate Something" : "Just Chat (No Generate)"}
                            </button>
                        </div>
                    </div>
                </div>

                {/* OUTPUTS GALLERY (Right Side) */}
                <div className={`w-full flex-col xl:w-[420px] 2xl:w-[480px] bg-slate-50/50 xl:border-l xl:border-slate-200/50 ${
                    isContextExpanded ? "hidden" : "flex"
                }`}>
                    <div className="flex h-14 items-center justify-between border-b border-slate-200/60 px-5 bg-white/40 backdrop-blur-md">
                        <span className="text-[11px] font-bold uppercase tracking-[0.2em] text-slate-500">Output Gallery</span>
                        <div className="flex gap-2">
                            <span className="tool-chip bg-white shadow-sm"><History className="mr-1 h-3.5 w-3.5" /> {results.length}</span>
                            <button type="button" onClick={() => loadMediaContext()} disabled={mediaContextLoading} className="tool-chip bg-white hover:bg-sky-50 transition shadow-sm cursor-pointer"><RefreshCcw className="h-3.5 w-3.5" /></button>
                        </div>
                    </div>
                    
                    {/* ACTIVE PREVIEW (Sticky) */}
                    <div className="shrink-0 border-b border-slate-200/50 bg-[#f8fbff] p-5 pb-5 z-10 shadow-sm relative">
                        <h3 className="mb-3 text-[10px] font-bold uppercase tracking-[0.24em] text-indigo-400">Active Preview</h3>
                            {!primaryResult ? (
                                <div className="flex h-[240px] items-center justify-center rounded-[24px] border border-dashed border-slate-300 bg-white/50 text-slate-400 shadow-sm">
                                    <div className="text-center">
                                        <ImageIcon className="mx-auto h-8 w-8 opacity-50 mb-2" />
                                        <p className="text-xs">Outputs appear here</p>
                                    </div>
                                </div>
                            ) : (
                                <div className="rounded-[24px] border border-slate-200/80 bg-white p-2 shadow-sm">
                                    {primaryResult.type === "image" && primaryResult.assetUrl && !brokenAssetIdSet.has(primaryResult.id) && (
                                        <img
                                            src={buildGalleryAssetUrl(primaryResult)}
                                            alt="Output"
                                            loading="eager"
                                            decoding="async"
                                            onLoad={() => clearBrokenAsset(primaryResult.id)}
                                            onError={() => markAssetBroken(primaryResult.id)}
                                            className="w-full rounded-[18px] bg-slate-100 object-cover"
                                        />
                                    )}
                                    {primaryResult.type === "video" && primaryResult.assetUrl && (
                                        <video src={buildGalleryAssetUrl(primaryResult)} controls className="w-full rounded-[18px] bg-black" />
                                    )}
                                    {((primaryResult.type === "image" && (!primaryResult.assetUrl || brokenAssetIdSet.has(primaryResult.id))) ||
                                        (primaryResult.type !== "image" && !primaryResult.assetUrl)) && (
                                        <div className="flex h-[240px] items-center justify-center rounded-[18px] border border-dashed border-slate-300 bg-slate-50 text-slate-400">
                                            <div className="text-center">
                                                <ImageIcon className="mx-auto h-8 w-8 opacity-50 mb-2" />
                                                <p className="text-xs font-medium">Asset preview unavailable</p>
                                                <p className="mt-1 text-[11px] text-slate-400">Refresh history to reload this output.</p>
                                            </div>
                                        </div>
                                    )}
                                    <div className="mt-3 px-2 pb-1">
                                        <p className="line-clamp-2 text-[13px] font-medium text-slate-800">{primaryResult.prompt}</p>
                                        <p className="mt-1 text-[11px] text-slate-400">{formatSavedAt(primaryResult.createdAt)}</p>
                                        <AssetActionsBar asset={primaryResult} onPublish={setPublishConfig} />
                                    </div>
                                </div>
                            )}
                    </div>

                    {/* SAVED HISTORY SCROLLABLE AREA */}
                    <div className="flex-1 overflow-y-auto p-5 pb-10">
                        {/* SAVED HISTORY */}
                        {results.length > 0 && (
                            <div>
                                <h3 className="mb-3 text-[10px] font-bold uppercase tracking-[0.24em] text-slate-400">Shared History</h3>
                                <div className="grid grid-cols-2 gap-3">
                                    {results.map(r => (
                                        <button 
                                            key={r.id} 
                                            type="button"
                                            onClick={() => setCurrentResultId(r.id)}
                                            className={`group relative aspect-square w-full overflow-hidden rounded-[20px] border transition ${
                                                primaryResult?.id === r.id ? "border-sky-400 ring-2 ring-sky-100" : "border-slate-200 hover:border-slate-300"
                                            }`}
                                        >
                                            {r.type === "image" && r.assetUrl && !brokenAssetIdSet.has(r.id) ? (
                                                <img
                                                    src={buildGalleryAssetUrl(r)}
                                                    className="h-full w-full object-cover"
                                                    alt=""
                                                    loading="lazy"
                                                    decoding="async"
                                                    onLoad={() => clearBrokenAsset(r.id)}
                                                    onError={() => markAssetBroken(r.id)}
                                                />
                                            ) : (
                                                <div className="flex h-full w-full items-center justify-center bg-slate-100 text-slate-400">
                                                    {r.type === 'video' ? <Video className="h-6 w-6" /> : <ImageIcon className="h-6 w-6" />}
                                                </div>
                                            )}
                                            <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/60 p-2 opacity-0 group-hover:opacity-100 transition-opacity">
                                                <p className="truncate text-[10px] text-white font-medium">{r.prompt}</p>
                                            </div>
                                        </button>
                                    ))}
                                </div>
                            </div>
                        )}
                    </div>
                </div>

            </div>
        </div>
    );
}
