"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useDeferredValue, useEffect, useMemo, useState } from "react";
import { useSession } from "next-auth/react";
import toast from "react-hot-toast";
import Modal from "@/components/ui/Modal";
import { downloadBlobAsFile, formatDateTime } from "@/lib/utils";

type WorkspaceType = "IMAGE_TO_PDF" | "JSON_TO_PDF" | "PDF_TO_PDF";
type DocumentSortField = "createdAt" | "updatedAt" | "title" | "subject" | "date";
type DocumentSortDirection = "asc" | "desc";

type DocumentRecord = {
    id: string;
    title: string;
    subject: string;
    date: string;
    createdAt: string;
    workspaceType?: WorkspaceType;
    assignedUserIds?: string[];
    correctionMarkCount?: number;
};

type DocumentPagination = {
    total: number;
    limit: number;
    offset: number;
    page: number;
    totalPages: number;
    hasMore: boolean;
};

type OrgMember = {
    id: string;
    name: string | null;
    email: string | null;
    username: string | null;
    designation: string | null;
};

type StudioTool = {
    id: string;
    title: string;
    description: string;
    category: "Extraction" | "Creative" | "Publishing" | "Automation";
    status: "Live" | "Beta" | "Planned";
    href?: string;
    permission?: string | string[];
    badge: string;
};

const STUDIO_TOOLS: StudioTool[] = [
    {
        id: "question-extractor",
        title: "Question Extractor",
        description:
            "Upload PDFs or images (single/multi), extract structure-aware questions, crop diagrams, and generate bilingual slides.",
        category: "Extraction",
        status: "Live",
        href: "/content-studio/extractor",
        permission: "pdf-to-pdf",
        badge: "PDF + Images",
    },
    {
        id: "media-studio",
        title: "Media Studio",
        description:
            "Generate institute-ready visuals and video drafts from text/reference inputs for campaigns and classroom content.",
        category: "Creative",
        status: "Beta",
        href: "/content-studio/media",
        permission: "media-studio",
        badge: "AI Media",
    },
    {
        id: "youtube-workspace",
        title: "YouTube Workspace",
        description:
            "Connect a YouTube channel, review live streams, and launch Hindi poll sequences from extractor documents.",
        category: "Publishing",
        status: "Beta",
        href: "/content-studio/youtube",
        permission: ["media-studio", "pdf-to-pdf"],
        badge: "Live Polls",
    },
    {
        id: "whatsapp-workspace",
        title: "WhatsApp Workspace",
        description:
            "Connect WhatsApp Business, work inside a live inbox, and run template campaigns from a dedicated Meta Cloud workspace.",
        category: "Automation",
        status: "Beta",
        href: "/content-studio/whatsapp",
        permission: "media-studio",
        badge: "Inbox + Campaigns",
    },
    {
        id: "telegram-workspace",
        title: "Telegram Workspace",
        description:
            "Connect a Telegram bot, manage target decks for channels/groups, review recent bot activity, and send text, image, or video payloads from one control surface.",
        category: "Automation",
        status: "Beta",
        href: "/content-studio/telegram",
        permission: "media-studio",
        badge: "Bot + Broadcast",
    },
    {
        id: "students-hub",
        title: "Students Hub",
        description:
            "Manage your entire student pipeline from lead acquisition to active enrollment, track conversation histories, and view lead confidence.",
        category: "Automation",
        status: "Live",
        href: "/content-studio/students",
        permission: "pdf-to-pdf",
        badge: "Organization CRM",
    },
    {
        id: "members-hub",
        title: "Staff Members",
        description:
            "Central directory to oversee and edit the profiles, roles, and designations of all organizational staff.",
        category: "Automation",
        status: "Live",
        href: "/content-studio/members",
        permission: "pdf-to-pdf",
        badge: "Identity Manager",
    },
];

const DOCUMENTS_PAGE_SIZE = 10;
const DEFAULT_DOCUMENT_PAGINATION: DocumentPagination = {
    total: 0,
    limit: DOCUMENTS_PAGE_SIZE,
    offset: 0,
    page: 1,
    totalPages: 1,
    hasMore: false,
};

function statusTone(status: StudioTool["status"]) {
    if (status === "Live") return "bg-emerald-50 text-emerald-700 border-emerald-200";
    if (status === "Beta") return "bg-amber-50 text-amber-700 border-amber-200";
    return "bg-slate-100 text-slate-500 border-slate-200";
}

function normalizeSortByParam(value: string | null): DocumentSortField {
    const candidate = String(value || "").trim();
    if (candidate === "updatedAt") return "updatedAt";
    if (candidate === "title") return "title";
    if (candidate === "subject") return "subject";
    if (candidate === "date") return "date";
    return "createdAt";
}

function normalizeSortOrderParam(value: string | null): DocumentSortDirection {
    return String(value || "").trim().toLowerCase() === "asc" ? "asc" : "desc";
}

function normalizeQueryParam(value: string | null): string {
    return String(value || "").slice(0, 160);
}

function normalizePageParam(value: string | null): number {
    const parsed = Number.parseInt(String(value || "1"), 10);
    return Number.isFinite(parsed) ? Math.max(parsed, 1) : 1;
}

function normalizeAssigneeParam(value: string | null, canAssign: boolean): string {
    if (!canAssign) return "all";
    const parsed = String(value || "").trim();
    return parsed ? parsed : "all";
}

function buildViewSearch(
    query: string,
    sortBy: DocumentSortField,
    sortOrder: DocumentSortDirection,
    assigneeFilter: string,
    canAssign: boolean,
    page: number
): string {
    const params = new URLSearchParams();
    const trimmedQuery = query.trim();
    if (trimmedQuery) params.set("q", trimmedQuery);
    if (sortBy !== "createdAt") params.set("sortBy", sortBy);
    if (sortOrder !== "desc") params.set("sortOrder", sortOrder);
    if (canAssign && assigneeFilter !== "all") params.set("assignee", assigneeFilter);
    if (page > 1) params.set("page", String(page));
    return params.toString();
}

function buildPaginationItems(currentPage: number, totalPages: number): Array<number | "ellipsis"> {
    if (totalPages <= 5) {
        return Array.from({ length: totalPages }, (_, index) => index + 1);
    }

    const visiblePages = new Set([1, totalPages, currentPage - 1, currentPage, currentPage + 1]);
    const sortedPages = Array.from(visiblePages)
        .filter((page) => page >= 1 && page <= totalPages)
        .sort((left, right) => left - right);
    const items: Array<number | "ellipsis"> = [];

    sortedPages.forEach((page, index) => {
        const previous = sortedPages[index - 1];
        if (index > 0 && previous !== undefined && page - previous > 1) {
            items.push("ellipsis");
        }
        items.push(page);
    });

    return items;
}

type ToolVisualTheme = {
    cardGradient: string;
    cardBorder: string;
    glowClass: string;
    highlights: string[];
    accentLabel: string;
};

