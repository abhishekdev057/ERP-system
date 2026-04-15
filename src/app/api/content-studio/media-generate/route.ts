import { access, mkdir, readFile, writeFile } from "fs/promises";
import path from "path";
import { NextRequest, NextResponse } from "next/server";
import { GoogleGenerativeAI } from "@google/generative-ai";
import sharp from "sharp";
import { enforceToolAccess } from "@/lib/api-auth";
import {
    buildGeminiRateLimitMessage,
    getGeminiUsageSummary,
    parseGeminiRateLimitInfo,
    recordGeminiUsage,
    setGeminiRateBlocked,
} from "@/lib/gemini-usage";
import { prisma } from "@/lib/prisma";
import {
    isPromotionalCreativePrompt,
    loadMediaKnowledgeContextForPrompt,
    type MediaKnowledgeReference,
} from "@/lib/media-rag";
import {
    buildOrganizationCreativeContext,
    buildOrganizationCreativeSummary,
} from "@/lib/organization-profile";

export const dynamic = "force-dynamic";

type MediaMode =
    | "text_to_image"
    | "text_to_video"
    | "image_from_reference"
    | "video_from_reference";

type ImageModelSelection = "auto" | "nexen" | "nexen_2";

type RequestBody = {
    mode?: MediaMode;
    prompt?: string;
    style?: string;
    aspectRatio?: string;
    durationSec?: number;
    referenceName?: string;
    imageModel?: ImageModelSelection;
};

type SavedMediaRecord = {
    id: string;
    mode: MediaMode;
    status: string;
    type: "image" | "video" | "video_plan";
    prompt: string;
    effectivePrompt?: string;
    style: string;
    aspectRatio: string;
    durationSec?: number;
    referenceName?: string | null;
    organizationLogoUrl?: string | null;
    organizationName?: string | null;
    organizationSummary?: string | null;
    institutionContextApplied?: boolean;
    knowledgeReferences?: MediaKnowledgeReference[];
    assetUrl?: string;
    storyboard?: string[];
    note?: string;
    createdAt: string;
};

type MediaOrganizationContextState = {
    organizationLogoUrl: string | null;
    organizationName: string | null;
    organizationSummary: string;
    organizationContext: string;
    organizationContextApplied: boolean;
};

type MediaKnowledgeContextState = {
    knowledgeContext: string;
    references: MediaKnowledgeReference[];
    availableBookCount: number;
    availableDocumentCount: number;
    availableMemberCount: number;
    availableStudentCount: number;
    availableGeneratedMediaCount: number;
    availableScheduleCount: number;
    availableWhiteboardCount: number;
    totalIndexedItems: number;
    indexSummary: unknown | null;
};

type SavedMediaListPage = {
    items: SavedMediaRecord[];
    total: number;
    offset: number;
    limit: number;
    hasMore: boolean;
};

const mediaOrganizationSelect = {
    logo: true,
    name: true,
    orgType: true,
    tagline: true,
    description: true,
    location: true,
    audienceSummary: true,
    boards: true,
    classLevels: true,
    subjects: true,
    languages: true,
    creativeNeeds: true,
    aiGoals: true,
    brandTone: true,
    notesForAI: true,
} as const;

const GEMINI_API_BASE_URL = "https://generativelanguage.googleapis.com/v1beta";
const GEMINI_TEXT_MODEL = "gemini-2.5-flash";
const GEMINI_IMAGE_MODEL_NANO_BANANA = "gemini-2.5-flash-image";
const GEMINI_IMAGE_MODEL_NANO_BANANA_2 = "gemini-3.1-flash-image-preview";
const GEMINI_VIDEO_MODEL = "veo-3.1-generate-preview";
const DEFAULT_IMAGE_MODEL_SELECTION: ImageModelSelection = "auto";
const MAX_INLINE_REFERENCE_BYTES = 20 * 1024 * 1024;
const VIDEO_POLL_INTERVAL_MS = 10000;
const VIDEO_POLL_TIMEOUT_MS = 5 * 60 * 1000;
const MAX_LOGO_REFERENCE_EDGE = 768;
const ORGANIZATION_CONTEXT_CACHE_TTL_MS = 5 * 60 * 1000;
const LOGO_INLINE_PART_CACHE_TTL_MS = 10 * 60 * 1000;
const REFERENCE_ASSET_CACHE_TTL_MS = 5 * 60 * 1000;

type InlineImagePart = {
    inline_data: {
        mime_type: string;
        data: string;
    };
};

type InlineReferenceAsset = {
    mimeType: string;
    data: string;
    kind: "image" | "video";
};

type ImageValidationResult = {
    passes: boolean;
    issues: string[];
    observedVisibleText?: string[];
    extraVisibleText?: string[];
    missingRequiredText?: string[];
};

type TimedCacheEntry<T> = {
    expiresAt: number;
    value: T;
};

const mediaOrganizationContextCache = new Map<string, TimedCacheEntry<MediaOrganizationContextState>>();
const mediaLogoInlinePartCache = new Map<string, TimedCacheEntry<InlineImagePart | null>>();
const mediaReferenceAssetCache = new Map<string, TimedCacheEntry<InlineReferenceAsset | null>>();

function readTimedCache<T>(cache: Map<string, TimedCacheEntry<T>>, key: string): T | null {
    const entry = cache.get(key);
    if (!entry) return null;
    if (entry.expiresAt <= Date.now()) {
        cache.delete(key);
        return null;
    }
    return entry.value;
}

function writeTimedCache<T>(
    cache: Map<string, TimedCacheEntry<T>>,
    key: string,
    value: T,
    ttlMs: number
) {
    cache.set(key, {
        value,
        expiresAt: Date.now() + ttlMs,
    });
}

function sanitizePrompt(input: string): string {
    return input.replace(/\s+/g, " ").trim().slice(0, 400);
}

