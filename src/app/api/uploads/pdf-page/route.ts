import { NextRequest, NextResponse } from "next/server";
import { writeFile, mkdir } from "fs/promises";
import path from "path";
import crypto from "crypto";

export const dynamic = "force-dynamic";
// Allow large body for image uploads
export const maxDuration = 60;

const ALLOWED_TYPES = new Set(["image/jpeg", "image/jpg", "image/png", "image/webp"]);

/**
 * POST /api/uploads/pdf-page
 * Accepts a single image file and saves it to /public/uploads/pdf-pages/
 * Returns the public path to the saved file.
 *
 * FormData fields:
 *   - file: Blob (the image)
 *   - filename: string (original filename hint, e.g. page-3.jpg)
 *   - documentId: string (optional, for organizing by workspace)
 */
export async function POST(request: NextRequest) {
    try {
        const formData = await request.formData();
        const file = formData.get("file");
        const filenameHint = String(formData.get("filename") || "page.jpg");
        const documentId = String(formData.get("documentId") || "").trim().replace(/[^a-z0-9_-]/gi, "");

        if (!file || !(file instanceof Blob)) {
            return NextResponse.json({ error: "No file provided" }, { status: 400 });
        }

        if (!ALLOWED_TYPES.has(file.type)) {
            return NextResponse.json({ error: "Unsupported file type. Only JPEG/PNG/WebP allowed." }, { status: 400 });
        }

        // Max 8MB per page image
        if (file.size > 8 * 1024 * 1024) {
            return NextResponse.json({ error: "Image too large (max 8MB)" }, { status: 400 });
        }

        const bytes = await file.arrayBuffer();
        const buffer = Buffer.from(bytes);

        // Build a deterministic short hash from content to avoid duplicate saves on re-upload
        const hash = crypto.createHash("md5").update(buffer).digest("hex").slice(0, 12);
        const ext = file.type === "image/png" ? ".png" : file.type === "image/webp" ? ".webp" : ".jpg";
        const safeName = filenameHint.replace(/[^a-z0-9._-]/gi, "-").replace(/\.[^.]+$/, "") || "page";
        const filename = `${safeName}-${hash}${ext}`;

        const subDir = documentId ? `pdf-pages/${documentId}` : "pdf-pages";
        const uploadDir = path.join(process.cwd(), "public", "uploads", subDir);
        await mkdir(uploadDir, { recursive: true });

        const filePath = path.join(uploadDir, filename);
        await writeFile(filePath, buffer);

        const publicPath = `/uploads/${subDir}/${filename}`;

        return NextResponse.json({ imagePath: publicPath, filename }, { status: 200 });
    } catch (error) {
        console.error("PDF page upload error:", error);
        return NextResponse.json(
            { error: "Upload failed", details: error instanceof Error ? error.message : String(error) },
            { status: 500 }
        );
    }
}
