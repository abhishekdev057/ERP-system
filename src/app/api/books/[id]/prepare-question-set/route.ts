import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { enforceToolAccess } from "@/lib/api-auth";
import { scheduleKnowledgeIndexRefresh } from "@/lib/knowledge-index";
import { persistPdfDocument } from "@/lib/services/pdf-document-service";
import { validateAndNormalizePdfInput } from "@/lib/pdf-validation";

export const dynamic = "force-dynamic";

function normalizeName(value: unknown, fallback: string): string {
    const normalized = String(value ?? "").replace(/\s+/g, " ").trim();
    return normalized ? normalized.slice(0, 160) : fallback;
}

export async function POST(
    request: NextRequest,
    { params }: { params: { id: string } }
) {
    try {
        const auth = await enforceToolAccess(["library", "pdf-to-pdf"]);

        const book = await prisma.book.findUnique({
            where: { id: params.id },
            select: {
                id: true,
                title: true,
                organizationId: true,
                category: true,
                classLevel: true,
            },
        });

        if (!book || book.organizationId !== auth.organizationId) {
            return NextResponse.json({ error: "Book not found." }, { status: 404 });
        }

        const body = (await request.json()) as Record<string, unknown>;
        const setName = normalizeName(body.name, `${book.title} Question Set`);
        const questions = Array.isArray(body.questions) ? body.questions : [];
        const selections = Array.isArray(body.selections) ? body.selections : [];
        const selectionCount = selections.length;
        const sourceImages = Array.isArray(body.sourceImages) ? body.sourceImages : [];

        const organization = auth.organizationId
            ? await prisma.organization.findUnique({
                  where: { id: auth.organizationId },
                  select: { name: true },
              })
            : null;

        const payload = {
            title: setName,
            subject: book.title,
            date: new Date().toLocaleDateString("en-GB"),
            instituteName: organization?.name || "",
            templateId: "board",
            sourceType: "BOOK_SELECTION_SET",
            sourceBookId: book.id,
            sourceBookTitle: book.title,
            sourceBookCategory: book.category,
            sourceBookClassLevel: book.classLevel,
            selectionCount,
            selections,
            questions,
            sourceImages,
        };

        const validation = validateAndNormalizePdfInput(payload);
        if (!validation.ok) {
            return NextResponse.json(
                {
                    error: validation.error,
                    issues: validation.issues,
                },
                { status: 400 }
            );
        }

        const record = await persistPdfDocument(validation.value, {
            rawPayload: payload,
            organizationId: auth.organizationId,
            userId: auth.userId,
        });

        if (auth.organizationId) {
            void scheduleKnowledgeIndexRefresh(auth.organizationId).catch((error) => {
                console.warn("[books/prepare-question-set] Failed to refresh knowledge index:", error);
            });
        }

        return NextResponse.json({
            documentId: record.id,
            title: setName,
            extractorUrl: `/content-studio/extractor?load=${encodeURIComponent(record.id)}`,
        });
    } catch (error) {
        console.error("Prepare book question set error:", error);
        return NextResponse.json(
            {
                error:
                    error instanceof Error
                        ? error.message
                        : "Failed to prepare question set from book selections.",
            },
            { status: 500 }
        );
    }
}
