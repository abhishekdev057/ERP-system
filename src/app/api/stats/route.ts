import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET() {
    try {
        const totalDocs = await prisma.pdfDocument.count();

        // Get today's count
        const startOfToday = new Date();
        startOfToday.setHours(0, 0, 0, 0);

        const todayDocs = await prisma.pdfDocument.count({
            where: {
                createdAt: {
                    gte: startOfToday
                }
            }
        });

        return NextResponse.json({
            totalDocs,
            todayDocs,
            success: true
        });
    } catch (error) {
        console.error("Failed to fetch stats:", error);
        return NextResponse.json(
            { totalDocs: 0, todayDocs: 0, error: "Database unavailable" },
            { status: 200 }
        );
    }
}
