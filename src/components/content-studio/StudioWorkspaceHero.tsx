"use client";

import Link from "next/link";

type WorkspaceHeroTheme = "extractor" | "media" | "youtube" | "whatsapp";

type WorkspaceHeroAction = {
    href: string;
    label: string;
    tone?: "primary" | "secondary" | "ghost";
};

type StudioWorkspaceHeroProps = {
    theme: WorkspaceHeroTheme;
    eyebrow: string;
    title: string;
    description: string;
    highlights: string[];
    actions: WorkspaceHeroAction[];
    compact?: boolean;
    helperText?: string;
};

type ThemeStyles = {
    shellGradient: string;
    borderTone: string;
    glowPrimary: string;
    glowSecondary: string;
};

const HERO_THEME_STYLES: Record<WorkspaceHeroTheme, ThemeStyles> = {
    extractor: {
        shellGradient: "from-emerald-50 via-white to-teal-50",
        borderTone: "border-emerald-200/70",
        glowPrimary: "bg-emerald-300/35",
        glowSecondary: "bg-teal-300/25",
    },
    media: {
        shellGradient: "from-sky-50 via-white to-indigo-50",
        borderTone: "border-sky-200/70",
        glowPrimary: "bg-sky-300/35",
        glowSecondary: "bg-indigo-300/25",
    },
    youtube: {
        shellGradient: "from-rose-50 via-white to-orange-50",
        borderTone: "border-rose-200/70",
        glowPrimary: "bg-rose-300/35",
        glowSecondary: "bg-orange-300/25",
    },
    whatsapp: {
        shellGradient: "from-lime-50 via-white to-emerald-50",
        borderTone: "border-lime-200/70",
        glowPrimary: "bg-lime-300/35",
        glowSecondary: "bg-emerald-300/25",
    },
};

