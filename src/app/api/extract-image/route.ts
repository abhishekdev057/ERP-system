import { GoogleGenerativeAI } from "@google/generative-ai";
import { NextRequest, NextResponse } from "next/server";
import { enforceToolAccess } from "@/lib/api-auth";
import sharp from "sharp";
import {
    ImageBounds,
    MatchColumnEntry,
    MatchColumns,
    Question,
    QuestionType,
} from "@/types/pdf";
import {
    MAX_IMAGE_SIZE_BYTES,
    MAX_IMAGES_PER_BATCH,
    cropDiagramFromSourceImage,
    normalizeImageBounds,
    saveExtractionImage,
} from "@/lib/services/image-extraction-service";
import { normalizeAnswerFromCandidates } from "@/lib/question-utils";

export const dynamic = "force-dynamic";

const RETRY_CONFIDENCE_THRESHOLD = 0.74;
const WARN_CONFIDENCE_THRESHOLD = 0.68;
const MAX_QUALITY_ISSUES = 8;
const ENABLE_ENHANCED_RETRY = process.env.IMAGE_EXTRACTION_ENABLE_ENHANCED_RETRY !== "false";
const EXTRACTION_ROUTE_MAX_CONCURRENT_IMAGES = Math.max(
    1,
    Number.parseInt(process.env.IMAGE_EXTRACTION_ROUTE_CONCURRENCY || "4", 10) || 4
);
const HIGH_THROUGHPUT_DISABLE_ENHANCED_RETRY_THRESHOLD = Math.max(
    2,
    Number.parseInt(process.env.IMAGE_EXTRACTION_HIGH_THROUGHPUT_THRESHOLD || "6", 10) || 6
);
const EXTRACTION_MODEL_CODES = Array.from(
    new Set(
        (process.env.GEMINI_EXTRACTION_MODELS ||
            [
                process.env.GEMINI_EXTRACTION_MODEL,
                "gemini-2.5-flash",
                process.env.GEMINI_EXTRACTION_FALLBACK_MODEL,
                "gemini-2.5-flash-lite",
            ]
                .filter(Boolean)
                .join(","))
            .split(",")
            .map((value) => value.trim())
            .filter(Boolean)
    )
);
const EXTRACTION_MODEL_SWITCH_DELAY_MS = Math.max(
    250,
    Number.parseInt(process.env.GEMINI_EXTRACTION_MODEL_SWITCH_DELAY_MS || "900", 10) || 900
);

type ExtractionVariant = "original" | "enhanced";
type ProcessingStepStatus = "info" | "success" | "warning" | "error";

type ProcessingStep = {
    id: string;
    stage: string;
    status: ProcessingStepStatus;
    message: string;
    imageName?: string;
    variant?: ExtractionVariant;
    timestamp: string;
};

type ModelBounds = {
    x?: unknown;
    y?: unknown;
    width?: unknown;
    height?: unknown;
};

type ModelOption = {
    english?: unknown;
    hindi?: unknown;
};

type ModelMatchColumns = {
    left?: unknown;
    right?: unknown;
};

type ModelImageQuality = {
    blurry?: unknown;
    lowContrast?: unknown;
    shadowed?: unknown;
    cutText?: unknown;
    notes?: unknown;
};

type ModelQuestion = {
    number?: unknown;
    questionHindi?: unknown;
    questionEnglish?: unknown;
    questionType?: unknown;
    answer?: unknown;
    correctAnswer?: unknown;
    correctOption?: unknown;
    answerKey?: unknown;
    options?: unknown;
    matchColumns?: ModelMatchColumns | null;
    blankCount?: unknown;
    hasDiagram?: unknown;
    diagramCaptionHindi?: unknown;
    diagramCaptionEnglish?: unknown;
    diagramBounds?: ModelBounds | null;
    questionBounds?: ModelBounds | null;
    extractionConfidence?: unknown;
};

type ExtractedQuestion = Question & {
    diagramBounds?: ImageBounds;
    questionBounds?: ImageBounds;
    extractionConfidence?: number;
};

type ExtractionAttemptResult = {
    variant: ExtractionVariant;
    questions: ExtractedQuestion[];
    qualityIssues: string[];
    averageConfidence?: number;
    modelCode: string;
};

type ImageExtractionResult = {
    questions: ExtractedQuestion[];
    warnings: string[];
    qualityIssues: string[];
    averageConfidence?: number;
    chosenVariant: ExtractionVariant;
    processingSteps: ProcessingStep[];
};

type ProcessedImageResult = {
    questions: ExtractedQuestion[];
    warnings: string[];
    processingSteps: ProcessingStep[];
    imageSummary?: {
        imagePath: string;
        imageName: string;
        questionCount: number;
        diagramCount: number;
        qualityIssues: string[];
        extractionMode: ExtractionVariant;
        averageConfidence?: number;
        extractionError?: string;
    };
    quotaExceeded?: boolean;
    retryAfterSeconds?: number;
};

type ExtractionModelRunner = {
    code: string;
    model: ReturnType<GoogleGenerativeAI["getGenerativeModel"]>;
};

function createProcessingStep(
    stage: string,
    status: ProcessingStepStatus,
    message: string,
    imageName?: string,
    variant?: ExtractionVariant
): ProcessingStep {
    return {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        stage,
        status,
        message,
        imageName,
        variant,
        timestamp: new Date().toISOString(),
    };
}

async function runWithConcurrency<T>(
    items: T[],
    concurrency: number,
    worker: (item: T, index: number) => Promise<void>
) {
    if (items.length === 0) return;

    const queue = items.map((item, index) => ({ item, index }));
    const workerCount = Math.max(1, Math.min(concurrency, queue.length));

    await Promise.all(
        Array.from({ length: workerCount }, async () => {
            while (queue.length > 0) {
                const next = queue.shift();
                if (!next) return;
                await worker(next.item, next.index);
            }
        })
    );
}

function normalizeText(value: unknown): string {
    return String(value ?? "")
        .replace(/[^\S\r\n]+/g, " ") // replace horizontal whitespace with single space, preserve newlines
        .replace(/\n\s+\n/g, "\n\n") // clean up empty lines
        .trim();
}

