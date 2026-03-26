import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { enforceToolAccess } from "@/lib/api-auth";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
    try {
        const auth = await enforceToolAccess("pdf-to-pdf");
        
        const members = await prisma.user.findMany({
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
            orderBy: { createdAt: 'desc' }
        });

        return NextResponse.json(members);
    } catch (error: any) {
        if (error instanceof Response) return error;
        console.error("GET /api/members error:", error);
        return NextResponse.json({ error: "Failed to fetch members" }, { status: 500 });
    }
}