function sanitizePromptFragment(input: string, maxLength: number): string {
    return input.replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function sanitizeReferenceName(input: string | undefined): string {
    return sanitizePromptFragment(String(input || "").replace(/[^\w.\- ]+/g, " "), 120);
}

function extractJsonObject(input: string): string {
    const trimmed = String(input || "").trim();
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");

    if (start === -1 || end === -1 || end < start) {
        throw new Error("Model did not return valid JSON.");
    }

    return trimmed.slice(start, end + 1);
}

function inferPromptAspectRatio(prompt: string, mode: MediaMode): string {
    const normalized = String(prompt || "").toLowerCase();

    // 16:9 triggers
    if (/(?:^|\D)16:9(?:\D|$)/.test(normalized) || /\b(widescreen|youtube thumbnail|yt thumbnail|presentation slide|desktop banner|website hero|thumbnail)\b/.test(normalized) ||
        (/\byoutube\b/.test(normalized) && /\b(banner|cover|video|post)\b/.test(normalized) && !/\bshort\b/.test(normalized))) {
        return "16:9";
    }

    // 9:16 triggers
    if (/(?:^|\D)9:16(?:\D|$)/.test(normalized) || /\b(vertical video|portrait poster|instagram reel|ig reel|youtube short|yt short|whatsapp status|ig story|instagram story|tiktok|snapchat)\b/.test(normalized) ||
        (/\b(reel|reels)\b/.test(normalized) && !/\b(real|realistic)\b/.test(normalized))) {
        return "9:16";
    }

    // 1:1 triggers
    if (/(?:^|\D)1:1(?:\D|$)/.test(normalized) || /\b(square layout|profile picture|dp|institute logo|app icon|badge)\b/.test(normalized) ||
        (/\blogo\b/.test(normalized) && /\b(create|make|design)\b/.test(normalized))) {
        return "1:1";
    }

    // 4:5 triggers
    if (/(?:^|\D)4:5(?:\D|$)/.test(normalized) || /\b(instagram post|ig post|social media flyer|pamphlet|vertical post|facebook post|linkedin post)\b/.test(normalized)) {
        return "4:5";
    }

    // Fallbacks based on explicit single-word intent if no advanced match
    if (/\b(landscape|wide|presentation|slide)\b/.test(normalized)) return "16:9";
    if (/\b(portrait|vertical|story|status)\b/.test(normalized)) return "9:16";
    if (/\b(square|logo|icon)\b/.test(normalized)) return "1:1";
    if (/\b(poster|flyer|brochure|admission post|social post)\b/.test(normalized)) return "4:5";

    return mode === "text_to_video" || mode === "video_from_reference" ? "16:9" : "4:5";
}

function inferPromptStyle(prompt: string): string {
    const normalized = String(prompt || "").toLowerCase();

    if (/\b(cinematic|cinema|filmic)\b/.test(normalized)) return "cinematic";
    if (/\b(realistic|photoreal|photographic)\b/.test(normalized)) return "photoreal";
    if (/\b(minimal|minimalist|clean)\b/.test(normalized)) return "minimal";
    if (/\b(illustration|illustrated|drawn)\b/.test(normalized)) return "illustrative";
    if (/\b(3d|three dimensional|render)\b/.test(normalized)) return "3D";
    if (/\b(vector|flat)\b/.test(normalized)) return "vector";
    if (/\b(luxury|premium|elite)\b/.test(normalized)) return "premium editorial";
    if (/\b(anime|manga)\b/.test(normalized)) return "anime";

    return "";
}

function buildTextRenderingInstruction(mode: MediaMode, prompt: string): string {
    const normalized = String(prompt || "").toLowerCase();
    if (promptRequestsMinimalCopy(prompt)) {
        return "Render only the exact minimal text requested in the brief. Keep that text fully legible, correctly spelled, complete, unclipped, and free from extra slogans, captions, or filler copy.";
    }
    const wantsVisibleText =
        isPromotionalCreativePrompt(prompt) ||
        [
            "headline",
            "copy",
            "caption",
            "cta",
            "text in image",
            "thumbnail",
            "cover",
            "quote card",
            "event poster",
            "announcement",
            "social post",
            "social creative",
            "ad creative",
            "admission open",
            "admissions open",
            "offer",
            "launch",
            "title",
            "poster",
            "banner",
            "flyer",
        ].some((term) => normalized.includes(term));

    if (mode === "text_to_video" || mode === "video_from_reference") {
        if (!wantsVisibleText) {
            return "Use on-screen text only if the prompt genuinely needs it. If any text appears, keep it short, clean, fully legible, correctly spelled, stable, and never glitched, cropped, duplicated, or malformed.";
        }

        return "If the video includes visible text, render only concise high-value text that matches the prompt exactly. Text must be fully legible, correctly spelled, well-aligned, stable across frames, and never gibberish, duplicated, cropped, warped, or broken.";
    }

    if (!wantsVisibleText) {
        return "";
    }

    return "If the image includes any headline, caption, CTA, institute name, or other visible text, render it directly inside the image with excellent typography. Text must be correctly spelled, fully legible, complete, uncropped, cleanly aligned, and faithful to the prompt language and meaning. Prefer fewer, larger text groups instead of many tiny lines. Do not cram dense paragraphs, micro-bullets, broken line wraps, random symbols, malformed letters, duplicate words, or cut-off text.";
}

function resolveImageModel(selection: string | undefined | null): {
    selection: ImageModelSelection;
    apiModel: string;
    label: string;
} {
    const normalized = String(selection || "").trim().toLowerCase();
    const chosen: ImageModelSelection =
        normalized === "auto" ||
        normalized === "nexen" ||
        normalized === "nexen_2" ||
        normalized === "nano_banana" ||
        normalized === "nano_banana_2"
            ? ((normalized === "nano_banana_2"
                  ? "nexen_2"
                  : normalized === "nano_banana"
                    ? "nexen"
                    : normalized) as ImageModelSelection)
            : DEFAULT_IMAGE_MODEL_SELECTION;

    switch (chosen) {
        case "auto":
            return {
                selection: chosen,
                apiModel: GEMINI_IMAGE_MODEL_NANO_BANANA_2,
                label: "Auto · Nexen Flash",
            };
        case "nexen_2":
            return {
                selection: chosen,
                apiModel: GEMINI_IMAGE_MODEL_NANO_BANANA_2,
                label: "Nexen 2 (Nexen Flash Image)",
            };
        case "nexen":
        default:
            return {
                selection: chosen,
                apiModel: GEMINI_IMAGE_MODEL_NANO_BANANA,
                label: "Nexen",
            };
    }
}

function resolveImageModelForRequest(options: {
    selection: ImageModelSelection;
    prompt: string;
    mode: MediaMode;
    hasReferenceFile: boolean;
    hasAttachmentFiles: boolean;
    logoRequired: boolean;
}): {
    selection: ImageModelSelection;
    apiModel: string;
    label: string;
} {
    const wantsStrictText = Boolean(buildTextRenderingInstruction(options.mode, options.prompt));
    const needsHighFidelity =
        options.hasReferenceFile ||
        options.hasAttachmentFiles ||
        options.logoRequired ||
        wantsStrictText ||
        promptRequestsMinimalCopy(options.prompt);

    if (options.selection === "auto") {
        return needsHighFidelity
            ? {
                  selection: "auto",
                  apiModel: GEMINI_IMAGE_MODEL_NANO_BANANA_2,
                  label: "Auto · Nexen 2 (strict fidelity)",
              }
            : {
                  selection: "auto",
                  apiModel: GEMINI_IMAGE_MODEL_NANO_BANANA,
                  label: "Auto · Nexen (fast lane)",
              };
    }

    return resolveImageModel(options.selection);
}

function promptRequestsMinimalCopy(prompt: string): boolean {
    const normalized = String(prompt || "").toLowerCase();
    return [
        "no content",
        "content na ho",
        "content nahi",
        "sirf",
        "bas",
        "bss",
        "only logo",
        "just logo",
        "logo ho",
        "logo only",
        "only background",
        "background ho",
        "likha ho",
        "written",
        "only text",
    ].some((phrase) => normalized.includes(phrase));
}

function promptNeedsVisualKnowledgeReferences(prompt: string): boolean {
    const normalized = String(prompt || "").toLowerCase();
    return /\b(student|students|photo|photos|portrait|face|person|profile|id card|identity card|admission card|with student|with the student|candidate|learner|kid|kids|child|children|model reference|reference photo)\b/.test(
        normalized
    );
}

function extractQuotedSegments(prompt: string): string[] {
    const matches = String(prompt || "").match(/["'`“”‘’]([^"'`“”‘’]{1,60})["'`“”‘’]/g) || [];
    return Array.from(
        new Set(
            matches
                .map((match) => match.replace(/^(["'`“”‘’])|(["'`“”‘’])$/g, "").trim())
                .filter(Boolean)
        )
    ).slice(0, 4);
}

function extractRequestedVisibleText(prompt: string): string[] {
    const directQuotes = extractQuotedSegments(prompt);
    if (directQuotes.length) {
        return directQuotes.map((entry) => sanitizePromptFragment(entry, 40));
    }

    const patterns = [
        /(?:written|write|text|title)\s+(?:as\s+)?([a-zA-Z\u0900-\u097f][a-zA-Z0-9&+/\-\s]{0,40})/gi,
        /(?:sirf|only|bas|bss)(?:\s+(?:\d+\s*word|one\s+word|word|text|content))?(?:\s+(?:ho|hona|rahe|should\s+be|as|like))?\s+([a-zA-Z\u0900-\u097f][a-zA-Z0-9&+/\-\s]{0,40})/gi,
        /([a-zA-Z\u0900-\u097f][a-zA-Z0-9&+/\-\s]{0,40}?)\s+(?:likha\s+ho|likha\s+hua\s+ho|written|text|title)\b/gi,
    ];

    const matches = patterns
        .flatMap((pattern) =>
            Array.from(String(prompt || "").matchAll(pattern)).map((match) =>
                sanitizePromptFragment(match[1] || "", 40)
            )
        )
        .filter(Boolean)
        .map((value) =>
            value
                .replace(/\b(jisme|jismein|jahan|jispar|with|and|or|logo|background|badhiya|illustration|theme|oriented|ka|ki|ke|sirf|only|text|word|content)\b/gi, "")
                .replace(/\s+/g, " ")
                .trim()
        )
        .filter((value) => value.length >= 2);

    return Array.from(new Set(matches)).slice(0, 4);
}

function buildMinimalCopyInstruction(prompt: string): string {
    if (!promptRequestsMinimalCopy(prompt)) return "";

    const requestedVisibleText = extractRequestedVisibleText(prompt);
    const allowedTextInstruction = requestedVisibleText.length
        ? `Outside the provided logo, the only visible text allowed is ${requestedVisibleText.map((entry) => `"${entry}"`).join(", ")}.`
        : "Outside the provided logo, keep visible text extremely minimal and limited to the exact subject word or label explicitly requested in the brief.";

    return [
        "Keep the creative minimal and uncluttered.",
        "Do not add slogans, taglines, CTAs, subheads, institute names, motivational lines, or any extra copy outside the logo unless the user explicitly asked for them.",
        allowedTextInstruction,
        "If the user says there should be no content, do not invent extra wording.",
    ].join(" ");
}

function buildBrandIntegrityInstruction(options: {
    prompt: string;
    organizationName?: string | null;
    brandContextAllowed: boolean;
    logoRequired: boolean;
}): string {
    if (!options.brandContextAllowed && !options.logoRequired) {
        return "";
    }

    const instructions = [
        options.logoRequired
            ? "Treat the uploaded logo as a fixed asset. Any text already present inside the logo must remain exactly the same and must never be translated, rewritten, replaced, or stylized into different words."
            : "If the uploaded logo appears, preserve its mark and text exactly without renaming or restyling it.",
    ];

    if (options.organizationName) {
        instructions.push(
            `Never rename the institute. If the institute name appears outside the logo, it must stay exactly as "${options.organizationName}".`
        );
    }

    instructions.push(
        "Do not replace brand words with generic substitutes. For example, never swap words into alternatives like Education, Academy, Career, Learning, Coaching, Institute, or similar unless those exact words were explicitly requested or already exist inside the uploaded logo."
    );

    if (promptRequestsMinimalCopy(options.prompt)) {
        instructions.push(
            "Do not introduce generic words such as Education, Academy, Career, Institute, Admissions, Learning, Classes, or similar filler text unless the user explicitly requested them."
        );
    }

    return instructions.join(" ");
}

function promptDisablesLogo(prompt: string): boolean {
    const normalized = String(prompt || "").toLowerCase();
    return [
        "without logo",
        "no logo",
        "dont use logo",
        "don't use logo",
        "do not use logo",
        "logo mat use",
        "logo nahi",
    ].some((phrase) => normalized.includes(phrase));
}

function promptRequiresExactLogo(prompt: string): boolean {
    if (promptDisablesLogo(prompt)) return false;
    const normalized = String(prompt || "").toLowerCase();
    return /\blogo\b/.test(normalized) || normalized.includes("लोगो");
}

function promptMentionsOrganization(prompt: string, organizationName?: string | null): boolean {
    const normalizedPrompt = String(prompt || "").toLowerCase();
    if (!normalizedPrompt) return false;

    const organizationTokens = String(organizationName || "")
        .toLowerCase()
        .split(/[^a-z0-9\u0900-\u097f]+/i)
        .map((token) => token.trim())
        .filter((token) => token.length >= 3);

    return organizationTokens.some((token) => normalizedPrompt.includes(token));
}

function promptRequestsBrandContext(options: {
    prompt: string;
    organizationName?: string | null;
}): boolean {
    const normalized = String(options.prompt || "").toLowerCase();
    const mentionsInstitutionOwnership =
        /\b(our|apna|apne|apni|hamare|hamari|hamara)\b/.test(normalized);
    const institutionTerms =
        /\b(institute|organization|coaching|academy|college|school|brand|branding)\b/.test(normalized);
    const campaignTerms =
        /\b(admission|poster|campaign|promotion|banner|flyer|brochure|thumbnail|reel|story|instagram|whatsapp|youtube|facebook|post)\b/.test(
            normalized
        );

    if (promptRequiresExactLogo(options.prompt)) return true;
    if (promptMentionsOrganization(options.prompt, options.organizationName)) return true;
    if (mentionsInstitutionOwnership && institutionTerms) return true;
    if (campaignTerms && (institutionTerms || mentionsInstitutionOwnership)) return true;

    return [
        "brand identity",
        "brand color",
        "brand colours",
        "brand tone",
        "use institute logo",
        "use exact institute logo",
        "our logo",
        "our institute",
        "our brand",
        "apna logo",
        "apne institute",
        "hamare institute",
    ].some((phrase) => normalized.includes(phrase));
}

function promptRequestsKnowledgeContext(options: {
    prompt: string;
    brandContextAllowed: boolean;
}): boolean {
    const normalized = String(options.prompt || "").toLowerCase();
    if (!normalized.trim()) return false;
    return true;
}

function getReferenceMetadata(reference: MediaKnowledgeReference): Record<string, unknown> | null {
    return reference.metadata && typeof reference.metadata === "object"
        ? (reference.metadata as Record<string, unknown>)
        : null;
}

function promptDemandsFactLockedData(prompt: string) {
    const normalized = String(prompt || "").toLowerCase();
    return /\b(fee|fees|reminder|student|profile|id card|admission card|identity|details|detail|data|phone|mobile|guardian|parent|batch|course|contact|record|information)\b/.test(
        normalized
    );
}

function buildStructuredKnowledgeFacts(
    references: MediaKnowledgeReference[],
    prompt: string,
    organizationName?: string | null
) {
    const lines: string[] = [];
    const promptNeedsLockedFacts = promptDemandsFactLockedData(prompt);

    if (organizationName) {
        lines.push(`Institute name must remain exactly "${organizationName}".`);
    }

    for (const reference of references) {
        const metadata = getReferenceMetadata(reference);
        if (!metadata) continue;

        if (reference.type === "student") {
            const studentLines = [
                typeof metadata.studentCode === "string" && metadata.studentCode ? `Student ID: ${metadata.studentCode}` : "",
                reference.title ? `Student name: ${reference.title}` : "",
                typeof metadata.guardianName === "string" && metadata.guardianName ? `Guardian: ${metadata.guardianName}` : "",
                typeof metadata.phone === "string" && metadata.phone ? `Student phone: ${metadata.phone}` : "",
                typeof metadata.parentPhone === "string" && metadata.parentPhone ? `Parent phone: ${metadata.parentPhone}` : "",
                typeof metadata.email === "string" && metadata.email ? `Email: ${metadata.email}` : "",
                typeof metadata.classLevel === "string" && metadata.classLevel ? `Class level: ${metadata.classLevel}` : "",
                typeof metadata.courseEnrolled === "string" && metadata.courseEnrolled ? `Course: ${metadata.courseEnrolled}` : "",
                typeof metadata.batchId === "string" && metadata.batchId ? `Batch: ${metadata.batchId}` : "",
                typeof metadata.totalFees === "number" ? `Total fees: INR ${metadata.totalFees}` : "",
                typeof metadata.pendingFees === "number" ? `Pending fees: INR ${metadata.pendingFees}` : "",
                typeof metadata.location === "string" && metadata.location ? `Location: ${metadata.location}` : "",
            ].filter(Boolean);

            if (studentLines.length) {
                lines.push(`Student record facts: ${studentLines.join(" · ")}`);
            }
            continue;
        }

        if (reference.type === "member") {
            const memberLines = [
                reference.title ? `Member name: ${reference.title}` : "",
                typeof metadata.designation === "string" && metadata.designation ? `Designation: ${metadata.designation}` : "",
                typeof metadata.phone === "string" && metadata.phone ? `Phone: ${metadata.phone}` : "",
                typeof metadata.email === "string" && metadata.email ? `Email: ${metadata.email}` : "",
            ].filter(Boolean);

            if (memberLines.length) {
                lines.push(`Staff facts: ${memberLines.join(" · ")}`);
            }
        }
    }

    if (!lines.length) return "";

    return sanitizePromptFragment(
        [
            "Hard factual constraints from retrieved records:",
            ...lines,
            promptNeedsLockedFacts
                ? "If any of these facts appear in visible text, keep them exactly the same. Do not invent alternate names, numbers, fee amounts, batch IDs, contact details, or institute titles."
                : "Use these facts only when relevant, and keep them exact if used.",
        ].join(" "),
        950
    );
}

function buildLogoInstruction(options: {
    hasLogo: boolean;
    brandContextAllowed: boolean;
    logoRequired: boolean;
    logoDisabled: boolean;
}): string {
    if (!options.brandContextAllowed || !options.hasLogo || options.logoDisabled) return "";
    if (options.logoRequired) {
        return "Mandatory: use the exact uploaded organization logo unchanged. Do not redesign, simplify, translate, recolor, restyle, or replace it. Preserve the same mark, text, composition, and brand colors wherever the logo appears.";
    }
    return "Do not add the institute logo unless the brief explicitly asks for it. If brand identity is needed, keep it subtle and faithful to the official colors and emblem language.";
}

function resolvePublicAssetPath(assetUrl: string | null | undefined): string | null {
    const normalized = String(assetUrl || "").trim();
    if (!normalized || !normalized.startsWith("/")) return null;
    return path.join(process.cwd(), "public", normalized.replace(/^\/+/, ""));
}

async function publicAssetExists(assetUrl: string | null | undefined): Promise<boolean> {
    const filePath = resolvePublicAssetPath(assetUrl);
    if (!filePath) return false;

    try {
        await access(filePath);
        return true;
    } catch {
        return false;
    }
}

function mimeTypeFromFilePath(filePath: string): string {
    const ext = path.extname(filePath).toLowerCase();
    if (ext === ".png") return "image/png";
    if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
    if (ext === ".webp") return "image/webp";
    if (ext === ".svg") return "image/svg+xml";
    if (ext === ".gif") return "image/gif";
    return "application/octet-stream";
}

function buildPromptFidelityInstruction(mode: MediaMode, prompt: string): string {
    const normalized = String(prompt || "").toLowerCase();
    const instructions = [
        "Primary rule: follow the user brief exactly.",
        "Do not change the requested subject, audience, offer, language, platform, scene type, or deliverable.",
        "Do not introduce unrelated exam topics, classroom scenes, products, or document details unless the brief explicitly asks for them.",
    ];

    if (/\b(instagram|post|poster|ad|admission|promotion|campaign|banner|flyer|brochure|thumbnail)\b/.test(normalized)) {
        instructions.push(
            "Keep the output clearly aligned to the requested marketing format instead of turning it into a generic academic visual."
        );
    }

    if (mode === "text_to_image" || mode === "image_from_reference") {
        instructions.push(
            "For images, keep composition, typography intent, and subject matter tightly aligned to the brief."
        );
    } else {
        instructions.push(
            "For videos, keep scene progression, pacing, and CTA flow tightly aligned to the brief."
        );
    }

    return instructions.join(" ");
}

function buildImagePromptCandidates(input: {
    effectivePrompt: string;
    mode: MediaMode;
    prompt: string;
    style: string;
    aspectRatio: string;
    durationSec: number;
    organizationName?: string | null;
    organizationSummary: string;
    organizationLogoUrl?: string | null;
    logoInstruction: string;
    brandIntegrityInstruction: string;
    minimalCopyInstruction: string;
    knowledgeContext: string;
    structuredFacts: string;
    referenceName?: string;
    textRenderingInstruction?: string;
}): string[] {
    const modeInstruction = buildModeInstruction(
        input.mode,
        input.aspectRatio,
        input.durationSec,
        input.referenceName
    );
    const fidelityInstruction = buildPromptFidelityInstruction(input.mode, input.prompt);

    const candidates = [
        input.effectivePrompt,
        sanitizePromptFragment(
            [
                fidelityInstruction,
                `Requested output: ${input.prompt}.`,
                `Deliverable: ${modeInstruction}`,
                input.organizationName ? `Institute: ${input.organizationName}.` : "",
                input.organizationSummary ? `Institute identity: ${input.organizationSummary}.` : "",
                input.organizationLogoUrl
                    ? "Official logo is available in workspace assets. Use the institute's brand colors and emblem-inspired identity only to support the requested creative."
                    : "",
                input.logoInstruction,
                input.brandIntegrityInstruction,
                input.minimalCopyInstruction,
                input.textRenderingInstruction || "",
                input.knowledgeContext
                    ? `Use this institute knowledge only if it directly supports the requested output: ${input.knowledgeContext}`
                    : "",
                input.structuredFacts,
                input.style ? `Style signal: ${sanitizePromptFragment(input.style, 60)}.` : "",
            ]
                .filter(Boolean)
                .join(" "),
            900
        ),
        sanitizePromptFragment(
            [
                fidelityInstruction,
                `Requested output: ${input.prompt}.`,
                `Deliverable: ${modeInstruction}`,
                input.organizationSummary ? `Institute identity: ${input.organizationSummary}.` : "",
                input.organizationLogoUrl
                    ? "Use official brand identity only in service of the brief."
                    : "",
                input.logoInstruction,
                input.brandIntegrityInstruction,
                input.minimalCopyInstruction,
                input.textRenderingInstruction || "",
                input.structuredFacts,
                input.style ? `Style cue ${sanitizePromptFragment(input.style, 60)}.` : "",
            ]
                .filter(Boolean)
                .join(" "),
            520
        ),
        sanitizePromptFragment(
            [
                `User brief: ${input.prompt}.`,
                `Deliverable: ${modeInstruction}`,
                input.organizationLogoUrl
                    ? "Keep branding aligned with the official institute identity."
                    : "",
                input.logoInstruction,
                input.brandIntegrityInstruction,
                input.minimalCopyInstruction,
                input.textRenderingInstruction || "",
                input.structuredFacts,
                input.style ? `Style cue ${sanitizePromptFragment(input.style, 60)}.` : "",
            ]
                .filter(Boolean)
                .join(" "),
            320
        ),
        sanitizePromptFragment(
            [
                `Create exactly this and nothing broader: ${input.prompt}.`,
                input.logoInstruction,
                input.brandIntegrityInstruction,
                input.minimalCopyInstruction,
                input.textRenderingInstruction || "",
                input.structuredFacts,
            ]
                .filter(Boolean)
                .join(" "),
            280
        ),
    ].filter(Boolean);

    return Array.from(new Set(candidates));
}

async function extractProviderErrorMessage(response: Response): Promise<string> {
    const contentType = response.headers.get("content-type") || "";

    try {
        if (contentType.includes("application/json")) {
            const data = (await response.json()) as Record<string, unknown>;
            const nestedMessage = extractNestedErrorMessage(data);
            return sanitizePromptFragment(
                nestedMessage || `Provider returned ${response.status}`,
                260
            );
        }

        return sanitizePromptFragment(await response.text(), 260) || `Provider returned ${response.status}`;
    } catch {
        return `Provider returned ${response.status}`;
    }
}

function extractNestedErrorMessage(value: unknown): string {
    const visited = new Set<unknown>();

    const visit = (input: unknown): string => {
        if (!input || visited.has(input)) return "";

        if (typeof input === "string") {
            return sanitizePromptFragment(input, 260);
        }

        if (typeof input === "number" || typeof input === "boolean") {
            return String(input);
        }

        if (Array.isArray(input)) {
            visited.add(input);
            for (const item of input) {
                const message = visit(item);
                if (message) return message;
            }
            return "";
        }

        if (typeof input === "object") {
            visited.add(input);
            const record = input as Record<string, unknown>;
            const preferredKeys = [
                "message",
                "error_description",
                "description",
                "detail",
                "statusText",
                "reason",
            ] as const;

            for (const key of preferredKeys) {
                const message = visit(record[key]);
                if (message) return message;
            }

            const nestedKeys = [
                "error",
                "details",
                "violations",
                "fieldViolations",
                "causes",
                "errors",
            ] as const;

            for (const key of nestedKeys) {
                const message = visit(record[key]);
                if (message) return message;
            }

            const status = visit(record.status);
            if (status) return status;
        }

        return "";
    };

    return visit(value);
}

async function saveGeneratedMediaAsset(
    buffer: Buffer<ArrayBufferLike>,
    contentType: string,
    fallbackExtension?: string
): Promise<string> {
    const uploadDir = path.join(process.cwd(), "public", "uploads", "generated-media");
    await mkdir(uploadDir, { recursive: true });

    const ext = fallbackExtension ||
        (contentType.includes("png")
            ? "png"
            : contentType.includes("webp")
                ? "webp"
                : contentType.includes("mp4")
                    ? "mp4"
                    : "jpg");
    const fileName = `${Date.now()}_${Math.random().toString(36).slice(2, 10)}.${ext}`;
    const filePath = path.join(uploadDir, fileName);

    await writeFile(filePath, buffer);
    return `/uploads/generated-media/${fileName}`;
}

function normalizeKnowledgeReferences(value: unknown): MediaKnowledgeReference[] {
    if (!Array.isArray(value)) return [];
    return value
        .map((entry) => {
            if (!entry || typeof entry !== "object" || Array.isArray(entry)) return null;
            const item = entry as Record<string, unknown>;
            const type =
                item.type === "organization" ||
                item.type === "member" ||
                item.type === "student" ||
                item.type === "book" ||
                item.type === "document" ||
                item.type === "media" ||
                item.type === "schedule" ||
                item.type === "whiteboard"
                    ? (item.type as MediaKnowledgeReference["type"])
                    : null;
            const title = sanitizePromptFragment(String(item.title || ""), 160);
            const summary = sanitizePromptFragment(String(item.summary || ""), 240);
            if (!type || !title) return null;
            return {
                type,
                title,
                summary,
            } satisfies MediaKnowledgeReference;
        })
        .filter(Boolean) as MediaKnowledgeReference[];
}

function normalizeStoryboard(value: unknown): string[] {
    if (!Array.isArray(value)) return [];
    return value
        .map((entry) => sanitizePromptFragment(String(entry || ""), 280))
        .filter(Boolean)
        .slice(0, 12);
}

function toSavedMediaRecord(record: any): SavedMediaRecord {
    return {
        id: String(record.id),
        mode: String(record.mode) as MediaMode,
        status: String(record.status || "generated"),
        type: String(record.type || "image") as "image" | "video" | "video_plan",
        prompt: String(record.prompt || ""),
        effectivePrompt: record.effectivePrompt ? String(record.effectivePrompt) : undefined,
        style: String(record.style || ""),
        aspectRatio: String(record.aspectRatio || ""),
        durationSec: typeof record.durationSec === "number" ? record.durationSec : undefined,
        referenceName: record.referenceName ? String(record.referenceName) : null,
        organizationLogoUrl: record.organizationLogoUrl ? String(record.organizationLogoUrl) : null,
        organizationName: record.organizationName ? String(record.organizationName) : null,
        organizationSummary: record.organizationSummary ? String(record.organizationSummary) : null,
        institutionContextApplied: Boolean(record.institutionContextApplied),
        knowledgeReferences: normalizeKnowledgeReferences(record.knowledgeReferences),
        assetUrl: record.assetUrl ? String(record.assetUrl) : undefined,
        storyboard: normalizeStoryboard(record.storyboard),
        note: record.note ? String(record.note) : undefined,
        createdAt: record.createdAt instanceof Date
            ? record.createdAt.toISOString()
            : String(record.createdAt || new Date().toISOString()),
    };
}

async function toSafeSavedMediaRecord(record: any): Promise<SavedMediaRecord> {
    const next = toSavedMediaRecord(record);
    if (!next.assetUrl) return next;

    if (!(await publicAssetExists(next.assetUrl))) {
        return {
            ...next,
            assetUrl: undefined,
            note: next.note
                ? `${next.note} Asset file is currently unavailable in storage.`
                : "Asset file is currently unavailable in storage.",
        };
    }

    return next;
}

async function listSavedGeneratedMedia(
    organizationId: string | null,
    userId: string,
    options?: {
        limit?: number;
        offset?: number;
    }
): Promise<SavedMediaListPage> {
    const limit = Math.min(60, Math.max(1, Number(options?.limit || 24)));
    const offset = Math.max(0, Number(options?.offset || 0));
    const where = organizationId
        ? {
            OR: [
                { organizationId },
                { organizationId: null, userId },
                { organizationId: null, userId: null },
            ],
        }
        : {
            OR: [
                { userId },
                { organizationId: null },
            ],
        };

    const [records, total] = await Promise.all([
        prisma.generatedMedia.findMany({
            where,
            orderBy: { createdAt: "desc" },
            skip: offset,
            take: limit,
        }),
        prisma.generatedMedia.count({ where }),
    ]);

    const items = await Promise.all(records.map((record) => toSafeSavedMediaRecord(record)));

    return {
        items,
        total,
        offset,
        limit,
        hasMore: offset + items.length < total,
    };
}

async function persistGeneratedMedia(options: {
    organizationId: string | null;
    userId: string;
    mode: MediaMode;
    status: string;
    type: "image" | "video" | "video_plan";
    prompt: string;
    effectivePrompt?: string;
    style: string;
    aspectRatio: string;
    durationSec?: number;
    referenceName?: string | null;
    organizationLogoUrl?: string | null;
    organizationName?: string | null;
    organizationSummary?: string | null;
    institutionContextApplied?: boolean;
    knowledgeReferences?: MediaKnowledgeReference[];
    assetUrl?: string;
    storyboard?: string[];
    note?: string;
}) {
    const record = await prisma.generatedMedia.create({
        data: {
            organizationId: options.organizationId,
            userId: options.userId,
            mode: options.mode,
            status: options.status,
            type: options.type,
            prompt: options.prompt,
            effectivePrompt: options.effectivePrompt,
            style: options.style,
            aspectRatio: options.aspectRatio,
            durationSec: options.durationSec,
            referenceName: options.referenceName || null,
            organizationLogoUrl: options.organizationLogoUrl || null,
            organizationName: options.organizationName || null,
            organizationSummary: options.organizationSummary || null,
            institutionContextApplied: Boolean(options.institutionContextApplied),
            knowledgeReferences: (options.knowledgeReferences || []) as unknown as object,
            assetUrl: options.assetUrl || null,
            storyboard: (options.storyboard || []) as unknown as object,
            note: options.note || null,
        },
    });

    return toSavedMediaRecord(record);
}

function normalizeVideoAspectRatio(aspectRatio: string): "16:9" | "9:16" {
    return aspectRatio === "9:16" || aspectRatio === "4:5" ? "9:16" : "16:9";
}

function normalizeVideoDuration(durationSec: number, referenceFile: File | null): 4 | 6 | 8 {
    if (referenceFile?.type.startsWith("video/")) return 8;

    const options: Array<4 | 6 | 8> = [4, 6, 8];
    return options.reduce((best, current) =>
        Math.abs(current - durationSec) < Math.abs(best - durationSec) ? current : best
    );
}

function joinNotes(...notes: Array<string | undefined | null>): string | undefined {
    const compact = notes
        .map((value) => String(value || "").trim())
        .filter(Boolean);
    return compact.length ? compact.join(" ") : undefined;
}

function extractResponseParts(payload: any): any[] {
    const candidates = Array.isArray(payload?.candidates) ? payload.candidates : [];
    return candidates.flatMap((candidate: any) =>
        Array.isArray(candidate?.content?.parts) ? candidate.content.parts : []
    );
}

function getInlineDataBlob(part: any): { mimeType: string; data: string } | null {
    const camel = part?.inlineData;
    if (camel?.data) {
        return {
            mimeType: camel.mimeType || "application/octet-stream",
            data: camel.data,
        };
    }

    const snake = part?.inline_data;
    if (snake?.data) {
        return {
            mimeType: snake.mime_type || "application/octet-stream",
            data: snake.data,
        };
    }

    return null;
}

async function sleep(ms: number) {
    await new Promise((resolve) => setTimeout(resolve, ms));
}

async function parseMediaRequest(request: NextRequest): Promise<{
    body: RequestBody;
    referenceFile: File | null;
    attachmentFiles: File[];
}> {
    const contentType = request.headers.get("content-type") || "";
    if (!contentType.includes("multipart/form-data")) {
        return {
            body: (await request.json()) as RequestBody,
            referenceFile: null,
            attachmentFiles: [],
        };
    }

    const formData = await request.formData();
    const referenceEntry = formData.get("referenceFile");
    const attachmentEntries = formData
        .getAll("attachmentFiles")
        .filter((entry): entry is File => entry instanceof File);

    return {
        body: {
            mode: String(formData.get("mode") || "") as MediaMode,
            prompt: String(formData.get("prompt") || ""),
            style: String(formData.get("style") || ""),
            aspectRatio: String(formData.get("aspectRatio") || ""),
            durationSec: Number(formData.get("durationSec") || 0),
            referenceName: String(formData.get("referenceName") || ""),
            imageModel: String(formData.get("imageModel") || "") as ImageModelSelection,
        },
        referenceFile: referenceEntry instanceof File ? referenceEntry : null,
        attachmentFiles: attachmentEntries,
    };
}

async function buildInlineReferenceAssetFromFile(file: File): Promise<InlineReferenceAsset> {
    if (!file.type) {
        throw new Error("Reference file is missing a valid MIME type.");
    }

    if (file.size > MAX_INLINE_REFERENCE_BYTES) {
        throw new Error("Reference file is too large. Keep it under 20MB.");
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    return {
        mimeType: file.type,
        data: buffer.toString("base64"),
        kind: file.type.startsWith("video/") ? "video" : "image",
    };
}

function buildInlineDataPart(asset: InlineReferenceAsset): { inline_data: { mime_type: string; data: string } } {
    return {
        inline_data: {
            mime_type: asset.mimeType,
            data: asset.data,
        },
    };
}

async function buildLogoInlineDataPart(organizationLogoUrl: string | null | undefined): Promise<InlineImagePart | null> {
    const assetPath = resolvePublicAssetPath(organizationLogoUrl);
    if (!assetPath) return null;

    const cached = readTimedCache(mediaLogoInlinePartCache, assetPath);
    if (cached) return cached;

    const originalBuffer = await readFile(assetPath);
    if (!originalBuffer.length) {
        writeTimedCache(mediaLogoInlinePartCache, assetPath, null, LOGO_INLINE_PART_CACHE_TTL_MS);
        return null;
    }

    const mimeType = mimeTypeFromFilePath(assetPath);
    const shouldRasterize = mimeType === "image/svg+xml" || mimeType === "image/gif" || originalBuffer.length > MAX_INLINE_REFERENCE_BYTES;
    const finalBuffer = shouldRasterize
        ? await sharp(originalBuffer, { animated: false })
            .resize({
                width: MAX_LOGO_REFERENCE_EDGE,
                height: MAX_LOGO_REFERENCE_EDGE,
                fit: "inside",
                withoutEnlargement: true,
            })
            .png()
            .toBuffer()
        : originalBuffer;
    const finalMimeType = shouldRasterize ? "image/png" : mimeType;

    if (finalBuffer.length > MAX_INLINE_REFERENCE_BYTES) {
        const compressedBuffer = await sharp(finalBuffer)
            .resize({
                width: 512,
                height: 512,
                fit: "inside",
                withoutEnlargement: true,
            })
            .png({ quality: 90 })
            .toBuffer();

        const result = {
            inline_data: {
                mime_type: "image/png",
                data: compressedBuffer.toString("base64"),
            },
        };
        writeTimedCache(mediaLogoInlinePartCache, assetPath, result, LOGO_INLINE_PART_CACHE_TTL_MS);
        return result;
    }

    const result = {
        inline_data: {
            mime_type: finalMimeType,
            data: finalBuffer.toString("base64"),
        },
    };
    writeTimedCache(mediaLogoInlinePartCache, assetPath, result, LOGO_INLINE_PART_CACHE_TTL_MS);
    return result;
}

async function loadReferenceAssetFromUrl(assetUrl: string | null | undefined): Promise<InlineReferenceAsset | null> {
    const normalized = String(assetUrl || "").trim();
    if (!normalized) return null;

    const cached = readTimedCache(mediaReferenceAssetCache, normalized);
    if (cached) return cached;

    let buffer: Buffer | null = null;
    let mimeType = "";
    const localPath = resolvePublicAssetPath(normalized);

    if (localPath) {
        buffer = await readFile(localPath);
        mimeType = mimeTypeFromFilePath(localPath);
    } else if (/^https?:\/\//i.test(normalized)) {
        const response = await fetch(normalized, { cache: "force-cache" });
        if (!response.ok) {
            writeTimedCache(mediaReferenceAssetCache, normalized, null, REFERENCE_ASSET_CACHE_TTL_MS);
            return null;
        }
        const contentType = response.headers.get("content-type") || "";
        if (!contentType.startsWith("image/")) {
            writeTimedCache(mediaReferenceAssetCache, normalized, null, REFERENCE_ASSET_CACHE_TTL_MS);
            return null;
        }
        buffer = Buffer.from(await response.arrayBuffer());
        mimeType = contentType.split(";")[0].trim();
    }

    if (!buffer?.length || !mimeType.startsWith("image/")) {
        writeTimedCache(mediaReferenceAssetCache, normalized, null, REFERENCE_ASSET_CACHE_TTL_MS);
        return null;
    }

    const shouldRasterize =
        mimeType === "image/svg+xml" ||
        mimeType === "image/gif" ||
        buffer.length > MAX_INLINE_REFERENCE_BYTES;

    const finalBuffer = shouldRasterize
        ? await sharp(buffer, { animated: false })
            .resize({
                width: MAX_LOGO_REFERENCE_EDGE,
                height: MAX_LOGO_REFERENCE_EDGE,
                fit: "inside",
                withoutEnlargement: true,
            })
            .png()
            .toBuffer()
        : buffer;
    const finalMimeType = shouldRasterize ? "image/png" : mimeType;

    if (finalBuffer.length > MAX_INLINE_REFERENCE_BYTES) {
        writeTimedCache(mediaReferenceAssetCache, normalized, null, REFERENCE_ASSET_CACHE_TTL_MS);
        return null;
    }

    const result: InlineReferenceAsset = {
        mimeType: finalMimeType,
        data: finalBuffer.toString("base64"),
        kind: "image",
    };
    writeTimedCache(mediaReferenceAssetCache, normalized, result, REFERENCE_ASSET_CACHE_TTL_MS);
    return result;
}

function extractKnowledgeReferenceImageUrls(references: MediaKnowledgeReference[]): string[] {
    const urls = new Set<string>();

    for (const reference of references) {
        if (reference.type !== "student") continue;
        const metadata =
            reference.metadata && typeof reference.metadata === "object"
                ? (reference.metadata as Record<string, unknown>)
                : null;
        if (!metadata) continue;

        const photoUrl = typeof metadata.photoUrl === "string" ? metadata.photoUrl.trim() : "";
        if (photoUrl) urls.add(photoUrl);

        const galleryImageUrls = Array.isArray(metadata.galleryImageUrls)
            ? metadata.galleryImageUrls
            : [];

        for (const item of galleryImageUrls) {
            if (typeof item === "string" && item.trim()) {
                urls.add(item.trim());
            }
        }
    }

    return Array.from(urls).slice(0, 4);
}

async function buildSupplementalVisualAssets(options: {
    attachmentFiles: File[];
    knowledgeReferences: MediaKnowledgeReference[];
    prompt: string;
}): Promise<InlineReferenceAsset[]> {
    const assets: InlineReferenceAsset[] = [];

    for (const file of options.attachmentFiles) {
        if (!file.type.startsWith("image/")) continue;
        assets.push(await buildInlineReferenceAssetFromFile(file));
        if (assets.length >= 4) break;
    }

    if (assets.length >= 4) {
        return assets.slice(0, 4);
    }

    if (
        !promptNeedsVisualKnowledgeReferences(options.prompt) &&
        !options.knowledgeReferences.some((reference) => reference.type === "student")
    ) {
        return assets.slice(0, 4);
    }

    const knowledgeImageUrls = extractKnowledgeReferenceImageUrls(options.knowledgeReferences).slice(
        0,
        Math.max(0, 4 - assets.length)
    );
    if (!knowledgeImageUrls.length) {
        return assets.slice(0, 4);
    }

    const resolvedAssets = await Promise.allSettled(
        knowledgeImageUrls.map((imageUrl) => loadReferenceAssetFromUrl(imageUrl))
    );
    for (const result of resolvedAssets) {
        if (result.status === "fulfilled" && result.value) {
            assets.push(result.value);
        }
        if (assets.length >= 4) break;
    }

    return assets.slice(0, 4);
}

async function verifyGeneratedImageAgainstBrief(options: {
    apiKey: string;
    buffer: Buffer<ArrayBufferLike>;
    contentType: string;
    prompt: string;
    organizationName?: string | null;
    logoRequired: boolean;
    strictMinimalCopy: boolean;
    requestedVisibleText: string[];
}): Promise<ImageValidationResult> {
    if (!options.logoRequired && !options.strictMinimalCopy && !options.requestedVisibleText.length) {
        return { passes: true, issues: [] };
    }

    const genAI = new GoogleGenerativeAI(options.apiKey);
    const model = genAI.getGenerativeModel({
        model: GEMINI_TEXT_MODEL,
        generationConfig: {
            temperature: 0.1,
            responseMimeType: "application/json",
        },
    });

    const validationPrompt = `
You are validating whether an institute creative image obeys the user's exact brief.

Return strict JSON only.

Validation rules:
- Focus on major visible text and brand drift.
- If the brief requests the exact uploaded logo, fail if the logo text appears rewritten, renamed, translated, or replaced.
- If the brief asks for a minimal design, logo-only design, or only one short word outside the logo, fail if extra words, slogans, CTAs, taglines, or institute-copy appear outside the logo.
- If specific visible text is requested, fail if that requested text is missing, replaced with another dominant word, or visibly misspelled.
- Ignore tiny unreadable decorative noise; focus on clearly visible text.
- Pass only when the output is close enough to the brief's meaning and text constraints.

Organization name: ${options.organizationName || "Unknown"}
User brief: ${options.prompt}
Logo must stay exact: ${options.logoRequired ? "yes" : "no"}
Minimal copy requested: ${options.strictMinimalCopy ? "yes" : "no"}
Allowed visible text outside the logo: ${options.requestedVisibleText.length ? options.requestedVisibleText.map((entry) => `"${entry}"`).join(", ") : "(none explicitly specified)"}

Return:
{
  "passes": true,
  "issues": [],
  "observedVisibleText": [],
  "extraVisibleText": [],
  "missingRequiredText": []
}
`;

    await recordGeminiUsage("image_validation");
    const result = await model.generateContent([
        validationPrompt,
        {
            inlineData: {
                mimeType: options.contentType,
                data: options.buffer.toString("base64"),
            },
        },
    ]);

    const response = await result.response;
    const parsed = JSON.parse(extractJsonObject(response.text())) as ImageValidationResult;

    return {
        passes: Boolean(parsed?.passes),
        issues: Array.isArray(parsed?.issues)
            ? parsed.issues.map((item) => sanitizePromptFragment(String(item || ""), 140)).filter(Boolean)
            : [],
        observedVisibleText: Array.isArray(parsed?.observedVisibleText)
            ? parsed.observedVisibleText.map((item) => sanitizePromptFragment(String(item || ""), 60)).filter(Boolean)
            : [],
        extraVisibleText: Array.isArray(parsed?.extraVisibleText)
            ? parsed.extraVisibleText.map((item) => sanitizePromptFragment(String(item || ""), 60)).filter(Boolean)
            : [],
        missingRequiredText: Array.isArray(parsed?.missingRequiredText)
            ? parsed.missingRequiredText.map((item) => sanitizePromptFragment(String(item || ""), 60)).filter(Boolean)
            : [],
    };
}

function buildVideoPromptCandidates(input: {
    effectivePrompt: string;
    mode: MediaMode;
    prompt: string;
    style: string;
    aspectRatio: string;
    durationSec: number;
    organizationName?: string | null;
    organizationSummary: string;
    organizationLogoUrl?: string | null;
    logoInstruction: string;
    brandIntegrityInstruction: string;
    minimalCopyInstruction: string;
    knowledgeContext: string;
    structuredFacts: string;
    referenceName?: string;
    textRenderingInstruction?: string;
}): string[] {
    const modeInstruction = buildModeInstruction(
        input.mode,
        input.aspectRatio,
        input.durationSec,
        input.referenceName
    );
    const fidelityInstruction = buildPromptFidelityInstruction(input.mode, input.prompt);

    return Array.from(
        new Set(
            [
                input.effectivePrompt,
                sanitizePromptFragment(
                    [
                        fidelityInstruction,
                        `Requested output: ${input.prompt}.`,
                        `Deliverable: ${modeInstruction}`,
                        input.organizationName ? `Institute: ${input.organizationName}.` : "",
                        input.organizationSummary ? `Institute identity: ${input.organizationSummary}.` : "",
                        input.organizationLogoUrl
                            ? "Official logo is available in workspace assets. Keep visuals brand-consistent only where relevant to the brief."
                            : "",
                        input.logoInstruction,
                        input.brandIntegrityInstruction,
                        input.minimalCopyInstruction,
                        input.textRenderingInstruction || "",
                        input.knowledgeContext
                            ? `Use this institute knowledge only if it directly supports the requested output: ${input.knowledgeContext}`
                            : "",
                        input.structuredFacts,
                        input.style ? `Style signal: ${sanitizePromptFragment(input.style, 60)}.` : "",
                    ]
                        .filter(Boolean)
                        .join(" "),
                    900
                ),
                sanitizePromptFragment(
                    [
                        fidelityInstruction,
                        `Requested output: ${input.prompt}.`,
                        `Deliverable: ${modeInstruction}`,
                        input.organizationSummary ? `Institute identity: ${input.organizationSummary}.` : "",
                        input.organizationLogoUrl
                            ? "Align the video with the official institute identity only in service of the requested brief."
                            : "",
                        input.logoInstruction,
                        input.brandIntegrityInstruction,
                        input.minimalCopyInstruction,
                        input.textRenderingInstruction || "",
                        input.structuredFacts,
                        input.style ? `Style cue ${sanitizePromptFragment(input.style, 60)}.` : "",
                    ]
                        .filter(Boolean)
                        .join(" "),
                    520
                ),
                sanitizePromptFragment(
                    [
                        `User brief: ${input.prompt}.`,
                        `Deliverable: ${modeInstruction}`,
                        input.logoInstruction,
                        input.brandIntegrityInstruction,
                        input.minimalCopyInstruction,
                        input.textRenderingInstruction || "",
                        input.structuredFacts,
                        input.style ? `Style cue ${sanitizePromptFragment(input.style, 60)}.` : "",
                    ]
                        .filter(Boolean)
                        .join(" "),
                    320
                ),
            ].filter(Boolean)
        )
    );
}

async function generateGeminiImageAsset(input: {
    apiKey: string;
    imageModelApi: string;
    imageModelLabel: string;
    promptCandidates: string[];
    originalPrompt: string;
    referenceFile: File | null;
    organizationLogoPart: InlineImagePart | null;
    supplementalVisualAssets: InlineReferenceAsset[];
    organizationName?: string | null;
    logoRequired: boolean;
    logoDisabled: boolean;
}) {
    let lastError = "Gemini image generation failed.";
    const strictMinimalCopy = promptRequestsMinimalCopy(input.originalPrompt);
    const requestedVisibleText = extractRequestedVisibleText(input.originalPrompt);

    for (let index = 0; index < input.promptCandidates.length; index += 1) {
        const candidate = input.promptCandidates[index];

        try {
            const parts: any[] = [{ text: candidate }];
            if (input.organizationLogoPart && !input.logoDisabled) {
                parts.push(input.organizationLogoPart);
            }
            if (input.referenceFile) {
                if (!input.referenceFile.type.startsWith("image/")) {
                    throw new Error("Image from Reference requires an image file.");
                }
                parts.push(buildInlineDataPart(await buildInlineReferenceAssetFromFile(input.referenceFile)));
            }
            for (const asset of input.supplementalVisualAssets) {
                if (asset.kind !== "image") continue;
                parts.push(buildInlineDataPart(asset));
            }

            await recordGeminiUsage("image_generation");
            const response = await fetch(
                `${GEMINI_API_BASE_URL}/models/${input.imageModelApi}:generateContent`,
                {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        "x-goog-api-key": input.apiKey,
                    },
                    body: JSON.stringify({
                        contents: [{ parts }],
                        generationConfig: {
                            responseModalities: ["TEXT", "IMAGE"],
                        },
                    }),
                }
            );

            if (!response.ok) {
                lastError = await extractProviderErrorMessage(response);
                continue;
            }

            const payload = await response.json();
            const imagePart = extractResponseParts(payload)
                .map((part) => getInlineDataBlob(part))
                .find(Boolean);

            if (!imagePart?.data) {
                const textPart = extractResponseParts(payload)
                    .map((part) => String(part?.text || "").trim())
                    .find(Boolean);
                lastError = textPart || "Gemini did not return an image.";
                continue;
            }

            const buffer = Buffer.from(imagePart.data, "base64");
            const validation = await verifyGeneratedImageAgainstBrief({
                apiKey: input.apiKey,
                buffer,
                contentType: imagePart.mimeType,
                prompt: input.originalPrompt,
                organizationName: input.organizationName,
                logoRequired: input.logoRequired,
                strictMinimalCopy,
                requestedVisibleText,
            });

            if (!validation.passes) {
                lastError = sanitizePromptFragment(
                    validation.issues.join(" ") ||
                    "Generated image drifted away from the required text or logo constraints.",
                    220
                );
                continue;
            }

            return {
                buffer,
                contentType: imagePart.mimeType,
                promptUsed: candidate,
                note: joinNotes(
                    input.organizationLogoPart && !input.logoDisabled
                        ? input.logoRequired
                            ? "Exact uploaded organization logo was applied as a mandatory image reference."
                            : "Official organization logo was applied as a direct image reference."
                        : undefined,
                    input.referenceFile
                        ? "Reference image applied through Gemini image editing."
                        : undefined,
                    input.supplementalVisualAssets.length
                        ? "Student or attached photo references were applied to keep the visual aligned."
                        : undefined,
                    strictMinimalCopy
                        ? "Minimal-copy discipline was enforced so the creative stays close to the brief."
                        : undefined,
                    input.imageModelLabel
                        ? `Image engine: ${input.imageModelLabel}.`
                        : undefined,
                    index > 0
                        ? "Gemini retried with a shorter prompt for stability."
                        : undefined
                ),
            };
        } catch (error) {
            lastError = error instanceof Error
                ? sanitizePromptFragment(error.message, 220) || "Gemini image generation failed."
                : "Gemini image generation failed.";
        }
    }

    throw new Error(lastError);
}

async function waitForGeminiVideoOperation(apiKey: string, operationName: string): Promise<any> {
    const startedAt = Date.now();

    while (Date.now() - startedAt < VIDEO_POLL_TIMEOUT_MS) {
        await recordGeminiUsage("video_status_poll");
        const response = await fetch(`${GEMINI_API_BASE_URL}/${operationName}`, {
            headers: {
                "x-goog-api-key": apiKey,
            },
            cache: "no-store",
        });

        if (!response.ok) {
            throw new Error(await extractProviderErrorMessage(response));
        }

        const payload = await response.json();
        if (payload?.done) {
            const operationError = extractNestedErrorMessage(payload?.error);
            if (operationError) {
                throw new Error(operationError);
            }
            return payload;
        }

        await sleep(VIDEO_POLL_INTERVAL_MS);
    }

    throw new Error("Gemini video generation timed out. Please try a shorter prompt.");
}

async function generateGeminiVideoAsset(input: {
    apiKey: string;
    promptCandidates: string[];
    aspectRatio: string;
    durationSec: number;
    referenceFile: File | null;
    organizationLogoPart: InlineImagePart | null;
    supplementalVisualAssets: InlineReferenceAsset[];
    logoRequired: boolean;
    logoDisabled: boolean;
}) {
    const normalizedAspectRatio = normalizeVideoAspectRatio(input.aspectRatio);
    const normalizedDuration = normalizeVideoDuration(input.durationSec, input.referenceFile);
    let lastError = "Gemini video generation failed.";

    for (let index = 0; index < input.promptCandidates.length; index += 1) {
        const candidate = input.promptCandidates[index];

        try {
            const instance: Record<string, any> = {
                prompt: candidate,
            };

            const primaryVisualAsset = input.referenceFile
                ? await buildInlineReferenceAssetFromFile(input.referenceFile)
                : input.supplementalVisualAssets[0] || null;

            if (primaryVisualAsset) {
                const inlineData = {
                    inlineData: {
                        mimeType: primaryVisualAsset.mimeType,
                        data: primaryVisualAsset.data,
                    },
                };

                if (primaryVisualAsset.kind === "image") {
                    instance.image = inlineData;
                } else if (primaryVisualAsset.kind === "video") {
                    instance.video = inlineData;
                } else {
                    throw new Error("Video from Reference supports image or video files only.");
                }
            }

            await recordGeminiUsage("video_generation");
            const createResponse = await fetch(
                `${GEMINI_API_BASE_URL}/models/${GEMINI_VIDEO_MODEL}:predictLongRunning`,
                {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        "x-goog-api-key": input.apiKey,
                    },
                    body: JSON.stringify({
                        instances: [instance],
                        parameters: {
                            aspectRatio: normalizedAspectRatio,
                            durationSeconds: Number(normalizedDuration),
                            resolution: "720p",
                        },
                    }),
                }
            );

            if (!createResponse.ok) {
                lastError = await extractProviderErrorMessage(createResponse);
                continue;
            }

            const operation = await createResponse.json();
            const createError = extractNestedErrorMessage(operation?.error);
            if (createError) {
                lastError = createError;
                continue;
            }
            if (!operation?.name || typeof operation.name !== "string") {
                lastError = extractNestedErrorMessage(operation) || "Gemini video generation did not return an operation id.";
                continue;
            }
            const finishedOperation = await waitForGeminiVideoOperation(input.apiKey, operation.name);
            const videoUri =
                finishedOperation?.response?.generateVideoResponse?.generatedSamples?.[0]?.video?.uri ||
                finishedOperation?.response?.generatedVideos?.[0]?.video?.uri;

            if (!videoUri) {
                lastError = "Gemini finished the video job but no video file was returned.";
                continue;
            }

            const videoResponse = await fetch(videoUri, {
                headers: {
                    "x-goog-api-key": input.apiKey,
                },
                cache: "no-store",
            });

            if (!videoResponse.ok) {
                lastError = await extractProviderErrorMessage(videoResponse);
                continue;
            }

            const contentType = videoResponse.headers.get("content-type") || "video/mp4";
            const buffer = Buffer.from(await videoResponse.arrayBuffer());
            const assetUrl = await saveGeneratedMediaAsset(buffer, contentType, "mp4");

            return {
                assetUrl,
                promptUsed: candidate,
                durationSec: normalizedDuration,
                note: joinNotes(
                    input.organizationLogoPart && !input.logoDisabled && input.logoRequired && Boolean(input.referenceFile)
                        ? input.logoRequired
                            ? "Exact logo use was enforced strongly in prompt instructions while preserving the chosen reference input."
                            : "Brand/logo guidance was enforced in prompt instructions alongside the chosen reference input."
                        : undefined,
                    primaryVisualAsset?.kind === "image" && input.referenceFile
                        ? "Reference image applied as the opening frame for Veo."
                        : undefined,
                    primaryVisualAsset?.kind === "video"
                        ? "Reference video applied through Veo video extension."
                        : undefined,
                    !input.referenceFile && primaryVisualAsset?.kind === "image"
                        ? "Attached or student photo reference guided the motion output."
                        : undefined,
                    input.durationSec !== normalizedDuration
                        ? `Veo supports 4s, 6s, or 8s outputs, so duration was normalized to ${normalizedDuration}s.`
                        : undefined,
                    input.aspectRatio !== normalizedAspectRatio
                        ? `Veo supports only 16:9 and 9:16, so aspect ratio was normalized to ${normalizedAspectRatio}.`
                        : undefined,
                    index > 0
                        ? "Gemini retried with a shorter prompt for stability."
                        : undefined
                ),
            };
        } catch (error) {
            lastError = error instanceof Error
                ? sanitizePromptFragment(error.message, 220) || "Gemini video generation failed."
                : "Gemini video generation failed.";
        }
    }

    throw new Error(lastError);
}

