"use client";

import { Suspense } from "react";
import { StudioWorkspaceHero } from "@/components/content-studio/StudioWorkspaceHero";
import { SocialWorkspace } from "@/components/media/SocialWorkspace";

function FacebookWorkspacePageContent() {
    return (
        <div className="page-container" style={{ width: "min(1540px, calc(100% - 2rem))" }}>
            <StudioWorkspaceHero
                theme="facebook"
                eyebrow="Institute Suite · Social Publishing"
                title="Facebook Workspace"
                description="Control page publishing from a dedicated Facebook desk with page posts, media uploads, and quick access to generated campaign assets."
                highlights={["Page publishing", "Photo + video upload", "Media Hub linked"]}
                actions={[
                    { href: "/content-studio", label: "Tool Hub", tone: "secondary" },
                    { href: "/content-studio/media", label: "Media Studio", tone: "ghost" },
                    { href: "/content-studio/instagram", label: "Instagram Workspace", tone: "ghost" },
                    { href: "/content-studio/x", label: "X Workspace", tone: "ghost" },
                ]}
            />

            <SocialWorkspace platform="facebook" />
        </div>
    );
}

export default function FacebookWorkspacePage() {
    return (
        <Suspense fallback={<div className="page-container">Loading Facebook Workspace...</div>}>
            <FacebookWorkspacePageContent />
        </Suspense>
    );
}
