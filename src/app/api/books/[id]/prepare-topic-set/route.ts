import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { enforceToolAccess } from "@/lib/api-auth";
import { scheduleKnowledgeIndexRefresh } from "@/lib/knowledge-index";
import { getBookReaderExtractedPages } from "@/lib/book-reader-state";
import {
    buildWorkspacePayloadHash,
    invalidatePdfDocumentCaches,
} from "@/lib/services/pdf-document-service";

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
                readerState: true,
            },
        });

        if (!book || book.organizationId !== auth.organizationId) {
            return NextResponse.json({ error: "Book not found." }, { status: 404 });
        }

        const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
        const setName = normalizeName(body.name, `${book.title} Topic Deck`);
        const sourcePages = getBookReaderExtractedPages(book.readerState)
            .filter((page) => String(page.text || "").trim())
            .map((page) => ({
                pageNumber: page.pageNumber,
                text: String(page.text || "").trim().slice(0, 8_000),
                preview: String(page.preview || "").trim().slice(0, 220),
                questionCount: page.questionCount,
                status: page.status,
            }));

        if (!sourcePages.length) {
            return NextResponse.json(
                {
                    error: "Extract at least one page first so topic slides have source text.",
                },
                { status: 400 }
            );
        }

        const organization = auth.organizationId
            ? await prisma.organization.findUnique({
                  where: { id: auth.organizationId },
                  select: { name: true },
              })
            : null;

        let jsonData: Prisma.JsonObject = {
            title: setName,
            subject: book.title,
            date: new Date().toLocaleDateString("en-GB"),
            instituteName: organization?.name || "",
            sourceType: "BOOK_TOPIC_SOURCE",
            sourceBookId: book.id,
            sourceBookTitle: book.title,
            sourceBookCategory: book.category,
            sourceBookClassLevel: book.classLevel,
            pageCount: sourcePages.length,
            topicSourcePages: sourcePages as unknown as Prisma.JsonArray,
            topicSlides: [] as unknown as Prisma.JsonArray,
            _meta: {
                schemaVersion: 2,
                createdFrom: "book-topic-source",
                createdAt: new Date().toISOString(),
            },
        };

        const contentHash = buildWorkspacePayloadHash(jsonData);
        jsonData = {
            ...jsonData,
            _meta: {
                ...((jsonData._meta as Prisma.JsonObject | undefined) ?? {}),
                contentHash,
            },
        };

        const record = await prisma.pdfDocument.create({
            data: {
                title: setName,
                subject: book.title,
                date: new Date().toLocaleDateString("en-GB"),
                jsonData,
                assignedUserIds: [],
                organizationId: auth.organizationId,
                userId: auth.userId,
            },
        });
        invalidatePdfDocumentCaches();

        if (auth.organizationId) {
            void scheduleKnowledgeIndexRefresh(auth.organizationId).catch((error) => {
                console.warn("[books/prepare-topic-set] Failed to refresh knowledge index:", error);
            });
        }

        return NextResponse.json({
            documentId: record.id,
            title: setName,
            topicSourcePageCount: sourcePages.length,
            visualizeUrl: `/content-studio/slides/visualize?documentId=${encodeURIComponent(record.id)}&mode=topic`,
        });
    } catch (error) {
        console.error("Prepare book topic set error:", error);
        return NextResponse.json(
            {
                error:
                    error instanceof Error
                        ? error.message
                        : "Failed to prepare topic slide source from extracted book pages.",
            },
            { status: 500 }
        );
    }
}
