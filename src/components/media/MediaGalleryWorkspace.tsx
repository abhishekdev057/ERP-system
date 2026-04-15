"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import {
    ArrowLeft,
    ArrowUpRight,
    Clapperboard,
    ImageIcon,
    LoaderCircle,
    RefreshCcw,
} from "lucide-react";
import toast from "react-hot-toast";
import { StudioWorkspaceHero } from "@/components/content-studio/StudioWorkspaceHero";
import { formatDateTime } from "@/lib/utils";

type MediaMode =
    | "text_to_image"
    | "text_to_video"
    | "image_from_reference"
    | "video_from_reference";

type MediaResult = {
    id: string;
    mode: MediaMode;
    status: string;
    type: "image" | "video" | "video_plan";
    prompt: string;
    aspectRatio: string;
    assetUrl?: string;
    createdAt?: string;
};

type SavedMediaPageInfo = {
    total: number;
    offset: number;
    limit: number;
    hasMore: boolean;
};

function buildGalleryAssetUrl(asset: Pick<MediaResult, "assetUrl" | "createdAt" | "id">) {
    const base = String(asset.assetUrl || "").trim();
    if (!base) return "";
    const separator = base.includes("?") ? "&" : "?";
    const stamp = encodeURIComponent(asset.createdAt || asset.id);
    return `${base}${separator}v=${stamp}`;
}

function prettyModeLabel(mode: MediaMode) {
    switch (mode) {
        case "text_to_video":
            return "Text to Video";
        case "image_from_reference":
            return "Image from Reference";
        case "video_from_reference":
            return "Video from Reference";
        case "text_to_image":
        default:
            return "Text to Image";
    }
}

