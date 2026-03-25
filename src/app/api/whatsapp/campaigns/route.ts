import { NextRequest, NextResponse } from "next/server";
import { enforceToolAccess } from "@/lib/api-auth";
import { createWhatsAppCampaign, WhatsAppError } from "@/lib/whatsapp";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
    try {
        const auth = await enforceToolAccess(["media-studio", "pdf-to-pdf"]);
        const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;

        const campaign = await createWhatsAppCampaign({
            userId: auth.userId,
            organizationId: auth.organizationId,
            name: String(body.name || "").trim(),
            templateName: String(body.templateName || "").trim(),
            languageCode: String(body.languageCode || "en").trim(),
            recipientsRaw: String(body.recipients || "").trim(),
            variablesRaw: String(body.variables || "").trim(),
        });

        return NextResponse.json({ campaign });
    } catch (error) {
        if (error instanceof Response) return error;
        console.error("Failed to create WhatsApp campaign:", error);
        const whatsappError = error as WhatsAppError;
        return NextResponse.json(
            {
                error: whatsappError?.message || "Failed to create WhatsApp campaign",
                code: whatsappError?.code || "whatsapp_campaign_failed",
            },
            { status: whatsappError?.status || 500 }
        );
    }
}
