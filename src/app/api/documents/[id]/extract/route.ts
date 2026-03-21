import { NextRequest, NextResponse } from "next/server";
import { enforceToolAccess } from "@/lib/api-auth";
import { getPdfDocumentById } from "@/lib/services/pdf-document-service";
import {
    queueDocumentExtractionJob,
} from "@/lib/services/pdf-extraction-job-service";

export const dynamic = "force-dynamic";

function normalizeIndices(value: unknown): number[] {
    if (!Array.isArray(value)) return [];

    return Array.from(
        new Set(
            value
                .map((item) => Number.parseInt(String(item), 10))
                .filter((item) => Number.isFinite(item) && item >= 0)
        )
    ).sort((left, right) => left - right);
}

export async function POST(
    request: NextRequest,
    { params }: { params: { id: string } }
) {
    try {
        const auth = await enforceToolAccess("pdf-to-pdf");
        const document = await getPdfDocumentById(
            params.id,
            auth.organizationId,
            auth.userId,
            auth.role
        );

        if (!document) {
            return NextResponse.json({ error: "Document not found" }, { status: 404 });
        }

        const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
        const indices = normalizeIndices(body.indices);
        const payload =
            document.jsonData && typeof document.jsonData === "object"
                ? (document.jsonData as Record<string, unknown>)
                : {};
        const sourceImages = Array.isArray(payload.sourceImages) ? payload.sourceImages : [];

        if (indices.length === 0) {
            return NextResponse.json({ error: "At least one page index is required." }, { status: 400 });
        }

        const invalidIndex = indices.find((index) => index < 0 || index >= sourceImages.length);
        if (invalidIndex !== undefined) {
            return NextResponse.json(
                { error: `Page index ${invalidIndex + 1} is outside the current workspace.` },
                { status: 400 }
            );
        }

        const origin = request.nextUrl.origin;
        const cookieHeader = request.headers.get("cookie") || undefined;
        const queued = await queueDocumentExtractionJob({
            documentId: document.id,
            jsonData: document.jsonData,
            indices,
            origin,
            cookieHeader,
        });

        if (!queued.started) {
            return NextResponse.json(
                {
                    job: queued.job,
                    error: "Extraction is already running for this workspace.",
                },
                { status: 409 }
            );
        }

        return NextResponse.json({
            job: queued.job,
            documentId: document.id,
        });
    } catch (error) {
        if (error instanceof Response) return error;
        console.error("Failed to queue document extraction:", error);
        const message = error instanceof Error ? error.message : String(error);
        if (/unauthorized|not authorized/i.test(message)) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
        }
        return NextResponse.json(
            {
                error: "Failed to start extraction job",
                details: message,
            },
            { status: 500 }
        );
    }
}
