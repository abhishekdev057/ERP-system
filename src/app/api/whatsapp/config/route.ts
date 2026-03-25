import { NextRequest, NextResponse } from "next/server";
import { enforceToolAccess } from "@/lib/api-auth";
import { resolvePublicOrigin } from "@/lib/request-origin";
import { getWhatsAppPublicConfig } from "@/lib/whatsapp";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
    try {
        await enforceToolAccess(["media-studio", "pdf-to-pdf"]);
        const origin = resolvePublicOrigin(request);
        return NextResponse.json(getWhatsAppPublicConfig(origin));
    } catch (error) {
        if (error instanceof Response) return error;
        console.error("Failed to load WhatsApp public config:", error);
        return NextResponse.json(
            {
                error: "Failed to load WhatsApp config",
            },
            { status: 500 }
        );
    }
}
