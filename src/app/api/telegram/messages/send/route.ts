import { NextRequest, NextResponse } from "next/server";
import { enforceToolAccess } from "@/lib/api-auth";
import { sendTelegramPayload, TelegramError } from "@/lib/telegram";
import { sendTelegramUserPayload } from "@/lib/telegram-user";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
    try {
        const auth = await enforceToolAccess(["media-studio", "pdf-to-pdf"]);
        const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
        const type = String(body.type || "text").trim().toLowerCase() as "text" | "photo" | "video";
        const targets = Array.isArray(body.targets)
            ? body.targets.map((item) => String(item || "").trim()).filter(Boolean)
            : String(body.targets || body.target || "")
                .split(/[\n,]/)
                .map((item) => item.trim())
                .filter(Boolean);
        const connectionMode = String(body.connectionMode || "bot").trim().toLowerCase();

        const result =
            connectionMode === "user"
                ? await sendTelegramUserPayload({
                    userId: auth.userId,
                    organizationId: auth.organizationId,
                    type,
                    targets,
                    body: String(body.body || "").trim() || undefined,
                    mediaUrl: String(body.mediaUrl || "").trim() || undefined,
                    caption: String(body.caption || "").trim() || undefined,
                })
                : await sendTelegramPayload({
                    userId: auth.userId,
                    organizationId: auth.organizationId,
                    type,
                    targets,
                    body: String(body.body || "").trim() || undefined,
                    mediaUrl: String(body.mediaUrl || "").trim() || undefined,
                    caption: String(body.caption || "").trim() || undefined,
                    pinTargets: Boolean(body.pinTargets),
                });

        return NextResponse.json({ result });
    } catch (error) {
        if (error instanceof Response) return error;
        console.error("Failed to send Telegram payload:", error);
        const telegramError = error as TelegramError;
        return NextResponse.json(
            {
                error: telegramError?.message || "Failed to send Telegram payload",
                code: telegramError?.code || "telegram_send_failed",
            },
            { status: telegramError?.status || 500 }
        );
    }
}