const TOOL_VISUAL_THEMES: Record<string, ToolVisualTheme> = {
    "question-extractor": {
        cardGradient: "from-emerald-50 via-white to-teal-50",
        cardBorder: "border-emerald-200/70",
        glowClass: "bg-emerald-300/40",
        highlights: ["Structured OCR", "Diagram crops", "Slide-ready"],
        accentLabel: "Extraction engine",
    },
    "media-studio": {
        cardGradient: "from-sky-50 via-white to-indigo-50",
        cardBorder: "border-sky-200/70",
        glowClass: "bg-sky-300/40",
        highlights: ["Gemini visuals", "Brand-aware", "Saved history"],
        accentLabel: "Creative generation",
    },
    "youtube-workspace": {
        cardGradient: "from-rose-50 via-white to-orange-50",
        cardBorder: "border-rose-200/70",
        glowClass: "bg-rose-300/40",
        highlights: ["Live streams", "Hindi polls", "Broadcast control"],
        accentLabel: "Live publishing",
    },
    "whatsapp-workspace": {
        cardGradient: "from-lime-50 via-white to-emerald-50",
        cardBorder: "border-lime-200/70",
        glowClass: "bg-lime-300/40",
        highlights: ["Inbox threads", "Template sends", "Campaign logs"],
        accentLabel: "Messaging hub",
    },
    "telegram-workspace": {
        cardGradient: "from-cyan-50 via-white to-sky-50",
        cardBorder: "border-cyan-200/70",
        glowClass: "bg-cyan-300/40",
        highlights: ["Bot status", "Target decks", "Direct sends"],
        accentLabel: "Telegram command deck",
    },
    "students-hub": {
        cardGradient: "from-violet-50 via-white to-purple-50",
        cardBorder: "border-violet-200/70",
        glowClass: "bg-violet-300/40",
        highlights: ["Leads", "Timelines", "Enrolment"],
        accentLabel: "Student Directory",
    },
    "members-hub": {
        cardGradient: "from-blue-50 via-white to-cyan-50",
        cardBorder: "border-blue-200/70",
        glowClass: "bg-blue-300/40",
        highlights: ["Roles", "Profiles", "Access"],
        accentLabel: "Staff Management",
    },
};

function getToolVisualTheme(toolId: string): ToolVisualTheme {
    return (
        TOOL_VISUAL_THEMES[toolId] || {
            cardGradient: "from-slate-50 via-white to-slate-100",
            cardBorder: "border-slate-200/70",
            glowClass: "bg-slate-300/40",
            highlights: ["Workspace", "Studio", "Ready"],
            accentLabel: "Studio tool",
        }
    );
}

function ToolHubHeroArt() {
    return (
        <div className="relative hidden min-h-[270px] overflow-hidden rounded-[32px] border border-white/60 bg-[linear-gradient(145deg,rgba(255,255,255,0.96),rgba(241,245,249,0.9))] p-5 shadow-[0_30px_80px_-42px_rgba(15,23,42,0.45)] xl:block">
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(56,189,248,0.18),transparent_42%),radial-gradient(circle_at_bottom_right,rgba(16,185,129,0.18),transparent_40%),linear-gradient(135deg,rgba(255,255,255,0.72),rgba(248,250,252,0.88))]" />
            <div className="absolute -right-10 top-6 h-40 w-40 rounded-full bg-sky-200/40 blur-3xl" />
            <div className="absolute left-4 bottom-0 h-28 w-28 rounded-full bg-emerald-200/35 blur-3xl" />

            <div className="relative h-full">
                <div className="absolute left-4 top-6 h-28 w-44 rounded-[26px] border border-white/80 bg-white/90 p-4 shadow-[0_20px_50px_-28px_rgba(14,116,144,0.45)]">
                    <div className="flex items-center justify-between text-[11px] font-bold uppercase tracking-[0.24em] text-sky-700">
                        <span>Media</span>
                        <span>AI</span>
                    </div>
                    <div className="mt-4 grid grid-cols-3 gap-2">
                        <div className="h-16 rounded-2xl bg-gradient-to-br from-sky-400 to-indigo-500 shadow-[inset_0_1px_0_rgba(255,255,255,0.4)]" />
                        <div className="h-16 rounded-2xl bg-gradient-to-br from-cyan-300 to-sky-400 shadow-[inset_0_1px_0_rgba(255,255,255,0.4)]" />
                        <div className="h-16 rounded-2xl bg-gradient-to-br from-indigo-300 to-violet-400 shadow-[inset_0_1px_0_rgba(255,255,255,0.4)]" />
                    </div>
                </div>

                <div className="absolute right-10 top-10 h-40 w-52 rotate-[7deg] rounded-[28px] border border-white/80 bg-[linear-gradient(180deg,rgba(255,255,255,0.98),rgba(254,242,242,0.95))] p-4 shadow-[0_32px_70px_-34px_rgba(190,24,93,0.45)]">
                    <div className="flex items-center gap-2">
                        <div className="h-3 w-3 rounded-full bg-rose-400" />
                        <div className="h-3 w-3 rounded-full bg-amber-300" />
                        <div className="h-3 w-3 rounded-full bg-emerald-400" />
                    </div>
                    <div className="mt-4 rounded-[20px] bg-gradient-to-br from-rose-500 to-orange-400 px-4 py-4 text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.25)]">
                        <div className="flex items-center justify-between text-[11px] font-bold uppercase tracking-[0.22em]">
                            <span>Live Polls</span>
                            <span>YT</span>
                        </div>
                        <div className="mt-4 space-y-2">
                            <div className="h-3 rounded-full bg-white/35" />
                            <div className="h-3 w-3/4 rounded-full bg-white/25" />
                            <div className="flex gap-2 pt-2">
                                <div className="h-9 flex-1 rounded-2xl bg-white/20" />
                                <div className="h-9 flex-1 rounded-2xl bg-white/20" />
                            </div>
                        </div>
                    </div>
                </div>

                <div className="absolute bottom-4 left-16 h-36 w-48 -rotate-[9deg] rounded-[28px] border border-white/80 bg-[linear-gradient(180deg,rgba(255,255,255,0.98),rgba(236,253,245,0.95))] p-4 shadow-[0_30px_70px_-36px_rgba(5,150,105,0.42)]">
                    <div className="flex items-center justify-between text-[11px] font-bold uppercase tracking-[0.24em] text-emerald-700">
                        <span>Inbox</span>
                        <span>WA</span>
                    </div>
                    <div className="mt-4 space-y-3">
                        <div className="ml-auto h-10 w-32 rounded-[20px] bg-gradient-to-r from-lime-300 to-emerald-400 shadow-[inset_0_1px_0_rgba(255,255,255,0.35)]" />
                        <div className="h-10 w-28 rounded-[20px] bg-white shadow-[0_10px_30px_-20px_rgba(15,23,42,0.32)]" />
                        <div className="h-10 w-36 rounded-[20px] bg-white shadow-[0_10px_30px_-20px_rgba(15,23,42,0.32)]" />
                    </div>
                </div>

                <div className="absolute bottom-8 right-20 h-24 w-32 rounded-[26px] border border-white/80 bg-[linear-gradient(160deg,rgba(255,255,255,0.95),rgba(236,253,245,0.92))] p-3 shadow-[0_22px_55px_-30px_rgba(15,23,42,0.35)]">
                    <div className="text-[10px] font-bold uppercase tracking-[0.24em] text-slate-500">Extractor</div>
                    <div className="mt-3 grid grid-cols-2 gap-2">
                        <div className="h-8 rounded-2xl bg-slate-200" />
                        <div className="h-8 rounded-2xl bg-emerald-200" />
                        <div className="h-8 rounded-2xl bg-teal-200" />
                        <div className="h-8 rounded-2xl bg-slate-100" />
                    </div>
                </div>
            </div>
        </div>
    );
}

