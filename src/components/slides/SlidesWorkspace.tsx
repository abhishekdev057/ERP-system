"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
    ArrowUpRight,
    BookImage,
    BookOpen,
    Brush,
    ChevronLeft,
    ChevronRight,
    Download,
    FileImage,
    FileStack,
    LoaderCircle,
    Palette,
    Plus,
    RefreshCcw,
    Search,
    Sparkles,
    SwatchBook,
    Upload,
    Wand2,
} from "lucide-react";
import toast from "react-hot-toast";
import { StudioWorkspaceHero } from "@/components/content-studio/StudioWorkspaceHero";
import {
    PDF_TEMPLATE_IDS,
    PDF_TEMPLATES,
    type CustomPdfTemplateConfig,
    type PdfTemplateId,
    getPdfTemplateEntries,
} from "@/lib/pdf-templates";
import { downloadBlobAsFile, formatDateTime } from "@/lib/utils";
import type { MatchColumns, PreviewResolution, Question } from "@/types/pdf";

type WorkspaceStats = {
    pageCount: number;
    questionCount: number;
    extractedPageCount: number;
    pendingPageCount: number;
    extractionState: "not_started" | "partial" | "extracted";
};

type SlidesDocumentRecord = {
    id: string;
    title: string;
    subject: string;
    date: string;
    createdAt: string;
    updatedAt: string;
    workspaceType?: "IMAGE_TO_PDF" | "JSON_TO_PDF" | "PDF_TO_PDF";
    correctionMarkCount?: number;
    workspaceStats?: WorkspaceStats;
};

type SlidesDocumentDetail = {
    id: string;
    title: string;
    subject: string;
    date: string;
    createdAt: string;
    updatedAt: string;
    jsonData: Record<string, unknown>;
};

type SlidesDocumentResponse = {
    documents: SlidesDocumentRecord[];
    pagination: {
        total: number;
        limit: number;
        offset: number;
        page: number;
        totalPages: number;
        hasMore: boolean;
    };
};

type OutputLanguageMode = "english" | "hindi" | "both";

type SavedSlidesTemplate = CustomPdfTemplateConfig & {
    id: string;
    note?: string;
    createdAt: string;
    updatedAt: string;
};

type TemplateChoice = {
    id: string;
    source: "builtin" | "custom";
    title: string;
    subtitle: string;
    badge: string;
    config: CustomPdfTemplateConfig;
    note?: string;
};

type VisualIdea = {
    id: string;
    prompt: string;
    assetUrl?: string;
    createdAt: string;
    note?: string;
};

const DOCUMENTS_PAGE_SIZE = 12;
const CUSTOM_TEMPLATE_STORAGE_KEY = "slides-workspace-custom-templates-v1";
const VISUAL_IDEA_STORAGE_KEY = "slides-workspace-visual-ideas-v1";
const PREVIEW_RESOLUTION: PreviewResolution = "1920x1080";

