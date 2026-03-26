import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { enforceToolAccess } from "@/lib/api-auth";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
    try {
        const auth = await enforceToolAccess("pdf-to-pdf");
        
        const { searchParams } = new URL(request.url);
        const status = searchParams.get("status");

        const students = await prisma.student.findMany({
            where: {
                organizationId: auth.organizationId as string,
                ...(status ? { status: status as any } : {}),
            },
            include: {
                assignedUser: { select: { id: true, name: true, image: true, designation: true } }
            },
            orderBy: { createdAt: 'desc' }
        });

        return NextResponse.json(students);
    } catch (error: any) {
        if (error instanceof Response) return error;
        console.error("GET /api/students error:", error);
        return NextResponse.json({ error: "Failed to fetch students" }, { status: 500 });
    }
}

export async function POST(request: NextRequest) {
    try {
        const auth = await enforceToolAccess("pdf-to-pdf");
        const body = await request.json();

        const { name, phone, email, classLevel, location, leadConfidence, status, tags } = body;
        
        if (!name) {
            return NextResponse.json({ error: "Student name is required" }, { status: 400 });
        }

        const student = await prisma.student.create({
            data: {
                name,
                phone,
                email,
                classLevel,
                location,
                leadConfidence: leadConfidence || null,
                status: status || "LEAD",
                tags: Array.isArray(tags) ? tags : [],
                organizationId: auth.organizationId as string,
            }
        });

        return NextResponse.json(student);
    } catch (error: any) {
        if (error instanceof Response) return error;
        console.error("POST /api/students error:", error);
        return NextResponse.json({ error: "Failed to create student" }, { status: 500 });
    }
}
