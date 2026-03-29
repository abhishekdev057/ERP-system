import { NextResponse } from "next/server";
import { requireSession } from "@/lib/api-auth";
import { runPrismaWithReconnect } from "@/lib/prisma";

export const dynamic = "force-dynamic";

type OrgMembersResponse = {
    members: Array<{
        id: string;
        name: string | null;
        email: string | null;
        username: string | null;
        designation: string | null;
    }>;
};

const orgMembersCache =
    (globalThis as typeof globalThis & {
        __orgMembersApiCache?: Map<string, { value: OrgMembersResponse; expiresAt: number }>;
    }).__orgMembersApiCache ?? new Map<string, { value: OrgMembersResponse; expiresAt: number }>();

if (!(globalThis as typeof globalThis & { __orgMembersApiCache?: Map<string, { value: OrgMembersResponse; expiresAt: number }> }).__orgMembersApiCache) {
    (globalThis as typeof globalThis & { __orgMembersApiCache?: Map<string, { value: OrgMembersResponse; expiresAt: number }> }).__orgMembersApiCache =
        orgMembersCache;
}

const ORG_MEMBERS_CACHE_TTL_MS = 10_000;

export async function GET() {
    try {
        const auth = await requireSession();
        if (auth.role !== "ORG_ADMIN" && auth.role !== "SYSTEM_ADMIN") {
            return NextResponse.json({ error: "Forbidden" }, { status: 403 });
        }

        const cacheKey = `${auth.role}:${auth.organizationId || "system"}`;
        const cached = orgMembersCache.get(cacheKey);
        if (cached && cached.expiresAt > Date.now()) {
            return NextResponse.json(cached.value);
        }

        const where =
            auth.role === "SYSTEM_ADMIN"
                ? { role: "MEMBER" as const }
                : {
                    organizationId: auth.organizationId,
                    role: "MEMBER" as const,
                };

        const members = await runPrismaWithReconnect((client) =>
            client.user.findMany({
                where,
                orderBy: { createdAt: "desc" },
                select: {
                    id: true,
                    name: true,
                    email: true,
                    username: true,
                    designation: true,
                },
            })
        );

        const payload = { members };
        orgMembersCache.set(cacheKey, {
            value: payload,
            expiresAt: Date.now() + ORG_MEMBERS_CACHE_TTL_MS,
        });

        return NextResponse.json(payload);
    } catch (error) {
        console.error("Failed to fetch organization members:", error);
        return NextResponse.json({ members: [], error: "Failed to fetch members" }, { status: 500 });
    }
}
