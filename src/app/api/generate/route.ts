import { NextRequest, NextResponse } from "next/server";
import { generatePdf } from "@/lib/pdf-generator";
import { getPdfDocumentById, persistPdfDocument } from "@/lib/services/pdf-document-service";
import { validateAndNormalizePdfInput } from "@/lib/pdf-validation";
import { requireSession, enforceToolAccess } from "@/lib/api-auth";

export const dynamic = "force-dynamic";

type GenerateBody = {
    shouldSave?: boolean;
    documentId?: string;
};

function sanitizeFileName(value: string): string {
    const safe = value.replace(/[\\/:*?"<>|]+/g, "-").trim();
    return safe || "nexora-document";
}

export async function POST(request: NextRequest) {
    console.log(`[API Generate] Request received. Method: ${request.method}, URL: ${request.url}`);

    try {
        await enforceToolAccess("pdf-to-pdf");

        const reqText = await request.text();
        console.log(`[API Generate] Request body length: ${(reqText.length / 1024 / 1024).toFixed(2)} MB`);

        const body = JSON.parse(reqText) as Record<string, unknown> & GenerateBody;
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
            const auth = await requireSession();
            const requestedDocumentId =
                typeof body.documentId === "string" && body.documentId.trim()
                    ? body.documentId.trim()
                    : undefined;

            if (auth.role === "MEMBER") {
                if (!requestedDocumentId) {
                    return NextResponse.json(
                        { error: "Members can only update documents assigned by admin." },
                        { status: 403 }
                    );
                }
                const existing = await getPdfDocumentById(
                    requestedDocumentId,
                    auth.organizationId,
                    auth.userId,
                    auth.role
                );
                if (!existing) {
                    return NextResponse.json({ error: "Document not found or not assigned." }, { status: 403 });
                }
            }

            const record = await persistPdfDocument(normalized, {
                rawPayload: body,
                documentId: requestedDocumentId,
                organizationId: auth.organizationId,
                userId: auth.userId,
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
        if (error instanceof Response) return error;
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
