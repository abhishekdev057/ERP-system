import { NextRequest, NextResponse } from "next/server";
import { enforceToolAccess } from "@/lib/api-auth";
import { resolvePublicOrigin } from "@/lib/request-origin";
import {
    buildYouTubeConsentUrl,
    createYouTubeOAuthState,
    normalizeYouTubeReturnPath,
    YOUTUBE_CONNECT_SCOPES,
    YOUTUBE_OAUTH_MODE_COOKIE,
    YOUTUBE_OAUTH_RETURN_COOKIE,
    YOUTUBE_OAUTH_STATE_COOKIE,
    YOUTUBE_OAUTH_USER_COOKIE,
    YOUTUBE_POLL_SCOPES,
} from "@/lib/youtube";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
    try {
        const auth = await enforceToolAccess(["media-studio", "pdf-to-pdf"]);
        const origin = resolvePublicOrigin(request);
        const returnTo = normalizeYouTubeReturnPath(request.nextUrl.searchParams.get("returnTo"));
        const mode = request.nextUrl.searchParams.get("mode") === "poll" ? "poll" : "connect";
        const state = createYouTubeOAuthState();
        const redirectUrl = buildYouTubeConsentUrl({
            origin,
            state,
            scopes: mode === "poll" ? YOUTUBE_POLL_SCOPES : YOUTUBE_CONNECT_SCOPES,
        });

        const response = NextResponse.redirect(redirectUrl);
        const secure = process.env.NODE_ENV === "production";

        response.cookies.set(YOUTUBE_OAUTH_STATE_COOKIE, state, {
            httpOnly: true,
            sameSite: "lax",
            secure,
            path: "/",
            maxAge: 60 * 10,
        });
        response.cookies.set(YOUTUBE_OAUTH_RETURN_COOKIE, returnTo, {
            httpOnly: true,
            sameSite: "lax",
            secure,
            path: "/",
            maxAge: 60 * 10,
        });
        response.cookies.set(YOUTUBE_OAUTH_USER_COOKIE, auth.userId, {
            httpOnly: true,
            sameSite: "lax",
            secure,
            path: "/",
            maxAge: 60 * 10,
        });
        response.cookies.set(YOUTUBE_OAUTH_MODE_COOKIE, mode, {
            httpOnly: true,
            sameSite: "lax",
            secure,
            path: "/",
            maxAge: 60 * 10,
        });

        return response;
    } catch (error) {
        if (error instanceof Response) return error;
        console.error("Failed to start YouTube OAuth:", error);
        return NextResponse.json(
            {
                error: "Failed to start YouTube connection",
            },
            { status: 500 }
        );
    }
}
