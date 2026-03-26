import {
    buildKnowledgePromptContext,
    isPromotionalCreativePrompt,
    retrieveKnowledgeForPrompt,
    type KnowledgeIndexSummary,
    type MediaKnowledgeReference,
    type MediaKnowledgeRetrievalResult,
} from "@/lib/knowledge-index";

export type {
    KnowledgeIndexSummary,
    MediaKnowledgeReference,
    MediaKnowledgeRetrievalResult,
};

export { buildKnowledgePromptContext, isPromotionalCreativePrompt };

export async function loadMediaKnowledgeContextForPrompt(options: {
    organizationId: string | null;
    prompt: string;
}): Promise<MediaKnowledgeRetrievalResult> {
    return retrieveKnowledgeForPrompt({
        organizationId: options.organizationId,
        prompt: options.prompt,
    });
}
