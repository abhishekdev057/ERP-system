import { NextRequest, NextResponse } from "next/server";
import { GoogleGenerativeAI } from "@google/generative-ai";

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || "");

export async function POST(req: NextRequest) {
    try {
        if (!process.env.GEMINI_API_KEY) {
            return NextResponse.json(
                { error: "Gemini API key is not configured in environment variables." },
                { status: 500 }
            );
        }

        const formData = await req.formData();
        const file = formData.get("image") as File;

        if (!file) {
            return NextResponse.json(
                { error: "No image provided" },
                { status: 400 }
            );
        }

        // Convert the file to generative part
        const buffer = await file.arrayBuffer();
        const base64Data = Buffer.from(buffer).toString("base64");
        const mimeType = file.type;

        const imagePart = {
            inlineData: {
                data: base64Data,
                mimeType
            },
        };

        const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

        const prompt = `
You are an expert OCR and data extraction assistant for bilingual exam questions.
Extract the question and options from this image and format it STRICTLY as JSON.
The JSON must have the following structure:
{
  "questionHindi": "The question text in Hindi",
  "questionEnglish": "The question text in English",
  "options": [
    { "hindi": "Option 1 in Hindi", "english": "Option 1 in English" },
    { "hindi": "Option 2 in Hindi", "english": "Option 2 in English" },
    { "hindi": "Option 3 in Hindi", "english": "Option 3 in English" },
    { "hindi": "Option 4 in Hindi", "english": "Option 4 in English" }
  ]
}

- Ensure accurate spelling and grammar.
- Ensure Hindi text goes to the hindi fields and English text goes to the english fields.
- Do not include markdown formatting like \`\`\`json in the response. Return ONLY the JSON object.
`;

        const result = await model.generateContent([prompt, imagePart]);
        const response = await result.response;
        let text = response.text();

        // Clean up markdown block if present despite prompt instructing not to
        text = text.trim();
        if (text.startsWith("\`\`\`json")) {
            text = text.substring(7);
        }
        if (text.startsWith("\`\`\`")) {
            text = text.substring(3);
        }
        if (text.endsWith("\`\`\`")) {
            text = text.substring(0, text.length - 3);
        }

        text = text.trim();

        const data = JSON.parse(text);

        return NextResponse.json(data);
    } catch (error: any) {
        console.error("Error extracting text from image:", error);
        return NextResponse.json(
            { error: "Failed to extract content from image. " + (error.message || "") },
            { status: 500 }
        );
    }
}
