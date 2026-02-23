"use client";

import { useState, useRef, useEffect, Suspense } from "react";
import { PdfData, Question, QuestionOption } from "@/types/pdf";
import { downloadBlobAsFile } from "@/lib/utils";
import toast from "react-hot-toast";
import Modal from "@/components/ui/Modal";

export default function ImageToPdfPage() {
    return (
        <Suspense fallback={<div className="p-8 text-center text-slate-700 text-xs">Loading...</div>}>
            <ImageToPdfContent />
        </Suspense>
    );
}

function ImageToPdfContent() {
    const [imageDataUrl, setImageDataUrl] = useState<string | null>(null);
    const [isExtracting, setIsExtracting] = useState(false);

    // The structured data for a SINGLE question slide
    const [pdfData, setPdfData] = useState<PdfData>({
        title: "Extracted Question",
        date: new Date().toLocaleDateString("en-GB").replace(/\//g, "-"), // DD-MM-YYYY format matching existing style
        instituteName: "NACC AGRICULTURE INSTITUTE",
        questions: [{
            number: "1",
            questionHindi: "",
            questionEnglish: "",
            options: [
                { hindi: "", english: "" },
                { hindi: "", english: "" },
                { hindi: "", english: "" },
                { hindi: "", english: "" }
            ]
        }],
        templateId: "professional"
    });

    const [isGeneratingPreview, setIsGeneratingPreview] = useState(false);
    const [previewUrl, setPreviewUrl] = useState<string | null>(null);
    const [selectedTemplate, setSelectedTemplate] = useState("professional");
    const fileInputRef = useRef<HTMLInputElement>(null);
    const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);

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

    // Handle Image Upload
    const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        // Reset state
        setIsExtracting(true);
        setPreviewUrl(null);

        // Show image immediately
        const reader = new FileReader();
        reader.onload = (event) => {
            setImageDataUrl(event.target?.result as string);
        };
        reader.readAsDataURL(file);

        // Call extraction API
        const formData = new FormData();
        formData.append("image", file);

        try {
            const res = await fetch("/api/extract-image", {
                method: "POST",
                body: formData
            });

            const data = await res.json();

            if (!res.ok) {
                throw new Error(data.error || "Failed to extract text from image.");
            }

            // data should be the extracted Question object
            const newPdfData: PdfData = {
                ...pdfData,
                questions: [{
                    number: "1",
                    questionHindi: data.questionHindi || "",
                    questionEnglish: data.questionEnglish || "",
                    options: data.options || [
                        { hindi: "", english: "" },
                        { hindi: "", english: "" },
                        { hindi: "", english: "" },
                        { hindi: "", english: "" }
                    ]
                }]
            };

            setPdfData(newPdfData);
            toast.success("Text extracted successfully! Please review and fix any errors.");
            handleGeneratePreview(newPdfData);

        } catch (error: any) {
            console.error("Extraction error:", error);
            setModalConfig({
                isOpen: true,
                title: "Extraction Failed",
                message: error.message || "Failed to extract text using Vision AI. Please ensure your GEMINI_API_KEY is configured correctly.",
                type: "danger"
            });
            toast.error("Failed to extract text from image");
        } finally {
            setIsExtracting(false);
        }
    };

    // Live Preview Generation
    const handleGeneratePreview = async (dataToUse: PdfData = pdfData, templateId: string = selectedTemplate) => {
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
            if (previewUrl) URL.revokeObjectURL(previewUrl);
            setPreviewUrl(url);
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

    // Form Change Handlers with Debounced Preview
    const updateQuestionField = (field: keyof Question, value: string) => {
        const newQuestions = [...pdfData.questions];
        // @ts-ignore
        newQuestions[0][field] = value;
        const newData = { ...pdfData, questions: newQuestions };
        setPdfData(newData);
        debouncedPreview(newData);
    };

    const updateOptionField = (index: number, language: keyof QuestionOption, value: string) => {
        const newQuestions = [...pdfData.questions];
        newQuestions[0].options[index][language] = value;
        const newData = { ...pdfData, questions: newQuestions };
        setPdfData(newData);
        debouncedPreview(newData);
    };

    const debouncedPreview = (newData: PdfData) => {
        if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
        debounceTimerRef.current = setTimeout(() => {
            handleGeneratePreview(newData);
        }, 1000);
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
            downloadBlobAsFile(blob, `nacc-extracted-question.pdf`);
            toast.success("PDF downloaded successfully!");
        } catch (err) {
            console.error(err);
            toast.error("Download failed");
        } finally {
            setIsGeneratingPreview(false);
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
                            className="bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold flex items-center gap-2 transition-colors px-4 py-2 rounded-lg shadow-sm"
                            disabled={isExtracting}
                        >
                            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2" /><circle cx="8.5" cy="8.5" r="1.5" /><polyline points="21 15 16 10 5 21" /></svg>
                            {isExtracting ? "Extracting..." : "Upload Image"}
                        </button>
                        <input type="file" ref={fileInputRef} onChange={handleImageUpload} className="hidden" accept="image/*" />

                        {isExtracting && (
                            <div className="flex items-center gap-2 text-indigo-600 text-xs font-medium">
                                <div className="spinner w-4 h-4 border-2 border-indigo-200 border-t-indigo-600 rounded-full animate-spin" />
                                Analyzing image with Vision AI...
                            </div>
                        )}
                    </div>

                    <div className="flex items-center gap-2">
                        <button
                            onClick={() => handleGeneratePreview()}
                            disabled={isGeneratingPreview || isExtracting}
                            className="px-4 py-2 rounded-lg bg-slate-100 text-slate-700 text-xs font-semibold hover:bg-slate-200 transition-all flex items-center gap-2 shadow-sm"
                        >
                            Refresh Preview
                        </button>
                        <button
                            onClick={handleDownload}
                            disabled={isGeneratingPreview || isExtracting || !previewUrl}
                            className="glow-btn text-xs px-4 py-2 bg-slate-900 text-white rounded-lg hover:bg-slate-800 transition-all shadow-md flex items-center gap-2"
                        >
                            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
                            Download PDF
                        </button>
                    </div>
                </div>

                {/* Templates Selector */}
                <div className="flex items-center gap-3 animate-fade-in">
                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-tighter">Template:</span>
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
                                    ? "border-indigo-400 bg-indigo-50 text-indigo-900 shadow-sm scale-105"
                                    : "border-transparent bg-slate-50 text-slate-500 hover:bg-slate-100"
                                    }`}
                            >
                                <div className={`w-2.5 h-2.5 rounded-full ${t.color}`} />
                                {t.name}
                            </button>
                        ))}
                    </div>
                </div>
            </div>

            {/* Split Screen Editor */}
            <div className="flex-1 flex overflow-hidden">
                {/* Left: Editable Form */}
                <div className="w-1/2 flex flex-col border-r border-slate-200 bg-white overflow-y-auto custom-scrollbar">

                    {/* Header Details */}
                    <div className="p-4 border-b border-slate-100 grid grid-cols-2 gap-4">
                        <div>
                            <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Title</label>
                            <input
                                type="text"
                                value={pdfData.title}
                                onChange={(e) => {
                                    setPdfData(prev => ({ ...prev, title: e.target.value }));
                                    debouncedPreview({ ...pdfData, title: e.target.value });
                                }}
                                className="w-full text-sm p-2 bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                            />
                        </div>
                        <div>
                            <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Date</label>
                            <input
                                type="text"
                                value={pdfData.date}
                                onChange={(e) => {
                                    setPdfData(prev => ({ ...prev, date: e.target.value }));
                                    debouncedPreview({ ...pdfData, date: e.target.value });
                                }}
                                className="w-full text-sm p-2 bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                            />
                        </div>
                    </div>

                    <div className="p-6 flex flex-col gap-6">
                        {/* Selected Image Preview (Small) */}
                        {imageDataUrl && (
                            <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl flex gap-4 items-center">
                                <img src={imageDataUrl} className="h-16 w-16 object-cover rounded-lg shadow-sm border border-slate-200" alt="Uploaded" />
                                <div className="text-xs text-slate-600">
                                    <p className="font-semibold text-slate-800">Source Image</p>
                                    <p>Text extracted. You can edit the structure below.</p>
                                </div>
                            </div>
                        )}

                        {!imageDataUrl && !isExtracting && (
                            <div
                                onClick={() => fileInputRef.current?.click()}
                                className="border-2 border-dashed border-indigo-200 bg-indigo-50/50 rounded-2xl p-8 text-center cursor-pointer hover:bg-indigo-50 transition-colors"
                            >
                                <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="mx-auto text-indigo-400 mb-4"><rect x="3" y="3" width="18" height="18" rx="2" ry="2" /><circle cx="8.5" cy="8.5" r="1.5" /><polyline points="21 15 16 10 5 21" /></svg>
                                <h3 className="text-sm font-semibold text-indigo-900 mb-1">Upload an Image</h3>
                                <p className="text-xs text-indigo-500/80">Click or drag a screenshot of a question here to automatically extract the text and options.</p>
                            </div>
                        )}

                        <div className="space-y-4">
                            <div>
                                <label className="block text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1.5">Question (Hindi)</label>
                                <textarea
                                    value={pdfData.questions[0].questionHindi}
                                    onChange={(e) => updateQuestionField("questionHindi", e.target.value)}
                                    className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl text-sm font-hindi resize-y min-h-[80px] focus:outline-none focus:ring-2 focus:ring-indigo-500/20 shadow-inner"
                                    placeholder="हिंदी में प्रश्न यहां दर्ज करें..."
                                />
                            </div>

                            <div>
                                <label className="block text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1.5">Question (English)</label>
                                <textarea
                                    value={pdfData.questions[0].questionEnglish}
                                    onChange={(e) => updateQuestionField("questionEnglish", e.target.value)}
                                    className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl text-sm resize-y min-h-[80px] focus:outline-none focus:ring-2 focus:ring-indigo-500/20 shadow-inner"
                                    placeholder="Enter question in English here..."
                                />
                            </div>
                        </div>

                        <div className="space-y-4">
                            <h3 className="text-[11px] font-bold text-slate-500 uppercase tracking-wider border-b border-slate-100 pb-2">Options</h3>

                            {pdfData.questions[0].options.map((option, idx) => (
                                <div key={idx} className="bg-slate-50/50 p-4 rounded-xl border border-slate-100 flex gap-4">
                                    <div className="flex-shrink-0 w-8 h-8 bg-white rounded-full flex items-center justify-center font-bold text-slate-400 border border-slate-200 mt-1">
                                        {idx + 1}
                                    </div>
                                    <div className="flex-1 space-y-3">
                                        <div>
                                            <input
                                                type="text"
                                                value={option.hindi}
                                                onChange={(e) => updateOptionField(idx, "hindi", e.target.value)}
                                                className="w-full p-2 bg-white border border-slate-200 rounded-lg text-sm font-hindi focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                                                placeholder={`विकल्प ${idx + 1}`}
                                            />
                                        </div>
                                        <div>
                                            <input
                                                type="text"
                                                value={option.english}
                                                onChange={(e) => updateOptionField(idx, "english", e.target.value)}
                                                className="w-full p-2 bg-white border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                                                placeholder={`Option ${idx + 1}`}
                                            />
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
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
                            <div className="w-16 h-16 rounded-2xl bg-white border border-slate-100 flex items-center justify-center mb-4 animate-float-slow shadow-lg text-indigo-400">
                                <svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"></path><polyline points="14 2 14 8 20 8"></polyline></svg>
                            </div>
                            <h3 className="text-base font-bold text-slate-800 mb-2">Live Preview</h3>
                            <p className="text-xs text-slate-500 max-w-xs mb-4">
                                Upload an image or type in the form to see your PDF update in real-time.
                            </p>
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
