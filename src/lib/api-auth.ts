/**
 * Shared authentication helpers for API routes.
 * Use `requireSession` to get a validated session or throw a 401 response.
 */
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { NextResponse } from "next/server";

export type AuthedSession = {
    userId: string;
    role: string;
    organizationId: string | null;
    allowedTools: string[];
};

/**
 * Returns a validated session or throws a NextResponse with 401.
 * Guarantees the caller always has a logged-in user.
 */
export async function requireSession(): Promise<AuthedSession> {
    const session = await getServerSession(authOptions);

    if (!session?.user) {
        throw NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    return {
        userId: (session.user as any).id,
        role: (session.user as any).role || "MEMBER",
        organizationId: (session.user as any).organizationId || null,
        allowedTools: (session.user as any).allowedTools || [],
    };
}

/**
 * Same as requireSession, but also enforces SYSTEM_ADMIN role.
 */
export async function requireAdmin(): Promise<AuthedSession> {
    const auth = await requireSession();

    if (auth.role !== "SYSTEM_ADMIN") {
        throw NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    return auth;
}

/**
 * Enforces that the current session has access to at least one of the specified tools.
 */
export async function enforceToolAccess(toolNames: string | string[]): Promise<AuthedSession> {
    const auth = await requireSession();
    const requiredTools = Array.isArray(toolNames) ? toolNames : [toolNames];

    const hasAccess = requiredTools.some((tool) => auth.allowedTools.includes(tool));
    const hasImplicitAdminAccess = auth.role === "SYSTEM_ADMIN" || auth.role === "ORG_ADMIN";

    if (!hasAccess && !hasImplicitAdminAccess) {
        throw NextResponse.json({ error: `Forbidden: Access denied.` }, { status: 403 });
    }

    return auth;
}
