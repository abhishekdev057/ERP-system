import { GoogleGenerativeAI } from "@google/generative-ai";
import { NextRequest, NextResponse } from "next/server";
import { Question, QuestionType } from "@/types/pdf";
import { normalizeOptionAnswerValue } from "@/lib/question-utils";

export const dynamic = "force-dynamic";

type BatchInputQuestion = {
    index: number;
    question: Question;
};

type BatchRequestBody = {
    questions?: unknown;
};

type ModelResponse = {
    updates?: unknown;
};

type AnswerUpdate = {
    index: number;
    answer: string;
};

function normalizeText(value: unknown): string {
    return String(value ?? "").replace(/\s+/g, " ").trim();
}

function extractJsonObject(input: string): string {
    const start = input.indexOf("{");
    const end = input.lastIndexOf("}");
    if (start === -1 || end <= start) {
        throw new Error("Assistant output did not include valid JSON.");
    }
    return input.slice(start, end + 1);
}

function isOptionType(questionType: QuestionType | undefined): boolean {
    return (
        questionType === "MCQ" ||
        questionType === "TRUE_FALSE" ||
        questionType === "ASSERTION_REASON" ||
        questionType === "MATCH_COLUMN"
    );
}

function normalizeBatchQuestions(raw: unknown): BatchInputQuestion[] {
    if (!Array.isArray(raw)) return [];

    const normalized: BatchInputQuestion[] = [];
    for (const item of raw) {
        if (!item || typeof item !== "object") continue;
        const payload = item as Record<string, unknown>;
        const index = Number.parseInt(String(payload.index ?? ""), 10);
        const question = payload.question as Question | undefined;
        if (!Number.isFinite(index) || !question || typeof question !== "object") continue;

        normalized.push({
            index,
            question: {
                ...question,
                questionHindi: normalizeText(question.questionHindi),
                questionEnglish: normalizeText(question.questionEnglish),
                options: Array.isArray(question.options)
                    ? question.options.slice(0, 10).map((option) => ({
                        english: normalizeText(option?.english),
                        hindi: normalizeText(option?.hindi),
                    }))
                    : [],
            },
        });
    }

    return normalized;
}

function buildModelQuestionPayload(items: BatchInputQuestion[]) {
    return items.map(({ index, question }) => ({
        index,
        questionType: question.questionType || "MCQ",
        questionHindi: question.questionHindi || "",
        questionEnglish: question.questionEnglish || "",
        options: (question.options || []).map((option, optionIndex) => ({
            label: String(optionIndex + 1),
            english: option.english || "",
            hindi: option.hindi || "",
        })),
        matchColumns: question.matchColumns || undefined,
        blankCount: question.blankCount || undefined,
        existingAnswer: normalizeText(
            (question as any).answer ||
            (question as any).correctAnswer ||
            (question as any).correctOption ||
            (question as any).answerKey ||
            (question as any).key
        ) || "",
    }));
}

function normalizeModelUpdates(
    rawUpdates: unknown,
    optionsCountByIndex: Map<number, number>
): AnswerUpdate[] {
    if (!Array.isArray(rawUpdates)) return [];

    const updates: AnswerUpdate[] = [];
    for (const item of rawUpdates) {
        if (!item || typeof item !== "object") continue;
        const payload = item as Record<string, unknown>;
        const index = Number.parseInt(String(payload.index ?? ""), 10);
        if (!Number.isFinite(index)) continue;

        const answer = normalizeOptionAnswerValue(
            payload.answer ?? payload.correctAnswer ?? payload.correctOption ?? payload.answerKey,
            optionsCountByIndex.get(index) || 0,
            true
        );
        if (!answer) continue;

        updates.push({ index, answer });
    }

    return updates;
}

export async function POST(req: NextRequest) {
    try {
        const apiKey = process.env.GEMINI_API_KEY;
        if (!apiKey) {
            return NextResponse.json(
                { error: "Gemini API key is not configured in environment variables." },
                { status: 500 }
            );
        }

        const body = (await req.json()) as BatchRequestBody;
        const normalizedQuestions = normalizeBatchQuestions(body.questions);

        if (normalizedQuestions.length === 0) {
            return NextResponse.json({ error: "At least one question is required." }, { status: 400 });
        }

        if (normalizedQuestions.length > 120) {
            return NextResponse.json(
                { error: "Batch too large. Please send up to 120 questions per request." },
                { status: 400 }
            );
        }

        const promptPayload = buildModelQuestionPayload(normalizedQuestions);
        const optionsCountByIndex = new Map<number, number>(
            normalizedQuestions.map((item) => [item.index, item.question.options?.length || 0])
        );
        const typeByIndex = new Map<number, QuestionType | undefined>(
            normalizedQuestions.map((item) => [item.index, item.question.questionType])
        );

        const genAI = new GoogleGenerativeAI(apiKey);
        const model = genAI.getGenerativeModel({
            model: "gemini-2.5-flash",
            generationConfig: {
                temperature: 0.1,
                responseMimeType: "application/json",
            },
        });

        const prompt = `
You are an exam answer-key assistant.
Given an array of extracted questions, return ONLY answer updates.

Questions:
${JSON.stringify(promptPayload, null, 2)}

Return strict JSON in this exact shape:
{
  "updates": [
    { "index": 0, "answer": "1" }
  ]
}

Rules:
1. Return an "updates" item only when you can infer an answer.
2. For MCQ/TRUE_FALSE/ASSERTION_REASON/MATCH_COLUMN with options, prefer numeric option positions like 1/2/3/4.
3. If answer is already correct in "existingAnswer", you may return that same answer.
4. Do not rewrite question text. Do not add extra keys.
5. Return valid JSON object only.
`;

        const result = await model.generateContent(prompt);
        const response = await result.response;
        const text = response.text().trim();
        const parsed = JSON.parse(extractJsonObject(text)) as ModelResponse;
        const updates = normalizeModelUpdates(parsed.updates, optionsCountByIndex)
            .filter((update) => {
                const questionType = typeByIndex.get(update.index);
                if (isOptionType(questionType)) {
                    const optionCount = optionsCountByIndex.get(update.index) || 0;
                    const numeric = Number.parseInt(update.answer, 10);
                    return Number.isFinite(numeric) && numeric >= 1 && numeric <= optionCount;
                }
                return update.answer.length > 0;
            });

        return NextResponse.json({
            updates,
            processed: normalizedQuestions.length,
            updated: updates.length,
            skipped: Math.max(0, normalizedQuestions.length - updates.length),
        });
    } catch (error: unknown) {
        console.error("Batch answer fill error:", error);
        return NextResponse.json(
            {
                error:
                    "Failed to auto-fill answers. " +
                    (error instanceof Error ? error.message : String(error)),
            },
            { status: 500 }
        );
    }
}
