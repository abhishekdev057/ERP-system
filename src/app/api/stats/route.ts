import { NextResponse } from "next/server";
import { getPdfDashboardStats } from "@/lib/services/pdf-document-service";
import { requireSession } from "@/lib/api-auth";

export const dynamic = "force-dynamic";

export async function GET() {
    try {
        const auth = await requireSession();
        const stats = await getPdfDashboardStats(auth.organizationId, auth.role, auth.userId);

        return NextResponse.json({
            ...stats,
            success: true,
        });
    } catch (error) {
        console.error("Failed to fetch stats:", error);
        return NextResponse.json(
            {
                totalDocs: 0,
                todayDocs: 0,
                error: "Database unavailable",
            },
            { status: 200 }
        );
    }
}
