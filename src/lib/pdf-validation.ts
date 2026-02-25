import {
    ImageBounds,
    MatchColumnEntry,
    MatchColumns,
    OptionDisplayOrder,
    PdfInput,
    QuestionType,
    Question,
    QuestionOption,
} from "@/types/pdf";
import { PDF_TEMPLATE_IDS, PdfTemplateId } from "@/lib/pdf-templates";

const DEFAULT_DATE_FORMATTER = new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
});

export interface NormalizedPdfInput extends PdfInput {
    subject: string;
    templateId: PdfTemplateId;
    optionDisplayOrder: OptionDisplayOrder;
}

type ValidationFailure = {
    ok: false;
    error: string;
    issues?: string[];
};

type ValidationSuccess = {
    ok: true;
    value: NormalizedPdfInput;
};

export type PdfValidationResult = ValidationFailure | ValidationSuccess;

function safeString(value: unknown): string {
    if (typeof value === "string") return value;
    if (typeof value === "number" || typeof value === "boolean") return String(value);
    return "";
}

function normalizeSingleLine(value: unknown): string {
    return safeString(value).replace(/\s+/g, " ").trim();
}

function normalizeMultiline(value: unknown): string {
    return safeString(value)
        .replace(/\r\n/g, "\n")
        .replace(/[ \t]+/g, " ")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
}

function normalizeInstituteName(value: unknown): string {
    const normalized = truncate(normalizeSingleLine(value), 120);
    if (!normalized) return "NACC AGRICULTURE INSTITUTE";

    const lowered = normalized.toLowerCase();
    const placeholderValues = new Set([
        "not specified",
        "n/a",
        "na",
        "none",
        "null",
        "undefined",
        "-",
        "--",
    ]);

    if (placeholderValues.has(lowered)) {
        return "NACC AGRICULTURE INSTITUTE";
    }

    return normalized;
}

function truncate(value: string, max: number): string {
    if (value.length <= max) return value;
    return value.slice(0, max).trim();
}

function normalizeOption(raw: unknown): QuestionOption {
    const option = (raw ?? {}) as Partial<QuestionOption>;
    return {
        hindi: truncate(normalizeMultiline(option.hindi), 500),
        english: truncate(normalizeMultiline(option.english), 500),
    };
}

function normalizePublicAssetPath(value: unknown): string | undefined {
    const raw = normalizeSingleLine(value);
    if (!raw) return undefined;
    if (raw.startsWith("data:image/")) return raw;
    if (!raw.startsWith("/uploads/")) return undefined;
    if (raw.includes("..")) return undefined;
    return raw;
}

function normalizeBounds(value: unknown): ImageBounds | undefined {
    if (!value || typeof value !== "object") return undefined;

    const raw = value as Record<string, unknown>;
    const x = Number(raw.x);
    const y = Number(raw.y);
    const width = Number(raw.width);
    const height = Number(raw.height);

    if (![x, y, width, height].every(Number.isFinite)) return undefined;

    const boundedWidth = Math.min(Math.max(width, 0), 1);
    const boundedHeight = Math.min(Math.max(height, 0), 1);
    if (boundedWidth < 0.03 || boundedHeight < 0.03) return undefined;

    return {
        x: Math.min(Math.max(x, 0), 1 - boundedWidth),
        y: Math.min(Math.max(y, 0), 1 - boundedHeight),
        width: boundedWidth,
        height: boundedHeight,
    };
}

function normalizeConfidence(value: unknown): number | undefined {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return undefined;
    if (numeric < 0 || numeric > 1) return undefined;
    return Number(numeric.toFixed(4));
}

