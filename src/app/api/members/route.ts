import { NextRequest, NextResponse } from "next/server";
import { runPrismaWithReconnect } from "@/lib/prisma";
import { enforceToolAccess } from "@/lib/api-auth";

export const dynamic = "force-dynamic";

const membersCache =
    (globalThis as typeof globalThis & {
        __membersApiCache?: Map<string, { value: unknown; expiresAt: number }>;
    }).__membersApiCache ?? new Map<string, { value: unknown; expiresAt: number }>();

if (!(globalThis as typeof globalThis & { __membersApiCache?: Map<string, { value: unknown; expiresAt: number }> }).__membersApiCache) {
    (globalThis as typeof globalThis & { __membersApiCache?: Map<string, { value: unknown; expiresAt: number }> }).__membersApiCache =
        membersCache;
}

const MEMBERS_CACHE_TTL_MS = 10_000;

export async function GET(request: NextRequest) {
    try {
        const auth = await enforceToolAccess("pdf-to-pdf");

        const cacheKey = auth.organizationId || "global";
        const cached = membersCache.get(cacheKey);
        if (cached && cached.expiresAt > Date.now()) {
            return NextResponse.json(cached.value);
        }
        
        const members = await runPrismaWithReconnect((client) =>
            client.user.findMany({
                where: {
                    organizationId: auth.organizationId,
                },
                select: {
                    id: true,
                    name: true,
                    email: true,
                    image: true,
                    role: true,
                    designation: true,
                    staffRole: true,
                    bio: true,
                    location: true,
                    allowedTools: true,
                    salaryMonthly: true,
                    dateOfJoining: true,
                    onboardingDone: true,
                    createdAt: true,
                    updatedAt: true,
                },
                orderBy: { createdAt: "desc" },
            })
        );

        membersCache.set(cacheKey, {
            value: members,
            expiresAt: Date.now() + MEMBERS_CACHE_TTL_MS,
        });

        return NextResponse.json(members);
    } catch (error: any) {
        if (error instanceof Response) return error;
        console.error("GET /api/members error:", error);
        return NextResponse.json({ error: "Failed to fetch members" }, { status: 500 });
    }
}
