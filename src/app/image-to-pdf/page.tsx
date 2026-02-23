"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import toast from "react-hot-toast";
import Modal from "@/components/ui/Modal";
import { downloadBlobAsFile } from "@/lib/utils";
import { TEMPLATE_OPTIONS } from "@/lib/template-options";
import { PdfData, QuestionOption } from "@/types/pdf";

export default function ImageToPdfPage() {
    return (
        <Suspense fallback={<div className="page-container text-sm text-slate-600">Loading extractor...</div>}>
            <ImageToPdfContent />
        </Suspense>
    );
}

function ImageToPdfContent() {
    const [imageDataUrl, setImageDataUrl] = useState<string | null>(null);
    const [isExtracting, setIsExtracting] = useState(false);

    const [pdfData, setPdfData] = useState<PdfData>({
        title: "Extracted Question",
        date: new Date().toLocaleDateString("en-GB"),
        instituteName: "NACC AGRICULTURE INSTITUTE",
        questions: [
            {
                number: "1",
                questionHindi: "",
                questionEnglish: "",
                options: [
                    { hindi: "", english: "" },
                    { hindi: "", english: "" },
                    { hindi: "", english: "" },
                    { hindi: "", english: "" },
                ],
            },
        ],
        templateId: "professional",
    });

    const [isGeneratingPreview, setIsGeneratingPreview] = useState(false);
    const [previewUrl, setPreviewUrl] = useState<string | null>(null);
    const [selectedTemplate, setSelectedTemplate] = useState("professional");

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

    const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        setIsExtracting(true);
        setPreviewUrl(null);

        const reader = new FileReader();
        reader.onload = (event) => {
            setImageDataUrl(event.target?.result as string);
        };
        reader.readAsDataURL(file);

        const formData = new FormData();
        formData.append("image", file);

        try {
            const res = await fetch("/api/extract-image", {
                method: "POST",
                body: formData,
            });

            const data = await res.json();
            if (!res.ok) {
                throw new Error(data.error || "Failed to extract text from image.");
            }

            const newPdfData: PdfData = {
                ...pdfData,
                templateId: selectedTemplate,
                questions: [
                    {
                        number: "1",
                        questionHindi: data.questionHindi || "",
                        questionEnglish: data.questionEnglish || "",
                        options: data.options || [
                            { hindi: "", english: "" },
                            { hindi: "", english: "" },
                            { hindi: "", english: "" },
                            { hindi: "", english: "" },
                        ],
                    },
                ],
            };

            setPdfData(newPdfData);
            toast.success("Text extracted. Review and adjust if needed.");
            handleGeneratePreview(newPdfData, selectedTemplate);
        } catch (error: any) {
            console.error("Extraction error:", error);
            setModalConfig({
                isOpen: true,
                title: "Extraction failed",
                message:
                    error.message ||
                    "Could not extract text from the selected image. Verify model/API configuration.",
                type: "danger",
            });
            toast.error("Extraction failed");
        } finally {
            setIsExtracting(false);
        }
    };

    const handleGeneratePreview = async (
        dataToUse: PdfData = pdfData,
        templateId: string = selectedTemplate
    ) => {
        setIsGeneratingPreview(true);
        try {
            const response = await fetch("/api/generate", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ ...dataToUse, templateId, shouldSave: false }),
            });

            if (!response.ok) throw new Error("Preview generation failed");

            const blob = await response.blob();
            const url = URL.createObjectURL(blob);
            setPreviewUrl((prev) => {
                if (prev) URL.revokeObjectURL(prev);
                return url;
            });
        } catch (err) {
            console.error(err);
            toast.error("Preview generation failed");
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

    const updateQuestionField = (field: "questionHindi" | "questionEnglish", value: string) => {
        const newQuestions = [...pdfData.questions];
        newQuestions[0] = { ...newQuestions[0], [field]: value };
        const newData = { ...pdfData, questions: newQuestions };
        setPdfData(newData);
        debouncedPreview(newData);
    };

    const updateOptionField = (index: number, language: keyof QuestionOption, value: string) => {
        const newQuestions = [...pdfData.questions];
        newQuestions[0].options[index] = {
            ...newQuestions[0].options[index],
            [language]: value,
        };

        const newData = { ...pdfData, questions: newQuestions };
        setPdfData(newData);
        debouncedPreview(newData);
    };

    const debouncedPreview = (newData: PdfData) => {
        if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
        debounceTimerRef.current = setTimeout(() => {
            handleGeneratePreview(newData, selectedTemplate);
        }, 700);
    };

    const handleDownload = async () => {
        setIsGeneratingPreview(true);
        try {
            const response = await fetch("/api/generate", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ ...pdfData, templateId: selectedTemplate, shouldSave: false }),
            });

            const blob = await response.blob();
            downloadBlobAsFile(blob, "nacc-extracted-question.pdf");
            toast.success("PDF downloaded");
        } catch (err) {
            console.error(err);
            toast.error("Download failed");
        } finally {
            setIsGeneratingPreview(false);
        }
    };

    return (
        <div className="page-container" style={{ width: "min(1480px, calc(100% - 2rem))" }}>
            <header className="page-header">
                <div>
                    <span className="eyebrow">Extractor</span>
                    <h1 className="heading-xl mt-3">Image to PDF Workspace</h1>
                    <p className="text-sm text-muted mt-3 max-w-2xl">
                        Upload a question screenshot, extract structured content, edit it, and export presentation-ready PDFs instantly.
                    </p>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                    <input
                        type="file"
                        ref={fileInputRef}
                        onChange={handleImageUpload}
                        className="hidden"
                        accept="image/*"
                    />
                    <button
                        onClick={() => fileInputRef.current?.click()}
                        className="btn btn-secondary"
                        disabled={isExtracting}
                    >
                        {isExtracting ? "Extracting..." : "Upload Image"}
                    </button>
                    <button
                        onClick={() => handleGeneratePreview()}
                        disabled={isGeneratingPreview || isExtracting}
                        className="btn btn-secondary"
                    >
                        Refresh Preview
                    </button>
                    <button
                        onClick={handleDownload}
                        disabled={isGeneratingPreview || isExtracting || !previewUrl}
                        className="btn btn-primary"
                    >
                        Download PDF
                    </button>
                </div>
            </header>

            <section className="surface p-3 mb-3">
                <div className="flex flex-wrap items-center gap-2">
                    <span className="status-badge">Template: {selectedTemplate}</span>
                    <span className="status-badge">Question items: {pdfData.questions[0].options.length}</span>
                    <span className="status-badge">
                        <span className="status-dot" />
                        {imageDataUrl ? "Image loaded" : "Awaiting image upload"}
                    </span>
                    {isExtracting && <span className="status-badge">Vision analysis in progress</span>}
                </div>
            </section>

            <section className="workspace-grid">
                <article className="workspace-panel">
                    <div className="workspace-panel-header">
                        <div>
                            <p className="text-xs font-bold uppercase tracking-wide text-slate-500">Content Editor</p>
                            <p className="text-[11px] text-slate-500 mt-1">Validate OCR output before final export</p>
                        </div>
                    </div>

                    <div className="workspace-scroll p-4" style={{ minHeight: "520px" }}>
                        {imageDataUrl ? (
                            <div className="surface-subtle p-3 mb-4 flex gap-3 items-center">
                                <img
                                    src={imageDataUrl}
                                    alt="Uploaded source"
                                    className="w-16 h-16 rounded-lg object-cover border border-slate-200"
                                />
                                <div>
                                    <p className="text-sm font-semibold text-slate-900">Source image loaded</p>
                                    <p className="text-xs text-slate-600">Review extracted text for OCR mistakes.</p>
                                </div>
                            </div>
                        ) : (
                            <button
                                onClick={() => fileInputRef.current?.click()}
                                className="w-full border border-dashed border-slate-300 rounded-2xl p-8 text-center bg-slate-50 hover:bg-slate-100 transition-colors mb-4"
                            >
                                <p className="text-sm font-semibold text-slate-900">Upload question image</p>
                                <p className="text-xs text-slate-500 mt-1">PNG/JPG screenshots work best</p>
                            </button>
                        )}

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
                            <div>
                                <label className="text-xs font-semibold text-slate-600 block mb-1">Title</label>
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

                        <div className="space-y-4">
                            <div>
                                <label className="text-xs font-semibold text-slate-600 block mb-1">Question (Hindi)</label>
                                <textarea
                                    value={pdfData.questions[0].questionHindi}
                                    onChange={(e) => updateQuestionField("questionHindi", e.target.value)}
                                    className="textarea min-h-[90px]"
                                    placeholder="हिंदी में प्रश्न लिखें"
                                />
                            </div>

                            <div>
                                <label className="text-xs font-semibold text-slate-600 block mb-1">Question (English)</label>
                                <textarea
                                    value={pdfData.questions[0].questionEnglish}
                                    onChange={(e) => updateQuestionField("questionEnglish", e.target.value)}
                                    className="textarea min-h-[90px]"
                                    placeholder="Write question in English"
                                />
                            </div>

                            <div className="space-y-3">
                                <p className="text-xs font-semibold text-slate-600 uppercase tracking-wide">Options</p>
                                {pdfData.questions[0].options.map((option, idx) => (
                                    <div key={idx} className="surface-subtle p-3">
                                        <p className="text-xs font-semibold text-slate-600 mb-2">Option {idx + 1}</p>
                                        <div className="space-y-2">
                                            <input
                                                type="text"
                                                value={option.hindi}
                                                onChange={(e) => updateOptionField(idx, "hindi", e.target.value)}
                                                className="input"
                                                placeholder={`विकल्प ${idx + 1}`}
                                            />
                                            <input
                                                type="text"
                                                value={option.english}
                                                onChange={(e) => updateOptionField(idx, "english", e.target.value)}
                                                className="input"
                                                placeholder={`Option ${idx + 1}`}
                                            />
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>
                </article>

                <article className="workspace-panel">
                    <div className="workspace-panel-header flex-col items-start gap-3">
                        <div className="flex w-full items-center justify-between gap-2">
                            <div>
                                <p className="text-xs font-bold uppercase tracking-wide text-slate-500">Preview</p>
                                <p className="text-[11px] text-slate-500 mt-1">Switch templates before export</p>
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

                    <div className="workspace-scroll flex-1" style={{ minHeight: "520px" }}>
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
                                    Upload an image or edit content fields to generate the live preview.
                                </p>
                            </div>
                        )}
                    </div>
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
