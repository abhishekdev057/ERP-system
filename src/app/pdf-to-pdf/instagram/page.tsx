"use client";

import { Suspense } from "react";
import { StudioWorkspaceHero } from "@/components/content-studio/StudioWorkspaceHero";
import { SocialWorkspace } from "@/components/media/SocialWorkspace";

function InstagramWorkspacePageContent() {
    return (
        <div className="page-container" style={{ width: "min(1540px, calc(100% - 2rem))" }}>
            <StudioWorkspaceHero
                theme="instagram"
                eyebrow="Institute Suite · Social Publishing"
                title="Instagram Workspace"
                description="Run Instagram publishing from a dedicated command desk with saved Graph credentials, recent feed sync, and Media Hub assets ready for publish."
                highlights={["Meta Graph API", "Recent feed sync", "Media Hub linked"]}
                actions={[
                    { href: "/content-studio", label: "Tool Hub", tone: "secondary" },
                    { href: "/content-studio/media", label: "Media Studio", tone: "ghost" },
                    { href: "/content-studio/facebook", label: "Facebook Workspace", tone: "ghost" },
                    { href: "/content-studio/x", label: "X Workspace", tone: "ghost" },
                ]}
            />

            <SocialWorkspace platform="instagram" />
        </div>
    );
}

export default function InstagramWorkspacePage() {
    return (
        <Suspense fallback={<div className="page-container">Loading Instagram Workspace...</div>}>
            <InstagramWorkspacePageContent />
        </Suspense>
    );
}
