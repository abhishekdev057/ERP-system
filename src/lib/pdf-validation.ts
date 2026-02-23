import { OptionDisplayOrder, PdfInput, Question, QuestionOption } from "@/types/pdf";
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

function normalizeQuestion(raw: unknown, index: number): Question {
    const question = (raw ?? {}) as Partial<Question>;
    const optionsRaw = Array.isArray(question.options) ? question.options : [];
    const normalizedOptions = optionsRaw.map(normalizeOption).slice(0, 10);

    return {
        number: normalizeSingleLine(question.number) || String(index + 1),
        questionHindi: truncate(normalizeMultiline(question.questionHindi), 2000),
        questionEnglish: truncate(normalizeMultiline(question.questionEnglish), 2000),
        options: normalizedOptions,
        sourceImagePath: normalizePublicAssetPath(question.sourceImagePath),
        sourceImageName: truncate(normalizeSingleLine(question.sourceImageName), 160) || undefined,
        diagramImagePath: normalizePublicAssetPath(question.diagramImagePath),
        diagramCaptionHindi:
            truncate(normalizeMultiline(question.diagramCaptionHindi), 500) || undefined,
        diagramCaptionEnglish:
            truncate(normalizeMultiline(question.diagramCaptionEnglish), 500) || undefined,
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
    const instituteName =
        truncate(normalizeSingleLine(data.instituteName), 120) || "NACC AGRICULTURE INSTITUTE";
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

        if (!question.questionHindi && !question.questionEnglish) {
            issues.push(`${label} requires at least one question text (Hindi/English)`);
        }

        if (question.options.length < 2) {
            issues.push(`${label} must include at least 2 options`);
        }

        if (question.options.length > 10) {
            issues.push(`${label} supports at most 10 options`);
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
