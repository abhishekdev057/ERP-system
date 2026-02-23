import { GoogleGenerativeAI } from "@google/generative-ai";
import { NextRequest, NextResponse } from "next/server";
import {
    MAX_IMAGE_SIZE_BYTES,
    MAX_IMAGES_PER_BATCH,
    saveExtractionImage,
} from "@/lib/services/image-extraction-service";

export const dynamic = "force-dynamic";

type ModelOption = {
    english?: unknown;
    hindi?: unknown;
};

type ModelQuestion = {
    number?: unknown;
    questionHindi?: unknown;
    questionEnglish?: unknown;
    options?: ModelOption[];
    hasDiagram?: unknown;
    diagramCaptionHindi?: unknown;
    diagramCaptionEnglish?: unknown;
};

function normalizeText(value: unknown): string {
    return String(value ?? "").replace(/\s+/g, " ").trim();
}

function extractJsonObject(input: string): string {
    const startObject = input.indexOf("{");
    const startArray = input.indexOf("[");

    const start =
        startObject === -1
            ? startArray
            : startArray === -1
              ? startObject
              : Math.min(startObject, startArray);

    if (start === -1) {
        throw new Error("Model output did not include JSON");
    }

    const endObject = input.lastIndexOf("}");
    const endArray = input.lastIndexOf("]");
    const end = Math.max(endObject, endArray);

    if (end <= start) {
        throw new Error("Model JSON block is malformed");
    }

    return input.slice(start, end + 1);
}

function normalizeQuestions(
    rawQuestions: ModelQuestion[],
    imagePath: string,
    imageName: string,
    startNumber: number
) {
    type NormalizedQuestion = {
        number: string;
        questionHindi: string;
        questionEnglish: string;
        options: Array<{ english: string; hindi: string }>;
        sourceImagePath: string;
        sourceImageName: string;
        diagramImagePath?: string;
        diagramCaptionHindi?: string;
        diagramCaptionEnglish?: string;
    };

    return rawQuestions
        .map<NormalizedQuestion | null>((raw, index) => {
            let questionHindi = normalizeText(raw.questionHindi);
            let questionEnglish = normalizeText(raw.questionEnglish);

            if (!questionHindi && !questionEnglish) return null;
            if (!questionHindi && questionEnglish) questionHindi = questionEnglish;
            if (!questionEnglish && questionHindi) questionEnglish = questionHindi;

            const options = Array.isArray(raw.options)
                ? raw.options.slice(0, 10).map((option) => {
                      let english = normalizeText(option?.english);
                      let hindi = normalizeText(option?.hindi);

                      if (!english && !hindi) return null;
                      if (!english && hindi) english = hindi;
                      if (!hindi && english) hindi = english;

                      return { english, hindi };
                  })
                : [];

            const normalizedOptions = options.filter(Boolean) as Array<{ english: string; hindi: string }>;
            while (normalizedOptions.length < 2) {
                normalizedOptions.push({ english: "", hindi: "" });
            }

            const hasDiagram =
                raw.hasDiagram === true || String(raw.hasDiagram).toLowerCase() === "true";

            return {
                number: normalizeText(raw.number) || String(startNumber + index),
                questionHindi,
                questionEnglish,
                options: normalizedOptions,
                sourceImagePath: imagePath,
                sourceImageName: imageName,
                diagramImagePath: hasDiagram ? imagePath : undefined,
                diagramCaptionHindi: normalizeText(raw.diagramCaptionHindi) || undefined,
                diagramCaptionEnglish: normalizeText(raw.diagramCaptionEnglish) || undefined,
            };
        })
        .filter((item): item is NormalizedQuestion => Boolean(item));
}

