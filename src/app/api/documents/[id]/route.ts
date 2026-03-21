import { NextRequest, NextResponse } from "next/server";
import { generatePdf } from "@/lib/pdf-generator";
import {
    deletePdfDocumentById,
    getPdfDocumentById,
} from "@/lib/services/pdf-document-service";
import { validateAndNormalizePdfInput } from "@/lib/pdf-validation";
import { enforceToolAccess } from "@/lib/api-auth";

export const dynamic = "force-dynamic";

function sanitizeFileName(value: string): string {
    const safe = value.replace(/[\\/:*?"<>|]+/g, "-").trim();
    return safe || "nexora-document";
}

export async function GET(
    request: NextRequest,
    { params }: { params: { id: string } }
) {
    try {
        const auth = await enforceToolAccess("pdf-to-pdf");

        const document = await getPdfDocumentById(params.id, auth.organizationId, auth.userId, auth.role);

        if (!document) {
            return NextResponse.json({ error: "Document not found" }, { status: 404 });
        }

        return NextResponse.json({ document });
    } catch (error) {
        if (error instanceof Response) return error;
        console.error("Failed to fetch document:", error);
        const message = error instanceof Error ? error.message : String(error);
        if (/unauthorized|not authorized/i.test(message)) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
        }
        return NextResponse.json({ error: "Database unavailable" }, { status: 500 });
    }
}

export async function POST(
    request: NextRequest,
    { params }: { params: { id: string } }
) {
    try {
        const auth = await enforceToolAccess("pdf-to-pdf");

        const document = await getPdfDocumentById(params.id, auth.organizationId, auth.userId, auth.role);

        if (!document) {
            return NextResponse.json({ error: "Document not found" }, { status: 404 });
        }

        const validation = validateAndNormalizePdfInput(document.jsonData);
        if (!validation.ok) {
            return NextResponse.json(
                {
                    error: "Stored document payload is invalid",
                    issues: validation.issues,
                },
                { status: 422 }
            );
        }

        const pdfInput = validation.value;
        const pdfBuffer = await generatePdf(pdfInput);

        const headers = new Headers();
        const filename = `${sanitizeFileName(pdfInput.date)}-${sanitizeFileName(pdfInput.title)}.pdf`;
        headers.set("Content-Type", "application/pdf");
        headers.set("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`);
        headers.set("X-Document-Id", document.id);

        return new NextResponse(new Uint8Array(pdfBuffer), { status: 200, headers });
    } catch (error) {
        if (error instanceof Response) return error;
        console.error("Regeneration error:", error);
        const message = error instanceof Error ? error.message : String(error);
        if (/unauthorized|not authorized/i.test(message)) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
        }
        return NextResponse.json({ error: "Failed to regenerate PDF" }, { status: 500 });
    }
}

export async function DELETE(
    request: NextRequest,
    { params }: { params: { id: string } }
) {
    try {
        const auth = await enforceToolAccess("pdf-to-pdf");

        await deletePdfDocumentById(params.id, auth.organizationId, auth.userId, auth.role);
        return NextResponse.json({ success: true });
    } catch (error) {
        if (error instanceof Response) return error;
        console.error("Delete error:", error);
        const message = error instanceof Error ? error.message : String(error);
        if (/not found/i.test(message)) {
            return NextResponse.json({ error: "Document not found" }, { status: 404 });
        }
        if (/unauthorized|not authorized/i.test(message)) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
        }
        return NextResponse.json({ error: "Failed to delete document" }, { status: 500 });
    }
}
