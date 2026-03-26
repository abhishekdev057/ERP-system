"use client";

import { Suspense } from "react";
import { StudioWorkspaceHero } from "@/components/content-studio/StudioWorkspaceHero";
import { WhatsAppWorkspace } from "@/components/media/WhatsAppWorkspace";

function WhatsAppWorkspacePageContent() {
    return (
        <div className="page-container" style={{ width: "min(1540px, calc(100% - 2rem))" }}>
            <StudioWorkspaceHero
                theme="whatsapp"
                eyebrow="Institute Suite · Messaging"
                title="WhatsApp Workspace"
                description="Run WhatsApp Cloud messaging from a dedicated Meta-powered workspace with the same premium shell language as Tool Hub, including inbox threads, approved templates, and campaign controls."
                highlights={["Inbox threads", "Embedded signup", "Template campaigns"]}
                actions={[
                    { href: "/content-studio", label: "Tool Hub", tone: "secondary" },
                    { href: "/content-studio/media", label: "Media Studio", tone: "ghost" },
                    { href: "/content-studio/telegram", label: "Telegram Workspace", tone: "ghost" },
                    { href: "/content-studio/youtube", label: "YouTube Workspace", tone: "ghost" },
                    { href: "/content-studio/extractor", label: "Question Extractor", tone: "ghost" },
                ]}
            />

            <WhatsAppWorkspace />
        </div>
    );
}

export default function WhatsAppWorkspacePage() {
    return (
        <Suspense fallback={<div className="page-container">Loading WhatsApp Workspace...</div>}>
            <WhatsAppWorkspacePageContent />
        </Suspense>
    );
}
