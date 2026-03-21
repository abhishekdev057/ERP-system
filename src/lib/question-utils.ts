import { Question } from "@/types/pdf";

type AnswerLikeQuestion = Partial<Question> & {
    key?: unknown;
};

function collapseWhitespace(value: unknown): string {
    return String(value ?? "").replace(/\s+/g, " ").trim();
}

export function normalizeOptionAnswerValue(
    value: unknown,
    optionCount: number,
    preferNumeric = true
): string | undefined {
    const normalized = collapseWhitespace(value);
    if (!normalized) return undefined;

    const cleaned = normalized.replace(/[()]/g, "");

    if (optionCount > 0 && /^[A-Za-z]$/.test(cleaned)) {
        const letterIndex = cleaned.toUpperCase().charCodeAt(0) - 64;
        if (letterIndex >= 1 && letterIndex <= optionCount) {
            return preferNumeric ? String(letterIndex) : cleaned.toUpperCase();
        }
    }

    if (optionCount > 0 && /^\d+$/.test(cleaned)) {
        const numeric = Number.parseInt(cleaned, 10);
        if (Number.isFinite(numeric)) {
            if (numeric === 0) {
                return preferNumeric ? "1" : "A";
            }
            if (numeric >= 1 && numeric <= optionCount) {
                return preferNumeric
                    ? String(numeric)
                    : String.fromCharCode(64 + numeric);
            }
        }
    }

    if (/^[A-Za-z]$/.test(cleaned)) {
        return cleaned.toUpperCase();
    }

    return normalized;
}

export function normalizeAnswerFromCandidates(
    candidates: unknown[],
    optionCount: number,
    preferNumeric = true
): string | undefined {
    for (const candidate of candidates) {
        const normalized = normalizeOptionAnswerValue(candidate, optionCount, preferNumeric);
        if (normalized) return normalized;
    }
    return undefined;
}

export function getRawQuestionAnswerValue(question: AnswerLikeQuestion): string {
    const candidates = [
        question.answer,
        question.correctAnswer,
        question.correctOption,
        question.answerKey,
        question.key,
    ];

    for (const candidate of candidates) {
        const normalized = collapseWhitespace(candidate);
        if (normalized) return normalized;
    }

    return "";
}

export function getQuestionAnswerText(question: AnswerLikeQuestion, preferNumeric = true): string {
    const rawAnswer = getRawQuestionAnswerValue(question);
    if (!rawAnswer) return "";
    return (
        normalizeOptionAnswerValue(
            rawAnswer,
            Array.isArray(question.options) ? question.options.length : 0,
            preferNumeric
        ) || ""
    );
}

export function isPlaceholderQuestionText(value: string | undefined | null): boolean {
    const normalized = collapseWhitespace(value).toLowerCase();
    return normalized === "no text" || normalized === "(no text)" || normalized === "notext";
}

export function hasQuestionStem(question: Question): boolean {
    return [question.questionHindi, question.questionEnglish].some((value) => {
        const normalized = collapseWhitespace(value);
        return Boolean(normalized) && !isPlaceholderQuestionText(normalized);
    });
}

export function isQuestionMeaningful(question: Question): boolean {
    return Boolean(
        hasQuestionStem(question) ||
            question.diagramImagePath ||
            question.autoDiagramImagePath ||
            question.matchColumns?.left?.length ||
            question.matchColumns?.right?.length
    );
}
