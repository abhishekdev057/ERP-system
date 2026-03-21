import { NextRequest, NextResponse } from "next/server";
import { enforceToolAccess } from "@/lib/api-auth";
import {
    MAX_IMAGE_SIZE_BYTES,
    saveUploadedDiagramImage,
} from "@/lib/services/image-extraction-service";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request: NextRequest) {
    try {
        await enforceToolAccess("pdf-to-pdf");

        const formData = await request.formData();
        const fileValue = formData.get("file");
        const filenameHint = String(formData.get("filename") || "diagram").trim() || "diagram";

        if (!(fileValue instanceof File)) {
            return NextResponse.json({ error: "No image file provided." }, { status: 400 });
        }

        if (!String(fileValue.type || "").startsWith("image/")) {
            return NextResponse.json(
                { error: "Unsupported file type. Please upload an image." },
                { status: 400 }
            );
        }

        if (fileValue.size > MAX_IMAGE_SIZE_BYTES) {
            return NextResponse.json(
                { error: "Image too large. Maximum allowed size is 8MB." },
                { status: 400 }
            );
        }

        const stored = await saveUploadedDiagramImage(fileValue, filenameHint);

        return NextResponse.json({
            imagePath: stored.imagePath,
        });
    } catch (error) {
        if (error instanceof Response) return error;
        console.error("Diagram upload error:", error);
        const message = error instanceof Error ? error.message : String(error);
        if (/unauthorized|not authorized/i.test(message)) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
        }
        return NextResponse.json(
            { error: "Diagram upload failed", details: message },
            { status: 500 }
        );
    }
}
