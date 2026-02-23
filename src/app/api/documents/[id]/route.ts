import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { generatePdf, PdfInput } from "@/lib/pdf-generator";

export async function GET(
    request: NextRequest,
    { params }: { params: { id: string } }
) {
    try {
        const document = await prisma.pdfDocument.findUnique({
            where: { id: params.id },
        });

        if (!document) {
            return NextResponse.json(
                { error: "Document not found" },
                { status: 404 }
            );
        }

        return NextResponse.json({ document });
    } catch (error) {
        console.error("Failed to fetch document:", error);
        return NextResponse.json(
            { error: "Database unavailable" },
            { status: 500 }
        );
    }
}

export async function POST(
    request: NextRequest,
    { params }: { params: { id: string } }
) {
    try {
        const document = await prisma.pdfDocument.findUnique({
            where: { id: params.id },
        });

        if (!document) {
            return NextResponse.json(
                { error: "Document not found" },
                { status: 404 }
            );
        }

        const jsonData = document.jsonData as Record<string, any>;
        const pdfInput: PdfInput = {
            title: (jsonData.title as string) || document.title,
            date: (jsonData.date as string) || document.date,
            instituteName: (jsonData.instituteName as string) || "NACC AGRICULTURE INSTITUTE",
            questions: jsonData.questions as PdfInput["questions"],
            templateId: (jsonData.templateId as string) || "professional",
        };

        const pdfBuffer = await generatePdf(pdfInput);

        const headers = new Headers();
        const filename = `${pdfInput.date}-${pdfInput.title}.pdf`;
        headers.set("Content-Type", "application/pdf");
        headers.set("Content-Disposition", `attachment; filename="${filename}"`);

        return new NextResponse(new Uint8Array(pdfBuffer), { status: 200, headers });
    } catch (error) {
        console.error("Regeneration error:", error);
        return NextResponse.json(
            { error: "Failed to regenerate PDF" },
            { status: 500 }
        );
    }
}

export async function DELETE(
    request: NextRequest,
    { params }: { params: { id: string } }
) {
    try {
        await prisma.pdfDocument.delete({
            where: { id: params.id },
        });

        return NextResponse.json({ success: true });
    } catch (error) {
        console.error("Delete error:", error);
        return NextResponse.json(
            { error: "Failed to delete document" },
            { status: 500 }
        );
    }
}
