export const PDF_TEMPLATE_IDS = [
    "professional",
    "classic",
    "minimal",
    "academic",
    "sleek",
    "agriculture",
    "simple",
    "board",
] as const;

export type PdfTemplateId = (typeof PDF_TEMPLATE_IDS)[number];

export type PdfTemplateConfig = {
    id: PdfTemplateId;
    name: string;
    palette: {
        pageBg: string;
        pageBgAlt: string;
        panelBg: string;
        panelBorder: string;
        accent: string;
        accentSoft: string;
        title: string;
        hindi: string;
        english: string;
        optionBg: string;
        optionBorder: string;
        optionLabel: string;
        footer: string;
    };
    watermarkOpacity: number;
};

export const PDF_TEMPLATES: Record<PdfTemplateId, PdfTemplateConfig> = {
    professional: {
        id: "professional",
        name: "Professional",
        palette: {
            pageBg: "#0A1328",
            pageBgAlt: "#122347",
            panelBg: "rgba(9, 18, 39, 0.86)",
            panelBorder: "rgba(148, 163, 184, 0.32)",
            accent: "#FBBF24",
            accentSoft: "rgba(251, 191, 36, 0.2)",
            title: "#F8FAFC",
            hindi: "#FDE68A",
            english: "#BAE6FD",
            optionBg: "rgba(15, 23, 42, 0.72)",
            optionBorder: "rgba(148, 163, 184, 0.35)",
            optionLabel: "#FBBF24",
            footer: "#CBD5E1",
        },
        watermarkOpacity: 0.09,
    },
    classic: {
        id: "classic",
        name: "Classic Professional",
        palette: {
            pageBg: "#0F172A",
            pageBgAlt: "#1E293B",
            panelBg: "rgba(15, 23, 42, 0.84)",
            panelBorder: "rgba(148, 163, 184, 0.33)",
            accent: "#F59E0B",
            accentSoft: "rgba(245, 158, 11, 0.2)",
            title: "#F8FAFC",
            hindi: "#FDE68A",
            english: "#E2E8F0",
            optionBg: "rgba(30, 41, 59, 0.65)",
            optionBorder: "rgba(148, 163, 184, 0.28)",
            optionLabel: "#FBBF24",
            footer: "#CBD5E1",
        },
        watermarkOpacity: 0.08,
    },
    minimal: {
        id: "minimal",
        name: "Minimal",
        palette: {
            pageBg: "#F8FAFC",
            pageBgAlt: "#EEF2F7",
            panelBg: "rgba(255, 255, 255, 0.92)",
            panelBorder: "rgba(148, 163, 184, 0.3)",
            accent: "#2563EB",
            accentSoft: "rgba(37, 99, 235, 0.15)",
            title: "#0F172A",
            hindi: "#0F172A",
            english: "#334155",
            optionBg: "rgba(255, 255, 255, 0.92)",
            optionBorder: "rgba(148, 163, 184, 0.32)",
            optionLabel: "#1D4ED8",
            footer: "#475569",
        },
        watermarkOpacity: 0.05,
    },
    academic: {
        id: "academic",
        name: "Academic",
        palette: {
            pageBg: "#F8F5EE",
            pageBgAlt: "#F2EDE2",
            panelBg: "rgba(255, 255, 255, 0.89)",
            panelBorder: "rgba(146, 120, 89, 0.34)",
            accent: "#92400E",
            accentSoft: "rgba(146, 64, 14, 0.14)",
            title: "#3F2C19",
            hindi: "#3F2C19",
            english: "#5A4127",
            optionBg: "rgba(255, 251, 245, 0.84)",
            optionBorder: "rgba(146, 120, 89, 0.25)",
            optionLabel: "#92400E",
            footer: "#6B4F35",
        },
        watermarkOpacity: 0.06,
    },
    sleek: {
        id: "sleek",
        name: "Sleek",
        palette: {
            pageBg: "#070B13",
            pageBgAlt: "#111827",
            panelBg: "rgba(8, 12, 22, 0.84)",
            panelBorder: "rgba(125, 211, 252, 0.24)",
            accent: "#38BDF8",
            accentSoft: "rgba(56, 189, 248, 0.2)",
            title: "#F8FAFC",
            hindi: "#A7F3D0",
            english: "#E2E8F0",
            optionBg: "rgba(15, 23, 42, 0.68)",
            optionBorder: "rgba(56, 189, 248, 0.24)",
            optionLabel: "#38BDF8",
            footer: "#94A3B8",
        },
        watermarkOpacity: 0.07,
    },
    agriculture: {
        id: "agriculture",
        name: "Agriculture",
        palette: {
            pageBg: "#F2F7F2",
            pageBgAlt: "#E4F0E4",
            panelBg: "rgba(255, 255, 255, 0.9)",
            panelBorder: "rgba(34, 84, 61, 0.28)",
            accent: "#166534",
            accentSoft: "rgba(22, 101, 52, 0.13)",
            title: "#163527",
            hindi: "#163527",
            english: "#24533C",
            optionBg: "rgba(240, 253, 244, 0.84)",
            optionBorder: "rgba(34, 84, 61, 0.2)",
            optionLabel: "#166534",
            footer: "#24533C",
        },
        watermarkOpacity: 0.05,
    },
    simple: {
        id: "simple",
        name: "Simple Authentic",
        palette: {
            pageBg: "transparent",
            pageBgAlt: "transparent",
            panelBg: "transparent",
            panelBorder: "transparent",
            accent: "#FFFFFF",
            accentSoft: "transparent",
            title: "#FFFFFF",
            hindi: "#FFFFFF",
            english: "#FFFFFF",
            optionBg: "transparent",
            optionBorder: "transparent",
            optionLabel: "#FBBF24",
            footer: "#FFFFFF",
        },
        watermarkOpacity: 0.08,
    },
    board: {
        id: "board",
        name: "Green Board",
        palette: {
            pageBg: "transparent",
            pageBgAlt: "transparent",
            panelBg: "transparent",
            panelBorder: "transparent",
            accent: "#FACC15",
            accentSoft: "transparent",
            title: "#FFFFFF",
            hindi: "#FACC15",
            english: "#FDE68A",
            optionBg: "transparent",
            optionBorder: "rgba(250, 204, 21, 0.12)",
            optionLabel: "#FFFFFF",
            footer: "#FEF3C7",
        },
        watermarkOpacity: 0.06,
    },
};

export function resolvePdfTemplate(templateId: string | null | undefined): PdfTemplateConfig {
    if (!templateId) return PDF_TEMPLATES.professional;
    const typed = templateId as PdfTemplateId;
    return PDF_TEMPLATES[typed] || PDF_TEMPLATES.professional;
}
