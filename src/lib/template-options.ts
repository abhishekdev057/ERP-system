export interface TemplateOption {
    id: string;
    name: string;
    tone: string;
    category: string;
    description: string;
    shortLabel: string;
}

export const TEMPLATE_OPTIONS: TemplateOption[] = [
    {
        id: "professional",
        name: "Professional",
        tone: "#1e293b",
        category: "Dark Deck",
        description: "Balanced premium layout for general classroom and institute decks.",
        shortLabel: "Pr",
    },
    {
        id: "classic",
        name: "Classic",
        tone: "#334155",
        category: "Formal",
        description: "Conservative dark presentation style with a traditional exam feel.",
        shortLabel: "Cl",
    },
    {
        id: "minimal",
        name: "Minimal",
        tone: "#94a3b8",
        category: "Light Deck",
        description: "Clean light slides focused on readability and compact content.",
        shortLabel: "Mi",
    },
    {
        id: "academic",
        name: "Academic",
        tone: "#9a3412",
        category: "Paper Tone",
        description: "Warm academic styling that feels closer to notes and printed study material.",
        shortLabel: "Ac",
    },
    {
        id: "sleek",
        name: "Sleek",
        tone: "#111827",
        category: "Modern",
        description: "High-contrast contemporary deck for polished visual delivery.",
        shortLabel: "Sl",
    },
    {
        id: "agriculture",
        name: "Agriculture",
        tone: "#166534",
        category: "Subject Theme",
        description: "Green-forward subject template tailored for agriculture content.",
        shortLabel: "Ag",
    },
    {
        id: "simple",
        name: "Simple Authentic",
        tone: "#3b82f6",
        category: "Transparent",
        description: "Image-led overlay template with minimal visual chrome.",
        shortLabel: "Si",
    },
    {
        id: "board",
        name: "Green Board",
        tone: "#2f6d3a",
        category: "Chalk Style",
        description: "Board-style classroom look for handwritten or lecture-style visuals.",
        shortLabel: "Bd",
    },
];
