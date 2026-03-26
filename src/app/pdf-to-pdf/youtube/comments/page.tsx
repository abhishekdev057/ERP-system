"use client";

import { Suspense } from "react";
import { StudioWorkspaceHero } from "@/components/content-studio/StudioWorkspaceHero";
import { YouTubeCommentsWorkspace } from "@/components/media/YouTubeCommentsWorkspace";
import { YouTubeSectionNav } from "@/components/media/youtube/YouTubeSectionNav";

function YouTubeCommentsPageContent() {
    return (
        <div className="page-container" style={{ width: "min(1540px, calc(100% - 2rem))" }}>
            <StudioWorkspaceHero
                theme="youtube"
                eyebrow="Institute Suite · Comment Desk"
                title="YouTube Comment Desk"
                description="Handle live chat and public video comments in realtime, then generate institution-aware replies with your organization data before posting."
                highlights={["Live chat feed", "Video comments", "AI replies"]}
                actions={[
                    { href: "/content-studio/youtube", label: "Overview", tone: "secondary" },
                    { href: "/content-studio/youtube/polls", label: "Poll Command", tone: "ghost" },
                    { href: "/org", label: "My Org", tone: "ghost" },
                ]}
            />
            <YouTubeSectionNav />
            <YouTubeCommentsWorkspace />
        </div>
    );
}

export default function YouTubeCommentsPage() {
    return (
        <Suspense fallback={<div className="page-container">Loading YouTube Comment Desk...</div>}>
            <YouTubeCommentsPageContent />
        </Suspense>
    );
}
