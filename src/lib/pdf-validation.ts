import {
    ImageBounds,
    MatchColumnEntry,
    MatchColumns,
    OptionDisplayOrder,
    PdfInput,
    PreviewResolution,
    QuestionType,
    Question,
    QuestionOption,
} from "@/types/pdf";
import {
    PDF_TEMPLATE_IDS,
    PdfTemplateId,
    type CustomPdfTemplateConfig,
    type PdfTemplatePalette,
    resolvePdfTemplate,
} from "@/lib/pdf-templates";
import { normalizeAnswerFromCandidates } from "@/lib/question-utils";

const DEFAULT_DATE_FORMATTER = new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
});

export interface NormalizedPdfInput extends PdfInput {
    subject: string;
    templateId: PdfTemplateId;
    optionDisplayOrder: OptionDisplayOrder;
    previewResolution: PreviewResolution;
    includeAnswers: boolean;
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
    return normalized || "";
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

function normalizeOptionalMultiline(value: unknown, maxLength: number): string | undefined {
    const normalized = truncate(normalizeMultiline(value), maxLength);
    return normalized || undefined;
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
    const rawQuestion = (raw ?? {}) as Record<string, unknown>;
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
    const answer = normalizeAnswerFromCandidates(
        [
            question.answer,
            question.correctAnswer,
            question.correctOption,
            question.answerKey,
            rawQuestion.key,
        ],
        normalizedOptions.length,
        true
    );

    return {
        clientId: normalizeSingleLine(question.clientId) || undefined,
        number: String(index + 1),
        questionHindi,
        questionEnglish,
        options: normalizedOptions,
        answer,
        solution: normalizeOptionalMultiline(question.solution, 2000),
        solutionHindi: normalizeOptionalMultiline(question.solutionHindi, 2000),
        solutionEnglish: normalizeOptionalMultiline(question.solutionEnglish, 2000),
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

function normalizePreviewResolution(value: unknown): PreviewResolution {
    const candidate = normalizeSingleLine(value).toLowerCase();
    if (candidate === "default") return "default";
    return "1920x1080";
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
                originalImagePath: normalizePublicAssetPath(source.originalImagePath),
                questionCount: Math.max(0, Number.parseInt(String(source.questionCount ?? 0), 10) || 0),
                processed:
                    typeof source.processed === "boolean" ? source.processed : undefined,
                failed:
                    typeof source.failed === "boolean" ? source.failed : undefined,
                extractionError:
                    truncate(normalizeMultiline(source.extractionError), 240) || undefined,
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

function normalizeIncludeAnswers(value: unknown): boolean {
    if (typeof value === "boolean") return value;
    if (typeof value === "string") {
        const normalized = value.trim().toLowerCase();
        if (normalized === "false" || normalized === "0" || normalized === "no") return false;
        if (normalized === "true" || normalized === "1" || normalized === "yes") return true;
    }
    return true;
}

function normalizeColorValue(value: unknown, fallback: string): string {
    const raw = normalizeSingleLine(value).slice(0, 48);
    if (!raw) return fallback;
    if (/^#([0-9a-f]{3,8})$/i.test(raw)) return raw;
    if (/^rgba?\([^)]+\)$/i.test(raw)) return raw;
    if (/^hsla?\([^)]+\)$/i.test(raw)) return raw;
    return fallback;
}

function normalizeWatermarkOpacity(value: unknown, fallback: number): number {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.min(Math.max(parsed, 0), 0.24);
}

function normalizePaletteValue(
    palette: Record<string, unknown>,
    key: keyof PdfTemplatePalette,
    fallback: string
): string {
    return normalizeColorValue(palette[key], fallback);
}

function normalizeCustomTemplate(
    value: unknown,
    fallbackTemplateId: PdfTemplateId
): CustomPdfTemplateConfig | undefined {
    if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;

    const raw = value as Record<string, unknown>;
    const baseTemplateId = normalizeTemplateId(raw.baseTemplateId || fallbackTemplateId);
    const baseTemplate = resolvePdfTemplate(baseTemplateId);
    const palette = raw.palette && typeof raw.palette === "object" && !Array.isArray(raw.palette)
        ? (raw.palette as Record<string, unknown>)
        : {};

    return {
        name: truncate(normalizeSingleLine(raw.name), 80) || `${baseTemplate.name} Custom`,
        baseTemplateId,
        watermarkOpacity: normalizeWatermarkOpacity(raw.watermarkOpacity, baseTemplate.watermarkOpacity),
        palette: {
            pageBg: normalizePaletteValue(palette, "pageBg", baseTemplate.palette.pageBg),
            pageBgAlt: normalizePaletteValue(palette, "pageBgAlt", baseTemplate.palette.pageBgAlt),
            panelBg: normalizePaletteValue(palette, "panelBg", baseTemplate.palette.panelBg),
            panelBorder: normalizePaletteValue(palette, "panelBorder", baseTemplate.palette.panelBorder),
            accent: normalizePaletteValue(palette, "accent", baseTemplate.palette.accent),
            accentSoft: normalizePaletteValue(palette, "accentSoft", baseTemplate.palette.accentSoft),
            title: normalizePaletteValue(palette, "title", baseTemplate.palette.title),
            hindi: normalizePaletteValue(palette, "hindi", baseTemplate.palette.hindi),
            english: normalizePaletteValue(palette, "english", baseTemplate.palette.english),
            optionBg: normalizePaletteValue(palette, "optionBg", baseTemplate.palette.optionBg),
            optionBorder: normalizePaletteValue(palette, "optionBorder", baseTemplate.palette.optionBorder),
            optionLabel: normalizePaletteValue(palette, "optionLabel", baseTemplate.palette.optionLabel),
            footer: normalizePaletteValue(palette, "footer", baseTemplate.palette.footer),
        },
    };
}

export function validateAndNormalizePdfInput(payload: unknown): PdfValidationResult {
    const data = (payload ?? {}) as Record<string, unknown>;
    const issues: string[] = [];

    const title = truncate(normalizeSingleLine(data.title), 160);
    const subject = truncate(normalizeSingleLine(data.subject), 120) || title;
    const date = truncate(normalizeSingleLine(data.date), 60) || normalizedDefaultDate();
    const instituteName = normalizeInstituteName(data.instituteName);
    const templateId = normalizeTemplateId(data.templateId);
    const customTemplate = normalizeCustomTemplate(data.customTemplate, templateId);
    const optionDisplayOrder = normalizeOptionDisplayOrder(data.optionDisplayOrder);
    const previewResolution = normalizePreviewResolution(data.previewResolution);
    const includeAnswers = normalizeIncludeAnswers(data.includeAnswers);
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

    questions.forEach((question, _index) => {
        // NOTE: Validation is intentionally relaxed so partial/draft question sets
        // can still generate PDFs. Option counts and empty text are allowed.

        if (question.options.length > 10) {
            issues.push(`questions[${_index}] supports at most 10 options`);
        }

        question.options.forEach((option, optionIndex) => {
            // Allow completely empty options — they render as blank placeholders
            void optionIndex;
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
            customTemplate,
            optionDisplayOrder,
            previewResolution,
            includeAnswers,
            sourceImages,
        },
    };
}
