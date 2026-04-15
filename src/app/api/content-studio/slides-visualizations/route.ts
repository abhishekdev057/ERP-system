import { NextRequest, NextResponse } from "next/server";
import { enforceToolAccess } from "@/lib/api-auth";
import { getGeminiUsageSummary } from "@/lib/gemini-usage";
import { prisma } from "@/lib/prisma";
import { getPdfDocumentById } from "@/lib/services/pdf-document-service";

export const dynamic = "force-dynamic";

function sanitizeText(value: unknown, maxLength = 200) {
    return String(value || "")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, maxLength);
}

export async function GET(request: NextRequest) {
    try {
        const auth = await enforceToolAccess(["pdf-to-pdf", "media-studio"]);
        const documentId = sanitizeText(request.nextUrl.searchParams.get("documentId"), 80);

        if (!documentId) {
            return NextResponse.json({ error: "documentId is required." }, { status: 400 });
        }

        const document = await getPdfDocumentById(documentId, auth.organizationId, auth.userId, auth.role);
        if (!document) {
            return NextResponse.json({ error: "Document not found." }, { status: 404 });
        }

        const [rows, usage] = await Promise.all([
            prisma.slideVisualization.findMany({
                where: {
                    documentId,
                    ...(auth.organizationId ? { organizationId: auth.organizationId } : { userId: auth.userId }),
                },
                orderBy: [{ questionIndex: "asc" }, { createdAt: "asc" }],
            }),
            getGeminiUsageSummary().catch(() => null),
        ]);

        return NextResponse.json({
            success: true,
            document: {
                id: document.id,
                title: document.title,
                subject: document.subject,
                date: document.date,
            },
            items: rows.map((row) => ({
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
            })),
            usage,
        });
    } catch (error) {
        if (error instanceof Response) return error;
        console.error("Failed to load slide visualizations:", error);
        return NextResponse.json(
            {
                error: error instanceof Error ? error.message : "Failed to load slide visualizations.",
            },
            { status: 500 }
        );
    }
}

export async function POST(request: NextRequest) {
    try {
        const auth = await enforceToolAccess(["pdf-to-pdf", "media-studio"]);
        const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;

        const documentId = sanitizeText(body.documentId, 80);
        const questionKey = sanitizeText(body.questionKey, 200);
        const questionNumber = sanitizeText(body.questionNumber, 40);
        const questionPreview = sanitizeText(body.questionPreview, 220);
        const prompt = sanitizeText(body.prompt, 5000);
        const assetUrl = sanitizeText(body.assetUrl, 400) || null;
        const generatedMediaId = sanitizeText(body.generatedMediaId, 80) || null;
        const status = sanitizeText(body.status, 40) || "generated";
        const imageModel = sanitizeText(body.imageModel, 80) || null;
        const questionIndex = Number.isFinite(Number(body.questionIndex)) ? Number(body.questionIndex) : -1;
        const questionSnapshot =
            body.questionSnapshot && typeof body.questionSnapshot === "object" && !Array.isArray(body.questionSnapshot)
                ? body.questionSnapshot
                : null;

        if (!documentId || !questionKey || questionIndex < 0 || !questionSnapshot || !prompt) {
            return NextResponse.json(
                { error: "documentId, questionKey, questionIndex, questionSnapshot, and prompt are required." },
                { status: 400 }
            );
        }

        const document = await getPdfDocumentById(documentId, auth.organizationId, auth.userId, auth.role);
        if (!document) {
            return NextResponse.json({ error: "Document not found." }, { status: 404 });
        }

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
                questionIndex,
                questionNumber,
                questionPreview,
                questionSnapshot: questionSnapshot as object,
                prompt,
                generatedMediaId,
                assetUrl,
                status,
                imageModel,
            },
            update: {
                questionIndex,
                questionNumber,
                questionPreview,
                questionSnapshot: questionSnapshot as object,
                prompt,
                generatedMediaId,
                assetUrl,
                status,
                imageModel,
            },
        });

        return NextResponse.json({
            success: true,
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
        });
    } catch (error) {
        if (error instanceof Response) return error;
        console.error("Failed to save slide visualization:", error);
        return NextResponse.json(
            {
                error: error instanceof Error ? error.message : "Failed to save slide visualization.",
            },
            { status: 500 }
        );
    }
}
