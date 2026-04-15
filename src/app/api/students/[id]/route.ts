import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { enforceToolAccess } from "@/lib/api-auth";
import { scheduleKnowledgeIndexRefresh } from "@/lib/knowledge-index";
import {
    cleanStudentCode,
    cleanStudentEmail,
    cleanStudentPhone,
    cleanStudentStringArray,
    cleanStudentText,
    cleanStudentUrl,
    normalizeStudentGender,
    parseStudentDate,
    parseStudentMoney,
} from "@/lib/student-profile";

export const dynamic = "force-dynamic";
const STUDENT_STATUS_VALUES = ["LEAD", "ACTIVE", "ALUMNI", "DROPOUT"] as const;
const LEAD_CONFIDENCE_VALUES = ["COLD", "WARM", "HOT"] as const;

function hasOwn(input: Record<string, unknown>, key: string) {
    return Object.prototype.hasOwnProperty.call(input, key);
}

export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
    try {
        const auth = await enforceToolAccess("pdf-to-pdf");
        const body = (await request.json()) as Record<string, unknown>;

        const student = await prisma.student.findUnique({
            where: { id: params.id }
        });

        if (!student || student.organizationId !== auth.organizationId) {
            return NextResponse.json({ error: "Student not found" }, { status: 404 });
        }

        const data: Record<string, unknown> = {};

        if (hasOwn(body, "name")) {
            const name = cleanStudentText(body.name);
            if (!name) {
                return NextResponse.json({ error: "Student name is required" }, { status: 400 });
            }
            data.name = name;
        }

        if (hasOwn(body, "studentCode")) data.studentCode = cleanStudentCode(body.studentCode);
        if (hasOwn(body, "guardianName")) data.guardianName = cleanStudentText(body.guardianName);
        if (hasOwn(body, "dateOfBirth")) data.dateOfBirth = parseStudentDate(body.dateOfBirth);
        if (hasOwn(body, "gender")) data.gender = normalizeStudentGender(body.gender);
        if (hasOwn(body, "phone")) data.phone = cleanStudentPhone(body.phone);
        if (hasOwn(body, "parentPhone")) data.parentPhone = cleanStudentPhone(body.parentPhone);
        if (hasOwn(body, "email")) data.email = cleanStudentEmail(body.email);
        if (hasOwn(body, "addressLine")) data.addressLine = cleanStudentText(body.addressLine);
        if (hasOwn(body, "pinCode")) data.pinCode = cleanStudentText(body.pinCode);
        if (hasOwn(body, "aadhaarOrIdNumber")) data.aadhaarOrIdNumber = cleanStudentText(body.aadhaarOrIdNumber);
        if (hasOwn(body, "idProofUrl")) data.idProofUrl = cleanStudentUrl(body.idProofUrl);
        if (hasOwn(body, "photoUrl")) data.photoUrl = cleanStudentUrl(body.photoUrl);
        if (hasOwn(body, "galleryImageUrls")) data.galleryImageUrls = cleanStudentStringArray(body.galleryImageUrls);
        if (hasOwn(body, "admissionDate")) data.admissionDate = parseStudentDate(body.admissionDate);
        if (hasOwn(body, "courseEnrolled")) data.courseEnrolled = cleanStudentText(body.courseEnrolled);
        if (hasOwn(body, "batchId")) data.batchId = cleanStudentText(body.batchId);
        if (hasOwn(body, "totalFees")) data.totalFees = parseStudentMoney(body.totalFees);
        if (hasOwn(body, "location")) data.location = cleanStudentText(body.location);
        if (hasOwn(body, "classLevel")) data.classLevel = cleanStudentText(body.classLevel);
        if (hasOwn(body, "status")) {
            const nextStatus = cleanStudentText(body.status);
            data.status = STUDENT_STATUS_VALUES.includes(nextStatus as (typeof STUDENT_STATUS_VALUES)[number])
                ? nextStatus
                : student.status;
        }
        if (hasOwn(body, "leadConfidence")) {
            const nextLeadConfidence = cleanStudentText(body.leadConfidence);
            data.leadConfidence = LEAD_CONFIDENCE_VALUES.includes(nextLeadConfidence as (typeof LEAD_CONFIDENCE_VALUES)[number])
                ? nextLeadConfidence
                : null;
        }
        if (hasOwn(body, "tags")) {
            data.tags = Array.isArray(body.tags)
                ? body.tags.map((item) => cleanStudentText(item)).filter(Boolean)
                : [];
        }

        if (hasOwn(body, "addressLine") && !hasOwn(body, "location")) {
            data.location = cleanStudentText(body.addressLine);
        }

        const updated = await prisma.student.update({
            where: { id: params.id },
            data: {
                ...data,
                updatedAt: new Date(),
            },
            include: {
                assignedUser: { select: { id: true, name: true, image: true, designation: true } },
            },
        });

        void scheduleKnowledgeIndexRefresh(student.organizationId).catch((error) => {
            console.error("Student update knowledge refresh failed:", error);
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
                feeAudits: {
                    include: { member: { select: { id: true, name: true, image: true, designation: true } } },
                    orderBy: { effectiveDate: "desc" },
                },
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

export async function DELETE(request: NextRequest, { params }: { params: { id: string } }) {
    try {
        const auth = await enforceToolAccess("pdf-to-pdf");

        const student = await prisma.student.findUnique({
            where: { id: params.id },
            select: { id: true, organizationId: true, name: true },
        });

        if (!student || student.organizationId !== auth.organizationId) {
            return NextResponse.json({ error: "Student not found" }, { status: 404 });
        }

        await prisma.student.delete({
            where: { id: params.id },
        });

        void scheduleKnowledgeIndexRefresh(student.organizationId).catch((error) => {
            console.error("Student delete knowledge refresh failed:", error);
        });

        return NextResponse.json({ success: true, id: params.id, name: student.name });
    } catch (error: any) {
        if (error instanceof Response) return error;
        console.error("DELETE /api/students/[id] error:", error);
        return NextResponse.json({ error: "Failed to delete student" }, { status: 500 });
    }
}
