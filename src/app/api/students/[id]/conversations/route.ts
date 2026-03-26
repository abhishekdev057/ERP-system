import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { enforceToolAccess } from "@/lib/api-auth";

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
    try {
        const auth = await enforceToolAccess("pdf-to-pdf");
        const body = await request.json();
        
        const { channel, remark, date } = body;

        if (!remark) {
            return NextResponse.json({ error: "Remark is required" }, { status: 400 });
        }

        const student = await prisma.student.findUnique({
            where: { id: params.id }
        });

        if (!student || student.organizationId !== auth.organizationId) {
            return NextResponse.json({ error: "Student not found" }, { status: 404 });
        }

        const conversation = await prisma.studentConversation.create({
            data: {
                studentId: student.id,
                memberId: auth.userId, // Link remark to the current staff member
                channel: channel || "PHONE",
                remark,
                date: date ? new Date(date) : new Date(),
            },
            include: {
                member: { select: { id: true, name: true, image: true, staffRole: true, designation: true } }
            }
        });

        return NextResponse.json(conversation);
    } catch (error: any) {
        if (error instanceof Response) return error;
        console.error("POST /api/students/[id]/conversations error:", error);
        return NextResponse.json({ error: "Failed to add remark" }, { status: 500 });
    }
}
