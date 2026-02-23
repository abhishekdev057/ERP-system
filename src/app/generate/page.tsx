"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import toast from "react-hot-toast";
import Modal from "@/components/ui/Modal";
import { downloadBlobAsFile } from "@/lib/utils";
import { TEMPLATE_OPTIONS } from "@/lib/template-options";
import { PdfData } from "@/types/pdf";

const SAMPLE_DATA: PdfData = {
    title: "Sample NACC Question Set",
    date: new Date().toLocaleDateString("en-GB"),
    subject: "Agriculture",
    instituteName: "NACC AGRICULTURE INSTITUTE",
    questions: [
        {
            number: "1",
            questionHindi: "मृदा स्वास्थ्य सुधारने के लिए कौन-सा अभ्यास सबसे प्रभावी है?",
            questionEnglish: "Which practice is most effective for improving soil health?",
            options: [
                { hindi: "फसल चक्र", english: "Crop rotation" },
                { hindi: "अत्यधिक सिंचाई", english: "Over-irrigation" },
                { hindi: "केवल रासायनिक उर्वरक", english: "Only chemical fertilizers" },
                { hindi: "निरंतर जुताई", english: "Continuous tillage" },
            ],
        },
    ],
    templateId: "professional",
};

export default function GeneratePage() {
    return (
        <Suspense fallback={<div className="page-container text-sm text-slate-600">Loading editor...</div>}>
            <GenerateContent />
        </Suspense>
    );
}

