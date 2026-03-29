import { NextRequest, NextResponse } from "next/server";
import { enforceToolAccess } from "@/lib/api-auth";
import { TelegramError } from "@/lib/telegram";
import {
    disconnectTelegramUserConnection,
    getTelegramUserConnectionState,
    startTelegramUserQrLogin,
    submitTelegramUserPassword,
} from "@/lib/telegram-user";

export const dynamic = "force-dynamic";

export async function GET() {
    try {
        const auth = await enforceToolAccess(["media-studio", "pdf-to-pdf"]);
        const state = await getTelegramUserConnectionState(auth.userId);
        return NextResponse.json(state);
    } catch (error) {
        console.error("Failed to load Telegram user connection:", error);
        const telegramError = error as TelegramError;
        return NextResponse.json(
            {
                error: telegramError?.message || "Failed to load Telegram user connection",
                code: telegramError?.code || "telegram_user_connection_failed",
            },
            { status: telegramError?.status || 500 }
        );
    }
}

export async function POST() {
    try {
        const auth = await enforceToolAccess(["media-studio", "pdf-to-pdf"]);
        const state = await startTelegramUserQrLogin({
            userId: auth.userId,
            organizationId: auth.organizationId,
        });
        return NextResponse.json(state);
    } catch (error) {
        console.error("Failed to start Telegram QR login:", error);
        const telegramError = error as TelegramError;
        return NextResponse.json(
            {
                error: telegramError?.message || "Failed to start Telegram QR login",
                code: telegramError?.code || "telegram_user_qr_failed",
            },
            { status: telegramError?.status || 500 }
        );
    }
}

export async function PATCH(request: NextRequest) {
    try {
        const auth = await enforceToolAccess(["media-studio", "pdf-to-pdf"]);
        const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
        const password = String(body.password || "").trim();
        if (!password) {
            return NextResponse.json({ error: "Password is required." }, { status: 400 });
        }

        const state = await submitTelegramUserPassword({
            userId: auth.userId,
            password,
        });
        return NextResponse.json(state);
    } catch (error) {
        console.error("Failed to submit Telegram user 2FA password:", error);
        const telegramError = error as TelegramError;
        return NextResponse.json(
            {
                error: telegramError?.message || "Failed to submit Telegram password",
                code: telegramError?.code || "telegram_user_password_failed",
            },
            { status: telegramError?.status || 500 }
        );
    }
}

export async function DELETE() {
    try {
        const auth = await enforceToolAccess(["media-studio", "pdf-to-pdf"]);
        await disconnectTelegramUserConnection(auth.userId);
        return NextResponse.json({ disconnected: true });
    } catch (error) {
        console.error("Failed to disconnect Telegram user connection:", error);
        const telegramError = error as TelegramError;
        return NextResponse.json(
            {
                error: telegramError?.message || "Failed to disconnect Telegram user connection",
                code: telegramError?.code || "telegram_user_disconnect_failed",
            },
            { status: telegramError?.status || 500 }
        );
    }
}
