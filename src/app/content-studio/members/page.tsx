"use client";

import { Suspense } from "react";
import { StudioWorkspaceHero } from "@/components/content-studio/StudioWorkspaceHero";
import { MembersWorkspace } from "@/components/members/MembersWorkspace";

function MembersWorkspacePageContent() {
    return (
        <div className="page-container" style={{ width: "min(1540px, calc(100% - 2rem))" }}>
            <StudioWorkspaceHero
                theme="members"
                eyebrow="Organization · People"
                title="Staff Management"
                description="Review and manage every staff profile with polished role editing, onboarding visibility, salary references, tool access context, and open-map location intelligence."
                highlights={["Role Assignments", "Access Visibility", "Address Intelligence"]}
                actions={[
                    { href: "/content-studio", label: "Tool Hub", tone: "secondary" },
                    { href: "/content-studio/students", label: "Students Hub", tone: "ghost" },
                ]}
            />
            <MembersWorkspace />
        </div>
    );
}

export default function MembersWorkspacePage() {
    return (
        <Suspense fallback={<div className="page-container">Loading Members Hub...</div>}>
            <MembersWorkspacePageContent />
        </Suspense>
    );
}
