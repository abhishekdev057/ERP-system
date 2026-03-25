import { NextRequest, NextResponse } from "next/server";
import { enforceToolAccess } from "@/lib/api-auth";
import { resolvePublicOrigin } from "@/lib/request-origin";
import { upsertWhatsAppConnection, WhatsAppError } from "@/lib/whatsapp";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
    try {
        const auth = await enforceToolAccess(["media-studio", "pdf-to-pdf"]);
        const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
        const code = String(body.code || "").trim();
        const wabaId = String(body.wabaId || "").trim();
        const phoneNumberId = String(body.phoneNumberId || "").trim();
        const businessId = String(body.businessId || "").trim();
        const appScopedUserId = String(body.appScopedUserId || "").trim();

        if (!code || !wabaId || !phoneNumberId) {
            return NextResponse.json(
                {
                    error: "code, wabaId, and phoneNumberId are required.",
                },
                { status: 400 }
            );
        }

        const origin = resolvePublicOrigin(request);
        const connection = await upsertWhatsAppConnection({
            userId: auth.userId,
            organizationId: auth.organizationId,
            origin,
            code,
            wabaId,
            phoneNumberId,
            businessId: businessId || undefined,
            appScopedUserId: appScopedUserId || undefined,
        });

        return NextResponse.json({ connection });
    } catch (error) {
        if (error instanceof Response) return error;
        console.error("Failed to connect WhatsApp:", error);
        const whatsappError = error as WhatsAppError;
        return NextResponse.json(
            {
                error: whatsappError?.message || "Failed to connect WhatsApp",
                code: whatsappError?.code || "whatsapp_connect_failed",
            },
            { status: whatsappError?.status || 500 }
        );
    }
}