const EXAM_SOURCE_REFERENCE_PATTERN =
    /\b(?:NEET|AIIMS|AIPMT|CBSE\s*PMT|JEE(?:\s*MAIN|\s*ADVANCED)?|CUET|KCET|COMEDK|CPMT|UPSC|NDA|CDS|RRB|REET|CTET|RPSC|SSC(?:\s*CGL)?|JET|UGC\s*NET|NTA)\b/i;

function looksLikeExamSourceReference(value: string): boolean {
    const normalized = normalizeText(value).replace(/[–—]/g, "-");
    if (!normalized) return false;
    if (!/\b(?:19|20)\d{2}\b/.test(normalized)) return false;
    return EXAM_SOURCE_REFERENCE_PATTERN.test(normalized);
}

function stripExamSourceReferences(value: string): string {
    if (!value) return "";

    let next = value;

    next = next.replace(/\(([^()\n]{0,140})\)/g, (full, inner) =>
        looksLikeExamSourceReference(inner) ? "" : full
    );
    next = next.replace(/\[([^[\]\n]{0,140})\]/g, (full, inner) =>
        looksLikeExamSourceReference(inner) ? "" : full
    );
    next = next.replace(
        /\b(?:NEET|AIIMS|AIPMT|CBSE\s*PMT|JEE(?:\s*MAIN|\s*ADVANCED)?|CUET|KCET|COMEDK|CPMT|UPSC|NDA|CDS|RRB|REET|CTET|RPSC|SSC(?:\s*CGL)?|JET|UGC\s*NET|NTA)\b[^\n]{0,48}?\b(?:19|20)\d{2}\b/gi,
        ""
    );

    return normalizeText(
        next
            .replace(/\s{2,}/g, " ")
            .replace(/\s+([,.;:!?/])/g, "$1")
            .replace(/\(\s*\)/g, "")
            .replace(/\[\s*\]/g, "")
            .replace(/\n{3,}/g, "\n\n")
    );
}

type GeminiRateLimitInfo = {
    isRateLimited: boolean;
    isDailyQuota: boolean;
    retryAfterSeconds?: number;
};

type GeminiAvailabilityInfo = {
    isUnavailable: boolean;
    retryAfterSeconds?: number;
};

function parseRetryAfterSeconds(message: string): number | undefined {
    const retryInMatch = message.match(/Please retry in\s+([0-9.]+)s/i);
    if (retryInMatch) {
        const parsed = Number.parseFloat(retryInMatch[1]);
        if (Number.isFinite(parsed) && parsed > 0) {
            return parsed;
        }
    }

    const retryDelayMatch = message.match(/"retryDelay":"([0-9.]+)s"/i);
    if (retryDelayMatch) {
        const parsed = Number.parseFloat(retryDelayMatch[1]);
        if (Number.isFinite(parsed) && parsed > 0) {
            return parsed;
        }
    }

    return undefined;
}

function parseGeminiRateLimitInfo(error: unknown): GeminiRateLimitInfo {
    const raw = normalizeText(error instanceof Error ? error.message : String(error ?? ""));
    const hasRateSignal = /\b429\b|too many requests|rate limit/i.test(raw);
    const hasQuotaSignal = /quota|quota exceeded|quotafailure/i.test(raw);
    const isRateLimited = hasRateSignal || hasQuotaSignal;

    if (!isRateLimited) {
        return {
            isRateLimited: false,
            isDailyQuota: false,
        };
    }

    const isDailyQuota = /perday|daily|generaterequestsperday/i.test(raw);
    const retryAfterSeconds = parseRetryAfterSeconds(raw);

    return {
        isRateLimited,
        isDailyQuota,
        retryAfterSeconds,
    };
}

function parseGeminiAvailabilityInfo(error: unknown): GeminiAvailabilityInfo {
    const raw = normalizeText(error instanceof Error ? error.message : String(error ?? ""));
    const status =
        typeof (error as { status?: unknown })?.status === "number"
            ? Number((error as { status?: unknown }).status)
            : undefined;
    const isUnavailable =
        status === 503 ||
        /\b503\b|service unavailable|currently experiencing high demand|temporarily unavailable|backend unavailable|model is currently unavailable|overloaded|upstream connect error/i.test(
            raw
        );

    return {
        isUnavailable,
        retryAfterSeconds: parseRetryAfterSeconds(raw),
    };
}

async function waitForFallbackSwitch(delayMs: number): Promise<void> {
    if (delayMs <= 0) return;
    await new Promise((resolve) => setTimeout(resolve, delayMs));
}

function compactErrorMessage(error: unknown): string {
    const raw = normalizeText(error instanceof Error ? error.message : String(error ?? ""));
    if (!raw) return "Unexpected extraction error";

    const firstSentence = raw.split(". ")[0] || raw;
    if (firstSentence.length <= 220) return firstSentence;
    return `${firstSentence.slice(0, 217)}...`;
}

function buildRateLimitMessage(info: GeminiRateLimitInfo): string {
    if (info.isDailyQuota) {
        return "Gemini free-tier daily quota is exhausted. Retry after quota reset or upgrade billing plan.";
    }

    if (info.retryAfterSeconds !== undefined) {
        return `Gemini rate limit hit. Retry after ~${Math.ceil(info.retryAfterSeconds)}s.`;
    }

    return "Gemini API quota/rate limit reached. Retry later or reduce request volume.";
}

function normalizeStringList(value: unknown): string[] {
    if (!Array.isArray(value)) return [];
    return value
        .map((item) => normalizeText(item))
        .filter(Boolean)
        .slice(0, MAX_QUALITY_ISSUES);
}

function normalizeConfidence(value: unknown): number | undefined {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return undefined;
    if (numeric < 0 || numeric > 1) return undefined;
    return Number(numeric.toFixed(4));
}

function averageConfidence(questions: ExtractedQuestion[]): number | undefined {
    const withConfidence = questions
        .map((question) => normalizeConfidence(question.extractionConfidence))
        .filter((value): value is number => Number.isFinite(value));

    if (withConfidence.length === 0) return undefined;
    const total = withConfidence.reduce((sum, value) => sum + value, 0);
    return Number((total / withConfidence.length).toFixed(4));
}