function buildStoryboard(seedPrompt: string, durationSec: number, organizationName?: string | null): string[] {
    const safePrompt = seedPrompt || "Institute promotional story";
    const brandTail = organizationName ? ` for ${organizationName}` : "";
    return [
        `Shot 1 (0-${Math.max(2, Math.floor(durationSec / 4))}s): Wide opening frame introducing ${safePrompt}${brandTail}.`,
        `Shot 2: Mid scene with subject emphasis, environment detail, and smooth motion transition.`,
        `Shot 3: Detail close-up reinforcing the academic message, product promise, or learner outcome.`,
        `Shot 4: Closing frame with clear institute branding, confident CTA, and polished end-card composition.`,
    ];
}

async function loadMediaOrganizationContext(organizationId: string | null) {
    if (!organizationId) {
        return {
            organizationLogoUrl: null,
            organizationName: null,
            organizationSummary: "",
            organizationContext: "",
            organizationContextApplied: false,
        } satisfies MediaOrganizationContextState;
    }

    const cached = readTimedCache(mediaOrganizationContextCache, organizationId);
    if (cached) return cached;

    const organization = await prisma.organization.findUnique({
        where: { id: organizationId },
        select: mediaOrganizationSelect,
    });

    if (!organization) {
        const result = {
            organizationLogoUrl: null,
            organizationName: null,
            organizationSummary: "",
            organizationContext: "",
            organizationContextApplied: false,
        } satisfies MediaOrganizationContextState;
        writeTimedCache(mediaOrganizationContextCache, organizationId, result, ORGANIZATION_CONTEXT_CACHE_TTL_MS);
        return result;
    }

    const organizationContext = sanitizePromptFragment(
        buildOrganizationCreativeContext(organization).replace(/\n+/g, "; "),
        560
    );
    const organizationSummary = sanitizePromptFragment(
        buildOrganizationCreativeSummary(organization),
        260
    );

    const result = {
        organizationLogoUrl: organization.logo || null,
        organizationName: organization.name,
        organizationSummary,
        organizationContext,
        organizationContextApplied: Boolean(organizationContext),
    } satisfies MediaOrganizationContextState;
    writeTimedCache(mediaOrganizationContextCache, organizationId, result, ORGANIZATION_CONTEXT_CACHE_TTL_MS);
    return result;
}

