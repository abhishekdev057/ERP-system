import { NextRequest, NextResponse } from "next/server";
import { enforceToolAccess } from "@/lib/api-auth";
import { upsertWhiteboardSnapshot } from "@/lib/knowledge-index";

export const dynamic = "force-dynamic";

type WhiteboardSnapshotBody = {
    storageKey?: string;
    documentId?: string | null;
    title?: string | null;
    documentTitle?: string | null;
    pageNumber?: number;
    numPages?: number | null;
    summary?: string | null;
    contentText?: string | null;
    snapshotMeta?: Record<string, unknown> | null;
};

function sanitizeText(value: unknown, maxLength: number) {
    return String(value || "").replace(/\s+/g, " ").trim().slice(0, maxLength);
}

export async function POST(request: NextRequest) {
    try {
        const auth = await enforceToolAccess(["whiteboard", "pdf-to-pdf"]);
        const body = (await request.json().catch(() => ({}))) as WhiteboardSnapshotBody;
        const storageKey = sanitizeText(body.storageKey, 180);

        if (!storageKey) {
            return NextResponse.json({ error: "storageKey is required." }, { status: 400 });
        }

        const snapshot = await upsertWhiteboardSnapshot({
            organizationId: auth.organizationId,
            userId: auth.userId,
            storageKey,
            documentId: sanitizeText(body.documentId, 80) || null,
            title: sanitizeText(body.title, 180) || null,
            documentTitle: sanitizeText(body.documentTitle, 180) || null,
            pageNumber: Math.max(1, Number(body.pageNumber || 1)),
            numPages: body.numPages ? Math.max(1, Number(body.numPages)) : null,
            summary: sanitizeText(body.summary, 1000) || null,
            contentText: sanitizeText(body.contentText, 10_000) || null,
            snapshotMeta:
                body.snapshotMeta && typeof body.snapshotMeta === "object"
                    ? body.snapshotMeta
                    : null,
        });

        return NextResponse.json({
            success: true,
            snapshotId: snapshot?.id || null,
        });
    } catch (error) {
        if (error instanceof Response) return error;
        console.error("Failed to sync whiteboard snapshot:", error);
        return NextResponse.json(
            {
                error: error instanceof Error ? error.message : "Failed to sync whiteboard snapshot",
            },
            { status: 500 }
        );
    }
}
