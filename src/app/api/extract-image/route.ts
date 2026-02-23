import { GoogleGenerativeAI } from "@google/generative-ai";
import { NextRequest, NextResponse } from "next/server";
import {
    ImageBounds,
    MatchColumnEntry,
    MatchColumns,
    Question,
    QuestionType,
} from "@/types/pdf";
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

type ModelMatchColumns = {
    left?: unknown;
    right?: unknown;
};

type ModelQuestion = {
    number?: unknown;
    questionHindi?: unknown;
    questionEnglish?: unknown;
    questionType?: unknown;
    options?: unknown;
    matchColumns?: ModelMatchColumns | null;
    blankCount?: unknown;
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

function normalizeOptions(
    rawOptions: unknown,
    requireAtLeastTwo: boolean
): Array<{ english: string; hindi: string }> {
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

    while (requireAtLeastTwo && options.length < 2) {
        options.push({ english: "", hindi: "" });
    }

    return options;
}

function normalizeQuestionType(
    value: unknown,
    fallback: QuestionType
): QuestionType {
    const raw = normalizeText(value).toUpperCase();
    if (!raw) return fallback;

    const mapped = raw
        .replace(/\s+/g, "_")
        .replace(/-/g, "_")
        .replace(/[()]/g, "");

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

    if (valid.includes(mapped as QuestionType)) {
        return mapped as QuestionType;
    }

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

function inferQuestionType(
    questionHindi: string,
    questionEnglish: string,
    optionCount: number
): QuestionType {
    const combined = `${questionHindi} ${questionEnglish}`.toLowerCase();

    if (
        /match\s*column|column\s*[- ]?\s*i|column\s*[- ]?\s*ii|सुमेलित|मिलान|स्तंभ-?i|स्तम्भ-?i|स्तंभ-?ii|स्तम्भ-?ii/.test(
            combined
        )
    ) {
        return "MATCH_COLUMN";
    }

    if (/fill\s*in\s*the\s*blank|blank|रिक्त\s*स्थान|रिक्तस्थान|____|_{2,}/.test(combined)) {
        return "FIB";
    }

    if (/true\s*false|सत्य\s*असत्य|सही\s*गलत/.test(combined)) {
        return "TRUE_FALSE";
    }

    if (/assertion|reason|कथन|कारण/.test(combined)) {
        return "ASSERTION_REASON";
    }

    if (/numerical|calculate|गणना|परिकलन|निकालिए|निकालो/.test(combined)) {
        return "NUMERICAL";
    }

    if (optionCount >= 2) return "MCQ";
    return "SHORT_ANSWER";
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

function normalizeMatchColumns(raw: unknown): MatchColumns | undefined {
    if (!raw || typeof raw !== "object") return undefined;

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

    if (left.length === 0 && right.length === 0) return undefined;
    return { left, right };
}

function normalizeBlankCount(
    raw: unknown,
    questionType: QuestionType,
    questionHindi: string,
    questionEnglish: string
): number | undefined {
    const parsed = Number.parseInt(String(raw ?? ""), 10);
    if (Number.isFinite(parsed) && parsed > 0) {
        return Math.min(parsed, 20);
    }

    if (questionType !== "FIB") return undefined;

    const combined = `${questionHindi}\n${questionEnglish}`;
    const underscoreHits = combined.match(/_{2,}/g)?.length || 0;
    const hindiBlankHits = combined.match(/रिक्त\s*स्थान/g)?.length || 0;
    const englishBlankHits = combined.match(/\bblank\b/gi)?.length || 0;
    return Math.max(1, underscoreHits + hindiBlankHits + englishBlankHits || 1);
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

        const provisionalOptions = normalizeOptions(raw.options, false);
        const inferredType = inferQuestionType(
            questionHindi,
            questionEnglish,
            provisionalOptions.length
        );
        const questionType = normalizeQuestionType(raw.questionType, inferredType);
        const requireAtLeastTwoOptions =
            questionType === "MCQ" ||
            questionType === "TRUE_FALSE" ||
            questionType === "ASSERTION_REASON";
        const options = normalizeOptions(raw.options, requireAtLeastTwoOptions);
        const diagramBounds = normalizeImageBounds(raw.diagramBounds);
        const questionBounds = normalizeImageBounds(raw.questionBounds);
        const matchColumns = normalizeMatchColumns(raw.matchColumns);
        const blankCount = normalizeBlankCount(
            raw.blankCount,
            questionType,
            questionHindi,
            questionEnglish
        );
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
            diagramImagePath: undefined,
            autoDiagramImagePath: undefined,
            diagramDetected: hasDiagram,
            diagramBounds,
            questionBounds,
            questionType,
            matchColumns,
            blankCount,
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
      "questionType": "MCQ",
      "questionHindi": "...",
      "questionEnglish": "...",
      "options": [
        { "english": "...", "hindi": "..." }
      ],
      "matchColumns": {
        "left": [{ "english": "...", "hindi": "..." }],
        "right": [{ "english": "...", "hindi": "..." }]
      },
      "blankCount": 1,
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
3. Detect questionType exactly from content:
   - MCQ, FIB, MATCH_COLUMN, TRUE_FALSE, ASSERTION_REASON, NUMERICAL, SHORT_ANSWER, LONG_ANSWER.
4. Keep option order exactly as shown.
5. For bilingual fields:
   - If both Hindi and English are present, capture both.
   - If only one language is present, translate into the missing language when confident.
   - If translation is uncertain, copy the available text into both fields.
6. For MATCH_COLUMN, fill matchColumns.left and matchColumns.right in order.
7. For FIB, set blankCount to the number of blanks.
8. For non-MCQ types where options do not exist, use empty options array.
9. Set hasDiagram=true only when a figure/diagram/photo is part of that question.
10. Provide normalized bounds in range 0..1:
   - questionBounds: full area of that question block.
   - diagramBounds: exact figure area for that question; null if no diagram.
11. Use extractionConfidence in 0..1.
12. No markdown, no commentary, JSON only.
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

                    if (nextQuestion.diagramDetected) {
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
                                        `${file.name}: could not create diagram crop for question ${nextQuestion.number}`
                                    );
                                }
                            } catch (error) {
                                warnings.push(
                                    `${file.name}: diagram crop failed for question ${nextQuestion.number}`
                                );
                                console.error("Diagram crop error:", error);
                            }
                        } else {
                            warnings.push(
                                `${file.name}: diagram detected for question ${nextQuestion.number}, but bounds were missing`
                            );
                        }

                        if (nextQuestion.diagramImagePath) {
                            diagramCount += 1;
                        }
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
