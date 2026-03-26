import { NextResponse } from "next/server";
import { enforceToolAccess } from "@/lib/api-auth";
import { fetchTelegramDashboard, TelegramError } from "@/lib/telegram";

export const dynamic = "force-dynamic";

export async function GET() {
    try {
        const auth = await enforceToolAccess(["media-studio", "pdf-to-pdf"]);
        const dashboard = await fetchTelegramDashboard(auth.userId);
        return NextResponse.json(dashboard);
    } catch (error) {
        if (error instanceof Response) return error;
        console.error("Failed to load Telegram dashboard:", error);
        const telegramError = error as TelegramError;
        return NextResponse.json(
            {
                error: telegramError?.message || "Failed to load Telegram dashboard",
                code: telegramError?.code || "telegram_dashboard_failed",
            },
            { status: telegramError?.status || 500 }
        );
    }
}
