"use client";

import { Suspense } from "react";
import { StudioWorkspaceHero } from "@/components/content-studio/StudioWorkspaceHero";
import { SocialWorkspace } from "@/components/media/SocialWorkspace";

function XWorkspacePageContent() {
    return (
        <div className="page-container" style={{ width: "min(1540px, calc(100% - 2rem))" }}>
            <StudioWorkspaceHero
                theme="x"
                eyebrow="Institute Suite · Social Publishing"
                title="X Workspace"
                description="Work with a dedicated X publishing desk for quick posts, media-backed updates, and recent timeline monitoring using your own X app credentials."
                highlights={["X API v2", "Timeline sync", "Media Hub linked"]}
                actions={[
                    { href: "/content-studio", label: "Tool Hub", tone: "secondary" },
                    { href: "/content-studio/media", label: "Media Studio", tone: "ghost" },
                    { href: "/content-studio/instagram", label: "Instagram Workspace", tone: "ghost" },
                    { href: "/content-studio/facebook", label: "Facebook Workspace", tone: "ghost" },
                ]}
            />

            <SocialWorkspace platform="x" />
        </div>
    );
}

export default function XWorkspacePage() {
    return (
        <Suspense fallback={<div className="page-container">Loading X Workspace...</div>}>
            <XWorkspacePageContent />
        </Suspense>
    );
}
