import { NextRequest, NextResponse } from "next/server";
import { enforceToolAccess } from "@/lib/api-auth";
import { sendWhatsAppTemplateMessage, sendWhatsAppTextMessage, WhatsAppError } from "@/lib/whatsapp";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
    try {
        const auth = await enforceToolAccess(["media-studio", "pdf-to-pdf"]);
        const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
        const type = String(body.type || "text").trim();
        const to = String(body.to || "").trim();

        if (type === "template") {
            const templateName = String(body.templateName || "").trim();
            const languageCode = String(body.languageCode || "en").trim();
            const variables = Array.isArray(body.variables)
                ? body.variables.map((item) => String(item || "").trim()).filter(Boolean)
                : [];
            const result = await sendWhatsAppTemplateMessage({
                userId: auth.userId,
                to,
                templateName,
                languageCode,
                variables,
            });
            return NextResponse.json({ result });
        }

        const text = String(body.body || "").trim();
        const result = await sendWhatsAppTextMessage({
            userId: auth.userId,
            to,
            body: text,
        });
        return NextResponse.json({ result });
    } catch (error) {
        if (error instanceof Response) return error;
        console.error("Failed to send WhatsApp message:", error);
        const whatsappError = error as WhatsAppError;
        return NextResponse.json(
            {
                error: whatsappError?.message || "Failed to send WhatsApp message",
                code: whatsappError?.code || "whatsapp_send_failed",
            },
            { status: whatsappError?.status || 500 }
        );
    }
}
