import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(req: NextRequest) {
    try {
        const { searchParams } = new URL(req.url);
        const limit = parseInt(searchParams.get("limit") || "50");
        const offset = parseInt(searchParams.get("offset") || "0");
        const minimal = searchParams.get("minimal") === "true";

        const documents = await prisma.pdfDocument.findMany({
            orderBy: { createdAt: "desc" },
            take: limit,
            skip: offset,
            select: minimal ? {
                id: true,
                title: true,
                subject: true,
                createdAt: true,
                // Exclude jsonData for minimal view to save bandwidth
            } : undefined
        });

        return NextResponse.json({ documents });
    } catch (error) {
        console.error("Failed to fetch documents:", error);
        return NextResponse.json(
            { documents: [], error: "Database unavailable" },
            { status: 200 }
        );
    }
}