function buildEmptyMediaOrganizationContext(): MediaOrganizationContextState {
    return {
        organizationLogoUrl: null,
        organizationName: null,
        organizationSummary: "",
        organizationContext: "",
        organizationContextApplied: false,
    };
}

function buildEmptyMediaKnowledgeContext(): MediaKnowledgeContextState {
    return {
        knowledgeContext: "",
        references: [],
        availableBookCount: 0,
        availableDocumentCount: 0,
        availableMemberCount: 0,
        availableStudentCount: 0,
        availableGeneratedMediaCount: 0,
        availableScheduleCount: 0,
        availableWhiteboardCount: 0,
        totalIndexedItems: 0,
        indexSummary: null,
    };
}

function buildModeInstruction(
    mode: MediaMode,
    aspectRatio: string,
    durationSec: number,
    referenceName?: string
): string {
    const safeReferenceName = sanitizeReferenceName(referenceName);

    switch (mode) {
        case "text_to_image":
            return `Create a finished still image concept aligned tightly to the brief. Keep it visually polished, purposeful, and ready for actual use. Aspect ratio ${aspectRatio}.`;
        case "image_from_reference":
            return `Create a finished still image concept that follows the provided reference${safeReferenceName ? ` (${safeReferenceName})` : ""} for composition, styling, or mood while staying tightly aligned to the brief. Aspect ratio ${aspectRatio}.`;
        case "text_to_video":
            return `Create a short video concept with coherent scene flow and strong brief fidelity. Duration ${durationSec} seconds. Aspect ratio ${aspectRatio}.`;
        case "video_from_reference":
            return `Create a short video concept that follows the provided reference${safeReferenceName ? ` (${safeReferenceName})` : ""} for visual direction while preserving the requested message and audience fit. Duration ${durationSec} seconds. Aspect ratio ${aspectRatio}.`;
        default:
            return `Create media that stays faithful to the brief in aspect ratio ${aspectRatio}.`;
    }
}

