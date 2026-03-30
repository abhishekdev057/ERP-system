import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
export const dynamic = "force-dynamic";

type MeResponse = {
    id: string;
    name: string | null;
    email: string | null;
    role: string | null;
    organizationName: string | null;
    organizationId: string | null;
};

const meCache =
    (globalThis as typeof globalThis & {
        __meApiCache?: Map<string, { value: MeResponse; expiresAt: number }>;
    }).__meApiCache ?? new Map<string, { value: MeResponse; expiresAt: number }>();

if (!(globalThis as typeof globalThis & { __meApiCache?: Map<string, { value: MeResponse; expiresAt: number }> }).__meApiCache) {
    (globalThis as typeof globalThis & { __meApiCache?: Map<string, { value: MeResponse; expiresAt: number }> }).__meApiCache = meCache;
}

const ME_CACHE_TTL_MS = 10_000;

export async function GET() {
    try {
        const session = await getServerSession(authOptions);
        const sessionUser = session?.user as any;
        const userId = sessionUser?.id as string | undefined;

        if (!userId) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const cached = meCache.get(userId);
        if (cached && cached.expiresAt > Date.now()) {
            return NextResponse.json(cached.value);
        }

        const payload: MeResponse = {
            id: userId,
            name: sessionUser?.name || null,
            email: sessionUser?.email || null,
            role: sessionUser?.role || null,
            organizationName: sessionUser?.organizationName || null,
            organizationId: sessionUser?.organizationId || null,
        };

        meCache.set(userId, {
            value: payload,
            expiresAt: Date.now() + ME_CACHE_TTL_MS,
        });

        return NextResponse.json(payload);
    } catch (error) {
        console.error("Error fetching user profile:", error);
        return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
    }
}
