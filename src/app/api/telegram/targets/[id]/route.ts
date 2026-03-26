import { NextResponse } from "next/server";
import { enforceToolAccess } from "@/lib/api-auth";
import { removeTelegramTarget, TelegramError } from "@/lib/telegram";

export const dynamic = "force-dynamic";

export async function DELETE(
    _request: Request,
    context: { params: { id: string } }
) {
    try {
        const auth = await enforceToolAccess(["media-studio", "pdf-to-pdf"]);
        const deleted = await removeTelegramTarget({
            userId: auth.userId,
            targetId: context.params.id,
        });
        return NextResponse.json({ deleted });
    } catch (error) {
        if (error instanceof Response) return error;
        console.error("Failed to delete Telegram target:", error);
        const telegramError = error as TelegramError;
        return NextResponse.json(
            {
                error: telegramError?.message || "Failed to delete Telegram target",
                code: telegramError?.code || "telegram_target_delete_failed",
            },
            { status: telegramError?.status || 500 }
        );
    }
}
