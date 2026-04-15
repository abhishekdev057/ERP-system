import { readFile } from "fs/promises";
import path from "path";
import PDFDocument from "pdfkit";
import sharp from "sharp";
import { NextRequest, NextResponse } from "next/server";
import { enforceToolAccess } from "@/lib/api-auth";
import { getPdfDocumentById } from "@/lib/services/pdf-document-service";
import {
    buildSlideVisualizationQuestionSnapshot,
    getSlideVisualizationQuestionKey,
    resolveQuestionTextLayout,
    type SlideVisualizationQuestionSnapshot,
} from "@/lib/slides-visualization";
import {
    extractTopicSlidesFromDocument,
    getTopicSlideKey,
    isTopicSnapshot,
    resolveInstituteFooterLine,
    resolveTopicTextLayout,
    type SlideVisualizationContentType,
    type SlideVisualizationTopicSnapshot,
} from "@/lib/slide-topics";
import { prisma } from "@/lib/prisma";
import type { Question } from "@/types/pdf";

export const dynamic = "force-dynamic";

const PAGE_WIDTH = 1600;
const PAGE_HEIGHT = 900;
const PAGE_PADDING = 92;

type SlideVisualizationSnapshot =
    | SlideVisualizationQuestionSnapshot
    | SlideVisualizationTopicSnapshot;

function sanitizeText(value: unknown, maxLength = 200) {
    return String(value || "")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, maxLength);
}

function resolveAssetPath(assetUrl: string | null | undefined) {
    const normalized = String(assetUrl || "").trim();
    if (!normalized.startsWith("/")) return null;
    const cleanPath = normalized.split("?")[0];
    return path.join(process.cwd(), "public", cleanPath.replace(/^\/+/, ""));
}

async function loadAssetBuffer(assetUrl: string | null | undefined) {
    const assetPath = resolveAssetPath(assetUrl);
    if (!assetPath) return null;
    try {
        const buffer = await readFile(assetPath);
        const extension = path.extname(assetPath).toLowerCase();

        if (extension === ".png" || extension === ".jpg" || extension === ".jpeg") {
            return buffer;
        }

        return await sharp(buffer).png().toBuffer();
    } catch {
        return null;
    }
}

