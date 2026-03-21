import { writeFile, mkdir } from "fs/promises";
import path from "path";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/api-auth";

export const dynamic = "force-dynamic";

const ALLOWED_TYPES = ["image/png", "image/jpeg", "image/jpg", "image/webp", "image/gif"];
const MAX_SIZE = 5 * 1024 * 1024; // 5MB

export async function POST(request: NextRequest) {
    try {
        const auth = await requireSession();

        const formData = await request.formData();
        const file = formData.get("file") as File | null;

        if (!file) {
            return NextResponse.json({ error: "No file provided" }, { status: 400 });
        }

        if (!ALLOWED_TYPES.includes(file.type)) {
            return NextResponse.json({ error: "Invalid file type. Use PNG, JPG, or WEBP." }, { status: 400 });
        }

        if (file.size > MAX_SIZE) {
            return NextResponse.json({ error: "File too large. Maximum 5MB." }, { status: 413 });
        }

        const ext = file.name.split(".").pop() || "jpg";
        const uploadDir = path.join(process.cwd(), "public", "uploads", "avatars");
        await mkdir(uploadDir, { recursive: true });

        const fileName = `${auth.userId}.${ext}`;
        const filePath = path.join(uploadDir, fileName);
        const buffer = Buffer.from(await file.arrayBuffer());
        await writeFile(filePath, buffer);

        const avatarPath = `/uploads/avatars/${fileName}`;

        await prisma.user.update({
            where: { id: auth.userId },
            data: { image: avatarPath },
        });

        return NextResponse.json({ success: true, image: avatarPath });
    } catch (error) {
        if (error instanceof NextResponse) throw error;
        console.error("Avatar upload error:", error);
        return NextResponse.json({ error: "Failed to upload photo" }, { status: 500 });
    }
}
