import { mkdir, readFile, writeFile } from "fs/promises";
import path from "path";
import sharp from "sharp";
import { NextRequest, NextResponse } from "next/server";
import { enforceToolAccess } from "@/lib/api-auth";
import {
    buildGeminiRateLimitMessage,
    getGeminiUsageSummary,
    parseGeminiRateLimitInfo,
    recordGeminiUsage,
    setGeminiRateBlocked,
} from "@/lib/gemini-usage";
import { prisma } from "@/lib/prisma";
import { getPdfDocumentById } from "@/lib/services/pdf-document-service";
import {
    buildFallbackQuestionSlideSvg,
    buildSlideVisualizationQuestionSnapshot,
    buildSlidesVisualizationPrompt,
    buildSlidesVisualizationRetryPrompt,
    getSlideVisualizationQuestionKey,
    type SlideVisualizationQuestionSnapshot,
} from "@/lib/slides-visualization";
import {
    buildFallbackTopicSlideSvg,
    buildTopicSlidesVisualizationPrompt,
    buildTopicSlidesVisualizationRetryPrompt,
    extractTopicSlidesFromDocument,
    getTopicSlideKey,
    getTopicSlidePreview,
    isTopicSnapshot,
    resolveInstituteFooterLine,
    type SlideVisualizationContentType,
    type SlideVisualizationTopicSnapshot,
} from "@/lib/slide-topics";
import type { Question } from "@/types/pdf";

export const dynamic = "force-dynamic";

const GEMINI_API_BASE_URL = "https://generativelanguage.googleapis.com/v1beta";
const GEMINI_IMAGE_MODEL_NEXEN_2 = "gemini-3.1-flash-image-preview";
const MAX_INLINE_REFERENCE_BYTES = 20 * 1024 * 1024;
const MAX_REFERENCE_EDGE = 1024;

type InlineImagePart = {
    inline_data: {
        mime_type: string;
        data: string;
    };
};

type SlideVisualizationSnapshot =
    | SlideVisualizationQuestionSnapshot
    | SlideVisualizationTopicSnapshot;

function sanitizeText(value: unknown, maxLength = 200) {
    return String(value || "")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, maxLength);
}

function escapeXml(value: string) {
    return String(value || "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&apos;");
}

function getMimeTypeFromPath(filePath: string) {
    const extension = path.extname(filePath).toLowerCase();
    if (extension === ".svg") return "image/svg+xml";
    if (extension === ".png") return "image/png";
    if (extension === ".jpg" || extension === ".jpeg") return "image/jpeg";
    if (extension === ".webp") return "image/webp";
    if (extension === ".gif") return "image/gif";
    return "application/octet-stream";
}

function extensionFromMimeType(mimeType: string) {
    if (mimeType === "image/png") return "png";
    if (mimeType === "image/jpeg") return "jpg";
    if (mimeType === "image/webp") return "webp";
    return "png";
}

function resolvePublicAssetPath(assetUrl: string | null | undefined) {
    const normalized = String(assetUrl || "").trim();
    if (!normalized || !normalized.startsWith("/")) return null;
    return path.join(process.cwd(), "public", normalized.replace(/^\/+/, ""));
}

async function saveGeneratedImageAsset(buffer: Buffer, mimeType: string) {
    const uploadDir = path.join(process.cwd(), "public", "uploads", "generated-media");
    await mkdir(uploadDir, { recursive: true });
    const extension = extensionFromMimeType(mimeType);
    const fileName = `${Date.now()}_${Math.random().toString(36).slice(2, 10)}.${extension}`;
    const filePath = path.join(uploadDir, fileName);
    await writeFile(filePath, buffer);
    return `/uploads/generated-media/${fileName}`;
}

async function loadLogoDataUri(assetUrl: string | null | undefined) {
    const assetPath = resolvePublicAssetPath(assetUrl);
    if (!assetPath) return null;

    try {
        const buffer = await readFile(assetPath);
        return `data:${getMimeTypeFromPath(assetPath)};base64,${buffer.toString("base64")}`;
    } catch {
        return null;
    }
}

