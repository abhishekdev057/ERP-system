import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function POST(request: NextRequest) {
    try {
        const { query, category, classLevel } = await request.json();

        if (!query) {
            return NextResponse.json(
                { error: 'Search query is required' },
                { status: 400 }
            );
        }

        // Build where clause
        const where: any = {
            extractedText: {
                contains: query,
                mode: 'insensitive',
            },
        };

        if (category) {
            where.category = category;
        }
        if (classLevel) {
            where.classLevel = classLevel;
        }

        // Search in extracted text, title, and description
        const books = await prisma.book.findMany({
            where: {
                OR: [
                    { extractedText: { contains: query, mode: 'insensitive' } },
                    { title: { contains: query, mode: 'insensitive' } },
                    { description: { contains: query, mode: 'insensitive' } },
                ],
                AND: [
                    category ? { category } : {},
                    classLevel ? { classLevel } : {},
                ],
            },
            select: {
                id: true,
                title: true,
                description: true,
                fileName: true,
                filePath: true,
                category: true,
                classLevel: true,
                pageCount: true,
                uploadedAt: true,
            },
            orderBy: { uploadedAt: 'desc' },
            take: 50,
        });

        return NextResponse.json({ books, query });
    } catch (error) {
        console.error('Search error:', error);
        return NextResponse.json(
            { error: 'Search failed' },
            { status: 500 }
        );
    }
}
