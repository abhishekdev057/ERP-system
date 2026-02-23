import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
    buildBookWhere,
    normalizeBookPagination,
    normalizeClassLevel,
} from "@/lib/services/book-service";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
    try {
        const searchParams = request.nextUrl.searchParams;
        const category = searchParams.get("category");
        const classLevel = normalizeClassLevel(searchParams.get("classLevel"));

        const { page, limit, skip } = normalizeBookPagination(
            searchParams.get("page"),
            searchParams.get("limit")
        );

        const where = buildBookWhere({ category, classLevel });

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
                    uploadedAt: true,
                },
            }),
            prisma.book.count({ where }),
        ]);

        return NextResponse.json({
            books,
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
