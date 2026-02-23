import { GoogleGenerativeAI } from "@google/generative-ai";
import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

type VariantSuggestion = {
    word: string;
    note: string;
};

type TokenSuggestion = {
    input: string;
    hindi: string;
    alternatives: string[];
};

type TransliterationResponse = {
    hindi?: unknown;
    variants?: unknown;
    tokenSuggestions?: unknown;
    notes?: unknown;
};

function normalizeText(value: unknown): string {
    return String(value ?? "").replace(/\s+/g, " ").trim();
}

function normalizeVariantSuggestions(value: unknown): VariantSuggestion[] {
    if (!Array.isArray(value)) return [];
    return value
        .map((entry) => {
            if (!entry || typeof entry !== "object") return null;
            const item = entry as Record<string, unknown>;
            const word = normalizeText(item.word);
            const note = normalizeText(item.note);
            if (!word) return null;
            return { word, note: note || "Alternative spelling based on pronunciation." };
        })
        .filter((item): item is VariantSuggestion => Boolean(item))
        .slice(0, 10);
}

function normalizeTokenSuggestions(value: unknown): TokenSuggestion[] {
    if (!Array.isArray(value)) return [];
    return value
        .map((entry) => {
            if (!entry || typeof entry !== "object") return null;
            const item = entry as Record<string, unknown>;
            const input = normalizeText(item.input);
            const hindi = normalizeText(item.hindi);
            const alternatives = Array.isArray(item.alternatives)
                ? item.alternatives.map((alt) => normalizeText(alt)).filter(Boolean).slice(0, 5)
                : [];
            if (!input || !hindi) return null;
            return { input, hindi, alternatives };
        })
        .filter((item): item is TokenSuggestion => Boolean(item))
        .slice(0, 20);
}

function extractJsonObject(input: string): string {
    const start = input.indexOf("{");
    const end = input.lastIndexOf("}");
    if (start === -1 || end <= start) {
        throw new Error("Model output did not include valid JSON");
    }
    return input.slice(start, end + 1);
}

export async function POST(req: NextRequest) {
    try {
        const body = (await req.json()) as { text?: unknown };
        const text = normalizeText(body.text);

        if (!text) {
            return NextResponse.json({ error: "Text is required." }, { status: 400 });
        }

        const apiKey = process.env.GEMINI_API_KEY;
        if (!apiKey) {
            return NextResponse.json(
                {
                    hindi: text,
                    variants: [],
                    tokenSuggestions: [],
                    notes: "Gemini API key is missing; returning input text only.",
                },
                { status: 200 }
            );
        }

        const genAI = new GoogleGenerativeAI(apiKey);
        const model = genAI.getGenerativeModel({
            model: "gemini-2.5-flash",
            generationConfig: {
                temperature: 0.25,
                responseMimeType: "application/json",
            },
        });

        const prompt = `
Convert Hinglish text into natural Hindi (Devanagari) while preserving intent and tone.
Also provide useful variant suggestions for ambiguous sounds like स/श/ष where applicable.

Input text:
${text}

Return strict JSON only:
{
  "hindi": "converted Hindi sentence",
  "variants": [
    { "word": "सड़क", "note": "Common usage" },
    { "word": "शड़क", "note": "Phonetic variant for श sound" }
  ],
  "tokenSuggestions": [
    {
      "input": "sadak",
      "hindi": "सड़क",
      "alternatives": ["शड़क", "षड़क"]
    }
  ],
  "notes": "optional short note"
}

Rules:
1. Hindi should be fluent and grammatically natural.
2. Keep names/numbers intact when needed.
3. Variants must be relevant and unique.
4. tokenSuggestions should map each Hinglish token to Hindi with alternatives.
5. Return JSON only, no markdown or commentary.
`;

        const result = await model.generateContent(prompt);
        const response = await result.response;
        const parsed = JSON.parse(extractJsonObject(response.text().trim())) as TransliterationResponse;

        const hindi = normalizeText(parsed.hindi) || text;
        const variants = normalizeVariantSuggestions(parsed.variants);
        const tokenSuggestions = normalizeTokenSuggestions(parsed.tokenSuggestions);
        const notes = normalizeText(parsed.notes);

        return NextResponse.json({
            hindi,
            variants,
            tokenSuggestions,
            notes,
        });
    } catch (error: unknown) {
        console.error("Hinglish conversion error:", error);
        return NextResponse.json(
            {
                error:
                    "Failed to convert Hinglish text. " +
                    (error instanceof Error ? error.message : String(error)),
            },
            { status: 500 }
        );
    }
}
