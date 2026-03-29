import { NextRequest, NextResponse } from "next/server";
import { enforceToolAccess } from "@/lib/api-auth";
import { parseSocialPlatform, publishToSocial, SocialPublishError } from "@/lib/social-publishing";

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

        const result = await publishToSocial({
            platform,
            userId: auth.userId,
            organizationId: auth.organizationId,
            text: String(body.text || body.description || body.caption || "").trim() || undefined,
            title: String(body.title || "").trim() || undefined,
            assetUrl: String(body.assetUrl || "").trim() || undefined,
            action: String(body.action || "publish").trim() || undefined,
        });

        return NextResponse.json({ result });
    } catch (error) {
        console.error("Failed to publish to social platform:", error);
        const socialError = error as SocialPublishError;
        return NextResponse.json(
            {
                error: socialError?.message || "Failed to publish to social platform",
                code: socialError?.code || "social_publish_failed",
            },
            { status: socialError?.status || 500 }
        );
    }
}
