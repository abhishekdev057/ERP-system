"use client";

import { Suspense } from "react";
import { MediaGalleryWorkspace } from "@/components/media/MediaGalleryWorkspace";

function MediaGalleryPageContent() {
    return (
        <div className="page-container">
            <MediaGalleryWorkspace />
        </div>
    );
}

export default function MediaGalleryPage() {
    return (
        <Suspense
            fallback={
                <div className="page-container text-sm text-slate-500">
                    Loading Media Gallery...
                </div>
            }
        >
            <MediaGalleryPageContent />
        </Suspense>
    );
}
