import { NextRequest, NextResponse } from "next/server";
import { generateExamPdf } from "@/lib/exam-pdf-generator";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

function sanitize(v: string | undefined): string {
    return (v || "exam-paper").replace(/[\\/:"*?<>|]+/g, "-").trim();
}

export async function POST(request: NextRequest) {
    try {
        const data = await request.json();

        if (!data || !Array.isArray(data.questions)) {
            return NextResponse.json({ error: "Invalid payload: questions array required" }, { status: 400 });
        }

        const pdfBuffer = await generateExamPdf(data);

        const filename = `${sanitize(data.title)}-Exam-Paper.pdf`;
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
