import { NextRequest, NextResponse } from "next/server";
import { enforceToolAccess } from "@/lib/api-auth";
import { fetchYouTubeCommentsFeed, YouTubeError } from "@/lib/youtube";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
    try {
        const auth = await enforceToolAccess(["media-studio", "pdf-to-pdf"]);
        const { searchParams } = new URL(request.url);
        const broadcastId = String(searchParams.get("broadcastId") || "").trim();
        const liveChatPageToken = String(searchParams.get("liveChatPageToken") || "").trim();
        const includeLiveChat = searchParams.get("includeLiveChat") !== "0";
        const includeVideoComments = searchParams.get("includeVideoComments") !== "0";

        if (!broadcastId) {
            return NextResponse.json({ error: "broadcastId is required." }, { status: 400 });
        }

        const feed = await fetchYouTubeCommentsFeed({
            userId: auth.userId,
            broadcastId,
            liveChatPageToken: liveChatPageToken || undefined,
            includeLiveChat,
            includeVideoComments,
        });

        return NextResponse.json({
            success: true,
            ...feed,
        });
    } catch (error) {
        if (error instanceof Response) return error;
        console.error("Failed to load YouTube comments feed:", error);
        const youtubeError = error as YouTubeError;
        return NextResponse.json(
            {
                error: youtubeError?.message || "Failed to load YouTube comments feed",
                code: youtubeError?.code || "youtube_comments_feed_failed",
            },
            { status: youtubeError?.status || 500 }
        );
    }
}
