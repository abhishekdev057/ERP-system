import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { enforceToolAccess } from "@/lib/api-auth";
import { scheduleKnowledgeIndexRefresh } from "@/lib/knowledge-index";
import { prisma } from "@/lib/prisma";
import {
    buildWorkspacePayloadHash,
    getPdfDocumentById,
    invalidatePdfDocumentCaches,
} from "@/lib/services/pdf-document-service";
import {
    buildTopicSlidesFromSourcePages,
    extractTopicSlidesFromDocument,
    extractTopicSourcePagesFromDocument,
} from "@/lib/slide-topics";

export const dynamic = "force-dynamic";

function sanitizeText(value: unknown, maxLength = 120) {
    return String(value || "")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, maxLength);
}

export async function POST(request: NextRequest) {
    try {
        const auth = await enforceToolAccess(["pdf-to-pdf", "media-studio"]);
        const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;

        const documentId = sanitizeText(body.documentId, 80);
        const force = Boolean(body.force);

        if (!documentId) {
            return NextResponse.json({ error: "documentId is required." }, { status: 400 });
        }

        const document = await getPdfDocumentById(documentId, auth.organizationId, auth.userId, auth.role);
        if (!document) {
            return NextResponse.json({ error: "Document not found." }, { status: 404 });
        }

        const existingSlides = extractTopicSlidesFromDocument(document.jsonData);
        if (existingSlides.length > 0 && !force) {
            return NextResponse.json({
                success: true,
                topicSlides: existingSlides,
                generated: false,
            });
        }

        const sourcePages = extractTopicSourcePagesFromDocument(document.jsonData);
        if (!sourcePages.length) {
            return NextResponse.json(
                {
                    error: "This document does not have topic-source pages yet.",
                },
                { status: 400 }
            );
        }

        const topicSlides = buildTopicSlidesFromSourcePages(sourcePages);
        if (!topicSlides.length) {
            return NextResponse.json(
                {
                    error: "Topic chunks could not be created from the available source pages.",
                },
                { status: 400 }
            );
        }

        const currentPayload =
            document.jsonData && typeof document.jsonData === "object" && !Array.isArray(document.jsonData)
                ? ({ ...(document.jsonData as Record<string, unknown>) } as Record<string, unknown>)
                : {};

        let nextPayload: Record<string, unknown> = {
            ...currentPayload,
            topicSlides,
            topicSlidesGeneratedAt: new Date().toISOString(),
        };
        nextPayload = {
            ...nextPayload,
            _meta: {
                ...((nextPayload._meta as Record<string, unknown> | undefined) ?? {}),
                contentHash: buildWorkspacePayloadHash(nextPayload),
                topicSlidesGeneratedAt: new Date().toISOString(),
            },
        };

        await prisma.pdfDocument.update({
            where: { id: documentId },
            data: {
                jsonData: nextPayload as Prisma.InputJsonValue,
            },
        });
        invalidatePdfDocumentCaches();

        if (auth.organizationId) {
            void scheduleKnowledgeIndexRefresh(auth.organizationId).catch((error) => {
                console.warn("[slides/topic-chunks] Failed to refresh knowledge index:", error);
            });
        }

        return NextResponse.json({
            success: true,
            generated: true,
            topicSlides,
        });
    } catch (error) {
        if (error instanceof Response) return error;
        console.error("Failed to generate topic chunks:", error);
        return NextResponse.json(
            {
                error: error instanceof Error ? error.message : "Failed to generate topic chunks.",
            },
            { status: 500 }
        );
    }
}