function GenerateContent() {
    const [jsonText, setJsonText] = useState("");
    const [jsonData, setJsonData] = useState<PdfData | null>(null);
    const [documentId, setDocumentId] = useState<string | null>(null);
    const [isGenerating, setIsGenerating] = useState(false);
    const [isSaving, setIsSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [previewUrl, setPreviewUrl] = useState<string | null>(null);
    const [fileName, setFileName] = useState("");
    const [selectedTemplate, setSelectedTemplate] = useState("professional");

    const fileInputRef = useRef<HTMLInputElement>(null);
    const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);
    const searchParams = useSearchParams();

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
        const loadId = searchParams.get("load");
        if (!loadId) return;

        setDocumentId(loadId);
        fetch(`/api/documents/${loadId}`)
            .then((res) => res.json())
            .then((data) => {
                if (!data.document) return;
                const dataObj = data.document.jsonData as PdfData;
                const templateId = dataObj.templateId || "professional";

                setSelectedTemplate(templateId);
                setJsonData(dataObj);
                setJsonText(JSON.stringify(dataObj, null, 2));
                setFileName(`${dataObj.title}.json`);
                handleGeneratePreview(dataObj, templateId);
                toast.success("Document loaded from history");
            })
            .catch((err) => {
                console.error("Failed to load document:", err);
                setError("Failed to load document from history");
                toast.error("Failed to load document");
            });
    }, [searchParams]);

    useEffect(() => {
        return () => {
            if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
            if (previewUrl) URL.revokeObjectURL(previewUrl);
        };
    }, [previewUrl]);

    const handleTextChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
        const newText = e.target.value;
        setJsonText(newText);

        try {
            const parsed = JSON.parse(newText);
            setJsonData(parsed);
            setError(null);

            if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
            debounceTimerRef.current = setTimeout(() => {
                handleGeneratePreview(parsed);
            }, 800);
        } catch {
            setJsonData(null);
            setError("Invalid JSON format");
        }
    };

    const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        setFileName(file.name);
        const reader = new FileReader();
        reader.onload = (event) => {
            const text = event.target?.result as string;
            setJsonText(text);
            try {
                const parsed = JSON.parse(text);
                setJsonData(parsed);
                setError(null);

                const templateId = parsed.templateId || "professional";
                setSelectedTemplate(templateId);
                handleGeneratePreview(parsed, templateId);
                toast.success("JSON file loaded");
            } catch {
                setError("Invalid JSON file content");
                setModalConfig({
                    isOpen: true,
                    title: "Invalid JSON",
                    message: "The uploaded file could not be parsed. Please verify JSON syntax.",
                    type: "danger",
                });
                toast.error("Invalid JSON file");
            }
        };
        reader.readAsText(file);
    };

    const handleGeneratePreview = async (dataOverride?: PdfData, templateOverride?: string) => {
        const dataToUse = dataOverride || jsonData;
        if (!dataToUse) return;

        const templateToUse = templateOverride || selectedTemplate;

        setIsGenerating(true);
        setError(null);

        try {
            const response = await fetch("/api/generate", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ ...dataToUse, templateId: templateToUse, shouldSave: false }),
            });

            if (!response.ok) throw new Error("Preview generation failed");

            const blob = await response.blob();
            const url = URL.createObjectURL(blob);
            setPreviewUrl((prev) => {
                if (prev) URL.revokeObjectURL(prev);
                return url;
            });
        } catch (err) {
            setError(err instanceof Error ? err.message : "Failed to generate preview");
            setModalConfig({
                isOpen: true,
                title: "Preview failed",
                message: "Could not render the PDF preview. Check JSON structure and try again.",
                type: "warning",
            });
            toast.error("Preview failed");
        } finally {
            setIsGenerating(false);
        }
    };

    const handleTemplateChange = (id: string) => {
        setSelectedTemplate(id);
        if (jsonData) handleGeneratePreview(jsonData, id);
    };

    const handleSaveToDb = async () => {
        if (!jsonData) return;

        setIsSaving(true);
        setError(null);

        try {
            const payload = documentId
                ? { ...jsonData, documentId, templateId: selectedTemplate, shouldSave: true }
                : { ...jsonData, templateId: selectedTemplate, shouldSave: true };

            const response = await fetch("/api/generate", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload),
            });

            if (!response.ok) throw new Error("Failed to save");
            toast.success(documentId ? "Document updated" : "Saved to history");
        } catch {
            setError("Failed to save document");
            toast.error("Failed to save");
        } finally {
            setIsSaving(false);
        }
    };

    const handleDownload = async () => {
        if (!jsonData) return;

        setIsGenerating(true);
        try {
            const response = await fetch("/api/generate", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ ...jsonData, templateId: selectedTemplate, shouldSave: false }),
            });

            const blob = await response.blob();
            downloadBlobAsFile(blob, `${jsonData.title || "nacc-document"}.pdf`);
            toast.success("PDF downloaded");
        } catch {
            setError("Download failed");
            toast.error("Download failed");
        } finally {
            setIsGenerating(false);
        }
    };

    const loadSample = () => {
        setFileName("sample_data.json");
        setSelectedTemplate(SAMPLE_DATA.templateId || "professional");
        setJsonData(SAMPLE_DATA);
        setJsonText(JSON.stringify(SAMPLE_DATA, null, 2));
        setError(null);
        handleGeneratePreview(SAMPLE_DATA, SAMPLE_DATA.templateId);
        toast.success("Sample loaded");
    };

    return (
        <div className="page-container" style={{ width: "min(1480px, calc(100% - 2rem))" }}>
            <header className="page-header">
                <div>
                    <span className="eyebrow">Builder</span>
                    <h1 className="heading-xl mt-3">JSON to PDF Studio</h1>
                    <p className="text-sm text-muted mt-3 max-w-2xl">
                        Edit structured content on the left and preview final PDF output on the right. Save reusable versions directly to history.
                    </p>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                    <input
                        type="file"
                        ref={fileInputRef}
                        onChange={handleFileUpload}
                        className="hidden"
                        accept=".json,application/json"
                    />
                    <button onClick={() => fileInputRef.current?.click()} className="btn btn-secondary">
                        Load JSON
                    </button>
                    <button onClick={loadSample} className="btn btn-ghost">
                        Use Sample
                    </button>
                    <button onClick={() => handleGeneratePreview()} disabled={!jsonData || isGenerating} className="btn btn-secondary">
                        {isGenerating ? "Refreshing..." : "Refresh Preview"}
                    </button>
                    <button onClick={handleSaveToDb} disabled={!jsonData || isSaving} className="btn btn-secondary">
                        {isSaving ? "Saving..." : "Save"}
                    </button>
                    <button onClick={handleDownload} disabled={!jsonData || isGenerating} className="btn btn-primary">
                        Download
                    </button>
                </div>
            </header>

            <section className="surface p-3 mb-3">
                <div className="flex flex-wrap items-center gap-2">
                    <span className="status-badge">File: {fileName || "Not loaded"}</span>
                    <span className="status-badge">Template: {selectedTemplate}</span>
                    <span className="status-badge">
                        <span className="status-dot" />
                        {jsonData ? "Valid JSON" : "Awaiting valid JSON"}
                    </span>
                    {error && <span className="status-badge text-red-700 border-red-200 bg-red-50">{error}</span>}
                </div>
            </section>

            <section className="workspace-grid">
                <article className="workspace-panel">
                    <div className="workspace-panel-header">
                        <div>
                            <p className="text-xs font-bold uppercase tracking-wide text-slate-500">JSON Editor</p>
                            <p className="text-[11px] text-slate-500 mt-1">Paste payload or upload a `.json` file</p>
                        </div>
                        <button onClick={loadSample} className="btn btn-ghost text-xs">
                            Insert sample
                        </button>
                    </div>

                    <div className="workspace-scroll" style={{ minHeight: "520px" }}>
                        <textarea
                            value={jsonText}
                            onChange={handleTextChange}
                            spellCheck={false}
                            className="editor-area"
                            placeholder='{ "title": "Example", "questions": [] }'
                        />
                    </div>
                </article>

                <article className="workspace-panel">
                    <div className="workspace-panel-header flex-col items-start gap-3">
                        <div className="flex w-full items-center justify-between gap-2">
                            <div>
                                <p className="text-xs font-bold uppercase tracking-wide text-slate-500">Preview</p>
                                <p className="text-[11px] text-slate-500 mt-1">Template and final rendering</p>
                            </div>
                            {isGenerating && (
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
                                    Provide valid JSON content and click refresh to generate a live PDF preview.
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
