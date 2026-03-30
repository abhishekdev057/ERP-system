"use client";

import { Suspense } from "react";
import { SlidesWorkspace } from "@/components/slides/SlidesWorkspace";

function SlidesWorkspacePageContent() {
    return <SlidesWorkspace />;
}

export default function SlidesWorkspacePage() {
    return (
        <Suspense fallback={<div className="page-container text-sm text-slate-500">Loading Slides Workspace...</div>}>
            <SlidesWorkspacePageContent />
        </Suspense>
    );
}
