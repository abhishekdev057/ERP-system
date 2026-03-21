import { GoogleGenerativeAI } from "@google/generative-ai";
import { NextRequest, NextResponse } from "next/server";
import { MatchColumnEntry, MatchColumns, Question, QuestionType } from "@/types/pdf";
import { normalizeAnswerFromCandidates } from "@/lib/question-utils";

export const dynamic = "force-dynamic";

type AssistantResponse = {
    reply?: unknown;
    question?: unknown;
};

type ModelOption = {
    english?: unknown;
    hindi?: unknown;
};

function normalizeText(value: unknown): string {
    return String(value ?? "").replace(/\s+/g, " ").trim();
}

function normalizeQuestionType(value: unknown, fallback: QuestionType): QuestionType {
    const raw = normalizeText(value).toUpperCase();
    if (!raw) return fallback;

    const mapped = raw.replace(/\s+/g, "_").replace(/-/g, "_");
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
    if (valid.includes(mapped as QuestionType)) return mapped as QuestionType;
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

function normalizeOption(raw: unknown): { english: string; hindi: string } | null {
    if (!raw || typeof raw !== "object") return null;
    const option = raw as ModelOption;
    let english = normalizeText(option.english);
    let hindi = normalizeText(option.hindi);

    if (!english && !hindi) return null;
    if (!english) english = hindi;
    if (!hindi) hindi = english;

    return { english, hindi };
}

function normalizeOptions(
    raw: unknown,
    requireAtLeastTwo: boolean,
    fallback: Question["options"]
): Question["options"] {
    const parsed = Array.isArray(raw)
        ? raw.map(normalizeOption).filter((item): item is { english: string; hindi: string } => Boolean(item))
        : [];
    const next = parsed.slice(0, 10);

    if (next.length === 0 && fallback.length > 0) {
        return fallback;
    }

    while (requireAtLeastTwo && next.length < 2) {
        next.push({ english: "", hindi: "" });
    }
    return next;
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

function normalizeMatchColumns(raw: unknown, fallback?: MatchColumns): MatchColumns | undefined {
    if (!raw || typeof raw !== "object") return fallback;
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

    if (left.length === 0 && right.length === 0) return fallback;
    return { left, right };
}

function normalizeBlankCount(value: unknown, fallback?: number): number | undefined {
    const parsed = Number.parseInt(String(value ?? ""), 10);
    if (!Number.isFinite(parsed) || parsed < 1) return fallback;
    return Math.min(parsed, 20);
}

function extractJsonObject(input: string): string {
    const start = input.indexOf("{");
    const end = input.lastIndexOf("}");
    if (start === -1 || end <= start) {
        throw new Error("Assistant output did not include valid JSON");
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

function normalizeQuestion(payload: unknown, baseQuestion: Question): Question {
    const candidate = payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {};

    const questionType = normalizeQuestionType(candidate.questionType, baseQuestion.questionType || "MCQ");
    const requireAtLeastTwoOptions = isOptionType(questionType);

    const questionHindi = normalizeText(candidate.questionHindi) || baseQuestion.questionHindi;
    const questionEnglish = normalizeText(candidate.questionEnglish) || baseQuestion.questionEnglish;

    const options = normalizeOptions(candidate.options, requireAtLeastTwoOptions, baseQuestion.options);
    const matchColumns =
        questionType === "MATCH_COLUMN"
            ? normalizeMatchColumns(candidate.matchColumns, baseQuestion.matchColumns) || {
                  left: [],
                  right: [],
              }
            : undefined;

    const blankCount =
        questionType === "FIB"
            ? normalizeBlankCount(candidate.blankCount, baseQuestion.blankCount || 1) || 1
            : undefined;

    const answer = normalizeAnswerFromCandidates(
        [
            candidate.answer,
            candidate.correctAnswer,
            candidate.correctOption,
            candidate.answerKey,
            candidate.key,
        ],
        options.length,
        true
    ) || baseQuestion.answer;

    const solution = normalizeText(candidate.solution) || baseQuestion.solution;
    const solutionHindi =
        normalizeText(candidate.solutionHindi) || baseQuestion.solutionHindi;
    const solutionEnglish =
        normalizeText(candidate.solutionEnglish) || baseQuestion.solutionEnglish;

    return {
        ...baseQuestion,
        number: normalizeText(candidate.number) || baseQuestion.number,
        questionType,
        questionHindi,
        questionEnglish,
        options: isOptionType(questionType) ? options : [],
        answer,
        solution,
        solutionHindi,
        solutionEnglish,
        matchColumns,
        blankCount,
        diagramCaptionEnglish:
            normalizeText(candidate.diagramCaptionEnglish) || baseQuestion.diagramCaptionEnglish,
        diagramCaptionHindi:
            normalizeText(candidate.diagramCaptionHindi) || baseQuestion.diagramCaptionHindi,
        diagramImagePath: normalizeText(candidate.diagramImagePath) || baseQuestion.diagramImagePath,
        autoDiagramImagePath:
            normalizeText(candidate.autoDiagramImagePath) || baseQuestion.autoDiagramImagePath,
    };
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

        const body = (await req.json()) as {
            message?: unknown;
            question?: unknown;
        };

        const message = normalizeText(body.message);
        const incomingQuestion = body.question as Question | undefined;

        if (!message) {
            return NextResponse.json({ error: "Message is required." }, { status: 400 });
        }

        if (!incomingQuestion || typeof incomingQuestion !== "object") {
            return NextResponse.json({ error: "Question context is required." }, { status: 400 });
        }

        const baseQuestion: Question = {
            number: normalizeText(incomingQuestion.number) || "1",
            questionType: incomingQuestion.questionType || "MCQ",
            questionHindi: normalizeText(incomingQuestion.questionHindi),
            questionEnglish: normalizeText(incomingQuestion.questionEnglish),
            answer:
                normalizeAnswerFromCandidates(
                    [
                        (incomingQuestion as any).answer,
                        (incomingQuestion as any).correctAnswer,
                        (incomingQuestion as any).correctOption,
                        (incomingQuestion as any).answerKey,
                        (incomingQuestion as any).key,
                    ],
                    Array.isArray(incomingQuestion.options) ? incomingQuestion.options.length : 0,
                    true
                ) || undefined,
            solution: normalizeText((incomingQuestion as any).solution) || undefined,
            solutionHindi: normalizeText((incomingQuestion as any).solutionHindi) || undefined,
            solutionEnglish: normalizeText((incomingQuestion as any).solutionEnglish) || undefined,
            options: Array.isArray(incomingQuestion.options)
                ? incomingQuestion.options.slice(0, 10).map((option) => ({
                      english: normalizeText(option?.english),
                      hindi: normalizeText(option?.hindi),
                  }))
                : [],
            sourceImagePath: incomingQuestion.sourceImagePath,
            sourceImageName: incomingQuestion.sourceImageName,
            diagramImagePath: incomingQuestion.diagramImagePath,
            autoDiagramImagePath: incomingQuestion.autoDiagramImagePath,
            diagramDetected: Boolean(incomingQuestion.diagramDetected),
            diagramBounds: incomingQuestion.diagramBounds,
            questionBounds: incomingQuestion.questionBounds,
            matchColumns: incomingQuestion.matchColumns,
            blankCount: incomingQuestion.blankCount,
            diagramCaptionHindi: incomingQuestion.diagramCaptionHindi,
            diagramCaptionEnglish: incomingQuestion.diagramCaptionEnglish,
            extractionConfidence: incomingQuestion.extractionConfidence,
        };

        const genAI = new GoogleGenerativeAI(apiKey);
        const model = genAI.getGenerativeModel({
            model: "gemini-2.5-flash",
            generationConfig: {
                temperature: 0.2,
                responseMimeType: "application/json",
            },
        });

        const prompt = `
You are an expert bilingual exam editor for Hindi + English question slides.
Use the user's correction request and return corrected structured JSON only.

Current question JSON:
${JSON.stringify(baseQuestion, null, 2)}

User request:
${message}

Return strict JSON in this shape:
{
  "reply": "short explanation of what changed",
  "question": {
    "number": "42",
    "questionType": "MCQ",
    "questionHindi": "...",
    "questionEnglish": "...",
    "answer": "1",
    "solution": "...",
    "solutionHindi": "...",
    "solutionEnglish": "...",
    "options": [{ "english": "...", "hindi": "..." }],
    "matchColumns": {
      "left": [{ "english": "...", "hindi": "..." }],
      "right": [{ "english": "...", "hindi": "..." }]
    },
    "blankCount": 1,
    "diagramCaptionHindi": "...",
    "diagramCaptionEnglish": "...",
    "diagramImagePath": "/uploads/...png"
  }
}

Rules:
1. Keep structure accurate for questionType.
2. For MCQ/TRUE_FALSE/ASSERTION_REASON, maintain at least 2 options.
3. For FIB, keep blankCount >= 1 and do not output options.
4. For MATCH_COLUMN, fill matchColumns.left and matchColumns.right.
5. Keep bilingual structure: Hindi question first, English question second, options English then Hindi.
6. Preserve existing diagram path unless user explicitly asks to remove/replace it.
7. If answer exists or user asks to include answer, populate "answer". For option-based questions, prefer numeric option positions like 1/2/3/4. Keep existing answer if not asked to change.
8. Return valid JSON object only. No extra text.
`;

        const result = await model.generateContent(prompt);
        const response = await result.response;
        const text = response.text().trim();
        const parsed = JSON.parse(extractJsonObject(text)) as AssistantResponse;

        const normalizedQuestion = normalizeQuestion(parsed.question, baseQuestion);
        const reply =
            normalizeText(parsed.reply) ||
            "Applied structure-aware corrections for bilingual question formatting.";

        return NextResponse.json({
            reply,
            question: normalizedQuestion,
        });
    } catch (error: unknown) {
        console.error("Workspace assistant error:", error);
        return NextResponse.json(
            {
                error:
                    "Failed to process correction request. " +
                    (error instanceof Error ? error.message : String(error)),
            },
            { status: 500 }
        );
    }
}
