import { NextResponse } from "next/server";
import { enforceToolAccess } from "@/lib/api-auth";
import { disconnectYouTubeConnection } from "@/lib/youtube";

export const dynamic = "force-dynamic";

export async function DELETE() {
    try {
        const auth = await enforceToolAccess(["media-studio", "pdf-to-pdf"]);
        const disconnected = await disconnectYouTubeConnection(auth.userId);
        return NextResponse.json({
            disconnected,
        });
    } catch (error) {
        if (error instanceof Response) return error;
        console.error("Failed to disconnect YouTube:", error);
        return NextResponse.json(
            {
                error: "Failed to disconnect YouTube channel",
            },
            { status: 500 }
        );
    }
}
