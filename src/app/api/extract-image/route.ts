import { GoogleGenerativeAI } from "@google/generative-ai";
import { NextRequest, NextResponse } from "next/server";
import { ImageBounds, Question } from "@/types/pdf";
import {
    MAX_IMAGE_SIZE_BYTES,
    MAX_IMAGES_PER_BATCH,
    cropDiagramFromSourceImage,
    normalizeImageBounds,
    saveExtractionImage,
} from "@/lib/services/image-extraction-service";

export const dynamic = "force-dynamic";

type ModelBounds = {
    x?: unknown;
    y?: unknown;
    width?: unknown;
    height?: unknown;
};

type ModelOption = {
    english?: unknown;
    hindi?: unknown;
};

type ModelQuestion = {
    number?: unknown;
    questionHindi?: unknown;
    questionEnglish?: unknown;
    options?: unknown;
    hasDiagram?: unknown;
    diagramCaptionHindi?: unknown;
    diagramCaptionEnglish?: unknown;
    diagramBounds?: ModelBounds | null;
    questionBounds?: ModelBounds | null;
    extractionConfidence?: unknown;
};

type ExtractedQuestion = Question & {
    diagramBounds?: ImageBounds;
    questionBounds?: ImageBounds;
    extractionConfidence?: number;
};

function normalizeText(value: unknown): string {
    return String(value ?? "").replace(/\s+/g, " ").trim();
}

function normalizeConfidence(value: unknown): number | undefined {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return undefined;
    if (numeric < 0 || numeric > 1) return undefined;
    return Number(numeric.toFixed(4));
}

function normalizeOptions(rawOptions: unknown): Array<{ english: string; hindi: string }> {
    const optionsInput = Array.isArray(rawOptions) ? rawOptions.slice(0, 10) : [];

    const options = optionsInput
        .map((raw) => {
            const option = (raw ?? {}) as ModelOption;
            let english = normalizeText(option.english);
            let hindi = normalizeText(option.hindi);

            if (!english && !hindi) return null;
            if (!english) english = hindi;
            if (!hindi) hindi = english;

            return { english, hindi };
        })
        .filter((option): option is { english: string; hindi: string } => Boolean(option));

    while (options.length < 2) {
        options.push({ english: "", hindi: "" });
    }

    return options;
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
): ExtractedQuestion[] {
    const normalized: ExtractedQuestion[] = [];

    for (let index = 0; index < rawQuestions.length; index += 1) {
        const raw = rawQuestions[index];
        let questionHindi = normalizeText(raw.questionHindi);
        let questionEnglish = normalizeText(raw.questionEnglish);

        if (!questionHindi && !questionEnglish) continue;
        if (!questionHindi) questionHindi = questionEnglish;
        if (!questionEnglish) questionEnglish = questionHindi;

        const options = normalizeOptions(raw.options);
        const diagramBounds = normalizeImageBounds(raw.diagramBounds);
        const questionBounds = normalizeImageBounds(raw.questionBounds);
        const hasDiagram =
            raw.hasDiagram === true ||
            String(raw.hasDiagram).toLowerCase() === "true" ||
            Boolean(diagramBounds);

        normalized.push({
            number: normalizeText(raw.number) || String(startNumber + index),
            questionHindi,
            questionEnglish,
            options,
            sourceImagePath: imagePath,
            sourceImageName: imageName,
            diagramImagePath: hasDiagram ? imagePath : undefined,
            autoDiagramImagePath: hasDiagram ? imagePath : undefined,
            diagramBounds,
            questionBounds,
            diagramCaptionHindi: normalizeText(raw.diagramCaptionHindi) || undefined,
            diagramCaptionEnglish: normalizeText(raw.diagramCaptionEnglish) || undefined,
            extractionConfidence: normalizeConfidence(raw.extractionConfidence),
        });
    }

    return normalized;
}