function buildMediaPromptPack(input: {
    mode: MediaMode;
    prompt: string;
    style: string;
    aspectRatio: string;
    durationSec: number;
    referenceName?: string;
    organizationLogoUrl?: string | null;
    organizationContext: string;
    organizationSummary: string;
    knowledgeContext: string;
    structuredFacts: string;
    logoInstruction: string;
    brandIntegrityInstruction: string;
    minimalCopyInstruction: string;
    textRenderingInstruction: string;
}): { effectivePrompt: string; storyboardSeed: string } {
    const modeInstruction = buildModeInstruction(
        input.mode,
        input.aspectRatio,
        input.durationSec,
        input.referenceName
    );
    const fidelityInstruction = buildPromptFidelityInstruction(input.mode, input.prompt);
    const promptSegments = [
        fidelityInstruction,
        `User brief: ${input.prompt}`,
        `Generation mode: ${modeInstruction}`,
        input.organizationContext ? `Institute context: ${input.organizationContext}` : "",
        input.organizationLogoUrl
            ? "Official organization logo is available in workspace assets. Reflect its branding, emblem logic, and visual identity consistently in the output."
            : "",
        input.logoInstruction,
        input.brandIntegrityInstruction,
        input.minimalCopyInstruction,
        input.textRenderingInstruction,
        input.knowledgeContext
            ? `Organization knowledge context: ${input.knowledgeContext}. Use this only if it directly supports the user brief; otherwise ignore it.`
            : "",
        input.structuredFacts,
        input.style ? `Preferred style signal from prompt: ${sanitizePromptFragment(input.style, 60)}` : "",
    ].filter(Boolean);

    const effectivePrompt = sanitizePromptFragment(promptSegments.join(" "), 1100);
    const storyboardSeed = sanitizePromptFragment(
        [
            `User brief: ${input.prompt}`,
            fidelityInstruction,
            input.organizationSummary ? `Institute context: ${input.organizationSummary}` : "",
            input.organizationLogoUrl
                ? "Official logo reference available in workspace assets"
                : "",
            input.logoInstruction,
            input.brandIntegrityInstruction,
            input.minimalCopyInstruction,
            input.textRenderingInstruction,
            input.knowledgeContext
                ? `Optional supporting knowledge: ${input.knowledgeContext}`
                : "",
            input.structuredFacts ? `Hard facts: ${input.structuredFacts}` : "",
            sanitizeReferenceName(input.referenceName)
                ? `Reference direction: ${sanitizeReferenceName(input.referenceName)}`
                : "",
            input.style ? `Style signal: ${sanitizePromptFragment(input.style, 60)}` : "",
        ]
            .filter(Boolean)
            .join(". "),
        280
    );

    return {
        effectivePrompt,
        storyboardSeed,
    };
}

