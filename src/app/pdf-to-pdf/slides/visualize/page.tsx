"use client";

import { Suspense } from "react";
import { SlidesVisualizationWorkspace } from "@/components/slides/SlidesVisualizationWorkspace";

function SlidesVisualizationPageContent() {
    return <SlidesVisualizationWorkspace />;
}

export default function SlidesVisualizationPage() {
    return (
        <Suspense fallback={<div className="page-container text-sm text-slate-500">Loading Slides Visualization Workspace...</div>}>
            <SlidesVisualizationPageContent />
        </Suspense>
    );
}
