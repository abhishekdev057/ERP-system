import { NextRequest, NextResponse } from "next/server";
import { enforceToolAccess } from "@/lib/api-auth";
import { getPdfDocumentById } from "@/lib/services/pdf-document-service";
import { createYouTubeLivePoll, YouTubeError } from "@/lib/youtube";
import {
    persistYouTubePollDocumentJson,
    withStartedYouTubePollHistory,
} from "@/lib/youtube-poll-progress";

export const dynamic = "force-dynamic";

function normalizeOptionTexts(value: unknown): string[] {
    if (!Array.isArray(value)) return [];
    return value
        .map((item) => String(item || "").trim())
        .filter(Boolean)
        .slice(0, 4);
}

export async function POST(request: NextRequest) {
    try {
        const auth = await enforceToolAccess(["media-studio", "pdf-to-pdf"]);
        const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
        const liveChatId = String(body.liveChatId || "").trim();
        const questionText = String(body.questionText || "").trim();
        const optionTexts = normalizeOptionTexts(body.optionTexts);
        const documentId = String(body.documentId || "").trim();
        const broadcastId = String(body.broadcastId || "").trim();
        const candidateId = String(body.candidateId || "").trim();
        const questionNumber = String(body.questionNumber || "").trim();

        if (!liveChatId) {
            return NextResponse.json({ error: "liveChatId is required." }, { status: 400 });
        }
        if (!questionText) {
            return NextResponse.json({ error: "Question text is required." }, { status: 400 });
        }
        if (questionText.length > 100) {
            return NextResponse.json({ error: "Question text must be 100 characters or fewer." }, { status: 400 });
        }
        if (optionTexts.length < 2 || optionTexts.length > 4) {
            return NextResponse.json({ error: "YouTube polls require 2 to 4 options." }, { status: 400 });
        }
        if (optionTexts.some((option) => option.length > 35)) {
            return NextResponse.json({ error: "Each poll option must be 35 characters or fewer." }, { status: 400 });
        }

        const poll = await createYouTubeLivePoll({
            userId: auth.userId,
            liveChatId,
            questionText,
            optionTexts,
        });

        if (documentId && broadcastId && candidateId) {
            try {
                const document = await getPdfDocumentById(
                    documentId,
                    auth.organizationId,
                    auth.userId,
                    auth.role
                );

                if (document) {
                    const nextJsonData = withStartedYouTubePollHistory(document.jsonData, {
                        broadcastId,
                        candidateId,
                        questionNumber,
                        questionText,
                        optionTexts,
                        pollId: poll.id,
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
                console.warn("YouTube poll started, but poll history could not be saved:", historyError);
            }
        }

        return NextResponse.json({ poll });
    } catch (error) {
        if (error instanceof Response) return error;
        console.error("Failed to start YouTube poll:", error);
        const youtubeError = error as YouTubeError;
        return NextResponse.json(
            {
                error: youtubeError?.message || "Failed to start YouTube poll",
                code: youtubeError?.code || "youtube_poll_start_failed",
            },
            { status: youtubeError?.status || 500 }
        );
    }
}
