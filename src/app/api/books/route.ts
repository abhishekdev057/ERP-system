import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
    buildBookWhere,
    normalizeBookPagination,
    normalizeClassLevel,
} from "@/lib/services/book-service";
import { enforceToolAccess } from "@/lib/api-auth";
import { computeBookReaderStats } from "@/lib/book-reader-state";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
    try {
        const auth = await enforceToolAccess("library");
        const organizationId = auth.organizationId;

        const searchParams = request.nextUrl.searchParams;
        const category = searchParams.get("category");
        const classLevel = normalizeClassLevel(searchParams.get("classLevel"));

        const { page, limit, skip } = normalizeBookPagination(
            searchParams.get("page"),
            searchParams.get("limit")
        );

        const baseWhere = buildBookWhere({ category, classLevel });
        const where = organizationId
            ? {
                ...baseWhere,
                OR: [{ organizationId }, { organizationId: null }],
            }
            : { ...baseWhere, organizationId: null };

        const [books, total] = await Promise.all([
            prisma.book.findMany({
                where,
                orderBy: { uploadedAt: "desc" },
                skip,
                take: limit,
                select: {
                    id: true,
                    title: true,
                    description: true,
                    fileName: true,
                    fileSize: true,
                    filePath: true,
                    category: true,
                    classLevel: true,
                    pageCount: true,
                    readerState: true,
                    uploadedAt: true,
                },
            }),
            prisma.book.count({ where }),
        ]);

        return NextResponse.json({
            books: books.map((book) => ({
                ...book,
                workspaceStats: computeBookReaderStats(book.readerState, book.pageCount),
            })),
            pagination: {
                page,
                limit,
                total,
                totalPages: Math.ceil(total / limit),
            },
        });
    } catch (error) {
        console.error("Books listing error:", error);
        return NextResponse.json({ error: "Failed to fetch books" }, { status: 500 });
    }
}
