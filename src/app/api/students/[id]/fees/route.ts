import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { enforceToolAccess } from "@/lib/api-auth";
import { parseStudentDate, parseStudentMoney, cleanStudentText } from "@/lib/student-profile";
import { STUDENT_FEE_AUDIT_TYPES } from "@/lib/student-fees";
import { scheduleKnowledgeIndexRefresh } from "@/lib/knowledge-index";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
    try {
        const auth = await enforceToolAccess("pdf-to-pdf");
        const body = (await request.json()) as Record<string, unknown>;
        const student = await prisma.student.findUnique({
            where: { id: params.id },
            select: { id: true, organizationId: true },
        });

        if (!student || student.organizationId !== auth.organizationId) {
            return NextResponse.json({ error: "Student not found" }, { status: 404 });
        }

        const type = cleanStudentText(body.type);
        const note = cleanStudentText(body.note);
        const amount = parseStudentMoney(body.amount);
        const effectiveDate = parseStudentDate(body.effectiveDate) || new Date();

        if (!STUDENT_FEE_AUDIT_TYPES.includes(type as any)) {
            return NextResponse.json({ error: "Valid fee audit type is required." }, { status: 400 });
        }

        if (type !== "NOTE" && amount === null) {
            return NextResponse.json({ error: "Amount is required for this fee entry." }, { status: 400 });
        }

        const feeAudit = await prisma.studentFeeAudit.create({
            data: {
                studentId: student.id,
                organizationId: auth.organizationId as string,
                memberId: auth.userId || null,
                type: type as any,
                amount,
                note,
                effectiveDate,
            },
            include: {
                member: { select: { id: true, name: true, image: true, designation: true } },
            },
        });

        void scheduleKnowledgeIndexRefresh(student.organizationId).catch((error) => {
            console.error("Student fee knowledge refresh failed:", error);
        });

        return NextResponse.json(feeAudit);
    } catch (error: any) {
        if (error instanceof Response) return error;
        console.error("POST /api/students/[id]/fees error:", error);
        return NextResponse.json({ error: "Failed to add fee audit entry" }, { status: 500 });
    }
}
