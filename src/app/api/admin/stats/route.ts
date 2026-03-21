import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET() {
    try {
        const session = await getServerSession(authOptions);

        if (!session || session.user.role !== "SYSTEM_ADMIN") {
            return new NextResponse("Unauthorized", { status: 401 });
        }

        const [totalOrgs, totalUsers, totalDocs, totalBooks] = await Promise.all([
            prisma.organization.count(),
            prisma.user.count(),
            prisma.pdfDocument.count(),
            prisma.book.count(),
        ]);

        return NextResponse.json({
            totalOrgs,
            totalUsers,
            totalDocs,
            totalBooks,
        });
    } catch (error) {
        console.error("Failed to fetch admin stats:", error);
        return NextResponse.json(
            { error: "Internal Server Error" },
            { status: 500 }
        );
    }
}
