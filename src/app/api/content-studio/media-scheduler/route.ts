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

type SchedulerMetadata = {
    campaign?: string;
    slotLabel?: string;
};

function normalizeText(value: unknown, limit = 500): string {
    return String(value ?? "")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, limit);
}

function buildScopeWhere(organizationId: string | null, userId: string) {
    return organizationId ? { organizationId } : { userId };
}

function parseDateParam(value: string | null, fallback: Date) {
    if (!value) return fallback;
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? fallback : parsed;
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

export async function GET(request: NextRequest) {
    try {
        const auth = await enforceToolAccess(["media-studio", "pdf-to-pdf"]);
        const { searchParams } = new URL(request.url);
        const now = new Date();
        const defaultFrom = new Date(now.getFullYear(), now.getMonth(), 1);
        const defaultTo = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
        const from = parseDateParam(searchParams.get("from"), defaultFrom);
        const to = parseDateParam(searchParams.get("to"), defaultTo);

        const scopeWhere = buildScopeWhere(auth.organizationId, auth.userId);

        const [items, recentAssets] = await Promise.all([
            prisma.mediaScheduleItem.findMany({
                where: {
                    ...scopeWhere,
                    scheduledFor: {
                        gte: from,
                        lte: to,
                    },
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
                orderBy: { scheduledFor: "asc" },
                take: 160,
            }),
            prisma.generatedMedia.findMany({
                where: auth.organizationId
                    ? { organizationId: auth.organizationId }
                    : {
                        OR: [{ userId: auth.userId }, { organizationId: null }],
                    },
                select: {
                    id: true,
                    prompt: true,
                    type: true,
                    mode: true,
                    assetUrl: true,
                    createdAt: true,
                },
                orderBy: { createdAt: "desc" },
                take: 16,
            }),
        ]);

        const serializedItems = items.map(serializeScheduleItem);
        const scheduledCount = serializedItems.filter((item: ReturnType<typeof serializeScheduleItem>) => item.status === "SCHEDULED").length;
        const publishedCount = serializedItems.filter((item: ReturnType<typeof serializeScheduleItem>) => item.status === "PUBLISHED").length;
        const pausedCount = serializedItems.filter((item: ReturnType<typeof serializeScheduleItem>) => item.status === "PAUSED").length;
        const attachedAssetCount = serializedItems.filter((item: ReturnType<typeof serializeScheduleItem>) => item.generatedMediaId).length;

        return NextResponse.json({
            success: true,
            items: serializedItems,
            recentAssets: recentAssets.map(serializeAsset),
            stats: {
                scheduledCount,
                publishedCount,
                pausedCount,
                attachedAssetCount,
            },
        });
    } catch (error: any) {
        if (error instanceof Response) return error;
        console.error("GET /api/content-studio/media-scheduler error:", error);
        return NextResponse.json(
            { error: error?.message || "Failed to load media scheduler." },
            { status: 500 }
        );
    }
}

export async function POST(request: NextRequest) {
    try {
        const auth = await enforceToolAccess(["media-studio", "pdf-to-pdf"]);
        const body = await request.json();

        const title = normalizeText(body?.title, 140);
        const description = normalizeText(body?.description, 1200);
        const platform = normalizeText(body?.platform, 40).toLowerCase() || "generic";
        const status = normalizeText(body?.status, 20).toUpperCase() || "SCHEDULED";
        const timezone = normalizeText(body?.timezone, 80) || "Asia/Kolkata";
        const generatedMediaId = normalizeText(body?.generatedMediaId, 80) || null;
        const scheduledForRaw = normalizeText(body?.scheduledFor, 80);
        const scheduledFor = scheduledForRaw ? new Date(scheduledForRaw) : null;

        if (!title) {
            return NextResponse.json({ error: "Title is required." }, { status: 400 });
        }

        if (!scheduledFor || Number.isNaN(scheduledFor.getTime())) {
            return NextResponse.json({ error: "Valid schedule time is required." }, { status: 400 });
        }

        if (!VALID_PLATFORMS.has(platform)) {
            return NextResponse.json({ error: "Unsupported platform." }, { status: 400 });
        }

        if (!VALID_STATUSES.has(status)) {
            return NextResponse.json({ error: "Unsupported status." }, { status: 400 });
        }

        const linkedMediaId = await validateLinkedMedia(
            generatedMediaId,
            auth.organizationId,
            auth.userId
        );

        const metadata: SchedulerMetadata = {
            campaign: normalizeText(body?.metadata?.campaign, 120),
            slotLabel: normalizeText(body?.metadata?.slotLabel, 120),
        };

        const item = await prisma.mediaScheduleItem.create({
            data: {
                title,
                description: description || null,
                platform,
                status,
                scheduledFor,
                timezone,
                metadata: metadata as object,
                organizationId: auth.organizationId,
                userId: auth.userId,
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
            item: serializeScheduleItem(item),
        });
    } catch (error: any) {
        if (error instanceof Response) return error;
        console.error("POST /api/content-studio/media-scheduler error:", error);
        return NextResponse.json(
            { error: error?.message || "Failed to create schedule item." },
            { status: 500 }
        );
    }
}
