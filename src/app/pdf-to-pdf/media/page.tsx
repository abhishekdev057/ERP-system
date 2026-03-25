"use client";

import { Suspense } from "react";
import { StudioWorkspaceHero } from "@/components/content-studio/StudioWorkspaceHero";
import { MediaGenerationWorkspace } from "@/components/media/MediaGenerationWorkspace";

function MediaStudioPageContent() {
    return (
        <div className="page-container" style={{ width: "min(1540px, calc(100% - 2rem))" }}>
            <StudioWorkspaceHero
                theme="media"
                eyebrow="Content Studio · Creative"
                title="Media Studio"
                description="Generate institute-ready images and video drafts with a visual shell that now matches the Tool Hub. Saved generations stay in history, while publishing workflows move into dedicated YouTube and WhatsApp workspaces."
                highlights={["Gemini generation", "Saved media history", "Brand-aware prompts"]}
                actions={[
                    { href: "/content-studio", label: "Tool Hub", tone: "secondary" },
                    { href: "/content-studio/extractor", label: "Question Extractor", tone: "ghost" },
                    { href: "/content-studio/youtube", label: "YouTube Workspace", tone: "ghost" },
                    { href: "/content-studio/whatsapp", label: "WhatsApp Workspace", tone: "ghost" },
                ]}
            />

            <MediaGenerationWorkspace />
        </div>
    );
}

export default function MediaStudioPage() {
    return (
        <Suspense fallback={<div className="page-container">Loading Media Studio...</div>}>
            <MediaStudioPageContent />
        </Suspense>
    );
}
