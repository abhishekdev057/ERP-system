import { NextRequest, NextResponse } from "next/server";
import { ingestWhatsAppWebhook, verifyWhatsAppWebhook, WhatsAppError } from "@/lib/whatsapp";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
    try {
        const challenge = await verifyWhatsAppWebhook(request.nextUrl.searchParams);
        return new NextResponse(challenge, { status: 200 });
    } catch (error) {
        const whatsappError = error as WhatsAppError;
        return NextResponse.json(
            {
                error: whatsappError?.message || "Webhook verification failed",
            },
            { status: whatsappError?.status || 403 }
        );
    }
}

export async function POST(request: NextRequest) {
    try {
        const payload = await request.json().catch(() => ({}));
        await ingestWhatsAppWebhook(payload);
        return NextResponse.json({ received: true });
    } catch (error) {
        console.error("Failed to ingest WhatsApp webhook:", error);
        return NextResponse.json(
            {
                error: "Failed to ingest WhatsApp webhook",
            },
            { status: 500 }
        );
    }
}
