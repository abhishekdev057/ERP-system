import { NextRequest, NextResponse } from "next/server";
import { enforceToolAccess } from "@/lib/api-auth";
import { closeYouTubeLivePoll, YouTubeError } from "@/lib/youtube";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
    try {
        const auth = await enforceToolAccess(["media-studio", "pdf-to-pdf"]);
        const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
        const pollId = String(body.pollId || "").trim();

        if (!pollId) {
            return NextResponse.json({ error: "pollId is required." }, { status: 400 });
        }

        const poll = await closeYouTubeLivePoll({
            userId: auth.userId,
            pollId,
        });

        return NextResponse.json({ poll });
    } catch (error) {
        if (error instanceof Response) return error;
        console.error("Failed to end YouTube poll:", error);
        const youtubeError = error as YouTubeError;
        return NextResponse.json(
            {
                error: youtubeError?.message || "Failed to end YouTube poll",
                code: youtubeError?.code || "youtube_poll_end_failed",
            },
            { status: youtubeError?.status || 500 }
        );
    }
}