function normalizeOptions(
    rawOptions: unknown,
    requireAtLeastTwo: boolean
): Array<{ english: string; hindi: string }> {
    const optionsInput = Array.isArray(rawOptions) ? rawOptions.slice(0, 10) : [];

    const options = optionsInput
        .map((raw) => {
            const option = (raw ?? {}) as ModelOption;
            let english = normalizeText(option.english);
            let hindi = normalizeText(option.hindi);

            if (!english && !hindi) return null;
            if (!english) english = hindi;
            if (!hindi) hindi = english;

            return { english, hindi };
        })
        .filter((option): option is { english: string; hindi: string } => Boolean(option));

    while (requireAtLeastTwo && options.length < 2) {
        options.push({ english: "", hindi: "" });
    }

    return options;
}

function normalizeQuestionType(value: unknown, fallback: QuestionType): QuestionType {
    const raw = normalizeText(value).toUpperCase();
    if (!raw) return fallback;

    const mapped = raw
        .replace(/\s+/g, "_")
        .replace(/-/g, "_")
        .replace(/[()]/g, "");

    const valid: QuestionType[] = [
        "MCQ",
        "FIB",
        "MATCH_COLUMN",
        "TRUE_FALSE",
        "ASSERTION_REASON",
        "NUMERICAL",
        "SHORT_ANSWER",
        "LONG_ANSWER",
        "UNKNOWN",
    ];

    if (valid.includes(mapped as QuestionType)) {
        return mapped as QuestionType;
    }

    if (mapped.includes("MATCH")) return "MATCH_COLUMN";
    if (mapped.includes("BLANK")) return "FIB";
    if (mapped.includes("TRUE")) return "TRUE_FALSE";
    if (mapped.includes("ASSERT")) return "ASSERTION_REASON";
    if (mapped.includes("NUMER")) return "NUMERICAL";
    if (mapped.includes("LONG")) return "LONG_ANSWER";
    if (mapped.includes("SHORT")) return "SHORT_ANSWER";
    if (mapped.includes("MCQ")) return "MCQ";

    return fallback;
}

function inferQuestionType(
    questionHindi: string,
    questionEnglish: string,
    optionCount: number
): QuestionType {
    const combined = `${questionHindi} ${questionEnglish}`.toLowerCase();

    if (
        /match\s*column|column\s*[- ]?\s*i|column\s*[- ]?\s*ii|सुमेलित|मिलान|स्तंभ-?i|स्तम्भ-?i|स्तंभ-?ii|स्तम्भ-?ii/.test(
            combined
        )
    ) {
        return "MATCH_COLUMN";
    }

    if (/fill\s*in\s*the\s*blank|blank|रिक्त\s*स्थान|रिक्तस्थान|____|_{2,}/.test(combined)) {
        return "FIB";
    }

    if (/true\s*false|सत्य\s*असत्य|सही\s*गलत/.test(combined)) {
        return "TRUE_FALSE";
    }

    if (/assertion|reason|कथन|कारण/.test(combined)) {
        return "ASSERTION_REASON";
    }

    if (/numerical|calculate|गणना|परिकलन|निकालिए|निकालो/.test(combined)) {
        return "NUMERICAL";
    }

    if (optionCount >= 2) return "MCQ";
    return "SHORT_ANSWER";
}

function normalizeMatchColumnEntry(raw: unknown): MatchColumnEntry | null {
    if (typeof raw === "string") {
        const text = normalizeText(raw);
        if (!text) return null;
        return { english: text, hindi: text };
    }

    if (!raw || typeof raw !== "object") return null;
    const entry = raw as Record<string, unknown>;
    let english = normalizeText(entry.english);
    let hindi = normalizeText(entry.hindi);
    if (!english && !hindi) return null;
    if (!english) english = hindi;
    if (!hindi) hindi = english;
    return { english, hindi };
}

function normalizeMatchColumns(raw: unknown): MatchColumns | undefined {
    if (!raw || typeof raw !== "object") return undefined;

    const candidate = raw as Record<string, unknown>;
    const left = Array.isArray(candidate.left)
        ? candidate.left
            .map(normalizeMatchColumnEntry)
            .filter((entry): entry is MatchColumnEntry => Boolean(entry))
            .slice(0, 12)
        : [];
    const right = Array.isArray(candidate.right)
        ? candidate.right
            .map(normalizeMatchColumnEntry)
            .filter((entry): entry is MatchColumnEntry => Boolean(entry))
            .slice(0, 12)
        : [];

    if (left.length === 0 && right.length === 0) return undefined;
    return { left, right };
}

function normalizeBlankCount(
    raw: unknown,
    questionType: QuestionType,
    questionHindi: string,
    questionEnglish: string
): number | undefined {
    const parsed = Number.parseInt(String(raw ?? ""), 10);
    if (Number.isFinite(parsed) && parsed > 0) {
        return Math.min(parsed, 20);
    }

    if (questionType !== "FIB") return undefined;

    const combined = `${questionHindi}\n${questionEnglish}`;
    const underscoreHits = combined.match(/_{2,}/g)?.length || 0;
    const hindiBlankHits = combined.match(/रिक्त\s*स्थान/g)?.length || 0;
    const englishBlankHits = combined.match(/\bblank\b/gi)?.length || 0;
    return Math.max(1, underscoreHits + hindiBlankHits + englishBlankHits || 1);
}

function extractJsonObject(input: string): string {
    const startObject = input.indexOf("{");
    const startArray = input.indexOf("[");
    const start =
        startObject === -1
            ? startArray
            : startArray === -1
                ? startObject
                : Math.min(startObject, startArray);

    if (start === -1) {
        throw new Error("Model output did not include JSON");
    }

    const endObject = input.lastIndexOf("}");
    const endArray = input.lastIndexOf("]");
    const end = Math.max(endObject, endArray);

    if (end <= start) {
        throw new Error("Model JSON block is malformed");
    }

    return input.slice(start, end + 1);
}

