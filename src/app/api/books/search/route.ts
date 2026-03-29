import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
    buildBookWhere,
    normalizeClassLevel,
    normalizeSearchQuery,
} from "@/lib/services/book-service";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { computeBookReaderStats } from "@/lib/book-reader-state";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
    try {
        const session = await getServerSession(authOptions);
        const organizationId = session?.user?.organizationId || null;

        const body = (await request.json()) as {
            query?: unknown;
            category?: string;
            classLevel?: unknown;
        };

        const query = normalizeSearchQuery(body.query);
        if (!query) {
            return NextResponse.json({ error: "Search query is required" }, { status: 400 });
        }

        const category = body.category || null;
        const classLevel = normalizeClassLevel(body.classLevel);
        const baseWhere = buildBookWhere({ category, classLevel });
        const where = { ...baseWhere, organizationId: organizationId || null };

        const books = await prisma.book.findMany({
            where: {
                ...where,
                OR: [
                    { extractedText: { contains: query, mode: "insensitive" } },
                    { title: { contains: query, mode: "insensitive" } },
                    { description: { contains: query, mode: "insensitive" } },
                ],
            },
            select: {
                id: true,
                title: true,
                description: true,
                fileName: true,
                filePath: true,
                fileSize: true,
                category: true,
                classLevel: true,
                pageCount: true,
                readerState: true,
                uploadedAt: true,
            },
            orderBy: { uploadedAt: "desc" },
            take: 80,
        });

        return NextResponse.json({
            books: books.map((book) => ({
                ...book,
                workspaceStats: computeBookReaderStats(book.readerState, book.pageCount),
            })),
            query,
        });
    } catch (error) {
        console.error("Search error:", error);
        return NextResponse.json({ error: "Search failed" }, { status: 500 });
    }
}
