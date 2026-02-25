import crypto from "crypto";
import { Prisma, PdfDocument } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { withDatabaseFallback } from "@/lib/services/database-resilience";
import {
    deleteOfflinePdfDocumentById,
    getOfflinePdfDocumentById,
    getOfflinePdfStats,
    listOfflinePdfDocuments,
    upsertOfflinePdfDocument,
} from "@/lib/services/offline-pdf-document-store";
import { NormalizedPdfInput } from "@/lib/pdf-validation";

export interface DocumentListOptions {
    limit: number;
    offset: number;
    minimal: boolean;
}

export type PdfDocumentListRecord = Pick<
    PdfDocument,
    "id" | "title" | "subject" | "date" | "jsonData" | "createdAt" | "updatedAt"
>;

export function normalizePagination(
    limitRaw: unknown,
    offsetRaw: unknown
): { limit: number; offset: number } {
    const parsedLimit = Number.parseInt(String(limitRaw ?? "50"), 10);
    const parsedOffset = Number.parseInt(String(offsetRaw ?? "0"), 10);

    const limit = Number.isFinite(parsedLimit) ? Math.min(Math.max(parsedLimit, 1), 200) : 50;
    const offset = Number.isFinite(parsedOffset) ? Math.max(parsedOffset, 0) : 0;
    return { limit, offset };
}

export function buildPdfContentHash(input: NormalizedPdfInput): string {
    const hashable = {
        title: input.title,
        subject: input.subject,
        date: input.date,
        instituteName: input.instituteName,
        templateId: input.templateId,
        optionDisplayOrder: input.optionDisplayOrder,
        questions: input.questions,
        sourceImages: input.sourceImages,
    };

    return crypto.createHash("sha256").update(JSON.stringify(hashable)).digest("hex");
}

type PersistOptions = {
    rawPayload: Record<string, unknown>;
    documentId?: string | null;
};

export async function persistPdfDocument(
    input: NormalizedPdfInput,
    options: PersistOptions
): Promise<PdfDocument> {
    const contentHash = buildPdfContentHash(input);
    const jsonData: Prisma.JsonObject = {
        ...options.rawPayload,
        title: input.title,
        subject: input.subject,
        date: input.date,
        instituteName: input.instituteName,
        templateId: input.templateId,
        optionDisplayOrder: input.optionDisplayOrder,
        questions: input.questions as unknown as Prisma.JsonArray,
        sourceImages: (input.sourceImages || []) as unknown as Prisma.JsonArray,
        _meta: {
            schemaVersion: 2,
            contentHash,
            normalizedAt: new Date().toISOString(),
        },
    };

    return withDatabaseFallback(
        async () => {
            if (options.documentId && !options.documentId.startsWith("offline_")) {
                try {
                    return prisma.pdfDocument.update({
                        where: { id: options.documentId },
                        data: {
                            title: input.title,
                            subject: input.subject,
                            date: input.date,
                            jsonData,
                        },
                    });
                } catch (error) {
                    if (
                        error instanceof Prisma.PrismaClientKnownRequestError &&
                        error.code === "P2025"
                    ) {
                        // If requested document id is missing on DB, promote it to create flow.
                    } else {
                        throw error;
                    }
                }
            }

            return prisma.pdfDocument.create({
                data: {
                    title: input.title,
                    subject: input.subject,
                    date: input.date,
                    jsonData,
                },
            });
        },
        () =>
            upsertOfflinePdfDocument({
                title: input.title,
                subject: input.subject,
                date: input.date,
                jsonData,
                documentId: options.documentId,
            })
    );
}

export async function listPdfDocuments(
    options: DocumentListOptions
): Promise<PdfDocumentListRecord[]> {
    return withDatabaseFallback(
        () =>
            prisma.pdfDocument.findMany({
                orderBy: { createdAt: "desc" },
                take: options.limit,
                skip: options.offset,
                select: {
                    id: true,
                    title: true,
                    subject: true,
                    date: true,
                    createdAt: true,
                    updatedAt: true,
                    jsonData: true,
                },
            }),
        () => listOfflinePdfDocuments(options)
    );
}

export async function getPdfDocumentById(id: string) {
    return withDatabaseFallback(
        () =>
            prisma.pdfDocument.findUnique({
                where: { id },
            }),
        () => getOfflinePdfDocumentById(id)
    );
}

export async function deletePdfDocumentById(id: string) {
    return withDatabaseFallback(
        () =>
            prisma.pdfDocument.delete({
                where: { id },
            }),
        async () => {
            const deleted = await deleteOfflinePdfDocumentById(id);
            if (!deleted) {
                throw new Error("Document not found");
            }

            const now = new Date();
            return {
                id,
                title: "Deleted document",
                subject: "Deleted document",
                date: now.toLocaleDateString("en-GB"),
                jsonData: {},
                createdAt: now,
                updatedAt: now,
            } satisfies PdfDocument;
        }
    );
}

export async function getPdfDashboardStats() {
    return withDatabaseFallback(
        async () => {
            const startOfToday = new Date();
            startOfToday.setHours(0, 0, 0, 0);

            const [totalDocs, todayDocs] = await Promise.all([
                prisma.pdfDocument.count(),
                prisma.pdfDocument.count({
                    where: {
                        createdAt: {
                            gte: startOfToday,
                        },
                    },
                }),
            ]);

            return { totalDocs, todayDocs };
        },
        () => getOfflinePdfStats()
    );
}
