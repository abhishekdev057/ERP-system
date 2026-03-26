"use client";

import { Suspense } from "react";
import { StudioWorkspaceHero } from "@/components/content-studio/StudioWorkspaceHero";
import { YouTubePollsWorkspace } from "@/components/media/YouTubePollsWorkspace";
import { YouTubeSectionNav } from "@/components/media/youtube/YouTubeSectionNav";

function YouTubePollsPageContent() {
    return (
        <div className="page-container" style={{ width: "min(1540px, calc(100% - 2rem))" }}>
            <StudioWorkspaceHero
                theme="youtube"
                eyebrow="Institute Suite · Poll Command"
                title="YouTube Poll Command"
                description="Run the extractor-to-live pipeline in a dedicated lane: pick a stream, load a document, and move question-by-question through Hindi poll candidates."
                highlights={["Broadcast selector", "Hindi-only candidates", "Poll memory per live stream"]}
                actions={[
                    { href: "/content-studio/youtube", label: "Overview", tone: "secondary" },
                    { href: "/content-studio/youtube/comments", label: "Comment Desk", tone: "ghost" },
                    { href: "/content-studio/extractor", label: "Question Extractor", tone: "ghost" },
                ]}
            />
            <YouTubeSectionNav />
            <YouTubePollsWorkspace />
        </div>
    );
}

export default function YouTubePollsPage() {
    return (
        <Suspense fallback={<div className="page-container">Loading YouTube Poll Command...</div>}>
            <YouTubePollsPageContent />
        </Suspense>
    );
}
