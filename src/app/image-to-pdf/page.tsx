"use client";

import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import toast from "react-hot-toast";
import Modal from "@/components/ui/Modal";
import { downloadBlobAsFile } from "@/lib/utils";
import { TEMPLATE_OPTIONS } from "@/lib/template-options";
import {
    MatchColumnEntry,
    PdfData,
    Question,
    QuestionOption,
    QuestionType,
} from "@/types/pdf";

const DEFAULT_MAX_IMAGES_PER_BATCH = 8;
const EXTRACT_BATCH_PAUSE_MS = 180;
const QUESTION_TYPE_OPTIONS: Array<{ value: QuestionType; label: string }> = [
    { value: "MCQ", label: "MCQ" },
    { value: "FIB", label: "Fill in the Blank" },
    { value: "MATCH_COLUMN", label: "Match the Column" },
    { value: "TRUE_FALSE", label: "True / False" },
    { value: "ASSERTION_REASON", label: "Assertion / Reason" },
    { value: "NUMERICAL", label: "Numerical" },
    { value: "SHORT_ANSWER", label: "Short Answer" },
    { value: "LONG_ANSWER", label: "Long Answer" },
];

type SourceImageMeta = {
    imagePath: string;
    imageName: string;
    questionCount: number;
    diagramCount?: number;
    qualityIssues?: string[];
    extractionMode?: "original" | "enhanced";
    averageConfidence?: number;
};

type ProcessingStep = {
    id: string;
    stage: string;
    status: "info" | "success" | "warning" | "error";
    message: string;
    imageName?: string;
    variant?: "original" | "enhanced";
    timestamp: string;
};

type ExtractImageResponse = {
    questions: Question[];
    images: SourceImageMeta[];
    totalImages: number;
    totalQuestions: number;
    totalDiagrams?: number;
    maxImagesPerBatch: number;
    warnings: string[];
    processingSteps?: ProcessingStep[];
    quotaExceeded?: boolean;
    retryAfterSeconds?: number;
    error?: string;
};

type HinglishVariant = {
    word: string;
    note: string;
};

type HinglishTokenSuggestion = {
    input: string;
    hindi: string;
    alternatives: string[];
};

type HinglishResponse = {
    hindi: string;
    variants: HinglishVariant[];
    tokenSuggestions: HinglishTokenSuggestion[];
    notes?: string;
    error?: string;
};

type AssistantMessage = {
    id: string;
    role: "user" | "assistant";
    text: string;
    suggestion?: Question;
    targetIndex?: number;
    applied?: boolean;
};

type WorkspaceAssistantResponse = {
    reply?: string;
    question?: Question;
    error?: string;
};

function createBlankQuestion(number: string): Question {
    return {
        number,
        questionType: "MCQ",
        questionHindi: "",
        questionEnglish: "",
        options: [
            { english: "", hindi: "" },
            { english: "", hindi: "" },
            { english: "", hindi: "" },
            { english: "", hindi: "" },
        ],
    };
}

function renumberQuestions(questions: Question[]) {
    return questions.map((question, index) => {
        const number = String(question.number || "").trim();
        return {
            ...question,
            number: number || String(index + 1),
        };
    });
}

function preparePayload(
    pdfData: PdfData,
    selectedTemplate: string,
    sourceImages: SourceImageMeta[]
): PdfData {
    return {
        ...pdfData,
        templateId: selectedTemplate,
        optionDisplayOrder: "english-first",
        sourceImages,
        questions: pdfData.questions.map((question, index) => ({
            ...question,
            number: String(question.number || "").trim() || String(index + 1),
        })),
    };
}

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function nextQuestionNumber(questions: Question[]): string {
    const numeric = questions
        .map((question) => Number.parseInt(String(question.number || "").trim(), 10))
        .filter((value) => Number.isFinite(value));

    if (numeric.length === 0) return String(questions.length + 1);
    return String(Math.max(...numeric) + 1);
}

function isQuestionMeaningful(question: Question): boolean {
    return Boolean(
        question.questionHindi?.trim() ||
            question.questionEnglish?.trim() ||
            question.diagramImagePath ||
            question.autoDiagramImagePath ||
            question.matchColumns?.left?.length ||
            question.matchColumns?.right?.length ||
            question.options.some((option) => option.english?.trim() || option.hindi?.trim())
    );
}

function isOptionType(questionType: QuestionType | undefined): boolean {
    return questionType === "MCQ" || questionType === "TRUE_FALSE" || questionType === "ASSERTION_REASON";
}

function getQuestionTypeLabel(questionType: QuestionType | undefined): string {
    const selected = QUESTION_TYPE_OPTIONS.find((item) => item.value === questionType);
    return selected?.label || "Question";
}

function getQuestionTypeShort(questionType: QuestionType | undefined): string {
    switch (questionType) {
        case "MATCH_COLUMN":
            return "MATCH";
        case "SHORT_ANSWER":
            return "SHORT";
        case "LONG_ANSWER":
            return "LONG";
        case "TRUE_FALSE":
            return "T/F";
        case "ASSERTION_REASON":
            return "A/R";
        default:
            return questionType || "Q";
    }
}

function serializeMatchColumnEntries(entries: MatchColumnEntry[] | undefined): string {
    if (!entries?.length) return "";
    return entries.map((entry) => `${entry.english} || ${entry.hindi}`).join("\n");
}

function parseMatchColumnEntries(text: string): MatchColumnEntry[] {
    return text
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => {
            const [first, second] = line.split("||").map((part) => part.trim());
            if (first && second) {
                return { english: first, hindi: second };
            }
            return { english: line, hindi: line };
        })
        .slice(0, 12);
}

function normalizeAssistantQuestion(raw: Question, fallback: Question): Question {
    return {
        ...fallback,
        ...raw,
        number: String(raw.number || fallback.number || "").trim() || fallback.number,
        questionHindi: String(raw.questionHindi || fallback.questionHindi || "").trim(),
        questionEnglish: String(raw.questionEnglish || fallback.questionEnglish || "").trim(),
        options: Array.isArray(raw.options)
            ? raw.options
                  .slice(0, 10)
                  .map((option) => ({
                      english: String(option.english || "").trim(),
                      hindi: String(option.hindi || "").trim(),
                  }))
            : fallback.options,
    };
}

function formatStepTimestamp(value: string): string {
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return "";
    return parsed.toLocaleTimeString("en-GB", {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
    });
}

type EditableQuestionField =
    | "questionHindi"
    | "questionEnglish"
    | "diagramImagePath"
    | "diagramCaptionHindi"
    | "diagramCaptionEnglish";

export default function ImageToPdfPage() {
    return (
        <Suspense fallback={<div className="page-container text-sm text-slate-600">Loading extractor...</div>}>
            <ImageToPdfContent />
        </Suspense>
    );
}

