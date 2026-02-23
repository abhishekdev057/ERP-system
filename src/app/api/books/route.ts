import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function GET(request: NextRequest) {
    try {
        const { searchParams } = new URL(request.url);
        const category = searchParams.get('category');
        const classLevel = searchParams.get('classLevel');
        const page = parseInt(searchParams.get('page') || '1');
        const limit = parseInt(searchParams.get('limit') || '20');
        const skip = (page - 1) * limit;

        // Build where clause
        const where: any = {};
        if (category) {
            where.category = category;
        }
        if (classLevel) {
            where.classLevel = classLevel;
        }

        // Get books with pagination
        const [books, total] = await Promise.all([
            prisma.book.findMany({
                where,
                orderBy: { uploadedAt: 'desc' },
                skip,
                take: limit,
                select: {
                    id: true,
                    title: true,
                    description: true,
                    fileName: true,
                    fileSize: true,
                    filePath: true,
                    category: true,
                    classLevel: true,
                    pageCount: true,
                    uploadedAt: true,
                },
            }),
            prisma.book.count({ where }),
        ]);

        return NextResponse.json({
            books,
            pagination: {
                page,
                limit,
                total,
                totalPages: Math.ceil(total / limit),
            },
        });
    } catch (error) {
        console.error('Books listing error:', error);
        return NextResponse.json(
            { error: 'Failed to fetch books' },
            { status: 500 }
        );
    }
}