async function buildInlineImagePartFromAssetUrl(assetUrl: string | null | undefined): Promise<InlineImagePart | null> {
    const assetPath = resolvePublicAssetPath(assetUrl);
    if (!assetPath) return null;

    try {
        const originalBuffer = await readFile(assetPath);
        if (!originalBuffer.length) return null;

        const mimeType = getMimeTypeFromPath(assetPath);
        const shouldRasterize =
            mimeType === "image/svg+xml" ||
            mimeType === "image/gif" ||
            originalBuffer.length > MAX_INLINE_REFERENCE_BYTES;

        const transformedBuffer = shouldRasterize
            ? await sharp(originalBuffer, { animated: false })
                  .resize({
                      width: MAX_REFERENCE_EDGE,
                      height: MAX_REFERENCE_EDGE,
                      fit: "inside",
                      withoutEnlargement: true,
                  })
                  .png()
                  .toBuffer()
            : originalBuffer;

        const finalMimeType = shouldRasterize ? "image/png" : mimeType;
        const finalBuffer =
            transformedBuffer.length > MAX_INLINE_REFERENCE_BYTES
                ? await sharp(transformedBuffer)
                      .resize({
                          width: 768,
                          height: 768,
                          fit: "inside",
                          withoutEnlargement: true,
                      })
                      .png()
                      .toBuffer()
                : transformedBuffer;

        if (finalBuffer.length > MAX_INLINE_REFERENCE_BYTES) {
            return null;
        }

        return {
            inline_data: {
                mime_type: finalMimeType,
                data: finalBuffer.toString("base64"),
            },
        };
    } catch {
        return null;
    }
}

async function loadQuestionReferenceParts(snapshot: SlideVisualizationQuestionSnapshot) {
    const uniqueAssetUrls = Array.from(
        new Set(
            [
                snapshot.autoDiagramImagePath,
                snapshot.diagramImagePath,
                snapshot.sourceImagePath,
            ]
                .map((value) => String(value || "").trim())
                .filter(Boolean)
        )
    ).slice(0, 2);

    const results = await Promise.all(uniqueAssetUrls.map((assetUrl) => buildInlineImagePartFromAssetUrl(assetUrl)));
    return results.filter(Boolean) as InlineImagePart[];
}

function buildBrandOverlaySvg(input: {
    width: number;
    height: number;
    instituteName: string;
    instituteFooterLine?: string | null;
    logoDataUri?: string | null;
}) {
    const width = Math.max(960, input.width);
    const height = Math.max(540, input.height);
    const headerHeight = Math.round(height * 0.1);
    const footerHeight = Math.round(height * 0.05);
    const leftPadding = Math.round(width * 0.028);
    const logoSize = Math.round(headerHeight * 0.64);
    const logoY = Math.round((headerHeight - logoSize) / 2) + 14;
    const nameX = leftPadding + (input.logoDataUri ? logoSize + 18 : 0);
    const titleFontSize = Math.max(20, Math.round(height * 0.032));
    const footerFontSize = Math.max(14, Math.round(height * 0.017));
    const footerLine = sanitizeText(input.instituteFooterLine, 160);

    return `
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <rect x="18" y="14" width="${width - 36}" height="${headerHeight}" rx="${Math.round(headerHeight / 2.8)}" fill="rgba(255,255,255,0.86)" stroke="rgba(15,23,42,0.10)" />
  ${
      input.logoDataUri
          ? `<image href="${input.logoDataUri}" x="${leftPadding}" y="${logoY}" width="${logoSize}" height="${logoSize}" preserveAspectRatio="xMidYMid meet" />`
          : ""
  }
  <text x="${nameX}" y="${logoY + Math.round(logoSize * 0.54)}" fill="#0f172a" font-family="Arial, sans-serif" font-size="${titleFontSize}" font-weight="800">${escapeXml(
      input.instituteName
  )}</text>
  ${
      footerLine
          ? `
  <rect x="18" y="${height - footerHeight - 18}" width="${width - 36}" height="${footerHeight}" rx="${Math.round(footerHeight / 2)}" fill="rgba(15,23,42,0.80)" />
  <text x="${Math.round(width / 2)}" y="${height - 18 - Math.round(footerHeight * 0.32)}" text-anchor="middle" fill="#f8fafc" font-family="Arial, sans-serif" font-size="${footerFontSize}" font-weight="700">${escapeXml(
      footerLine
  )}</text>
  `
          : ""
  }
</svg>`.trim();
}

