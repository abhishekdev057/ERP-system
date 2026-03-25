"use client";

import { useEffect, useMemo, useState } from "react";
import { useSession } from "next-auth/react";
import toast from "react-hot-toast";

type MediaMode =
    | "text_to_image"
    | "text_to_video"
    | "image_from_reference"
    | "video_from_reference";

type MediaKnowledgeReference = {
    type: "book" | "document";
    title: string;
    summary: string;
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
};

type MediaContextState = {
    organizationLogoUrl?: string | null;
    organizationName?: string | null;
    organizationSummary?: string;
    organizationContextApplied: boolean;
    availableBookCount?: number;
    availableDocumentCount?: number;
    knowledgeReferences?: MediaKnowledgeReference[];
};

const MODES: Array<{ id: MediaMode; label: string; hint: string }> = [
    { id: "text_to_image", label: "Text to Image", hint: "Prompt-driven visual generation" },
    { id: "text_to_video", label: "Text to Video", hint: "Storyboard-first video planning" },
    { id: "image_from_reference", label: "Image from Reference", hint: "Generate image variant from reference direction" },
    { id: "video_from_reference", label: "Video from Reference", hint: "Generate video plan from reference direction" },
];

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

    const [mode, setMode] = useState<MediaMode>("text_to_image");
    const [prompt, setPrompt] = useState("");
    const [durationSec, setDurationSec] = useState(12);
    const [referenceFile, setReferenceFile] = useState<File | null>(null);
    const [loading, setLoading] = useState(false);
    const [results, setResults] = useState<MediaResult[]>([]);
    const [mediaContext, setMediaContext] = useState<MediaContextState | null>(null);
    const [mediaContextLoading, setMediaContextLoading] = useState(false);

    const selectedMode = useMemo(() => MODES.find((item) => item.id === mode), [mode]);
    const needsReference = mode === "image_from_reference" || mode === "video_from_reference";

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

            setMediaContext({
                organizationLogoUrl: data.organizationLogoUrl || null,
                organizationName: data.organizationName || null,
                organizationSummary: data.organizationSummary || "",
                organizationContextApplied: Boolean(data.organizationContextApplied),
                availableBookCount: Number(data.availableBookCount || 0),
                availableDocumentCount: Number(data.availableDocumentCount || 0),
                knowledgeReferences: Array.isArray(data.knowledgeReferences) ? data.knowledgeReferences : [],
            });
            setResults(Array.isArray(data.savedMedia) ? data.savedMedia : []);
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
            const formData = new FormData();
            formData.append("mode", mode);
            formData.append("prompt", prompt);
            formData.append("durationSec", String(durationSec));
            if (referenceFile) {
                formData.append("referenceFile", referenceFile);
                formData.append("referenceName", referenceFile.name);
            }

            const response = await fetch("/api/content-studio/media-generate", {
                method: "POST",
                body: formData,
            });

            const data = await response.json().catch(() => ({}));
            if (!response.ok) {
                throw new Error(data.error || "Generation failed");
            }

            const next: MediaResult = {
                id: String(data.id || `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`),
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
            };

            setResults((prev) => [next, ...prev.filter((item) => item.id !== next.id)]);
            toast.success(
                data.type === "image"
                    ? "Image generated and saved"
                    : data.type === "video"
                        ? "Video generated and saved"
                        : "Video plan saved"
            );
        } catch (error: any) {
            console.error(error);
            toast.error(error.message || "Media generation failed");
        } finally {
            setLoading(false);
        }
    };

    if (!hasAccess) {
        return (
            <div className="surface p-10 text-center">
                <h2 className="heading-xl">Media Studio Access Required</h2>
                <p className="text-sm text-slate-500 mt-2">
                    Ask your workspace admin to grant `media-studio` access.
                </p>
            </div>
        );
    }

    return (
        <section className="grid grid-cols-1 xl:grid-cols-3 gap-4">
            <article className="surface p-4 xl:col-span-1">
                <p className="text-xs font-bold uppercase tracking-wide text-slate-500 mb-3">Generation Input</p>

                <div className="space-y-3">
                    <div className="rounded-2xl border border-slate-200 bg-slate-50/90 px-3 py-3">
                        <div className="flex items-start justify-between gap-3">
                            <div className="flex items-start gap-3 min-w-0">
                                {mediaContext?.organizationLogoUrl ? (
                                    <img
                                        src={mediaContext.organizationLogoUrl}
                                        alt={`${mediaContext.organizationName || "Organization"} logo`}
                                        className="w-14 h-14 rounded-xl border border-slate-200 bg-white object-contain p-2 shrink-0"
                                    />
                                ) : (
                                    <div className="w-14 h-14 rounded-xl border border-dashed border-slate-300 bg-white/80 flex items-center justify-center text-[10px] font-semibold uppercase tracking-wide text-slate-400 shrink-0">
                                        Logo
                                    </div>
                                )}
                                <div className="min-w-0">
                                    <p className="text-[11px] font-bold uppercase tracking-wide text-slate-500">AI Institute Context</p>
                                    <p className="text-sm font-semibold text-slate-900 mt-1">
                                        {mediaContext?.organizationName || "Workspace organization"}
                                    </p>
                                    <div className="flex flex-wrap gap-2 mt-2">
                                        <span className="tool-chip">{mediaContext?.availableBookCount || 0} library item(s)</span>
                                        <span className="tool-chip">{mediaContext?.availableDocumentCount || 0} workspace doc(s)</span>
                                    </div>
                                </div>
                            </div>
                            <span className={`status-badge ${mediaContext?.organizationContextApplied ? "" : "bg-amber-100 text-amber-700"}`}>
                                {mediaContextLoading
                                    ? "Loading"
                                    : mediaContext?.organizationContextApplied
                                        ? "Active"
                                        : "Missing"}
                            </span>
                        </div>
                        <p className="text-xs text-slate-600 mt-2 leading-relaxed">
                            {mediaContext?.organizationContextApplied
                                ? mediaContext.organizationSummary
                                : "Organization profile details are not complete yet, so Media Studio will only use the typed prompt until the institute profile is filled in."}
                        </p>
                        <p className="text-[11px] text-slate-500 mt-2">
                            Generated media is now saved automatically and reloads from history on every visit.
                        </p>
                        {mediaContext?.knowledgeReferences?.length ? (
                            <div className="mt-3 rounded-xl border border-slate-200 bg-white/80 px-3 py-3">
                                <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                                    Organization Materials Available To AI
                                </p>
                                <div className="mt-2 space-y-2">
                                    {mediaContext.knowledgeReferences.map((reference, index) => (
                                        <div key={`${reference.type}-${reference.title}-${index}`} className="rounded-lg border border-slate-100 bg-slate-50 px-2.5 py-2">
                                            <p className="text-[11px] font-semibold text-slate-700">
                                                {reference.type === "book" ? "Library" : "Document"} · {reference.title}
                                            </p>
                                            <p className="text-[11px] text-slate-600 mt-1 leading-relaxed">{reference.summary}</p>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        ) : null}
                    </div>

                    <div>
                        <label className="text-xs font-semibold text-slate-600">Mode</label>
                        <div className="grid grid-cols-1 gap-2 mt-2">
                            {MODES.map((item) => (
                                <button
                                    key={item.id}
                                    type="button"
                                    onClick={() => setMode(item.id)}
                                    className={`text-left px-3 py-2 rounded-lg border text-xs transition ${
                                        mode === item.id
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
                            placeholder="Describe the output clearly. Example: Create an admission campaign poster for B.Sc Agriculture with premium green branding, exact institute logo, and Instagram-ready layout. AI will choose the best visual style and frame from the prompt."
                        />
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
                                accept={mode === "image_from_reference" ? "image/*" : "image/*,video/*"}
                                onChange={(event) => setReferenceFile(event.target.files?.[0] || null)}
                                className="input mt-1"
                            />
                            {referenceFile && (
                                <p className="text-[11px] text-slate-500 mt-1">Selected: {referenceFile.name}</p>
                            )}
                        </div>
                    )}

                    <div className="flex flex-wrap gap-2">
                        <button type="button" onClick={handleGenerate} disabled={loading} className="btn btn-primary flex-1 text-xs">
                            {loading ? "Generating..." : `Generate ${selectedMode?.label || "Asset"}`}
                        </button>
                        <button
                            type="button"
                            onClick={() => void loadMediaContext()}
                            disabled={mediaContextLoading}
                            className="btn btn-ghost text-xs"
                        >
                            {mediaContextLoading ? "Refreshing..." : "Refresh History"}
                        </button>
                    </div>
                </div>
            </article>

            <article className="surface p-4 xl:col-span-2">
                <div className="flex items-center justify-between gap-2 mb-3">
                    <div>
                        <p className="text-xs font-bold uppercase tracking-wide text-slate-500">Saved & Generated Outputs</p>
                        <p className="text-[11px] text-slate-500 mt-1">Every generated media item is saved to the database and reloads here.</p>
                    </div>
                    <span className="status-badge">{results.length} item(s)</span>
                </div>

                {results.length === 0 ? (
                    <div className="empty-state py-12">
                        <h3>No media output yet</h3>
                        <p className="text-sm">Run a generation request to create and save results.</p>
                    </div>
                ) : (
                    <div className="space-y-3 max-h-[75vh] overflow-auto pr-1">
                        {results.map((result) => (
                            <div key={result.id} className="surface-subtle p-3 border border-slate-200 rounded-xl">
                                <div className="flex flex-wrap items-center justify-between gap-2">
                                    <div>
                                        <p className="text-sm font-semibold text-slate-900">
                                            {MODES.find((item) => item.id === result.mode)?.label || result.mode}
                                        </p>
                                        <p className="text-xs text-slate-500">
                                            {[result.aspectRatio ? `${result.aspectRatio} frame` : "AI-chosen frame", `Saved ${formatSavedAt(result.createdAt)}`].join(" · ")}
                                        </p>
                                    </div>
                                    <span className={`px-2 py-1 rounded-md text-[10px] font-bold uppercase ${result.status === "generated" ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"}`}>
                                        {result.status}
                                    </span>
                                </div>

                                <p className="text-xs text-slate-700 mt-2">{result.prompt}</p>

                                {result.institutionContextApplied && result.organizationSummary && (
                                    <div className="mt-2 rounded-lg border border-indigo-100 bg-indigo-50/70 px-3 py-2">
                                        <p className="text-[11px] font-semibold uppercase tracking-wide text-indigo-700">
                                            Institute Context Applied
                                        </p>
                                        {result.organizationLogoUrl ? (
                                            <div className="mt-2 flex items-center gap-3 rounded-lg border border-indigo-100 bg-white/70 px-2.5 py-2">
                                                <img
                                                    src={result.organizationLogoUrl}
                                                    alt={`${result.organizationName || "Organization"} logo`}
                                                    className="w-10 h-10 rounded-lg border border-slate-200 bg-white object-contain p-1.5 shrink-0"
                                                />
                                                <div>
                                                    <p className="text-[11px] font-semibold text-indigo-900">
                                                        Official institute logo was part of the AI context
                                                    </p>
                                                    <p className="text-[11px] text-indigo-800 mt-0.5">
                                                        If your prompt explicitly asked for the logo, the system tried to preserve the exact uploaded mark.
                                                    </p>
                                                </div>
                                            </div>
                                        ) : null}
                                        <p className="text-[11px] text-indigo-900 mt-1 leading-relaxed">
                                            {result.organizationSummary}
                                        </p>
                                    </div>
                                )}

                                {result.knowledgeReferences?.length ? (
                                    <div className="mt-2 rounded-lg border border-slate-200 bg-slate-50/80 px-3 py-2">
                                        <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-600">
                                            Organization Material Used
                                        </p>
                                        <div className="mt-2 space-y-2">
                                            {result.knowledgeReferences.map((reference, index) => (
                                                <div key={`${result.id}-${reference.type}-${reference.title}-${index}`}>
                                                    <p className="text-[11px] font-semibold text-slate-700">
                                                        {reference.type === "book" ? "Library" : "Document"} · {reference.title}
                                                    </p>
                                                    <p className="text-[11px] text-slate-600 mt-0.5 leading-relaxed">
                                                        {reference.summary}
                                                    </p>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                ) : null}

                                {result.referenceName && (
                                    <p className="text-[11px] text-slate-500 mt-1">Reference: {result.referenceName}</p>
                                )}

                                {result.effectivePrompt && (
                                    <details className="mt-2 rounded-lg border border-slate-200 bg-white/80 px-3 py-2">
                                        <summary className="cursor-pointer text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                                            AI Prompt Used
                                        </summary>
                                        <p className="text-[11px] text-slate-700 mt-2 leading-relaxed">
                                            {result.effectivePrompt}
                                        </p>
                                    </details>
                                )}

                                {result.type === "image" && result.assetUrl && (
                                    <div className="mt-3">
                                        <img src={result.assetUrl} alt="Generated output" className="w-full max-h-[420px] object-contain rounded-lg border border-slate-200 bg-white" />
                                        <a href={result.assetUrl} target="_blank" rel="noreferrer" className="text-xs text-indigo-600 font-semibold mt-2 inline-block">
                                            Open full image
                                        </a>
                                        {result.note && <p className="text-[11px] text-amber-700 mt-2">{result.note}</p>}
                                    </div>
                                )}

                                {result.type === "video" && result.assetUrl && (
                                    <div className="mt-3">
                                        <video src={result.assetUrl} controls className="w-full max-h-[420px] rounded-lg border border-slate-200 bg-black" />
                                        <a href={result.assetUrl} target="_blank" rel="noreferrer" className="text-xs text-indigo-600 font-semibold mt-2 inline-block">
                                            Open full video
                                        </a>
                                        {result.note && <p className="text-[11px] text-amber-700 mt-2">{result.note}</p>}
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
    );
}
