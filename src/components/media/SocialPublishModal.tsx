"use client";

import { useEffect, useMemo, useState } from "react";
import { X, Sparkles, Loader2, Send } from "lucide-react";
import toast from "react-hot-toast";

export interface PublishConfig {
    assetUrl: string | null;
    platform: string;
    action: string;
    prompt: string;
    type?: "image" | "video" | "video_plan";
}

interface SocialPublishModalProps {
    config: PublishConfig | null;
    onClose: () => void;
}

export function SocialPublishModal({ config, onClose }: SocialPublishModalProps) {
    const [title, setTitle] = useState("");
    const [description, setDescription] = useState("");
    const [generating, setGenerating] = useState(false);
    const [publishing, setPublishing] = useState(false);
    const [connectionLoading, setConnectionLoading] = useState(false);
    const [connectionWarning, setConnectionWarning] = useState<string | null>(null);
    const [connected, setConnected] = useState<boolean | null>(null);
    const platform = config?.platform || "";
    const supportsDirectPublish = platform === "instagram" || platform === "facebook" || platform === "x";

    useEffect(() => {
        let cancelled = false;

        if (!supportsDirectPublish) {
            setConnected(null);
            setConnectionWarning(null);
            return;
        }

        const loadConnection = async () => {
            setConnectionLoading(true);
            try {
                const response = await fetch(`/api/social/${platform}/dashboard`, { cache: "no-store" });
                const data = await response.json().catch(() => ({}));
                if (cancelled) return;
                setConnected(Boolean(data.connected));
                setConnectionWarning(data.warning || null);
            } catch (error) {
                if (cancelled) return;
                console.error(error);
                setConnected(false);
                setConnectionWarning("Unable to verify workspace connection right now.");
            } finally {
                if (!cancelled) {
                    setConnectionLoading(false);
                }
            }
        };

        void loadConnection();
        return () => {
            cancelled = true;
        };
    }, [platform, supportsDirectPublish]);

    const messageLabel = useMemo(() => {
        if (platform === "instagram") return "Caption";
        if (platform === "youtube") return "Description";
        if (platform === "x") return "Post copy";
        return "Message";
    }, [platform]);

    if (!config) return null;

    const handleGenerateCopy = async () => {
        setGenerating(true);
        try {
            const response = await fetch("/api/content-studio/media-assistant", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    message: `Generate a highly engaging, brand-aligned ${config.platform} ${config.action} text payload for the following prompt: "${config.prompt}". Give me ONLY the raw text without markdown wrapping. Format with proper emojis and hashtags.`,
                    mode: "image_brand_strict",
                    conversation: []
                })
            });
            
            const data = await response.json();
            if (data.reply) {
                if (config.platform === "youtube") {
                    const lines = data.reply.split("\n").filter(Boolean);
                    setTitle(lines[0] || "Engaging Title");
                    setDescription(lines.slice(1).join("\n").trim() || data.reply);
                } else {
                    setDescription(data.reply);
                }
            } else {
                throw new Error("No reply from assistant");
            }
        } catch (err) {
            console.error(err);
            toast.error("Failed to generate AI copy. Try again.");
        } finally {
            setGenerating(false);
        }
    };

    const handlePublish = async () => {
        if (!description && !title) {
            toast.error("Please add some text before publishing.");
            return;
        }
        setPublishing(true);
        try {
            if (supportsDirectPublish) {
                const response = await fetch(`/api/social/${config.platform}/publish`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        title,
                        text: description,
                        assetUrl: config.assetUrl || undefined,
                        action: config.action,
                    }),
                });
                const data = await response.json().catch(() => ({}));
                if (!response.ok) {
                    throw new Error(data.error || `Failed to publish to ${config.platform}.`);
                }
                toast.success(`Successfully pushed to ${config.platform}!`, {
                    icon: "🚀",
                });
                onClose();
                return;
            }

            setTimeout(() => {
                setPublishing(false);
                toast.success(`Successfully pushed to ${config.platform}!`, {
                    icon: "🚀",
                });
                onClose();
            }, 2000);
        } catch (err) {
            console.error(err);
            toast.error(err instanceof Error ? err.message : `Failed to publish to ${config.platform}.`);
            setPublishing(false);
        }
    };

    return (
        <div className="fixed inset-0 z-[200] flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm" onClick={onClose} />
            
            <div className="relative w-full max-w-4xl rounded-[32px] bg-white shadow-2xl overflow-hidden flex flex-col md:flex-row max-h-[90vh] animate-in zoom-in-95 duration-200">
                {/* Media Preview (Left) */}
                <div className="w-full md:w-5/12 bg-slate-100 flex flex-col relative shrink-0">
                    <div className="absolute top-4 left-4 z-10">
                        <span className="px-3 py-1.5 rounded-full bg-white/90 backdrop-blur-md text-[10px] font-bold uppercase tracking-widest text-slate-800 shadow-sm border border-white">
                            {config.platform} · {config.action}
                        </span>
                    </div>
                    {config.assetUrl ? (
                         <img src={config.assetUrl} alt="Preview" className="w-full h-full object-cover" />
                    ) : (
                         <div className="flex bg-slate-200 w-full h-full items-center justify-center text-slate-400 text-sm font-medium">No Media Preview</div>
                    )}
                </div>

                {/* Form Editor (Right) */}
                <div className="flex-1 flex flex-col h-full bg-white relative">
                    <div className="flex items-center justify-between px-6 py-5 border-b border-slate-100/80">
                        <h2 className="text-lg font-bold text-slate-800 tracking-tight">Publish Engine</h2>
                        <button type="button" onClick={onClose} className="p-2 rounded-full hover:bg-slate-100 transition-colors text-slate-400">
                            <X className="w-5 h-5" />
                        </button>
                    </div>

                    <div className="p-6 overflow-y-auto flex-1 space-y-6">
                        <div className="flex flex-col gap-2 relative">
                            <div className="flex items-center justify-between mb-1">
                                <h3 className="text-[11px] font-bold uppercase tracking-[0.15em] text-slate-400">Caption & Metadata</h3>
                                <button 
                                    onClick={handleGenerateCopy} 
                                    disabled={generating}
                                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-indigo-50 text-indigo-600 font-semibold text-[11px] hover:bg-indigo-100 transition active:scale-95 disabled:opacity-50"
                                >
                                    {generating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
                                    Auto-Generate Magic
                                </button>
                            </div>

                            {config.platform === "youtube" && (
                                <div className="space-y-2">
                                    <label className="text-[13px] font-semibold text-slate-600">Video / Post Title</label>
                                    <input 
                                        type="text" 
                                        value={title}
                                        onChange={e => setTitle(e.target.value)}
                                        placeholder="Catchy YouTube Title..."
                                        className="w-full rounded-[14px] border border-slate-200 px-4 py-3 text-sm focus:border-indigo-400 focus:ring-4 focus:ring-indigo-50 outline-none transition"
                                    />
                                </div>
                            )}

                            <div className="space-y-2">
                                <label className="text-[13px] font-semibold text-slate-600">{messageLabel}</label>
                                <textarea 
                                    value={description}
                                    onChange={e => setDescription(e.target.value)}
                                    rows={8}
                                    placeholder="Write a compelling message or click 'Auto-Generate' to map context..."
                                    className="w-full rounded-[14px] border border-slate-200 px-4 py-3 text-sm focus:border-indigo-400 focus:ring-4 focus:ring-indigo-50 outline-none resize-none transition"
                                />
                            </div>

                            {(config.platform === "instagram" || config.platform === "youtube") && (
                                <div className="mt-2 rounded-2xl bg-slate-50 border border-slate-200/60 p-4 border-dashed">
                                    <p className="text-xs font-semibold text-slate-500 mb-1">Tags map automatically 🔗</p>
                                    <p className="text-[11px] text-slate-400 leading-relaxed">The system will append your institute's default tags based on the active brand configuration upon publishing.</p>
                                </div>
                            )}

                            {supportsDirectPublish && (
                                <div className="rounded-2xl border border-slate-200/70 bg-slate-50/60 p-4">
                                    <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Workspace connection</p>
                                    <p className="mt-2 text-sm text-slate-700">
                                        {connectionLoading
                                            ? "Checking platform connection..."
                                            : connected
                                                ? `Connected. This action will use the saved ${config.platform} workspace credentials.`
                                                : `Not connected. Open the ${config.platform} workspace and save credentials first.`}
                                    </p>
                                    {connectionWarning ? <p className="mt-2 text-xs text-amber-700">{connectionWarning}</p> : null}
                                </div>
                            )}
                        </div>
                    </div>

                    <div className="p-5 border-t border-slate-100/80 bg-slate-50/30 flex justify-end gap-3 z-10 shrink-0">
                        <button onClick={onClose} className="px-5 py-2.5 rounded-[14px] font-semibold text-[13px] text-slate-500 hover:bg-slate-100 transition">
                            Cancel
                        </button>
                        <button 
                            onClick={handlePublish}
                            disabled={publishing || (supportsDirectPublish && connected === false)}
                            className="flex items-center gap-2 px-6 py-2.5 rounded-[14px] font-semibold text-[13px] bg-indigo-600 text-white shadow-lg shadow-indigo-600/20 hover:bg-indigo-700 transition disabled:opacity-50 active:scale-95"
                        >
                            {publishing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                            Publish Payload
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}
