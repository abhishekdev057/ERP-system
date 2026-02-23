import { NextRequest, NextResponse } from 'next/server';
import { writeFile } from 'fs/promises';
import { join } from 'path';
import { prisma } from '@/lib/prisma';
import { extractTextFromPdf, cleanExtractedText } from '@/lib/pdf-text-extractor';

export async function POST(request: NextRequest) {
    try {
        const formData = await request.formData();
        const file = formData.get('file') as File;
        const title = formData.get('title') as string;
        const description = formData.get('description') as string | null;
        const category = formData.get('category') as string;
        const classLevel = formData.get('classLevel') as string | null;

        if (!file || !title || !category) {
            return NextResponse.json(
                { error: 'Missing required fields: file, title, category' },
                { status: 400 }
            );
        }

        // Validate file type
        if (file.type !== 'application/pdf') {
            return NextResponse.json(
                { error: 'Only PDF files are allowed' },
                { status: 400 }
            );
        }

        // Generate unique filename
        const timestamp = Date.now();
        const safeFileName = file.name.replace(/[^a-zA-Z0-9.-]/g, '_');
        const fileName = `${timestamp}_${safeFileName}`;
        const filePath = join(process.cwd(), 'public', 'uploads', 'books', fileName);

        // Save file to disk
        const bytes = await file.arrayBuffer();
        const buffer = Buffer.from(bytes);
        await writeFile(filePath, buffer);

        // Extract text from PDF
        let extractedText = '';
        let pageCount = 0;
        try {
            const extraction = await extractTextFromPdf(filePath);
            extractedText = cleanExtractedText(extraction.text);
            pageCount = extraction.pages;
        } catch (error) {
            console.warn('Text extraction failed, continuing without text:', error);
        }

        // Save to database
        const book = await prisma.book.create({
            data: {
                title,
                description: description || null,
                fileName,
                fileSize: buffer.length,
                filePath: `/uploads/books/${fileName}`,
                category: category as any,
                classLevel,
                extractedText,
                pageCount,
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
        console.error('Book upload error:', error);
        return NextResponse.json(
            { error: 'Failed to upload book', details: String(error) },
            { status: 500 }
        );
    }
}
