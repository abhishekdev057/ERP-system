import { GoogleGenerativeAI } from "@google/generative-ai";
import { NextRequest, NextResponse } from "next/server";
import { enforceToolAccess } from "@/lib/api-auth";
import { normalizeAnswerFromCandidates } from "@/lib/question-utils";
import { Question, QuestionOption, QuestionType } from "@/types/pdf";

export const dynamic = "force-dynamic";

const MAX_IMAGE_SIZE_BYTES = 12 * 1024 * 1024;

type RawQuestion = {
    number?: unknown;
    questionHindi?: unknown;
    questionEnglish?: unknown;
    options?: unknown;
    questionType?: unknown;
    answer?: unknown;
    correctAnswer?: unknown;
    correctOption?: unknown;
    answerKey?: unknown;
};

function normalizeText(value: unknown, max = 4000): string {
    const normalized = String(value ?? "")
        .replace(/\r\n/g, "\n")
        .replace(/[ \t]+/g, " ")
        .replace(/\n{3,}/g, "\n\n")
        .trim();

    if (normalized.length <= max) return normalized;
    return normalized.slice(0, max).trim();
}

function normalizeQuestionType(value: unknown, optionCount: number): QuestionType {
    const raw = normalizeText(value, 80).toUpperCase().replace(/[\s-]+/g, "_");

    if (raw === "MCQ") return "MCQ";
    if (raw === "FIB") return "FIB";
    if (raw === "MATCH_COLUMN") return "MATCH_COLUMN";
    if (raw === "TRUE_FALSE") return "TRUE_FALSE";
    if (raw === "ASSERTION_REASON") return "ASSERTION_REASON";
    if (raw === "NUMERICAL") return "NUMERICAL";
    if (raw === "SHORT_ANSWER") return "SHORT_ANSWER";
    if (raw === "LONG_ANSWER") return "LONG_ANSWER";

    return optionCount >= 2 ? "MCQ" : "SHORT_ANSWER";
}

function normalizeOption(raw: unknown): QuestionOption | null {
    if (typeof raw === "string") {
        const text = normalizeText(raw, 500);
        if (!text) return null;
        return { hindi: text, english: text };
    }

    if (!raw || typeof raw !== "object") return null;

    const data = raw as Record<string, unknown>;
    let hindi = normalizeText(data.hindi, 500);
    let english = normalizeText(data.english, 500);

    if (!hindi && !english) {
        const fallback = normalizeText(data.text, 500);
        hindi = fallback;
        english = fallback;
    }

    if (!hindi && !english) return null;
    if (!hindi) hindi = english;
    if (!english) english = hindi;

    return { hindi, english };
}

function normalizeQuestion(raw: unknown, index: number): Question | null {
    const data = (raw ?? {}) as RawQuestion;
    const options = Array.isArray(data.options)
        ? data.options
              .map(normalizeOption)
              .filter((option): option is QuestionOption => Boolean(option))
              .slice(0, 10)
        : [];

    let questionHindi = normalizeText(data.questionHindi, 2000);
    let questionEnglish = normalizeText(data.questionEnglish, 2000);

    if (!questionHindi && !questionEnglish) return null;
    if (!questionHindi) questionHindi = questionEnglish;
    if (!questionEnglish) questionEnglish = questionHindi;

    const answer = normalizeAnswerFromCandidates(
        [data.answer, data.correctAnswer, data.correctOption, data.answerKey],
        options.length
    );

    return {
        number: normalizeText(data.number, 24) || String(index + 1),
        questionHindi,
        questionEnglish,
        options,
        answer,
        questionType: normalizeQuestionType(data.questionType, options.length),
    };
}

function extractJsonPayload(raw: string): Record<string, unknown> {
    const trimmed = raw.trim();
    if (!trimmed) return {};

    try {
        return JSON.parse(trimmed) as Record<string, unknown>;
    } catch {
        const firstBrace = trimmed.indexOf("{");
        const lastBrace = trimmed.lastIndexOf("}");
        if (firstBrace >= 0 && lastBrace > firstBrace) {
            return JSON.parse(trimmed.slice(firstBrace, lastBrace + 1)) as Record<string, unknown>;
        }
        throw new Error("The OCR model returned invalid JSON.");
    }
}

function buildExtractionPrompt(mode: string) {
    const scopeInstruction =
        mode === "selection"
            ? "The image is a user-selected rectangle from a PDF page. Read only what is visible in that selected region."
            : "The image is a full PDF page. Read the whole visible page faithfully.";

    return `
You are an OCR + question-structuring engine for study material.
${scopeInstruction}

Return strict JSON only in this shape:
{
  "text": "formatted extracted text with meaningful line breaks",
  "questions": [
    {
      "number": "1",
      "questionHindi": "...",
      "questionEnglish": "...",
      "questionType": "MCQ",
      "answer": "1",
      "options": [
        { "hindi": "...", "english": "..." }
      ]
    }
  ]
}

Rules:
1. OCR the visible text faithfully. Do not add slogans, branding, CTAs, or missing words that are not present in the image.
2. Preserve useful line breaks in "text" so the output feels formatted and readable.
3. If the image does not contain a full question block, return an empty questions array.
4. If a question is visible, keep its meaning exact. Do not paraphrase or simplify.
5. Keep option order exactly as printed.
6. If only one language is visible, copy it into both Hindi and English fields instead of inventing a translation.
7. If an answer is not visible, leave answer empty.
8. Do not guess extra options or extra headings.
9. JSON only. No markdown, no explanation.
`;
}

export async function POST(request: NextRequest) {
    try {
        await enforceToolAccess(["library", "pdf-to-pdf"]);

        const apiKey = process.env.GEMINI_API_KEY;
        if (!apiKey) {
            return NextResponse.json(
                { error: "Gemini API key is not configured." },
                { status: 500 }
            );
        }

        const formData = await request.formData();
        const image = formData.get("image");
        const mode = normalizeText(formData.get("mode"), 40) || "selection";

        if (!(image instanceof File) || image.size === 0) {
            return NextResponse.json({ error: "No image provided." }, { status: 400 });
        }

        if (!image.type.startsWith("image/")) {
            return NextResponse.json({ error: "Only image files are supported." }, { status: 400 });
        }

        if (image.size > MAX_IMAGE_SIZE_BYTES) {
            return NextResponse.json(
                { error: "Selected image is too large for OCR." },
                { status: 413 }
            );
        }

        const genAI = new GoogleGenerativeAI(apiKey);
        const model = genAI.getGenerativeModel({
            model: "gemini-2.5-flash",
            generationConfig: {
                temperature: 0.1,
                responseMimeType: "application/json",
            },
        });

        const prompt = buildExtractionPrompt(mode);
        const buffer = Buffer.from(await image.arrayBuffer());
        const result = await model.generateContent([
            prompt,
            {
                inlineData: {
                    data: buffer.toString("base64"),
                    mimeType: image.type || "image/png",
                },
            },
        ]);

        const response = await result.response;
        const payload = extractJsonPayload(response.text());
        const text = normalizeText(payload.text, 20000);
        const questions = Array.isArray(payload.questions)
            ? payload.questions
                  .map((question, index) => normalizeQuestion(question, index))
                  .filter((question): question is Question => Boolean(question))
            : [];

        return NextResponse.json({
            text,
            questions,
            questionCount: questions.length,
            mode,
        });
    } catch (error) {
        console.error("Book content extraction error:", error);
        return NextResponse.json(
            {
                error:
                    error instanceof Error
                        ? error.message
                        : "Failed to extract content from the selected area.",
            },
            { status: 500 }
        );
    }
}
