"use client";

import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import toast from "react-hot-toast";
import Modal from "@/components/ui/Modal";
import { downloadBlobAsFile } from "@/lib/utils";
import { TEMPLATE_OPTIONS } from "@/lib/template-options";
import { PdfData, Question, QuestionOption } from "@/types/pdf";

type SourceImageMeta = {
    imagePath: string;
    imageName: string;
    questionCount: number;
};

type ExtractImageResponse = {
    questions: Question[];
    images: SourceImageMeta[];
    totalImages: number;
    totalQuestions: number;
    maxImagesPerBatch: number;
    warnings: string[];
    error?: string;
};

function createBlankQuestion(number: string): Question {
    return {
        number,
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
    return questions.map((question, index) => ({
        ...question,
        number: String(index + 1),
    }));
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
        questions: renumberQuestions(pdfData.questions),
    };
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

    const fileInputRef = useRef<HTMLInputElement>(null);
    const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);

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
            if (previewUrl) URL.revokeObjectURL(previewUrl);
        };
    }, [previewUrl]);

    const selectedQuestion = pdfData.questions[selectedQuestionIndex] || null;

    const extractionSummary = useMemo(() => {
        const questionCount = pdfData.questions.length;
        const withDiagrams = pdfData.questions.filter((question) => Boolean(question.diagramImagePath)).length;
        return { questionCount, withDiagrams };
    }, [pdfData.questions]);

    const debouncedPreview = (nextData: PdfData) => {
        if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
        debounceTimerRef.current = setTimeout(() => {
            handleGeneratePreview(nextData, selectedTemplate);
        }, 650);
    };

    const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const files = Array.from(e.target.files || []);
        if (files.length === 0) return;

        setIsExtracting(true);

        const formData = new FormData();
        files.forEach((file) => formData.append("images", file));

        try {
            const res = await fetch("/api/extract-image", {
                method: "POST",
                body: formData,
            });

            const data = (await res.json()) as ExtractImageResponse;
            if (!res.ok) {
                throw new Error(data.error || "Failed to extract text from images.");
            }

            const incomingQuestions = data.questions || [];
            const incomingImages = data.images || [];
            const isSeedEmpty =
                pdfData.questions.length === 1 &&
                !pdfData.questions[0].questionHindi &&
                !pdfData.questions[0].questionEnglish &&
                pdfData.questions[0].options.every((option) => !option.english && !option.hindi);

            const baseQuestions = isSeedEmpty ? [] : pdfData.questions;
            const mergedQuestions = renumberQuestions([...baseQuestions, ...incomingQuestions]);
            const mergedImages = [...sourceImages, ...incomingImages];

            setPdfData((prev) => ({
                ...prev,
                questions: mergedQuestions,
                sourceImages: mergedImages,
            }));
            setSourceImages(mergedImages);

            if (data.warnings?.length) {
                setExtractionWarnings((prev) => [...prev, ...data.warnings]);
                toast.error(`Extraction warnings: ${data.warnings.length}`);
            }

            if (selectedQuestionIndex >= mergedQuestions.length) {
                setSelectedQuestionIndex(Math.max(0, mergedQuestions.length - 1));
            }

            toast.success(`${data.totalQuestions} questions extracted from ${data.totalImages} images`);

            const nextData = preparePayload(
                {
                    ...pdfData,
                    questions: mergedQuestions,
                },
                selectedTemplate,
                mergedImages
            );
            handleGeneratePreview(nextData, selectedTemplate);
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
            const nextQuestions = [...prev.questions, createBlankQuestion(String(prev.questions.length + 1))];
            const nextData = { ...prev, questions: renumberQuestions(nextQuestions) };
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
            const nextQuestions = renumberQuestions(prev.questions.filter((_, i) => i !== index));
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
                    <span className="status-badge">Source images: {sourceImages.length}</span>
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

            <section className="workspace-grid">
                <article className="workspace-panel">
                    <div className="workspace-panel-header flex-col items-start gap-3">
                        <div className="flex w-full items-center justify-between gap-2">
                            <div>
                                <p className="text-xs font-bold uppercase tracking-wide text-slate-500">Question Set Editor</p>
                                <p className="text-[11px] text-slate-500 mt-1">
                                    Structure: Hindi question → English question → options (English then Hindi)
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
                                    Q{index + 1}
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
                                        <p className="text-sm font-semibold text-slate-900">Question {selectedQuestionIndex + 1}</p>
                                        <p className="text-xs text-slate-600">
                                            Source: {selectedQuestion.sourceImageName || "manual entry"}
                                        </p>
                                    </div>
                                    <div className="flex gap-2">
                                        <button
                                            className="btn btn-ghost text-xs"
                                            onClick={() => {
                                                updateQuestionField(
                                                    "diagramImagePath",
                                                    selectedQuestion.sourceImagePath || ""
                                                );
                                            }}
                                        >
                                            Include Source as Diagram
                                        </button>
                                        <button
                                            className="btn btn-danger text-xs"
                                            onClick={() => removeQuestion(selectedQuestionIndex)}
                                        >
                                            Delete Question
                                        </button>
                                    </div>
                                </div>

                                {(selectedQuestion.sourceImagePath || selectedQuestion.diagramImagePath) && (
                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
                                        {selectedQuestion.sourceImagePath && (
                                            <div className="surface-subtle p-2">
                                                <p className="text-xs text-slate-600 mb-1">Source Image</p>
                                                <img
                                                    src={selectedQuestion.sourceImagePath}
                                                    alt="Source"
                                                    className="w-full h-40 object-contain rounded-lg bg-white"
                                                />
                                            </div>
                                        )}
                                        {selectedQuestion.diagramImagePath && (
                                            <div className="surface-subtle p-2">
                                                <p className="text-xs text-slate-600 mb-1">Diagram (slide)</p>
                                                <img
                                                    src={selectedQuestion.diagramImagePath}
                                                    alt="Diagram"
                                                    className="w-full h-40 object-contain rounded-lg bg-white"
                                                />
                                            </div>
                                        )}
                                    </div>
                                )}

                                <div className="space-y-4">
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

                                    <div className="space-y-3">
                                        <div className="flex items-center justify-between">
                                            <p className="text-xs font-semibold text-slate-600 uppercase tracking-wide">
                                                Options (English then Hindi)
                                            </p>
                                            <button onClick={addOption} className="btn btn-ghost text-xs">
                                                Add Option
                                            </button>
                                        </div>

                                        {selectedQuestion.options.map((option, optionIndex) => (
                                            <div key={optionIndex} className="surface-subtle p-3">
                                                <div className="flex items-center justify-between mb-2">
                                                    <p className="text-xs font-semibold text-slate-600">Option {optionIndex + 1}</p>
                                                    <button
                                                        onClick={() => removeOption(optionIndex)}
                                                        className="btn btn-danger text-xs"
                                                    >
                                                        Remove
                                                    </button>
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
                                <p className="text-[11px] text-slate-500 mt-1">Slides include extracted diagrams and bilingual options</p>
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
                                        <img src={img.imagePath} alt={img.imageName} className="w-full h-16 object-cover rounded-md" />
                                        <p className="text-[10px] text-slate-600 mt-1 truncate">{img.imageName}</p>
                                        <p className="text-[10px] text-slate-500">{img.questionCount} questions</p>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                </article>
            </section>

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
