import { NextRequest, NextResponse } from "next/server";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { enforceToolAccess } from "@/lib/api-auth";
import {
    buildGeminiRateLimitMessage,
    getGeminiUsageSummary,
    parseGeminiRateLimitInfo,
    recordGeminiUsage,
    setGeminiRateBlocked,
} from "@/lib/gemini-usage";
import { loadMediaKnowledgeContextForPrompt } from "@/lib/media-rag";
import { buildOrganizationAiContext } from "@/lib/organization-profile";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

type AssistantRequestBody = {
    message?: string;
    mode?: "text_to_image" | "text_to_video" | "image_from_reference" | "video_from_reference";
    conversation?: Array<{
        role?: "user" | "assistant";
        content?: string;
    }>;
};

function sanitizeInlineText(value: unknown, maxLength: number) {
    return String(value || "").replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function extractJsonObject(input: string): string {
    const trimmed = String(input || "").trim();
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");

    if (start === -1 || end === -1 || end < start) {
        throw new Error("Model did not return valid JSON.");
    }

    return trimmed.slice(start, end + 1);
}

export async function POST(request: NextRequest) {
    try {
        const auth = await enforceToolAccess(["media-studio", "pdf-to-pdf"]);
        const apiKey = process.env.GEMINI_API_KEY;

        if (!apiKey) {
            return NextResponse.json(
                { error: "GEMINI_API_KEY is missing, so AI chat cannot run." },
                { status: 500 }
            );
        }

        const body = (await request.json().catch(() => ({}))) as AssistantRequestBody;
        const message = sanitizeInlineText(body.message, 2400);
        const mode = sanitizeInlineText(body.mode || "text_to_image", 60);
        const conversation = Array.isArray(body.conversation)
            ? body.conversation
                  .map((entry) => ({
                      role: entry?.role === "assistant" ? "assistant" : "user",
                      content: sanitizeInlineText(entry?.content, 1200),
                  }))
                  .filter((entry) => entry.content)
                  .slice(-8)
            : [];

        if (!message) {
            return NextResponse.json({ error: "message is required." }, { status: 400 });
        }

        const organization = auth.organizationId
            ? await prisma.organization.findUnique({
                  where: { id: auth.organizationId },
                  select: {
                      name: true,
                      orgType: true,
                      tagline: true,
                      description: true,
                      location: true,
                      audienceSummary: true,
                      boards: true,
                      classLevels: true,
                      subjects: true,
                      languages: true,
                      documentTypes: true,
                      workflowNeeds: true,
                      creativeNeeds: true,
                      aiGoals: true,
                      brandTone: true,
                      notesForAI: true,
                  },
              })
            : null;

        const organizationContext = organization
            ? buildOrganizationAiContext({
                  name: organization.name,
                  orgType: organization.orgType,
                  tagline: organization.tagline,
                  description: organization.description,
                  location: organization.location,
                  audienceSummary: organization.audienceSummary,
                  boards: organization.boards,
                  classLevels: organization.classLevels,
                  subjects: organization.subjects,
                  languages: organization.languages,
                  documentTypes: organization.documentTypes,
                  workflowNeeds: organization.workflowNeeds,
                  creativeNeeds: organization.creativeNeeds,
                  aiGoals: organization.aiGoals,
                  brandTone: organization.brandTone,
                  notesForAI: organization.notesForAI,
              })
            : "Institute profile is not fully available.";

        const knowledge = await loadMediaKnowledgeContextForPrompt({
            organizationId: auth.organizationId,
            prompt: message,
        });

        const genAI = new GoogleGenerativeAI(apiKey);
        const model = genAI.getGenerativeModel({
            model: "gemini-2.5-flash",
            generationConfig: {
                temperature: 0.45,
                responseMimeType: "application/json",
            },
        });

        const conversationBlock = conversation.length
            ? conversation
                  .map((entry) => `${entry.role === "assistant" ? "Assistant" : "User"}: ${entry.content}`)
                  .join("\n")
            : "No prior conversation.";

        const knowledgeBlock = knowledge.references.length
            ? knowledge.references
                  .map((reference) =>
                      `${reference.type === "book" ? "Library" : "Document"} · ${reference.title}: ${reference.summary}`
                  )
                  .join("\n")
            : "No highly relevant knowledge hit was found for this message.";

        const prompt = `
You are the institute's media copilot inside Media Studio.

Rules:
- Use the institute context and retrieved knowledge below.
- Answer in the same language/style as the user whenever possible.
- Help with two things: (1) questions about the institute's resources/knowledge base, and (2) improving or planning a media-generation brief.
- Stay grounded in the retrieved knowledge. If the answer is not clearly supported, say that briefly instead of inventing facts.
- Do not claim that a resource contains something unless it is present in the retrieved context.
- If the user is asking for a better creative prompt, you may include a short suggested prompt.
- Keep the response practical and concise.
- Return strict JSON only.

Current generation mode: ${mode}

Institute context:
${organizationContext}

Retrieved knowledge:
${knowledgeBlock}

Conversation so far:
${conversationBlock}

Latest user message:
${message}

Return:
{
  "reply": "...",
  "suggestedPrompt": "... or empty string"
}
`;

        await recordGeminiUsage(
            mode === "image_brand_strict" ? "social_publish_copy" : "assistant_chat"
        );
        const result = await model.generateContent(prompt);
        const response = await result.response;
        const parsed = JSON.parse(extractJsonObject(response.text())) as {
            reply?: string;
            suggestedPrompt?: string;
        };

        const reply = sanitizeInlineText(parsed.reply, 2200);
        const suggestedPrompt = sanitizeInlineText(parsed.suggestedPrompt, 900);

        if (!reply) {
            throw new Error("Gemini did not return a usable assistant reply.");
        }

        return NextResponse.json({
            success: true,
            reply,
            suggestedPrompt,
            knowledgeReferences: knowledge.references,
            availableBookCount: knowledge.availableBookCount,
            availableDocumentCount: knowledge.availableDocumentCount,
            availableMemberCount: knowledge.availableMemberCount,
            availableStudentCount: knowledge.availableStudentCount,
            availableGeneratedMediaCount: knowledge.availableGeneratedMediaCount,
            availableScheduleCount: knowledge.availableScheduleCount,
            availableWhiteboardCount: knowledge.availableWhiteboardCount,
            totalIndexedItems: knowledge.totalIndexedItems,
            indexSummary: knowledge.indexSummary,
            usage: await getGeminiUsageSummary(),
        });
    } catch (error) {
        if (error instanceof Response) return error;
        console.error("Failed to run media assistant:", error);
        const rateLimit = parseGeminiRateLimitInfo(error);
        if (rateLimit.isRateLimited) {
            const message = buildGeminiRateLimitMessage(rateLimit);
            await setGeminiRateBlocked({
                retryAfterSeconds: rateLimit.retryAfterSeconds,
                reason: message,
                isDailyQuota: rateLimit.isDailyQuota,
            });
            return NextResponse.json(
                {
                    error: message,
                    rateLimited: true,
                    usage: await getGeminiUsageSummary(),
                },
                { status: 429 }
            );
        }
        return NextResponse.json(
            {
                error: error instanceof Error ? error.message : "Failed to run media assistant",
                usage: await getGeminiUsageSummary(),
            },
            { status: 500 }
        );
    }
}