function normalizeQuestions(
    rawQuestions: ModelQuestion[],
    imagePath: string,
    imageName: string,
    startNumber: number
): ExtractedQuestion[] {
    const normalized: ExtractedQuestion[] = [];

    for (let index = 0; index < rawQuestions.length; index += 1) {
        const raw = rawQuestions[index];
        let questionHindi = normalizeText(raw.questionHindi);
        let questionEnglish = normalizeText(raw.questionEnglish);

        const cleanedQuestionHindi = stripExamSourceReferences(questionHindi);
        const cleanedQuestionEnglish = stripExamSourceReferences(questionEnglish);
        if (cleanedQuestionHindi) questionHindi = cleanedQuestionHindi;
        if (cleanedQuestionEnglish) questionEnglish = cleanedQuestionEnglish;

        if (!questionHindi && !questionEnglish) continue;
        if (!questionHindi) questionHindi = questionEnglish;
        if (!questionEnglish) questionEnglish = questionHindi;

        const provisionalOptions = normalizeOptions(raw.options, false);
        const inferredType = inferQuestionType(
            questionHindi,
            questionEnglish,
            provisionalOptions.length
        );
        let questionType = normalizeQuestionType(raw.questionType, inferredType);

        if (inferredType === "MATCH_COLUMN" && questionType === "MCQ") {
            questionType = "MATCH_COLUMN";
        }

        const requireAtLeastTwoOptions =
            questionType === "MCQ" ||
            questionType === "TRUE_FALSE" ||
            questionType === "ASSERTION_REASON";
        const options = normalizeOptions(raw.options, requireAtLeastTwoOptions);
        const diagramBounds = normalizeImageBounds(raw.diagramBounds);
        const questionBounds = normalizeImageBounds(raw.questionBounds);
        const matchColumns = normalizeMatchColumns(raw.matchColumns);
        const blankCount = normalizeBlankCount(
            raw.blankCount,
            questionType,
            questionHindi,
            questionEnglish
        );
        const hasDiagram =
            raw.hasDiagram === true ||
            String(raw.hasDiagram).toLowerCase() === "true" ||
            Boolean(diagramBounds);

        normalized.push({
            number: normalizeText(raw.number) || String(startNumber + index),
            questionHindi,
            questionEnglish,
            options,
            answer: normalizeAnswerFromCandidates(
                [raw.answer, raw.correctAnswer, raw.correctOption, raw.answerKey],
                options.length,
                true
            ),
            sourceImagePath: imagePath,
            sourceImageName: imageName,
            diagramImagePath: undefined,
            autoDiagramImagePath: undefined,
            diagramDetected: hasDiagram,
            diagramBounds,
            questionBounds,
            questionType,
            matchColumns,
            blankCount,
            diagramCaptionHindi: normalizeText(raw.diagramCaptionHindi) || undefined,
            diagramCaptionEnglish: normalizeText(raw.diagramCaptionEnglish) || undefined,
            extractionConfidence: normalizeConfidence(raw.extractionConfidence),
        });
    }

    return normalized;
}

function extractRawQuestions(parsed: unknown): ModelQuestion[] {
    if (Array.isArray(parsed)) {
        return parsed as ModelQuestion[];
    }

    if (!parsed || typeof parsed !== "object") {
        return [];
    }

    const envelope = parsed as Record<string, unknown>;
    return Array.isArray(envelope.questions) ? (envelope.questions as ModelQuestion[]) : [];
}

function extractQualityIssues(parsed: unknown): string[] {
    if (!parsed || typeof parsed !== "object") return [];
    const envelope = parsed as Record<string, unknown>;
    const issues: string[] = [];

    issues.push(...normalizeStringList(envelope.qualityIssues));
    issues.push(...normalizeStringList(envelope.imageQualityIssues));
    issues.push(...normalizeStringList(envelope.extractionWarnings));

    const imageQuality = envelope.imageQuality as ModelImageQuality | undefined;
    if (imageQuality && typeof imageQuality === "object") {
        if (imageQuality.blurry === true) issues.push("Image text appears blurry");
        if (imageQuality.lowContrast === true) issues.push("Image has low contrast");
        if (imageQuality.shadowed === true) issues.push("Image contains shadows");
        if (imageQuality.cutText === true) issues.push("Some text appears cut/cropped");
        const qualityNotes = normalizeText(imageQuality.notes);
        if (qualityNotes) issues.push(qualityNotes);
    }

    const topLevelNotes = normalizeText(envelope.qualityNotes);
    if (topLevelNotes) issues.push(topLevelNotes);

    return dedupeWarnings(issues).slice(0, MAX_QUALITY_ISSUES);
}

function isOptionType(questionType: QuestionType | undefined): boolean {
    return (
        questionType === "MCQ" ||
        questionType === "TRUE_FALSE" ||
        questionType === "ASSERTION_REASON"
    );
}

function scoreExtractionAttempt(attempt: ExtractionAttemptResult): number {
    const avgConfidence = attempt.averageConfidence ?? 0.4;
    const questionCount = attempt.questions.length;
    const typedCount = attempt.questions.filter(
        (question) => question.questionType && question.questionType !== "UNKNOWN"
    ).length;
    const structurallyValid = attempt.questions.filter((question) => {
        if (isOptionType(question.questionType)) return question.options.length >= 2;
        if (question.questionType === "MATCH_COLUMN") {
            return Boolean(
                question.matchColumns &&
                question.matchColumns.left.length > 0 &&
                question.matchColumns.right.length > 0
            );
        }
        if (question.questionType === "FIB") return Boolean(question.blankCount && question.blankCount >= 1);
        return Boolean(question.questionHindi || question.questionEnglish);
    }).length;

    const score =
        questionCount * 6 +
        typedCount * 1.8 +
        structurallyValid * 1.4 +
        avgConfidence * 12 -
        attempt.qualityIssues.length * 1.5;

    return Number(score.toFixed(4));
}

function shouldRetryWithEnhanced(attempt: ExtractionAttemptResult): boolean {
    if (attempt.questions.length === 0) return true;
    if ((attempt.averageConfidence ?? 0) < RETRY_CONFIDENCE_THRESHOLD) return true;

    const unknownCount = attempt.questions.filter(
        (question) => !question.questionType || question.questionType === "UNKNOWN"
    ).length;
    if (unknownCount / Math.max(attempt.questions.length, 1) > 0.45) return true;

    return attempt.qualityIssues.some((issue) =>
        /blur|blurry|contrast|shadow|faint|illegible|cut|cropped|tilt|noisy/i.test(issue)
    );
}

async function buildEnhancedImageBuffer(sourceBuffer: Buffer): Promise<Buffer> {
    return sharp(sourceBuffer)
        .rotate()
        .grayscale()
        .normalize()
        .sharpen({ sigma: 1.1, m1: 0.3, m2: 1.3, x1: 2, y2: 12, y3: 18 })
        .linear(1.12, -8)
        .png({ compressionLevel: 9 })
        .toBuffer();
}

