"use client";

import { Suspense } from "react";
import { MediaSchedulerWorkspace } from "@/components/media/MediaSchedulerWorkspace";

function MediaSchedulerPageContent() {
    return (
        <div className="flex min-h-[calc(100vh-64px)] w-full flex-col overflow-auto bg-slate-50/40">
            <MediaSchedulerWorkspace />
        </div>
    );
}

export default function MediaSchedulerPage() {
    return (
        <Suspense
            fallback={
                <div className="flex h-[calc(100vh-64px)] items-center justify-center text-slate-500">
                    Loading Media Scheduler...
                </div>
            }
        >
            <MediaSchedulerPageContent />
        </Suspense>
    );
}
