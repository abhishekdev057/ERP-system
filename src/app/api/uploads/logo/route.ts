import { writeFile, mkdir } from "fs/promises";
import path from "path";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/api-auth";

export const dynamic = "force-dynamic";

const ALLOWED_TYPES = ["image/png", "image/jpeg", "image/jpg", "image/webp", "image/svg+xml", "image/gif"];
const MAX_SIZE = 5 * 1024 * 1024; // 5MB

export async function POST(request: NextRequest) {
    try {
        const auth = await requireSession();

        if (auth.role !== "ORG_ADMIN" && auth.role !== "SYSTEM_ADMIN") {
            return NextResponse.json({ error: "Only Org Admins can upload an organization logo" }, { status: 403 });
        }

        // Determine which org to update
        const orgId = auth.organizationId;
        if (!orgId) {
            return NextResponse.json({ error: "No organization assigned to your account" }, { status: 400 });
        }

        const formData = await request.formData();
        const file = formData.get("file") as File | null;

        if (!file) {
            return NextResponse.json({ error: "No file provided" }, { status: 400 });
        }

        if (!ALLOWED_TYPES.includes(file.type)) {
            return NextResponse.json({ error: "Invalid file type. Use PNG, JPG, WEBP, or SVG." }, { status: 400 });
        }

        if (file.size > MAX_SIZE) {
            return NextResponse.json({ error: "File too large. Maximum 5MB." }, { status: 413 });
        }

        const ext = file.name.split(".").pop() || "png";
        const uploadDir = path.join(process.cwd(), "public", "uploads", "logos");
        await mkdir(uploadDir, { recursive: true });

        const fileName = `${orgId}.${ext}`;
        const filePath = path.join(uploadDir, fileName);
        const buffer = Buffer.from(await file.arrayBuffer());
        await writeFile(filePath, buffer);

        const logoPath = `/uploads/logos/${fileName}`;

        await prisma.organization.update({
            where: { id: orgId },
            data: { logo: logoPath },
        });

        return NextResponse.json({ success: true, logo: logoPath });
    } catch (error) {
        if (error instanceof NextResponse) throw error;
        console.error("Logo upload error:", error);
        return NextResponse.json({ error: "Failed to upload logo" }, { status: 500 });
    }
}