async function extractQuestionsForImage(
    model: ReturnType<GoogleGenerativeAI["getGenerativeModel"]>,
    file: File,
    imagePath: string,
    imageName: string,
    startQuestionNumber: number
) {
    const base64Data = Buffer.from(await file.arrayBuffer()).toString("base64");

    const imagePart = {
        inlineData: {
            data: base64Data,
            mimeType: file.type,
        },
    };

    const prompt = `
You are an expert OCR and exam-content extraction assistant.
Extract ALL questions visible in this image and preserve their exact top-to-bottom order.
Return STRICT JSON in this format:
{
  "questions": [
    {
      "number": "1",
      "questionHindi": "...",
      "questionEnglish": "...",
      "options": [
        { "english": "...", "hindi": "..." }
      ],
      "hasDiagram": true,
      "diagramCaptionHindi": "...",
      "diagramCaptionEnglish": "..."
    }
  ]
}
Rules:
1. Include every question and every option that appears.
2. Ensure questionHindi/questionEnglish are both present; translate if one language is missing.
3. Ensure each option has both english and hindi; translate if one language is missing.
4. Keep option order exactly as shown in the image.
5. Set hasDiagram=true when a diagram/figure/chart/image is part of that question context.
6. No markdown, no explanation, only JSON.
`;

    const result = await model.generateContent([prompt, imagePart]);
    const response = await result.response;
    const text = response.text().trim();

    const jsonText = extractJsonObject(text);
    const parsed = JSON.parse(jsonText) as { questions?: ModelQuestion[] } | ModelQuestion[];

    const rawQuestions = Array.isArray(parsed)
        ? parsed
        : Array.isArray(parsed.questions)
          ? parsed.questions
          : [];

    return normalizeQuestions(rawQuestions, imagePath, imageName, startQuestionNumber);
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
        const uploadedFiles = formData
            .getAll("images")
            .filter((entry): entry is File => entry instanceof File && entry.size > 0);

        if (uploadedFiles.length === 0) {
            const maybeSingle = formData.get("image");
            if (maybeSingle instanceof File && maybeSingle.size > 0) {
                uploadedFiles.push(maybeSingle);
            }
        }

        if (uploadedFiles.length === 0) {
            return NextResponse.json({ error: "No image provided" }, { status: 400 });
        }

        if (uploadedFiles.length > MAX_IMAGES_PER_BATCH) {
            return NextResponse.json(
                {
                    error: `Too many images in one request. Maximum allowed is ${MAX_IMAGES_PER_BATCH}.`,
                    maxImagesPerBatch: MAX_IMAGES_PER_BATCH,
                },
                { status: 429 }
            );
        }

        for (const file of uploadedFiles) {
            if (!file.type.startsWith("image/")) {
                return NextResponse.json(
                    { error: `Unsupported file type: ${file.name}` },
                    { status: 400 }
                );
            }

            if (file.size > MAX_IMAGE_SIZE_BYTES) {
                return NextResponse.json(
                    {
                        error: `Image ${file.name} exceeds size limit (${Math.round(
                            MAX_IMAGE_SIZE_BYTES / (1024 * 1024)
                        )}MB).`,
                    },
                    { status: 413 }
                );
            }
        }

        const genAI = new GoogleGenerativeAI(apiKey);
        const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

        const questions: Array<{
            number: string;
            questionHindi: string;
            questionEnglish: string;
            options: Array<{ english: string; hindi: string }>;
            sourceImagePath: string;
            sourceImageName: string;
            diagramImagePath?: string;
            diagramCaptionHindi?: string;
            diagramCaptionEnglish?: string;
        }> = [];

        const imageSummaries: Array<{
            imagePath: string;
            imageName: string;
            questionCount: number;
        }> = [];

        const warnings: string[] = [];

        for (const file of uploadedFiles) {
            const stored = await saveExtractionImage(file);

            try {
                const extracted = await extractQuestionsForImage(
                    model,
                    file,
                    stored.imagePath,
                    file.name,
                    questions.length + 1
                );

                if (extracted.length === 0) {
                    warnings.push(`No questions were detected in ${file.name}`);
                }

                questions.push(...extracted);
                imageSummaries.push({
                    imagePath: stored.imagePath,
                    imageName: file.name,
                    questionCount: extracted.length,
                });
            } catch (error) {
                console.error(`Extraction failed for ${file.name}:`, error);
                warnings.push(
                    `${file.name}: ${error instanceof Error ? error.message : String(error)}`
                );
                imageSummaries.push({
                    imagePath: stored.imagePath,
                    imageName: file.name,
                    questionCount: 0,
                });
            }
        }

        if (questions.length === 0) {
            return NextResponse.json(
                {
                    error: "No valid questions extracted from provided images.",
                    warnings,
                },
                { status: 422 }
            );
        }

        return NextResponse.json({
            questions,
            images: imageSummaries,
            totalImages: imageSummaries.length,
            totalQuestions: questions.length,
            maxImagesPerBatch: MAX_IMAGES_PER_BATCH,
            warnings,
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
