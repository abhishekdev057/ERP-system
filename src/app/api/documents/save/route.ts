import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { withDatabaseFallback } from "@/lib/services/database-resilience";
import { upsertOfflinePdfDocument } from "@/lib/services/offline-pdf-document-store";
import { prisma } from "@/lib/prisma";
import { enforceToolAccess } from "@/lib/api-auth";
import { scheduleKnowledgeIndexRefresh } from "@/lib/knowledge-index";
import { resolveAssignedUserIds, withAssignedUserIds } from "@/lib/document-metadata";
import {
    buildWorkspacePayloadHash,
    invalidatePdfDocumentCaches,
    readStoredContentHash,
} from "@/lib/services/pdf-document-service";

export const dynamic = "force-dynamic";

/**
 * POST /api/documents/save
 * Saves a PDF-to-PDF workspace as metadata only — no PDF is compiled.
 * This allows saving incomplete workspaces where no questions have been extracted yet.
 */
export async function POST(request: NextRequest) {
    try {
        const auth = await enforceToolAccess("pdf-to-pdf");
        const organizationId = auth.organizationId;

        const body = (await request.json()) as Record<string, unknown>;

        const title =
            typeof body.title === "string" && body.title.trim()
                ? body.title.trim().slice(0, 160)
                : "Untitled PDF Workspace";

        const subject = (typeof body.subject === "string" && body.subject.trim())
            ? body.subject.trim().slice(0, 120)
            : title;

        const date =
            typeof body.date === "string" && body.date.trim()
                ? body.date.trim().slice(0, 60)
                : new Date().toLocaleDateString("en-GB");

        const documentId =
            typeof body.documentId === "string" && body.documentId.trim()
                ? body.documentId.trim()
                : undefined;

        if (auth.role === "MEMBER" && !documentId) {
            return NextResponse.json(
                { error: "Members can only update documents assigned by admin." },
                { status: 403 }
            );
        }

        // Strip any base64 image paths before saving, but preserve original image references.
        const rawSourceImages = Array.isArray(body.sourceImages) ? body.sourceImages : [];
        const safeSourceImages = rawSourceImages.map((img: any) => {
            const rawImagePath = typeof img?.imagePath === "string" ? img.imagePath.trim() : "";
            const rawOriginalImagePath =
                typeof img?.originalImagePath === "string" ? img.originalImagePath.trim() : "";

            const originalImagePath = rawOriginalImagePath.startsWith("data:")
                ? ""
                : rawOriginalImagePath;
            const imagePath = rawImagePath.startsWith("data:")
                ? originalImagePath || ""
                : rawImagePath;

            return {
                ...img,
                imagePath,
                originalImagePath,
            };
        });

        let jsonData: Prisma.JsonObject = {
            ...(body as Prisma.JsonObject),
            title,
            subject,
            date,
            sourceImages: safeSourceImages as Prisma.JsonArray,
            sourceType: "PDF",
            _meta: {
                schemaVersion: 2,
                saveMode: "metadata-only",
            },
        };
        const contentHash = buildWorkspacePayloadHash(jsonData);
        jsonData = {
            ...jsonData,
            _meta: {
                ...((jsonData._meta as Prisma.JsonObject | undefined) ?? {}),
                contentHash,
                savedAt: new Date().toISOString(),
            },
        };
        const nextAssignedUserIds = resolveAssignedUserIds(jsonData);
        const record = await withDatabaseFallback(
            async () => {
                if (documentId && !documentId.startsWith("offline_")) {
                    try {
                        const existing = await prisma.pdfDocument.findUnique({
                            where: { id: documentId },
                            select: {
                                id: true,
                                title: true,
                                subject: true,
                                date: true,
                                jsonData: true,
                                assignedUserIds: true,
                                organizationId: true,
                                userId: true,
                            },
                        });
                        if (existing && existing.organizationId !== organizationId) {
                            throw new Error("Unauthorized");
                        }
                        if (existing && existing.userId && existing.userId !== auth.userId) {
                            // Basic safeguard, technically service layer handles this but good to be explicit
                        }
                        if (existing) {
                            const existingAssignments = resolveAssignedUserIds(
                                existing.jsonData,
                                existing.assignedUserIds
                            );
                            if (auth.role === "MEMBER") {
                                if (!existingAssignments.includes(auth.userId)) {
                                    throw new Error("Unauthorized");
                                }
                            }
                            if (existingAssignments.length > 0) {
                                jsonData = withAssignedUserIds(jsonData, existingAssignments) as Prisma.JsonObject;
                            }
                            const existingHash = readStoredContentHash(existing.jsonData);
                            if (
                                existingHash === contentHash &&
                                existing.title === title &&
                                existing.subject === subject &&
                                existing.date === date
                            ) {
                                return existing;
                            }
                        }
                        const updated = await prisma.pdfDocument.update({
                            where: { id: documentId },
                            data: {
                                title,
                                subject,
                                date,
                                jsonData,
                                assignedUserIds: resolveAssignedUserIds(
                                    jsonData,
                                    nextAssignedUserIds
                                ),
                            },
                        });
                        invalidatePdfDocumentCaches();
                        return updated;
                    } catch (error) {
                        const isMissingRecord =
                            error instanceof Prisma.PrismaClientKnownRequestError &&
                            error.code === "P2025";
                        if (!isMissingRecord) {
                            throw error;
                        }
                        // Fall through to create if update target does not exist.
                    }
                }
                const created = await prisma.pdfDocument.create({
                    data: {
                        title,
                        subject,
                        date,
                        jsonData,
                        assignedUserIds: nextAssignedUserIds,
                        organizationId,
                        userId: auth.userId,
                    },
                });
                invalidatePdfDocumentCaches();
                return created;
            },
            () =>
                upsertOfflinePdfDocument({
                    title,
                    subject,
                    date,
                    jsonData,
                    documentId,
                })
        );

        if (organizationId) {
            void scheduleKnowledgeIndexRefresh(organizationId).catch((error) => {
                console.warn("[documents/save] Failed to refresh knowledge index:", error);
            });
        }

        return NextResponse.json({ documentId: record.id }, { status: 200 });
    } catch (error) {
        console.error("Document save error:", error);
        const message = error instanceof Error ? error.message : String(error);
        if (/unauthorized/i.test(message)) {
            return NextResponse.json(
                { error: "Unauthorized" },
                { status: 403 }
            );
        }
        return NextResponse.json(
            { error: "Failed to save document", details: message },
            { status: 500 }
        );
    }
}
