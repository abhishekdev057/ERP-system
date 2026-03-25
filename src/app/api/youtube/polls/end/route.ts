import { NextRequest, NextResponse } from "next/server";
import { enforceToolAccess } from "@/lib/api-auth";
import { getPdfDocumentById } from "@/lib/services/pdf-document-service";
import { closeYouTubeLivePoll, YouTubeError } from "@/lib/youtube";
import {
    persistYouTubePollDocumentJson,
    withEndedYouTubePollHistory,
} from "@/lib/youtube-poll-progress";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
    try {
        const auth = await enforceToolAccess(["media-studio", "pdf-to-pdf"]);
        const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
        const pollId = String(body.pollId || "").trim();
        const documentId = String(body.documentId || "").trim();
        const broadcastId = String(body.broadcastId || "").trim();
        const candidateId = String(body.candidateId || "").trim();

        if (!pollId) {
            return NextResponse.json({ error: "pollId is required." }, { status: 400 });
        }

        const poll = await closeYouTubeLivePoll({
            userId: auth.userId,
            pollId,
        });

        if (documentId && broadcastId) {
            try {
                const document = await getPdfDocumentById(
                    documentId,
                    auth.organizationId,
                    auth.userId,
                    auth.role
                );

                if (document) {
                    const nextJsonData = withEndedYouTubePollHistory(document.jsonData, {
                        broadcastId,
                        candidateId,
                        pollId,
                    });

                    await persistYouTubePollDocumentJson(
                        {
                            id: document.id,
                            title: document.title,
                            subject: document.subject,
                            date: document.date,
                            jsonData: document.jsonData,
                        },
                        nextJsonData
                    );
                }
            } catch (historyError) {
                console.warn("YouTube poll ended, but poll history could not be updated:", historyError);
            }
        }

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
