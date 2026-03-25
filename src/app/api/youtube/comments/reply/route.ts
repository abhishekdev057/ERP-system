import { NextRequest, NextResponse } from "next/server";
import { enforceToolAccess } from "@/lib/api-auth";
import {
    sendYouTubeLiveChatMessage,
    sendYouTubeVideoCommentThread,
    sendYouTubeVideoCommentReply,
    YouTubeError,
} from "@/lib/youtube";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
    try {
        const auth = await enforceToolAccess(["media-studio", "pdf-to-pdf"]);
        const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
        const messageText = String(body.messageText || "").trim();
        const liveChatId = String(body.liveChatId || "").trim();
        const parentCommentId = String(body.parentCommentId || "").trim();
        const parentThreadId = String(body.parentThreadId || "").trim();
        const videoId = String(body.videoId || "").trim();

        if (!messageText) {
            return NextResponse.json({ error: "messageText is required." }, { status: 400 });
        }

        if (liveChatId) {
            const message = await sendYouTubeLiveChatMessage({
                userId: auth.userId,
                liveChatId,
                messageText,
            });
            return NextResponse.json({ success: true, mode: "liveChat", message });
        }

        if (parentCommentId) {
            const reply = await sendYouTubeVideoCommentReply({
                userId: auth.userId,
                parentCommentId,
                parentThreadId: parentThreadId || undefined,
                messageText,
            });
            return NextResponse.json({ success: true, mode: "videoComment", reply });
        }

        if (videoId) {
            const thread = await sendYouTubeVideoCommentThread({
                userId: auth.userId,
                videoId,
                messageText,
            });
            return NextResponse.json({ success: true, mode: "videoThread", thread });
        }

        return NextResponse.json(
            { error: "Either liveChatId, parentCommentId, or videoId is required." },
            { status: 400 }
        );
    } catch (error) {
        if (error instanceof Response) return error;
        console.error("Failed to send YouTube reply:", error);
        const youtubeError = error as YouTubeError;
        return NextResponse.json(
            {
                error: youtubeError?.message || "Failed to send YouTube reply",
                code: youtubeError?.code || "youtube_reply_failed",
            },
            { status: youtubeError?.status || 500 }
        );
    }
}