function buildExtractionPrompt(variant: ExtractionVariant): string {
    const variantHint =
        variant === "enhanced"
            ? "This is an enhanced preprocessed image pass for blurry/low-contrast text. Recover clipped and faint text carefully."
            : "This is the original image pass.";

    return `
You are an OCR and exam-sheet extraction engine.
${variantHint}
Extract ALL visible questions in strict top-to-bottom order.
Return strict JSON only in this format:
{
  "qualityIssues": ["optional issue 1", "optional issue 2"],
  "imageQuality": {
    "blurry": false,
    "lowContrast": false,
    "shadowed": false,
    "cutText": false,
    "notes": "optional"
  },
  "questions": [
    {
      "number": "42",
      "questionType": "MCQ",
      "answer": "1",
      "questionHindi": "...",
      "questionEnglish": "...",
      "options": [
        { "english": "...", "hindi": "..." }
      ],
      "matchColumns": {
        "left": [{ "english": "...", "hindi": "..." }],
        "right": [{ "english": "...", "hindi": "..." }]
      },
      "blankCount": 1,
      "hasDiagram": true,
      "diagramCaptionHindi": "...",
      "diagramCaptionEnglish": "...",
      "questionBounds": { "x": 0.12, "y": 0.18, "width": 0.76, "height": 0.34 },
      "diagramBounds": { "x": 0.24, "y": 0.31, "width": 0.46, "height": 0.20 },
      "extractionConfidence": 0.94
    }
  ]
}

Rules:
1. Include every visible question and all options for each question.
2. Preserve original question numbers when visible.
3. Detect questionType as one of:
   MCQ, FIB, MATCH_COLUMN, TRUE_FALSE, ASSERTION_REASON, NUMERICAL, SHORT_ANSWER, LONG_ANSWER.
4. Keep option order exactly as shown in the source. Do NOT reformat, summarize, or abstract options. Provide exact text and exact sequence.
5. For bilingual fields:
   - If both Hindi and English are present, capture both.
   - If only one language is present, translate the missing language when confident.
   - If uncertain, copy existing text to both fields.
6. For MATCH_COLUMN, fill matchColumns.left and matchColumns.right in order.
7. For FIB, set blankCount from detected blank placeholders.
8. For non-option question types, use empty options array.
9. Set hasDiagram=true only when a real figure/diagram/photo belongs to that question.
10. Provide normalized bounds in range 0..1:
    - questionBounds for the full question block.
    - diagramBounds for only the diagram region of that question.
11. extractionConfidence must be 0..1.
12. If text is blurry/cut/uncertain, keep best effort text and add issue to qualityIssues.
13. CRITICAL: Preserve structural line breaks (\n) exactly where semantically required. Start a new line before each list/member statement like 'A. ...', 'B. ...', '(a) ...', '(b) ...', 'I. ...', 'II. ...', '1. ...', '2. ...' inside questions.
14. CRITICAL: If a question consists of matching two columns (e.g. Column-I and Column-II), questionType MUST be MATCH_COLUMN, NEVER MCQ. Even if there are multiple-choice options (e.g. A->1, B->2...) at the bottom, it is STILL a MATCH_COLUMN question. You MUST include BOTH the matchColumns object AND the options array for that exact same question.
15. CRITICAL: When extracting options, do NOT hallucinate formats like "a - p, b - q". You MUST extract the exact characters printed on the page exactly as they appear for each option choice (e.g. "(1) a - r, b - s, c - p, d - q").
16. CRITICAL: Do not omit local section labels inside the question body (e.g., "सूची-I", "सूची-II", "Column-I", "Column-II", "कथन-I", "कथन-II", "Assertion", "Reason"). Keep them in question text or match columns exactly where they belong.
17. CRITICAL: Keep the question stem and option wording faithful to the source. Do NOT simplify, rewrite, paraphrase, or change the meaning.
18. CRITICAL: Remove prior-exam source references such as exam names and years from the question stem text (examples: "NEET-2019", "CBSE PMT-2009"), but keep the actual question and option wording unchanged.
19. CRITICAL: For option-based questions, if an answer key/answer marker is visible, populate "answer" as the numeric option position only ("1", "2", "3", "4"), never "A/B/C/D". If no answer is visible, return empty string or omit answer.
20. CRITICAL: Keep structured content reliable. Do not move option text into the question stem, do not merge match-column entries into options, and do not flatten assertion/reason or numbered statements into a single paragraph.
21. No markdown, no commentary, JSON only.
`;
}

async function runExtractionAttempt(
    modelRunner: ExtractionModelRunner,
    args: {
        buffer: Buffer;
        mimeType: string;
        variant: ExtractionVariant;
        imagePath: string;
        imageName: string;
        startQuestionNumber: number;
    }
): Promise<ExtractionAttemptResult> {
    const prompt = buildExtractionPrompt(args.variant);
    const imagePart = {
        inlineData: {
            data: args.buffer.toString("base64"),
            mimeType: args.mimeType,
        },
    };

    const result = await modelRunner.model.generateContent([prompt, imagePart]);
    const response = await result.response;
    const text = response.text().trim();
    const jsonText = extractJsonObject(text);
    const parsed = JSON.parse(jsonText) as unknown;

    const rawQuestions = extractRawQuestions(parsed);
    const questions = normalizeQuestions(
        rawQuestions,
        args.imagePath,
        args.imageName,
        args.startQuestionNumber
    );
    const qualityIssues = extractQualityIssues(parsed);

    return {
        variant: args.variant,
        questions,
        qualityIssues,
        averageConfidence: averageConfidence(questions),
        modelCode: modelRunner.code,
    };
}