function createId() {
    return `${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

function formatRelativeCount(value: number, singular: string, plural?: string) {
    return `${value} ${value === 1 ? singular : plural || `${singular}s`}`;
}

function buildCustomTemplate(baseTemplateId: PdfTemplateId, name?: string): CustomPdfTemplateConfig {
    const base = PDF_TEMPLATES[baseTemplateId];
    return {
        name: name || `${base.name} Studio`,
        baseTemplateId,
        palette: {
            ...base.palette,
        },
        watermarkOpacity: base.watermarkOpacity,
    };
}

function readStoredTemplates(): SavedSlidesTemplate[] {
    if (typeof window === "undefined") return [];
    try {
        const raw = window.localStorage.getItem(CUSTOM_TEMPLATE_STORAGE_KEY);
        if (!raw) return [];
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
}

function writeStoredTemplates(value: SavedSlidesTemplate[]) {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(CUSTOM_TEMPLATE_STORAGE_KEY, JSON.stringify(value));
}

function readStoredVisualIdeas(): VisualIdea[] {
    if (typeof window === "undefined") return [];
    try {
        const raw = window.localStorage.getItem(VISUAL_IDEA_STORAGE_KEY);
        if (!raw) return [];
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
}

function writeStoredVisualIdeas(value: VisualIdea[]) {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(VISUAL_IDEA_STORAGE_KEY, JSON.stringify(value.slice(0, 12)));
}

function getDocumentQuestions(document: SlidesDocumentDetail | null): Array<Record<string, unknown>> {
    if (!document || typeof document.jsonData !== "object" || !document.jsonData) return [];
    const rawQuestions = (document.jsonData as { questions?: unknown }).questions;
    return Array.isArray(rawQuestions) ? rawQuestions.filter((item): item is Record<string, unknown> => !!item && typeof item === "object") : [];
}

function templateTone(templateId: PdfTemplateId) {
    switch (templateId) {
        case "board":
            return "from-emerald-100 via-emerald-50 to-lime-50";
        case "simple":
            return "from-slate-200 via-slate-50 to-white";
        case "sleek":
            return "from-sky-100 via-white to-indigo-50";
        case "academic":
            return "from-amber-50 via-white to-orange-50";
        case "agriculture":
            return "from-lime-50 via-white to-emerald-50";
        default:
            return "from-slate-100 via-white to-blue-50";
    }
}

function getLayoutFamilyLabel(templateId: PdfTemplateId) {
    return PDF_TEMPLATES[templateId]?.name || templateId;
}

function statusTone(state: WorkspaceStats["extractionState"] | undefined) {
    if (state === "extracted") return "bg-emerald-50 text-emerald-700 border-emerald-200";
    if (state === "partial") return "bg-amber-50 text-amber-700 border-amber-200";
    return "bg-slate-100 text-slate-600 border-slate-200";
}

function isPdfTemplateIdValue(value: string): value is PdfTemplateId {
    return PDF_TEMPLATE_IDS.includes(value as PdfTemplateId);
}

function normalizeOutputLanguageMode(value: unknown): OutputLanguageMode {
    return value === "english" || value === "hindi" || value === "both" ? value : "both";
}

function inferSlidesOutputLanguageMode(document: SlidesDocumentDetail | null): OutputLanguageMode {
    if (!document?.jsonData || typeof document.jsonData !== "object") return "both";

    const explicitMode = normalizeOutputLanguageMode(
        (document.jsonData as { outputLanguageMode?: unknown }).outputLanguageMode
    );
    if (explicitMode !== "both") {
        return explicitMode;
    }

    const sourceImages = Array.isArray((document.jsonData as { sourceImages?: unknown }).sourceImages)
        ? ((document.jsonData as { sourceImages?: Array<{ imageName?: unknown }> }).sourceImages ?? [])
        : [];

    const haystack = [
        document.title,
        document.subject,
        ...sourceImages.map((entry) =>
            typeof entry?.imageName === "string" ? entry.imageName : ""
        ),
    ]
        .join(" ")
        .toLowerCase();

    if (haystack.includes("hindi") && !haystack.includes("english")) {
        return "hindi";
    }

    if (haystack.includes("english") && !haystack.includes("hindi")) {
        return "english";
    }

    return "both";
}

function localizeMatchColumns(
    matchColumns: Question["matchColumns"],
    preferEnglish: boolean
): MatchColumns | undefined {
    if (!matchColumns) return undefined;

    return {
        left: matchColumns.left.map((entry) => ({
            english: preferEnglish ? String(entry.english || entry.hindi || "").trim() : "",
            hindi: preferEnglish ? "" : String(entry.hindi || entry.english || "").trim(),
        })),
        right: matchColumns.right.map((entry) => ({
            english: preferEnglish ? String(entry.english || entry.hindi || "").trim() : "",
            hindi: preferEnglish ? "" : String(entry.hindi || entry.english || "").trim(),
        })),
    };
}

function inferSlidesLineLanguage(line: string): "hindi" | "english" | "neutral" {
    const devanagariCount = (line.match(/[\u0900-\u097F]/g) || []).length;
    const latinCount = (line.match(/[A-Za-z]/g) || []).length;

    if (devanagariCount >= 2 && devanagariCount >= latinCount) {
        return "hindi";
    }

    if (latinCount >= 2 && latinCount > devanagariCount) {
        return "english";
    }

    return "neutral";
}

function pruneTextBlockForLanguage(
    value: string | undefined | null,
    outputLanguageMode: OutputLanguageMode
): string {
    const normalized = String(value || "")
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);

    if (outputLanguageMode === "both") {
        return normalized.join("\n");
    }

    const nextLines = normalized.filter((line) => {
        const dominant = inferSlidesLineLanguage(line);
        if (outputLanguageMode === "hindi") {
            return dominant !== "english";
        }
        return dominant !== "hindi";
    });

    return nextLines.join("\n").trim();
}

function pickLocalizedPrimaryText(
    primaryValue: string | undefined | null,
    fallbackValue: string | undefined | null,
    outputLanguageMode: Exclude<OutputLanguageMode, "both">
): string {
    const primary = String(primaryValue || "").trim();
    if (primary) {
        return primary;
    }

    return pruneTextBlockForLanguage(fallbackValue || "", outputLanguageMode);
}

function applyLanguageModeToSlidesQuestion(
    question: Question,
    outputLanguageMode: OutputLanguageMode
): Question {
    if (outputLanguageMode === "both") {
        return question;
    }

    const preferEnglish = outputLanguageMode === "english";
    const localizedQuestionPrimary = preferEnglish
        ? pickLocalizedPrimaryText(question.questionEnglish, question.questionHindi, "english")
        : pickLocalizedPrimaryText(question.questionHindi, question.questionEnglish, "hindi");
    const localizedSolutionPrimary = preferEnglish
        ? pickLocalizedPrimaryText(question.solutionEnglish || question.solution, question.solutionHindi, "english")
        : pickLocalizedPrimaryText(question.solutionHindi || question.solution, question.solutionEnglish, "hindi");

    return {
        ...question,
        questionEnglish: preferEnglish ? localizedQuestionPrimary : "",
        questionHindi: preferEnglish ? "" : localizedQuestionPrimary,
        solutionEnglish: preferEnglish ? localizedSolutionPrimary || undefined : undefined,
        solutionHindi: preferEnglish ? undefined : localizedSolutionPrimary || undefined,
        solution: localizedSolutionPrimary || question.solution,
        diagramCaptionEnglish: preferEnglish
            ? pickLocalizedPrimaryText(question.diagramCaptionEnglish, question.diagramCaptionHindi, "english") ||
              undefined
            : undefined,
        diagramCaptionHindi: preferEnglish
            ? undefined
            : pickLocalizedPrimaryText(question.diagramCaptionHindi, question.diagramCaptionEnglish, "hindi") ||
              undefined,
        options: (question.options || []).map((option) => ({
            english: preferEnglish ? pickLocalizedPrimaryText(option.english, option.hindi, "english") : "",
            hindi: preferEnglish ? "" : pickLocalizedPrimaryText(option.hindi, option.english, "hindi"),
        })),
        matchColumns: localizeMatchColumns(question.matchColumns, preferEnglish),
    };
}

export function SlidesWorkspace() {
    const [documents, setDocuments] = useState<SlidesDocumentRecord[]>([]);
    const [pagination, setPagination] = useState<SlidesDocumentResponse["pagination"]>({
        total: 0,
        limit: DOCUMENTS_PAGE_SIZE,
        offset: 0,
        page: 1,
        totalPages: 1,
        hasMore: false,
    });
    const [searchInput, setSearchInput] = useState("");
    const [appliedQuery, setAppliedQuery] = useState("");
    const [documentsLoading, setDocumentsLoading] = useState(true);
    const [selectedDocumentId, setSelectedDocumentId] = useState<string | null>(null);
    const [selectedDocument, setSelectedDocument] = useState<SlidesDocumentDetail | null>(null);
    const [documentLoading, setDocumentLoading] = useState(false);
    const [customTemplates, setCustomTemplates] = useState<SavedSlidesTemplate[]>([]);
    const [selectedTemplateId, setSelectedTemplateId] = useState("builtin:board");
    const [templateDraft, setTemplateDraft] = useState<CustomPdfTemplateConfig>(buildCustomTemplate("board", "Green Board Studio"));
    const [templateNote, setTemplateNote] = useState("");
    const [previewUrl, setPreviewUrl] = useState<string | null>(null);
    const [previewBlob, setPreviewBlob] = useState<Blob | null>(null);
    const [previewSignature, setPreviewSignature] = useState<string>("");
    const [previewLoading, setPreviewLoading] = useState(false);
    const [previewGeneratedAt, setPreviewGeneratedAt] = useState<string | null>(null);
    const [visualPrompt, setVisualPrompt] = useState("");
    const [visualReferenceFile, setVisualReferenceFile] = useState<File | null>(null);
    const [visualGenerating, setVisualGenerating] = useState(false);
    const [visualIdeas, setVisualIdeas] = useState<VisualIdea[]>([]);

    useEffect(() => {
        setCustomTemplates(readStoredTemplates());
        setVisualIdeas(readStoredVisualIdeas());
    }, []);

    useEffect(() => {
        return () => {
            if (previewUrl) {
                window.URL.revokeObjectURL(previewUrl);
            }
        };
    }, [previewUrl]);

    useEffect(() => {
        let cancelled = false;

        const run = async () => {
            setDocumentsLoading(true);
            try {
                const params = new URLSearchParams({
                    minimal: "true",
                    workspaceStats: "true",
                    limit: String(DOCUMENTS_PAGE_SIZE),
                    offset: String((pagination.page - 1) * DOCUMENTS_PAGE_SIZE),
                    sortBy: "updatedAt",
                    sortOrder: "desc",
                });
                if (appliedQuery.trim()) params.set("q", appliedQuery.trim());

                const response = await fetch(`/api/documents?${params.toString()}`, { cache: "no-store" });
                const data = (await response.json()) as SlidesDocumentResponse;
                if (!response.ok) {
                    throw new Error((data as { error?: string }).error || "Failed to load slide documents.");
                }
                if (cancelled) return;

                setDocuments(data.documents || []);
                setPagination((previous) => ({
                    ...data.pagination,
                    page: data.pagination?.page || previous.page,
                }));

                const candidateId =
                    selectedDocumentId && data.documents.some((document) => document.id === selectedDocumentId)
                        ? selectedDocumentId
                        : data.documents[0]?.id || null;
                setSelectedDocumentId(candidateId);
            } catch (error) {
                console.error(error);
                if (!cancelled) {
                    toast.error(error instanceof Error ? error.message : "Failed to load slide documents.");
                    setDocuments([]);
                }
            } finally {
                if (!cancelled) {
                    setDocumentsLoading(false);
                }
            }
        };

        run();

        return () => {
            cancelled = true;
        };
    }, [appliedQuery, pagination.page, selectedDocumentId]);

    useEffect(() => {
        if (!selectedDocumentId) {
            setSelectedDocument(null);
            return;
        }

        let cancelled = false;
        const run = async () => {
            setDocumentLoading(true);
            try {
                const response = await fetch(`/api/documents/${selectedDocumentId}`, {
                    method: "GET",
                    cache: "no-store",
                });
                const data = await response.json();
                if (!response.ok) {
                    throw new Error(data.error || "Failed to load slide document.");
                }
                if (!cancelled) {
                    setSelectedDocument(data.document || null);
                }
            } catch (error) {
                console.error(error);
                if (!cancelled) {
                    toast.error(error instanceof Error ? error.message : "Failed to load selected document.");
                    setSelectedDocument(null);
                }
            } finally {
                if (!cancelled) {
                    setDocumentLoading(false);
                }
            }
        };

        run();
        return () => {
            cancelled = true;
        };
    }, [selectedDocumentId]);

    const templateChoices = useMemo<TemplateChoice[]>(() => {
        const builtIns = getPdfTemplateEntries().map((template) => ({
            id: `builtin:${template.id}`,
            source: "builtin" as const,
            title: template.name,
            subtitle: `Theme preset · Layout: ${getLayoutFamilyLabel(template.id)}`,
            badge: "Built-in Theme",
            config: buildCustomTemplate(template.id, template.name),
        }));

        const custom = customTemplates.map((template) => ({
            id: `custom:${template.id}`,
            source: "custom" as const,
            title: template.name,
            subtitle: `Custom theme · Layout: ${getLayoutFamilyLabel(template.baseTemplateId)}`,
            badge: "Saved Theme",
            config: {
                name: template.name,
                baseTemplateId: template.baseTemplateId,
                palette: {
                    ...template.palette,
                },
                watermarkOpacity: template.watermarkOpacity,
            },
            note: template.note,
        }));

        return [...custom, ...builtIns];
    }, [customTemplates]);

    useEffect(() => {
        const activeTemplate = templateChoices.find((template) => template.id === selectedTemplateId);
        if (!activeTemplate) return;
        setTemplateDraft({
            name: activeTemplate.config.name,
            baseTemplateId: activeTemplate.config.baseTemplateId,
            palette: {
                ...activeTemplate.config.palette,
            },
            watermarkOpacity: activeTemplate.config.watermarkOpacity,
        });
        setTemplateNote(activeTemplate.note || "");
    }, [selectedTemplateId, templateChoices]);

    const selectedDocumentCard = useMemo(
        () => documents.find((document) => document.id === selectedDocumentId) || null,
        [documents, selectedDocumentId]
    );

    const activeQuestionCount = useMemo(() => getDocumentQuestions(selectedDocument).length, [selectedDocument]);
    const outputLanguageMode = useMemo(
        () => inferSlidesOutputLanguageMode(selectedDocument),
        [selectedDocument]
    );

    const previewPayload = useMemo(() => {
        if (!selectedDocument?.jsonData) return null;
        const rawPayload = selectedDocument.jsonData as Record<string, unknown>;
        const rawQuestions = Array.isArray(rawPayload.questions) ? rawPayload.questions : [];
        const localizedQuestions = rawQuestions.map((question) =>
            applyLanguageModeToSlidesQuestion(question as Question, outputLanguageMode)
        );

        return {
            ...rawPayload,
            title: selectedDocument.title,
            subject: selectedDocument.subject,
            date: selectedDocument.date,
            includeAnswers: false,
            outputLanguageMode,
            optionDisplayOrder: outputLanguageMode === "english" ? "english-first" : "hindi-first",
            questions: localizedQuestions,
            templateId: templateDraft.baseTemplateId,
            customTemplate: templateDraft,
            previewResolution: PREVIEW_RESOLUTION,
        };
    }, [outputLanguageMode, selectedDocument, templateDraft]);

    const currentPreviewSignature = useMemo(
        () => JSON.stringify([selectedDocument?.id || null, templateDraft, PREVIEW_RESOLUTION, outputLanguageMode]),
        [selectedDocument?.id, templateDraft, outputLanguageMode]
    );

    const statsSummary = useMemo(() => {
        return {
            totalDocuments: pagination.total,
            totalPages: documents.reduce((sum, document) => sum + Number(document.workspaceStats?.pageCount || 0), 0),
            totalQuestions: documents.reduce((sum, document) => sum + Number(document.workspaceStats?.questionCount || 0), 0),
            totalTemplates: templateChoices.length,
        };
    }, [documents, pagination.total, templateChoices.length]);

    const canPreview = Boolean(previewPayload);
    const previewStale = Boolean(previewUrl && previewSignature !== currentPreviewSignature);

    const applyTemplateBase = (baseTemplateId: PdfTemplateId) => {
        const template = PDF_TEMPLATES[baseTemplateId];
        setTemplateDraft({
            name: templateDraft.name || `${template.name} Studio`,
            baseTemplateId,
            palette: {
                ...template.palette,
                ...templateDraft.palette,
            },
            watermarkOpacity: templateDraft.watermarkOpacity ?? template.watermarkOpacity,
        });
    };

    const updatePaletteValue = (key: keyof CustomPdfTemplateConfig["palette"], value: string) => {
        setTemplateDraft((previous) => ({
            ...previous,
            palette: {
                ...previous.palette,
                [key]: value,
            },
        }));
    };

    const setPreviewObjectUrl = (blob: Blob | null) => {
        setPreviewUrl((previous) => {
            if (previous) {
                window.URL.revokeObjectURL(previous);
            }
            return blob ? window.URL.createObjectURL(blob) : null;
        });
    };

    const runPreviewRequest = async (mode: "preview" | "download") => {
        if (!previewPayload || !selectedDocument) {
            toast.error("Select a document first.");
            return;
        }

        if (mode === "download" && previewBlob && previewSignature === currentPreviewSignature) {
            downloadBlobAsFile(previewBlob, `${selectedDocument.title}-slides.pdf`);
            return;
        }

        setPreviewLoading(true);
        try {
            const response = await fetch("/api/generate", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({
                    ...previewPayload,
                    shouldSave: false,
                }),
            });

            if (!response.ok) {
                const errorPayload = await response.json().catch(() => ({}));
                throw new Error(errorPayload.error || errorPayload.details || "Failed to render slide preview.");
            }

            const blob = await response.blob();
            setPreviewBlob(blob);
            setPreviewSignature(currentPreviewSignature);
            setPreviewGeneratedAt(new Date().toISOString());
            setPreviewObjectUrl(blob);

            if (mode === "download") {
                downloadBlobAsFile(blob, `${selectedDocument.title}-slides.pdf`);
            } else {
                toast.success("Slide preview is ready.");
            }
        } catch (error) {
            console.error(error);
            toast.error(error instanceof Error ? error.message : "Failed to render slide preview.");
        } finally {
            setPreviewLoading(false);
        }
    };

    const saveCurrentTemplate = () => {
        const timestamp = new Date().toISOString();
        const activeCustomTemplateId = selectedTemplateId.startsWith("custom:")
            ? selectedTemplateId.slice("custom:".length)
            : null;

        const nextTemplate: SavedSlidesTemplate = {
            id: activeCustomTemplateId || createId(),
            name: templateDraft.name.trim() || "Studio Template",
            baseTemplateId: templateDraft.baseTemplateId,
            palette: {
                ...templateDraft.palette,
            },
            watermarkOpacity: templateDraft.watermarkOpacity,
            note: templateNote.trim() || undefined,
            createdAt: activeCustomTemplateId
                ? customTemplates.find((template) => template.id === activeCustomTemplateId)?.createdAt || timestamp
                : timestamp,
            updatedAt: timestamp,
        };

        const nextTemplates = [
            nextTemplate,
            ...customTemplates.filter((template) => template.id !== nextTemplate.id),
        ].slice(0, 16);

        setCustomTemplates(nextTemplates);
        writeStoredTemplates(nextTemplates);
        setSelectedTemplateId(`custom:${nextTemplate.id}`);
        toast.success("Slide template saved.");
    };

    const deleteCurrentTemplate = () => {
        if (!selectedTemplateId.startsWith("custom:")) return;
        const templateId = selectedTemplateId.slice("custom:".length);
        const nextTemplates = customTemplates.filter((template) => template.id !== templateId);
        setCustomTemplates(nextTemplates);
        writeStoredTemplates(nextTemplates);
        setSelectedTemplateId("builtin:board");
        toast.success("Custom template removed.");
    };

    const handleGenerateVisual = async () => {
        const prompt = visualPrompt.trim();
        if (!prompt) {
            toast.error("Design brief likho pehle.");
            return;
        }

        setVisualGenerating(true);
        try {
            const formData = new FormData();
            formData.append("mode", visualReferenceFile ? "image_from_reference" : "text_to_image");
            formData.append("prompt", prompt);
            formData.append("imageModel", "nano_banana");
            if (visualReferenceFile) {
                formData.append("referenceFile", visualReferenceFile);
                formData.append("referenceName", visualReferenceFile.name);
            }

            const response = await fetch("/api/content-studio/media-generate", {
                method: "POST",
                body: formData,
            });

            const data = await response.json();
            if (!response.ok) {
                throw new Error(data.error || data.message || "Slide visual generate nahi ho paya.");
            }

            const nextIdea: VisualIdea = {
                id: data.id || createId(),
                prompt,
                assetUrl: data.assetUrl,
                note: data.note,
                createdAt: data.createdAt || new Date().toISOString(),
            };
            const nextIdeas = [nextIdea, ...visualIdeas].slice(0, 12);
            setVisualIdeas(nextIdeas);
            writeStoredVisualIdeas(nextIdeas);
            toast.success("AI slide visual ready.");
        } catch (error) {
            console.error(error);
            toast.error(error instanceof Error ? error.message : "Slide visual generate nahi hua.");
        } finally {
            setVisualGenerating(false);
        }
    };

    const builtinTemplateCount = PDF_TEMPLATE_IDS.length;

    return (
        <div className="page-container" style={{ width: "min(1580px, calc(100% - 2rem))" }}>
            <StudioWorkspaceHero
                theme="slides"
                eyebrow="Institute Suite · Slides"
                title="Slides Workspace"
                description="Load your structured documents, style them into richer slide decks, preview them in HD, and run a small AI design lab for visual direction without leaving the studio."
                highlights={["Document slide hub", "Custom slide templates", "Preview + download PDF", "Question + topic visualization"]}
                actions={[
                    { href: "/content-studio", label: "Tool Hub", tone: "secondary" },
                    { href: "/content-studio/extractor", label: "Question Extractor", tone: "ghost" },
                    { href: selectedDocumentId ? `/content-studio/slides/visualize?documentId=${selectedDocumentId}` : "/content-studio/slides/visualize", label: "Visualize Slides", tone: "ghost" },
                    { href: "/content-studio/media", label: "Media Studio", tone: "ghost" },
                ]}
                helperText="Slides uses the same PDF engine as Extractor, but gives you a dedicated deck management surface to load documents, tune themes, preview, and deliver."
            />

            <section className="mb-5 grid gap-4 xl:grid-cols-[minmax(0,0.92fr)_minmax(0,1.08fr)]">
                <div className="rounded-[30px] border border-slate-200 bg-[linear-gradient(180deg,#fff,rgba(248,250,252,0.98))] p-5 shadow-[0_28px_80px_-48px_rgba(15,23,42,0.26)]">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                            <span className="eyebrow">Slides Command Deck</span>
                            <h2 className="mt-2 text-2xl font-bold tracking-tight text-slate-950">Document-to-slides manager</h2>
                            <p className="mt-2 max-w-2xl text-sm leading-relaxed text-slate-600">
                                Choose any saved extractor document, apply a built-in or custom slide theme, preview in HD, and export the deck straight from here.
                            </p>
                        </div>
                        <div className="rounded-[26px] border border-sky-100 bg-[linear-gradient(180deg,#eff6ff,#fff)] px-4 py-3 text-right shadow-[0_18px_50px_-38px_rgba(59,130,246,0.35)]">
                            <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-sky-600">Active Studio</p>
                            <p className="mt-2 text-xl font-bold text-slate-900">{statsSummary.totalDocuments}</p>
                            <p className="text-xs text-slate-500">slide-ready documents</p>
                        </div>
                    </div>

                    <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                        {[
                            {
                                label: "Documents",
                                value: statsSummary.totalDocuments,
                                detail: "Loaded from your saved extractor decks.",
                                icon: FileStack,
                            },
                            {
                                label: "Pages",
                                value: statsSummary.totalPages,
                                detail: "Source pages represented in the current browser.",
                                icon: BookOpen,
                            },
                            {
                                label: "Questions",
                                value: statsSummary.totalQuestions,
                                detail: "Structured questions available, with topic-note visuals handled in the visualizer.",
                                icon: Sparkles,
                            },
                            {
                                label: "Templates",
                                value: templateChoices.length,
                                detail: `${builtinTemplateCount} built-in + ${customTemplates.length} saved custom themes.`,
                                icon: SwatchBook,
                            },
                        ].map((stat) => {
                            const Icon = stat.icon;
                            return (
                                <div key={stat.label} className="rounded-[24px] border border-slate-200 bg-white p-4 shadow-[0_18px_50px_-40px_rgba(15,23,42,0.28)]">
                                    <div className="flex items-center justify-between">
                                        <span className="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-500">{stat.label}</span>
                                        <Icon className="h-4 w-4 text-sky-500" />
                                    </div>
                                    <p className="mt-3 text-[1.85rem] font-bold tracking-tight text-slate-950">{stat.value}</p>
                                    <p className="mt-1 text-xs leading-relaxed text-slate-500">{stat.detail}</p>
                                </div>
                            );
                        })}
                    </div>
                </div>

                <div className="rounded-[30px] border border-slate-200 bg-[linear-gradient(180deg,#fff,rgba(248,250,252,0.98))] p-5 shadow-[0_28px_80px_-48px_rgba(15,23,42,0.26)]">
                    <div className="flex items-start justify-between gap-3">
                        <div>
                            <span className="eyebrow">Selected Deck</span>
                            <h3 className="mt-2 text-xl font-bold tracking-tight text-slate-950">
                                {selectedDocumentCard?.title || "Load a document from the left rail"}
                            </h3>
                            <p className="mt-2 text-sm leading-relaxed text-slate-600">
                                {selectedDocumentCard
                                    ? `${selectedDocumentCard.subject} · ${selectedDocumentCard.date}`
                                    : "Slides workspace works best with already-structured extractor documents. Choose one to start styling the deck."}
                            </p>
                        </div>
                        <div className="flex flex-wrap gap-2">
                            <button
                                type="button"
                                onClick={() => void runPreviewRequest("preview")}
                                disabled={!canPreview || previewLoading}
                                className="btn btn-secondary text-xs"
                            >
                                {previewLoading ? <LoaderCircle className="mr-2 h-4 w-4 animate-spin" /> : <MonitorPreviewIcon />}
                                Refresh Preview
                            </button>
                            <button
                                type="button"
                                onClick={() => void runPreviewRequest("download")}
                                disabled={!canPreview || previewLoading}
                                className="btn btn-primary text-xs"
                            >
                                <Download className="mr-2 h-4 w-4" />
                                Download PDF
                            </button>
                        </div>
                    </div>

                    <div className="mt-5 grid gap-3 md:grid-cols-4">
                        <MetricChip label="Workspace Type" value={selectedDocumentCard?.workspaceType || "Slides"} />
                        <MetricChip label="Pages" value={String(selectedDocumentCard?.workspaceStats?.pageCount || 0)} />
                        <MetricChip label="Questions" value={String(selectedDocumentCard?.workspaceStats?.questionCount || activeQuestionCount)} />
                        <MetricChip label="Marks" value={String(selectedDocumentCard?.correctionMarkCount || 0)} />
                    </div>

                    <div className="mt-5 rounded-[26px] border border-slate-200 bg-white p-4 shadow-[0_18px_50px_-42px_rgba(15,23,42,0.28)]">
                        <div className="flex flex-wrap items-center justify-between gap-3">
                            <div>
                                <p className="text-[11px] font-semibold uppercase tracking-[0.26em] text-slate-500">Current theme in play</p>
                                <h4 className="mt-2 text-lg font-bold text-slate-950">{templateDraft.name}</h4>
                                <p className="mt-1 text-sm text-slate-500">
                                    Layout family: {getLayoutFamilyLabel(templateDraft.baseTemplateId)}
                                </p>
                            </div>
                            <div className={`flex h-16 w-[180px] overflow-hidden rounded-[22px] border border-white/70 bg-gradient-to-br ${templateTone(templateDraft.baseTemplateId)} p-2 shadow-[0_18px_50px_-40px_rgba(15,23,42,0.3)]`}>
                                <div
                                    className="flex w-full flex-col rounded-[18px] border p-2"
                                    style={{
                                        background: templateDraft.palette.panelBg,
                                        borderColor: templateDraft.palette.panelBorder,
                                        color: templateDraft.palette.title,
                                    }}
                                >
                                    <div className="text-[10px] font-semibold uppercase tracking-[0.24em]" style={{ color: templateDraft.palette.accent }}>
                                        Slide theme
                                    </div>
                                    <div className="mt-2 grid flex-1 grid-cols-3 gap-2">
                                        <span className="rounded-full" style={{ background: templateDraft.palette.hindi }} />
                                        <span className="rounded-full" style={{ background: templateDraft.palette.english }} />
                                        <span className="rounded-full" style={{ background: templateDraft.palette.optionLabel }} />
                                    </div>
                                </div>
                            </div>
                        </div>

                        <div className="mt-4 flex flex-wrap gap-2">
                            <Link href={selectedDocumentId ? `/content-studio/extractor?load=${selectedDocumentId}` : "/content-studio/extractor"} className="btn btn-ghost text-xs">
                                Open In Extractor
                            </Link>
                            <Link
                                href={selectedDocumentId ? `/content-studio/slides/visualize?documentId=${selectedDocumentId}` : "/content-studio/slides/visualize"}
                                className="btn btn-secondary text-xs"
                            >
                                Visualize Slides
                            </Link>
                            <Link href="/content-studio/media" className="btn btn-ghost text-xs">
                                Open Media Studio
                            </Link>
                            {previewGeneratedAt && (
                                <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-[11px] font-medium text-slate-500">
                                    Preview ready · {formatDateTime(previewGeneratedAt)}
                                </span>
                            )}
                            {previewStale && (
                                <span className="rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-[11px] font-medium text-amber-700">
                                    Preview is out of date
                                </span>
                            )}
                        </div>
                    </div>
                </div>
            </section>

            <section className="grid items-start gap-5 xl:grid-cols-[320px_minmax(0,1.18fr)_400px]">
                <aside className="flex flex-col rounded-[30px] border border-slate-200 bg-[linear-gradient(180deg,#fff,rgba(248,250,252,0.98))] p-4 shadow-[0_28px_80px_-48px_rgba(15,23,42,0.26)] xl:max-h-[calc(100vh-180px)]">
                    <div className="flex items-center justify-between gap-2">
                        <div>
                            <span className="eyebrow">Slides Browser</span>
                            <h3 className="mt-2 text-lg font-bold text-slate-950">Load saved documents</h3>
                        </div>
                        <span className="rounded-full border border-slate-200 bg-white px-3 py-1 text-[11px] font-semibold text-slate-500">
                            {pagination.total} total
                        </span>
                    </div>

                    <div className="mt-4 flex gap-2">
                        <div className="relative flex-1">
                            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                            <input
                                value={searchInput}
                                onChange={(event) => setSearchInput(event.target.value)}
                                onKeyDown={(event) => {
                                    if (event.key === "Enter") {
                                        setPagination((previous) => ({ ...previous, page: 1 }));
                                        setAppliedQuery(searchInput.trim());
                                    }
                                }}
                                placeholder="Search title, subject, or deck..."
                                className="h-11 w-full rounded-2xl border border-slate-200 bg-white pl-10 pr-3 text-sm text-slate-700 outline-none transition focus:border-sky-300 focus:ring-4 focus:ring-sky-100"
                            />
                        </div>
                        <button
                            type="button"
                            onClick={() => {
                                setPagination((previous) => ({ ...previous, page: 1 }));
                                setAppliedQuery(searchInput.trim());
                            }}
                            className="btn btn-secondary text-xs"
                        >
                            Search
                        </button>
                    </div>

                    <div className="mt-4 flex-1 space-y-3 overflow-y-auto pr-1">
                        {documentsLoading ? (
                            <div className="flex min-h-[340px] items-center justify-center rounded-[24px] border border-dashed border-slate-200 bg-slate-50 text-sm text-slate-500">
                                <LoaderCircle className="mr-2 h-4 w-4 animate-spin" />
                                Loading slide documents...
                            </div>
                        ) : documents.length === 0 ? (
                            <div className="rounded-[24px] border border-dashed border-slate-200 bg-slate-50 p-5 text-sm text-slate-500">
                                No saved slide-ready documents मिले. Extractor me koi deck save karke yahan wapas aao.
                            </div>
                        ) : (
                            documents.map((document) => (
                                <button
                                    key={document.id}
                                    type="button"
                                    onClick={() => setSelectedDocumentId(document.id)}
                                    className={`w-full rounded-[24px] border p-4 text-left transition ${
                                        document.id === selectedDocumentId
                                            ? "border-sky-300 bg-[linear-gradient(180deg,#eff6ff,#fff)] shadow-[0_24px_60px_-42px_rgba(59,130,246,0.35)]"
                                            : "border-slate-200 bg-white hover:border-sky-200 hover:bg-slate-50"
                                    }`}
                                >
                                    <div className="flex items-start justify-between gap-3">
                                        <div className="min-w-0">
                                            <p className="text-sm font-semibold text-slate-900">{document.title}</p>
                                            <p className="mt-1 text-xs text-slate-500">
                                                {document.subject} · {document.date}
                                            </p>
                                        </div>
                                        <span className={`shrink-0 rounded-full border px-2 py-1 text-[10px] font-bold uppercase ${statusTone(document.workspaceStats?.extractionState)}`}>
                                            {document.workspaceStats?.extractionState || "ready"}
                                        </span>
                                    </div>

                                    <div className="mt-4 grid grid-cols-2 gap-2 text-[11px] text-slate-500">
                                        <div className="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2">
                                            <span className="block text-[10px] font-semibold uppercase tracking-[0.22em] text-slate-400">Pages</span>
                                            <span className="mt-1 block text-sm font-semibold text-slate-900">{document.workspaceStats?.pageCount || 0}</span>
                                        </div>
                                        <div className="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2">
                                            <span className="block text-[10px] font-semibold uppercase tracking-[0.22em] text-slate-400">Questions</span>
                                            <span className="mt-1 block text-sm font-semibold text-slate-900">{document.workspaceStats?.questionCount || 0}</span>
                                        </div>
                                    </div>

                                    <div className="mt-3 flex flex-wrap gap-2 text-[11px] text-slate-500">
                                        <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1">
                                            {document.workspaceType || "PDF_TO_PDF"}
                                        </span>
                                        <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1">
                                            {formatRelativeCount(document.correctionMarkCount || 0, "mark")}
                                        </span>
                                        <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1">
                                            Updated {formatDateTime(document.updatedAt)}
                                        </span>
                                    </div>
                                </button>
                            ))
                        )}
                    </div>

                    <div className="mt-4 flex items-center justify-between gap-3 rounded-[20px] border border-slate-200 bg-slate-50 px-3 py-2">
                        <button
                            type="button"
                            onClick={() => setPagination((previous) => ({ ...previous, page: Math.max(previous.page - 1, 1) }))}
                            disabled={pagination.page <= 1}
                            className="btn btn-ghost text-xs disabled:opacity-50"
                        >
                            <ChevronLeft className="mr-1 h-4 w-4" />
                            Prev
                        </button>
                        <span className="text-xs font-semibold text-slate-500">
                            Page {pagination.page} / {pagination.totalPages}
                        </span>
                        <button
                            type="button"
                            onClick={() =>
                                setPagination((previous) => ({
                                    ...previous,
                                    page: Math.min(previous.page + 1, pagination.totalPages),
                                }))
                            }
                            disabled={pagination.page >= pagination.totalPages}
                            className="btn btn-ghost text-xs disabled:opacity-50"
                        >
                            Next
                            <ChevronRight className="ml-1 h-4 w-4" />
                        </button>
                    </div>
                </aside>

                <section className="rounded-[30px] border border-slate-200 bg-[linear-gradient(180deg,#fff,rgba(248,250,252,0.98))] p-4 shadow-[0_28px_80px_-48px_rgba(15,23,42,0.26)]">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                        <div>
                            <span className="eyebrow">Slides Preview</span>
                            <h3 className="mt-2 text-lg font-bold text-slate-950">Preview and export lane</h3>
                            <p className="mt-1 text-sm text-slate-500">
                                Render the selected deck in 1920×1080 slide preview mode using the currently active template lab settings.
                            </p>
                        </div>
                        <div className="flex flex-wrap gap-2">
                            <button
                                type="button"
                                onClick={() => void runPreviewRequest("preview")}
                                disabled={!canPreview || previewLoading}
                                className="btn btn-secondary text-xs"
                            >
                                {previewLoading ? <LoaderCircle className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCcw className="mr-2 h-4 w-4" />}
                                Generate Preview
                            </button>
                            <button
                                type="button"
                                onClick={() => void runPreviewRequest("download")}
                                disabled={!canPreview || previewLoading}
                                className="btn btn-primary text-xs"
                            >
                                <Download className="mr-2 h-4 w-4" />
                                Download PDF
                            </button>
                        </div>
                    </div>

                    <div className="mt-4 rounded-[28px] border border-slate-200 bg-slate-950 p-3 shadow-[0_35px_90px_-48px_rgba(15,23,42,0.45)]">
                        <div className="mb-3 flex flex-wrap items-center justify-between gap-3 px-2">
                            <div className="flex flex-wrap gap-2">
                                <span className="rounded-full bg-white/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-200">
                                    HD Preview
                                </span>
                                <span className="rounded-full bg-white/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-200">
                                    {templateDraft.baseTemplateId}
                                </span>
                            </div>
                            <span className="text-xs text-slate-300">
                                {selectedDocument ? `${selectedDocument.title} · ${activeQuestionCount} questions` : "No document selected"}
                            </span>
                        </div>

                        <div className="overflow-hidden rounded-[22px] border border-white/10 bg-white">
                            {documentLoading ? (
                                <div className="flex h-[720px] items-center justify-center text-sm text-slate-500">
                                    <LoaderCircle className="mr-2 h-5 w-5 animate-spin" />
                                    Loading selected document...
                                </div>
                            ) : previewUrl ? (
                                <iframe
                                    title="Slides Preview PDF"
                                    src={previewUrl}
                                    className="h-[720px] w-full bg-white"
                                />
                            ) : (
                                <div className="flex h-[720px] flex-col items-center justify-center gap-3 bg-[radial-gradient(circle_at_top,_rgba(56,189,248,0.08),_transparent_42%),linear-gradient(180deg,#f8fafc,#eef2ff)] p-8 text-center">
                                    <div className="flex h-16 w-16 items-center justify-center rounded-[22px] bg-white shadow-[0_20px_50px_-34px_rgba(15,23,42,0.28)]">
                                        <BookImage className="h-8 w-8 text-sky-500" />
                                    </div>
                                    <div className="max-w-lg">
                                        <h4 className="text-xl font-bold text-slate-950">Render a live slide deck preview</h4>
                                        <p className="mt-2 text-sm leading-relaxed text-slate-500">
                                            Select a saved document, tune your slide template, then generate preview. The preview will use the exact same PDF engine as the live download.
                                        </p>
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                </section>

                <aside className="grid gap-5 xl:max-h-[calc(100vh-180px)] xl:grid-rows-[minmax(0,1.24fr)_minmax(0,0.9fr)]">
                    <div className="flex min-h-0 flex-col rounded-[30px] border border-slate-200 bg-[linear-gradient(180deg,#fff,rgba(248,250,252,0.98))] p-4 shadow-[0_28px_80px_-48px_rgba(15,23,42,0.26)]">
                        <div className="flex items-start justify-between gap-3">
                            <div>
                                <span className="eyebrow">Template Lab</span>
                                <h3 className="mt-2 text-lg font-bold text-slate-950">Create themes and choose layout</h3>
                                <p className="mt-1 text-sm text-slate-500">
                                    Layout family controls the slide structure. Theme controls colors, branding, and visual tone layered on top of that layout.
                                </p>
                            </div>
                            <button
                                type="button"
                                onClick={() => {
                                    setSelectedTemplateId("builtin:board");
                                    setTemplateDraft(buildCustomTemplate("board", "New Slide Template"));
                                    setTemplateNote("");
                                }}
                                className="btn btn-ghost text-xs"
                            >
                                <Plus className="mr-2 h-4 w-4" />
                                New
                            </button>
                        </div>

                        <div className="mt-4 max-h-[290px] space-y-3 overflow-y-auto pr-1">
                            {templateChoices.map((template) => (
                                <button
                                    key={template.id}
                                    type="button"
                                    onClick={() => setSelectedTemplateId(template.id)}
                                    className={`w-full rounded-[24px] border p-4 text-left transition ${
                                        template.id === selectedTemplateId
                                            ? "border-sky-300 bg-[linear-gradient(180deg,#eff6ff,#fff)] shadow-[0_24px_60px_-44px_rgba(59,130,246,0.35)]"
                                            : "border-slate-200 bg-white hover:border-sky-200 hover:bg-slate-50"
                                    }`}
                                >
                                    <div className="flex items-start justify-between gap-3">
                                        <div>
                                            <p className="text-sm font-semibold text-slate-900">{template.title}</p>
                                            <p className="mt-1 text-xs text-slate-500">{template.subtitle}</p>
                                        </div>
                                        <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.18em] text-slate-500">
                                            {template.badge}
                                        </span>
                                    </div>
                                    <div className="mt-4 grid grid-cols-4 gap-2">
                                        {[
                                            template.config.palette.pageBg,
                                            template.config.palette.accent,
                                            template.config.palette.hindi,
                                            template.config.palette.optionLabel,
                                        ].map((color) => (
                                            <span key={`${template.id}-${color}`} className="h-8 rounded-2xl border border-white/80" style={{ background: color }} />
                                        ))}
                                    </div>
                                </button>
                            ))}
                        </div>

                        <div className="mt-5 flex-1 space-y-4 overflow-y-auto rounded-[24px] border border-slate-200 bg-slate-50 p-4 pr-3">
                            <div className="grid gap-3 sm:grid-cols-2">
                                <label className="space-y-2 text-sm">
                                    <span className="font-semibold text-slate-700">Template name</span>
                                    <input
                                        value={templateDraft.name}
                                        onChange={(event) => setTemplateDraft((previous) => ({ ...previous, name: event.target.value }))}
                                        className="h-11 w-full rounded-2xl border border-slate-200 bg-white px-3 text-sm text-slate-700 outline-none transition focus:border-sky-300 focus:ring-4 focus:ring-sky-100"
                                    />
                                </label>
                                <label className="space-y-2 text-sm">
                                    <span className="font-semibold text-slate-700">Layout family</span>
                                    <select
                                        value={templateDraft.baseTemplateId}
                                        onChange={(event) => {
                                            if (isPdfTemplateIdValue(event.target.value)) {
                                                applyTemplateBase(event.target.value);
                                            }
                                        }}
                                        className="h-11 w-full rounded-2xl border border-slate-200 bg-white px-3 text-sm text-slate-700 outline-none transition focus:border-sky-300 focus:ring-4 focus:ring-sky-100"
                                    >
                                        {getPdfTemplateEntries().map((template) => (
                                            <option key={template.id} value={template.id}>
                                                {template.name}
                                            </option>
                                        ))}
                                    </select>
                                </label>
                            </div>

                            <div className="grid gap-3 sm:grid-cols-2">
                                {([
                                    ["pageBg", "Page Background"],
                                    ["panelBg", "Panel Background"],
                                    ["accent", "Accent"],
                                    ["title", "Title"],
                                    ["hindi", "Hindi Text"],
                                    ["english", "English Text"],
                                    ["optionLabel", "Option Label"],
                                    ["footer", "Footer"],
                                ] as Array<[keyof CustomPdfTemplateConfig["palette"], string]>).map(([key, label]) => (
                                    <label key={key} className="space-y-2 text-sm">
                                        <span className="font-semibold text-slate-700">{label}</span>
                                        <div className="flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-3 py-2">
                                            <input
                                                type="color"
                                                value={templateDraft.palette[key].startsWith("#") ? templateDraft.palette[key] : "#2563eb"}
                                                onChange={(event) => updatePaletteValue(key, event.target.value)}
                                                className="h-8 w-10 shrink-0 cursor-pointer rounded-xl border-0 bg-transparent"
                                            />
                                            <input
                                                value={templateDraft.palette[key]}
                                                onChange={(event) => updatePaletteValue(key, event.target.value)}
                                                className="w-full border-0 bg-transparent text-sm text-slate-700 outline-none"
                                            />
                                        </div>
                                    </label>
                                ))}
                            </div>

                            <label className="block space-y-2 text-sm">
                                <span className="font-semibold text-slate-700">Theme note</span>
                                <textarea
                                    value={templateNote}
                                    onChange={(event) => setTemplateNote(event.target.value)}
                                    rows={3}
                                    className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-3 text-sm text-slate-700 outline-none transition focus:border-sky-300 focus:ring-4 focus:ring-sky-100"
                                    placeholder="Example: Use for bilingual agriculture workshops and high-contrast classroom projection."
                                />
                            </label>

                            <div className="flex flex-wrap gap-2">
                                <button type="button" onClick={saveCurrentTemplate} className="btn btn-primary text-xs">
                                    <Palette className="mr-2 h-4 w-4" />
                                    Save Template
                                </button>
                                <button
                                    type="button"
                                    onClick={() => {
                                        const base = buildCustomTemplate(templateDraft.baseTemplateId, `${PDF_TEMPLATES[templateDraft.baseTemplateId].name} Studio`);
                                        setTemplateDraft(base);
                                        setTemplateNote("");
                                    }}
                                    className="btn btn-ghost text-xs"
                                >
                                    <RefreshCcw className="mr-2 h-4 w-4" />
                                    Reset
                                </button>
                                {selectedTemplateId.startsWith("custom:") && (
                                    <button type="button" onClick={deleteCurrentTemplate} className="btn btn-ghost text-xs text-red-600 hover:text-red-700">
                                        Delete Saved Theme
                                    </button>
                                )}
                            </div>
                        </div>
                    </div>

                    <div className="flex min-h-0 flex-col rounded-[30px] border border-slate-200 bg-[linear-gradient(180deg,#fff,rgba(248,250,252,0.98))] p-4 shadow-[0_28px_80px_-48px_rgba(15,23,42,0.26)]">
                        <div className="flex items-start justify-between gap-3">
                            <div>
                                <span className="eyebrow">AI Visual Dock</span>
                                <h3 className="mt-2 text-lg font-bold text-slate-950">Generate slide design ideas</h3>
                                <p className="mt-1 text-sm text-slate-500">
                                    Make quick concept visuals for slide covers, title cards, diagram frames, or theme inspiration right inside Slides.
                                </p>
                            </div>
                            <Link href="/content-studio/media" className="btn btn-ghost text-xs">
                                Open Media
                            </Link>
                        </div>

                        <div className="mt-4 space-y-3">
                            <textarea
                                value={visualPrompt}
                                onChange={(event) => setVisualPrompt(event.target.value)}
                                rows={4}
                                className="w-full rounded-[24px] border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700 outline-none transition focus:border-sky-300 focus:bg-white focus:ring-4 focus:ring-sky-100"
                                placeholder="Example: Make a rich 16:9 opening slide visual for Agriculture Supervisor exam prep with chalkboard texture, data icons, and warm academic lighting."
                            />
                            <div className="flex flex-wrap items-center gap-2">
                                <label className="btn btn-ghost text-xs cursor-pointer">
                                    <Upload className="mr-2 h-4 w-4" />
                                    {visualReferenceFile ? visualReferenceFile.name : "Attach reference"}
                                    <input
                                        type="file"
                                        accept="image/*"
                                        className="hidden"
                                        onChange={(event) => setVisualReferenceFile(event.target.files?.[0] || null)}
                                    />
                                </label>
                                <button
                                    type="button"
                                    onClick={handleGenerateVisual}
                                    disabled={visualGenerating}
                                    className="btn btn-secondary text-xs"
                                >
                                    {visualGenerating ? <LoaderCircle className="mr-2 h-4 w-4 animate-spin" /> : <Wand2 className="mr-2 h-4 w-4" />}
                                    Generate Visual
                                </button>
                            </div>
                        </div>

                        <div className="mt-5 grid flex-1 gap-3 overflow-y-auto pr-1 sm:grid-cols-2">
                            {visualIdeas.length === 0 ? (
                                <div className="sm:col-span-2 rounded-[24px] border border-dashed border-slate-200 bg-slate-50 p-5 text-sm text-slate-500">
                                    Your slide design ideas will appear here. These results also stay in Media Studio history.
                                </div>
                            ) : (
                                visualIdeas.slice(0, 4).map((idea) => (
                                    <article key={idea.id} className="overflow-hidden rounded-[24px] border border-slate-200 bg-white shadow-[0_18px_50px_-42px_rgba(15,23,42,0.28)]">
                                        <div className="aspect-[4/3] overflow-hidden bg-slate-100">
                                            {idea.assetUrl ? (
                                                <img src={idea.assetUrl} alt={idea.prompt} className="h-full w-full object-cover transition duration-500 hover:scale-[1.03]" />
                                            ) : (
                                                <div className="flex h-full items-center justify-center text-sm text-slate-400">Visual unavailable</div>
                                            )}
                                        </div>
                                        <div className="p-4">
                                            <p className="line-clamp-3 text-sm leading-relaxed text-slate-700">{idea.prompt}</p>
                                            <div className="mt-3 flex items-center justify-between text-xs text-slate-500">
                                                <span>{formatDateTime(idea.createdAt)}</span>
                                                <a href={idea.assetUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-semibold text-sky-600">
                                                    Open
                                                    <ArrowUpRight className="h-3.5 w-3.5" />
                                                </a>
                                            </div>
                                        </div>
                                    </article>
                                ))
                            )}
                        </div>
                    </div>
                </aside>
            </section>
        </div>
    );
}

function MetricChip({ label, value }: { label: string; value: string }) {
    return (
        <div className="rounded-[22px] border border-slate-200 bg-white px-4 py-3 shadow-[0_18px_50px_-42px_rgba(15,23,42,0.22)]">
            <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-500">{label}</p>
            <p className="mt-2 text-lg font-bold text-slate-950">{value}</p>
        </div>
    );
}

function MonitorPreviewIcon() {
    return <Brush className="mr-2 h-4 w-4" />;
}
