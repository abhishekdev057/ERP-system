import crypto from "crypto";
import { Prisma, PdfDocument } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { NormalizedPdfInput } from "@/lib/pdf-validation";

export interface DocumentListOptions {
    limit: number;
    offset: number;
    minimal: boolean;
}

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

    if (options.documentId) {
        return prisma.pdfDocument.update({
            where: { id: options.documentId },
            data: {
                title: input.title,
                subject: input.subject,
                date: input.date,
                jsonData,
            },
        });
    }

    return prisma.pdfDocument.create({
        data: {
            title: input.title,
            subject: input.subject,
            date: input.date,
            jsonData,
        },
    });
}

export async function listPdfDocuments(options: DocumentListOptions) {
    return prisma.pdfDocument.findMany({
        orderBy: { createdAt: "desc" },
        take: options.limit,
        skip: options.offset,
        select: options.minimal
            ? {
                  id: true,
                  title: true,
                  subject: true,
                  date: true,
                  createdAt: true,
                  updatedAt: true,
                  jsonData: true,
              }
            : undefined,
    });
}

export async function getPdfDocumentById(id: string) {
    return prisma.pdfDocument.findUnique({
        where: { id },
    });
}

export async function deletePdfDocumentById(id: string) {
    return prisma.pdfDocument.delete({
        where: { id },
    });
}

export async function getPdfDashboardStats() {
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
}
