import { NextResponse } from "next/server";
import { requireSession } from "@/lib/api-auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function GET() {
    try {
        const auth = await requireSession();
        if (auth.role !== "ORG_ADMIN" && auth.role !== "SYSTEM_ADMIN") {
            return NextResponse.json({ error: "Forbidden" }, { status: 403 });
        }

        const where =
            auth.role === "SYSTEM_ADMIN"
                ? { role: "MEMBER" as const }
                : {
                    organizationId: auth.organizationId,
                    role: "MEMBER" as const,
                };

        const members = await prisma.user.findMany({
            where,
            orderBy: { createdAt: "desc" },
            select: {
                id: true,
                name: true,
                email: true,
                username: true,
                designation: true,
            },
        });

        return NextResponse.json({ members });
    } catch (error) {
        console.error("Failed to fetch organization members:", error);
        return NextResponse.json({ members: [], error: "Failed to fetch members" }, { status: 500 });
    }
}
