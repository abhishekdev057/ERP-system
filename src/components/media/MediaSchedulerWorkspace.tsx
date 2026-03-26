"use client";

import { useEffect, useMemo, useState } from "react";
import { useSession } from "next-auth/react";
import {
    CalendarDays,
    CheckCircle2,
    ChevronLeft,
    ChevronRight,
    Clock3,
    Facebook,
    ImageIcon,
    Instagram,
    LayoutGrid,
    Link2,
    LoaderCircle,
    MessageCircle,
    PauseCircle,
    Plus,
    Send,
    Sparkles,
    Trash2,
    Video,
    Youtube,
} from "lucide-react";
import toast from "react-hot-toast";
import { StudioWorkspaceHero } from "@/components/content-studio/StudioWorkspaceHero";

type ScheduleStatus = "DRAFT" | "SCHEDULED" | "PUBLISHED" | "PAUSED";
type SchedulePlatform = "instagram" | "facebook" | "youtube" | "whatsapp" | "telegram" | "generic";

type ScheduledAsset = {
    id: string;
    prompt: string;
    type: "image" | "video" | "video_plan";
    mode: string;
    assetUrl: string | null;
    createdAt: string;
};

type MediaScheduleItem = {
    id: string;
    title: string;
    description: string;
    platform: SchedulePlatform;
    status: ScheduleStatus;
    scheduledFor: string;
    timezone: string;
    metadata?: {
        campaign?: string;
        slotLabel?: string;
    };
    createdAt: string;
    updatedAt: string;
    generatedMediaId: string | null;
    generatedMedia: ScheduledAsset | null;
};

type SchedulerStats = {
    scheduledCount: number;
    publishedCount: number;
    pausedCount: number;
    attachedAssetCount: number;
};

type PlannerDraft = {
    title: string;
    description: string;
    platform: SchedulePlatform;
    status: ScheduleStatus;
    scheduledFor: string;
    timezone: string;
    generatedMediaId: string | null;
    campaign: string;
    slotLabel: string;
};

const WEEKDAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

const PLATFORM_META: Record<
    SchedulePlatform,
    {
        label: string;
        icon: typeof Instagram;
        tone: string;
    }
> = {
    instagram: { label: "Instagram", icon: Instagram, tone: "border-pink-200 bg-pink-50 text-pink-700" },
    facebook: { label: "Facebook", icon: Facebook, tone: "border-blue-200 bg-blue-50 text-blue-700" },
    youtube: { label: "YouTube", icon: Youtube, tone: "border-rose-200 bg-rose-50 text-rose-700" },
    whatsapp: { label: "WhatsApp", icon: MessageCircle, tone: "border-emerald-200 bg-emerald-50 text-emerald-700" },
    telegram: { label: "Telegram", icon: Send, tone: "border-sky-200 bg-sky-50 text-sky-700" },
    generic: { label: "General", icon: Sparkles, tone: "border-slate-200 bg-slate-50 text-slate-700" },
};

const STATUS_META: Record<
    ScheduleStatus,
    {
        label: string;
        tone: string;
        icon: typeof Clock3;
    }
> = {
    DRAFT: { label: "Draft", tone: "border-slate-200 bg-slate-50 text-slate-700", icon: LayoutGrid },
    SCHEDULED: { label: "Scheduled", tone: "border-sky-200 bg-sky-50 text-sky-700", icon: Clock3 },
    PUBLISHED: { label: "Published", tone: "border-emerald-200 bg-emerald-50 text-emerald-700", icon: CheckCircle2 },
    PAUSED: { label: "Paused", tone: "border-amber-200 bg-amber-50 text-amber-700", icon: PauseCircle },
};

function startOfMonth(date: Date) {
    return new Date(date.getFullYear(), date.getMonth(), 1);
}

function addMonths(date: Date, diff: number) {
    return new Date(date.getFullYear(), date.getMonth() + diff, 1);
}

function addDays(date: Date, diff: number) {
    const next = new Date(date);
    next.setDate(next.getDate() + diff);
    return next;
}

function formatDateKey(date: Date) {
    const year = date.getFullYear();
    const month = `${date.getMonth() + 1}`.padStart(2, "0");
    const day = `${date.getDate()}`.padStart(2, "0");
    return `${year}-${month}-${day}`;
}

function buildCalendarRange(month: Date) {
    const first = startOfMonth(month);
    const gridStart = addDays(first, -((first.getDay() + 6) % 7));
    const gridDays = Array.from({ length: 42 }, (_, index) => addDays(gridStart, index));
    return {
        from: gridDays[0],
        to: addDays(gridDays[gridDays.length - 1], 1),
        days: gridDays,
    };
}

function monthTitle(date: Date) {
    return date.toLocaleDateString("en-IN", {
        month: "long",
        year: "numeric",
    });
}

