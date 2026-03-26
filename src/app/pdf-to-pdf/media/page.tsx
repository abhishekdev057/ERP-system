"use client";

import { Suspense } from "react";
import { MediaGenerationWorkspace } from "@/components/media/MediaGenerationWorkspace";

function MediaStudioPageContent() {
    return (
        <div className="flex h-[calc(100vh-64px)] w-full flex-col overflow-hidden bg-slate-50/40">
            <MediaGenerationWorkspace />
        </div>
    );
}

export default function MediaStudioPage() {
    return (
        <Suspense fallback={<div className="flex h-[calc(100vh-64px)] items-center justify-center text-slate-500">Loading Media Studio...</div>}>
            <MediaStudioPageContent />
        </Suspense>
    );
}
