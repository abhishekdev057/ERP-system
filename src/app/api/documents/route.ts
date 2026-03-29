import { NextRequest, NextResponse } from "next/server";
import {
    listPdfDocuments,
    normalizeDocumentSort,
    normalizePagination,
} from "@/lib/services/pdf-document-service";
import { enforceToolAccess } from "@/lib/api-auth";
import { extractCorrectionMarkCount, extractDocumentWorkspaceStats } from "@/lib/document-metadata";
export const dynamic = "force-dynamic";

type WorkspaceType = "IMAGE_TO_PDF" | "JSON_TO_PDF" | "PDF_TO_PDF";

function detectWorkspaceType(jsonData: unknown): WorkspaceType {
    if (!jsonData || typeof jsonData !== "object") return "JSON_TO_PDF";

    const payload = jsonData as Record<string, unknown>;

    if (payload.sourceType === "PDF") {
        return "PDF_TO_PDF";
    }
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
        const auth = await enforceToolAccess("pdf-to-pdf");
        const organizationId = auth.organizationId;

        const searchParams = req.nextUrl.searchParams;
        const { limit, offset } = normalizePagination(
            searchParams.get("limit"),
            searchParams.get("offset")
        );
        const { sortBy, sortOrder } = normalizeDocumentSort(
            searchParams.get("sortBy"),
            searchParams.get("sortOrder")
        );
        const minimal = searchParams.get("minimal") === "true";
        const includeWorkspaceStats = searchParams.get("workspaceStats") === "true";
        const searchQuery = String(searchParams.get("q") || "").slice(0, 160).trim();
        const assigneeFilter = String(searchParams.get("assignee") || "").slice(0, 120).trim();

        const rawDocuments = await listPdfDocuments({
            limit,
            offset,
            minimal,
            includeWorkspaceStats,
            organizationId,
            userId: auth.userId,
            role: auth.role,
            sortBy,
            sortOrder,
            searchQuery,
            assigneeFilter: assigneeFilter || null,
        });

        const documents = rawDocuments.documents.map((document) => {
            const record = document as typeof document & { jsonData?: unknown };
            const workspaceType = record.jsonData
                ? detectWorkspaceType(record.jsonData)
                : "PDF_TO_PDF";

            if (minimal) {
                const { jsonData: _jsonData, ...rest } = record;
                const workspaceStats = includeWorkspaceStats
                    ? extractDocumentWorkspaceStats(record.jsonData)
                    : undefined;
                return {
                    ...rest,
                    workspaceType,
                    assignedUserIds: Array.isArray(record.assignedUserIds)
                        ? record.assignedUserIds
                        : [],
                    correctionMarkCount: record.jsonData
                        ? extractCorrectionMarkCount(record.jsonData)
                        : 0,
                    workspaceStats,
                };
            }

            return {
                ...record,
                workspaceType,
            };
        });

        return NextResponse.json({
            documents,
            pagination: {
                total: rawDocuments.total,
                limit,
                offset,
                page: Math.floor(offset / limit) + 1,
                totalPages: Math.max(1, Math.ceil(rawDocuments.total / limit)),
                hasMore: offset + documents.length < rawDocuments.total,
            },
        });
    } catch (error) {
        console.error("Failed to fetch documents:", error);
        return NextResponse.json(
            {
                documents: [],
                pagination: {
                    total: 0,
                    limit: 0,
                    offset: 0,
                    page: 1,
                    totalPages: 1,
                    hasMore: false,
                },
                error: "Database unavailable",
            },
            { status: 500 }
        );
    }
}
