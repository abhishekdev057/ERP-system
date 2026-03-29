import { NextResponse } from "next/server";
import { enforceToolAccess } from "@/lib/api-auth";
import { getSocialDashboard, parseSocialPlatform, SocialPublishError } from "@/lib/social-publishing";

export const dynamic = "force-dynamic";

type RouteContext = {
    params: {
        platform: string;
    };
};

export async function GET(_request: Request, context: RouteContext) {
    try {
        const auth = await enforceToolAccess(["media-studio", "pdf-to-pdf"]);
        const platform = parseSocialPlatform(context.params.platform);
        const dashboard = await getSocialDashboard({
            platform,
            userId: auth.userId,
            organizationId: auth.organizationId,
        });
        return NextResponse.json(dashboard);
    } catch (error) {
        console.error("Failed to load social dashboard:", error);
        const socialError = error as SocialPublishError;
        return NextResponse.json(
            {
                error: socialError?.message || "Failed to load social dashboard",
                code: socialError?.code || "social_dashboard_failed",
            },
            { status: socialError?.status || 500 }
        );
    }
}
