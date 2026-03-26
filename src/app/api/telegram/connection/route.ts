import { NextRequest, NextResponse } from "next/server";
import { enforceToolAccess } from "@/lib/api-auth";
import {
    disconnectTelegramConnection,
    TelegramError,
    upsertTelegramConnection,
} from "@/lib/telegram";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
    try {
        const auth = await enforceToolAccess(["media-studio", "pdf-to-pdf"]);
        const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
        const botToken = String(body.botToken || "").trim() || undefined;

        const connection = await upsertTelegramConnection({
            userId: auth.userId,
            organizationId: auth.organizationId,
            botToken,
        });

        return NextResponse.json({ connection });
    } catch (error) {
        if (error instanceof Response) return error;
        console.error("Failed to connect Telegram bot:", error);
        const telegramError = error as TelegramError;
        return NextResponse.json(
            {
                error: telegramError?.message || "Failed to connect Telegram bot",
                code: telegramError?.code || "telegram_connect_failed",
            },
            { status: telegramError?.status || 500 }
        );
    }
}

export async function DELETE() {
    try {
        const auth = await enforceToolAccess(["media-studio", "pdf-to-pdf"]);
        const disconnected = await disconnectTelegramConnection(auth.userId);
        return NextResponse.json({ disconnected });
    } catch (error) {
        if (error instanceof Response) return error;
        console.error("Failed to disconnect Telegram bot:", error);
        const telegramError = error as TelegramError;
        return NextResponse.json(
            {
                error: telegramError?.message || "Failed to disconnect Telegram bot",
                code: telegramError?.code || "telegram_disconnect_failed",
            },
            { status: telegramError?.status || 500 }
        );
    }
}