function ImageToPdfContent() {
    const [pdfData, setPdfData] = useState<PdfData>({
        title: "Extracted Question Set",
        date: new Date().toLocaleDateString("en-GB"),
        instituteName: "NACC AGRICULTURE INSTITUTE",
        questions: [createBlankQuestion("1")],
        templateId: "professional",
        optionDisplayOrder: "english-first",
        sourceImages: [],
    });

    const [sourceImages, setSourceImages] = useState<SourceImageMeta[]>([]);
    const [selectedQuestionIndex, setSelectedQuestionIndex] = useState(0);
    const [isExtracting, setIsExtracting] = useState(false);
    const [isGeneratingPreview, setIsGeneratingPreview] = useState(false);
    const [isSaving, setIsSaving] = useState(false);
    const [previewUrl, setPreviewUrl] = useState<string | null>(null);
    const [selectedTemplate, setSelectedTemplate] = useState("professional");
    const [documentId, setDocumentId] = useState<string | null>(null);
    const [extractionWarnings, setExtractionWarnings] = useState<string[]>([]);
    const [processingSteps, setProcessingSteps] = useState<ProcessingStep[]>([]);
    const [isProcessPopupOpen, setIsProcessPopupOpen] = useState(false);
    const [hinglishInput, setHinglishInput] = useState("");
    const [hinglishResult, setHinglishResult] = useState<HinglishResponse | null>(null);
    const [isConvertingHinglish, setIsConvertingHinglish] = useState(false);
    const [assistantPrompt, setAssistantPrompt] = useState("");
    const [assistantMessages, setAssistantMessages] = useState<AssistantMessage[]>([]);
    const [isAssistantBusy, setIsAssistantBusy] = useState(false);

    const fileInputRef = useRef<HTMLInputElement>(null);
    const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);
    const hinglishTimerRef = useRef<NodeJS.Timeout | null>(null);

    const [modalConfig, setModalConfig] = useState<{
        isOpen: boolean;
        title: string;
        message: string;
        onConfirm?: () => void;
        type: "danger" | "warning" | "info" | "success";
    }>({
        isOpen: false,
        title: "",
        message: "",
        type: "info",
    });

    useEffect(() => {
        return () => {
            if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
            if (hinglishTimerRef.current) clearTimeout(hinglishTimerRef.current);
            if (previewUrl) URL.revokeObjectURL(previewUrl);
        };
    }, [previewUrl]);

    const selectedQuestion = pdfData.questions[selectedQuestionIndex] || null;

    const extractionSummary = useMemo(() => {
        const meaningfulQuestions = pdfData.questions.filter(isQuestionMeaningful);
        const questionCount = meaningfulQuestions.length;
        const withDiagrams = meaningfulQuestions.filter(
            (question) => Boolean(question.diagramImagePath || question.autoDiagramImagePath)
        ).length;
        const highConfidence = meaningfulQuestions.filter(
            (question) => (question.extractionConfidence || 0) >= 0.85
        ).length;
        const typeCounts = meaningfulQuestions.reduce(
            (acc, question) => {
                const type = question.questionType || "UNKNOWN";
                acc[type] = (acc[type] || 0) + 1;
                return acc;
            },
            {} as Record<string, number>
        );
        return { questionCount, withDiagrams, highConfidence, typeCounts };
    }, [pdfData.questions]);

    const appendProcessingStep = (
        step: Omit<ProcessingStep, "id" | "timestamp"> & Partial<Pick<ProcessingStep, "id" | "timestamp">>
    ) => {
        setProcessingSteps((prev) => [
            ...prev,
            {
                id: step.id || `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
                timestamp: step.timestamp || new Date().toISOString(),
                stage: step.stage,
                status: step.status,
                message: step.message,
                imageName: step.imageName,
                variant: step.variant,
            },
        ]);
    };

    const handleHinglishConversion = async (text: string) => {
        const input = text.trim();
        if (!input) {
            setHinglishResult(null);
            return;
        }

        setIsConvertingHinglish(true);
        try {
            const response = await fetch("/api/hinglish-to-hindi", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ text: input }),
            });

            const data = (await response.json()) as HinglishResponse;
            if (!response.ok) {
                throw new Error(data.error || "Hinglish conversion failed.");
            }

            setHinglishResult({
                hindi: data.hindi || "",
                variants: data.variants || [],
                tokenSuggestions: data.tokenSuggestions || [],
                notes: data.notes,
            });
        } catch (error: any) {
            console.error("Hinglish conversion error:", error);
            toast.error(error.message || "Hinglish conversion failed");
        } finally {
            setIsConvertingHinglish(false);
        }
    };

    const debouncedPreview = (nextData: PdfData) => {
        if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
        debounceTimerRef.current = setTimeout(() => {
            handleGeneratePreview(nextData, selectedTemplate);
        }, 650);
    };

    useEffect(() => {
        if (hinglishTimerRef.current) clearTimeout(hinglishTimerRef.current);

        if (!hinglishInput.trim()) {
            setHinglishResult(null);
            return;
        }

        hinglishTimerRef.current = setTimeout(() => {
            handleHinglishConversion(hinglishInput);
        }, 450);

        return () => {
            if (hinglishTimerRef.current) clearTimeout(hinglishTimerRef.current);
        };
    }, [hinglishInput]);

    const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const files = Array.from(e.target.files || []);
        if (files.length === 0) return;

        setIsExtracting(true);
        setIsProcessPopupOpen(true);
        setProcessingSteps([]);
        appendProcessingStep({
            stage: "client_upload_start",
            status: "info",
            message: `Started AI extraction for ${files.length} image(s).`,
        });

        try {
            let batchSize = DEFAULT_MAX_IMAGES_PER_BATCH;
            let cursor = 0;
            let totalQuestions = 0;
            let totalImages = 0;

            const extractedQuestions: Question[] = [];
            const extractedImages: SourceImageMeta[] = [];
            const warnings: string[] = [];
            let quotaHit = false;
            let quotaMessage = "";

            while (cursor < files.length) {
                const batch = files.slice(cursor, cursor + batchSize);
                const formData = new FormData();
                batch.forEach((file) => formData.append("images", file));
                appendProcessingStep({
                    stage: "client_batch_start",
                    status: "info",
                    message: `Processing batch ${Math.floor(cursor / batchSize) + 1} with ${batch.length} image(s).`,
                });

                const res = await fetch("/api/extract-image", {
                    method: "POST",
                    body: formData,
                });

                const data = (await res.json()) as ExtractImageResponse;

                if (res.status === 429 && data.maxImagesPerBatch && data.maxImagesPerBatch < batchSize) {
                    batchSize = Math.max(1, data.maxImagesPerBatch);
                    appendProcessingStep({
                        stage: "client_batch_resize",
                        status: "warning",
                        message: `API rate limit applied. Retrying with batch size ${batchSize}.`,
                    });
                    continue;
                }

                const batchSteps = Array.isArray(data.processingSteps) ? data.processingSteps : [];
                if (batchSteps.length > 0) {
                    setProcessingSteps((prev) => [...prev, ...batchSteps]);
                }
                warnings.push(...(data.warnings || []));

                if (res.status === 429 && data.quotaExceeded) {
                    quotaHit = true;
                    const retryHint =
                        typeof data.retryAfterSeconds === "number"
                            ? ` Retry after about ${Math.ceil(data.retryAfterSeconds)} seconds.`
                            : "";
                    quotaMessage =
                        data.error ||
                        `Gemini quota/rate limit reached while processing this batch.${retryHint}`;
                    appendProcessingStep({
                        stage: "client_quota_halt",
                        status: "warning",
                        message: quotaMessage,
                    });
                    break;
                }

                if (!res.ok) {
                    throw new Error(data.error || "Failed to extract text from images.");
                }

                batchSize = Math.max(1, data.maxImagesPerBatch || batchSize);
                extractedQuestions.push(...(data.questions || []));
                extractedImages.push(...(data.images || []));

                totalQuestions += data.totalQuestions || 0;
                totalImages += data.totalImages || batch.length;
                cursor += batch.length;
                appendProcessingStep({
                    stage: "client_batch_complete",
                    status: "success",
                    message: `Batch completed. Running totals: ${totalQuestions} question(s), ${totalImages} image(s).`,
                });

                if (cursor < files.length) {
                    await sleep(EXTRACT_BATCH_PAUSE_MS);
                }
            }

            if (quotaHit && extractedQuestions.length === 0) {
                if (warnings.length > 0) {
                    setExtractionWarnings((prev) => [...prev, ...warnings]);
                }
                setModalConfig({
                    isOpen: true,
                    title: "Gemini quota reached",
                    message:
                        quotaMessage ||
                        "Gemini API quota/rate limit is reached. Retry later or upgrade billing plan.",
                    type: "warning",
                });
                toast.error("Gemini quota reached");
                return;
            }

            let nextDataForPreview: PdfData | null = null;

            setPdfData((prev) => {
                const isSeedEmpty =
                    prev.questions.length === 1 &&
                    !prev.questions[0].questionHindi &&
                    !prev.questions[0].questionEnglish &&
                    prev.questions[0].options.every((option) => !option.english && !option.hindi);

                const baseQuestions = isSeedEmpty ? [] : prev.questions;
                const mergedQuestions = renumberQuestions([...baseQuestions, ...extractedQuestions]);
                const mergedImages = [...(prev.sourceImages || []), ...extractedImages];

                nextDataForPreview = {
                    ...prev,
                    questions: mergedQuestions,
                    sourceImages: mergedImages,
                };

                return nextDataForPreview;
            });

            setSourceImages((prev) => [...prev, ...extractedImages]);
            if (warnings.length > 0) {
                setExtractionWarnings((prev) => [...prev, ...warnings]);
                toast.error(`Extraction warnings: ${warnings.length}`);
                appendProcessingStep({
                    stage: "client_warnings",
                    status: "warning",
                    message: `${warnings.length} extraction warning(s) detected.`,
                });
            }

            setSelectedQuestionIndex((current) => {
                const finalCount = (nextDataForPreview?.questions || []).length;
                return Math.max(0, Math.min(current, finalCount - 1));
            });

            if (quotaHit) {
                toast.error("Extraction paused due Gemini quota. Loaded partial results.");
            } else {
                toast.success(`${totalQuestions} questions extracted from ${totalImages} images`);
            }
            appendProcessingStep({
                stage: "client_upload_complete",
                status: quotaHit ? "warning" : "success",
                message: quotaHit
                    ? `Partial extraction complete: ${totalQuestions} question(s) from ${totalImages} image(s).`
                    : `Extraction complete: ${totalQuestions} question(s) from ${totalImages} image(s).`,
            });

            if (nextDataForPreview) {
                handleGeneratePreview(nextDataForPreview, selectedTemplate);
            }
        } catch (error: any) {
            console.error("Extraction error:", error);
            setModalConfig({
                isOpen: true,
                title: "Extraction failed",
                message:
                    error.message ||
                    "Could not extract content from the selected images. Please verify API config and image quality.",
                type: "danger",
            });
            toast.error("Extraction failed");
            appendProcessingStep({
                stage: "client_upload_error",
                status: "error",
                message: error.message || "Extraction failed.",
            });
        } finally {
            setIsExtracting(false);
            if (fileInputRef.current) fileInputRef.current.value = "";
        }
    };

    const handleGeneratePreview = async (
        dataToUse: PdfData = pdfData,
        templateId: string = selectedTemplate
    ) => {
        if (!dataToUse.questions?.length) return;

        setIsGeneratingPreview(true);
        try {
            const payload = preparePayload(
                dataToUse,
                templateId,
                ((dataToUse.sourceImages as SourceImageMeta[] | undefined) || sourceImages)
            );

            const response = await fetch("/api/generate", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ ...payload, shouldSave: false }),
            });

            if (!response.ok) {
                const detail = await response.json().catch(() => ({}));
                throw new Error(detail.error || "Preview generation failed");
            }

            const blob = await response.blob();
            const url = URL.createObjectURL(blob);
            setPreviewUrl((prev) => {
                if (prev) URL.revokeObjectURL(prev);
                return url;
            });
        } catch (err: any) {
            console.error(err);
            toast.error(err.message || "Preview generation failed");
        } finally {
            setIsGeneratingPreview(false);
        }
    };

    const handleSaveToDb = async () => {
        setIsSaving(true);
        try {
            const payload = preparePayload(
                pdfData,
                selectedTemplate,
                sourceImages.length
                    ? sourceImages
                    : ((pdfData.sourceImages as SourceImageMeta[] | undefined) || [])
            );

            const response = await fetch("/api/generate", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    ...payload,
                    extractionWarnings,
                    extractionProcessingSteps: processingSteps,
                    assistantMessages,
                    extractedAt: new Date().toISOString(),
                    shouldSave: true,
                    documentId: documentId || undefined,
                }),
            });

            if (!response.ok) {
                const detail = await response.json().catch(() => ({}));
                throw new Error(detail.error || "Save failed");
            }

            const savedId = response.headers.get("X-Document-Id");
            if (savedId && savedId !== "offline") setDocumentId(savedId);

            await response.arrayBuffer();
            toast.success(savedId && savedId !== "offline" ? "Saved to history" : "Saved");
        } catch (error: any) {
            console.error(error);
            toast.error(error.message || "Save failed");
        } finally {
            setIsSaving(false);
        }
    };

    const handleDownload = async () => {
        setIsGeneratingPreview(true);
        try {
            const payload = preparePayload(
                pdfData,
                selectedTemplate,
                sourceImages.length
                    ? sourceImages
                    : ((pdfData.sourceImages as SourceImageMeta[] | undefined) || [])
            );

            const response = await fetch("/api/generate", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    ...payload,
                    extractionWarnings,
                    extractionProcessingSteps: processingSteps,
                    assistantMessages,
                    extractedAt: new Date().toISOString(),
                    shouldSave: true,
                    documentId: documentId || undefined,
                }),
            });

            if (!response.ok) {
                const detail = await response.json().catch(() => ({}));
                throw new Error(detail.error || "Download failed");
            }

            const savedId = response.headers.get("X-Document-Id");
            if (savedId && savedId !== "offline") setDocumentId(savedId);

            const blob = await response.blob();
            downloadBlobAsFile(blob, `${pdfData.title || "nacc-extracted-set"}.pdf`);
            toast.success("PDF downloaded and saved");
        } catch (err: any) {
            console.error(err);
            toast.error(err.message || "Download failed");
        } finally {
            setIsGeneratingPreview(false);
        }
    };

    const handleTemplateChange = (id: string) => {
        setSelectedTemplate(id);
        const newData = { ...pdfData, templateId: id };
        setPdfData(newData);
        handleGeneratePreview(newData, id);
    };

    const updateQuestionField = (field: EditableQuestionField, value: string) => {
        setPdfData((prev) => {
            const nextQuestions = [...prev.questions];
            nextQuestions[selectedQuestionIndex] = {
                ...nextQuestions[selectedQuestionIndex],
                [field]: value,
            };
            const nextData = { ...prev, questions: nextQuestions };
            debouncedPreview(nextData);
            return nextData;
        });
    };

    const updateQuestionType = (questionType: QuestionType) => {
        setPdfData((prev) => {
            const nextQuestions = [...prev.questions];
            const current = nextQuestions[selectedQuestionIndex];
            const shouldHaveOptions = isOptionType(questionType);
            nextQuestions[selectedQuestionIndex] = {
                ...current,
                questionType,
                options: shouldHaveOptions
                    ? current.options.length >= 2
                        ? current.options
                        : [
                              { english: "", hindi: "" },
                              { english: "", hindi: "" },
                          ]
                    : current.options,
                blankCount: questionType === "FIB" ? Math.max(1, current.blankCount || 1) : undefined,
                matchColumns:
                    questionType === "MATCH_COLUMN"
                        ? current.matchColumns || { left: [], right: [] }
                        : current.matchColumns,
            };

            const nextData = { ...prev, questions: nextQuestions };
            debouncedPreview(nextData);
            return nextData;
        });
    };

    const updateBlankCount = (value: number) => {
        setPdfData((prev) => {
            const nextQuestions = [...prev.questions];
            const current = nextQuestions[selectedQuestionIndex];
            nextQuestions[selectedQuestionIndex] = {
                ...current,
                blankCount: Math.max(1, Math.min(value || 1, 20)),
            };
            const nextData = { ...prev, questions: nextQuestions };
            debouncedPreview(nextData);
            return nextData;
        });
    };

    const updateMatchColumns = (side: "left" | "right", text: string) => {
        setPdfData((prev) => {
            const nextQuestions = [...prev.questions];
            const current = nextQuestions[selectedQuestionIndex];
            const currentColumns = current.matchColumns || { left: [], right: [] };
            nextQuestions[selectedQuestionIndex] = {
                ...current,
                matchColumns: {
                    ...currentColumns,
                    [side]: parseMatchColumnEntries(text),
                },
            };
            const nextData = { ...prev, questions: nextQuestions };
            debouncedPreview(nextData);
            return nextData;
        });
    };

    const updateOptionField = (optionIndex: number, language: keyof QuestionOption, value: string) => {
        setPdfData((prev) => {
            const nextQuestions = [...prev.questions];
            const question = nextQuestions[selectedQuestionIndex];
            const nextOptions = [...question.options];
            nextOptions[optionIndex] = {
                ...nextOptions[optionIndex],
                [language]: value,
            };

            nextQuestions[selectedQuestionIndex] = {
                ...question,
                options: nextOptions,
            };

            const nextData = { ...prev, questions: nextQuestions };
            debouncedPreview(nextData);
            return nextData;
        });
    };

    const addQuestion = () => {
        setPdfData((prev) => {
            const nextQuestions = [...prev.questions, createBlankQuestion(nextQuestionNumber(prev.questions))];
            const nextData = { ...prev, questions: nextQuestions };
            setSelectedQuestionIndex(nextData.questions.length - 1);
            debouncedPreview(nextData);
            return nextData;
        });
    };

    const removeQuestion = (index: number) => {
        if (pdfData.questions.length <= 1) {
            toast.error("At least one question is required");
            return;
        }

        setPdfData((prev) => {
            const nextQuestions = prev.questions.filter((_, i) => i !== index);
            const nextData = { ...prev, questions: nextQuestions };
            setSelectedQuestionIndex((current) => Math.max(0, Math.min(current, nextQuestions.length - 1)));
            debouncedPreview(nextData);
            return nextData;
        });
    };

    const addOption = () => {
        setPdfData((prev) => {
            const nextQuestions = [...prev.questions];
            const question = nextQuestions[selectedQuestionIndex];
            if (question.options.length >= 10) {
                toast.error("Maximum 10 options supported");
                return prev;
            }
            nextQuestions[selectedQuestionIndex] = {
                ...question,
                options: [...question.options, { english: "", hindi: "" }],
            };

            const nextData = { ...prev, questions: nextQuestions };
            debouncedPreview(nextData);
            return nextData;
        });
    };

    const removeOption = (index: number) => {
        setPdfData((prev) => {
            const nextQuestions = [...prev.questions];
            const question = nextQuestions[selectedQuestionIndex];
            if (question.options.length <= 2) {
                toast.error("At least 2 options required");
                return prev;
            }

            nextQuestions[selectedQuestionIndex] = {
                ...question,
                options: question.options.filter((_, i) => i !== index),
            };

            const nextData = { ...prev, questions: nextQuestions };
            debouncedPreview(nextData);
            return nextData;
        });
    };

    const applyHinglishToQuestion = (value: string) => {
        if (!selectedQuestion) {
            toast.error("Select a question before inserting Hindi text.");
            return;
        }

        const resolved = value.trim();
        if (!resolved) return;
        const nextValue = selectedQuestion.questionHindi
            ? `${selectedQuestion.questionHindi}\n${resolved}`
            : resolved;
        updateQuestionField("questionHindi", nextValue);
        toast.success("Added Hindi text to selected question");
    };

    const sendAssistantPrompt = async () => {
        const prompt = assistantPrompt.trim();
        if (!prompt) return;
        if (!selectedQuestion) {
            toast.error("Select a question to request AI correction.");
            return;
        }

        const targetIndex = selectedQuestionIndex;
        const userMessage: AssistantMessage = {
            id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
            role: "user",
            text: prompt,
        };

        setAssistantMessages((prev) => [...prev, userMessage]);
        setAssistantPrompt("");
        setIsAssistantBusy(true);

        try {
            const response = await fetch("/api/image-workspace-assistant", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    message: prompt,
                    question: selectedQuestion,
                }),
            });

            const data = (await response.json()) as WorkspaceAssistantResponse;
            if (!response.ok) {
                throw new Error(data.error || "Assistant correction failed.");
            }

            const suggestion = data.question
                ? normalizeAssistantQuestion(data.question, selectedQuestion)
                : undefined;
            const assistantMessage: AssistantMessage = {
                id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
                role: "assistant",
                text: data.reply || "Generated a structure-aware correction suggestion.",
                suggestion,
                targetIndex,
            };
            setAssistantMessages((prev) => [...prev, assistantMessage]);
        } catch (error: any) {
            console.error("Assistant correction error:", error);
            toast.error(error.message || "Assistant correction failed");
            setAssistantMessages((prev) => [
                ...prev,
                {
                    id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
                    role: "assistant",
                    text: error.message || "Assistant correction failed.",
                },
            ]);
        } finally {
            setIsAssistantBusy(false);
        }
    };

    const applyAssistantSuggestion = (messageId: string) => {
        const message = assistantMessages.find((entry) => entry.id === messageId);
        if (!message?.suggestion || message.targetIndex === undefined) {
            toast.error("No suggestion available to apply.");
            return;
        }
        const targetIndex = message.targetIndex;
        const suggestion = message.suggestion;

        setPdfData((prev) => {
            const nextQuestions = [...prev.questions];
            if (targetIndex < 0 || targetIndex >= nextQuestions.length) {
                return prev;
            }
            nextQuestions[targetIndex] = suggestion;
            const nextData = { ...prev, questions: nextQuestions };
            debouncedPreview(nextData);
            return nextData;
        });

        setSelectedQuestionIndex(targetIndex);
        setAssistantMessages((prev) =>
            prev.map((entry) => (entry.id === messageId ? { ...entry, applied: true } : entry))
        );
        toast.success("AI suggestion applied to question");
    };

    const clearWorkspace = () => {
        setPdfData({
            title: "Extracted Question Set",
            date: new Date().toLocaleDateString("en-GB"),
            instituteName: "NACC AGRICULTURE INSTITUTE",
            questions: [createBlankQuestion("1")],
            templateId: selectedTemplate,
            optionDisplayOrder: "english-first",
            sourceImages: [],
        });
        setSourceImages([]);
        setSelectedQuestionIndex(0);
        setExtractionWarnings([]);
        setDocumentId(null);
        setProcessingSteps([]);
        setIsProcessPopupOpen(false);
        setAssistantMessages([]);
        setAssistantPrompt("");
        setHinglishInput("");
        setHinglishResult(null);
        setPreviewUrl((prev) => {
            if (prev) URL.revokeObjectURL(prev);
            return null;
        });
    };

    return (
        <div className="page-container" style={{ width: "min(1540px, calc(100% - 2rem))" }}>
            <header className="page-header">
                <div>
                    <span className="eyebrow">Extractor</span>
                    <h1 className="heading-xl mt-3">Image to PDF Workspace</h1>
                    <p className="text-sm text-muted mt-3 max-w-3xl">
                        Upload multiple images, extract any number of questions per image, keep source order, include diagrams when present, and render bilingual slides with professional structure.
                    </p>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                    <input
                        type="file"
                        ref={fileInputRef}
                        onChange={handleImageUpload}
                        className="hidden"
                        accept="image/*"
                        multiple
                    />
                    <button
                        onClick={() => fileInputRef.current?.click()}
                        className="btn btn-secondary"
                        disabled={isExtracting}
                    >
                        {isExtracting ? "Extracting..." : "Upload Images"}
                    </button>
                    <button
                        onClick={() => handleGeneratePreview()}
                        disabled={isGeneratingPreview || isExtracting || pdfData.questions.length === 0}
                        className="btn btn-secondary"
                    >
                        Refresh Preview
                    </button>
                    <button
                        onClick={handleSaveToDb}
                        disabled={isSaving || isExtracting || pdfData.questions.length === 0}
                        className="btn btn-secondary"
                    >
                        {isSaving ? "Saving..." : "Save to History"}
                    </button>
                    <button
                        onClick={handleDownload}
                        disabled={isGeneratingPreview || isExtracting || pdfData.questions.length === 0}
                        className="btn btn-primary"
                    >
                        Download PDF
                    </button>
                    <button onClick={clearWorkspace} className="btn btn-ghost">
                        Reset
                    </button>
                </div>
            </header>

            <section className="surface p-3 mb-3">
                <div className="flex flex-wrap items-center gap-2">
                    <span className="status-badge">Template: {selectedTemplate}</span>
                    <span className="status-badge">Questions: {extractionSummary.questionCount}</span>
                    <span className="status-badge">Diagrams: {extractionSummary.withDiagrams}</span>
                    <span className="status-badge">High confidence: {extractionSummary.highConfidence}</span>
                    <span className="status-badge">Source images: {sourceImages.length}</span>
                    <span className="status-badge">MCQ: {extractionSummary.typeCounts.MCQ || 0}</span>
                    <span className="status-badge">FIB: {extractionSummary.typeCounts.FIB || 0}</span>
                    <span className="status-badge">
                        Match: {extractionSummary.typeCounts.MATCH_COLUMN || 0}
                    </span>
                    <span className="status-badge">Option layout: English then Hindi</span>
                    {documentId && <span className="status-badge">Saved ID: {documentId}</span>}
                    {isExtracting && <span className="status-badge">AI extraction in progress</span>}
                </div>
                {extractionWarnings.length > 0 && (
                    <div className="mt-2 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">
                        <p className="font-semibold mb-1">Extraction warnings</p>
                        <ul className="list-disc pl-5 space-y-1">
                            {extractionWarnings.slice(-5).map((warning, index) => (
                                <li key={`${warning}-${index}`}>{warning}</li>
                            ))}
                        </ul>
                    </div>
                )}
            </section>

            <section className="grid grid-cols-1 xl:grid-cols-2 gap-3 mb-3">
                <article className="surface p-3">
                    <div className="flex items-center justify-between gap-3 mb-3">
                        <div>
                            <p className="text-xs font-bold uppercase tracking-wide text-slate-500">
                                Hinglish Typing Assistant
                            </p>
                            <p className="text-[11px] text-slate-500 mt-1">
                                Type Hinglish and get Hindi conversion with similar-word variants (स/श/ष etc.).
                            </p>
                        </div>
                        {isConvertingHinglish && (
                            <span className="status-badge">
                                <div className="spinner" />
                                Converting
                            </span>
                        )}
                    </div>

                    <div className="space-y-3">
                        <textarea
                            value={hinglishInput}
                            onChange={(e) => setHinglishInput(e.target.value)}
                            className="textarea min-h-[96px]"
                            placeholder="Type in Hinglish (example: sadak, sankar, satkon...)"
                        />

                        <div className="surface-subtle p-3">
                            <p className="text-xs font-semibold text-slate-600 mb-1">Hindi Output</p>
                            <div className="text-sm text-slate-900 min-h-10">
                                {hinglishResult?.hindi || "Converted Hindi text will appear here."}
                            </div>
                            {hinglishResult?.notes && (
                                <p className="text-[11px] text-slate-500 mt-2">{hinglishResult.notes}</p>
                            )}
                            <div className="mt-3 flex flex-wrap gap-2">
                                <button
                                    className="btn btn-ghost text-xs"
                                    disabled={!hinglishResult?.hindi || !selectedQuestion}
                                    onClick={() => applyHinglishToQuestion(hinglishResult?.hindi || "")}
                                >
                                    Insert in Selected Hindi Question
                                </button>
                            </div>
                        </div>

                        {hinglishResult && hinglishResult.variants.length > 0 && (
                            <div>
                                <p className="text-xs font-semibold text-slate-600 mb-2">Variant Suggestions</p>
                                <div className="flex flex-wrap gap-2">
                                    {hinglishResult.variants.map((variant, index) => (
                                        <button
                                            key={`${variant.word}-${index}`}
                                            className="pill"
                                            onClick={() => applyHinglishToQuestion(variant.word)}
                                            title={variant.note}
                                        >
                                            {variant.word}
                                        </button>
                                    ))}
                                </div>
                            </div>
                        )}

                        {hinglishResult && hinglishResult.tokenSuggestions.length > 0 && (
                            <div className="surface-subtle p-3">
                                <p className="text-xs font-semibold text-slate-600 mb-2">Token Suggestions</p>
                                <div className="space-y-2 max-h-40 overflow-auto">
                                    {hinglishResult.tokenSuggestions.map((token, index) => (
                                        <div key={`${token.input}-${index}`} className="text-xs text-slate-600">
                                            <span className="font-semibold text-slate-900">{token.input}</span>
                                            {" → "}
                                            <button
                                                className="pill"
                                                onClick={() => applyHinglishToQuestion(token.hindi)}
                                            >
                                                {token.hindi}
                                            </button>
                                            {token.alternatives.length > 0 && (
                                                <span className="ml-2 text-slate-500">
                                                    Alternatives: {token.alternatives.join(", ")}
                                                </span>
                                            )}
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}
                    </div>
                </article>

                <article className="surface p-3">
                    <div className="flex items-center justify-between gap-3 mb-3">
                        <div>
                            <p className="text-xs font-bold uppercase tracking-wide text-slate-500">
                                AI Correction Chat
                            </p>
                            <p className="text-[11px] text-slate-500 mt-1">
                                Ask AI to fix structure, language, option order, or formatting for the selected question.
                            </p>
                        </div>
                        <span className="status-badge">
                            Target: Q{selectedQuestion?.number || selectedQuestionIndex + 1}
                        </span>
                    </div>

                    <div className="surface-subtle p-3 mb-3 h-56 overflow-auto space-y-2">
                        {assistantMessages.length === 0 ? (
                            <p className="text-sm text-slate-500">
                                Example: “Fix this as Match the Column and keep Hindi question first.”
                            </p>
                        ) : (
                            assistantMessages.map((message) => (
                                <div
                                    key={message.id}
                                    className={`rounded-xl border px-3 py-2 ${
                                        message.role === "user"
                                            ? "border-blue-200 bg-blue-50/60 ml-8"
                                            : "border-slate-200 bg-white mr-8"
                                    }`}
                                >
                                    <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 mb-1">
                                        {message.role === "user" ? "You" : "AI"}
                                    </p>
                                    <p className="text-sm text-slate-800">{message.text}</p>
                                    {message.suggestion && (
                                        <div className="mt-2 flex items-center gap-2">
                                            <button
                                                className="btn btn-ghost text-xs"
                                                onClick={() => applyAssistantSuggestion(message.id)}
                                                disabled={Boolean(message.applied)}
                                            >
                                                {message.applied ? "Applied" : "Apply Suggestion"}
                                            </button>
                                            <span className="text-[11px] text-slate-500">
                                                Structure: {getQuestionTypeLabel(message.suggestion.questionType)}
                                            </span>
                                        </div>
                                    )}
                                </div>
                            ))
                        )}
                    </div>

                    <div className="space-y-2">
                        <textarea
                            value={assistantPrompt}
                            onChange={(e) => setAssistantPrompt(e.target.value)}
                            onKeyDown={(e) => {
                                if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                                    e.preventDefault();
                                    sendAssistantPrompt();
                                }
                            }}
                            className="textarea min-h-[88px]"
                            placeholder="Ask AI to correct the selected question..."
                        />
                        <div className="flex justify-end">
                            <button
                                className="btn btn-secondary"
                                onClick={sendAssistantPrompt}
                                disabled={isAssistantBusy || !assistantPrompt.trim() || !selectedQuestion}
                            >
                                {isAssistantBusy ? "Thinking..." : "Send to AI"}
                            </button>
                        </div>
                    </div>
                </article>
            </section>

            <section className="workspace-grid">
                <article className="workspace-panel">
                    <div className="workspace-panel-header flex-col items-start gap-3">
                        <div className="flex w-full items-center justify-between gap-2">
                            <div>
                                <p className="text-xs font-bold uppercase tracking-wide text-slate-500">Question Set Editor</p>
                                <p className="text-[11px] text-slate-500 mt-1">
                                    Structure-aware editor: MCQ, FIB, Match Column, True/False, Numerical, Short/Long answers
                                </p>
                            </div>
                            <button onClick={addQuestion} className="btn btn-ghost text-xs">
                                Add Question
                            </button>
                        </div>

                        <div className="w-full flex flex-wrap gap-2 max-h-24 overflow-auto">
                            {pdfData.questions.map((question, index) => (
                                <button
                                    key={`${question.number}-${index}`}
                                    onClick={() => setSelectedQuestionIndex(index)}
                                    className={`pill ${selectedQuestionIndex === index ? "pill-active" : ""}`}
                                >
                                    Q{question.number || index + 1}
                                    {" · "}
                                    {getQuestionTypeShort(question.questionType)}
                                    {question.diagramImagePath ? " • diagram" : ""}
                                </button>
                            ))}
                        </div>
                    </div>

                    <div className="workspace-scroll p-4" style={{ minHeight: "560px" }}>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
                            <div>
                                <label className="text-xs font-semibold text-slate-600 block mb-1">Deck Title</label>
                                <input
                                    type="text"
                                    value={pdfData.title}
                                    onChange={(e) => {
                                        const newData = { ...pdfData, title: e.target.value };
                                        setPdfData(newData);
                                        debouncedPreview(newData);
                                    }}
                                    className="input"
                                />
                            </div>
                            <div>
                                <label className="text-xs font-semibold text-slate-600 block mb-1">Date</label>
                                <input
                                    type="text"
                                    value={pdfData.date}
                                    onChange={(e) => {
                                        const newData = { ...pdfData, date: e.target.value };
                                        setPdfData(newData);
                                        debouncedPreview(newData);
                                    }}
                                    className="input"
                                />
                            </div>
                        </div>

                        {selectedQuestion ? (
                            <>
                                <div className="surface-subtle p-3 mb-4 flex flex-wrap items-center gap-3 justify-between">
                                    <div>
                                        <p className="text-sm font-semibold text-slate-900">
                                            Question {selectedQuestion.number || selectedQuestionIndex + 1}
                                        </p>
                                        <p className="text-xs text-slate-600">
                                            Type: {getQuestionTypeLabel(selectedQuestion.questionType)}
                                        </p>
                                    </div>
                                    <div className="flex gap-2">
                                        <button
                                            className="btn btn-ghost text-xs"
                                            onClick={() => {
                                                updateQuestionField(
                                                    "diagramImagePath",
                                                    selectedQuestion.autoDiagramImagePath ||
                                                        selectedQuestion.diagramImagePath ||
                                                        ""
                                                );
                                            }}
                                            disabled={
                                                !selectedQuestion.autoDiagramImagePath &&
                                                !selectedQuestion.diagramImagePath
                                            }
                                        >
                                            Use Auto Diagram
                                        </button>
                                        <button
                                            className="btn btn-ghost text-xs"
                                            onClick={() => updateQuestionField("diagramImagePath", "")}
                                        >
                                            Remove Diagram
                                        </button>
                                        <button
                                            className="btn btn-danger text-xs"
                                            onClick={() => removeQuestion(selectedQuestionIndex)}
                                        >
                                            Delete Question
                                        </button>
                                    </div>
                                </div>

                                {selectedQuestion.diagramImagePath && (
                                    <div className="surface-subtle p-2 mb-4">
                                        <p className="text-xs text-slate-600 mb-1">Diagram (slide)</p>
                                        <img
                                            src={selectedQuestion.diagramImagePath}
                                            alt="Diagram"
                                            className="w-full h-44 object-contain rounded-lg bg-white"
                                        />
                                        {selectedQuestion.diagramBounds && (
                                            <p className="text-[10px] text-slate-500 mt-1">
                                                Auto bounds: x {selectedQuestion.diagramBounds.x.toFixed(2)} | y{" "}
                                                {selectedQuestion.diagramBounds.y.toFixed(2)} | w{" "}
                                                {selectedQuestion.diagramBounds.width.toFixed(2)} | h{" "}
                                                {selectedQuestion.diagramBounds.height.toFixed(2)}
                                            </p>
                                        )}
                                    </div>
                                )}

                                <div className="space-y-4">
                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                        <div>
                                            <label className="text-xs font-semibold text-slate-600 block mb-1">Question Number</label>
                                            <input
                                                type="text"
                                                value={selectedQuestion.number || ""}
                                                onChange={(e) => {
                                                    const value = e.target.value;
                                                    setPdfData((prev) => {
                                                        const nextQuestions = [...prev.questions];
                                                        nextQuestions[selectedQuestionIndex] = {
                                                            ...nextQuestions[selectedQuestionIndex],
                                                            number: value,
                                                        };
                                                        const nextData = { ...prev, questions: nextQuestions };
                                                        debouncedPreview(nextData);
                                                        return nextData;
                                                    });
                                                }}
                                                className="input"
                                                placeholder="e.g. 42"
                                            />
                                        </div>
                                        <div>
                                            <label className="text-xs font-semibold text-slate-600 block mb-1">Question Type</label>
                                            <select
                                                value={selectedQuestion.questionType || "UNKNOWN"}
                                                onChange={(e) => updateQuestionType(e.target.value as QuestionType)}
                                                className="select"
                                            >
                                                {QUESTION_TYPE_OPTIONS.map((option) => (
                                                    <option key={option.value} value={option.value}>
                                                        {option.label}
                                                    </option>
                                                ))}
                                            </select>
                                        </div>
                                    </div>

                                    <div>
                                        <label className="text-xs font-semibold text-slate-600 block mb-1">Question (Hindi)</label>
                                        <textarea
                                            value={selectedQuestion.questionHindi}
                                            onChange={(e) => updateQuestionField("questionHindi", e.target.value)}
                                            className="textarea min-h-[92px]"
                                            placeholder="हिंदी प्रश्न"
                                        />
                                    </div>

                                    <div>
                                        <label className="text-xs font-semibold text-slate-600 block mb-1">Question (English)</label>
                                        <textarea
                                            value={selectedQuestion.questionEnglish}
                                            onChange={(e) => updateQuestionField("questionEnglish", e.target.value)}
                                            className="textarea min-h-[92px]"
                                            placeholder="English question"
                                        />
                                    </div>

                                    {selectedQuestion.questionType === "FIB" && (
                                        <div>
                                            <label className="text-xs font-semibold text-slate-600 block mb-1">
                                                Blank Count
                                            </label>
                                            <input
                                                type="number"
                                                min={1}
                                                max={20}
                                                value={selectedQuestion.blankCount || 1}
                                                onChange={(e) =>
                                                    updateBlankCount(Number.parseInt(e.target.value || "1", 10))
                                                }
                                                className="input"
                                            />
                                        </div>
                                    )}

                                    {selectedQuestion.questionType === "MATCH_COLUMN" && (
                                        <div className="surface-subtle p-3">
                                            <p className="text-xs font-semibold text-slate-600 uppercase tracking-wide mb-2">
                                                Match Columns (Use format: `English || Hindi`)
                                            </p>
                                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                                <div>
                                                    <label className="text-xs font-semibold text-slate-600 block mb-1">
                                                        Column I
                                                    </label>
                                                    <textarea
                                                        value={serializeMatchColumnEntries(
                                                            selectedQuestion.matchColumns?.left
                                                        )}
                                                        onChange={(e) => updateMatchColumns("left", e.target.value)}
                                                        className="textarea min-h-[120px]"
                                                        placeholder={"a) Term A || टर्म A"}
                                                    />
                                                </div>
                                                <div>
                                                    <label className="text-xs font-semibold text-slate-600 block mb-1">
                                                        Column II
                                                    </label>
                                                    <textarea
                                                        value={serializeMatchColumnEntries(
                                                            selectedQuestion.matchColumns?.right
                                                        )}
                                                        onChange={(e) => updateMatchColumns("right", e.target.value)}
                                                        className="textarea min-h-[120px]"
                                                        placeholder={"1) Match A || मिलान A"}
                                                    />
                                                </div>
                                            </div>
                                        </div>
                                    )}

                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                        <div>
                                            <label className="text-xs font-semibold text-slate-600 block mb-1">Diagram Caption (English)</label>
                                            <input
                                                value={selectedQuestion.diagramCaptionEnglish || ""}
                                                onChange={(e) => updateQuestionField("diagramCaptionEnglish", e.target.value)}
                                                className="input"
                                                placeholder="Optional"
                                            />
                                        </div>
                                        <div>
                                            <label className="text-xs font-semibold text-slate-600 block mb-1">Diagram Caption (Hindi)</label>
                                            <input
                                                value={selectedQuestion.diagramCaptionHindi || ""}
                                                onChange={(e) => updateQuestionField("diagramCaptionHindi", e.target.value)}
                                                className="input"
                                                placeholder="Optional"
                                            />
                                        </div>
                                    </div>

                                    {isOptionType(selectedQuestion.questionType) && (
                                        <div className="space-y-3">
                                        <div className="flex items-center justify-between">
                                            <p className="text-xs font-semibold text-slate-600 uppercase tracking-wide">
                                                Options (English then Hindi)
                                            </p>
                                            {isOptionType(selectedQuestion.questionType) && (
                                                <button onClick={addOption} className="btn btn-ghost text-xs">
                                                    Add Option
                                                </button>
                                            )}
                                        </div>

                                        {selectedQuestion.options.map((option, optionIndex) => (
                                            <div key={optionIndex} className="surface-subtle p-3">
                                                <div className="flex items-center justify-between mb-2">
                                                    <p className="text-xs font-semibold text-slate-600">Option {optionIndex + 1}</p>
                                                    {isOptionType(selectedQuestion.questionType) && (
                                                        <button
                                                            onClick={() => removeOption(optionIndex)}
                                                            className="btn btn-danger text-xs"
                                                        >
                                                            Remove
                                                        </button>
                                                    )}
                                                </div>
                                                <div className="space-y-2">
                                                    <input
                                                        type="text"
                                                        value={option.english}
                                                        onChange={(e) =>
                                                            updateOptionField(optionIndex, "english", e.target.value)
                                                        }
                                                        className="input"
                                                        placeholder={`Option ${optionIndex + 1} (English)`}
                                                    />
                                                    <input
                                                        type="text"
                                                        value={option.hindi}
                                                        onChange={(e) =>
                                                            updateOptionField(optionIndex, "hindi", e.target.value)
                                                        }
                                                        className="input"
                                                        placeholder={`विकल्प ${optionIndex + 1} (Hindi)`}
                                                    />
                                                </div>
                                            </div>
                                        ))}
                                        </div>
                                    )}
                                </div>
                            </>
                        ) : (
                            <div className="empty-state">
                                <h3>No question selected</h3>
                                <p className="text-sm">Upload images or add a question manually.</p>
                            </div>
                        )}
                    </div>
                </article>

                <article className="workspace-panel">
                    <div className="workspace-panel-header flex-col items-start gap-3">
                        <div className="flex w-full items-center justify-between gap-2">
                            <div>
                                <p className="text-xs font-bold uppercase tracking-wide text-slate-500">Preview</p>
                                <p className="text-[11px] text-slate-500 mt-1">
                                    Slides include extracted diagrams and structure-aware rendering (MCQ/FIB/Match/etc)
                                </p>
                            </div>
                            {isGeneratingPreview && (
                                <span className="status-badge">
                                    <div className="spinner" />
                                    Rendering
                                </span>
                            )}
                        </div>

                        <div className="flex w-full flex-wrap gap-2">
                            {TEMPLATE_OPTIONS.map((template) => (
                                <button
                                    key={template.id}
                                    onClick={() => handleTemplateChange(template.id)}
                                    className={`pill ${selectedTemplate === template.id ? "pill-active" : ""}`}
                                >
                                    <span
                                        style={{ background: template.tone }}
                                        className="inline-block h-2.5 w-2.5 rounded-full"
                                    />
                                    {template.name}
                                </button>
                            ))}
                        </div>
                    </div>

                    <div className="workspace-scroll flex-1" style={{ minHeight: "560px" }}>
                        {previewUrl ? (
                            <iframe
                                src={`${previewUrl}#toolbar=0&navpanes=0`}
                                className="preview-frame"
                                title="PDF Preview"
                            />
                        ) : (
                            <div className="empty-state">
                                <h3>No preview available</h3>
                                <p className="text-sm max-w-sm mx-auto">
                                    Upload one or multiple images. Extracted questions will be rendered to slides in source order.
                                </p>
                            </div>
                        )}
                    </div>

                    {sourceImages.length > 0 && (
                        <div className="border-t border-slate-200 p-3 bg-slate-50/70">
                            <p className="text-xs font-semibold text-slate-600 mb-2">Uploaded Images</p>
                            <div className="grid grid-cols-2 gap-2 max-h-40 overflow-auto">
                                {sourceImages.map((img, index) => (
                                    <div key={`${img.imagePath}-${index}`} className="surface-subtle p-2">
                                        <p className="text-[10px] text-slate-600 mt-1 truncate">{img.imageName}</p>
                                        <p className="text-[10px] text-slate-500">{img.questionCount} questions</p>
                                        <p className="text-[10px] text-slate-500">{img.diagramCount || 0} diagrams</p>
                                        <p className="text-[10px] text-slate-500">
                                            Mode: {img.extractionMode || "original"}
                                        </p>
                                        {typeof img.averageConfidence === "number" && (
                                            <p className="text-[10px] text-slate-500">
                                                Confidence: {Math.round(img.averageConfidence * 100)}%
                                            </p>
                                        )}
                                        {img.qualityIssues && img.qualityIssues.length > 0 && (
                                            <p className="text-[10px] text-amber-700 line-clamp-2">
                                                Issues: {img.qualityIssues.join("; ")}
                                            </p>
                                        )}
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                </article>
            </section>

            <button
                className="process-popup-toggle"
                onClick={() => setIsProcessPopupOpen((prev) => !prev)}
                type="button"
            >
                {isProcessPopupOpen ? "Hide AI Steps" : `Show AI Steps (${processingSteps.length})`}
            </button>

            {isProcessPopupOpen && (
                <aside className="process-popup-panel" role="dialog" aria-label="AI processing timeline">
                    <div className="process-popup-header">
                        <div>
                            <p className="text-xs font-bold uppercase tracking-wide text-slate-500">
                                AI Processing Timeline
                            </p>
                            <p className="text-[11px] text-slate-500 mt-1">
                                Live extraction stages, retries, diagram crop checks, and quality signals.
                            </p>
                        </div>
                        <div className="flex gap-2">
                            <button
                                className="btn btn-ghost text-xs"
                                onClick={() => setProcessingSteps([])}
                                disabled={processingSteps.length === 0 || isExtracting}
                            >
                                Clear
                            </button>
                            <button
                                className="btn btn-ghost text-xs"
                                onClick={() => setIsProcessPopupOpen(false)}
                            >
                                Close
                            </button>
                        </div>
                    </div>

                    <div className="process-popup-body">
                        {processingSteps.length === 0 ? (
                            <p className="text-xs text-slate-500">
                                No extraction steps yet. Upload images to see detailed AI processing logs.
                            </p>
                        ) : (
                            processingSteps.slice(-120).map((step) => (
                                <div key={step.id} className={`process-step process-step-${step.status}`}>
                                    <span className="process-step-dot" />
                                    <div className="flex-1 min-w-0">
                                        <p className="text-[11px] text-slate-900 leading-relaxed">
                                            {step.message}
                                        </p>
                                        <p className="text-[10px] text-slate-500 mt-1">
                                            {formatStepTimestamp(step.timestamp)}
                                            {step.imageName ? ` • ${step.imageName}` : ""}
                                            {step.variant ? ` • ${step.variant}` : ""}
                                        </p>
                                    </div>
                                </div>
                            ))
                        )}
                    </div>
                </aside>
            )}

            <Modal
                isOpen={modalConfig.isOpen}
                onClose={() => setModalConfig((prev) => ({ ...prev, isOpen: false }))}
                onConfirm={modalConfig.onConfirm}
                title={modalConfig.title}
                message={modalConfig.message}
                type={modalConfig.type}
            />
        </div>
    );
}