export function MediaGalleryWorkspace() {
    const [results, setResults] = useState<MediaResult[]>([]);
    const [pageInfo, setPageInfo] = useState<SavedMediaPageInfo>({
        total: 0,
        offset: 0,
        limit: 36,
        hasMore: false,
    });
    const [loading, setLoading] = useState(true);
    const [loadingMore, setLoadingMore] = useState(false);
    const [loadedIds, setLoadedIds] = useState<string[]>([]);
    const sentinelRef = useRef<HTMLDivElement | null>(null);

    const loadPage = async (options?: { offset?: number; append?: boolean }) => {
        const offset = Math.max(0, Number(options?.offset || 0));
        const append = Boolean(options?.append);

        if (append) {
            setLoadingMore(true);
        } else {
            setLoading(true);
        }

        try {
            const response = await fetch(
                `/api/content-studio/media-generate?historyOnly=1&limit=36&offset=${offset}`,
                { cache: "no-store" }
            );
            const data = await response.json().catch(() => ({}));
            if (!response.ok) {
                throw new Error(data.error || "Full gallery could not be loaded.");
            }

            const nextItems = Array.isArray(data.savedMedia) ? (data.savedMedia as MediaResult[]) : [];
            setResults((current) => {
                if (!append) return nextItems;
                const seen = new Set(current.map((item) => item.id));
                return [...current, ...nextItems.filter((item) => !seen.has(item.id))];
            });
            setPageInfo({
                total: Number(data.savedMediaPageInfo?.total || 0),
                offset: Number(data.savedMediaPageInfo?.offset || offset),
                limit: Number(data.savedMediaPageInfo?.limit || 36),
                hasMore: Boolean(data.savedMediaPageInfo?.hasMore),
            });
        } catch (error) {
            console.error(error);
            toast.error(error instanceof Error ? error.message : "Gallery could not be loaded.");
        } finally {
            if (append) {
                setLoadingMore(false);
            } else {
                setLoading(false);
            }
        }
    };

    useEffect(() => {
        void loadPage();
    }, []);

    useEffect(() => {
        const sentinel = sentinelRef.current;
        if (!sentinel || !pageInfo.hasMore) return;

        const observer = new IntersectionObserver(
            (entries) => {
                const target = entries[0];
                if (!target?.isIntersecting || loadingMore) return;
                void loadPage({ offset: results.length, append: true });
            },
            { rootMargin: "1200px 0px 1200px 0px" }
        );

        observer.observe(sentinel);
        return () => observer.disconnect();
    }, [loadingMore, pageInfo.hasMore, results.length]);

    const stats = useMemo(() => {
        const images = results.filter((item) => item.type === "image").length;
        const videos = results.filter((item) => item.type === "video").length;
        return { images, videos };
    }, [results]);

    return (
        <div className="page-container" style={{ width: "min(1580px, calc(100% - 2rem))" }}>
            <StudioWorkspaceHero
                theme="media"
                eyebrow="Institute Suite · Gallery"
                title="Creative Output Gallery"
                description="Scroll through the full saved Media Studio archive, preview assets quickly, and open any generated image or video in a richer full-history lane."
                highlights={["Full media history", "Infinite scroll archive", "Fast lazy loading", "Instant asset reopening"]}
                actions={[
                    { href: "/content-studio/media", label: "Back to Media Studio", tone: "secondary" },
                    { href: "/content-studio", label: "Tool Hub", tone: "ghost" },
                ]}
                helperText="Older media loads automatically as you scroll, so the archive can stay long without freezing the workspace."
            />

            <section className="mb-5 grid gap-4 lg:grid-cols-[minmax(0,1.14fr)_320px]">
                <div className="rounded-[30px] border border-slate-200 bg-[linear-gradient(180deg,#fff,rgba(248,250,252,0.98))] p-5 shadow-[0_28px_80px_-48px_rgba(15,23,42,0.26)]">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                        <div>
                            <span className="eyebrow">Archive Lane</span>
                            <h2 className="mt-2 text-2xl font-bold tracking-tight text-slate-950">Saved outputs from Media Studio</h2>
                            <p className="mt-2 text-sm leading-relaxed text-slate-600">
                                Every generated asset stays here. Scroll to progressively load older images and videos without leaving the studio family.
                            </p>
                        </div>
                        <div className="flex flex-wrap gap-2">
                            <Link href="/content-studio/media" className="btn btn-ghost text-xs">
                                <ArrowLeft className="mr-2 h-4 w-4" />
                                Media Studio
                            </Link>
                            <button type="button" onClick={() => void loadPage()} className="btn btn-secondary text-xs" disabled={loading}>
                                {loading ? <LoaderCircle className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCcw className="mr-2 h-4 w-4" />}
                                Refresh
                            </button>
                        </div>
                    </div>
                </div>

                <div className="rounded-[30px] border border-slate-200 bg-[linear-gradient(180deg,#fff,rgba(248,250,252,0.98))] p-5 shadow-[0_28px_80px_-48px_rgba(15,23,42,0.26)]">
                    <span className="eyebrow">Gallery Stats</span>
                    <div className="mt-4 grid gap-3">
                        <div className="rounded-[24px] border border-slate-200 bg-white p-4">
                            <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-500">Loaded Now</p>
                            <p className="mt-2 text-2xl font-bold text-slate-950">{results.length}</p>
                            <p className="mt-1 text-xs text-slate-500">of {pageInfo.total} total saved outputs</p>
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                            <div className="rounded-[24px] border border-slate-200 bg-white p-4">
                                <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-500">Images</p>
                                <p className="mt-2 text-xl font-bold text-slate-950">{stats.images}</p>
                            </div>
                            <div className="rounded-[24px] border border-slate-200 bg-white p-4">
                                <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-500">Videos</p>
                                <p className="mt-2 text-xl font-bold text-slate-950">{stats.videos}</p>
                            </div>
                        </div>
                    </div>
                </div>
            </section>

            <section className="rounded-[30px] border border-slate-200 bg-[linear-gradient(180deg,#fff,rgba(248,250,252,0.98))] p-5 shadow-[0_28px_80px_-48px_rgba(15,23,42,0.26)]">
                {loading && results.length === 0 ? (
                    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                        {Array.from({ length: 9 }, (_, index) => (
                            <div key={index} className="overflow-hidden rounded-[24px] border border-slate-200 bg-white">
                                <div className="aspect-[4/5] animate-pulse bg-slate-100" />
                                <div className="space-y-3 p-4">
                                    <div className="h-4 w-24 animate-pulse rounded-full bg-slate-100" />
                                    <div className="h-4 w-full animate-pulse rounded-full bg-slate-100" />
                                    <div className="h-4 w-2/3 animate-pulse rounded-full bg-slate-100" />
                                </div>
                            </div>
                        ))}
                    </div>
                ) : results.length === 0 ? (
                    <div className="rounded-[24px] border border-dashed border-slate-200 bg-slate-50 p-8 text-center text-sm text-slate-500">
                        No saved media found yet. Generate something in Media Studio and it will appear here.
                    </div>
                ) : (
                    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                        {results.map((item) => {
                            const isLoaded = loadedIds.includes(item.id);
                            const assetUrl = buildGalleryAssetUrl(item);
                            return (
                                <article key={item.id} className="overflow-hidden rounded-[26px] border border-slate-200 bg-white shadow-[0_22px_60px_-42px_rgba(15,23,42,0.3)]">
                                    <div className="relative aspect-[4/5] overflow-hidden bg-[linear-gradient(180deg,#f8fafc,#e2e8f0)]">
                                        {!isLoaded && <div className="absolute inset-0 animate-pulse bg-slate-100" />}
                                        {item.type === "video" ? (
                                            <video
                                                src={assetUrl}
                                                controls
                                                preload="metadata"
                                                className={`h-full w-full bg-black object-cover transition duration-500 ${isLoaded ? "opacity-100" : "opacity-0"}`}
                                                onLoadedData={() => setLoadedIds((current) => (current.includes(item.id) ? current : [...current, item.id]))}
                                            />
                                        ) : (
                                            <img
                                                src={assetUrl}
                                                alt={item.prompt}
                                                loading="lazy"
                                                className={`h-full w-full object-cover transition duration-500 ${isLoaded ? "scale-100 opacity-100" : "scale-[1.02] opacity-0"}`}
                                                onLoad={() => setLoadedIds((current) => (current.includes(item.id) ? current : [...current, item.id]))}
                                            />
                                        )}
                                        <div className="absolute left-3 top-3 inline-flex items-center gap-2 rounded-full bg-slate-950/80 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-white">
                                            {item.type === "video" ? <Clapperboard className="h-3.5 w-3.5" /> : <ImageIcon className="h-3.5 w-3.5" />}
                                            {prettyModeLabel(item.mode)}
                                        </div>
                                    </div>

                                    <div className="space-y-3 p-4">
                                        <p className="line-clamp-3 text-sm leading-relaxed text-slate-700">{item.prompt}</p>
                                        <div className="flex flex-wrap gap-2 text-[11px] text-slate-500">
                                            <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1">{item.aspectRatio}</span>
                                            <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1">
                                                {item.createdAt ? formatDateTime(item.createdAt) : "Saved"}
                                            </span>
                                        </div>
                                        <div className="flex items-center justify-between">
                                            <Link href="/content-studio/media" className="inline-flex items-center gap-1 text-sm font-semibold text-sky-600">
                                                Open in studio
                                            </Link>
                                            {assetUrl ? (
                                                <a href={assetUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-sm font-semibold text-slate-600">
                                                    Open asset
                                                    <ArrowUpRight className="h-4 w-4" />
                                                </a>
                                            ) : null}
                                        </div>
                                    </div>
                                </article>
                            );
                        })}
                    </div>
                )}

                <div ref={sentinelRef} className="mt-6 flex min-h-16 items-center justify-center">
                    {loadingMore ? (
                        <div className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-4 py-2 text-sm text-slate-500">
                            <LoaderCircle className="h-4 w-4 animate-spin" />
                            Loading older media...
                        </div>
                    ) : pageInfo.hasMore ? (
                        <div className="text-xs font-medium text-slate-400">Scroll for older outputs</div>
                    ) : results.length > 0 ? (
                        <div className="text-xs font-medium text-slate-400">You have reached the end of the saved gallery.</div>
                    ) : null}
                </div>
            </section>
        </div>
    );
}
