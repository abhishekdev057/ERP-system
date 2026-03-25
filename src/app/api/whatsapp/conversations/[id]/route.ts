import { NextRequest, NextResponse } from "next/server";
import { enforceToolAccess } from "@/lib/api-auth";
import { listWhatsAppConversationMessages, WhatsAppError } from "@/lib/whatsapp";

export const dynamic = "force-dynamic";

export async function GET(
    _request: NextRequest,
    { params }: { params: { id: string } }
) {
    try {
        const auth = await enforceToolAccess(["media-studio", "pdf-to-pdf"]);
        const data = await listWhatsAppConversationMessages(auth.userId, params.id);
        return NextResponse.json(data);
    } catch (error) {
        if (error instanceof Response) return error;
        console.error("Failed to load WhatsApp conversation:", error);
        const whatsappError = error as WhatsAppError;
        return NextResponse.json(
            {
                error: whatsappError?.message || "Failed to load WhatsApp conversation",
                code: whatsappError?.code || "whatsapp_conversation_failed",
            },
            { status: whatsappError?.status || 500 }
        );
    }
}
