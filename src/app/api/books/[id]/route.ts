import { unlink } from "fs/promises";
import path from "path";
import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import {
    appendPreparedSetToReaderState,
    computeBookReaderStats,
    upsertBookReaderPageState,
} from "@/lib/book-reader-state";

export const dynamic = "force-dynamic";

export async function GET(
    request: NextRequest,
    { params }: { params: { id: string } }
) {
    try {
        const session = await getServerSession(authOptions);
        const organizationId = session?.user?.organizationId || null;

        const book = await prisma.book.findUnique({
            where: { id: params.id, organizationId: organizationId || undefined },
        });

        if (!book) {
            return NextResponse.json({ error: "Book not found" }, { status: 404 });
        }

        return NextResponse.json({
            book: {
                ...book,
                workspaceStats: computeBookReaderStats(book.readerState, book.pageCount),
            },
        });
    } catch (error) {
        console.error("Book fetch error:", error);
        return NextResponse.json({ error: "Failed to fetch book" }, { status: 500 });
    }
}

export async function PATCH(
    request: NextRequest,
    { params }: { params: { id: string } }
) {
    try {
        const session = await getServerSession(authOptions);
        const organizationId = session?.user?.organizationId || null;

        const book = await prisma.book.findUnique({
            where: { id: params.id },
            select: {
                id: true,
                organizationId: true,
                pageCount: true,
                readerState: true,
            },
        });

        if (!book || book.organizationId !== organizationId) {
            return NextResponse.json({ error: "Book not found" }, { status: 404 });
        }

        const body = (await request.json()) as Record<string, unknown>;
        const action = String(body.action || "").trim();
        let nextReaderState: Prisma.InputJsonValue =
            (book.readerState as Prisma.InputJsonValue | null) ??
            ({} as Prisma.InputJsonValue);

        if (action === "upsertPageState") {
            const pageNumber = Number.parseInt(String(body.pageNumber || "0"), 10);
            const status = body.status === "ocr" ? "ocr" : "searchable";
            const questionCount = Number.parseInt(String(body.questionCount || "0"), 10);
            const preview = typeof body.preview === "string" ? body.preview : "";
            const text = typeof body.text === "string" ? body.text : "";

            if (!Number.isFinite(pageNumber) || pageNumber < 1) {
                return NextResponse.json({ error: "A valid pageNumber is required." }, { status: 400 });
            }

            nextReaderState = upsertBookReaderPageState(book.readerState, {
                pageNumber,
                status,
                questionCount,
                preview,
                text,
            }) as unknown as Prisma.InputJsonValue;
        } else if (action === "appendPreparedSet") {
            const extractorDocumentId = String(body.extractorDocumentId || "").trim();
            const name = String(body.name || "").trim();
            const questionCount = Number.parseInt(String(body.questionCount || "0"), 10);

            if (!extractorDocumentId) {
                return NextResponse.json(
                    { error: "extractorDocumentId is required." },
                    { status: 400 }
                );
            }

            nextReaderState = appendPreparedSetToReaderState(book.readerState, {
                extractorDocumentId,
                name,
                questionCount,
            }) as unknown as Prisma.InputJsonValue;
        } else if (action === "syncPageCount") {
            const pageCount = Number.parseInt(String(body.pageCount || "0"), 10);
            if (!Number.isFinite(pageCount) || pageCount < 1) {
                return NextResponse.json({ error: "A valid pageCount is required." }, { status: 400 });
            }

            const updated = await prisma.book.update({
                where: { id: params.id },
                data: {
                    pageCount,
                },
            });

            return NextResponse.json({
                success: true,
                readerState: updated.readerState,
                workspaceStats: computeBookReaderStats(updated.readerState, updated.pageCount),
                pageCount: updated.pageCount,
            });
        } else {
            return NextResponse.json({ error: "Unsupported action." }, { status: 400 });
        }

        const updated = await prisma.book.update({
            where: { id: params.id },
            data: {
                readerState: nextReaderState as Prisma.InputJsonValue,
            },
        });

        return NextResponse.json({
            success: true,
            readerState: updated.readerState,
            workspaceStats: computeBookReaderStats(updated.readerState, updated.pageCount),
        });
    } catch (error) {
        console.error("Book reader state update error:", error);
        return NextResponse.json(
            { error: "Failed to update book reader state." },
            { status: 500 }
        );
    }
}

export async function DELETE(
    request: NextRequest,
    { params }: { params: { id: string } }
) {
    try {
        const session = await getServerSession(authOptions);
        const organizationId = session?.user?.organizationId || null;

        const book = await prisma.book.findUnique({
            where: { id: params.id },
        });

        if (!book || book.organizationId !== organizationId) {
            return NextResponse.json({ error: "Book not found" }, { status: 404 });
        }

        try {
            const filePath = path.join(process.cwd(), "public", "uploads", "books", book.fileName);
            await unlink(filePath);
        } catch (error) {
            console.warn("Failed to delete file from storage:", error);
        }

        await prisma.book.delete({
            where: { id: params.id },
        });

        return NextResponse.json({ success: true });
    } catch (error) {
        console.error("Book deletion error:", error);
        return NextResponse.json({ error: "Failed to delete book" }, { status: 500 });
    }
}
