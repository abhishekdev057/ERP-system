import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { runPrismaWithReconnect } from "@/lib/prisma";

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
        const userId = (session?.user as any)?.id as string | undefined;

        if (!userId) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const cached = meCache.get(userId);
        if (cached && cached.expiresAt > Date.now()) {
            return NextResponse.json(cached.value);
        }

        const user = await runPrismaWithReconnect((client) =>
            client.user.findUnique({
                where: { id: userId },
                select: {
                    id: true,
                    name: true,
                    email: true,
                    role: true,
                    organization: {
                        select: {
                            name: true,
                            id: true,
                        },
                    },
                },
            })
        );

        if (!user) {
            return NextResponse.json({ error: "User not found" }, { status: 404 });
        }

        const payload: MeResponse = {
            id: user.id,
            name: user.name,
            email: user.email,
            role: user.role,
            organizationName: user.organization?.name || null,
            organizationId: user.organization?.id || null,
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
