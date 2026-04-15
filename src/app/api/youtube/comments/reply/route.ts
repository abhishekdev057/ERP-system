import { NextRequest, NextResponse } from "next/server";
import { enforceToolAccess } from "@/lib/api-auth";
import {
    sendYouTubeLiveChatMessage,
    sendYouTubeVideoCommentThread,
    sendYouTubeVideoCommentReply,
    YouTubeError,
} from "@/lib/youtube";

export const dynamic = "force-dynamic";

function normalizeMentionName(value: string | undefined) {
    return String(value || "").trim().replace(/^@+/, "");
}

function escapeRegExp(value: string) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeReplyBody(messageText: string, options?: { singleLine?: boolean; maxLength?: number }) {
    const singleLine = options?.singleLine === true;
    const maxLength = options?.maxLength ?? (singleLine ? 200 : 4000);
    const normalized = String(messageText || "")
        .replace(/\r\n?/g, "\n")
        .replace(/[^\S\n]+/g, " ")
        .replace(/\n{3,}/g, "\n\n")
        .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
        .trim();
    const collapsed = singleLine
        ? normalized.replace(/\n+/g, " ").replace(/\s+/g, " ").trim()
        : normalized;

    return collapsed.slice(0, maxLength).trim();
}

function normalizeTaggedReply(messageText: string, authorName?: string, options?: { singleLine?: boolean; maxLength?: number }) {
    const trimmed = normalizeReplyBody(messageText, options);
    const normalizedAuthor = normalizeMentionName(authorName);
    if (!trimmed || !normalizedAuthor) return trimmed;

    const mentionPattern = new RegExp(`^(?:@+${escapeRegExp(normalizedAuthor)}\\s+)+`, "i");
    const withoutRepeatedMention = trimmed.replace(mentionPattern, "").trim();
    if (!withoutRepeatedMention) {
        return `@${normalizedAuthor}`;
    }
    return `@${normalizedAuthor} ${withoutRepeatedMention}`.trim();
}

export async function POST(request: NextRequest) {
    try {
        const auth = await enforceToolAccess(["media-studio", "pdf-to-pdf"]);
        const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
        const messageText = String(body.messageText || "").trim();
        const liveChatId = String(body.liveChatId || "").trim();
        const broadcastId = String(body.broadcastId || "").trim();
        const parentCommentId = String(body.parentCommentId || "").trim();
        const parentThreadId = String(body.parentThreadId || "").trim();
        const videoId = String(body.videoId || "").trim();
        const authorName = String(body.authorName || "").trim();

        const normalizedMessageText = liveChatId
            ? normalizeReplyBody(messageText, { singleLine: true, maxLength: 200 })
            : parentCommentId
                ? normalizeTaggedReply(messageText, authorName, { maxLength: 4000 })
                : normalizeReplyBody(messageText, { maxLength: 4000 });

        if (!normalizedMessageText) {
            return NextResponse.json({ error: "messageText is required." }, { status: 400 });
        }

        if (liveChatId) {
            const message = await sendYouTubeLiveChatMessage({
                userId: auth.userId,
                liveChatId,
                broadcastId: broadcastId || undefined,
                authorName: authorName || undefined,
                messageText: normalizedMessageText,
            });
            return NextResponse.json({ success: true, mode: "liveChat", message, sentText: normalizedMessageText });
        }

        if (parentCommentId) {
            const reply = await sendYouTubeVideoCommentReply({
                userId: auth.userId,
                parentCommentId,
                parentThreadId: parentThreadId || undefined,
                messageText: normalizedMessageText,
            });
            return NextResponse.json({ success: true, mode: "videoComment", reply, sentText: normalizedMessageText });
        }

        if (videoId) {
            const thread = await sendYouTubeVideoCommentThread({
                userId: auth.userId,
                videoId,
                messageText: normalizedMessageText,
            });
            return NextResponse.json({ success: true, mode: "videoThread", thread, sentText: normalizedMessageText });
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
