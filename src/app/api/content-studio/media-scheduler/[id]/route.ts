import { NextRequest, NextResponse } from "next/server";
import { enforceToolAccess } from "@/lib/api-auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

const VALID_STATUSES = new Set(["DRAFT", "SCHEDULED", "PUBLISHED", "PAUSED"]);
const VALID_PLATFORMS = new Set([
    "instagram",
    "facebook",
    "youtube",
    "whatsapp",
    "telegram",
    "generic",
]);

function normalizeText(value: unknown, limit = 500): string {
    return String(value ?? "")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, limit);
}

function buildScopeWhere(organizationId: string | null, userId: string) {
    return organizationId ? { organizationId } : { userId };
}

function serializeAsset(record: any) {
    return {
        id: String(record.id),
        prompt: String(record.prompt || ""),
        type: String(record.type || "image"),
        mode: String(record.mode || "text_to_image"),
        assetUrl: record.assetUrl ? String(record.assetUrl) : null,
        createdAt:
            record.createdAt instanceof Date
                ? record.createdAt.toISOString()
                : String(record.createdAt || new Date().toISOString()),
    };
}

function serializeScheduleItem(record: any) {
    return {
        id: String(record.id),
        title: String(record.title || ""),
        description: record.description ? String(record.description) : "",
        platform: String(record.platform || "generic"),
        status: String(record.status || "SCHEDULED"),
        scheduledFor:
            record.scheduledFor instanceof Date
                ? record.scheduledFor.toISOString()
                : String(record.scheduledFor || new Date().toISOString()),
        timezone: String(record.timezone || "Asia/Kolkata"),
        metadata:
            record.metadata && typeof record.metadata === "object" && !Array.isArray(record.metadata)
                ? record.metadata
                : {},
        createdAt:
            record.createdAt instanceof Date
                ? record.createdAt.toISOString()
                : String(record.createdAt || new Date().toISOString()),
        updatedAt:
            record.updatedAt instanceof Date
                ? record.updatedAt.toISOString()
                : String(record.updatedAt || new Date().toISOString()),
        generatedMediaId: record.generatedMediaId ? String(record.generatedMediaId) : null,
        generatedMedia: record.generatedMedia ? serializeAsset(record.generatedMedia) : null,
    };
}

async function validateLinkedMedia(
    generatedMediaId: string | null,
    organizationId: string | null,
    userId: string
) {
    if (!generatedMediaId) return null;

    const asset = await prisma.generatedMedia.findFirst({
        where: {
            id: generatedMediaId,
            ...(organizationId
                ? { organizationId }
                : {
                    OR: [{ userId }, { organizationId: null }],
                }),
        },
        select: {
            id: true,
        },
    });

    if (!asset) {
        throw new Error("Selected media asset is not available for this workspace.");
    }

    return asset.id;
}

export async function PATCH(
    request: NextRequest,
    { params }: { params: { id: string } }
) {
    try {
        const auth = await enforceToolAccess(["media-studio", "pdf-to-pdf"]);
        const id = normalizeText(params.id, 80);
        const body = await request.json();

        const existing = await prisma.mediaScheduleItem.findFirst({
            where: {
                id,
                ...buildScopeWhere(auth.organizationId, auth.userId),
            },
        });

        if (!existing) {
            return NextResponse.json({ error: "Schedule item not found." }, { status: 404 });
        }

        const nextTitle = normalizeText(body?.title, 140) || existing.title;
        const nextDescription = normalizeText(body?.description, 1200);
        const nextPlatform = normalizeText(body?.platform, 40).toLowerCase() || existing.platform;
        const nextStatus = normalizeText(body?.status, 20).toUpperCase() || existing.status;
        const nextTimezone = normalizeText(body?.timezone, 80) || existing.timezone;
        const scheduledForRaw = normalizeText(body?.scheduledFor, 80);
        const nextScheduledFor = scheduledForRaw ? new Date(scheduledForRaw) : existing.scheduledFor;
        const generatedMediaId =
            body?.generatedMediaId === null
                ? null
                : normalizeText(body?.generatedMediaId, 80) || existing.generatedMediaId;

        if (!VALID_PLATFORMS.has(nextPlatform)) {
            return NextResponse.json({ error: "Unsupported platform." }, { status: 400 });
        }

        if (!VALID_STATUSES.has(nextStatus)) {
            return NextResponse.json({ error: "Unsupported status." }, { status: 400 });
        }

        if (Number.isNaN(nextScheduledFor.getTime())) {
            return NextResponse.json({ error: "Valid schedule time is required." }, { status: 400 });
        }

        const linkedMediaId = await validateLinkedMedia(
            generatedMediaId,
            auth.organizationId,
            auth.userId
        );

        const metadata = {
            campaign: normalizeText(body?.metadata?.campaign, 120),
            slotLabel: normalizeText(body?.metadata?.slotLabel, 120),
        };

        const updated = await prisma.mediaScheduleItem.update({
            where: { id: existing.id },
            data: {
                title: nextTitle,
                description: nextDescription || null,
                platform: nextPlatform,
                status: nextStatus,
                scheduledFor: nextScheduledFor,
                timezone: nextTimezone,
                metadata: metadata as object,
                generatedMediaId: linkedMediaId,
            },
            include: {
                generatedMedia: {
                    select: {
                        id: true,
                        prompt: true,
                        type: true,
                        mode: true,
                        assetUrl: true,
                        createdAt: true,
                    },
                },
            },
        });

        return NextResponse.json({
            success: true,
            item: serializeScheduleItem(updated),
        });
    } catch (error: any) {
        if (error instanceof Response) return error;
        console.error(`PATCH /api/content-studio/media-scheduler/${params.id} error:`, error);
        return NextResponse.json(
            { error: error?.message || "Failed to update schedule item." },
            { status: 500 }
        );
    }
}

export async function DELETE(
    _request: NextRequest,
    { params }: { params: { id: string } }
) {
    try {
        const auth = await enforceToolAccess(["media-studio", "pdf-to-pdf"]);
        const id = normalizeText(params.id, 80);

        const existing = await prisma.mediaScheduleItem.findFirst({
            where: {
                id,
                ...buildScopeWhere(auth.organizationId, auth.userId),
            },
            select: { id: true },
        });

        if (!existing) {
            return NextResponse.json({ error: "Schedule item not found." }, { status: 404 });
        }

        await prisma.mediaScheduleItem.delete({
            where: { id: existing.id },
        });

        return NextResponse.json({ success: true });
    } catch (error: any) {
        if (error instanceof Response) return error;
        console.error(`DELETE /api/content-studio/media-scheduler/${params.id} error:`, error);
        return NextResponse.json(
            { error: error?.message || "Failed to delete schedule item." },
            { status: 500 }
        );
    }
}
