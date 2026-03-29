import { NextRequest, NextResponse } from "next/server";
import { enforceToolAccess } from "@/lib/api-auth";
import {
    disconnectSocialConnection,
    parseSocialPlatform,
    saveSocialConnection,
    SocialPublishError,
} from "@/lib/social-publishing";

export const dynamic = "force-dynamic";

type RouteContext = {
    params: {
        platform: string;
    };
};

export async function POST(request: NextRequest, context: RouteContext) {
    try {
        const auth = await enforceToolAccess(["media-studio", "pdf-to-pdf"]);
        const platform = parseSocialPlatform(context.params.platform);
        const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
        const dashboard = await saveSocialConnection({
            platform,
            userId: auth.userId,
            organizationId: auth.organizationId,
            values: body,
        });
        return NextResponse.json(dashboard);
    } catch (error) {
        console.error("Failed to save social connection:", error);
        const socialError = error as SocialPublishError;
        return NextResponse.json(
            {
                error: socialError?.message || "Failed to save social connection",
                code: socialError?.code || "social_connection_save_failed",
            },
            { status: socialError?.status || 500 }
        );
    }
}

export async function DELETE(_request: NextRequest, context: RouteContext) {
    try {
        const auth = await enforceToolAccess(["media-studio", "pdf-to-pdf"]);
        const platform = parseSocialPlatform(context.params.platform);
        await disconnectSocialConnection(platform, auth.userId);
        return NextResponse.json({ disconnected: true });
    } catch (error) {
        console.error("Failed to delete social connection:", error);
        const socialError = error as SocialPublishError;
        return NextResponse.json(
            {
                error: socialError?.message || "Failed to delete social connection",
                code: socialError?.code || "social_connection_delete_failed",
            },
            { status: socialError?.status || 500 }
        );
    }
}
