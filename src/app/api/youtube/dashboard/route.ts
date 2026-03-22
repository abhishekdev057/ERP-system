import { NextResponse } from "next/server";
import { enforceToolAccess } from "@/lib/api-auth";
import { fetchYouTubeDashboard, YouTubeError } from "@/lib/youtube";

export const dynamic = "force-dynamic";

export async function GET() {
    try {
        const auth = await enforceToolAccess(["media-studio", "pdf-to-pdf"]);
        const dashboard = await fetchYouTubeDashboard(auth.userId);
        return NextResponse.json(dashboard);
    } catch (error) {
        if (error instanceof Response) return error;
        console.error("Failed to load YouTube dashboard:", error);
        const youtubeError = error as YouTubeError;
        return NextResponse.json(
            {
                error: youtubeError?.message || "Failed to load YouTube dashboard",
                code: youtubeError?.code || "youtube_dashboard_failed",
            },
            { status: youtubeError?.status || 500 }
        );
    }
}
