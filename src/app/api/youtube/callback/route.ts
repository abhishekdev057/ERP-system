import { getServerSession } from "next-auth";
import { NextRequest, NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { resolvePublicOrigin } from "@/lib/request-origin";
import {
    normalizeYouTubeReturnPath,
    storeYouTubeConnection,
    YOUTUBE_CONNECT_SCOPES,
    YOUTUBE_OAUTH_MODE_COOKIE,
    YOUTUBE_OAUTH_RETURN_COOKIE,
    YOUTUBE_OAUTH_STATE_COOKIE,
    YOUTUBE_OAUTH_USER_COOKIE,
    YOUTUBE_POLL_SCOPES,
    YouTubeError,
} from "@/lib/youtube";

export const dynamic = "force-dynamic";

function buildReturnUrl(origin: string, returnTo: string, status: string, message?: string) {
    const url = new URL(returnTo, origin);
    url.searchParams.set("youtube", status);
    if (message) {
        url.searchParams.set("youtubeMessage", message);
    }
    return url;
}

function clearOauthCookies(response: NextResponse) {
    response.cookies.set(YOUTUBE_OAUTH_STATE_COOKIE, "", { path: "/", maxAge: 0 });
    response.cookies.set(YOUTUBE_OAUTH_RETURN_COOKIE, "", { path: "/", maxAge: 0 });
    response.cookies.set(YOUTUBE_OAUTH_USER_COOKIE, "", { path: "/", maxAge: 0 });
    response.cookies.set(YOUTUBE_OAUTH_MODE_COOKIE, "", { path: "/", maxAge: 0 });
}

export async function GET(request: NextRequest) {
    const origin = resolvePublicOrigin(request);
    const returnTo = normalizeYouTubeReturnPath(
        request.cookies.get(YOUTUBE_OAUTH_RETURN_COOKIE)?.value
    );
    const mode = request.cookies.get(YOUTUBE_OAUTH_MODE_COOKIE)?.value === "poll" ? "poll" : "connect";
    const stateFromCookie = request.cookies.get(YOUTUBE_OAUTH_STATE_COOKIE)?.value || "";
    const userFromCookie = request.cookies.get(YOUTUBE_OAUTH_USER_COOKIE)?.value || "";
    const stateFromQuery = String(request.nextUrl.searchParams.get("state") || "");
    const error = String(request.nextUrl.searchParams.get("error") || "");
    const code = String(request.nextUrl.searchParams.get("code") || "");
    const requestedScopes = mode === "poll" ? YOUTUBE_POLL_SCOPES : YOUTUBE_CONNECT_SCOPES;

    const redirectWithStatus = (status: string, message?: string) => {
        const response = NextResponse.redirect(buildReturnUrl(origin, returnTo, status, message));
        clearOauthCookies(response);
        return response;
    };

    if (error) {
        return redirectWithStatus("error", error.replace(/_/g, " "));
    }

    if (!code || !stateFromQuery || stateFromCookie !== stateFromQuery) {
        return redirectWithStatus("error", "YouTube connection state did not match. Please try again.");
    }

    const session = await getServerSession(authOptions);
    const sessionUserId = (session?.user as any)?.id || "";
    if (!sessionUserId) {
        return NextResponse.redirect(new URL("/auth/signin?callbackUrl=/pdf-to-pdf/media", origin));
    }

    if (userFromCookie && userFromCookie !== sessionUserId) {
        return redirectWithStatus("error", "YouTube connection is tied to a different signed-in user.");
    }

    try {
        await storeYouTubeConnection({
            userId: sessionUserId,
            origin,
            code,
            scopes: requestedScopes,
        });
        return redirectWithStatus("connected");
    } catch (error) {
        console.error("Failed to finish YouTube OAuth:", error);
        const message =
            error instanceof YouTubeError
                ? error.message
                : error instanceof Error
                    ? error.message
                    : "Failed to connect YouTube channel.";
        return redirectWithStatus("error", message);
    }
}
