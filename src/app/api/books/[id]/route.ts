import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { unlink } from 'fs/promises';
import { join } from 'path';

export async function GET(
    request: NextRequest,
    { params }: { params: { id: string } }
) {
    try {
        const book = await prisma.book.findUnique({
            where: { id: params.id },
        });

        if (!book) {
            return NextResponse.json(
                { error: 'Book not found' },
                { status: 404 }
            );
        }

        return NextResponse.json({ book });
    } catch (error) {
        console.error('Book fetch error:', error);
        return NextResponse.json(
            { error: 'Failed to fetch book' },
            { status: 500 }
        );
    }
}

export async function DELETE(
    request: NextRequest,
    { params }: { params: { id: string } }
) {
    try {
        const book = await prisma.book.findUnique({
            where: { id: params.id },
        });

        if (!book) {
            return NextResponse.json(
                { error: 'Book not found' },
                { status: 404 }
            );
        }

        // Delete file from filesystem
        try {
            const filePath = join(process.cwd(), 'public', 'uploads', 'books', book.fileName);
            await unlink(filePath);
        } catch (error) {
            console.warn('Failed to delete file:', error);
        }

        // Delete from database
        await prisma.book.delete({
            where: { id: params.id },
        });

        return NextResponse.json({ success: true });
    } catch (error) {
        console.error('Book deletion error:', error);
        return NextResponse.json(
            { error: 'Failed to delete book' },
            { status: 500 }
        );
    }
}
