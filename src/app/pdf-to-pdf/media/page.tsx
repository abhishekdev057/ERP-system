"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useSession } from "next-auth/react";
import toast from "react-hot-toast";

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

const MODES: Array<{ id: MediaMode; label: string; hint: string }> = [
    { id: "text_to_image", label: "Text to Image", hint: "Prompt-driven visual generation" },
    { id: "text_to_video", label: "Text to Video", hint: "Storyboard-first video planning" },
    { id: "image_from_reference", label: "Image from Reference", hint: "Generate image variant from reference direction" },
    { id: "video_from_reference", label: "Video from Reference", hint: "Generate video plan from reference direction" },
];

export default function MediaStudioPage() {
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

    const selectedMode = useMemo(() => MODES.find((item) => item.id === mode), [mode]);
    const needsReference = mode === "image_from_reference" || mode === "video_from_reference";

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
                        Generate institute creative assets with text/reference inputs. Supports text-to-image, text-to-video planning, and reference-driven variations.
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
        </div>
    );
}