function WorkspaceArt({ theme, compact = false }: { theme: WorkspaceHeroTheme; compact?: boolean }) {
    const baseCard = compact ? "h-[150px] w-[220px]" : "h-[180px] w-[250px]";

    switch (theme) {
        case "extractor":
            return (
                <div className="relative h-full min-h-[180px]">
                    <div className={`absolute left-6 top-6 -rotate-[7deg] rounded-[28px] border border-white/80 bg-gradient-to-br from-emerald-500 to-teal-500 p-4 text-white shadow-[0_30px_70px_-36px_rgba(13,148,136,0.55)] ${baseCard}`}>
                        <div className="text-[10px] font-bold uppercase tracking-[0.24em]">Extractor</div>
                        <div className="mt-4 space-y-2">
                            <div className="h-2.5 rounded-full bg-white/35" />
                            <div className="h-2.5 w-4/5 rounded-full bg-white/25" />
                            <div className="h-2.5 w-3/5 rounded-full bg-white/20" />
                        </div>
                        <div className="mt-4 grid grid-cols-3 gap-2">
                            {Array.from({ length: 6 }).map((_, index) => (
                                <div key={index} className="h-7 rounded-xl bg-white/16" />
                            ))}
                        </div>
                    </div>
                    <div className="absolute right-3 top-5 h-28 w-36 rotate-[10deg] rounded-[26px] border border-white/85 bg-white/92 p-4 shadow-[0_25px_60px_-36px_rgba(5,150,105,0.38)]">
                        <div className="text-[10px] font-bold uppercase tracking-[0.24em] text-slate-500">Review</div>
                        <div className="mt-4 grid grid-cols-2 gap-2">
                            <div className="h-10 rounded-2xl bg-emerald-100" />
                            <div className="h-10 rounded-2xl bg-teal-100" />
                            <div className="h-10 rounded-2xl bg-slate-100" />
                            <div className="h-10 rounded-2xl bg-emerald-50" />
                        </div>
                    </div>
                </div>
            );
        case "media":
            return (
                <div className="relative h-full min-h-[180px]">
                    <div className={`absolute left-6 top-6 -rotate-[6deg] rounded-[28px] border border-white/80 bg-gradient-to-br from-sky-500 to-indigo-500 p-4 text-white shadow-[0_30px_70px_-36px_rgba(59,130,246,0.52)] ${baseCard}`}>
                        <div className="text-[10px] font-bold uppercase tracking-[0.24em]">Creative</div>
                        <div className="mt-4 grid grid-cols-3 gap-2">
                            <div className="h-16 rounded-2xl bg-white/18" />
                            <div className="h-16 rounded-2xl bg-white/12" />
                            <div className="h-16 rounded-2xl bg-white/18" />
                        </div>
                        <div className="mt-4 flex gap-2">
                            <div className="h-8 flex-1 rounded-2xl bg-white/16" />
                            <div className="h-8 flex-1 rounded-2xl bg-white/16" />
                        </div>
                    </div>
                    <div className="absolute right-3 top-4 h-28 w-36 rotate-[9deg] rounded-[26px] border border-white/85 bg-white/92 p-4 shadow-[0_25px_60px_-36px_rgba(79,70,229,0.38)]">
                        <div className="h-full rounded-[20px] bg-gradient-to-br from-sky-100 to-indigo-100 p-3">
                            <div className="h-10 rounded-2xl bg-gradient-to-r from-fuchsia-300 to-sky-300" />
                            <div className="mt-3 flex gap-2">
                                <div className="h-5 flex-1 rounded-xl bg-white" />
                                <div className="h-5 flex-1 rounded-xl bg-white/80" />
                            </div>
                            <div className="mt-2 h-5 w-3/4 rounded-xl bg-white/75" />
                        </div>
                    </div>
                </div>
            );
        case "youtube":
            return (
                <div className="relative h-full min-h-[180px]">
                    <div className={`absolute left-6 top-6 -rotate-[7deg] rounded-[28px] border border-white/80 bg-gradient-to-br from-rose-500 to-orange-400 p-4 text-white shadow-[0_30px_70px_-36px_rgba(244,63,94,0.52)] ${baseCard}`}>
                        <div className="flex items-center justify-between text-[10px] font-bold uppercase tracking-[0.24em]">
                            <span>Broadcast</span>
                            <span>YT</span>
                        </div>
                        <div className="mt-4 flex items-center gap-3">
                            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white/20 text-[10px] font-bold uppercase tracking-[0.22em]">
                                Live
                            </div>
                            <div className="space-y-2 flex-1">
                                <div className="h-2.5 rounded-full bg-white/35" />
                                <div className="h-2.5 w-3/4 rounded-full bg-white/20" />
                            </div>
                        </div>
                        <div className="mt-4 flex gap-2">
                            <div className="h-8 flex-1 rounded-2xl bg-white/16" />
                            <div className="h-8 flex-1 rounded-2xl bg-white/16" />
                        </div>
                    </div>
                    <div className="absolute right-3 top-5 h-28 w-36 rotate-[8deg] rounded-[26px] border border-white/85 bg-white/92 p-4 shadow-[0_25px_60px_-36px_rgba(249,115,22,0.34)]">
                        <div className="text-[10px] font-bold uppercase tracking-[0.24em] text-slate-500">Poll Queue</div>
                        <div className="mt-4 space-y-2">
                            <div className="h-8 rounded-2xl bg-rose-100" />
                            <div className="h-8 rounded-2xl bg-orange-100" />
                            <div className="h-8 rounded-2xl bg-amber-100" />
                        </div>
                    </div>
                </div>
            );
        case "whatsapp":
            return (
                <div className="relative h-full min-h-[180px]">
                    <div className={`absolute left-6 top-6 -rotate-[7deg] rounded-[28px] border border-white/80 bg-gradient-to-br from-lime-400 to-emerald-500 p-4 text-white shadow-[0_30px_70px_-36px_rgba(16,185,129,0.52)] ${baseCard}`}>
                        <div className="text-[10px] font-bold uppercase tracking-[0.24em]">WhatsApp</div>
                        <div className="mt-4 space-y-3">
                            <div className="ml-auto h-9 w-28 rounded-[18px] bg-white/16" />
                            <div className="h-9 w-24 rounded-[18px] bg-white/26" />
                            <div className="h-9 w-36 rounded-[18px] bg-white/20" />
                        </div>
                    </div>
                    <div className="absolute right-3 top-5 h-28 w-36 rotate-[8deg] rounded-[26px] border border-white/85 bg-white/92 p-4 shadow-[0_25px_60px_-36px_rgba(5,150,105,0.34)]">
                        <div className="text-[10px] font-bold uppercase tracking-[0.24em] text-slate-500">Campaigns</div>
                        <div className="mt-4 space-y-2">
                            <div className="h-7 rounded-2xl bg-lime-100" />
                            <div className="h-7 rounded-2xl bg-emerald-100" />
                            <div className="h-7 rounded-2xl bg-slate-100" />
                        </div>
                    </div>
                </div>
            );
    }
}