async function applySlideBranding(buffer: Buffer, input: {
    instituteName: string;
    instituteFooterLine?: string | null;
    logoDataUri?: string | null;
}) {
    const image = sharp(buffer, { animated: false });
    const metadata = await image.metadata();
    const width = metadata.width || 1600;
    const height = metadata.height || 900;
    const overlaySvg = buildBrandOverlaySvg({
        width,
        height,
        instituteName: input.instituteName,
        instituteFooterLine: input.instituteFooterLine,
        logoDataUri: input.logoDataUri,
    });

    return await image
        .composite([{ input: Buffer.from(overlaySvg, "utf-8"), top: 0, left: 0 }])
        .png()
        .toBuffer();
}

function extractResponseParts(payload: any): any[] {
    const candidates = Array.isArray(payload?.candidates) ? payload.candidates : [];
    return candidates.flatMap((candidate: any) =>
        Array.isArray(candidate?.content?.parts) ? candidate.content.parts : []
    );
}

function getInlineDataBlob(part: any): { mimeType: string; data: string } | null {
    const camel = part?.inlineData;
    if (camel?.data) {
        return {
            mimeType: camel.mimeType || "application/octet-stream",
            data: camel.data,
        };
    }

    const snake = part?.inline_data;
    if (snake?.data) {
        return {
            mimeType: snake.mime_type || "application/octet-stream",
            data: snake.data,
        };
    }

    return null;
}

async function extractProviderErrorMessage(response: Response): Promise<string> {
    try {
        const payload = await response.clone().json();
        const message =
            payload?.error?.message ||
            payload?.message ||
            payload?.error ||
            "";
        if (message) {
            return sanitizeText(message, 260) || `Provider returned ${response.status}`;
        }
    } catch {
        // Ignore JSON parse errors and fall back to text.
    }

    try {
        return sanitizeText(await response.text(), 260) || `Provider returned ${response.status}`;
    } catch {
        return `Provider returned ${response.status}`;
    }
}

function getDocumentSlideOrder(
    document: { jsonData: Record<string, unknown> },
    contentType: SlideVisualizationContentType
) {
    if (contentType === "topic") {
        return extractTopicSlidesFromDocument(document.jsonData).map((topic, index) => ({
            index,
            key: getTopicSlideKey(topic, index),
            snapshot: topic as SlideVisualizationSnapshot,
        }));
    }

    const rawQuestions = Array.isArray(document.jsonData.questions)
        ? (document.jsonData.questions as Question[])
        : [];

    return rawQuestions.map((question, index) => {
        const snapshot = buildSlideVisualizationQuestionSnapshot(question);
        return {
            index,
            key: getSlideVisualizationQuestionKey(question, index),
            snapshot: snapshot as SlideVisualizationSnapshot,
        };
    });
}

function normalizeSnapshot(value: unknown): SlideVisualizationSnapshot | null {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    return value as SlideVisualizationSnapshot;
}

async function requestImageFromGemini(options: {
    apiKey: string;
    promptCandidates: string[];
    logoPart: InlineImagePart | null;
    referenceParts: InlineImagePart[];
}) {
    let lastError = "Nexen 2 image generation failed.";

    for (const candidate of options.promptCandidates) {
        try {
            const parts: Array<{ text: string } | InlineImagePart> = [{ text: candidate }];
            parts.push(...options.referenceParts);
            if (options.logoPart) {
                parts.push(options.logoPart);
            }

            await recordGeminiUsage("image_generation");
            const response = await fetch(
                `${GEMINI_API_BASE_URL}/models/${GEMINI_IMAGE_MODEL_NEXEN_2}:generateContent`,
                {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        "x-goog-api-key": options.apiKey,
                    },
                    body: JSON.stringify({
                        contents: [{ parts }],
                        generationConfig: {
                            responseModalities: ["TEXT", "IMAGE"],
                        },
                    }),
                }
            );

            if (!response.ok) {
                lastError = await extractProviderErrorMessage(response);
                continue;
            }

            const payload = await response.json();
            const imagePart = extractResponseParts(payload)
                .map((part) => getInlineDataBlob(part))
                .find(Boolean);

            if (!imagePart?.data) {
                const textPart = extractResponseParts(payload)
                    .map((part) => String(part?.text || "").trim())
                    .find(Boolean);
                lastError = sanitizeText(textPart || "Nexen 2 did not return an image.", 220);
                continue;
            }

            return {
                buffer: Buffer.from(imagePart.data, "base64"),
                mimeType: imagePart.mimeType || "image/png",
                promptUsed: candidate,
            };
        } catch (error) {
            lastError =
                error instanceof Error
                    ? sanitizeText(error.message, 220) || "Nexen 2 image generation failed."
                    : "Nexen 2 image generation failed.";
        }
    }

    throw new Error(lastError);
}

