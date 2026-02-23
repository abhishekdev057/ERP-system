import { GoogleGenerativeAI } from "@google/generative-ai";
import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const MAX_IMAGE_SIZE_BYTES = 8 * 1024 * 1024;

function extractJsonObject(input: string): string {
    const start = input.indexOf("{");
    const end = input.lastIndexOf("}");
    if (start === -1 || end === -1 || end <= start) {
        throw new Error("Model output did not include valid JSON object");
    }
    return input.slice(start, end + 1);
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

        const formData = await req.formData();
        const file = formData.get("image") as File | null;

        if (!file) {
            return NextResponse.json({ error: "No image provided" }, { status: 400 });
        }

        if (!file.type.startsWith("image/")) {
            return NextResponse.json({ error: "Only image uploads are supported" }, { status: 400 });
        }

        if (file.size > MAX_IMAGE_SIZE_BYTES) {
            return NextResponse.json(
                { error: "Image is too large. Maximum allowed size is 8MB" },
                { status: 413 }
            );
        }

        const genAI = new GoogleGenerativeAI(apiKey);

        const buffer = await file.arrayBuffer();
        const base64Data = Buffer.from(buffer).toString("base64");

        const imagePart = {
            inlineData: {
                data: base64Data,
                mimeType: file.type,
            },
        };

        const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

        const prompt = `
You are an expert OCR and data extraction assistant for bilingual exam questions.
Extract the question and options from this image and format it strictly as JSON.
Return a single object:
{
  "questionHindi": "Hindi question text",
  "questionEnglish": "English question text",
  "options": [
    { "hindi": "Hindi option 1", "english": "English option 1" },
    { "hindi": "Hindi option 2", "english": "English option 2" },
    { "hindi": "Hindi option 3", "english": "English option 3" },
    { "hindi": "Hindi option 4", "english": "English option 4" }
  ]
}
Rules:
- Do not return markdown.
- Keep language in correct field.
- If any option is missing in a language, return empty string for that field.
`;

        const result = await model.generateContent([prompt, imagePart]);
        const response = await result.response;
        const text = response.text().trim();

        const jsonText = extractJsonObject(text);
        const data = JSON.parse(jsonText) as {
            questionHindi?: unknown;
            questionEnglish?: unknown;
            options?: Array<{ hindi?: unknown; english?: unknown }>;
        };

        const options = Array.isArray(data.options) ? data.options : [];

        return NextResponse.json({
            questionHindi: String(data.questionHindi || "").trim(),
            questionEnglish: String(data.questionEnglish || "").trim(),
            options: options.slice(0, 8).map((opt) => ({
                hindi: String(opt?.hindi || "").trim(),
                english: String(opt?.english || "").trim(),
            })),
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
