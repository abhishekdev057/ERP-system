import { mkdir } from "fs/promises";
import path from "path";
import { Prisma } from "@prisma/client";

export const BOOK_CATEGORIES = [
    "CLASSES",
    "COURSES",
    "COACHING",
    "NOTES",
    "REFERENCE",
    "OTHER",
] as const;

export type BookCategoryValue = (typeof BOOK_CATEGORIES)[number];

export function isBookCategory(value: string): value is BookCategoryValue {
    return (BOOK_CATEGORIES as readonly string[]).includes(value);
}

export function normalizeBookPagination(
    pageRaw: unknown,
    limitRaw: unknown
): { page: number; limit: number; skip: number } {
    const pageParsed = Number.parseInt(String(pageRaw ?? "1"), 10);
    const limitParsed = Number.parseInt(String(limitRaw ?? "20"), 10);
    const page = Number.isFinite(pageParsed) ? Math.max(pageParsed, 1) : 1;
    const limit = Number.isFinite(limitParsed) ? Math.min(Math.max(limitParsed, 1), 100) : 20;
    return {
        page,
        limit,
        skip: (page - 1) * limit,
    };
}

export function normalizeClassLevel(value: unknown): string | null {
    const classLevel = String(value ?? "").trim();
    return classLevel || null;
}

export function normalizeSearchQuery(value: unknown): string {
    return String(value ?? "").replace(/\s+/g, " ").trim();
}

export function buildBookWhere({
    category,
    classLevel,
}: {
    category: string | null;
    classLevel: string | null;
}): Prisma.BookWhereInput {
    const where: Prisma.BookWhereInput = {};
    if (category && isBookCategory(category)) where.category = category;
    if (classLevel) where.classLevel = classLevel;
    return where;
}

export function safeUploadFileName(originalName: string): string {
    const timestamp = Date.now();
    const safe = originalName.replace(/[^a-zA-Z0-9.-]/g, "_");
    return `${timestamp}_${safe}`;
}

export async function ensureBooksUploadDirectory(): Promise<string> {
    const dir = path.join(process.cwd(), "public", "uploads", "books");
    await mkdir(dir, { recursive: true });
    return dir;
}
