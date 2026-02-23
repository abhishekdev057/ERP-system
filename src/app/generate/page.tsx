"use client";

import { useState, useRef, useEffect, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { PdfData } from "@/types/pdf";
import { downloadBlobAsFile } from "@/lib/utils";
import toast from "react-hot-toast";
import Modal from "@/components/ui/Modal";

export default function GeneratePage() {
    return (
        <Suspense fallback={<div className="p-8 text-center text-slate-700 text-xs">Loading...</div>}>
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

    // Modal state
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
        type: "info"
    });

    useEffect(() => {
        const loadId = searchParams.get("load");
        if (loadId) {
            setDocumentId(loadId);
            fetch(`/api/documents/${loadId}`)
                .then((res) => res.json())
                .then((data) => {
                    if (data.document) {
                        const dataObj = data.document.jsonData as PdfData;
                        setJsonData(dataObj);
                        setJsonText(JSON.stringify(dataObj, null, 2));
                        setFileName(`${dataObj.title}.json`);
                        handleGeneratePreview(dataObj);
                        toast.success("Document loaded from history");
                    }
                })
                .catch((err) => {
                    console.error("Failed to load document:", err);
                    setError("Failed to load document from history");
                    toast.error("Failed to load document");
                });
        }
    }, [searchParams]);

    const handleTextChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
        const newText = e.target.value;
        setJsonText(newText);
        try {
            const parsed = JSON.parse(newText);
            setJsonData(parsed);
            setError(null);

            // Live Preview Debounce
            if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
            debounceTimerRef.current = setTimeout(() => {
                handleGeneratePreview(parsed);
            }, 1000);
        } catch (err) {
            setJsonData(null);
            setError("Invalid JSON format");
            // No toast here to avoid spamming while typing
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
                handleGeneratePreview(parsed);
                toast.success("JSON file loaded successfully");
            } catch (err) {
                setError("Invalid JSON file content");
                setModalConfig({
                    isOpen: true,
                    title: "Invalid File",
                    message: "The JSON content in this file is invalid. Please check the syntax.",
                    type: "danger"
                });
                toast.error("Failed to load JSON file");
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
            if (previewUrl) URL.revokeObjectURL(previewUrl);
            setPreviewUrl(url);
            // Silent success for preview
        } catch (err) {
            setError(err instanceof Error ? err.message : "Failed to generate preview");
            setModalConfig({
                isOpen: true,
                title: "Preview Error",
                message: "Something went wrong while generating the preview. Please check your JSON data.",
                type: "warning"
            });
            toast.error("Preview failed");
        } finally {
            setIsGenerating(false);
        }
    };

    const handleTemplateChange = (id: string) => {
        setSelectedTemplate(id);
        handleGeneratePreview(undefined, id);
    };

    const handleSaveToDb = async () => {
        if (!jsonData) return;
        setIsSaving(true);
        setError(null);
        try {
            const payload = documentId
                ? { ...jsonData, documentId, shouldSave: true }
                : { ...jsonData, shouldSave: true };

            const response = await fetch("/api/generate", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload),
            });

            if (!response.ok) throw new Error("Failed to save to database");
            toast.success(documentId ? "Document updated successfully!" : "Saved to history successfully!");
        } catch (err) {
            setError("Failed to save to database");
            toast.error("Failed to save to database");
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
            toast.success("PDF downloaded successfully!");
        } catch (err) {
            setError("Download failed");
            setModalConfig({
                isOpen: true,
                title: "Download Failed",
                message: "Could not generate or download the PDF. Please try again.",
                type: "danger"
            });
            toast.error("Download failed");
        } finally {
            setIsGenerating(false);
        }
    };

    return (
        <div className="h-[calc(100vh-70px)] overflow-hidden flex flex-col">
            {/* Toolbar */}
            <div className="bg-white/80 backdrop-blur-xl border-b border-white/50 px-5 py-3 flex flex-col gap-3 z-20 shadow-lg">
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <button
                            onClick={() => fileInputRef.current?.click()}
                            className="text-xs font-semibold text-slate-600 hover:text-slate-900 flex items-center gap-2 transition-colors px-3 py-1.5 rounded-lg hover:bg-white/80"
                        >
                            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="17 8 12 3 7 8" /><line x1="12" y1="3" x2="12" y2="15" /></svg>
                            {fileName || "Load JSON"}
                        </button>
                        <input type="file" ref={fileInputRef} onChange={handleFileUpload} className="hidden" accept=".json" />
                        <div className="h-5 w-[1px] bg-slate-200" />
                        {error && (
                            <span className="text-red-500 text-xs font-medium flex items-center gap-1.5">
                                <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>
                                {error}
                            </span>
                        )}
                    </div>

                    <div className="flex items-center gap-2">
                        <button
                            onClick={() => handleGeneratePreview()}
                            disabled={!jsonData || isGenerating}
                            className="px-4 py-2 rounded-lg bg-gradient-to-r from-cyan-50 to-cyan-100 text-cyan-700 text-xs font-semibold hover:from-cyan-100 hover:to-cyan-150 transition-all flex items-center gap-2 disabled:opacity-40 shadow-sm"
                        >
                            {isGenerating ? (
                                <>
                                    <div className="spinner w-3 h-3" />
                                    Refreshing...
                                </>
                            ) : (
                                <>
                                    <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.2" /></svg>
                                    Refresh Preview
                                </>
                            )}
                        </button>
                        <button
                            onClick={handleSaveToDb}
                            disabled={!jsonData || isSaving}
                            className="px-4 py-2 rounded-lg bg-gradient-to-r from-emerald-50 to-emerald-100 text-emerald-700 text-xs font-semibold hover:from-emerald-100 hover:to-emerald-150 transition-all flex items-center gap-2 disabled:opacity-40 shadow-sm"
                        >
                            {isSaving ? (
                                <>
                                    <div className="spinner w-3 h-3" />
                                    Saving...
                                </>
                            ) : (
                                <>
                                    <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"></path><polyline points="17 21 17 13 7 13 7 21"></polyline><polyline points="7 3 7 8 15 8"></polyline></svg>
                                    Save
                                </>
                            )}
                        </button>
                        <button
                            onClick={handleDownload}
                            disabled={!jsonData || isGenerating}
                            className="glow-btn text-xs px-4 py-2"
                        >
                            <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
                            Download
                        </button>
                    </div>
                </div>

                {/* Templates Selector - Only show when there is a preview */}
                {previewUrl && (
                    <div className="flex items-center gap-3 animate-fade-in">
                        <span className="text-[10px] font-bold text-slate-400 uppercase tracking-tighter">Choose Template:</span>
                        <div className="flex gap-2">
                            {[
                                { id: "professional", name: "Professional", color: "bg-[#0E1932]" },
                                { id: "classic", name: "Classic Professional", color: "bg-[#0E1932] border border-white/20" },
                                { id: "minimal", name: "Minimal", color: "bg-white border" },
                                { id: "academic", name: "Academic", color: "bg-[#FDFBF7] border" },
                                { id: "sleek", name: "Modern Sleek", color: "bg-[#111111]" },
                                { id: "agriculture", name: "Agriculture", color: "bg-[#F0FDF4] border" }
                            ].map((t) => (
                                <button
                                    key={t.id}
                                    onClick={() => handleTemplateChange(t.id)}
                                    className={`px-3 py-1.5 rounded-lg text-[10px] font-bold transition-all flex items-center gap-2 border-2 ${selectedTemplate === t.id
                                        ? "border-amber-400 bg-amber-50 text-amber-900 shadow-sm scale-105"
                                        : "border-transparent bg-slate-50 text-slate-500 hover:bg-slate-100"
                                        }`}
                                >
                                    <div className={`w-2.5 h-2.5 rounded-full ${t.color}`} />
                                    {t.name}
                                </button>
                            ))}
                        </div>
                    </div>
                )}
            </div>

            {/* Split Screen Editor */}
            <div className="flex-1 flex overflow-hidden">
                {/* Left: JSON Editor */}
                <div className="w-1/2 flex flex-col border-r border-slate-100 bg-slate-50/50">
                    <div className="flex-1 relative overflow-hidden group">
                        <div className="absolute top-3 left-3 z-10">
                            <span className="text-[9px] font-black text-slate-500 uppercase tracking-widest bg-white/90 px-2.5 py-1 rounded-lg shadow-sm">JSON Editor</span>
                        </div>
                        <textarea
                            value={jsonText}
                            onChange={handleTextChange}
                            spellCheck={false}
                            className="absolute inset-0 w-full h-full bg-transparent p-4 pt-12 text-slate-800 font-mono text-xs resize-none focus:outline-none placeholder:text-slate-400 custom-scrollbar"
                            placeholder='{ "title": "Example", ... }'
                        />
                    </div>
                </div>

                {/* Right: PDF Preview */}
                <div className="w-1/2 relative bg-slate-100/50">
                    {previewUrl ? (
                        <iframe
                            src={`${previewUrl}#toolbar=0&navpanes=0`}
                            className="w-full h-full border-none"
                            title="PDF Preview"
                        />
                    ) : (
                        <div className="h-full flex flex-col items-center justify-center p-14 text-center">
                            <div className="w-16 h-16 rounded-2xl bg-white border border-slate-100 flex items-center justify-center mb-4 animate-float-slow shadow-lg">
                                <svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"></path><polyline points="14 2 14 8 20 8"></polyline></svg>
                            </div>
                            <h3 className="text-base font-bold text-slate-800 mb-2">No Preview Available</h3>
                            <p className="text-xs text-slate-500 max-w-xs mb-4">
                                Enter valid JSON data in the editor or upload a file to see the live PDF preview here.
                            </p>
                            <div className="glass-card p-3">
                                <p className="text-[10px] text-slate-400 font-medium">
                                    Tip: Upload a JSON file to get started quickly
                                </p>
                            </div>
                        </div>
                    )}
                </div>
            </div>

            <Modal
                isOpen={modalConfig.isOpen}
                onClose={() => setModalConfig({ ...modalConfig, isOpen: false })}
                onConfirm={modalConfig.onConfirm}
                title={modalConfig.title}
                message={modalConfig.message}
                type={modalConfig.type}
            />
        </div>
    );
}
