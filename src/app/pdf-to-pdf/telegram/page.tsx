"use client";

import { Suspense } from "react";
import { StudioWorkspaceHero } from "@/components/content-studio/StudioWorkspaceHero";
import { TelegramWorkspace } from "@/components/media/TelegramWorkspace";

function TelegramWorkspacePageContent() {
    return (
        <div className="page-container" style={{ width: "min(1540px, calc(100% - 2rem))" }}>
            <StudioWorkspaceHero
                theme="telegram"
                eyebrow="Institute Suite · Messaging"
                title="Telegram Workspace"
                description="Operate Telegram publishing from a dedicated bot-powered command center with target decks, recent activity sync, and direct sends for channels, groups, and direct chats."
                highlights={["Bot control", "Target decks", "Message + media sends"]}
                actions={[
                    { href: "/content-studio", label: "Tool Hub", tone: "secondary" },
                    { href: "/content-studio/whatsapp", label: "WhatsApp Workspace", tone: "ghost" },
                    { href: "/content-studio/media", label: "Media Studio", tone: "ghost" },
                    { href: "/content-studio/youtube", label: "YouTube Workspace", tone: "ghost" },
                ]}
            />

            <TelegramWorkspace />
        </div>
    );
}

export default function TelegramWorkspacePage() {
    return (
        <Suspense fallback={<div className="page-container">Loading Telegram Workspace...</div>}>
            <TelegramWorkspacePageContent />
        </Suspense>
    );
}
