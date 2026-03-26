"use client";

import { Suspense } from "react";
import { StudioWorkspaceHero } from "@/components/content-studio/StudioWorkspaceHero";
import { StudentsWorkspace } from "@/components/students/StudentsWorkspace";

function StudentsWorkspacePageContent() {
    return (
        <div className="page-container" style={{ width: "min(1540px, calc(100% - 2rem))" }}>
            <StudioWorkspaceHero
                theme="students"
                eyebrow="Organization · CRM"
                title="Students Hub"
                description="Manage your complete student pipeline from lead capture to active enrollment with premium profile desks, conversation history, and open-map address intelligence for village, city, district, and state."
                highlights={["Lead Pipelines", "Conversation History", "Address Intelligence"]}
                actions={[
                    { href: "/content-studio", label: "Tool Hub", tone: "secondary" },
                    { href: "/content-studio/members", label: "Staff Members", tone: "ghost" },
                ]}
            />
            <StudentsWorkspace />
        </div>
    );
}

export default function StudentsWorkspacePage() {
    return (
        <Suspense fallback={<div className="page-container">Loading Students Hub...</div>}>
            <StudentsWorkspacePageContent />
        </Suspense>
    );
}