function buildDocumentSlideOrder(
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

function fillBackground(doc: InstanceType<typeof PDFDocument>) {
    doc.save();
    doc.rect(0, 0, PAGE_WIDTH, PAGE_HEIGHT).fill("#09121f");
    doc.restore();
}

function drawBrandChrome(
    doc: InstanceType<typeof PDFDocument>,
    input: {
        instituteName: string;
        documentTitle: string;
        pageIndex: number;
        totalPages: number;
        footerLine?: string | null;
        logoBuffer?: Buffer | null;
    }
) {
    doc.save();
    doc.roundedRect(PAGE_PADDING, 64, PAGE_WIDTH - PAGE_PADDING * 2, 56, 24).fillOpacity(0.9).fill("#0f172a");
    doc.restore();

    if (input.logoBuffer) {
        try {
            doc.image(input.logoBuffer, PAGE_PADDING + 18, 74, {
                fit: [42, 42],
            });
        } catch {
            // Ignore logo render issues and fall back to text only.
        }
    }

    doc.fillColor("#f8fafc").font("Helvetica-Bold").fontSize(24).text(
        input.instituteName || "Institute",
        PAGE_PADDING + (input.logoBuffer ? 72 : 26),
        82,
        {
            width: PAGE_WIDTH - PAGE_PADDING * 2 - (input.logoBuffer ? 98 : 52),
            align: "left",
        }
    );

    doc.fillColor("#cbd5e1").font("Helvetica").fontSize(14).text(
        `${input.documentTitle} · Slide ${input.pageIndex + 1}/${input.totalPages}`,
        PAGE_WIDTH - PAGE_PADDING - 360,
        88,
        {
            width: 320,
            align: "right",
        }
    );

    const footerLine = sanitizeText(input.footerLine, 160);
    if (footerLine) {
        doc.save();
        doc.roundedRect(PAGE_PADDING, PAGE_HEIGHT - 70, PAGE_WIDTH - PAGE_PADDING * 2, 34, 17).fillOpacity(0.86).fill("#0f172a");
        doc.restore();

        doc.fillColor("#f8fafc").font("Helvetica-Bold").fontSize(15).text(
            footerLine,
            PAGE_PADDING + 20,
            PAGE_HEIGHT - 60,
            {
                width: PAGE_WIDTH - PAGE_PADDING * 2 - 40,
                align: "center",
            }
        );
    }
}

function drawQuestionSlide(
    doc: InstanceType<typeof PDFDocument>,
    input: {
        instituteName: string;
        documentTitle: string;
        footerLine?: string | null;
        questionNumber: string;
        snapshot: SlideVisualizationQuestionSnapshot;
        assetBuffer: Buffer | null;
        logoBuffer?: Buffer | null;
        pageIndex: number;
        totalPages: number;
    }
) {
    fillBackground(doc);

    if (input.assetBuffer) {
        try {
            doc.save();
            doc.image(input.assetBuffer, 0, 0, {
                fit: [PAGE_WIDTH, PAGE_HEIGHT],
                align: "center",
                valign: "center",
            });
            doc.restore();
        } catch {
            // Keep gradient-only fallback if the image cannot be embedded.
        }
    }

    doc.save();
    doc.rect(0, 0, PAGE_WIDTH, PAGE_HEIGHT).fillOpacity(0.28).fill("#020617");
    doc.fillOpacity(1);
    doc.restore();

    drawBrandChrome(doc, {
        instituteName: input.instituteName,
        documentTitle: input.documentTitle,
        footerLine: input.footerLine,
        logoBuffer: input.logoBuffer,
        pageIndex: input.pageIndex,
        totalPages: input.totalPages,
    });

    doc.save();
    doc.roundedRect(PAGE_PADDING, 152, PAGE_WIDTH - PAGE_PADDING * 2, PAGE_HEIGHT - 250, 36).fillOpacity(0.78).fill("#ffffff");
    doc.restore();

    const contentX = PAGE_PADDING + 42;
    const contentWidth = PAGE_WIDTH - PAGE_PADDING * 2 - 84;

    doc.fillColor("#334155").font("Helvetica-Bold").fontSize(16).text(`Question ${input.questionNumber || input.snapshot.number || input.pageIndex + 1}`, contentX, 186, {
        width: contentWidth,
    });

    const layout = resolveQuestionTextLayout(input.snapshot);

    doc.fillColor("#0f172a").font("Helvetica-Bold").fontSize(30).text(layout.primaryQuestion, contentX, 222, {
        width: contentWidth,
        align: "left",
        lineGap: 6,
    });

    const questionHeight = doc.heightOfString(layout.primaryQuestion, {
        width: contentWidth,
        align: "left",
        lineGap: 6,
    });

    let cursorY = 222 + questionHeight + 28;

    if (layout.optionBlock.type === "match") {
        const leftWidth = Math.max(320, Math.floor((contentWidth - 24) / 2));
        const rightWidth = leftWidth;

        doc.fillColor("#475569").font("Helvetica-Bold").fontSize(16).text("Column I", contentX, cursorY, { width: leftWidth });
        doc.text("Column II", contentX + leftWidth + 24, cursorY, { width: rightWidth });
        cursorY += 28;

        doc.fillColor("#1e293b").font("Helvetica").fontSize(20);
        doc.text(layout.optionBlock.leftLines.join("\n"), contentX, cursorY, {
            width: leftWidth,
            lineGap: 8,
        });
        doc.text(layout.optionBlock.rightLines.join("\n"), contentX + leftWidth + 24, cursorY, {
            width: rightWidth,
            lineGap: 8,
        });
    } else {
        doc.fillColor("#1e293b").font("Helvetica").fontSize(22).text(layout.optionBlock.optionLines.join("\n\n"), contentX, cursorY, {
            width: contentWidth,
            lineGap: 3,
        });
    }
}

function drawTopicSlide(
    doc: InstanceType<typeof PDFDocument>,
    input: {
        instituteName: string;
        documentTitle: string;
        footerLine?: string | null;
        snapshot: SlideVisualizationTopicSnapshot;
        assetBuffer: Buffer | null;
        logoBuffer?: Buffer | null;
        pageIndex: number;
        totalPages: number;
    }
) {
    fillBackground(doc);

    if (input.assetBuffer) {
        try {
            doc.save();
            doc.image(input.assetBuffer, 0, 0, {
                fit: [PAGE_WIDTH, PAGE_HEIGHT],
                align: "center",
                valign: "center",
            });
            doc.restore();
        } catch {
            // Keep the fallback teaching layout if the image cannot be embedded.
        }
    }

    doc.save();
    doc.rect(0, 0, PAGE_WIDTH, PAGE_HEIGHT).fillOpacity(0.24).fill("#020617");
    doc.fillOpacity(1);
    doc.restore();

    drawBrandChrome(doc, {
        instituteName: input.instituteName,
        documentTitle: input.documentTitle,
        footerLine: input.footerLine,
        logoBuffer: input.logoBuffer,
        pageIndex: input.pageIndex,
        totalPages: input.totalPages,
    });

    doc.save();
    doc.roundedRect(PAGE_PADDING, 152, 764, PAGE_HEIGHT - 250, 36).fillOpacity(0.84).fill("#ffffff");
    doc.roundedRect(914, 152, PAGE_WIDTH - 914 - PAGE_PADDING, PAGE_HEIGHT - 250, 36).fillOpacity(0.82).fill("#ffffff");
    doc.restore();

    const layout = resolveTopicTextLayout(input.snapshot);

    doc.fillColor("#334155").font("Helvetica-Bold").fontSize(16).text(
        `Topic Slide ${input.snapshot.number || input.pageIndex + 1}`,
        PAGE_PADDING + 38,
        188,
        { width: 640 }
    );

    doc.fillColor("#0f172a").font("Helvetica-Bold").fontSize(30).text(
        layout.title,
        PAGE_PADDING + 38,
        222,
        {
            width: 660,
            lineGap: 6,
        }
    );

    const titleHeight = doc.heightOfString(layout.title, {
        width: 660,
        lineGap: 6,
    });

    let cursorY = 222 + titleHeight + 24;

    doc.fillColor("#475569").font("Helvetica").fontSize(20).text(
        layout.summary,
        PAGE_PADDING + 38,
        cursorY,
        {
            width: 660,
            lineGap: 5,
        }
    );

    cursorY += doc.heightOfString(layout.summary, { width: 660, lineGap: 5 }) + 26;

    if (layout.noteLines.length) {
        doc.fillColor("#0f172a").font("Helvetica-Bold").fontSize(16).text("Notes", PAGE_PADDING + 38, cursorY, {
            width: 220,
        });
        cursorY += 24;
        doc.fillColor("#334155").font("Helvetica").fontSize(17).text(layout.noteLines.join("\n"), PAGE_PADDING + 38, cursorY, {
            width: 660,
            lineGap: 8,
        });
    }

    const bulletX = 952;
    let bulletY = 206;
    layout.bulletPoints.slice(0, 5).forEach((line, index) => {
        const cardHeight = 88;
        doc.save();
        doc.roundedRect(bulletX, bulletY, 520, cardHeight, 24).fillOpacity(0.92).fill("#ffffff");
        doc.restore();

        doc.save();
        doc.circle(bulletX + 34, bulletY + 32, 18).fillOpacity(1).fill("#dbeafe");
        doc.restore();

        doc.fillColor("#0284c7").font("Helvetica-Bold").fontSize(18).text(String(index + 1), bulletX + 28, bulletY + 25, {
            width: 24,
            align: "center",
        });
        doc.fillColor("#0f172a").font("Helvetica-Bold").fontSize(18).text(line, bulletX + 68, bulletY + 16, {
            width: 420,
            lineGap: 4,
        });
        bulletY += cardHeight + 14;
    });

    if (layout.sourcePageLabel) {
        doc.fillColor("#64748b").font("Helvetica-Bold").fontSize(15).text(
            layout.sourcePageLabel,
            bulletX,
            PAGE_HEIGHT - 142,
            {
                width: 520,
                align: "left",
            }
        );
    }
}

function drawFullSlideAsset(
    doc: InstanceType<typeof PDFDocument>,
    input: {
        assetBuffer: Buffer | null;
    }
) {
    fillBackground(doc);

    if (input.assetBuffer) {
        try {
            doc.save();
            doc.image(input.assetBuffer, 0, 0, {
                fit: [PAGE_WIDTH, PAGE_HEIGHT],
                align: "center",
                valign: "center",
            });
            doc.restore();
            return;
        } catch {
            // Fall through to blank background if embed fails.
        }
    }
}

export async function GET(request: NextRequest) {
    try {
        const auth = await enforceToolAccess(["pdf-to-pdf", "media-studio"]);
        const documentId = sanitizeText(request.nextUrl.searchParams.get("documentId"), 80);
        const contentType: SlideVisualizationContentType =
            request.nextUrl.searchParams.get("contentType") === "topic" ? "topic" : "question";

        if (!documentId) {
            return NextResponse.json({ error: "documentId is required." }, { status: 400 });
        }

        const document = await getPdfDocumentById(documentId, auth.organizationId, auth.userId, auth.role);
        if (!document) {
            return NextResponse.json({ error: "Document not found." }, { status: 404 });
        }

        const organization =
            auth.organizationId
                ? await prisma.organization.findUnique({
                      where: { id: auth.organizationId },
                      select: { name: true, logo: true, tagline: true, description: true, audienceSummary: true },
                  })
                : null;

        const rows = await prisma.slideVisualization.findMany({
            where: {
                documentId,
                ...(auth.organizationId ? { organizationId: auth.organizationId } : { userId: auth.userId }),
            },
            orderBy: [{ questionIndex: "asc" }, { createdAt: "asc" }],
        });

        if (!rows.length) {
            return NextResponse.json({ error: "No visualized slides available for export yet." }, { status: 400 });
        }

        const order = buildDocumentSlideOrder(document as { jsonData: Record<string, unknown> }, contentType);
        const rowMap = new Map(rows.map((row) => [row.questionKey, row] as const));
        const orderedRows = order
            .map((entry) => {
                const row = rowMap.get(entry.key);
                if (!row) return null;
                return {
                    row,
                    snapshot:
                        row.questionSnapshot && typeof row.questionSnapshot === "object" && !Array.isArray(row.questionSnapshot)
                            ? (row.questionSnapshot as unknown as SlideVisualizationSnapshot)
                            : entry.snapshot,
                };
            })
            .filter(Boolean) as Array<{
            row: (typeof rows)[number];
            snapshot: SlideVisualizationSnapshot;
        }>;

        if (!orderedRows.length) {
            return NextResponse.json({ error: "Saved slides could not be aligned to the current document order." }, { status: 400 });
        }

        const instituteName =
            sanitizeText((document.jsonData as Record<string, unknown>).instituteName, 160) ||
            sanitizeText(organization?.name, 160) ||
            "Nexora Institute";
        const footerLine = resolveInstituteFooterLine({
            tagline: organization?.tagline,
            description: organization?.description,
            audienceSummary: organization?.audienceSummary,
            instituteName,
        });
        const logoBuffer = await loadAssetBuffer(organization?.logo || null);

        const doc = new PDFDocument({
            autoFirstPage: false,
            size: [PAGE_WIDTH, PAGE_HEIGHT],
            margin: 0,
        });
        const chunks: Buffer[] = [];
        const pdfBuffer = await new Promise<Buffer>((resolve, reject) => {
            doc.on("data", (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
            doc.on("end", () => resolve(Buffer.concat(chunks)));
            doc.on("error", reject);

            void (async () => {
                for (let index = 0; index < orderedRows.length; index += 1) {
                    const item = orderedRows[index];
                    doc.addPage({ size: [PAGE_WIDTH, PAGE_HEIGHT], margin: 0 });
                    const assetBuffer = await loadAssetBuffer(item.row.assetUrl);
                    const useFullSlideAsset =
                        item.row.status === "generated_svg_slide" ||
                        item.row.status === "fallback_svg_slide" ||
                        item.row.status === "generated_image_slide" ||
                        item.row.status === "fallback_image_slide" ||
                        item.row.imageModel === "svg_slide" ||
                        item.row.imageModel === "deterministic_svg_slide" ||
                        item.row.imageModel === "nexen_2" ||
                        item.row.imageModel === "nexen" ||
                        item.row.imageModel === "deterministic_visual_slide";

                    if (useFullSlideAsset && assetBuffer) {
                        drawFullSlideAsset(doc, { assetBuffer });
                    } else {
                        if (isTopicSnapshot(item.snapshot)) {
                            drawTopicSlide(doc, {
                                instituteName,
                                documentTitle: sanitizeText(document.title, 180),
                                footerLine,
                                snapshot: item.snapshot,
                                assetBuffer,
                                logoBuffer,
                                pageIndex: index,
                                totalPages: orderedRows.length,
                            });
                        } else {
                            drawQuestionSlide(doc, {
                                instituteName,
                                documentTitle: sanitizeText(document.title, 180),
                                footerLine,
                                questionNumber: item.row.questionNumber || item.snapshot.number,
                                snapshot: item.snapshot,
                                assetBuffer,
                                logoBuffer,
                                pageIndex: index,
                                totalPages: orderedRows.length,
                            });
                        }
                    }
                }
                doc.end();
            })().catch(reject);
        });

        const filename = `${sanitizeText(document.title || "visualized-slides", 80).replace(/[\\/:*?"<>|]+/g, "-")}-visualized-slides.pdf`;
        return new NextResponse(new Uint8Array(pdfBuffer), {
            status: 200,
            headers: {
                "Content-Type": "application/pdf",
                "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
            },
        });
    } catch (error) {
        if (error instanceof Response) return error;
        console.error("Failed to export slide visualizations PDF:", error);
        return NextResponse.json(
            {
                error: error instanceof Error ? error.message : "Failed to export visualized slides PDF.",
            },
            { status: 500 }
        );
    }
}
