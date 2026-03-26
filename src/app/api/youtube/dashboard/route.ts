import { NextResponse } from "next/server";
import { enforceToolAccess } from "@/lib/api-auth";
import { buildYouTubeQuotaFallbackDashboard, fetchYouTubeDashboard, YouTubeError } from "@/lib/youtube";

export const dynamic = "force-dynamic";

export async function GET() {
    let userId = "";
    try {
        const auth = await enforceToolAccess(["media-studio", "pdf-to-pdf"]);
        userId = auth.userId;
        const dashboard = await fetchYouTubeDashboard(userId);
        return NextResponse.json(dashboard);
    } catch (error) {
        if (error instanceof Response) return error;
        console.error("Failed to load YouTube dashboard:", error);
        const youtubeError = error as YouTubeError;
        if (
            userId &&
            (youtubeError?.code === "quotaExceeded" || youtubeError?.code === "dailyLimitExceeded")
        ) {
            const fallbackDashboard = await buildYouTubeQuotaFallbackDashboard(
                userId,
                youtubeError?.message || undefined
            );
            return NextResponse.json(fallbackDashboard);
        }
        return NextResponse.json(
            {
                error: youtubeError?.message || "Failed to load YouTube dashboard",
                code: youtubeError?.code || "youtube_dashboard_failed",
            },
            { status: youtubeError?.status || 500 }
        );
    }
}