async function extractQuestionsForImage(
    model: ReturnType<GoogleGenerativeAI["getGenerativeModel"]>,
    file: File,
    imagePath: string,
    imageName: string,
    startQuestionNumber: number
): Promise<ExtractedQuestion[]> {
    const base64Data = Buffer.from(await file.arrayBuffer()).toString("base64");

    const imagePart = {
        inlineData: {
            data: base64Data,
            mimeType: file.type,
        },
    };

    const prompt = `
You are an OCR and exam-sheet extraction engine.
Extract ALL questions visible in this image, in exact top-to-bottom order.
Return strict JSON only in this format:
{
  "questions": [
    {
      "number": "42",
      "questionHindi": "...",
      "questionEnglish": "...",
      "options": [
        { "english": "...", "hindi": "..." }
      ],
      "hasDiagram": true,
      "diagramCaptionHindi": "...",
      "diagramCaptionEnglish": "...",
      "questionBounds": { "x": 0.12, "y": 0.18, "width": 0.76, "height": 0.34 },
      "diagramBounds": { "x": 0.24, "y": 0.31, "width": 0.46, "height": 0.20 },
      "extractionConfidence": 0.94
    }
  ]
}

Rules:
1. Include every visible question and all options for that question.
2. Preserve original question number if present.
3. Keep option order exactly as shown.
4. For bilingual fields:
   - If both Hindi and English are present, capture both.
   - If only one language is present, translate into the missing language when confident.
   - If translation is uncertain, copy the available text into both fields.
5. Set hasDiagram=true only when a figure/diagram/photo is part of that question.
6. Provide normalized bounds in range 0..1:
   - questionBounds: full area of that question block.
   - diagramBounds: exact figure area for that question; null if no diagram.
7. Use extractionConfidence in 0..1.
8. No markdown, no commentary, JSON only.
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

function dedupeWarnings(warnings: string[]): string[] {
    return Array.from(new Set(warnings.map((item) => item.trim()).filter(Boolean)));
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
        const model = genAI.getGenerativeModel({
            model: "gemini-2.5-flash",
            generationConfig: {
                temperature: 0.1,
                responseMimeType: "application/json",
            },
        });

        const questions: ExtractedQuestion[] = [];
        const imageSummaries: Array<{
            imagePath: string;
            imageName: string;
            questionCount: number;
            diagramCount: number;
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

                let diagramCount = 0;
                const finalized: ExtractedQuestion[] = [];

                for (const question of extracted) {
                    const nextQuestion = { ...question };

                    if (nextQuestion.diagramImagePath) {
                        if (nextQuestion.diagramBounds) {
                            try {
                                const crop = await cropDiagramFromSourceImage(
                                    stored,
                                    nextQuestion.number,
                                    nextQuestion.diagramBounds
                                );
                                if (crop) {
                                    nextQuestion.diagramImagePath = crop.imagePath;
                                    nextQuestion.autoDiagramImagePath = crop.imagePath;
                                } else {
                                    warnings.push(
                                        `${file.name}: could not create diagram crop for question ${nextQuestion.number}; using source image fallback`
                                    );
                                }
                            } catch (error) {
                                warnings.push(
                                    `${file.name}: diagram crop failed for question ${nextQuestion.number}; using source image fallback`
                                );
                                console.error("Diagram crop error:", error);
                            }
                        } else {
                            warnings.push(
                                `${file.name}: diagram detected for question ${nextQuestion.number}, but bounds were missing`
                            );
                        }

                        diagramCount += 1;
                    }

                    finalized.push(nextQuestion);
                }

                questions.push(...finalized);
                imageSummaries.push({
                    imagePath: stored.imagePath,
                    imageName: file.name,
                    questionCount: finalized.length,
                    diagramCount,
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
                    diagramCount: 0,
                });
            }
        }

        if (questions.length === 0) {
            return NextResponse.json(
                {
                    error: "No valid questions extracted from provided images.",
                    warnings: dedupeWarnings(warnings),
                },
                { status: 422 }
            );
        }

        return NextResponse.json({
            questions,
            images: imageSummaries,
            totalImages: imageSummaries.length,
            totalQuestions: questions.length,
            totalDiagrams: questions.filter((question) => Boolean(question.diagramImagePath)).length,
            maxImagesPerBatch: MAX_IMAGES_PER_BATCH,
            warnings: dedupeWarnings(warnings),
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