function ToolCardIllustration({ toolId }: { toolId: string }) {
    switch (toolId) {
        case "question-extractor":
            return (
                <div className="relative h-40 overflow-hidden rounded-[26px] border border-white/70 bg-[linear-gradient(145deg,rgba(255,255,255,0.94),rgba(236,253,245,0.82))] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.8)]">
                    <div className="absolute right-3 top-3 h-20 w-28 rotate-[8deg] rounded-[22px] border border-white/90 bg-white/90 p-3 shadow-[0_24px_60px_-34px_rgba(5,150,105,0.4)]">
                        <div className="h-3 w-16 rounded-full bg-emerald-400/70" />
                        <div className="mt-3 grid grid-cols-3 gap-1.5">
                            {Array.from({ length: 6 }).map((_, index) => (
                                <div key={index} className="h-4 rounded-md bg-emerald-100" />
                            ))}
                        </div>
                    </div>
                    <div className="absolute left-6 top-7 h-24 w-36 -rotate-[9deg] rounded-[24px] border border-white/90 bg-gradient-to-br from-emerald-500 to-teal-500 p-4 text-white shadow-[0_28px_70px_-36px_rgba(13,148,136,0.52)]">
                        <div className="text-[10px] font-bold uppercase tracking-[0.24em]">OCR</div>
                        <div className="mt-4 space-y-2">
                            <div className="h-2.5 rounded-full bg-white/35" />
                            <div className="h-2.5 w-4/5 rounded-full bg-white/25" />
                            <div className="h-2.5 w-3/5 rounded-full bg-white/25" />
                        </div>
                    </div>
                    <div className="absolute bottom-4 right-5 rounded-full bg-emerald-100/95 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.24em] text-emerald-700 shadow-[0_15px_35px_-22px_rgba(5,150,105,0.42)]">
                        Diagrams
                    </div>
                </div>
            );
        case "media-studio":
            return (
                <div className="relative h-40 overflow-hidden rounded-[26px] border border-white/70 bg-[linear-gradient(145deg,rgba(255,255,255,0.94),rgba(239,246,255,0.88))] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.8)]">
                    <div className="absolute left-5 top-4 h-28 w-28 rounded-full bg-sky-300/50 blur-2xl" />
                    <div className="absolute right-5 bottom-4 h-20 w-20 rounded-full bg-indigo-300/40 blur-2xl" />
                    <div className="absolute left-6 top-7 h-24 w-40 -rotate-[6deg] rounded-[26px] border border-white/90 bg-gradient-to-br from-sky-500 to-indigo-500 p-4 text-white shadow-[0_28px_70px_-36px_rgba(59,130,246,0.55)]">
                        <div className="text-[10px] font-bold uppercase tracking-[0.24em]">Studio</div>
                        <div className="mt-3 flex items-center gap-3">
                            <div className="h-12 w-16 rounded-2xl bg-white/20" />
                            <div className="space-y-2 flex-1">
                                <div className="h-2.5 rounded-full bg-white/30" />
                                <div className="h-2.5 w-3/4 rounded-full bg-white/20" />
                            </div>
                        </div>
                    </div>
                    <div className="absolute right-6 top-10 h-20 w-24 rotate-[9deg] rounded-[22px] border border-white/90 bg-white/90 p-3 shadow-[0_24px_60px_-34px_rgba(99,102,241,0.42)]">
                        <div className="h-full rounded-[18px] bg-gradient-to-br from-sky-100 to-indigo-100 p-2">
                            <div className="h-9 rounded-xl bg-gradient-to-r from-fuchsia-300 to-sky-300" />
                            <div className="mt-2 flex gap-1.5">
                                <div className="h-5 flex-1 rounded-lg bg-white" />
                                <div className="h-5 flex-1 rounded-lg bg-white/80" />
                            </div>
                        </div>
                    </div>
                </div>
            );
        case "youtube-workspace":
            return (
                <div className="relative h-40 overflow-hidden rounded-[26px] border border-white/70 bg-[linear-gradient(145deg,rgba(255,255,255,0.94),rgba(255,247,237,0.88))] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.8)]">
                    <div className="absolute left-6 top-6 h-24 w-40 -rotate-[7deg] rounded-[26px] border border-white/90 bg-gradient-to-br from-rose-500 to-orange-400 p-4 text-white shadow-[0_28px_70px_-36px_rgba(244,63,94,0.55)]">
                        <div className="flex items-center justify-between text-[10px] font-bold uppercase tracking-[0.24em]">
                            <span>Live</span>
                            <span>YT</span>
                        </div>
                            <div className="mt-4 flex items-center gap-3">
                                <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white/20 text-[10px] font-bold uppercase tracking-[0.22em]">Play</div>
                                <div className="space-y-2 flex-1">
                                    <div className="h-2.5 rounded-full bg-white/35" />
                                    <div className="h-2.5 w-3/4 rounded-full bg-white/20" />
                            </div>
                        </div>
                    </div>
                    <div className="absolute right-5 top-8 w-28 rounded-[24px] border border-white/90 bg-white/95 p-3 shadow-[0_24px_60px_-34px_rgba(251,113,133,0.4)]">
                        <div className="text-[10px] font-bold uppercase tracking-[0.24em] text-slate-500">Poll</div>
                        <div className="mt-3 space-y-2">
                            <div className="h-7 rounded-2xl bg-rose-100" />
                            <div className="h-7 rounded-2xl bg-orange-100" />
                            <div className="h-7 rounded-2xl bg-amber-100" />
                        </div>
                    </div>
                </div>
            );
        case "whatsapp-workspace":
            return (
                <div className="relative h-40 overflow-hidden rounded-[26px] border border-white/70 bg-[linear-gradient(145deg,rgba(255,255,255,0.94),rgba(240,253,244,0.88))] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.8)]">
                    <div className="absolute left-8 top-8 h-20 w-24 -rotate-[8deg] rounded-[22px] border border-white/90 bg-gradient-to-br from-lime-400 to-emerald-500 shadow-[0_28px_70px_-36px_rgba(16,185,129,0.52)]" />
                    <div className="absolute right-8 top-7 h-14 w-28 rounded-[20px] border border-white/90 bg-white/95 px-4 py-3 shadow-[0_24px_60px_-34px_rgba(16,185,129,0.32)]">
                        <div className="h-2.5 rounded-full bg-emerald-200" />
                        <div className="mt-2 h-2.5 w-3/4 rounded-full bg-lime-200" />
                    </div>
                    <div className="absolute bottom-5 left-12 h-14 w-32 rounded-[20px] border border-white/90 bg-white/95 px-4 py-3 shadow-[0_24px_60px_-34px_rgba(15,23,42,0.22)]">
                        <div className="h-2.5 rounded-full bg-slate-200" />
                        <div className="mt-2 h-2.5 w-4/5 rounded-full bg-slate-100" />
                    </div>
                    <div className="absolute bottom-4 right-8 rounded-full bg-emerald-100/95 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.24em] text-emerald-700 shadow-[0_15px_35px_-22px_rgba(5,150,105,0.42)]">
                        Meta Cloud
                    </div>
                </div>
            );
        case "telegram-workspace":
            return (
                <div className="relative h-40 overflow-hidden rounded-[26px] border border-white/70 bg-[linear-gradient(145deg,rgba(255,255,255,0.94),rgba(236,254,255,0.88))] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.8)]">
                    <div className="absolute left-8 top-8 h-20 w-24 -rotate-[8deg] rounded-[22px] border border-white/90 bg-gradient-to-br from-cyan-400 to-sky-500 shadow-[0_28px_70px_-36px_rgba(14,165,233,0.52)]" />
                    <div className="absolute right-8 top-7 h-14 w-28 rounded-[20px] border border-white/90 bg-white/95 px-4 py-3 shadow-[0_24px_60px_-34px_rgba(14,165,233,0.32)]">
                        <div className="h-2.5 rounded-full bg-sky-200" />
                        <div className="mt-2 h-2.5 w-3/4 rounded-full bg-cyan-200" />
                    </div>
                    <div className="absolute bottom-5 left-12 h-14 w-32 rounded-[20px] border border-white/90 bg-white/95 px-4 py-3 shadow-[0_24px_60px_-34px_rgba(15,23,42,0.22)]">
                        <div className="h-2.5 rounded-full bg-slate-200" />
                        <div className="mt-2 h-2.5 w-4/5 rounded-full bg-slate-100" />
                    </div>
                    <div className="absolute bottom-4 right-8 rounded-full bg-sky-100/95 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.24em] text-sky-700 shadow-[0_15px_35px_-22px_rgba(2,132,199,0.42)]">
                        Bot API
                    </div>
                </div>
            );
        case "students-hub":
            return (
                <div className="relative h-40 overflow-hidden rounded-[26px] border border-white/70 bg-[linear-gradient(145deg,rgba(255,255,255,0.94),rgba(243,232,255,0.88))] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.8)]">
                    <div className="absolute -left-6 top-4 h-28 w-28 rounded-full bg-violet-300/40 blur-2xl" />
                    <div className="absolute right-0 bottom-0 h-24 w-24 rounded-full bg-purple-300/30 blur-2xl" />
                    
                    <div className="absolute left-6 top-8 h-20 w-32 -rotate-[6deg] rounded-[24px] border border-white/90 bg-gradient-to-br from-violet-500 to-purple-600 p-3 shadow-[0_28px_70px_-36px_rgba(139,92,246,0.55)]">
                        <div className="flex items-center gap-2">
                            <div className="h-6 w-6 rounded-full bg-white/20" />
                            <div className="h-2 w-16 rounded-full bg-white/40" />
                        </div>
                        <div className="mt-3 space-y-2">
                            <div className="h-2 w-20 rounded-full bg-white/20" />
                            <div className="h-2 w-14 rounded-full bg-white/20" />
                        </div>
                    </div>
                    
                    <div className="absolute right-5 top-5 h-24 w-20 rotate-[12deg] rounded-[20px] border border-white/90 bg-white/95 p-2 shadow-[0_24px_60px_-34px_rgba(168,85,247,0.42)]">
                        <div className="h-10 rounded-xl bg-violet-100/80" />
                        <div className="mt-2 space-y-1.5 px-1">
                            <div className="h-1.5 rounded-full bg-slate-200" />
                            <div className="h-1.5 w-3/4 rounded-full bg-slate-200" />
                            <div className="h-1.5 w-1/2 rounded-full bg-slate-200" />
                        </div>
                    </div>
                    
                    <div className="absolute bottom-4 right-5 rounded-full bg-violet-100/95 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.24em] text-violet-700 shadow-[0_15px_35px_-22px_rgba(139,92,246,0.42)]">
                        Pipelines
                    </div>
                </div>
            );
        case "members-hub":
            return (
                <div className="relative h-40 overflow-hidden rounded-[26px] border border-white/70 bg-[linear-gradient(145deg,rgba(255,255,255,0.94),rgba(224,242,254,0.88))] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.8)]">
                    <div className="absolute left-5 top-5 h-20 w-28 -rotate-[4deg] rounded-[24px] border border-white/90 bg-gradient-to-br from-blue-400 to-cyan-500 p-3 shadow-[0_28px_70px_-36px_rgba(56,189,248,0.55)]">
                        <div className="grid grid-cols-2 gap-2 h-full">
                            <div className="rounded-xl bg-white/20" />
                            <div className="rounded-xl bg-white/20" />
                        </div>
                    </div>
                    <div className="absolute left-10 top-14 h-20 w-36 rotate-[6deg] rounded-[22px] border border-white/90 bg-white/95 p-3 shadow-[0_24px_60px_-34px_rgba(14,165,233,0.35)]">
                        <div className="flex items-center gap-3">
                            <div className="h-8 w-8 rounded-full bg-blue-100" />
                            <div className="space-y-1.5 flex-1">
                                <div className="h-2 rounded-full bg-slate-200" />
                                <div className="h-2 w-2/3 rounded-full bg-slate-100" />
                            </div>
                        </div>
                        <div className="mt-3 flex justify-between px-1 gap-2">
                             <div className="h-1.5 flex-1 rounded-full bg-cyan-200" />
                             <div className="h-1.5 flex-1 rounded-full bg-blue-200" />
                        </div>
                    </div>
                    <div className="absolute bottom-4 right-5 rounded-full bg-blue-100/95 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.24em] text-blue-700 shadow-[0_15px_35px_-22px_rgba(56,189,248,0.42)]">
                        Access Control
                    </div>
                </div>
            );
        default:
            return (
                <div className="relative h-40 overflow-hidden rounded-[26px] border border-white/70 bg-white/90 p-4">
                    <div className="absolute inset-6 rounded-[22px] border border-slate-200 bg-slate-50" />
                </div>
            );
    }
}

