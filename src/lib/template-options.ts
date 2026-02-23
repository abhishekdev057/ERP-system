export interface TemplateOption {
    id: string;
    name: string;
    tone: string;
}

export const TEMPLATE_OPTIONS: TemplateOption[] = [
    { id: "professional", name: "Professional", tone: "#1e293b" },
    { id: "classic", name: "Classic", tone: "#334155" },
    { id: "minimal", name: "Minimal", tone: "#94a3b8" },
    { id: "academic", name: "Academic", tone: "#9a3412" },
    { id: "sleek", name: "Sleek", tone: "#111827" },
    { id: "agriculture", name: "Agriculture", tone: "#166534" },
];
