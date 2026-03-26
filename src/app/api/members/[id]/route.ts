import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { enforceToolAccess } from "@/lib/api-auth";

export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
    try {
        const auth = await enforceToolAccess("pdf-to-pdf");
        const body = await request.json();

        const member = await prisma.user.findUnique({
            where: { id: params.id }
        });

        if (!member || member.organizationId !== auth.organizationId) {
            return NextResponse.json({ error: "Member not found" }, { status: 404 });
        }

        // Only allow certain fields to be explicitly updated by staff hub
        const { name, designation, staffRole, bio, location, dateOfJoining, salaryMonthly } = body;

        const updated = await prisma.user.update({
            where: { id: params.id },
            data: {
                ...(name !== undefined ? { name } : {}),
                ...(designation !== undefined ? { designation } : {}),
                ...(staffRole !== undefined ? { staffRole } : {}),
                ...(bio !== undefined ? { bio } : {}),
                ...(location !== undefined ? { location } : {}),
                ...(dateOfJoining !== undefined ? { dateOfJoining: dateOfJoining ? new Date(dateOfJoining) : null } : {}),
                ...(salaryMonthly !== undefined
                    ? {
                          salaryMonthly:
                              salaryMonthly === null || salaryMonthly === ""
                                  ? null
                                  : Number(salaryMonthly),
                      }
                    : {}),
                updatedAt: new Date(),
            },
            select: {
                id: true,
                name: true,
                designation: true,
                staffRole: true,
                location: true,
                bio: true,
                salaryMonthly: true,
                dateOfJoining: true,
            }
        });

        return NextResponse.json(updated);
    } catch (error: any) {
        if (error instanceof Response) return error;
        console.error("PATCH /api/members/[id] error:", error);
        return NextResponse.json({ error: "Failed to update member" }, { status: 500 });
    }
}

export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
    try {
        const auth = await enforceToolAccess("pdf-to-pdf");

        const member = await prisma.user.findUnique({
            where: { id: params.id },
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
                dateOfJoining: true,
                salaryMonthly: true, // Show salary only on detailed view
                allowedTools: true,
                onboardingDone: true,
                organizationId: true,
                createdAt: true,
                updatedAt: true,
            }
        });

        if (!member || member.organizationId !== auth.organizationId) {
            return NextResponse.json({ error: "Member not found" }, { status: 404 });
        }

        return NextResponse.json(member);
    } catch (error: any) {
        if (error instanceof Response) return error;
        console.error("GET /api/members/[id] error:", error);
        return NextResponse.json({ error: "Failed to fetch member" }, { status: 500 });
    }
}
