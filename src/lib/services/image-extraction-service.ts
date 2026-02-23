import { mkdir, writeFile } from "fs/promises";
import path from "path";
import sharp from "sharp";

export const MAX_IMAGES_PER_BATCH = Math.max(
    1,
    Number.parseInt(process.env.IMAGE_EXTRACTION_MAX_IMAGES || "8", 10) || 8
);

export const MAX_IMAGE_SIZE_BYTES = 8 * 1024 * 1024;
const MIN_BOUNDS_RATIO = 0.03;
const DIAGRAM_CROP_PADDING_RATIO = 0.012;
const MIN_DIAGRAM_PIXELS = 72;

export type StoredExtractionImage = {
    imageName: string;
    imagePath: string;
    absolutePath: string;
};

export type ImageBounds = {
    x: number;
    y: number;
    width: number;
    height: number;
};

export type StoredDiagramImage = {
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

async function ensureDiagramUploadDirectory(): Promise<string> {
    const dir = path.join(process.cwd(), "public", "uploads", "extractions", "diagrams");
    await mkdir(dir, { recursive: true });
    return dir;
}

function clamp(value: number, min: number, max: number): number {
    return Math.min(Math.max(value, min), max);
}

export function normalizeImageBounds(raw: unknown): ImageBounds | undefined {
    if (!raw || typeof raw !== "object") return undefined;

    const candidate = raw as Record<string, unknown>;
    const x = Number(candidate.x);
    const y = Number(candidate.y);
    const width = Number(candidate.width);
    const height = Number(candidate.height);

    if (![x, y, width, height].every(Number.isFinite)) return undefined;

    const normalizedWidth = clamp(width, 0, 1);
    const normalizedHeight = clamp(height, 0, 1);

    if (normalizedWidth < MIN_BOUNDS_RATIO || normalizedHeight < MIN_BOUNDS_RATIO) {
        return undefined;
    }

    const normalizedX = clamp(x, 0, 1 - normalizedWidth);
    const normalizedY = clamp(y, 0, 1 - normalizedHeight);

    return {
        x: normalizedX,
        y: normalizedY,
        width: normalizedWidth,
        height: normalizedHeight,
    };
}

function safeQuestionToken(value: string): string {
    return value.replace(/[^a-zA-Z0-9.-]/g, "_").slice(0, 24) || "q";
}

export async function cropDiagramFromSourceImage(
    source: StoredExtractionImage,
    questionNumber: string,
    bounds: ImageBounds
): Promise<StoredDiagramImage | null> {
    const metadata = await sharp(source.absolutePath).metadata();
    const imageWidth = metadata.width || 0;
    const imageHeight = metadata.height || 0;
    if (!imageWidth || !imageHeight) return null;

    const left = Math.floor(bounds.x * imageWidth);
    const top = Math.floor(bounds.y * imageHeight);
    const width = Math.ceil(bounds.width * imageWidth);
    const height = Math.ceil(bounds.height * imageHeight);

    const pad = Math.round(Math.max(imageWidth, imageHeight) * DIAGRAM_CROP_PADDING_RATIO);

    const cropLeft = clamp(left - pad, 0, imageWidth - 1);
    const cropTop = clamp(top - pad, 0, imageHeight - 1);
    const cropRight = clamp(left + width + pad, cropLeft + 1, imageWidth);
    const cropBottom = clamp(top + height + pad, cropTop + 1, imageHeight);
    const cropWidth = cropRight - cropLeft;
    const cropHeight = cropBottom - cropTop;

    if (cropWidth < MIN_DIAGRAM_PIXELS || cropHeight < MIN_DIAGRAM_PIXELS) {
        return null;
    }

    const diagramDir = await ensureDiagramUploadDirectory();
    const sourceStem = path.parse(source.imageName).name.replace(/[^a-zA-Z0-9.-]/g, "_");
    const fileName = `${Date.now()}_${safeQuestionToken(questionNumber)}_${sourceStem}.png`;
    const absolutePath = path.join(diagramDir, fileName);
    const imagePath = `/uploads/extractions/diagrams/${fileName}`;

    await sharp(source.absolutePath)
        .extract({
            left: cropLeft,
            top: cropTop,
            width: cropWidth,
            height: cropHeight,
        })
        .png({ compressionLevel: 9, quality: 100 })
        .toFile(absolutePath);

    return { imagePath, absolutePath };
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
