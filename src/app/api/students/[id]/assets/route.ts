import { mkdir, writeFile } from "fs/promises";
import path from "path";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { enforceToolAccess } from "@/lib/api-auth";
import { scheduleKnowledgeIndexRefresh } from "@/lib/knowledge-index";

export const dynamic = "force-dynamic";

const IMAGE_TYPES = ["image/png", "image/jpeg", "image/jpg", "image/webp", "image/gif"];
const ID_PROOF_TYPES = [...IMAGE_TYPES, "application/pdf"];
const MAX_FILE_BYTES = 8 * 1024 * 1024;

function sanitizeExt(file: File) {
    const ext = file.name.split(".").pop()?.toLowerCase();
    if (ext && /^[a-z0-9]+$/i.test(ext)) return ext;
    if (file.type === "application/pdf") return "pdf";
    if (file.type === "image/png") return "png";
    if (file.type === "image/webp") return "webp";
    if (file.type === "image/gif") return "gif";
    return "jpg";
}

function sanitizeName(value: string) {
    return value.replace(/[^a-z0-9_-]+/gi, "-").replace(/-+/g, "-").replace(/^-|-$/g, "").toLowerCase();
}

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
    try {
        const auth = await enforceToolAccess("pdf-to-pdf");
        const student = await prisma.student.findUnique({
            where: { id: params.id },
            select: {
                id: true,
                organizationId: true,
                galleryImageUrls: true,
            },
        });

        if (!student || student.organizationId !== auth.organizationId) {
            return NextResponse.json({ error: "Student not found" }, { status: 404 });
        }

        const formData = await request.formData();
        const kind = String(formData.get("kind") || "gallery");
        const files = formData.getAll("files").filter((item): item is File => item instanceof File);

        if (!files.length) {
            return NextResponse.json({ error: "At least one file is required." }, { status: 400 });
        }

        const allowMultiple = kind === "gallery";
        if (!allowMultiple && files.length > 1) {
            return NextResponse.json({ error: "Only one file is allowed for this upload type." }, { status: 400 });
        }

        const allowedTypes = kind === "idProof" ? ID_PROOF_TYPES : IMAGE_TYPES;
        for (const file of files) {
            if (!allowedTypes.includes(file.type)) {
                return NextResponse.json({ error: "Invalid file type for this upload." }, { status: 400 });
            }
            if (file.size > MAX_FILE_BYTES) {
                return NextResponse.json({ error: "File is too large. Keep uploads under 8MB." }, { status: 413 });
            }
        }

        const uploadDir = path.join(process.cwd(), "public", "uploads", "students", student.id);
        await mkdir(uploadDir, { recursive: true });

        const uploadedUrls: string[] = [];
        for (let index = 0; index < files.length; index += 1) {
            const file = files[index];
            const suffix = `${Date.now()}-${index}-${sanitizeName(kind)}`;
            const ext = sanitizeExt(file);
            const fileName = `${suffix}.${ext}`;
            const filePath = path.join(uploadDir, fileName);
            const buffer = Buffer.from(await file.arrayBuffer());
            await writeFile(filePath, buffer);
            uploadedUrls.push(`/uploads/students/${student.id}/${fileName}`);
        }

        const updated = await prisma.student.update({
            where: { id: student.id },
            data:
                kind === "photo"
                    ? { photoUrl: uploadedUrls[0] }
                    : kind === "idProof"
                        ? { idProofUrl: uploadedUrls[0] }
                        : {
                            galleryImageUrls: Array.from(
                                new Set([...(student.galleryImageUrls || []), ...uploadedUrls])
                            ),
                        },
            include: {
                assignedUser: { select: { id: true, name: true, image: true, designation: true } },
            },
        });

        void scheduleKnowledgeIndexRefresh(student.organizationId).catch((error) => {
            console.error("Student asset knowledge refresh failed:", error);
        });

        return NextResponse.json({
            success: true,
            kind,
            uploadedUrls,
            student: updated,
        });
    } catch (error) {
        if (error instanceof Response) return error;
        console.error("POST /api/students/[id]/assets error:", error);
        return NextResponse.json({ error: "Failed to upload student asset." }, { status: 500 });
    }
}