async function runExtractionAttemptWithFallback(
    models: ExtractionModelRunner[],
    args: Parameters<typeof runExtractionAttempt>[1]
): Promise<{
    attempt: ExtractionAttemptResult;
    processingSteps: ProcessingStep[];
}> {
    const processingSteps: ProcessingStep[] = [];
    let lastError: unknown;

    for (let index = 0; index < models.length; index += 1) {
        const modelRunner = models[index];
        const hasNextModel = index < models.length - 1;

        processingSteps.push(
            createProcessingStep(
                "ocr_model_attempt",
                "info",
                `Trying ${modelRunner.code} for ${args.variant} extraction.`,
                args.imageName,
                args.variant
            )
        );

        try {
            const attempt = await runExtractionAttempt(modelRunner, args);
            processingSteps.push(
                createProcessingStep(
                    "ocr_model_success",
                    "success",
                    `${modelRunner.code} completed ${args.variant} extraction successfully.`,
                    args.imageName,
                    args.variant
                )
            );
            return { attempt, processingSteps };
        } catch (error) {
            lastError = error;
            const availability = parseGeminiAvailabilityInfo(error);
            const rateLimit = parseGeminiRateLimitInfo(error);
            const fallbackable =
                availability.isUnavailable || (rateLimit.isRateLimited && !rateLimit.isDailyQuota);

            processingSteps.push(
                createProcessingStep(
                    "ocr_model_failed",
                    fallbackable && hasNextModel ? "warning" : "error",
                    fallbackable && hasNextModel
                        ? `${modelRunner.code} could not serve the request. Switching to the next fallback model.`
                        : `${modelRunner.code} extraction failed: ${compactErrorMessage(error)}`,
                    args.imageName,
                    args.variant
                )
            );

            if (!fallbackable || !hasNextModel) {
                throw error;
            }

            const delayMs =
                ((availability.retryAfterSeconds ?? rateLimit.retryAfterSeconds) || 0) > 0
                    ? Math.ceil(
                          ((availability.retryAfterSeconds ?? rateLimit.retryAfterSeconds) || 0) * 1000
                      )
                    : EXTRACTION_MODEL_SWITCH_DELAY_MS;
            await waitForFallbackSwitch(delayMs);
        }
    }

    throw lastError instanceof Error ? lastError : new Error("All extraction models failed.");
}

function pickBestAttempt(attempts: ExtractionAttemptResult[]): ExtractionAttemptResult {
    let best = attempts[0];
    let bestScore = scoreExtractionAttempt(best);

    for (let index = 1; index < attempts.length; index += 1) {
        const candidate = attempts[index];
        const candidateScore = scoreExtractionAttempt(candidate);

        if (candidateScore > bestScore + 0.1) {
            best = candidate;
            bestScore = candidateScore;
            continue;
        }

        if (Math.abs(candidateScore - bestScore) <= 0.1) {
            const bestConfidence = best.averageConfidence ?? 0;
            const candidateConfidence = candidate.averageConfidence ?? 0;
            if (candidateConfidence > bestConfidence) {
                best = candidate;
                bestScore = candidateScore;
            }
        }
    }

    return best;
}

async function extractQuestionsForImage(
    models: ExtractionModelRunner[],
    file: File,
    imagePath: string,
    imageName: string,
    startQuestionNumber: number,
    allowEnhancedRetry: boolean
): Promise<ImageExtractionResult> {
    const sourceBuffer = Buffer.from(await file.arrayBuffer());
    const processingSteps: ProcessingStep[] = [];
    const warnings: string[] = [];

    processingSteps.push(
        createProcessingStep(
            "ocr_original_start",
            "info",
            "Starting OCR pass on original image.",
            imageName,
            "original"
        )
    );

    const originalResult = await runExtractionAttemptWithFallback(models, {
        buffer: sourceBuffer,
        mimeType: file.type || "image/png",
        variant: "original",
        imagePath,
        imageName,
        startQuestionNumber,
    });
    const originalAttempt = originalResult.attempt;
    processingSteps.push(...originalResult.processingSteps);

    processingSteps.push(
        createProcessingStep(
            "ocr_original_done",
            originalAttempt.questions.length > 0 ? "success" : "warning",
            `Original pass detected ${originalAttempt.questions.length} question(s)${originalAttempt.averageConfidence !== undefined
                ? ` with avg confidence ${Math.round(originalAttempt.averageConfidence * 100)}%`
                : ""
            } using ${originalAttempt.modelCode}.`,
            imageName,
            "original"
        )
    );

    let attempts: ExtractionAttemptResult[] = [originalAttempt];

    if (allowEnhancedRetry && shouldRetryWithEnhanced(originalAttempt)) {
        processingSteps.push(
            createProcessingStep(
                "ocr_retry_enhanced",
                "info",
                "Running enhanced OCR pass for low-confidence or degraded image text.",
                imageName,
                "enhanced"
            )
        );

        const enhancedBuffer = await buildEnhancedImageBuffer(sourceBuffer);
        const enhancedResult = await runExtractionAttemptWithFallback(models, {
            buffer: enhancedBuffer,
            mimeType: "image/png",
            variant: "enhanced",
            imagePath,
            imageName,
            startQuestionNumber,
        });
        const enhancedAttempt = enhancedResult.attempt;
        processingSteps.push(...enhancedResult.processingSteps);

        attempts = [...attempts, enhancedAttempt];
        processingSteps.push(
            createProcessingStep(
                "ocr_enhanced_done",
                enhancedAttempt.questions.length > 0 ? "success" : "warning",
                `Enhanced pass detected ${enhancedAttempt.questions.length} question(s)${enhancedAttempt.averageConfidence !== undefined
                    ? ` with avg confidence ${Math.round(enhancedAttempt.averageConfidence * 100)}%`
                    : ""
                } using ${enhancedAttempt.modelCode}.`,
                imageName,
                "enhanced"
            )
        );
    } else if (!allowEnhancedRetry && shouldRetryWithEnhanced(originalAttempt)) {
        processingSteps.push(
            createProcessingStep(
                "ocr_retry_skipped",
                "warning",
                "Enhanced OCR retry is disabled by configuration.",
                imageName,
                "original"
            )
        );
    }

    const selectedAttempt = pickBestAttempt(attempts);

    if (selectedAttempt.variant !== "original") {
        processingSteps.push(
            createProcessingStep(
                "ocr_variant_selected",
                "success",
                "Enhanced OCR result selected as the best extraction output.",
                imageName,
                selectedAttempt.variant
            )
        );
    }

    if (selectedAttempt.questions.length === 0) {
        warnings.push(`No questions were detected in ${imageName}`);
    }

    if (
        selectedAttempt.averageConfidence !== undefined &&
        selectedAttempt.averageConfidence < WARN_CONFIDENCE_THRESHOLD
    ) {
        warnings.push(
            `${imageName}: extraction confidence is low (${Math.round(
                selectedAttempt.averageConfidence * 100
            )}%). Verify text for blur/cut issues.`
        );
    }

    if (selectedAttempt.qualityIssues.length > 0) {
        warnings.push(
            `${imageName}: quality issues detected - ${selectedAttempt.qualityIssues.join("; ")}`
        );
    }

    return {
        questions: selectedAttempt.questions,
        warnings,
        qualityIssues: selectedAttempt.qualityIssues,
        averageConfidence: selectedAttempt.averageConfidence,
        chosenVariant: selectedAttempt.variant,
        processingSteps,
    };
}