function dateLabel(dateKey: string) {
    const parsed = new Date(`${dateKey}T00:00:00`);
    return parsed.toLocaleDateString("en-IN", {
        weekday: "long",
        day: "2-digit",
        month: "short",
    });
}

function toDateTimeInputValue(value: string) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    const offset = date.getTimezoneOffset();
    const local = new Date(date.getTime() - offset * 60000);
    return local.toISOString().slice(0, 16);
}

function createDraft(dateKey: string, asset?: ScheduledAsset | null): PlannerDraft {
    return {
        title: asset ? `${asset.prompt.slice(0, 64)}${asset.prompt.length > 64 ? "…" : ""}` : "",
        description: "",
        platform: "instagram",
        status: "SCHEDULED",
        scheduledFor: `${dateKey}T10:00`,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "Asia/Kolkata",
        generatedMediaId: asset?.id || null,
        campaign: "",
        slotLabel: "",
    };
}

function formatTime(value: string) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "—";
    return date.toLocaleTimeString("en-IN", {
        hour: "2-digit",
        minute: "2-digit",
    });
}

function sameDay(item: MediaScheduleItem, dateKey: string) {
    return formatDateKey(new Date(item.scheduledFor)) === dateKey;
}

function itemSort(a: MediaScheduleItem, b: MediaScheduleItem) {
    return new Date(a.scheduledFor).getTime() - new Date(b.scheduledFor).getTime();
}

function LoadingSurface() {
    return (
        <div className="rounded-[34px] border border-sky-100 bg-[linear-gradient(160deg,#ffffff,#f8fbff)] p-10 shadow-[0_28px_80px_-40px_rgba(15,23,42,0.34)]">
            <div className="flex flex-col items-center justify-center gap-4 py-20 text-center">
                <div className="flex h-20 w-20 items-center justify-center rounded-[28px] border border-sky-100 bg-white shadow-[0_20px_50px_-26px_rgba(59,130,246,0.32)]">
                    <LoaderCircle className="h-8 w-8 animate-spin text-sky-500" />
                </div>
                <div>
                    <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-sky-600">
                        Scheduler Booting
                    </p>
                    <p className="mt-2 text-sm text-slate-500">
                        Pulling calendar lanes, linked media assets, and your next publishing rhythm.
                    </p>
                </div>
            </div>
        </div>
    );
}