function inferQuestionTypeFromContent(
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

function normalizeQuestionType(
    value: unknown,
    fallback: QuestionType
): QuestionType {
    const raw = normalizeSingleLine(value).toUpperCase();
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

function normalizeMatchColumnEntry(raw: unknown): MatchColumnEntry | null {
    if (typeof raw === "string") {
        const text = truncate(normalizeMultiline(raw), 320);
        if (!text) return null;
        return { english: text, hindi: text };
    }

    const entry = (raw ?? {}) as Partial<MatchColumnEntry>;
    let english = truncate(normalizeMultiline(entry.english), 320);
    let hindi = truncate(normalizeMultiline(entry.hindi), 320);
    if (!english && !hindi) return null;
    if (!english) english = hindi;
    if (!hindi) hindi = english;
    return { english, hindi };
}

function normalizeMatchColumnEntries(raw: unknown): MatchColumnEntry[] {
    if (!Array.isArray(raw)) return [];
    return raw
        .map(normalizeMatchColumnEntry)
        .filter((entry): entry is MatchColumnEntry => Boolean(entry))
        .slice(0, 12);
}

function normalizeMatchColumns(raw: unknown): MatchColumns | undefined {
    if (!raw || typeof raw !== "object") return undefined;
    const data = raw as Record<string, unknown>;
    const left = normalizeMatchColumnEntries(data.left);
    const right = normalizeMatchColumnEntries(data.right);
    if (left.length === 0 && right.length === 0) return undefined;
    return { left, right };
}

function inferBlankCount(questionHindi: string, questionEnglish: string): number {
    const combined = `${questionHindi}\n${questionEnglish}`;
    const underscoreHits = combined.match(/_{2,}/g)?.length || 0;
    const hindiBlankHits = combined.match(/रिक्त\s*स्थान/g)?.length || 0;
    const englishBlankHits = combined.match(/\bblank\b/gi)?.length || 0;
    const total = underscoreHits + hindiBlankHits + englishBlankHits;
    return Math.max(1, total || 1);
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
    if (questionType === "FIB") {
        return inferBlankCount(questionHindi, questionEnglish);
    }
    return undefined;
}

function normalizeQuestion(raw: unknown, index: number): Question {
    const question = (raw ?? {}) as Partial<Question>;
    const optionsRaw = Array.isArray(question.options) ? question.options : [];
    const normalizedOptions = optionsRaw.map(normalizeOption).slice(0, 10);
    const questionHindi = truncate(normalizeMultiline(question.questionHindi), 2000);
    const questionEnglish = truncate(normalizeMultiline(question.questionEnglish), 2000);
    const fallbackType = inferQuestionTypeFromContent(
        questionHindi,
        questionEnglish,
        normalizedOptions.length
    );
    const questionType = normalizeQuestionType(question.questionType, fallbackType);
    const matchColumns = normalizeMatchColumns(question.matchColumns);

    return {
        number: normalizeSingleLine(question.number) || String(index + 1),
        questionHindi,
        questionEnglish,
        options: normalizedOptions,
        sourceImagePath: normalizePublicAssetPath(question.sourceImagePath),
        sourceImageName: truncate(normalizeSingleLine(question.sourceImageName), 160) || undefined,
        diagramImagePath: normalizePublicAssetPath(question.diagramImagePath),
        autoDiagramImagePath: normalizePublicAssetPath(question.autoDiagramImagePath),
        diagramDetected: Boolean(question.diagramDetected),
        diagramBounds: normalizeBounds(question.diagramBounds),
        questionBounds: normalizeBounds(question.questionBounds),
        questionType,
        matchColumns,
        blankCount: normalizeBlankCount(
            question.blankCount,
            questionType,
            questionHindi,
            questionEnglish
        ),
        diagramCaptionHindi:
            truncate(normalizeMultiline(question.diagramCaptionHindi), 500) || undefined,
        diagramCaptionEnglish:
            truncate(normalizeMultiline(question.diagramCaptionEnglish), 500) || undefined,
        extractionConfidence: normalizeConfidence(question.extractionConfidence),
    };
}

function normalizeTemplateId(value: unknown): PdfTemplateId {
    const candidate = normalizeSingleLine(value).toLowerCase();
    if ((PDF_TEMPLATE_IDS as readonly string[]).includes(candidate)) {
        return candidate as PdfTemplateId;
    }
    return "professional";
}

function normalizeOptionDisplayOrder(value: unknown): OptionDisplayOrder {
    const candidate = normalizeSingleLine(value).toLowerCase();
    if (candidate === "english-first") return "english-first";
    return "hindi-first";
}

function normalizeSourceImages(value: unknown): NonNullable<PdfInput["sourceImages"]> {
    if (!Array.isArray(value)) return [];

    return value
        .map((item) => {
            const source = item as Record<string, unknown>;
            const imagePath = normalizePublicAssetPath(source.imagePath);
            if (!imagePath) return null;

            return {
                imagePath,
                imageName: truncate(normalizeSingleLine(source.imageName), 160) || "image",
                questionCount: Math.max(0, Number.parseInt(String(source.questionCount ?? 0), 10) || 0),
                diagramCount: Math.max(0, Number.parseInt(String(source.diagramCount ?? 0), 10) || 0),
                extractionMode:
                    normalizeSingleLine(source.extractionMode).toLowerCase() === "enhanced"
                        ? "enhanced"
                        : "original",
                averageConfidence: normalizeConfidence(source.averageConfidence),
                qualityIssues: Array.isArray(source.qualityIssues)
                    ? source.qualityIssues
                          .map((issue) => truncate(normalizeSingleLine(issue), 180))
                          .filter(Boolean)
                          .slice(0, 12)
                    : [],
            };
        })
        .filter(Boolean) as NonNullable<PdfInput["sourceImages"]>;
}

function normalizedDefaultDate(): string {
    return DEFAULT_DATE_FORMATTER.format(new Date());
}

export function validateAndNormalizePdfInput(payload: unknown): PdfValidationResult {
    const data = (payload ?? {}) as Record<string, unknown>;
    const issues: string[] = [];

    const title = truncate(normalizeSingleLine(data.title), 160);
    const subject = truncate(normalizeSingleLine(data.subject), 120) || title;
    const date = truncate(normalizeSingleLine(data.date), 60) || normalizedDefaultDate();
    const instituteName = normalizeInstituteName(data.instituteName);
    const templateId = normalizeTemplateId(data.templateId);
    const optionDisplayOrder = normalizeOptionDisplayOrder(data.optionDisplayOrder);
    const sourceImages = normalizeSourceImages(data.sourceImages);

    if (!title) issues.push("`title` is required");

    const questionsInput = Array.isArray(data.questions) ? data.questions : null;
    if (!questionsInput) {
        issues.push("`questions` must be an array");
    }

    const questions = (questionsInput || []).slice(0, 200).map(normalizeQuestion);

    if (questions.length === 0) {
        issues.push("At least one question is required");
    }

    questions.forEach((question, index) => {
        const label = `questions[${index}]`;
        const isOptionQuestion =
            question.questionType === "MCQ" ||
            question.questionType === "TRUE_FALSE" ||
            question.questionType === "ASSERTION_REASON";
        const isMatchColumn = question.questionType === "MATCH_COLUMN";
        const isFib = question.questionType === "FIB";

        if (!question.questionHindi && !question.questionEnglish) {
            issues.push(`${label} requires at least one question text (Hindi/English)`);
        }

        if (isOptionQuestion && question.options.length < 2) {
            issues.push(`${label} must include at least 2 options`);
        }

        if (question.options.length > 10) {
            issues.push(`${label} supports at most 10 options`);
        }

        if (
            isMatchColumn &&
            (!question.matchColumns ||
                question.matchColumns.left.length === 0 ||
                question.matchColumns.right.length === 0) &&
            question.options.length < 2
        ) {
            issues.push(
                `${label} requires either match columns on both sides or at least 2 options`
            );
        }

        if (isFib && (!question.blankCount || question.blankCount < 1)) {
            issues.push(`${label} requires blankCount >= 1 for fill-in-the-blank`);
        }

        question.options.forEach((option, optionIndex) => {
            if (!option.hindi && !option.english) {
                issues.push(
                    `${label}.options[${optionIndex}] requires at least one language text`
                );
            }
        });
    });

    if (issues.length > 0) {
        return {
            ok: false,
            error: "Invalid PDF payload",
            issues,
        };
    }

    return {
        ok: true,
        value: {
            title,
            subject,
            date,
            instituteName,
            questions,
            templateId,
            optionDisplayOrder,
            sourceImages,
        },
    };
}
