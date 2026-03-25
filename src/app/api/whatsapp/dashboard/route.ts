import { NextResponse } from "next/server";
import { enforceToolAccess } from "@/lib/api-auth";
import { fetchWhatsAppDashboard, WhatsAppError } from "@/lib/whatsapp";

export const dynamic = "force-dynamic";

export async function GET() {
    try {
        const auth = await enforceToolAccess(["media-studio", "pdf-to-pdf"]);
        const dashboard = await fetchWhatsAppDashboard(auth.userId);
        return NextResponse.json(dashboard);
    } catch (error) {
        if (error instanceof Response) return error;
        console.error("Failed to load WhatsApp dashboard:", error);
        const whatsappError = error as WhatsAppError;
        return NextResponse.json(
            {
                error: whatsappError?.message || "Failed to load WhatsApp dashboard",
                code: whatsappError?.code || "whatsapp_dashboard_failed",
            },
            { status: whatsappError?.status || 500 }
        );
    }
}