export function MediaSchedulerWorkspace() {
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

    const today = useMemo(() => new Date(), []);
    const [activeMonth, setActiveMonth] = useState(startOfMonth(today));
    const [selectedDateKey, setSelectedDateKey] = useState(formatDateKey(today));
    const [items, setItems] = useState<MediaScheduleItem[]>([]);
    const [recentAssets, setRecentAssets] = useState<ScheduledAsset[]>([]);
    const [stats, setStats] = useState<SchedulerStats>({
        scheduledCount: 0,
        publishedCount: 0,
        pausedCount: 0,
        attachedAssetCount: 0,
    });
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
    const [plannerDraft, setPlannerDraft] = useState<PlannerDraft>(createDraft(formatDateKey(today)));

    const calendarRange = useMemo(() => buildCalendarRange(activeMonth), [activeMonth]);
    const dayMap = useMemo(() => {
        const bucket = new Map<string, MediaScheduleItem[]>();
        for (const item of items) {
            const key = formatDateKey(new Date(item.scheduledFor));
            const current = bucket.get(key) || [];
            current.push(item);
            bucket.set(key, current.sort(itemSort));
        }
        return bucket;
    }, [items]);

    const selectedDayItems = useMemo(
        () => [...(dayMap.get(selectedDateKey) || [])].sort(itemSort),
        [dayMap, selectedDateKey]
    );

    const selectedItem = useMemo(
        () => items.find((item) => item.id === selectedItemId) || null,
        [items, selectedItemId]
    );

    const dueThisWeek = useMemo(() => {
        const start = new Date(today);
        start.setHours(0, 0, 0, 0);
        const end = addDays(start, 7);
        return items.filter((item) => {
            const scheduled = new Date(item.scheduledFor);
            return scheduled >= start && scheduled < end && item.status !== "PUBLISHED";
        }).length;
    }, [items, today]);

    const linkedAssetRate = stats.scheduledCount
        ? Math.round((stats.attachedAssetCount / Math.max(items.length, 1)) * 100)
        : 0;

    const loadScheduler = async () => {
        setLoading(true);
        try {
            const params = new URLSearchParams({
                from: calendarRange.from.toISOString(),
                to: calendarRange.to.toISOString(),
            });
            const response = await fetch(`/api/content-studio/media-scheduler?${params.toString()}`, {
                cache: "no-store",
            });
            const data = await response.json().catch(() => ({}));
            if (!response.ok) {
                throw new Error(data.error || "Failed to load scheduler.");
            }
            setItems(Array.isArray(data.items) ? data.items : []);
            setRecentAssets(Array.isArray(data.recentAssets) ? data.recentAssets : []);
            setStats(data.stats || {
                scheduledCount: 0,
                publishedCount: 0,
                pausedCount: 0,
                attachedAssetCount: 0,
            });
        } catch (error: any) {
            console.error(error);
            toast.error(error.message || "Failed to load scheduler workspace.");
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        if (!hasAccess) return;
        void loadScheduler();
    }, [hasAccess, activeMonth]);

    useEffect(() => {
        if (!selectedItem) return;
        setPlannerDraft({
            title: selectedItem.title,
            description: selectedItem.description || "",
            platform: selectedItem.platform,
            status: selectedItem.status,
            scheduledFor: toDateTimeInputValue(selectedItem.scheduledFor),
            timezone: selectedItem.timezone || "Asia/Kolkata",
            generatedMediaId: selectedItem.generatedMediaId,
            campaign: selectedItem.metadata?.campaign || "",
            slotLabel: selectedItem.metadata?.slotLabel || "",
        });
    }, [selectedItem]);

    const startCreate = (dateKey = selectedDateKey, asset?: ScheduledAsset | null) => {
        setSelectedItemId(null);
        setSelectedDateKey(dateKey);
        setPlannerDraft(createDraft(dateKey, asset));
    };

    const handleSave = async () => {
        if (!plannerDraft.title.trim()) {
            toast.error("Planner title is required.");
            return;
        }

        setSaving(true);
        try {
            const payload = {
                title: plannerDraft.title,
                description: plannerDraft.description,
                platform: plannerDraft.platform,
                status: plannerDraft.status,
                scheduledFor: new Date(plannerDraft.scheduledFor).toISOString(),
                timezone: plannerDraft.timezone,
                generatedMediaId: plannerDraft.generatedMediaId,
                metadata: {
                    campaign: plannerDraft.campaign,
                    slotLabel: plannerDraft.slotLabel,
                },
            };

            const response = await fetch(
                selectedItemId
                    ? `/api/content-studio/media-scheduler/${selectedItemId}`
                    : "/api/content-studio/media-scheduler",
                {
                    method: selectedItemId ? "PATCH" : "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(payload),
                }
            );
            const data = await response.json().catch(() => ({}));
            if (!response.ok) {
                throw new Error(data.error || "Failed to save schedule item.");
            }

            const nextItem = data.item as MediaScheduleItem;
            setItems((prev) => {
                const merged = selectedItemId
                    ? prev.map((item) => (item.id === nextItem.id ? nextItem : item))
                    : [...prev, nextItem];
                return merged.sort(itemSort);
            });
            setSelectedItemId(nextItem.id);
            setSelectedDateKey(formatDateKey(new Date(nextItem.scheduledFor)));
            toast.success(selectedItemId ? "Schedule item updated." : "Added to publishing calendar.");
            await loadScheduler();
        } catch (error: any) {
            console.error(error);
            toast.error(error.message || "Failed to save planner item.");
        } finally {
            setSaving(false);
        }
    };

    const handleDelete = async () => {
        if (!selectedItemId) return;
        setSaving(true);
        try {
            const response = await fetch(`/api/content-studio/media-scheduler/${selectedItemId}`, {
                method: "DELETE",
            });
            const data = await response.json().catch(() => ({}));
            if (!response.ok) {
                throw new Error(data.error || "Failed to delete schedule item.");
            }
            setItems((prev) => prev.filter((item) => item.id !== selectedItemId));
            setSelectedItemId(null);
            startCreate(selectedDateKey);
            toast.success("Schedule item removed.");
            await loadScheduler();
        } catch (error: any) {
            console.error(error);
            toast.error(error.message || "Failed to delete planner item.");
        } finally {
            setSaving(false);
        }
    };

    const quickStatusUpdate = async (item: MediaScheduleItem, status: ScheduleStatus) => {
        try {
            const response = await fetch(`/api/content-studio/media-scheduler/${item.id}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    status,
                    title: item.title,
                    description: item.description,
                    platform: item.platform,
                    scheduledFor: item.scheduledFor,
                    timezone: item.timezone,
                    generatedMediaId: item.generatedMediaId,
                    metadata: item.metadata || {},
                }),
            });
            const data = await response.json().catch(() => ({}));
            if (!response.ok) {
                throw new Error(data.error || "Failed to update status.");
            }
            setItems((prev) => prev.map((entry) => (entry.id === item.id ? data.item : entry)));
            await loadScheduler();
        } catch (error: any) {
            toast.error(error.message || "Status update failed.");
        }
    };

    if (!hasAccess) {
        return (
            <div className="surface p-10 text-center">
                <h2 className="heading-xl">Media Scheduler Access Required</h2>
                <p className="mt-2 text-sm text-slate-500">
                    Ask your workspace admin to grant `media-studio` access.
                </p>
            </div>
        );
    }

    if (loading) {
        return (
            <div className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
                <LoadingSurface />
            </div>
        );
    }

    return (
        <div className="mx-auto w-full max-w-7xl space-y-5 px-4 py-6 sm:px-6 lg:px-8">
            <StudioWorkspaceHero
                theme="media"
                eyebrow="Institute Suite · Scheduler"
                title="Media Scheduler"
                description="Plan generated media into a visual publishing calendar, connect assets to posting slots, and keep your institute campaigns paced across the week."
                highlights={["Calendar view", "Linked media assets", "Publishing rhythm"]}
                actions={[
                    { href: "/content-studio/media", label: "Back to Media Studio", tone: "primary" },
                    { href: "/content-studio", label: "Tool Hub", tone: "secondary" },
                ]}
                compact
                helperText="Use recent generated assets as planner inputs, or create clean campaign slots even before the creative is ready."
            />

            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                <div className="rounded-[26px] border border-sky-100 bg-white p-5 shadow-[0_24px_60px_-36px_rgba(59,130,246,0.28)]">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-slate-500">Scheduled This Grid</p>
                    <p className="mt-3 text-3xl font-bold tracking-tight text-slate-950">{stats.scheduledCount}</p>
                    <p className="mt-2 text-sm text-slate-500">Items queued for the visible calendar range.</p>
                </div>
                <div className="rounded-[26px] border border-indigo-100 bg-[linear-gradient(180deg,#eef2ff,#fff)] p-5 shadow-[0_24px_60px_-36px_rgba(99,102,241,0.25)]">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-slate-500">Due This Week</p>
                    <p className="mt-3 text-3xl font-bold tracking-tight text-slate-950">{dueThisWeek}</p>
                    <p className="mt-2 text-sm text-slate-500">Upcoming posts that still need execution attention.</p>
                </div>
                <div className="rounded-[26px] border border-emerald-100 bg-[linear-gradient(180deg,#ecfdf5,#fff)] p-5 shadow-[0_24px_60px_-36px_rgba(16,185,129,0.24)]">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-slate-500">Published</p>
                    <p className="mt-3 text-3xl font-bold tracking-tight text-slate-950">{stats.publishedCount}</p>
                    <p className="mt-2 text-sm text-slate-500">Slots already marked complete in this board window.</p>
                </div>
                <div className="rounded-[26px] border border-amber-100 bg-[linear-gradient(180deg,#fffbeb,#fff)] p-5 shadow-[0_24px_60px_-36px_rgba(245,158,11,0.25)]">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-slate-500">Asset Attach Rate</p>
                    <p className="mt-3 text-3xl font-bold tracking-tight text-slate-950">{linkedAssetRate}%</p>
                    <p className="mt-2 text-sm text-slate-500">{stats.attachedAssetCount} calendar items are linked to saved creatives.</p>
                </div>
            </div>

            <div className="grid gap-5 xl:grid-cols-[1.35fr,0.95fr]">
                <article className="rounded-[32px] border border-slate-200 bg-white p-5 shadow-[0_28px_80px_-40px_rgba(15,23,42,0.3)]">
                    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-4">
                        <div>
                            <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-slate-500">Publishing Calendar</p>
                            <h2 className="mt-2 text-2xl font-bold tracking-tight text-slate-950">{monthTitle(activeMonth)}</h2>
                        </div>
                        <div className="flex items-center gap-2">
                            <button
                                type="button"
                                onClick={() => setActiveMonth(addMonths(activeMonth, -1))}
                                className="flex h-10 w-10 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-600 transition hover:border-slate-300 hover:bg-slate-50"
                            >
                                <ChevronLeft className="h-4 w-4" />
                            </button>
                            <button
                                type="button"
                                onClick={() => {
                                    const nextToday = startOfMonth(new Date());
                                    setActiveMonth(nextToday);
                                    setSelectedDateKey(formatDateKey(new Date()));
                                }}
                                className="rounded-full border border-sky-200 bg-sky-50 px-4 py-2 text-xs font-semibold text-sky-700 transition hover:bg-sky-100"
                            >
                                Today
                            </button>
                            <button
                                type="button"
                                onClick={() => setActiveMonth(addMonths(activeMonth, 1))}
                                className="flex h-10 w-10 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-600 transition hover:border-slate-300 hover:bg-slate-50"
                            >
                                <ChevronRight className="h-4 w-4" />
                            </button>
                        </div>
                    </div>

                    <div className="mt-4 grid grid-cols-7 gap-2">
                        {WEEKDAY_LABELS.map((label) => (
                            <div
                                key={label}
                                className="rounded-2xl border border-slate-100 bg-slate-50 px-3 py-2 text-center text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-500"
                            >
                                {label}
                            </div>
                        ))}

                        {calendarRange.days.map((day) => {
                            const dateKey = formatDateKey(day);
                            const itemsForDay = dayMap.get(dateKey) || [];
                            const inActiveMonth = day.getMonth() === activeMonth.getMonth();
                            const isSelected = dateKey === selectedDateKey;
                            const isToday = dateKey === formatDateKey(new Date());

                            return (
                                <button
                                    key={dateKey}
                                    type="button"
                                    onClick={() => {
                                        setSelectedDateKey(dateKey);
                                        if (!selectedItemId) {
                                            setPlannerDraft((current) => ({
                                                ...current,
                                                scheduledFor: current.scheduledFor.startsWith(dateKey)
                                                    ? current.scheduledFor
                                                    : `${dateKey}T10:00`,
                                            }));
                                        }
                                    }}
                                    className={`min-h-[148px] rounded-[24px] border px-3 py-3 text-left transition ${
                                        isSelected
                                            ? "border-sky-300 bg-sky-50/70 shadow-[0_24px_60px_-40px_rgba(59,130,246,0.35)]"
                                            : "border-slate-200 bg-[linear-gradient(180deg,#fff,#f8fafc)] hover:border-slate-300"
                                    } ${!inActiveMonth ? "opacity-55" : ""}`}
                                >
                                    <div className="flex items-center justify-between">
                                        <span
                                            className={`text-sm font-semibold ${
                                                isToday
                                                    ? "text-sky-700"
                                                    : isSelected
                                                        ? "text-slate-950"
                                                        : "text-slate-700"
                                            }`}
                                        >
                                            {day.getDate()}
                                        </span>
                                        {isToday ? (
                                            <span className="rounded-full border border-sky-200 bg-white px-2 py-0.5 text-[10px] font-semibold text-sky-700">
                                                Today
                                            </span>
                                        ) : null}
                                    </div>

                                    <div className="mt-3 space-y-2">
                                        {itemsForDay.slice(0, 3).map((item) => {
                                            const platform = PLATFORM_META[item.platform] || PLATFORM_META.generic;
                                            return (
                                                <div
                                                    key={item.id}
                                                    className={`rounded-[16px] border px-2.5 py-2 text-[11px] shadow-sm ${platform.tone}`}
                                                >
                                                    <div className="flex items-center justify-between gap-2">
                                                        <span className="truncate font-semibold">{item.title}</span>
                                                        <span className="shrink-0 text-[10px]">{formatTime(item.scheduledFor)}</span>
                                                    </div>
                                                </div>
                                            );
                                        })}
                                        {itemsForDay.length > 3 ? (
                                            <div className="rounded-[14px] border border-dashed border-slate-200 px-2.5 py-2 text-[11px] text-slate-500">
                                                +{itemsForDay.length - 3} more planned
                                            </div>
                                        ) : null}
                                        {!itemsForDay.length ? (
                                            <div className="rounded-[16px] border border-dashed border-slate-200 px-2.5 py-3 text-[11px] text-slate-400">
                                                No slot planned
                                            </div>
                                        ) : null}
                                    </div>
                                </button>
                            );
                        })}
                    </div>
                </article>

                <aside className="space-y-5">
                    <article className="rounded-[32px] border border-slate-200 bg-white p-5 shadow-[0_28px_80px_-40px_rgba(15,23,42,0.3)]">
                        <div className="flex items-center justify-between gap-3 border-b border-slate-100 pb-4">
                            <div>
                                <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-slate-500">Planner Desk</p>
                                <h3 className="mt-2 text-xl font-bold tracking-tight text-slate-950">
                                    {selectedItemId ? "Edit Slot" : "Create Slot"}
                                </h3>
                                <p className="mt-1 text-sm text-slate-500">
                                    {dateLabel(selectedDateKey)}
                                </p>
                            </div>
                            <button
                                type="button"
                                onClick={() => startCreate(selectedDateKey)}
                                className="inline-flex items-center gap-2 rounded-full border border-sky-200 bg-sky-50 px-4 py-2 text-xs font-semibold text-sky-700 transition hover:bg-sky-100"
                            >
                                <Plus className="h-3.5 w-3.5" />
                                New
                            </button>
                        </div>

                        <div className="mt-4 space-y-4">
                            <div>
                                <label className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-500">
                                    Title
                                </label>
                                <input
                                    value={plannerDraft.title}
                                    onChange={(event) =>
                                        setPlannerDraft((current) => ({ ...current, title: event.target.value }))
                                    }
                                    className="w-full rounded-[18px] border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-sky-300 focus:bg-white focus:ring-4 focus:ring-sky-100"
                                    placeholder="Biology folder cover - evening slot"
                                />
                            </div>

                            <div className="grid gap-4 sm:grid-cols-2">
                                <div>
                                    <label className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-500">
                                        Platform
                                    </label>
                                    <select
                                        value={plannerDraft.platform}
                                        onChange={(event) =>
                                            setPlannerDraft((current) => ({
                                                ...current,
                                                platform: event.target.value as SchedulePlatform,
                                            }))
                                        }
                                        className="w-full rounded-[18px] border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-sky-300 focus:bg-white focus:ring-4 focus:ring-sky-100"
                                    >
                                        {Object.entries(PLATFORM_META).map(([key, value]) => (
                                            <option key={key} value={key}>
                                                {value.label}
                                            </option>
                                        ))}
                                    </select>
                                </div>
                                <div>
                                    <label className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-500">
                                        Status
                                    </label>
                                    <select
                                        value={plannerDraft.status}
                                        onChange={(event) =>
                                            setPlannerDraft((current) => ({
                                                ...current,
                                                status: event.target.value as ScheduleStatus,
                                            }))
                                        }
                                        className="w-full rounded-[18px] border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-sky-300 focus:bg-white focus:ring-4 focus:ring-sky-100"
                                    >
                                        {Object.entries(STATUS_META).map(([key, value]) => (
                                            <option key={key} value={key}>
                                                {value.label}
                                            </option>
                                        ))}
                                    </select>
                                </div>
                            </div>

                            <div className="grid gap-4 sm:grid-cols-2">
                                <div>
                                    <label className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-500">
                                        Schedule Time
                                    </label>
                                    <input
                                        type="datetime-local"
                                        value={plannerDraft.scheduledFor}
                                        onChange={(event) =>
                                            setPlannerDraft((current) => ({ ...current, scheduledFor: event.target.value }))
                                        }
                                        className="w-full rounded-[18px] border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-sky-300 focus:bg-white focus:ring-4 focus:ring-sky-100"
                                    />
                                </div>
                                <div>
                                    <label className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-500">
                                        Timezone
                                    </label>
                                    <input
                                        value={plannerDraft.timezone}
                                        onChange={(event) =>
                                            setPlannerDraft((current) => ({ ...current, timezone: event.target.value }))
                                        }
                                        className="w-full rounded-[18px] border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-sky-300 focus:bg-white focus:ring-4 focus:ring-sky-100"
                                        placeholder="Asia/Kolkata"
                                    />
                                </div>
                            </div>

                            <div className="grid gap-4 sm:grid-cols-2">
                                <div>
                                    <label className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-500">
                                        Campaign
                                    </label>
                                    <input
                                        value={plannerDraft.campaign}
                                        onChange={(event) =>
                                            setPlannerDraft((current) => ({ ...current, campaign: event.target.value }))
                                        }
                                        className="w-full rounded-[18px] border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-sky-300 focus:bg-white focus:ring-4 focus:ring-sky-100"
                                        placeholder="Biology folder refresh"
                                    />
                                </div>
                                <div>
                                    <label className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-500">
                                        Slot Label
                                    </label>
                                    <input
                                        value={plannerDraft.slotLabel}
                                        onChange={(event) =>
                                            setPlannerDraft((current) => ({ ...current, slotLabel: event.target.value }))
                                        }
                                        className="w-full rounded-[18px] border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-sky-300 focus:bg-white focus:ring-4 focus:ring-sky-100"
                                        placeholder="Evening drop"
                                    />
                                </div>
                            </div>

                            <div>
                                <label className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-500">
                                    Notes
                                </label>
                                <textarea
                                    value={plannerDraft.description}
                                    onChange={(event) =>
                                        setPlannerDraft((current) => ({ ...current, description: event.target.value }))
                                    }
                                    className="min-h-[96px] w-full rounded-[18px] border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-sky-300 focus:bg-white focus:ring-4 focus:ring-sky-100"
                                    placeholder="What needs to be checked before this slot goes live?"
                                />
                            </div>

                            <div className="rounded-[22px] border border-slate-200 bg-slate-50/70 p-4">
                                <div className="flex items-center justify-between gap-3">
                                    <div>
                                        <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-500">
                                            Linked Asset
                                        </p>
                                        <p className="mt-1 text-sm font-semibold text-slate-900">
                                            {plannerDraft.generatedMediaId
                                                ? recentAssets.find((asset) => asset.id === plannerDraft.generatedMediaId)?.prompt.slice(0, 48) || "Asset linked"
                                                : "No asset attached yet"}
                                        </p>
                                    </div>
                                    {plannerDraft.generatedMediaId ? (
                                        <button
                                            type="button"
                                            onClick={() =>
                                                setPlannerDraft((current) => ({ ...current, generatedMediaId: null }))
                                            }
                                            className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 transition hover:bg-slate-50"
                                        >
                                            Clear
                                        </button>
                                    ) : null}
                                </div>
                            </div>

                            <div className="flex flex-wrap gap-3">
                                <button
                                    type="button"
                                    onClick={handleSave}
                                    disabled={saving}
                                    className="btn btn-primary"
                                >
                                    {saving ? <LoaderCircle className="mr-2 h-4 w-4 animate-spin" /> : null}
                                    {selectedItemId ? "Update Slot" : "Save to Calendar"}
                                </button>
                                {selectedItemId ? (
                                    <button
                                        type="button"
                                        onClick={handleDelete}
                                        disabled={saving}
                                        className="btn btn-ghost"
                                    >
                                        <Trash2 className="mr-2 h-4 w-4" />
                                        Delete
                                    </button>
                                ) : null}
                            </div>
                        </div>
                    </article>

                    <article className="rounded-[32px] border border-slate-200 bg-white p-5 shadow-[0_28px_80px_-40px_rgba(15,23,42,0.3)]">
                        <div className="flex items-center justify-between gap-3 border-b border-slate-100 pb-4">
                            <div>
                                <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-slate-500">Recent Generated Assets</p>
                                <h3 className="mt-2 text-xl font-bold tracking-tight text-slate-950">Link Media to Slots</h3>
                            </div>
                            <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-semibold text-slate-600">
                                {recentAssets.length} assets
                            </span>
                        </div>

                        <div className="mt-4 space-y-3">
                            {recentAssets.length ? recentAssets.map((asset) => (
                                <button
                                    key={asset.id}
                                    type="button"
                                    onClick={() =>
                                        setPlannerDraft((current) => ({
                                            ...current,
                                            title: current.title || asset.prompt.slice(0, 64),
                                            generatedMediaId: asset.id,
                                        }))
                                    }
                                    className={`flex w-full items-start gap-3 rounded-[22px] border p-3 text-left transition ${
                                        plannerDraft.generatedMediaId === asset.id
                                            ? "border-sky-300 bg-sky-50"
                                            : "border-slate-200 bg-[linear-gradient(180deg,#fff,#f8fafc)] hover:border-slate-300"
                                    }`}
                                >
                                    <div className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-[18px] border border-slate-200 bg-slate-100">
                                        {asset.assetUrl && asset.type === "image" ? (
                                            // eslint-disable-next-line @next/next/no-img-element
                                            <img src={asset.assetUrl} alt="" className="h-full w-full object-cover" />
                                        ) : asset.type === "video" ? (
                                            <Video className="h-5 w-5 text-slate-500" />
                                        ) : (
                                            <ImageIcon className="h-5 w-5 text-slate-500" />
                                        )}
                                    </div>
                                    <div className="min-w-0 flex-1">
                                        <p className="line-clamp-2 text-sm font-semibold text-slate-900">{asset.prompt}</p>
                                        <p className="mt-1 text-xs text-slate-500">
                                            {asset.type === "video" ? "Video" : "Image"} · {new Date(asset.createdAt).toLocaleDateString("en-IN", { day: "2-digit", month: "short" })}
                                        </p>
                                    </div>
                                    <Link2 className="mt-1 h-4 w-4 shrink-0 text-slate-400" />
                                </button>
                            )) : (
                                <div className="rounded-[22px] border border-dashed border-slate-200 bg-slate-50/70 px-4 py-8 text-center text-sm text-slate-500">
                                    Generate media in Media Studio first, then it will appear here for scheduling.
                                </div>
                            )}
                        </div>
                    </article>
                </aside>
            </div>

            <div className="grid gap-5 xl:grid-cols-[1.1fr,0.9fr]">
                <article className="rounded-[32px] border border-slate-200 bg-white p-5 shadow-[0_28px_80px_-40px_rgba(15,23,42,0.3)]">
                    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-4">
                        <div>
                            <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-slate-500">Day Agenda</p>
                            <h3 className="mt-2 text-xl font-bold tracking-tight text-slate-950">{dateLabel(selectedDateKey)}</h3>
                        </div>
                        <button
                            type="button"
                            onClick={() => startCreate(selectedDateKey)}
                            className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-50"
                        >
                            <Plus className="h-3.5 w-3.5" />
                            Add Slot
                        </button>
                    </div>

                    <div className="mt-4 space-y-3">
                        {selectedDayItems.length ? selectedDayItems.map((item) => {
                            const platform = PLATFORM_META[item.platform] || PLATFORM_META.generic;
                            const status = STATUS_META[item.status] || STATUS_META.DRAFT;
                            const PlatformIcon = platform.icon;
                            const StatusIcon = status.icon;

                            return (
                                <div
                                    key={item.id}
                                    className={`rounded-[24px] border p-4 transition ${
                                        selectedItemId === item.id
                                            ? "border-sky-300 bg-sky-50/60"
                                            : "border-slate-200 bg-[linear-gradient(180deg,#fff,#f8fafc)]"
                                    }`}
                                >
                                    <div className="flex flex-wrap items-start justify-between gap-3">
                                        <div>
                                            <div className="flex flex-wrap items-center gap-2">
                                                <span className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-semibold ${platform.tone}`}>
                                                    <PlatformIcon className="h-3.5 w-3.5" />
                                                    {platform.label}
                                                </span>
                                                <span className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-semibold ${status.tone}`}>
                                                    <StatusIcon className="h-3.5 w-3.5" />
                                                    {status.label}
                                                </span>
                                            </div>
                                            <h4 className="mt-3 text-lg font-semibold text-slate-950">{item.title}</h4>
                                            <p className="mt-1 text-sm text-slate-500">{formatTime(item.scheduledFor)} · {item.timezone}</p>
                                            {item.description ? (
                                                <p className="mt-3 text-sm leading-relaxed text-slate-600">{item.description}</p>
                                            ) : null}
                                            {item.generatedMedia ? (
                                                <p className="mt-3 text-xs font-medium text-sky-700">
                                                    Linked asset: {item.generatedMedia.prompt.slice(0, 72)}
                                                </p>
                                            ) : null}
                                        </div>
                                        <button
                                            type="button"
                                            onClick={() => setSelectedItemId(item.id)}
                                            className="rounded-full border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-50"
                                        >
                                            Open in Planner
                                        </button>
                                    </div>

                                    <div className="mt-4 flex flex-wrap gap-2">
                                        {item.status !== "PUBLISHED" ? (
                                            <button
                                                type="button"
                                                onClick={() => quickStatusUpdate(item, "PUBLISHED")}
                                                className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-700 transition hover:bg-emerald-100"
                                            >
                                                Mark Published
                                            </button>
                                        ) : null}
                                        {item.status !== "PAUSED" ? (
                                            <button
                                                type="button"
                                                onClick={() => quickStatusUpdate(item, "PAUSED")}
                                                className="rounded-full border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs font-semibold text-amber-700 transition hover:bg-amber-100"
                                            >
                                                Pause Slot
                                            </button>
                                        ) : null}
                                        {item.status !== "SCHEDULED" ? (
                                            <button
                                                type="button"
                                                onClick={() => quickStatusUpdate(item, "SCHEDULED")}
                                                className="rounded-full border border-sky-200 bg-sky-50 px-3 py-1.5 text-xs font-semibold text-sky-700 transition hover:bg-sky-100"
                                            >
                                                Resume Slot
                                            </button>
                                        ) : null}
                                    </div>
                                </div>
                            );
                        }) : (
                            <div className="rounded-[24px] border border-dashed border-slate-200 bg-slate-50/70 px-5 py-10 text-center text-sm text-slate-500">
                                No posting slot planned for this day yet. Use the planner desk to create one.
                            </div>
                        )}
                    </div>
                </article>

                <article className="rounded-[32px] border border-slate-200 bg-white p-5 shadow-[0_28px_80px_-40px_rgba(15,23,42,0.3)]">
                    <div className="border-b border-slate-100 pb-4">
                        <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-slate-500">Planner Pulse</p>
                        <h3 className="mt-2 text-xl font-bold tracking-tight text-slate-950">Channel Mix & Execution Hints</h3>
                    </div>

                    <div className="mt-4 space-y-4">
                        {Object.entries(PLATFORM_META).map(([key, platform]) => {
                            const count = items.filter((item) => item.platform === key).length;
                            const Icon = platform.icon;

                            return (
                                <div key={key} className="rounded-[22px] border border-slate-200 bg-[linear-gradient(180deg,#fff,#f8fafc)] p-4">
                                    <div className="flex items-center justify-between gap-3">
                                        <div className="flex items-center gap-3">
                                            <div className={`flex h-11 w-11 items-center justify-center rounded-[16px] border ${platform.tone}`}>
                                                <Icon className="h-4.5 w-4.5" />
                                            </div>
                                            <div>
                                                <p className="text-sm font-semibold text-slate-900">{platform.label}</p>
                                                <p className="text-xs text-slate-500">Scheduled items in this visible board</p>
                                            </div>
                                        </div>
                                        <span className="text-2xl font-bold tracking-tight text-slate-950">{count}</span>
                                    </div>
                                </div>
                            );
                        })}

                        <div className="rounded-[24px] border border-sky-100 bg-[linear-gradient(135deg,#eff6ff,#fff,#eef2ff)] p-5">
                            <div className="flex items-center gap-3">
                                <div className="flex h-12 w-12 items-center justify-center rounded-[18px] bg-white shadow-sm">
                                    <CalendarDays className="h-5 w-5 text-sky-600" />
                                </div>
                                <div>
                                    <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-sky-700">Execution Note</p>
                                    <p className="mt-1 text-sm leading-relaxed text-slate-600">
                                        Keep linked assets on the busiest days first. If a slot is still in draft, attach a saved creative before the posting window opens.
                                    </p>
                                </div>
                            </div>
                        </div>
                    </div>
                </article>
            </div>
        </div>
    );
}
