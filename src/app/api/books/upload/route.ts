import { writeFile } from "fs/promises";
import path from "path";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { cleanExtractedText, extractTextFromPdf } from "@/lib/pdf-text-extractor";
import { ensureBooksUploadDirectory, isBookCategory, normalizeClassLevel, normalizeSearchQuery, safeUploadFileName } from "@/lib/services/book-service";
import { enforceToolAccess } from "@/lib/api-auth";

export const dynamic = "force-dynamic";

const MAX_UPLOAD_SIZE_BYTES = 30 * 1024 * 1024;

export async function POST(request: NextRequest) {
    try {
        const auth = await enforceToolAccess("library");
        const organizationId = auth.organizationId;

        const formData = await request.formData();

        const file = formData.get("file") as File | null;
        const title = normalizeSearchQuery(formData.get("title"));
        const description = normalizeSearchQuery(formData.get("description"));
        const categoryRaw = String(formData.get("category") || "").trim().toUpperCase();
        const classLevel = normalizeClassLevel(formData.get("classLevel"));

        if (!file || !title || !categoryRaw) {
            return NextResponse.json(
                { error: "Missing required fields: file, title, category" },
                { status: 400 }
            );
        }

        if (!isBookCategory(categoryRaw)) {
            return NextResponse.json({ error: "Invalid category" }, { status: 400 });
        }

        if (file.type !== "application/pdf") {
            return NextResponse.json({ error: "Only PDF files are allowed" }, { status: 400 });
        }

        if (file.size > MAX_UPLOAD_SIZE_BYTES) {
            return NextResponse.json(
                { error: "File is too large. Maximum allowed size is 30MB" },
                { status: 413 }
            );
        }

        const uploadDir = await ensureBooksUploadDirectory();
        const fileName = safeUploadFileName(file.name);
        const filePath = path.join(uploadDir, fileName);

        const bytes = await file.arrayBuffer();
        const buffer = Buffer.from(bytes);
        await writeFile(filePath, buffer);

        let extractedText = "";
        let pageCount = 0;

        try {
            const extraction = await extractTextFromPdf(filePath);
            extractedText = cleanExtractedText(extraction.text);
            pageCount = extraction.pages;
        } catch (error) {
            console.warn("Text extraction failed, continuing without text:", error);
        }

        const book = await prisma.book.create({
            data: {
                title,
                description: description || null,
                fileName,
                fileSize: buffer.length,
                filePath: `/uploads/books/${fileName}`,
                category: categoryRaw,
                classLevel,
                extractedText,
                pageCount,
                organizationId,
            },
        });

        return NextResponse.json({
            success: true,
            book: {
                id: book.id,
                title: book.title,
                fileName: book.fileName,
                pageCount: book.pageCount,
            },
        });
    } catch (error) {
        console.error("Book upload error:", error);
        return NextResponse.json(
            {
                error: "Failed to upload book",
                details: error instanceof Error ? error.message : String(error),
            },
            { status: 500 }
        );
    }
}