function buttonToneClass(tone: WorkspaceHeroAction["tone"]) {
    if (tone === "primary") return "btn btn-primary text-xs";
    if (tone === "secondary") return "btn btn-secondary text-xs";
    return "btn btn-ghost text-xs";
}

export function StudioWorkspaceHero({
    theme,
    eyebrow,
    title,
    description,
    highlights,
    actions,
    compact = false,
    helperText,
}: StudioWorkspaceHeroProps) {
    const styles = HERO_THEME_STYLES[theme];

    return (
        <section
            className={`relative overflow-hidden rounded-[34px] border ${styles.borderTone} bg-gradient-to-br ${styles.shellGradient} shadow-[0_28px_80px_-40px_rgba(15,23,42,0.34)] ${compact ? "mb-4 px-4 py-4 md:px-5" : "mb-5 px-5 py-5 md:px-6 md:py-6"}`}
        >
            <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(255,255,255,0.35),rgba(255,255,255,0.08))]" />
            <div className={`absolute -left-10 top-12 h-40 w-40 rounded-full blur-3xl ${styles.glowPrimary}`} />
            <div className={`absolute bottom-0 right-0 h-40 w-40 rounded-full blur-3xl ${styles.glowSecondary}`} />

            <div className={`relative grid gap-5 ${compact ? "xl:grid-cols-[minmax(0,1.2fr)_280px]" : "xl:grid-cols-[minmax(0,1.05fr)_340px]"} xl:items-center`}>
                <div className="space-y-4">
                    <div>
                        <span className="eyebrow">{eyebrow}</span>
                        <h1 className={`${compact ? "mt-2 text-[1.75rem]" : "heading-xl mt-3"} font-extrabold tracking-tight text-slate-950`}>
                            {title}
                        </h1>
                        <p className="mt-2 max-w-3xl text-sm leading-relaxed text-slate-600">
                            {description}
                        </p>
                    </div>

                    <div className="flex flex-wrap gap-2">
                        {highlights.map((highlight) => (
                            <span
                                key={`${theme}-${highlight}`}
                                className="rounded-full border border-white/85 bg-white/80 px-3 py-1 text-[11px] font-semibold text-slate-600 shadow-[0_12px_30px_-24px_rgba(15,23,42,0.22)]"
                            >
                                {highlight}
                            </span>
                        ))}
                    </div>

                    <div className="flex flex-wrap gap-2">
                        {actions.map((action) => (
                            <Link key={`${theme}-${action.href}-${action.label}`} href={action.href} className={buttonToneClass(action.tone)}>
                                {action.label}
                            </Link>
                        ))}
                    </div>

                    {helperText && (
                        <p className="text-xs text-slate-500">
                            {helperText}
                        </p>
                    )}
                </div>

                <div className={`${compact ? "hidden lg:block" : "hidden xl:block"}`}>
                    <WorkspaceArt theme={theme} compact={compact} />
                </div>
            </div>
        </section>
    );
}