export async function GET(request: NextRequest) {
    try {
        const auth = await enforceToolAccess(["media-studio", "pdf-to-pdf"]);
        const url = new URL(request.url);
        const historyOnly =
            url.searchParams.get("historyOnly") === "1" ||
            url.searchParams.get("historyOnly") === "true";
        const limit = Number(url.searchParams.get("limit") || 24);
        const offset = Number(url.searchParams.get("offset") || 0);

        if (historyOnly) {
            const savedMediaPage = await listSavedGeneratedMedia(auth.organizationId, auth.userId, {
                limit,
                offset,
            });

            return NextResponse.json({
                success: true,
                savedMedia: savedMediaPage.items,
                savedMediaPageInfo: {
                    total: savedMediaPage.total,
                    offset: savedMediaPage.offset,
                    limit: savedMediaPage.limit,
                    hasMore: savedMediaPage.hasMore,
                },
            });
        }

        const [organizationContextResult, knowledgeContextResult, savedMediaResult, usageResult] = await Promise.allSettled([
            loadMediaOrganizationContext(auth.organizationId),
            loadMediaKnowledgeContextForPrompt({ organizationId: auth.organizationId, prompt: "" }).catch(() =>
                buildEmptyMediaKnowledgeContext()
            ),
            listSavedGeneratedMedia(auth.organizationId, auth.userId, {
                limit,
                offset,
            }),
            getGeminiUsageSummary(),
        ]);

        const organizationContext =
            organizationContextResult.status === "fulfilled"
                ? organizationContextResult.value
                : buildEmptyMediaOrganizationContext();
        const knowledgeContext =
            knowledgeContextResult.status === "fulfilled"
                ? knowledgeContextResult.value
                : buildEmptyMediaKnowledgeContext();
        const savedMedia =
            savedMediaResult.status === "fulfilled"
                ? savedMediaResult.value.items
                : [];
        const savedMediaPageInfo =
            savedMediaResult.status === "fulfilled"
                ? {
                    total: savedMediaResult.value.total,
                    offset: savedMediaResult.value.offset,
                    limit: savedMediaResult.value.limit,
                    hasMore: savedMediaResult.value.hasMore,
                }
                : {
                    total: 0,
                    offset,
                    limit,
                    hasMore: false,
                };
        const usage = usageResult.status === "fulfilled" ? usageResult.value : null;
        const warnings = [
            organizationContextResult.status === "rejected" ? "Institute context could not be fully loaded." : null,
            savedMediaResult.status === "rejected" ? "Saved gallery history could not be loaded." : null,
            usageResult.status === "rejected" ? "Gemini usage summary is temporarily unavailable." : null,
        ].filter(Boolean);

        return NextResponse.json({
            success: true,
            organizationLogoUrl: organizationContext.organizationLogoUrl,
            organizationName: organizationContext.organizationName,
            organizationSummary: organizationContext.organizationSummary,
            organizationContextApplied: organizationContext.organizationContextApplied,
            availableBookCount: knowledgeContext.availableBookCount,
            availableDocumentCount: knowledgeContext.availableDocumentCount,
            availableMemberCount: knowledgeContext.availableMemberCount,
            availableStudentCount: knowledgeContext.availableStudentCount,
            availableGeneratedMediaCount: knowledgeContext.availableGeneratedMediaCount,
            availableScheduleCount: knowledgeContext.availableScheduleCount,
            availableWhiteboardCount: knowledgeContext.availableWhiteboardCount,
            totalIndexedItems: knowledgeContext.totalIndexedItems,
            indexSummary: knowledgeContext.indexSummary,
            knowledgeReferences: knowledgeContext.references,
            savedMedia,
            savedMediaPageInfo,
            usage,
            warnings,
        });
    } catch (error) {
        console.error("Media context load error:", error);
        const message = error instanceof Error ? error.message : "Failed to load media context";
        if (/forbidden|unauthorized/i.test(message)) {
            return NextResponse.json({ error: "Forbidden" }, { status: 403 });
        }
        return NextResponse.json({ error: message }, { status: 500 });
    }
}

