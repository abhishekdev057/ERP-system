export const ORG_TYPE_OPTIONS = [
    "Coaching Institute",
    "School",
    "College",
    "University",
    "Academy",
    "Training Center",
    "EdTech",
    "Other",
] as const;

export const BRAND_TONE_OPTIONS = [
    "Professional",
    "Academic",
    "Warm",
    "Premium",
    "Results-driven",
    "Youthful",
    "Community-focused",
] as const;

export const DOCUMENT_TYPE_SUGGESTIONS = [
    "Question papers",
    "Worksheets",
    "Notes",
    "Books",
    "Study material",
    "Posters",
    "Brochures",
    "Admissions creatives",
    "Social media creatives",
    "Lecture plans",
] as const;

export type OrganizationProfileInput = {
    name?: unknown;
    orgType?: unknown;
    tagline?: unknown;
    description?: unknown;
    location?: unknown;
    website?: unknown;
    contactEmail?: unknown;
    contactPhone?: unknown;
    primaryContactName?: unknown;
    audienceSummary?: unknown;
    boards?: unknown;
    classLevels?: unknown;
    subjects?: unknown;
    languages?: unknown;
    documentTypes?: unknown;
    workflowNeeds?: unknown;
    creativeNeeds?: unknown;
    aiGoals?: unknown;
    brandTone?: unknown;
    notesForAI?: unknown;
};

export type NormalizedOrganizationProfile = {
    name: string;
    orgType: string | null;
    tagline: string | null;
    description: string | null;
    location: string | null;
    website: string | null;
    contactEmail: string | null;
    contactPhone: string | null;
    primaryContactName: string | null;
    audienceSummary: string | null;
    boards: string[];
    classLevels: string[];
    subjects: string[];
    languages: string[];
    documentTypes: string[];
    workflowNeeds: string | null;
    creativeNeeds: string | null;
    aiGoals: string | null;
    brandTone: string | null;
    notesForAI: string | null;
};

function normalizeWhitespace(value: unknown): string {
    return String(value ?? "").replace(/\s+/g, " ").trim();
}

function normalizeTextArea(value: unknown): string {
    return String(value ?? "")
        .replace(/\r\n?/g, "\n")
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean)
        .join("\n")
        .trim();
}

function normalizeOptionalLine(value: unknown, maxLength: number): string | null {
    const normalized = normalizeWhitespace(value).slice(0, maxLength);
    return normalized || null;
}

function normalizeOptionalText(value: unknown, maxLength: number): string | null {
    const normalized = normalizeTextArea(value).slice(0, maxLength);
    return normalized || null;
}

function normalizeWebsite(value: unknown): string | null {
    const normalized = normalizeWhitespace(value).slice(0, 160);
    if (!normalized) return null;
    if (/^https?:\/\//i.test(normalized)) return normalized;
    return `https://${normalized}`;
}

function normalizeTagList(value: unknown, maxItems = 12): string[] {
    const rawItems = Array.isArray(value)
        ? value
        : String(value ?? "")
              .split(/[\n,]/g)
              .map((item) => item.trim());

    const unique = new Set<string>();
    for (const item of rawItems) {
        const normalized = normalizeWhitespace(item).slice(0, 60);
        if (!normalized) continue;
        unique.add(normalized);
        if (unique.size >= maxItems) break;
    }
    return Array.from(unique);
}

export function normalizeOrganizationProfile(input: OrganizationProfileInput): NormalizedOrganizationProfile {
    return {
        name: normalizeWhitespace(input.name).slice(0, 120),
        orgType: normalizeOptionalLine(input.orgType, 60),
        tagline: normalizeOptionalLine(input.tagline, 120),
        description: normalizeOptionalText(input.description, 800),
        location: normalizeOptionalLine(input.location, 180),
        website: normalizeWebsite(input.website),
        contactEmail: normalizeOptionalLine(input.contactEmail, 120),
        contactPhone: normalizeOptionalLine(input.contactPhone, 40),
        primaryContactName: normalizeOptionalLine(input.primaryContactName, 120),
        audienceSummary: normalizeOptionalText(input.audienceSummary, 500),
        boards: normalizeTagList(input.boards),
        classLevels: normalizeTagList(input.classLevels),
        subjects: normalizeTagList(input.subjects),
        languages: normalizeTagList(input.languages),
        documentTypes: normalizeTagList(input.documentTypes),
        workflowNeeds: normalizeOptionalText(input.workflowNeeds, 1200),
        creativeNeeds: normalizeOptionalText(input.creativeNeeds, 1200),
        aiGoals: normalizeOptionalText(input.aiGoals, 1200),
        brandTone: normalizeOptionalLine(input.brandTone, 60),
        notesForAI: normalizeOptionalText(input.notesForAI, 1200),
    };
}

export function computeOrganizationProfileCompletion(profile: {
    logo?: string | null;
    description?: string | null;
    orgType?: string | null;
    location?: string | null;
    boards?: string[];
    classLevels?: string[];
    subjects?: string[];
    languages?: string[];
    workflowNeeds?: string | null;
    aiGoals?: string | null;
    creativeNeeds?: string | null;
}): { completed: number; total: number; percent: number } {
    const checks = [
        Boolean(profile.logo),
        Boolean(profile.description),
        Boolean(profile.orgType),
        Boolean(profile.location),
        Boolean(profile.boards?.length),
        Boolean(profile.classLevels?.length),
        Boolean(profile.subjects?.length),
        Boolean(profile.languages?.length),
        Boolean(profile.workflowNeeds),
        Boolean(profile.aiGoals),
        Boolean(profile.creativeNeeds),
    ];
    const completed = checks.filter(Boolean).length;
    const total = checks.length;
    return {
        completed,
        total,
        percent: Math.round((completed / total) * 100),
    };
}

export function buildOrganizationAiContext(profile: {
    name: string;
    orgType?: string | null;
    tagline?: string | null;
    description?: string | null;
    location?: string | null;
    audienceSummary?: string | null;
    boards?: string[];
    classLevels?: string[];
    subjects?: string[];
    languages?: string[];
    documentTypes?: string[];
    workflowNeeds?: string | null;
    creativeNeeds?: string | null;
    aiGoals?: string | null;
    brandTone?: string | null;
    notesForAI?: string | null;
}): string {
    const sections = [
        `Institution: ${profile.name}`,
        profile.orgType ? `Type: ${profile.orgType}` : "",
        profile.tagline ? `Tagline: ${profile.tagline}` : "",
        profile.location ? `Location: ${profile.location}` : "",
        profile.description ? `About: ${profile.description}` : "",
        profile.audienceSummary ? `Audience: ${profile.audienceSummary}` : "",
        profile.boards?.length ? `Boards/Exams: ${profile.boards.join(", ")}` : "",
        profile.classLevels?.length ? `Class Levels: ${profile.classLevels.join(", ")}` : "",
        profile.subjects?.length ? `Subjects: ${profile.subjects.join(", ")}` : "",
        profile.languages?.length ? `Languages: ${profile.languages.join(", ")}` : "",
        profile.documentTypes?.length ? `Documents: ${profile.documentTypes.join(", ")}` : "",
        profile.workflowNeeds ? `Workflow Needs: ${profile.workflowNeeds}` : "",
        profile.creativeNeeds ? `Creative Needs: ${profile.creativeNeeds}` : "",
        profile.aiGoals ? `AI Goals: ${profile.aiGoals}` : "",
        profile.brandTone ? `Brand Tone: ${profile.brandTone}` : "",
        profile.notesForAI ? `Special Instructions: ${profile.notesForAI}` : "",
    ].filter(Boolean);

    return sections.join("\n");
}
