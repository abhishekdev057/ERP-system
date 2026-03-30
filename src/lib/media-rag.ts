import {
    buildKnowledgePromptContext,
    isPromotionalCreativePrompt,
    retrieveKnowledgeForPrompt,
    type KnowledgeIndexSummary,
    type MediaKnowledgeReference,
    type MediaKnowledgeRetrievalResult,
} from "@/lib/knowledge-index";
import { prisma } from "@/lib/prisma";

export type {
    KnowledgeIndexSummary,
    MediaKnowledgeReference,
    MediaKnowledgeRetrievalResult,
};

export { buildKnowledgePromptContext, isPromotionalCreativePrompt };

function buildEmptyIndexSummary(): KnowledgeIndexSummary {
    return {
        totalIndexedItems: 0,
        embeddingsEnabled: false,
        sourceCounts: {},
    };
}

function mapSourceTypeToReference(
    sourceType: string
): MediaKnowledgeReference["type"] {
    switch (sourceType) {
        case "MEMBER":
            return "member";
        case "STUDENT":
            return "student";
        case "BOOK":
            return "book";
        case "DOCUMENT":
            return "document";
        case "GENERATED_MEDIA":
            return "media";
        case "MEDIA_SCHEDULE":
            return "schedule";
        case "WHITEBOARD":
            return "whiteboard";
        default:
            return "organization";
    }
}

async function loadFallbackMediaKnowledgeContext(options: {
    organizationId: string;
    prompt: string;
}): Promise<MediaKnowledgeRetrievalResult> {
    const promptTerms = String(options.prompt || "")
        .toLowerCase()
        .split(/[^a-z0-9\u0900-\u097f]+/i)
        .map((token) => token.trim())
        .filter((token) => token.length >= 2)
        .slice(0, 12);

    const [state, rows] = await Promise.all([
        prisma.knowledgeIndexState.findUnique({
            where: { organizationId: options.organizationId },
            select: {
                itemCount: true,
                embeddingsEnabled: true,
                sourceCounts: true,
                lastSuccessfulSyncAt: true,
                lastSourceUpdateAt: true,
            },
        }),
        prisma.knowledgeIndexItem.findMany({
            where: {
                organizationId: options.organizationId,
                ...(promptTerms.length
                    ? {
                          OR: [
                              {
                                  keywords: {
                                      hasSome: promptTerms,
                                  },
                              },
                              {
                                  title: {
                                      contains: promptTerms[0],
                                      mode: "insensitive",
                                  },
                              },
                          ],
                      }
                    : {}),
            },
            orderBy: [{ updatedAt: "desc" }],
            take: 6,
            select: {
                sourceType: true,
                sourceId: true,
                title: true,
                summary: true,
                content: true,
                metadata: true,
                updatedAt: true,
            },
        }),
    ]);

    const sourceCounts =
        state?.sourceCounts && typeof state.sourceCounts === "object"
            ? (state.sourceCounts as Record<string, number>)
            : {};

    const references: MediaKnowledgeReference[] = rows.map((row) => ({
        type: mapSourceTypeToReference(String(row.sourceType)),
        title: String(row.title || "Knowledge Item"),
        summary: String(row.summary || row.content || "")
            .replace(/\s+/g, " ")
            .trim()
            .slice(0, 180),
        sourceType: String(row.sourceType),
        sourceId: String(row.sourceId),
        updatedAt: row.updatedAt?.toISOString(),
        metadata:
            row.metadata && typeof row.metadata === "object"
                ? (row.metadata as Record<string, unknown>)
                : undefined,
    }));

    const indexSummary: KnowledgeIndexSummary = {
        totalIndexedItems: Number(state?.itemCount || references.length || 0),
        embeddingsEnabled: Boolean(state?.embeddingsEnabled),
        sourceCounts,
        lastSyncedAt: state?.lastSuccessfulSyncAt?.toISOString(),
        lastSourceUpdateAt: state?.lastSourceUpdateAt?.toISOString(),
    };

    return {
        references,
        knowledgeContext: buildKnowledgePromptContext(references, options.prompt),
        availableBookCount: Number(sourceCounts.BOOK || 0),
        availableDocumentCount: Number(sourceCounts.DOCUMENT || 0),
        availableMemberCount: Number(sourceCounts.MEMBER || 0),
        availableStudentCount: Number(sourceCounts.STUDENT || 0),
        availableGeneratedMediaCount: Number(sourceCounts.GENERATED_MEDIA || 0),
        availableScheduleCount: Number(sourceCounts.MEDIA_SCHEDULE || 0),
        availableWhiteboardCount: Number(sourceCounts.WHITEBOARD || 0),
        totalIndexedItems: indexSummary.totalIndexedItems,
        indexSummary: indexSummary.totalIndexedItems ? indexSummary : buildEmptyIndexSummary(),
    };
}

export async function loadMediaKnowledgeContextForPrompt(options: {
    organizationId: string | null;
    prompt: string;
}): Promise<MediaKnowledgeRetrievalResult> {
    try {
        return await retrieveKnowledgeForPrompt({
            organizationId: options.organizationId,
            prompt: options.prompt,
        });
    } catch (error) {
        const organizationId = String(options.organizationId || "").trim();
        if (!organizationId) {
            console.warn("[media-rag] No organization available for fallback retrieval.", error);
            return {
                references: [],
                knowledgeContext: "",
                availableBookCount: 0,
                availableDocumentCount: 0,
                availableMemberCount: 0,
                availableStudentCount: 0,
                availableGeneratedMediaCount: 0,
                availableScheduleCount: 0,
                availableWhiteboardCount: 0,
                totalIndexedItems: 0,
                indexSummary: buildEmptyIndexSummary(),
            };
        }

        console.warn(
            "[media-rag] Falling back to stale knowledge index retrieval:",
            error
        );

        try {
            return await loadFallbackMediaKnowledgeContext({
                organizationId,
                prompt: options.prompt,
            });
        } catch (fallbackError) {
            console.warn(
                "[media-rag] Fallback knowledge retrieval also failed. Returning empty context.",
                fallbackError
            );
            return {
                references: [],
                knowledgeContext: "",
                availableBookCount: 0,
                availableDocumentCount: 0,
                availableMemberCount: 0,
                availableStudentCount: 0,
                availableGeneratedMediaCount: 0,
                availableScheduleCount: 0,
                availableWhiteboardCount: 0,
                totalIndexedItems: 0,
                indexSummary: buildEmptyIndexSummary(),
            };
        }
    }
}
