import { NextRequest, NextResponse } from "next/server";
import { enforceToolAccess } from "@/lib/api-auth";
import { updatePdfDocumentAssignments } from "@/lib/services/pdf-document-service";
import { resolveAssignedUserIds } from "@/lib/document-metadata";

export const dynamic = "force-dynamic";

type AssignBody = {
    userIds?: string[];
};

export async function POST(
    request: NextRequest,
    { params }: { params: { id: string } }
) {
    try {
        const auth = await enforceToolAccess("pdf-to-pdf");
        if (auth.role !== "ORG_ADMIN" && auth.role !== "SYSTEM_ADMIN") {
            return NextResponse.json({ error: "Only admins can assign documents." }, { status: 403 });
        }

        const body = (await request.json()) as AssignBody;
        const userIds = Array.isArray(body.userIds) ? body.userIds : [];

        const updated = await updatePdfDocumentAssignments(
            params.id,
            auth.organizationId,
            auth.role,
            userIds
        );

        return NextResponse.json({
            success: true,
            documentId: updated.id,
            assignedUserIds: resolveAssignedUserIds(updated.jsonData, updated.assignedUserIds),
        });
    } catch (error) {
        console.error("Failed to assign document:", error);
        const message = error instanceof Error ? error.message : String(error);
        if (/not found/i.test(message)) {
            return NextResponse.json({ error: "Document not found" }, { status: 404 });
        }
        if (/unauthorized|not authorized|forbidden/i.test(message)) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
        }
        return NextResponse.json({ error: message || "Assignment failed" }, { status: 500 });
    }
}
