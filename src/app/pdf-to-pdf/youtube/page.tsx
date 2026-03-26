"use client";

import { Suspense } from "react";
import { StudioWorkspaceHero } from "@/components/content-studio/StudioWorkspaceHero";
import { YouTubeSectionNav } from "@/components/media/youtube/YouTubeSectionNav";
import { YouTubeWorkspace } from "@/components/media/YouTubeWorkspace";

function YouTubeWorkspacePageContent() {
    return (
        <div className="page-container" style={{ width: "min(1540px, calc(100% - 2rem))" }}>
            <StudioWorkspaceHero
                theme="youtube"
                eyebrow="Institute Suite · Publishing"
                title="YouTube Workspace"
                description="Run a fuller YouTube command deck with analytics, live broadcast tracking, a dedicated poll lane, and an institute-aware comment response desk."
                highlights={["Realtime analytics", "Dedicated poll lane", "AI comment replies"]}
                actions={[
                    { href: "/content-studio", label: "Tool Hub", tone: "secondary" },
                    { href: "/content-studio/youtube/polls", label: "Poll Command", tone: "ghost" },
                    { href: "/content-studio/youtube/comments", label: "Comment Desk", tone: "ghost" },
                    { href: "/content-studio/media", label: "Media Studio", tone: "ghost" },
                ]}
            />

            <YouTubeSectionNav />
            <YouTubeWorkspace />
        </div>
    );
}

export default function YouTubeWorkspacePage() {
    return (
        <Suspense fallback={<div className="page-container">Loading YouTube Workspace...</div>}>
            <YouTubeWorkspacePageContent />
        </Suspense>
    );
}
