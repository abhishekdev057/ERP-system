import { NextRequest, NextResponse } from "next/server";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { enforceToolAccess } from "@/lib/api-auth";
import { prisma } from "@/lib/prisma";
import { buildOrganizationAiContext } from "@/lib/organization-profile";

export const dynamic = "force-dynamic";

type ReplySuggestionResponse = {
    reply?: string;
};

function sanitizeInlineText(value: string, maxLength: number) {
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
        const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
        const commentText = sanitizeInlineText(String(body.commentText || ""), 1500);
        const commentAuthorName = sanitizeInlineText(String(body.commentAuthorName || ""), 120);
        const broadcastTitle = sanitizeInlineText(String(body.broadcastTitle || ""), 240);
        const commentKind = sanitizeInlineText(String(body.commentKind || "comment"), 40);

        if (!commentText) {
            return NextResponse.json({ error: "commentText is required." }, { status: 400 });
        }

        const apiKey = process.env.GEMINI_API_KEY;
        if (!apiKey) {
            return NextResponse.json(
                { error: "GEMINI_API_KEY is missing, so AI replies cannot be generated." },
                { status: 500 }
            );
        }

        const org = auth.organizationId
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

        const organizationContext = org
            ? buildOrganizationAiContext({
                name: org.name,
                orgType: org.orgType,
                tagline: org.tagline,
                description: org.description,
                location: org.location,
                audienceSummary: org.audienceSummary,
                boards: org.boards,
                classLevels: org.classLevels,
                subjects: org.subjects,
                languages: org.languages,
                documentTypes: org.documentTypes,
                workflowNeeds: org.workflowNeeds,
                creativeNeeds: org.creativeNeeds,
                aiGoals: org.aiGoals,
                brandTone: org.brandTone,
                notesForAI: org.notesForAI,
            })
            : "Institution context unavailable.";

        const genAI = new GoogleGenerativeAI(apiKey);
        const model = genAI.getGenerativeModel({
            model: "gemini-2.5-flash",
            generationConfig: {
                temperature: 0.5,
                responseMimeType: "application/json",
            },
        });

        const prompt = `
Generate a short, polished YouTube reply for an education institute.

Rules:
- Reply as the institute/community team, not as an AI assistant.
- Use the institute context below.
- Match the language of the incoming message whenever possible.
- Keep the reply helpful, human, and natural.
- Never invent fees, schedules, discounts, admissions promises, or unavailable facts.
- If the user asks for information not present in context, politely invite them to DM/contact the institute.
- Keep the reply under 320 characters.
- Return strict JSON only.

Institute context:
${organizationContext}

Stream title: ${broadcastTitle || "(not provided)"}
Message type: ${commentKind}
Author: ${commentAuthorName || "Viewer"}
Incoming message:
${commentText}

Return:
{
  "reply": "..."
}
`;

        const result = await model.generateContent(prompt);
        const response = await result.response;
        const parsed = JSON.parse(extractJsonObject(response.text())) as ReplySuggestionResponse;
        const reply = sanitizeInlineText(String(parsed.reply || ""), 320);

        if (!reply) {
            throw new Error("Gemini did not return a usable reply.");
        }

        return NextResponse.json({
            success: true,
            reply,
        });
    } catch (error) {
        if (error instanceof Response) return error;
        console.error("Failed to generate YouTube AI reply:", error);
        return NextResponse.json(
            {
                error: error instanceof Error ? error.message : "Failed to generate YouTube AI reply",
            },
            { status: 500 }
        );
    }
}
