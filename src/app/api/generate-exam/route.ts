import { NextRequest, NextResponse } from "next/server";
import { generateExamPdf } from "@/lib/exam-pdf-generator";
import { requireSession } from "@/lib/api-auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

function sanitize(v: string | undefined): string {
    return (v || "exam-paper").replace(/[\\/:"*?<>|]+/g, "-").trim();
}

function normalizeExamTitle(title: string | undefined, subject: string | undefined): string {
    const cleanTitle = String(title || "").trim();
    if (!cleanTitle || cleanTitle.toLowerCase() === "extracted question set") {
        return String(subject || "").trim() || "Exam Paper";
    }
    return cleanTitle;
}

export async function POST(request: NextRequest) {
    try {
        const data = await request.json();
        const auth = await requireSession();

        if (!data || !Array.isArray(data.questions)) {
            return NextResponse.json({ error: "Invalid payload: questions array required" }, { status: 400 });
        }

        const organization = auth.organizationId
            ? await prisma.organization.findUnique({
                where: { id: auth.organizationId },
                select: {
                    name: true,
                    logo: true,
                },
            })
            : null;

        const preparedData = {
            ...data,
            title: normalizeExamTitle(data.title, data.subject),
            instituteName: String(data.instituteName || organization?.name || "").trim(),
            logoPath: typeof data.logoPath === "string" && data.logoPath.trim()
                ? data.logoPath.trim()
                : organization?.logo || undefined,
            includeAnswers: data.includeAnswers === true,
            includeSections: data.includeSections === true,
        };

        const pdfBuffer = await generateExamPdf(preparedData);

        const filename = `${sanitize(preparedData.title)}-Exam-Paper.pdf`;
        const headers = new Headers();
        headers.set("Content-Type", "application/pdf");
        headers.set("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`);

        return new NextResponse(new Uint8Array(pdfBuffer), { status: 200, headers });
    } catch (error) {
        console.error("[generate-exam] Error:", error);
        return NextResponse.json(
            {
                error: "Failed to generate exam PDF",
                details: error instanceof Error ? error.message : String(error),
            },
            { status: 500 }
        );
    }
}
