import { NextRequest } from "next/server";

function normalizeOriginCandidate(value: string): string | null {
    const raw = String(value || "").trim();
    if (!raw) return null;

    try {
        const url = new URL(raw);
        if (url.hostname === "0.0.0.0" || url.hostname === "[::]" || url.hostname === "::") {
            url.hostname = "localhost";
        }
        return url.origin;
    } catch {
        return null;
    }
}

export function resolvePublicOrigin(request: NextRequest): string {
    const envOrigin =
        normalizeOriginCandidate(process.env.YOUTUBE_PUBLIC_ORIGIN || "") ||
        normalizeOriginCandidate(process.env.NEXTAUTH_URL || "") ||
        normalizeOriginCandidate(process.env.APP_URL || "") ||
        normalizeOriginCandidate(process.env.NEXT_PUBLIC_APP_URL || "");

    if (envOrigin) {
        return envOrigin;
    }

    const forwardedHost = request.headers.get("x-forwarded-host") || request.headers.get("host") || "";
    const forwardedProto =
        request.headers.get("x-forwarded-proto") ||
        request.nextUrl.protocol.replace(/:$/, "") ||
        "https";

    if (forwardedHost) {
        const forwardedOrigin = normalizeOriginCandidate(`${forwardedProto}://${forwardedHost}`);
        if (forwardedOrigin) {
            return forwardedOrigin;
        }
    }

    const requestOrigin = normalizeOriginCandidate(request.nextUrl.origin);
    if (requestOrigin) {
        return requestOrigin;
    }

    return "http://localhost:3000";
}
