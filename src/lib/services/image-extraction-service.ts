import { mkdir, writeFile } from "fs/promises";
import path from "path";

export const MAX_IMAGES_PER_BATCH = Math.max(
    1,
    Number.parseInt(process.env.IMAGE_EXTRACTION_MAX_IMAGES || "8", 10) || 8
);

export const MAX_IMAGE_SIZE_BYTES = 8 * 1024 * 1024;

export type StoredExtractionImage = {
    imageName: string;
    imagePath: string;
    absolutePath: string;
};

function safeImageFileName(originalName: string): string {
    const timestamp = Date.now();
    const random = Math.random().toString(36).slice(2, 8);
    const safe = originalName.replace(/[^a-zA-Z0-9.-]/g, "_");
    return `${timestamp}_${random}_${safe}`;
}

async function ensureExtractionUploadDirectory(): Promise<string> {
    const dir = path.join(process.cwd(), "public", "uploads", "extractions");
    await mkdir(dir, { recursive: true });
    return dir;
}

export async function saveExtractionImage(file: File): Promise<StoredExtractionImage> {
    const uploadDir = await ensureExtractionUploadDirectory();
    const imageName = safeImageFileName(file.name || "image.png");
    const absolutePath = path.join(uploadDir, imageName);
    const imagePath = `/uploads/extractions/${imageName}`;

    const buffer = Buffer.from(await file.arrayBuffer());
    await writeFile(absolutePath, buffer);

    return {
        imageName,
        imagePath,
        absolutePath,
    };
}
