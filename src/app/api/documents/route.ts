import { NextRequest, NextResponse } from "next/server";
import { listPdfDocuments, normalizePagination } from "@/lib/services/pdf-document-service";

export const dynamic = "force-dynamic";

type WorkspaceType = "IMAGE_TO_PDF" | "JSON_TO_PDF";

function detectWorkspaceType(jsonData: unknown): WorkspaceType {
    if (!jsonData || typeof jsonData !== "object") return "JSON_TO_PDF";

    const payload = jsonData as Record<string, unknown>;
    const sourceImages = Array.isArray(payload.sourceImages) ? payload.sourceImages : [];
    const extractionWarnings = Array.isArray(payload.extractionWarnings)
        ? payload.extractionWarnings
        : [];
    const extractionProcessingSteps = Array.isArray(payload.extractionProcessingSteps)
        ? payload.extractionProcessingSteps
        : [];
    const assistantMessages = Array.isArray(payload.assistantMessages)
        ? payload.assistantMessages
        : [];
    const questions = Array.isArray(payload.questions) ? payload.questions : [];

    const hasImageLinkedQuestions = questions.some((item) => {
        if (!item || typeof item !== "object") return false;
        const question = item as Record<string, unknown>;
        return Boolean(question.sourceImagePath || question.diagramImagePath || question.autoDiagramImagePath);
    });

    const isImageWorkspace =
        sourceImages.length > 0 ||
        extractionWarnings.length > 0 ||
        extractionProcessingSteps.length > 0 ||
        assistantMessages.length > 0 ||
        hasImageLinkedQuestions;

    return isImageWorkspace ? "IMAGE_TO_PDF" : "JSON_TO_PDF";
}

export async function GET(req: NextRequest) {
    try {
        const searchParams = req.nextUrl.searchParams;
        const { limit, offset } = normalizePagination(
            searchParams.get("limit"),
            searchParams.get("offset")
        );
        const minimal = searchParams.get("minimal") === "true";

        const rawDocuments = await listPdfDocuments({
            limit,
            offset,
            minimal,
        });

        const documents = rawDocuments.map((document) => {
            const record = document as typeof document & { jsonData?: unknown };
            const workspaceType = detectWorkspaceType(record.jsonData);

            if (minimal) {
                const { jsonData: _jsonData, ...rest } = record;
                return {
                    ...rest,
                    workspaceType,
                };
            }

            return {
                ...record,
                workspaceType,
            };
        });

        return NextResponse.json({ documents });
    } catch (error) {
        console.error("Failed to fetch documents:", error);
        return NextResponse.json(
            { documents: [], error: "Database unavailable" },
            { status: 200 }
        );
    }
}