export default function ContentStudioHomePage() {
    return (
        <Suspense fallback={<div className="page-container text-sm text-slate-600">Loading content studio...</div>}>
            <ContentStudioHomePageContent />
        </Suspense>
    );
}

function ContentStudioHomePageContent() {
    const pathname = usePathname();
    const router = useRouter();
    const searchParams = useSearchParams();
    const { data: session } = useSession();
    const role = (session?.user as any)?.role || "MEMBER";
    const isAdminRole = role === "ORG_ADMIN" || role === "SYSTEM_ADMIN";
    const allowedTools = Array.isArray((session?.user as any)?.allowedTools)
        ? ((session?.user as any)?.allowedTools as string[])
        : [];

    const [documents, setDocuments] = useState<DocumentRecord[]>([]);
    const [loadingDocs, setLoadingDocs] = useState(true);
    const [isRefreshingDocs, setIsRefreshingDocs] = useState(false);
    const [docPagination, setDocPagination] = useState<DocumentPagination>(
        DEFAULT_DOCUMENT_PAGINATION
    );
    const [query, setQuery] = useState(() => normalizeQueryParam(searchParams.get("q")));
    const [toolQuery, setToolQuery] = useState("");
    const [currentPage, setCurrentPage] = useState(() =>
        normalizePageParam(searchParams.get("page"))
    );
    const [usingDocId, setUsingDocId] = useState<string | null>(null);
    const [sortBy, setSortBy] = useState<DocumentSortField>(() =>
        normalizeSortByParam(searchParams.get("sortBy"))
    );
    const [sortOrder, setSortOrder] = useState<DocumentSortDirection>(() =>
        normalizeSortOrderParam(searchParams.get("sortOrder"))
    );
    const [assigneeFilter, setAssigneeFilter] = useState<string>(() =>
        normalizeAssigneeParam(searchParams.get("assignee"), isAdminRole)
    );
    const [selectedDocumentIds, setSelectedDocumentIds] = useState<string[]>([]);
    const [orgMembers, setOrgMembers] = useState<OrgMember[]>([]);
    const [loadingOrgMembers, setLoadingOrgMembers] = useState(false);
    const [assignmentTargetDocIds, setAssignmentTargetDocIds] = useState<string[]>([]);
    const [assignmentTargetLabel, setAssignmentTargetLabel] = useState<string>("");
    const [assignmentUserIds, setAssignmentUserIds] = useState<string[]>([]);
    const [isSavingAssignment, setIsSavingAssignment] = useState(false);
    const [docsReloadToken, setDocsReloadToken] = useState(0);

    const [modalConfig, setModalConfig] = useState<{
        isOpen: boolean;
        title: string;
        message: string;
        onConfirm?: () => void;
    }>({ isOpen: false, title: "", message: "", onConfirm: undefined });

    const canAccess = (permission?: string | string[]) => {
        if (!permission) return true;
        if (role === "SYSTEM_ADMIN" || role === "ORG_ADMIN") return true;
        if (Array.isArray(permission)) {
            return permission.some((entry) => allowedTools.includes(entry));
        }
        return allowedTools.includes(permission);
    };

    const hasAnyStudioAccess = canAccess("pdf-to-pdf") || canAccess("media-studio");
    const canAccessDocuments = canAccess("pdf-to-pdf");
    const canAssignDocuments = isAdminRole;
    const canDeleteDocuments = isAdminRole;
    const deferredQuery = useDeferredValue(query);
    const deferredToolQuery = useDeferredValue(toolQuery);

    useEffect(() => {
        const urlQuery = normalizeQueryParam(searchParams.get("q"));
        const urlSortBy = normalizeSortByParam(searchParams.get("sortBy"));
        const urlSortOrder = normalizeSortOrderParam(searchParams.get("sortOrder"));
        const urlAssignee = normalizeAssigneeParam(searchParams.get("assignee"), canAssignDocuments);
        const urlPage = normalizePageParam(searchParams.get("page"));

        if (query !== urlQuery) setQuery(urlQuery);
        if (sortBy !== urlSortBy) setSortBy(urlSortBy);
        if (sortOrder !== urlSortOrder) setSortOrder(urlSortOrder);
        if (assigneeFilter !== urlAssignee) setAssigneeFilter(urlAssignee);
        if (currentPage !== urlPage) setCurrentPage(urlPage);
    }, [searchParams, canAssignDocuments]);

    useEffect(() => {
        const nextSearch = buildViewSearch(
            query,
            sortBy,
            sortOrder,
            assigneeFilter,
            canAssignDocuments,
            currentPage
        );
        const currentSearch = buildViewSearch(
            normalizeQueryParam(searchParams.get("q")),
            normalizeSortByParam(searchParams.get("sortBy")),
            normalizeSortOrderParam(searchParams.get("sortOrder")),
            normalizeAssigneeParam(searchParams.get("assignee"), canAssignDocuments),
            canAssignDocuments,
            normalizePageParam(searchParams.get("page"))
        );
        if (nextSearch === currentSearch) return;
        const nextHref = nextSearch ? `${pathname}?${nextSearch}` : pathname;
        router.replace(nextHref, { scroll: false });
    }, [
        pathname,
        router,
        searchParams,
        query,
        sortBy,
        sortOrder,
        assigneeFilter,
        currentPage,
        canAssignDocuments,
    ]);

    const filteredTools = useMemo(() => {
        const text = deferredToolQuery.trim().toLowerCase();
        if (!text) return STUDIO_TOOLS;
        return STUDIO_TOOLS.filter((tool) =>
            `${tool.title} ${tool.description} ${tool.category} ${tool.badge}`
                .toLowerCase()
                .includes(text)
        );
    }, [deferredToolQuery]);

    const selectedDocSet = useMemo(
        () => new Set(selectedDocumentIds),
        [selectedDocumentIds]
    );
    const visibleDocIds = useMemo(
        () => documents.map((doc) => doc.id),
        [documents]
    );
    const visibleSelectedCount = useMemo(
        () => visibleDocIds.filter((id) => selectedDocSet.has(id)).length,
        [visibleDocIds, selectedDocSet]
    );
    const allVisibleSelected =
        visibleDocIds.length > 0 && visibleSelectedCount === visibleDocIds.length;

    useEffect(() => {
        const controller = new AbortController();
        let isActive = true;

        async function fetchDocuments() {
            try {
                if (documents.length === 0) {
                    setLoadingDocs(true);
                } else {
                    setIsRefreshingDocs(true);
                }
                const params = new URLSearchParams();
                params.set("minimal", "true");
                params.set("limit", String(DOCUMENTS_PAGE_SIZE));
                params.set("offset", String((currentPage - 1) * DOCUMENTS_PAGE_SIZE));
                params.set("sortBy", sortBy);
                params.set("sortOrder", sortOrder);
                const trimmedQuery = deferredQuery.trim();
                if (trimmedQuery) params.set("q", trimmedQuery);
                if (canAssignDocuments && assigneeFilter !== "all") {
                    params.set("assignee", assigneeFilter);
                }

                const res = await fetch(`/api/documents?${params.toString()}`, {
                    signal: controller.signal,
                });
                if (!res.ok) throw new Error("Failed to fetch documents");
                const data = await res.json();
                const nextDocuments = Array.isArray(data.documents) ? data.documents : [];
                const rawPagination =
                    data.pagination && typeof data.pagination === "object"
                        ? data.pagination
                        : {};
                const total = Number(rawPagination.total);
                const limit = Number(rawPagination.limit);
                const offset = Number(rawPagination.offset);
                const totalPages = Number(rawPagination.totalPages);
                const page = Number(rawPagination.page);
                const nextPagination: DocumentPagination = {
                    total: Number.isFinite(total) ? Math.max(total, 0) : nextDocuments.length,
                    limit: Number.isFinite(limit) && limit > 0 ? limit : DOCUMENTS_PAGE_SIZE,
                    offset: Number.isFinite(offset) && offset >= 0 ? offset : 0,
                    page: Number.isFinite(page) && page > 0 ? page : currentPage,
                    totalPages:
                        Number.isFinite(totalPages) && totalPages > 0
                            ? totalPages
                            : 1,
                    hasMore: Boolean(rawPagination.hasMore),
                };

                if (currentPage > nextPagination.totalPages) {
                    if (!isActive) return;
                    setCurrentPage(nextPagination.totalPages);
                    return;
                }

                if (!isActive) return;
                setDocuments(nextDocuments);
                setDocPagination(nextPagination);
            } catch (error) {
                if ((error as Error).name === "AbortError") return;
                if (!isActive) return;
                console.error(error);
                toast.error("Failed to load studio documents");
            } finally {
                if (!isActive) return;
                setLoadingDocs(false);
                setIsRefreshingDocs(false);
            }
        }

        if (canAccessDocuments) {
            fetchDocuments();
        } else {
            setLoadingDocs(false);
            setIsRefreshingDocs(false);
            setDocuments([]);
            setDocPagination(DEFAULT_DOCUMENT_PAGINATION);
        }

        return () => {
            isActive = false;
            controller.abort();
        };
    }, [
        assigneeFilter,
        canAccessDocuments,
        canAssignDocuments,
        currentPage,
        deferredQuery,
        docsReloadToken,
        sortBy,
        sortOrder,
    ]);

    useEffect(() => {
        setSelectedDocumentIds((prev) =>
            prev.filter((id) => documents.some((doc) => doc.id === id))
        );
    }, [documents]);

    useEffect(() => {
        async function fetchMembers() {
            try {
                setLoadingOrgMembers(true);
                const response = await fetch("/api/org/members");
                if (!response.ok) throw new Error("Failed to fetch members");
                const data = await response.json();
                setOrgMembers(Array.isArray(data.members) ? data.members : []);
            } catch (error) {
                console.error(error);
                setOrgMembers([]);
            } finally {
                setLoadingOrgMembers(false);
            }
        }

        if (canAssignDocuments) {
            fetchMembers();
        } else {
            setOrgMembers([]);
        }
    }, [canAssignDocuments]);

    const visibleRangeStart = docPagination.total === 0 ? 0 : docPagination.offset + 1;
    const visibleRangeEnd = docPagination.total === 0
        ? 0
        : docPagination.offset + documents.length;
    const isDocsFiltered = Boolean(deferredQuery.trim()) || assigneeFilter !== "all";
    const paginationItems = useMemo(
        () => buildPaginationItems(currentPage, Math.max(docPagination.totalPages, 1)),
        [currentPage, docPagination.totalPages]
    );

    const handleOpenTool = (tool: StudioTool) => {
        if (!tool.href) {
            toast("This tool is planned and will be enabled soon.");
            return;
        }
        if (!canAccess(tool.permission)) {
            toast.error("Tool access not granted for your account.");
            return;
        }
        router.push(tool.href);
    };

    const handleOpenDocument = (id: string) => {
        setUsingDocId(id);
        router.push(`/content-studio/extractor?load=${id}`);
    };

    const handleDownload = async (id: string, title: string) => {
        try {
            const response = await fetch(`/api/documents/${id}`, { method: "POST" });
            if (!response.ok) throw new Error("Download failed");
            const blob = await response.blob();
            downloadBlobAsFile(blob, `${title}.pdf`);
            toast.success("PDF downloaded");
        } catch (error) {
            console.error(error);
            toast.error("Failed to download PDF");
        }
    };

    const handleDelete = (id: string) => {
        setModalConfig({
            isOpen: true,
            title: "Delete Document",
            message: "This action permanently removes this document.",
            onConfirm: async () => {
                try {
                    const response = await fetch(`/api/documents/${id}`, { method: "DELETE" });
                    if (!response.ok) throw new Error("Delete failed");
                    setSelectedDocumentIds((prev) => prev.filter((item) => item !== id));
                    setDocsReloadToken((prev) => prev + 1);
                    toast.success("Document deleted");
                } catch (error) {
                    console.error(error);
                    toast.error("Failed to delete document");
                }
            },
        });
    };

    const renderDocumentActions = (doc: DocumentRecord, layout: "table" | "card" = "table") => {
        const widthClass = layout === "card" ? "w-full sm:w-auto" : "";

        return (
            <div className={`flex flex-wrap gap-2 ${layout === "table" ? "justify-end" : ""}`}>
                <button
                    type="button"
                    onClick={() => handleOpenDocument(doc.id)}
                    className={`btn btn-secondary text-xs ${widthClass}`}
                    disabled={usingDocId === doc.id}
                >
                    {usingDocId === doc.id ? "Opening..." : "Use"}
                </button>
                <button
                    type="button"
                    onClick={() => handleDownload(doc.id, doc.title)}
                    className={`btn btn-primary text-xs ${widthClass}`}
                >
                    Download
                </button>
                {canAssignDocuments && (
                    <button
                        type="button"
                        onClick={() => openSingleAssignmentModal(doc)}
                        className={`btn btn-secondary text-xs ${widthClass}`}
                    >
                        Assign
                    </button>
                )}
                {canDeleteDocuments && (
                    <button
                        type="button"
                        onClick={() => handleDelete(doc.id)}
                        className={`btn btn-danger text-xs ${widthClass}`}
                    >
                        Delete
                    </button>
                )}
            </div>
        );
    };

    const closeAssignmentModal = () => {
        setAssignmentTargetDocIds([]);
        setAssignmentTargetLabel("");
        setAssignmentUserIds([]);
    };

    const openSingleAssignmentModal = (doc: DocumentRecord) => {
        setAssignmentTargetDocIds([doc.id]);
        setAssignmentTargetLabel(doc.title);
        setAssignmentUserIds(Array.isArray(doc.assignedUserIds) ? doc.assignedUserIds : []);
    };

    const openBulkAssignmentModal = () => {
        if (selectedDocumentIds.length === 0) {
            toast.error("Select at least one document for bulk assignment.");
            return;
        }
        setAssignmentTargetDocIds(selectedDocumentIds);
        setAssignmentTargetLabel(`${selectedDocumentIds.length} selected documents`);
        setAssignmentUserIds([]);
    };

    const toggleAssignmentUser = (userId: string) => {
        setAssignmentUserIds((prev) =>
            prev.includes(userId)
                ? prev.filter((id) => id !== userId)
                : [...prev, userId]
        );
    };

    const toggleDocumentSelection = (docId: string) => {
        setSelectedDocumentIds((prev) =>
            prev.includes(docId)
                ? prev.filter((id) => id !== docId)
                : [...prev, docId]
        );
    };

    const toggleSelectAllVisible = () => {
        if (allVisibleSelected) {
            const visibleSet = new Set(visibleDocIds);
            setSelectedDocumentIds((prev) => prev.filter((id) => !visibleSet.has(id)));
            return;
        }

        setSelectedDocumentIds((prev) => {
            const next = new Set(prev);
            visibleDocIds.forEach((id) => next.add(id));
            return Array.from(next);
        });
    };

    const saveAssignments = async () => {
        if (assignmentTargetDocIds.length === 0) return;
        try {
            setIsSavingAssignment(true);
            let successCount = 0;
            let failedCount = 0;

            for (const docId of assignmentTargetDocIds) {
                try {
                    const response = await fetch(`/api/documents/${docId}/assign`, {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ userIds: assignmentUserIds }),
                    });

                    if (!response.ok) {
                        const payload = await response.json().catch(() => ({}));
                        throw new Error(payload.error || "Failed to save assignments");
                    }

                    successCount += 1;
                } catch (error) {
                    console.error(error);
                    failedCount += 1;
                }
            }

            if (successCount > 0) {
                const targetSet = new Set(assignmentTargetDocIds);
                setDocuments((prev) =>
                    prev.map((doc) =>
                        targetSet.has(doc.id)
                            ? { ...doc, assignedUserIds: assignmentUserIds }
                            : doc
                    )
                );
                toast.success(
                    successCount === 1
                        ? "Document assignment updated"
                        : `${successCount} documents assigned`
                );
                if (assignmentTargetDocIds.length > 1) {
                    setSelectedDocumentIds((prev) =>
                        prev.filter((id) => !targetSet.has(id))
                    );
                }
            }

            if (failedCount > 0) {
                toast.error(`${failedCount} document(s) failed to assign. Retry once.`);
                return;
            }

            closeAssignmentModal();
        } finally {
            setIsSavingAssignment(false);
        }
    };

    if (!hasAnyStudioAccess) {
        return (
            <div className="page-container">
                <section className="surface p-10 text-center">
                    <h1 className="heading-xl">Institute Suite Access Required</h1>
                    <p className="text-sm text-slate-500 mt-2">
                        Ask your workspace admin to grant `Institute Suite` or `Media Studio` access.
                    </p>
                </section>
            </div>
        );
    }

    return (
        <div className="page-container" style={{ width: "min(1540px, calc(100% - 1.5rem))" }}>
            <header className="relative mb-5 overflow-hidden rounded-[34px] border border-slate-200 bg-[linear-gradient(135deg,rgba(248,250,252,0.96),rgba(255,255,255,0.98))] p-5 shadow-[0_28px_80px_-40px_rgba(15,23,42,0.38)] md:p-6">
                <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(96,165,250,0.14),transparent_36%),radial-gradient(circle_at_bottom_left,rgba(16,185,129,0.12),transparent_34%),linear-gradient(180deg,rgba(255,255,255,0.4),rgba(248,250,252,0.15))]" />
                <div className="absolute -left-10 top-10 h-40 w-40 rounded-full bg-sky-200/35 blur-3xl" />
                <div className="absolute bottom-0 right-0 h-44 w-44 rounded-full bg-emerald-200/25 blur-3xl" />

                <div className="relative grid gap-6 xl:grid-cols-[minmax(0,1.05fr)_minmax(360px,430px)] xl:items-center">
                    <div className="space-y-4">
                        <div className="space-y-3">
                            <span className="eyebrow">Institute Suite</span>
                            <div>
                                <h1 className="heading-xl mt-0">Tool Hub</h1>
                                <p className="mt-2 max-w-2xl text-sm leading-relaxed text-slate-600">
                                    One visual control surface for extractor, media generation, YouTube publishing, WhatsApp campaigns, and Telegram bot operations. Open the right workspace fast, keep saved outputs organized, and move between creation and distribution without losing context.
                                </p>
                            </div>
                        </div>

                        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                            <div className="rounded-[24px] border border-white/80 bg-white/80 px-4 py-4 shadow-[0_18px_50px_-32px_rgba(59,130,246,0.35)] backdrop-blur">
                                <p className="text-[11px] font-bold uppercase tracking-[0.22em] text-slate-400">Tool Routes</p>
                                <p className="mt-2 text-2xl font-bold text-slate-900">{STUDIO_TOOLS.length}</p>
                                <p className="mt-1 text-xs text-slate-500">Dedicated creative, publishing, and messaging workspaces</p>
                            </div>
                            <div className="rounded-[24px] border border-white/80 bg-white/80 px-4 py-4 shadow-[0_18px_50px_-32px_rgba(16,185,129,0.3)] backdrop-blur">
                                <p className="text-[11px] font-bold uppercase tracking-[0.22em] text-slate-400">Saved Extractor Docs</p>
                                <p className="mt-2 text-2xl font-bold text-slate-900">{canAccessDocuments ? docPagination.total : 0}</p>
                                <p className="mt-1 text-xs text-slate-500">History now opens inside Question Extractor itself</p>
                            </div>
                            <div className="rounded-[24px] border border-white/80 bg-white/80 px-4 py-4 shadow-[0_18px_50px_-32px_rgba(244,63,94,0.28)] backdrop-blur">
                                <p className="text-[11px] font-bold uppercase tracking-[0.22em] text-slate-400">Visible To You</p>
                                <p className="mt-2 text-2xl font-bold text-slate-900">{filteredTools.filter((tool) => canAccess(tool.permission)).length}</p>
                                <p className="mt-1 text-xs text-slate-500">Access-aware workspace cards from your current role</p>
                            </div>
                            <div className="rounded-[24px] border border-white/80 bg-white/80 px-4 py-4 shadow-[0_18px_50px_-32px_rgba(99,102,241,0.28)] backdrop-blur">
                                <p className="text-[11px] font-bold uppercase tracking-[0.22em] text-slate-400">Current Page</p>
                                <p className="mt-2 text-2xl font-bold text-slate-900">{currentPage}/{Math.max(docPagination.totalPages, 1)}</p>
                                <p className="mt-1 text-xs text-slate-500">Search and browse tools without leaving the hub</p>
                            </div>
                        </div>

                        <div className="flex flex-wrap items-center gap-2">
                            <span className="status-badge"><span className="status-dot" />Live: {STUDIO_TOOLS.filter((tool) => tool.status === "Live").length}</span>
                            <span className="status-badge"><span className="status-dot" />Beta: {STUDIO_TOOLS.filter((tool) => tool.status === "Beta").length}</span>
                            <span className="status-badge"><span className="status-dot" />Workspace history lives in-context now</span>
                        </div>

                        <div className="rounded-[28px] border border-white/80 bg-white/80 p-3 shadow-[0_18px_50px_-34px_rgba(15,23,42,0.24)] backdrop-blur">
                            <div className="flex flex-wrap items-center gap-3">
                                <input
                                    value={toolQuery}
                                    onChange={(event) => setToolQuery(event.target.value)}
                                    placeholder="Search tools by name, category, or capability"
                                    className="input border-white/70 bg-white flex-1 min-w-[200px]"
                                />
                                <button
                                    type="button"
                                    className="btn btn-primary text-xs w-full lg:w-auto"
                                    onClick={() => {
                                        if (!canAccess("pdf-to-pdf")) {
                                            toast.error("Question Extractor access not granted.");
                                            return;
                                        }
                                        router.push("/content-studio/extractor");
                                    }}
                                >
                                    Open Question Extractor
                                </button>
                                <button
                                    type="button"
                                    className="btn btn-secondary text-xs w-full lg:w-auto"
                                    onClick={() => {
                                        if (!canAccess("media-studio")) {
                                            toast.error("Media Studio access not granted.");
                                            return;
                                        }
                                        router.push("/content-studio/media");
                                    }}
                                >
                                    Open Media Studio
                                </button>
                                <button
                                    type="button"
                                    className="btn btn-ghost text-xs w-full lg:w-auto"
                                    onClick={() => {
                                        if (!canAccess(["media-studio", "pdf-to-pdf"])) {
                                            toast.error("YouTube Workspace access not granted.");
                                            return;
                                        }
                                        router.push("/content-studio/youtube");
                                    }}
                                >
                                    Open YouTube Workspace
                                </button>
                                <button
                                    type="button"
                                    className="btn btn-ghost text-xs w-full lg:w-auto"
                                    onClick={() => {
                                        if (!canAccess("media-studio")) {
                                            toast.error("WhatsApp Workspace access not granted.");
                                            return;
                                        }
                                        router.push("/content-studio/whatsapp");
                                    }}
                                >
                                    Open WhatsApp Workspace
                                </button>
                                <button
                                    type="button"
                                    className="btn btn-ghost text-xs w-full lg:w-auto"
                                    onClick={() => {
                                        if (!canAccess("media-studio")) {
                                            toast.error("Telegram Workspace access not granted.");
                                            return;
                                        }
                                        router.push("/content-studio/telegram");
                                    }}
                                >
                                    Open Telegram Workspace
                                </button>
                                <button
                                    type="button"
                                    className="btn btn-ghost text-xs w-full lg:w-auto"
                                    onClick={() => {
                                        if (!canAccess("pdf-to-pdf")) {
                                            toast.error("Students Hub access not granted.");
                                            return;
                                        }
                                        router.push("/content-studio/students");
                                    }}
                                >
                                    Open Students
                                </button>
                                <button
                                    type="button"
                                    className="btn btn-ghost text-xs w-full lg:w-auto"
                                    onClick={() => {
                                        if (!canAccess("pdf-to-pdf")) {
                                            toast.error("Members Configurator access not granted.");
                                            return;
                                        }
                                        router.push("/content-studio/members");
                                    }}
                                >
                                    Open Members
                                </button>
                            </div>
                        </div>
                    </div>

                    <ToolHubHeroArt />
                </div>
            </header>

            <section className="mb-5 grid grid-cols-1 gap-4 xl:grid-cols-2">
                {filteredTools.map((tool) => {
                    const access = canAccess(tool.permission);
                    const theme = getToolVisualTheme(tool.id);

                    return (
                        <article
                            key={tool.id}
                            className={`group relative overflow-hidden rounded-[30px] border ${theme.cardBorder} bg-gradient-to-br ${theme.cardGradient} p-4 shadow-[0_24px_70px_-42px_rgba(15,23,42,0.32)] transition duration-300 hover:-translate-y-1 hover:shadow-[0_30px_80px_-40px_rgba(15,23,42,0.38)] md:p-5`}
                        >
                            <div className={`absolute -right-10 top-10 h-32 w-32 rounded-full blur-3xl ${theme.glowClass}`} />
                            <div className="relative">
                                <div className="flex items-start justify-between gap-3">
                                    <div className="space-y-2">
                                        <div className="flex flex-wrap items-center gap-2">
                                            <span className={`px-2 py-1 rounded-lg text-[10px] font-bold uppercase tracking-wide border ${statusTone(tool.status)}`}>
                                                {tool.status}
                                            </span>
                                            <span className="text-[10px] font-semibold uppercase tracking-[0.22em] text-slate-500">
                                                {tool.category}
                                            </span>
                                            <span className="rounded-md border border-white/80 bg-white/75 px-2 py-1 text-[10px] font-semibold text-slate-600 shadow-[0_10px_30px_-24px_rgba(15,23,42,0.25)]">
                                                {theme.accentLabel}
                                            </span>
                                        </div>
                                        <div>
                                            <h3 className="text-lg font-bold text-slate-900">{tool.title}</h3>
                                            <p className="mt-1 text-sm leading-relaxed text-slate-600">
                                                {tool.description}
                                            </p>
                                        </div>
                                    </div>
                                    <span className="rounded-full border border-white/80 bg-white/80 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.22em] text-slate-500 shadow-[0_12px_35px_-24px_rgba(15,23,42,0.28)]">
                                        {tool.badge}
                                    </span>
                                </div>

                                <div className="mt-4">
                                    <ToolCardIllustration toolId={tool.id} />
                                </div>

                                <div className="mt-4 flex flex-wrap gap-2">
                                    {theme.highlights.map((highlight) => (
                                        <span
                                            key={`${tool.id}-${highlight}`}
                                            className="rounded-full border border-white/80 bg-white/80 px-3 py-1 text-[11px] font-semibold text-slate-600 shadow-[0_10px_30px_-24px_rgba(15,23,42,0.22)]"
                                        >
                                            {highlight}
                                        </span>
                                    ))}
                                </div>

                                <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                                    <p className="text-xs leading-relaxed text-slate-500">
                                        {access
                                            ? "Ready to open with your current workspace access."
                                            : "This workspace exists in the hub, but your account needs permission before it can open."}
                                    </p>
                                    <button
                                        type="button"
                                        onClick={() => handleOpenTool(tool)}
                                        className={`btn shrink-0 text-xs ${tool.href && access ? "btn-primary" : "btn-ghost"}`}
                                    >
                                        {tool.href ? (access ? "Open Workspace" : "No Access") : "Planned"}
                                    </button>
                                </div>
                            </div>
                        </article>
                    );
                })}
            </section>

            <section className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1.15fr)_minmax(320px,0.85fr)]">
                <article className="relative overflow-hidden rounded-[30px] border border-slate-200 bg-[linear-gradient(145deg,rgba(255,255,255,0.98),rgba(248,250,252,0.92))] p-5 shadow-[0_22px_60px_-36px_rgba(15,23,42,0.24)]">
                    <div className="absolute inset-y-0 right-0 w-40 bg-[radial-gradient(circle_at_center,rgba(99,102,241,0.14),transparent_60%)]" />
                    <div className="relative flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                        <div className="max-w-2xl">
                            <p className="text-[11px] font-bold uppercase tracking-[0.24em] text-slate-500">Workspace History Moved</p>
                            <h2 className="mt-2 text-xl font-bold text-slate-900">
                                Extractor history now lives inside Question Extractor
                            </h2>
                            <p className="mt-2 text-sm leading-relaxed text-slate-600">
                                Recent extracted workspaces are no longer shown on Tool Hub. Open the extractor to continue saved question-review workspaces and see that history exactly where editing and regeneration happen.
                            </p>
                        </div>
                        <div className="flex flex-wrap gap-2">
                            <button
                                type="button"
                                className="btn btn-primary text-xs"
                                onClick={() => {
                                    if (!canAccess("pdf-to-pdf")) {
                                        toast.error("Question Extractor access not granted.");
                                        return;
                                    }
                                    router.push("/content-studio/extractor");
                                }}
                            >
                                Open Question Extractor
                            </button>
                            <button
                                type="button"
                                className="btn btn-ghost text-xs"
                                onClick={() => setDocsReloadToken((prev) => prev + 1)}
                            >
                                Refresh Counts
                            </button>
                        </div>
                    </div>
                </article>

                <article className="relative overflow-hidden rounded-[30px] border border-slate-200 bg-[linear-gradient(160deg,rgba(255,255,255,0.98),rgba(241,245,249,0.92))] p-5 shadow-[0_22px_60px_-36px_rgba(15,23,42,0.24)]">
                    <div className="absolute -right-10 -top-8 h-28 w-28 rounded-full bg-sky-200/35 blur-3xl" />
                    <div className="relative">
                        <p className="text-[11px] font-bold uppercase tracking-[0.24em] text-slate-500">Studio Snapshot</p>
                        <div className="mt-4 grid grid-cols-2 gap-3">
                            <div className="rounded-[22px] border border-white/80 bg-white/85 px-4 py-4 shadow-[0_16px_45px_-30px_rgba(15,23,42,0.2)]">
                                <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-slate-400">Tools</p>
                                <p className="mt-2 text-2xl font-bold text-slate-900">{STUDIO_TOOLS.length}</p>
                            </div>
                            <div className="rounded-[22px] border border-white/80 bg-white/85 px-4 py-4 shadow-[0_16px_45px_-30px_rgba(15,23,42,0.2)]">
                                <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-slate-400">Saved Docs</p>
                                <p className="mt-2 text-2xl font-bold text-slate-900">{canAccessDocuments ? docPagination.total : 0}</p>
                            </div>
                            <div className="rounded-[22px] border border-white/80 bg-white/85 px-4 py-4 shadow-[0_16px_45px_-30px_rgba(15,23,42,0.2)]">
                                <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-slate-400">Visible</p>
                                <p className="mt-2 text-2xl font-bold text-slate-900">{filteredTools.filter((tool) => canAccess(tool.permission)).length}</p>
                            </div>
                            <div className="rounded-[22px] border border-white/80 bg-white/85 px-4 py-4 shadow-[0_16px_45px_-30px_rgba(15,23,42,0.2)]">
                                <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-slate-400">Browse Page</p>
                                <p className="mt-2 text-2xl font-bold text-slate-900">{currentPage}</p>
                            </div>
                        </div>
                    </div>
                </article>
            </section>

            <Modal
                isOpen={modalConfig.isOpen}
                onClose={() => setModalConfig((prev) => ({ ...prev, isOpen: false }))}
                onConfirm={modalConfig.onConfirm}
                title={modalConfig.title}
                message={modalConfig.message}
                type="danger"
                confirmText="Delete"
                cancelText="Cancel"
            />

            {assignmentTargetDocIds.length > 0 && (
                <div className="fixed inset-0 z-[90] bg-slate-900/45 backdrop-blur-sm flex items-center justify-center p-4">
                    <div className="surface w-full max-w-2xl p-5 max-h-[80vh] flex flex-col">
                        <div className="flex items-start justify-between gap-3 mb-3">
                            <div>
                                <p className="text-xs font-bold uppercase tracking-wide text-slate-500">
                                    Document Assignment
                                </p>
                                <h3 className="text-base font-bold text-slate-900 mt-1">
                                    {assignmentTargetLabel}
                                </h3>
                                <p className="text-xs text-slate-500 mt-1">
                                    Select members allowed to access this document set.
                                </p>
                            </div>
                            <button
                                type="button"
                                className="btn btn-ghost text-xs"
                                onClick={closeAssignmentModal}
                            >
                                Close
                            </button>
                        </div>

                        <div className="border border-slate-200 rounded-xl bg-slate-50 p-3 overflow-auto flex-1">
                            {loadingOrgMembers ? (
                                <div className="space-y-2">
                                    {Array.from({ length: 4 }).map((_, index) => (
                                        <div key={index} className="skeleton skeleton-chip w-full h-10" />
                                    ))}
                                </div>
                            ) : orgMembers.length === 0 ? (
                                <p className="text-sm text-slate-500">
                                    No workspace members found.
                                </p>
                            ) : (
                                <div className="space-y-2">
                                    {orgMembers.map((member) => {
                                        const selected = assignmentUserIds.includes(member.id);
                                        return (
                                            <label
                                                key={member.id}
                                                className={`flex items-center gap-3 rounded-lg border px-3 py-2.5 cursor-pointer transition ${
                                                    selected
                                                        ? "bg-indigo-50 border-indigo-200"
                                                        : "bg-white border-slate-200 hover:border-slate-300"
                                                }`}
                                            >
                                                <input
                                                    type="checkbox"
                                                    checked={selected}
                                                    onChange={() => toggleAssignmentUser(member.id)}
                                                />
                                                <div className="min-w-0">
                                                    <p className="text-sm font-semibold text-slate-900 truncate">
                                                        {member.name || member.username || member.email || "Member"}
                                                    </p>
                                                    <p className="text-xs text-slate-500 truncate">
                                                        {member.email || member.username || "No login ID"}{member.designation ? ` • ${member.designation}` : ""}
                                                    </p>
                                                </div>
                                            </label>
                                        );
                                    })}
                                </div>
                            )}
                        </div>

                        <div className="mt-3 flex items-center justify-between gap-3">
                            <span className="text-xs text-slate-500">
                                Assigned: {assignmentUserIds.length}
                            </span>
                            <div className="flex items-center gap-2">
                                <button
                                    type="button"
                                    className="btn btn-ghost text-xs"
                                    onClick={closeAssignmentModal}
                                >
                                    Cancel
                                </button>
                                <button
                                    type="button"
                                    className="btn btn-primary text-xs"
                                    onClick={saveAssignments}
                                    disabled={isSavingAssignment}
                                >
                                    {isSavingAssignment ? "Saving..." : "Save Assignment"}
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