export async function POST(request: NextRequest) {
    try {
        const auth = await enforceToolAccess(["media-studio", "pdf-to-pdf"]);
        const apiKey = process.env.GEMINI_API_KEY;
        if (!apiKey) {
            return NextResponse.json({ error: "GEMINI_API_KEY is not configured." }, { status: 500 });
        }

        const { body, referenceFile, attachmentFiles } = await parseMediaRequest(request);
        const mode = body.mode || "text_to_image";
        const prompt = sanitizePrompt(String(body.prompt || ""));
        const style =
            sanitizePromptFragment(String(body.style || "").trim(), 60) ||
            inferPromptStyle(prompt);
        const aspectRatio =
            sanitizePromptFragment(String(body.aspectRatio || "").trim(), 16) ||
            inferPromptAspectRatio(prompt, mode);
        const durationSec = Math.max(3, Math.min(60, Number(body.durationSec || 12)));
        const referenceName = body.referenceName || referenceFile?.name || null;
        const baseImageModelSelection = resolveImageModel(body.imageModel).selection;

        if (!prompt) {
            return NextResponse.json({ error: "Prompt is required." }, { status: 400 });
        }

        if ((mode === "image_from_reference" || mode === "video_from_reference") && !referenceFile) {
            return NextResponse.json({ error: "Reference file is required for this mode." }, { status: 400 });
        }

        const organizationContextPromise = loadMediaOrganizationContext(auth.organizationId);
        const logoDisabled = promptDisablesLogo(prompt);
        const logoRequired = promptRequiresExactLogo(prompt);
        const organizationContext = await organizationContextPromise;
        const brandContextAllowed = promptRequestsBrandContext({
            prompt,
            organizationName: organizationContext.organizationName,
        });
        const knowledgeContextAllowed = promptRequestsKnowledgeContext({
            prompt,
            brandContextAllowed,
        });
        const knowledgeContextPromise = knowledgeContextAllowed
            ? loadMediaKnowledgeContextForPrompt({ organizationId: auth.organizationId, prompt })
            : Promise.resolve(buildEmptyMediaKnowledgeContext());
        const knowledgeContext = await knowledgeContextPromise;
        const supplementalVisualAssets = await buildSupplementalVisualAssets({
            attachmentFiles,
            knowledgeReferences: knowledgeContext.references,
            prompt,
        });
        const imageModel = resolveImageModelForRequest({
            selection: baseImageModelSelection,
            prompt,
            mode,
            hasReferenceFile: Boolean(referenceFile),
            hasAttachmentFiles: attachmentFiles.length > 0 || supplementalVisualAssets.length > 0,
            logoRequired,
        });
        const textRenderingInstruction = buildTextRenderingInstruction(mode, prompt);
        const minimalCopyInstruction = buildMinimalCopyInstruction(prompt);
        const logoInstruction = buildLogoInstruction({
            hasLogo: Boolean(organizationContext.organizationLogoUrl),
            brandContextAllowed,
            logoRequired,
            logoDisabled,
        });
        const brandIntegrityInstruction = buildBrandIntegrityInstruction({
            prompt,
            organizationName: organizationContext.organizationName,
            brandContextAllowed,
            logoRequired,
        });
        const organizationLogoPart =
            organizationContext.organizationLogoUrl && !logoDisabled && logoRequired
                ? await buildLogoInlineDataPart(organizationContext.organizationLogoUrl)
                : null;
        const scopedOrganizationContext = brandContextAllowed
            ? organizationContext
            : buildEmptyMediaOrganizationContext();
        const structuredFacts = buildStructuredKnowledgeFacts(
            knowledgeContext.references,
            prompt,
            scopedOrganizationContext.organizationName
        );
        const promptPack = buildMediaPromptPack({
            mode,
            prompt,
            style,
            aspectRatio,
            durationSec,
            referenceName: referenceName || undefined,
            organizationLogoUrl: scopedOrganizationContext.organizationLogoUrl,
            organizationContext: scopedOrganizationContext.organizationContext,
            organizationSummary: scopedOrganizationContext.organizationSummary,
            knowledgeContext: knowledgeContext.knowledgeContext,
            structuredFacts,
            logoInstruction,
            brandIntegrityInstruction,
            minimalCopyInstruction,
            textRenderingInstruction,
        });

        if (mode === "text_to_image" || mode === "image_from_reference") {
            const image = await generateGeminiImageAsset({
                apiKey,
                imageModelApi: imageModel.apiModel,
                imageModelLabel: imageModel.label,
                promptCandidates: buildImagePromptCandidates({
                    effectivePrompt: promptPack.effectivePrompt,
                    mode,
                    prompt,
                    style,
                    aspectRatio,
                    durationSec,
                    referenceName: referenceName || undefined,
                    organizationName: scopedOrganizationContext.organizationName,
                    organizationSummary: scopedOrganizationContext.organizationSummary,
                    organizationLogoUrl: scopedOrganizationContext.organizationLogoUrl,
                    logoInstruction,
                    brandIntegrityInstruction,
                    minimalCopyInstruction,
                    knowledgeContext: knowledgeContext.knowledgeContext,
                    structuredFacts,
                    textRenderingInstruction,
                }),
                originalPrompt: prompt,
                referenceFile,
                organizationLogoPart,
                supplementalVisualAssets,
                organizationName: scopedOrganizationContext.organizationName,
                logoRequired,
                logoDisabled,
            });

            const assetUrl = await saveGeneratedMediaAsset(
                image.buffer,
                image.contentType,
                image.contentType.includes("png") ? "png" : undefined
            );

            const [persisted, usage] = await Promise.all([
                persistGeneratedMedia({
                organizationId: auth.organizationId,
                userId: auth.userId,
                mode,
                status: "generated",
                type: "image",
                prompt,
                effectivePrompt: image.promptUsed,
                style,
                aspectRatio,
                durationSec,
                referenceName,
                organizationLogoUrl: scopedOrganizationContext.organizationLogoUrl,
                organizationName: scopedOrganizationContext.organizationName,
                organizationSummary: scopedOrganizationContext.organizationSummary,
                institutionContextApplied: scopedOrganizationContext.organizationContextApplied,
                knowledgeReferences: knowledgeContext.references,
                assetUrl,
                note: image.note,
                }),
                getGeminiUsageSummary(),
            ]);

            return NextResponse.json({
                success: true,
                id: persisted.id,
                mode,
                status: "generated",
                type: "image",
                prompt,
                effectivePrompt: image.promptUsed,
                style,
                aspectRatio,
                referenceName,
                organizationLogoUrl: scopedOrganizationContext.organizationLogoUrl,
                organizationName: scopedOrganizationContext.organizationName,
                organizationSummary: scopedOrganizationContext.organizationSummary,
                institutionContextApplied: scopedOrganizationContext.organizationContextApplied,
                knowledgeReferences: knowledgeContext.references,
                availableBookCount: knowledgeContext.availableBookCount,
                availableDocumentCount: knowledgeContext.availableDocumentCount,
                availableMemberCount: knowledgeContext.availableMemberCount,
                availableStudentCount: knowledgeContext.availableStudentCount,
                availableGeneratedMediaCount: knowledgeContext.availableGeneratedMediaCount,
                availableScheduleCount: knowledgeContext.availableScheduleCount,
                availableWhiteboardCount: knowledgeContext.availableWhiteboardCount,
                totalIndexedItems: knowledgeContext.totalIndexedItems,
                indexSummary: knowledgeContext.indexSummary,
                assetUrl,
                note: image.note,
                createdAt: persisted.createdAt,
                imageModel: imageModel.selection,
                imageModelLabel: imageModel.label,
                usage,
            });
        }

        const storyboard = buildStoryboard(
            promptPack.storyboardSeed,
            durationSec,
            scopedOrganizationContext.organizationName
        );
        const video = await generateGeminiVideoAsset({
            apiKey,
            promptCandidates: buildVideoPromptCandidates({
                effectivePrompt: promptPack.effectivePrompt,
                mode,
                prompt,
                style,
                aspectRatio,
                durationSec,
                referenceName: referenceName || undefined,
                organizationName: scopedOrganizationContext.organizationName,
                organizationSummary: scopedOrganizationContext.organizationSummary,
                organizationLogoUrl: scopedOrganizationContext.organizationLogoUrl,
                logoInstruction,
                brandIntegrityInstruction,
                minimalCopyInstruction,
                knowledgeContext: knowledgeContext.knowledgeContext,
                structuredFacts,
                textRenderingInstruction,
            }),
            aspectRatio,
            durationSec,
            referenceFile,
            organizationLogoPart,
            supplementalVisualAssets,
            logoRequired,
            logoDisabled,
        });

        const [persisted, usage] = await Promise.all([
            persistGeneratedMedia({
            organizationId: auth.organizationId,
            userId: auth.userId,
            mode,
            status: "generated",
            type: "video",
            prompt,
            effectivePrompt: video.promptUsed,
            style,
            aspectRatio,
            durationSec: video.durationSec,
            referenceName,
            organizationLogoUrl: scopedOrganizationContext.organizationLogoUrl,
            organizationName: scopedOrganizationContext.organizationName,
            organizationSummary: scopedOrganizationContext.organizationSummary,
            institutionContextApplied: scopedOrganizationContext.organizationContextApplied,
            knowledgeReferences: knowledgeContext.references,
            assetUrl: video.assetUrl,
            storyboard,
            note: video.note,
            }),
            getGeminiUsageSummary(),
        ]);

        return NextResponse.json({
            success: true,
            id: persisted.id,
            mode,
            status: "generated",
            type: "video",
            prompt,
            effectivePrompt: video.promptUsed,
            style,
            aspectRatio,
            durationSec: video.durationSec,
            referenceName,
            organizationLogoUrl: scopedOrganizationContext.organizationLogoUrl,
            organizationName: scopedOrganizationContext.organizationName,
            organizationSummary: scopedOrganizationContext.organizationSummary,
            institutionContextApplied: scopedOrganizationContext.organizationContextApplied,
            knowledgeReferences: knowledgeContext.references,
            availableBookCount: knowledgeContext.availableBookCount,
            availableDocumentCount: knowledgeContext.availableDocumentCount,
            availableMemberCount: knowledgeContext.availableMemberCount,
            availableStudentCount: knowledgeContext.availableStudentCount,
            availableGeneratedMediaCount: knowledgeContext.availableGeneratedMediaCount,
            availableScheduleCount: knowledgeContext.availableScheduleCount,
            availableWhiteboardCount: knowledgeContext.availableWhiteboardCount,
            totalIndexedItems: knowledgeContext.totalIndexedItems,
            indexSummary: knowledgeContext.indexSummary,
            assetUrl: video.assetUrl,
            storyboard,
            note: video.note,
            createdAt: persisted.createdAt,
            usage,
        });
    } catch (error) {
        console.error("Media generate error:", error);
        const rateLimit = parseGeminiRateLimitInfo(error);
        if (rateLimit.isRateLimited) {
            const message = buildGeminiRateLimitMessage(rateLimit);
            await setGeminiRateBlocked({
                retryAfterSeconds: rateLimit.retryAfterSeconds,
                reason: message,
                isDailyQuota: rateLimit.isDailyQuota,
            });
            return NextResponse.json(
                {
                    error: message,
                    rateLimited: true,
                    usage: await getGeminiUsageSummary(),
                },
                { status: 429 }
            );
        }
        const message = error instanceof Error ? error.message : "Failed to generate media";
        if (/forbidden|unauthorized/i.test(message)) {
            return NextResponse.json({ error: "Forbidden" }, { status: 403 });
        }
        return NextResponse.json(
            {
                error: message,
                usage: await getGeminiUsageSummary(),
            },
            { status: 500 }
        );
    }
}
