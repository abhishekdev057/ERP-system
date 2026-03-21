import { NextRequest, NextResponse } from "next/server";
import { enforceToolAccess } from "@/lib/api-auth";
import { prisma } from "@/lib/prisma";
import { buildOrganizationAiContext } from "@/lib/organization-profile";

export const dynamic = "force-dynamic";

type MediaMode =
    | "text_to_image"
    | "text_to_video"
    | "image_from_reference"
    | "video_from_reference";

type RequestBody = {
    mode?: MediaMode;
    prompt?: string;
    style?: string;
    aspectRatio?: string;
    durationSec?: number;
    referenceName?: string;
};

function sanitizePrompt(input: string): string {
    return input.replace(/\s+/g, " ").trim().slice(0, 400);
}

function buildStoryboard(prompt: string, durationSec: number): string[] {
    const safePrompt = prompt || "Institute promotional story";
    return [
        `Shot 1 (0-${Math.max(2, Math.floor(durationSec / 4))}s): Wide opening frame introducing ${safePrompt}.`,
        `Shot 2: Mid scene with subject emphasis and motion transition.`,
        `Shot 3: Detail close-up to reinforce key educational theme.`,
        `Shot 4: Closing frame with institute branding and CTA overlay.`,
    ];
}

export async function POST(request: NextRequest) {
    try {
        const auth = await enforceToolAccess(["media-studio", "pdf-to-pdf"]);

        const body = (await request.json()) as RequestBody;
        const mode = body.mode || "text_to_image";
        const prompt = sanitizePrompt(String(body.prompt || ""));
        const style = String(body.style || "cinematic").trim().slice(0, 60);
        const aspectRatio = String(body.aspectRatio || "16:9").trim().slice(0, 16);
        const durationSec = Math.max(3, Math.min(60, Number(body.durationSec || 12)));

        if (!prompt) {
            return NextResponse.json({ error: "Prompt is required." }, { status: 400 });
        }

        let institutionContextApplied = false;
        let organizationContext = "";
        if (auth.organizationId) {
            const organization = await prisma.organization.findUnique({
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
            });

            if (organization) {
                organizationContext = buildOrganizationAiContext(organization)
                    .replace(/\n+/g, "; ")
                    .replace(/\s+/g, " ")
                    .trim()
                    .slice(0, 900);
                institutionContextApplied = Boolean(organizationContext);
            }
        }

        const effectivePrompt = institutionContextApplied
            ? `${prompt}. Institution context: ${organizationContext}`.slice(0, 1400)
            : prompt;

        const encodedPrompt = encodeURIComponent(
            `${effectivePrompt}. style: ${style}. aspect ratio: ${aspectRatio}.`
        );

        if (mode === "text_to_image" || mode === "image_from_reference") {
            const seed = Date.now();
            const imageUrl = `https://image.pollinations.ai/prompt/${encodedPrompt}?seed=${seed}&nologo=true`;
            return NextResponse.json({
                success: true,
                mode,
                status: "generated",
                type: "image",
                prompt,
                effectivePrompt,
                style,
                aspectRatio,
                referenceName: body.referenceName || null,
                institutionContextApplied,
                assetUrl: imageUrl,
            });
        }

        const storyboard = buildStoryboard(prompt, durationSec);
        return NextResponse.json({
            success: true,
            mode,
            status: "draft",
            type: "video_plan",
            prompt,
            effectivePrompt,
            style,
            aspectRatio,
            durationSec,
            referenceName: body.referenceName || null,
            institutionContextApplied,
            storyboard,
            note: "Video provider is not configured in this deployment. Storyboard and shot plan generated for production handoff.",
        });
    } catch (error) {
        console.error("Media generate error:", error);
        const message = error instanceof Error ? error.message : "Failed to generate media";
        if (/forbidden|unauthorized/i.test(message)) {
            return NextResponse.json({ error: "Forbidden" }, { status: 403 });
        }
        return NextResponse.json({ error: message }, { status: 500 });
    }
}
