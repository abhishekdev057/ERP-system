import { NextRequest, NextResponse } from "next/server";
import { generatePdf } from "@/lib/pdf-generator";
import { persistPdfDocument } from "@/lib/services/pdf-document-service";
import { validateAndNormalizePdfInput } from "@/lib/pdf-validation";

export const dynamic = "force-dynamic";

type GenerateBody = {
    shouldSave?: boolean;
    documentId?: string;
};

function sanitizeFileName(value: string): string {
    const safe = value.replace(/[\\/:*?"<>|]+/g, "-").trim();
    return safe || "nacc-document";
}

export async function POST(request: NextRequest) {
    try {
        const body = (await request.json()) as Record<string, unknown> & GenerateBody;
        const validation = validateAndNormalizePdfInput(body);

        if (!validation.ok) {
            return NextResponse.json(
                {
                    error: validation.error,
                    issues: validation.issues,
                },
                { status: 400 }
            );
        }

        const normalized = validation.value;
        const shouldSave = body.shouldSave !== false;

        const pdfBuffer = await generatePdf(normalized);

        let documentId = "offline";
        if (shouldSave) {
            const record = await persistPdfDocument(normalized, {
                rawPayload: body,
                documentId: typeof body.documentId === "string" ? body.documentId : undefined,
            });
            documentId = record.id;
        }

        const headers = new Headers();
        const filename = `${sanitizeFileName(normalized.date)}-${sanitizeFileName(normalized.title)}.pdf`;
        headers.set("Content-Type", "application/pdf");
        headers.set("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`);
        headers.set("X-Document-Id", documentId);

        return new NextResponse(new Uint8Array(pdfBuffer), { status: 200, headers });
    } catch (error) {
        console.error("PDF generation error:", error);
        return NextResponse.json(
            {
                error: "Failed to generate PDF",
                details: error instanceof Error ? error.message : String(error),
            },
            { status: 500 }
        );
    }
}
