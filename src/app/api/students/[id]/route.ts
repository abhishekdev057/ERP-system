import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { enforceToolAccess } from "@/lib/api-auth";

export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
    try {
        const auth = await enforceToolAccess("pdf-to-pdf");
        const body = await request.json();

        const student = await prisma.student.findUnique({
            where: { id: params.id }
        });

        if (!student || student.organizationId !== auth.organizationId) {
            return NextResponse.json({ error: "Student not found" }, { status: 404 });
        }

        const updated = await prisma.student.update({
            where: { id: params.id },
            data: {
                ...body,
                updatedAt: new Date(),
            }
        });

        return NextResponse.json(updated);
    } catch (error: any) {
        if (error instanceof Response) return error;
        console.error("PATCH /api/students/[id] error:", error);
        return NextResponse.json({ error: "Failed to update student" }, { status: 500 });
    }
}

export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
    try {
        const auth = await enforceToolAccess("pdf-to-pdf");

        const student = await prisma.student.findUnique({
            where: { id: params.id },
            include: {
                conversations: {
                    include: { member: { select: { id: true, name: true, image: true, staffRole: true, designation: true } } },
                    orderBy: { date: 'desc' }
                },
                assignedUser: { select: { id: true, name: true, image: true, designation: true } }
            }
        });

        if (!student || student.organizationId !== auth.organizationId) {
            return NextResponse.json({ error: "Student not found" }, { status: 404 });
        }

        return NextResponse.json(student);
    } catch (error: any) {
        if (error instanceof Response) return error;
        console.error("GET /api/students/[id] error:", error);
        return NextResponse.json({ error: "Failed to fetch student" }, { status: 500 });
    }
}
