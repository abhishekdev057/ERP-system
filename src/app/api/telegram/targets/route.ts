import { NextRequest, NextResponse } from "next/server";
import { enforceToolAccess } from "@/lib/api-auth";
import { saveTelegramTarget, TelegramError } from "@/lib/telegram";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
    try {
        const auth = await enforceToolAccess(["media-studio", "pdf-to-pdf"]);
        const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
        const target = await saveTelegramTarget({
            userId: auth.userId,
            organizationId: auth.organizationId,
            chatId: String(body.chatId || body.target || "").trim(),
            title: String(body.title || "").trim() || undefined,
            username: String(body.username || "").trim() || undefined,
            type: String(body.type || "").trim() || undefined,
            isPinned: body.isPinned === undefined ? true : Boolean(body.isPinned),
        });

        return NextResponse.json({ target });
    } catch (error) {
        if (error instanceof Response) return error;
        console.error("Failed to save Telegram target:", error);
        const telegramError = error as TelegramError;
        return NextResponse.json(
            {
                error: telegramError?.message || "Failed to save Telegram target",
                code: telegramError?.code || "telegram_target_save_failed",
            },
            { status: telegramError?.status || 500 }
        );
    }
}