export async function POST(request: NextRequest) {
    try {
        const auth = await enforceToolAccess(["pdf-to-pdf", "media-studio"]);
        const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;

        const documentId = sanitizeText(body.documentId, 80);
        const questionKey = sanitizeText(body.questionKey, 220);
        const fallbackQuestionNumber = sanitizeText(body.questionNumber, 40);
        const fallbackQuestionPreview = sanitizeText(body.questionPreview, 220);
        const questionIndex = Number.isFinite(Number(body.questionIndex)) ? Number(body.questionIndex) : -1;
        const requestedSnapshot = normalizeSnapshot(body.questionSnapshot);
        const contentType: SlideVisualizationContentType =
            body.contentType === "topic" ? "topic" : "question";

        if (!documentId || !questionKey || questionIndex < 0) {
            return NextResponse.json(
                { error: "documentId, questionKey, and questionIndex are required." },
                { status: 400 }
            );
        }

        const document = await getPdfDocumentById(documentId, auth.organizationId, auth.userId, auth.role);
        if (!document) {
            return NextResponse.json({ error: "Document not found." }, { status: 404 });
        }

        const orderedSlides = getDocumentSlideOrder(document as { jsonData: Record<string, unknown> }, contentType);
        const matchedQuestion =
            orderedSlides.find((entry) => entry.key === questionKey) ||
            orderedSlides.find((entry) => entry.index === questionIndex) ||
            null;

        const snapshot = matchedQuestion?.snapshot || requestedSnapshot;
        if (!snapshot) {
            return NextResponse.json(
                { error: "Question snapshot could not be resolved from the document." },
                { status: 404 }
            );
        }

        const organization =
            auth.organizationId
                ? await prisma.organization.findUnique({
                      where: { id: auth.organizationId },
                      select: { name: true, logo: true, tagline: true, description: true, audienceSummary: true },
                  })
                : null;

        const instituteName =
            sanitizeText((document.jsonData as Record<string, unknown>).instituteName, 160) ||
            sanitizeText(organization?.name, 160) ||
            "Nexora Institute";
        const instituteFooterLine = resolveInstituteFooterLine({
            tagline: organization?.tagline,
            description: organization?.description,
            audienceSummary: organization?.audienceSummary,
            instituteName,
        });

        const primaryPrompt = isTopicSnapshot(snapshot)
            ? buildTopicSlidesVisualizationPrompt({
                  topic: snapshot,
                  documentTitle: sanitizeText(document.title, 180),
                  subject: sanitizeText(document.subject, 120),
                  instituteName,
                  instituteFooterLine,
              })
            : buildSlidesVisualizationPrompt({
                  question: snapshot,
                  documentTitle: sanitizeText(document.title, 180),
                  subject: sanitizeText(document.subject, 120),
                  instituteName,
                  instituteFooterLine,
              });
        const retryPrompt = isTopicSnapshot(snapshot)
            ? buildTopicSlidesVisualizationRetryPrompt({
                  topic: snapshot,
                  documentTitle: sanitizeText(document.title, 180),
                  subject: sanitizeText(document.subject, 120),
                  instituteName,
                  instituteFooterLine,
              })
            : buildSlidesVisualizationRetryPrompt({
                  question: snapshot,
                  documentTitle: sanitizeText(document.title, 180),
                  subject: sanitizeText(document.subject, 120),
                  instituteName,
                  instituteFooterLine,
              });
        const promptCandidates = Array.from(new Set([primaryPrompt, retryPrompt].filter(Boolean)));

        let assetUrl = "";
        let status = "generated_image_slide";
        let imageModel = "nexen_2";
        let promptUsed = primaryPrompt;
        let fallbackUsed = false;

        try {
            const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
            if (!apiKey) {
                throw new Error("Gemini API key is not configured.");
            }

            const [logoPart, referenceParts, logoDataUri] = await Promise.all([
                buildInlineImagePartFromAssetUrl(organization?.logo || null),
                isTopicSnapshot(snapshot)
                    ? Promise.resolve([] as InlineImagePart[])
                    : loadQuestionReferenceParts(snapshot),
                loadLogoDataUri(organization?.logo || null),
            ]);

            const generated = await requestImageFromGemini({
                apiKey,
                promptCandidates,
                logoPart,
                referenceParts,
            });

            const brandedBuffer = await applySlideBranding(generated.buffer, {
                instituteName,
                instituteFooterLine,
                logoDataUri,
            });
            assetUrl = await saveGeneratedImageAsset(brandedBuffer, "image/png");
            promptUsed = generated.promptUsed;
        } catch (error) {
            const rateLimit = parseGeminiRateLimitInfo(error);
            if (rateLimit.isRateLimited) {
                const message = buildGeminiRateLimitMessage(rateLimit);
                await setGeminiRateBlocked({
                    retryAfterSeconds: rateLimit.retryAfterSeconds,
                    reason: message,
                    isDailyQuota: rateLimit.isDailyQuota,
                });
                return NextResponse.json(
                    {
                        error: message,
                        rateLimited: true,
                        usage: await getGeminiUsageSummary(),
                    },
                    { status: 429 }
                );
            }

            console.error("Falling back to deterministic visual slide image:", error);
            fallbackUsed = true;
            status = "fallback_image_slide";
            imageModel = "deterministic_visual_slide";
            promptUsed = primaryPrompt;

            const logoDataUri = await loadLogoDataUri(organization?.logo || null);
            const fallbackSvg = isTopicSnapshot(snapshot)
                ? buildFallbackTopicSlideSvg({
                      topic: snapshot,
                      instituteName,
                      documentTitle: sanitizeText(document.title, 180),
                      subject: sanitizeText(document.subject, 120),
                      logoDataUri,
                      instituteFooterLine,
                  })
                : buildFallbackQuestionSlideSvg({
                      question: snapshot,
                      instituteName,
                      documentTitle: sanitizeText(document.title, 180),
                      subject: sanitizeText(document.subject, 120),
                      logoDataUri,
                      instituteFooterLine,
                  });
            const rasterizedFallback = await sharp(Buffer.from(fallbackSvg, "utf-8")).png().toBuffer();
            assetUrl = await saveGeneratedImageAsset(rasterizedFallback, "image/png");
        }

        const snapshotNumber = isTopicSnapshot(snapshot)
            ? snapshot.number
            : snapshot.number;
        const snapshotPreview = isTopicSnapshot(snapshot)
            ? getTopicSlidePreview(snapshot, 220)
            : sanitizeText(snapshot.questionHindi || snapshot.questionEnglish, 220);

        const row = await prisma.slideVisualization.upsert({
            where: {
                documentId_questionKey: {
                    documentId,
                    questionKey,
                },
            },
            create: {
                organizationId: auth.organizationId,
                userId: auth.userId,
                documentId,
                questionKey,
                questionIndex: matchedQuestion?.index ?? questionIndex,
                questionNumber: sanitizeText(snapshotNumber || fallbackQuestionNumber || String(questionIndex + 1), 40),
                questionPreview: fallbackQuestionPreview || snapshotPreview,
                questionSnapshot: snapshot as unknown as object,
                prompt: promptUsed,
                generatedMediaId: null,
                assetUrl,
                status,
                imageModel,
            },
            update: {
                questionIndex: matchedQuestion?.index ?? questionIndex,
                questionNumber: sanitizeText(snapshotNumber || fallbackQuestionNumber || String(questionIndex + 1), 40),
                questionPreview: fallbackQuestionPreview || snapshotPreview,
                questionSnapshot: snapshot as unknown as object,
                prompt: promptUsed,
                generatedMediaId: null,
                assetUrl,
                status,
                imageModel,
            },
        });

        return NextResponse.json({
            success: true,
            fallbackUsed,
            item: {
                id: row.id,
                documentId: row.documentId,
                questionKey: row.questionKey,
                questionIndex: row.questionIndex,
                questionNumber: row.questionNumber,
                questionPreview: row.questionPreview,
                questionSnapshot: row.questionSnapshot,
                prompt: row.prompt,
                generatedMediaId: row.generatedMediaId,
                assetUrl: row.assetUrl,
                status: row.status,
                imageModel: row.imageModel,
                createdAt: row.createdAt.toISOString(),
                updatedAt: row.updatedAt.toISOString(),
            },
            usage: await getGeminiUsageSummary(),
        });
    } catch (error) {
        if (error instanceof Response) return error;
        console.error("Failed to generate slide visualization:", error);
        return NextResponse.json(
            {
                error: error instanceof Error ? error.message : "Failed to generate slide visualization.",
                usage: await getGeminiUsageSummary().catch(() => null),
            },
            { status: 500 }
        );
    }
}