function dedupeWarnings(warnings: string[]): string[] {
    return Array.from(new Set(warnings.map((item) => item.trim()).filter(Boolean)));
}

function renumberExtractedQuestions(questions: ExtractedQuestion[]): ExtractedQuestion[] {
    return questions.map((question, index) => ({
        ...question,
        number: String(index + 1),
    }));
}

export async function POST(req: NextRequest) {
    try {
        await enforceToolAccess("pdf-to-pdf");

        const apiKey = process.env.GEMINI_API_KEY;
        if (!apiKey) {
            return NextResponse.json(
                { error: "Gemini API key is not configured in environment variables." },
                { status: 500 }
            );
        }

        const formData = await req.formData();
        const uploadedFiles = formData
            .getAll("images")
            .filter((entry): entry is File => entry instanceof File && entry.size > 0);

        if (uploadedFiles.length === 0) {
            const maybeSingle = formData.get("image");
            if (maybeSingle instanceof File && maybeSingle.size > 0) {
                uploadedFiles.push(maybeSingle);
            }
        }

        if (uploadedFiles.length === 0) {
            return NextResponse.json({ error: "No image provided" }, { status: 400 });
        }

        if (uploadedFiles.length > MAX_IMAGES_PER_BATCH) {
            return NextResponse.json(
                {
                    error: `Too many images in one request. Maximum allowed is ${MAX_IMAGES_PER_BATCH}.`,
                    maxImagesPerBatch: MAX_IMAGES_PER_BATCH,
                },
                { status: 429 }
            );
        }

        for (const file of uploadedFiles) {
            if (!file.type.startsWith("image/")) {
                return NextResponse.json(
                    { error: `Unsupported file type: ${file.name}` },
                    { status: 400 }
                );
            }

            if (file.size > MAX_IMAGE_SIZE_BYTES) {
                return NextResponse.json(
                    {
                        error: `Image ${file.name} exceeds size limit (${Math.round(
                            MAX_IMAGE_SIZE_BYTES / (1024 * 1024)
                        )}MB).`,
                    },
                    { status: 413 }
                );
            }
        }

        const genAI = new GoogleGenerativeAI(apiKey);
        const extractionModels: ExtractionModelRunner[] = EXTRACTION_MODEL_CODES.map((modelCode) => ({
            code: modelCode,
            model: genAI.getGenerativeModel({
                model: modelCode,
                generationConfig: {
                    temperature: 0.1,
                    responseMimeType: "application/json",
                },
            }),
        }));

        const questions: ExtractedQuestion[] = [];
        const imageSummaries: Array<{
            imagePath: string;
            imageName: string;
            questionCount: number;
            diagramCount: number;
            qualityIssues: string[];
            extractionMode: ExtractionVariant;
            averageConfidence?: number;
            extractionError?: string;
        }> = [];
        const warnings: string[] = [];
        const processingSteps: ProcessingStep[] = [];
        processingSteps.push(
            createProcessingStep(
                "ocr_model_chain_ready",
                "info",
                `Extraction model chain ready: ${extractionModels.map((entry) => entry.code).join(" -> ")}.`
            )
        );
        let quotaHalted = false;
        let quotaRetryAfterSeconds: number | undefined;
        const allowEnhancedRetryForRequest =
            ENABLE_ENHANCED_RETRY &&
            uploadedFiles.length < HIGH_THROUGHPUT_DISABLE_ENHANCED_RETRY_THRESHOLD;
        const processedResults = new Array<ProcessedImageResult | null>(uploadedFiles.length).fill(null);
        const quotaState: {
            halted: boolean;
            retryAfterSeconds?: number;
        } = { halted: false };

        if (!allowEnhancedRetryForRequest && ENABLE_ENHANCED_RETRY) {
            processingSteps.push(
                createProcessingStep(
                    "high_throughput_mode",
                    "info",
                    `High-throughput extraction mode enabled for ${uploadedFiles.length} image(s). Enhanced retry is skipped for faster bulk extraction.`
                )
            );
        }

        await runWithConcurrency(
            uploadedFiles,
            EXTRACTION_ROUTE_MAX_CONCURRENT_IMAGES,
            async (file, fileIndex) => {
                if (quotaState.halted) {
                    processedResults[fileIndex] = {
                        questions: [],
                        warnings: [
                            `${file.name}: skipped because Gemini quota/rate limit is active for this request.`,
                        ],
                        processingSteps: [
                            createProcessingStep(
                                "image_skipped_quota",
                                "warning",
                                `Skipped ${file.name} because Gemini quota/rate limit is active.`,
                                file.name
                            ),
                        ],
                        quotaExceeded: true,
                        retryAfterSeconds: quotaState.retryAfterSeconds,
                    };
                    return;
                }

                const localWarnings: string[] = [];
                const localProcessingSteps: ProcessingStep[] = [
                    createProcessingStep(
                        "image_received",
                        "info",
                        `Received image ${file.name}.`,
                        file.name
                    ),
                ];

                const stored = await saveExtractionImage(file);
                localProcessingSteps.push(
                    createProcessingStep(
                        "image_saved",
                        "success",
                        "Saved source image for extraction and auditing.",
                        file.name
                    )
                );

                try {
                    const extractedResult = await extractQuestionsForImage(
                        extractionModels,
                        file,
                        stored.imagePath,
                        file.name,
                        1,
                        allowEnhancedRetryForRequest
                    );

                    localWarnings.push(...extractedResult.warnings);
                    localProcessingSteps.push(...extractedResult.processingSteps);

                    let diagramCount = 0;
                    const finalized: ExtractedQuestion[] = [];

                    for (const question of extractedResult.questions) {
                        const nextQuestion = { ...question };

                        if (nextQuestion.diagramDetected) {
                            if (nextQuestion.diagramBounds) {
                                try {
                                    const crop = await cropDiagramFromSourceImage(
                                        stored,
                                        nextQuestion.number,
                                        nextQuestion.diagramBounds
                                    );

                                    if (crop) {
                                        nextQuestion.diagramImagePath = crop.imagePath;
                                        nextQuestion.autoDiagramImagePath = crop.imagePath;
                                        localProcessingSteps.push(
                                            createProcessingStep(
                                                "diagram_crop_success",
                                                "success",
                                                `Diagram crop created for question ${nextQuestion.number}.`,
                                                file.name
                                            )
                                        );
                                    } else {
                                        localWarnings.push(
                                            `${file.name}: could not create diagram crop for question ${nextQuestion.number}`
                                        );
                                        localProcessingSteps.push(
                                            createProcessingStep(
                                                "diagram_crop_empty",
                                                "warning",
                                                `Diagram crop was not generated for question ${nextQuestion.number}.`,
                                                file.name
                                            )
                                        );
                                    }
                                } catch (error) {
                                    localWarnings.push(
                                        `${file.name}: diagram crop failed for question ${nextQuestion.number}`
                                    );
                                    localProcessingSteps.push(
                                        createProcessingStep(
                                            "diagram_crop_error",
                                            "warning",
                                            `Diagram crop failed for question ${nextQuestion.number}.`,
                                            file.name
                                        )
                                    );
                                    console.error("Diagram crop error:", error);
                                }
                            } else {
                                localWarnings.push(
                                    `${file.name}: diagram detected for question ${nextQuestion.number}, but bounds were missing`
                                );
                                localProcessingSteps.push(
                                    createProcessingStep(
                                        "diagram_bounds_missing",
                                        "warning",
                                        `Diagram bounds missing for question ${nextQuestion.number}.`,
                                        file.name
                                    )
                                );
                            }

                            if (nextQuestion.diagramImagePath) {
                                diagramCount += 1;
                            }
                        }

                        finalized.push(nextQuestion);
                    }

                    localProcessingSteps.push(
                        createProcessingStep(
                            "image_complete",
                            finalized.length > 0 ? "success" : "warning",
                            `Completed extraction for ${file.name}: ${finalized.length} question(s), ${diagramCount} diagram(s).`,
                            file.name,
                            extractedResult.chosenVariant
                        )
                    );

                    processedResults[fileIndex] = {
                        questions: finalized,
                        warnings: localWarnings,
                        processingSteps: localProcessingSteps,
                        imageSummary: {
                            imagePath: stored.imagePath,
                            imageName: file.name,
                            questionCount: finalized.length,
                            diagramCount,
                            qualityIssues: extractedResult.qualityIssues,
                            extractionMode: extractedResult.chosenVariant,
                            averageConfidence: extractedResult.averageConfidence,
                        },
                    };
                } catch (error) {
                    console.error(`Extraction failed for ${file.name}:`, error);
                    const rateLimit = parseGeminiRateLimitInfo(error);
                    const extractionError = rateLimit.isRateLimited
                        ? buildRateLimitMessage(rateLimit)
                        : compactErrorMessage(error);

                    if (rateLimit.isRateLimited) {
                        quotaState.halted = true;
                        if (rateLimit.retryAfterSeconds !== undefined) {
                            quotaState.retryAfterSeconds = rateLimit.retryAfterSeconds;
                        }
                        localWarnings.push(`${file.name}: ${extractionError}`);
                        localProcessingSteps.push(
                            createProcessingStep(
                                "gemini_rate_limited",
                                "warning",
                                `${extractionError} Remaining images in this batch will be skipped.`,
                                file.name
                            )
                        );
                    } else {
                        localWarnings.push(`${file.name}: ${extractionError}`);
                    }

                    localProcessingSteps.push(
                        createProcessingStep(
                            "image_error",
                            "error",
                            `Extraction failed for ${file.name}.`,
                            file.name
                        )
                    );

                    processedResults[fileIndex] = {
                        questions: [],
                        warnings: localWarnings,
                        processingSteps: localProcessingSteps,
                        imageSummary: {
                            imagePath: stored.imagePath,
                            imageName: file.name,
                            questionCount: 0,
                            diagramCount: 0,
                            qualityIssues: [],
                            extractionMode: "original",
                            averageConfidence: undefined,
                            extractionError,
                        },
                        quotaExceeded: rateLimit.isRateLimited,
                        retryAfterSeconds: rateLimit.retryAfterSeconds,
                    };
                }
            }
        );

        for (const processed of processedResults) {
            if (!processed) continue;
            questions.push(...processed.questions);
            warnings.push(...processed.warnings);
            processingSteps.push(...processed.processingSteps);
            if (processed.imageSummary) {
                imageSummaries.push(processed.imageSummary);
            }
            if (processed.quotaExceeded) {
                quotaHalted = true;
                if (processed.retryAfterSeconds !== undefined) {
                    quotaRetryAfterSeconds = processed.retryAfterSeconds;
                }
            }
        }

        const finalQuestions = renumberExtractedQuestions(questions);

        if (finalQuestions.length === 0) {
            if (quotaHalted) {
                return NextResponse.json(
                    {
                        error:
                            "Gemini API quota/rate limit reached before extraction could finish. Retry later or upgrade billing.",
                        images: imageSummaries,
                        totalImages: imageSummaries.length,
                        warnings: dedupeWarnings(warnings),
                        processingSteps,
                        quotaExceeded: true,
                        retryAfterSeconds: quotaRetryAfterSeconds,
                        maxImagesPerBatch: MAX_IMAGES_PER_BATCH,
                    },
                    { status: 429 }
                );
            }

            return NextResponse.json(
                {
                    error: "No valid questions extracted from provided images.",
                    images: imageSummaries,
                    totalImages: imageSummaries.length,
                    warnings: dedupeWarnings(warnings),
                    processingSteps,
                },
                { status: 422 }
            );
        }

        return NextResponse.json({
            questions: finalQuestions,
            images: imageSummaries,
            totalImages: imageSummaries.length,
            totalQuestions: finalQuestions.length,
            totalDiagrams: finalQuestions.filter((question) => Boolean(question.diagramImagePath)).length,
            maxImagesPerBatch: MAX_IMAGES_PER_BATCH,
            warnings: dedupeWarnings(warnings),
            processingSteps,
            quotaExceeded: quotaHalted,
            retryAfterSeconds: quotaRetryAfterSeconds,
        });
    } catch (error: unknown) {
        console.error("Error extracting text from image:", error);
        return NextResponse.json(
            {
                error:
                    "Failed to extract content from image. " +
                    (error instanceof Error ? error.message : String(error)),
            },
            { status: 500 }
        );
    }
}
