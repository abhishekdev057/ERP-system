import { mkdir, readFile, rm, writeFile } from "fs/promises";
import path from "path";
import { randomUUID } from "crypto";
import { TwitterApi } from "twitter-api-v2";
import { prisma } from "@/lib/prisma";

export type SocialPlatform = "instagram" | "facebook" | "x";

type SocialConnectionSource = "saved" | "env";

type StoredSocialConnection = {
    platform: SocialPlatform;
    userId: string;
    organizationId?: string | null;
    values: Record<string, string>;
    createdAt: string;
    updatedAt: string;
};

type SocialActivityRecord = {
    id: string;
    platform: SocialPlatform;
    direction: "OUTBOUND";
    action: string;
    status: "sent" | "failed";
    targetLabel?: string;
    textBody?: string;
    assetUrl?: string;
    externalId?: string;
    externalUrl?: string;
    error?: string;
    createdAt: string;
};

export type SocialConnectionField = {
    key: string;
    label: string;
    placeholder: string;
    required?: boolean;
    secret?: boolean;
    helper?: string;
};

export type SocialRecentContent = {
    id: string;
    title: string;
    subtitle?: string;
    mediaUrl?: string;
    permalink?: string;
    createdAt?: string;
};

export type SocialRecentMedia = {
    id: string;
    prompt: string;
    type: string;
    assetUrl?: string;
    createdAt: string;
};

export type SocialDashboard = {
    platform: SocialPlatform;
    connected: boolean;
    connectionSource?: SocialConnectionSource;
    profile?: {
        title: string;
        subtitle?: string;
        avatarUrl?: string;
    };
    connectionSummary: {
        tokenPreview?: string;
        accountIdPreview?: string;
        pageIdPreview?: string;
        lastSyncAt?: string;
    };
    analytics: {
        recentOutboundCount: number;
        recentContentCount: number;
        savedMediaCount: number;
    };
    capabilities: string[];
    fields: SocialConnectionField[];
    recentContent: SocialRecentContent[];
    recentMedia: SocialRecentMedia[];
    recentActivity: SocialActivityRecord[];
    warning?: string;
};

type ConnectionDetails = {
    platform: SocialPlatform;
    source?: SocialConnectionSource;
    values: Record<string, string>;
    stored?: StoredSocialConnection | null;
};

type PublishOptions = {
    userId: string;
    organizationId: string | null;
    platform: SocialPlatform;
    text?: string;
    title?: string;
    assetUrl?: string;
    action?: string;
};

type PublishResult = {
    externalId: string;
    externalUrl?: string;
    targetLabel?: string;
};

export class SocialPublishError extends Error {
    code: string;
    status: number;

    constructor(message: string, code = "social_publish_failed", status = 500) {
        super(message);
        this.name = "SocialPublishError";
        this.code = code;
        this.status = status;
    }
}

const SOCIAL_STORE_DIR = path.join(process.cwd(), ".nexora-cache", "social-workspaces");
const SOCIAL_ACTIVITY_DIR = path.join(process.cwd(), ".nexora-cache", "social-activity");
const MAX_ACTIVITY = 60;

const INSTAGRAM_FIELDS: SocialConnectionField[] = [
    {
        key: "accessToken",
        label: "Access Token",
        placeholder: "Paste Instagram Graph access token",
        required: true,
        secret: true,
        helper: "Needs Instagram Graph publishing permissions.",
    },
    {
        key: "instagramUserId",
        label: "Instagram User ID",
        placeholder: "1784...",
        required: true,
        helper: "Instagram business account ID.",
    },
    {
        key: "pageId",
        label: "Linked Facebook Page ID",
        placeholder: "Optional page id",
        helper: "Optional, useful for reference and Meta account mapping.",
    },
];

const FACEBOOK_FIELDS: SocialConnectionField[] = [
    {
        key: "accessToken",
        label: "Page Access Token",
        placeholder: "Paste Facebook Page access token",
        required: true,
        secret: true,
        helper: "Should include page publishing permissions.",
    },
    {
        key: "pageId",
        label: "Page ID",
        placeholder: "1234567890",
        required: true,
    },
];

const X_FIELDS: SocialConnectionField[] = [
    {
        key: "apiKey",
        label: "API Key",
        placeholder: "X app API key",
        required: true,
        secret: true,
    },
    {
        key: "apiSecret",
        label: "API Secret",
        placeholder: "X app API secret",
        required: true,
        secret: true,
    },
    {
        key: "accessToken",
        label: "Access Token",
        placeholder: "X access token",
        required: true,
        secret: true,
    },
    {
        key: "accessTokenSecret",
        label: "Access Token Secret",
        placeholder: "X access token secret",
        required: true,
        secret: true,
    },
    {
        key: "userId",
        label: "User ID",
        placeholder: "Optional numeric user id",
        helper: "Optional. The workspace can resolve it automatically when permissions allow.",
    },
];

function getPlatformFields(platform: SocialPlatform) {
    if (platform === "instagram") return INSTAGRAM_FIELDS;
    if (platform === "facebook") return FACEBOOK_FIELDS;
    return X_FIELDS;
}

function getGraphApiVersion(platform: "instagram" | "facebook") {
    const globalVersion = String(process.env.META_GRAPH_API_VERSION || "").trim();
    const platformVersion =
        platform === "instagram"
            ? String(process.env.INSTAGRAM_GRAPH_API_VERSION || "").trim()
            : String(process.env.FACEBOOK_GRAPH_API_VERSION || "").trim();
    return platformVersion || globalVersion || "v22.0";
}

function getPublicAppOrigin() {
    return String(
        process.env.PUBLIC_APP_ORIGIN ||
        process.env.NEXTAUTH_URL ||
        process.env.YOUTUBE_PUBLIC_ORIGIN ||
        ""
    ).trim();
}

function isSocialPlatform(value: string): value is SocialPlatform {
    return value === "instagram" || value === "facebook" || value === "x";
}

export function parseSocialPlatform(value: string): SocialPlatform {
    const normalized = String(value || "").trim().toLowerCase();
    if (!isSocialPlatform(normalized)) {
        throw new SocialPublishError("Unsupported social platform.", "unsupported_social_platform", 400);
    }
    return normalized;
}

function tokenPreview(value?: string) {
    const token = String(value || "").trim();
    if (!token) return undefined;
    if (token.length <= 8) return token;
    return `${token.slice(0, 4)}…${token.slice(-4)}`;
}

function idPreview(value?: string) {
    const raw = String(value || "").trim();
    if (!raw) return undefined;
    if (raw.length <= 10) return raw;
    return `${raw.slice(0, 5)}…${raw.slice(-4)}`;
}

function normalizeStringMap(payload: Record<string, unknown>) {
    return Object.fromEntries(
        Object.entries(payload)
            .map(([key, value]) => [key, String(value || "").trim()])
            .filter(([, value]) => value.length > 0)
    );
}

function sanitizeConnectionValues(platform: SocialPlatform, values: Record<string, unknown>) {
    const normalized = normalizeStringMap(values);
    if (platform === "instagram") {
        return normalizeStringMap({
            accessToken: normalized.accessToken || "",
            instagramUserId: normalized.instagramUserId || "",
            pageId: normalized.pageId || "",
        });
    }

    if (platform === "facebook") {
        return normalizeStringMap({
            accessToken: normalized.accessToken || "",
            pageId: normalized.pageId || "",
        });
    }

    return normalizeStringMap({
        apiKey: normalized.apiKey || "",
        apiSecret: normalized.apiSecret || "",
        accessToken: normalized.accessToken || "",
        accessTokenSecret: normalized.accessTokenSecret || "",
        userId: normalized.userId || "",
    });
}

function getConnectionPath(platform: SocialPlatform, userId: string) {
    return path.join(SOCIAL_STORE_DIR, `${platform}-${userId}.json`);
}

function getActivityPath(platform: SocialPlatform, userId: string) {
    return path.join(SOCIAL_ACTIVITY_DIR, `${platform}-${userId}.json`);
}

async function ensureStoreDir() {
    await mkdir(SOCIAL_STORE_DIR, { recursive: true });
    await mkdir(SOCIAL_ACTIVITY_DIR, { recursive: true });
}

async function readJsonFile<T>(filePath: string): Promise<T | null> {
    try {
        const raw = await readFile(filePath, "utf8");
        return JSON.parse(raw) as T;
    } catch {
        return null;
    }
}

async function writeJsonFile(filePath: string, value: unknown) {
    await ensureStoreDir();
    await writeFile(filePath, JSON.stringify(value, null, 2), "utf8");
}

async function readStoredConnection(platform: SocialPlatform, userId: string) {
    return readJsonFile<StoredSocialConnection>(getConnectionPath(platform, userId));
}

async function writeStoredConnection(platform: SocialPlatform, userId: string, record: StoredSocialConnection) {
    await writeJsonFile(getConnectionPath(platform, userId), record);
}

async function deleteStoredConnection(platform: SocialPlatform, userId: string) {
    await rm(getConnectionPath(platform, userId), { force: true }).catch(() => undefined);
}

async function readActivity(platform: SocialPlatform, userId: string) {
    return (await readJsonFile<SocialActivityRecord[]>(getActivityPath(platform, userId))) || [];
}

async function appendActivity(platform: SocialPlatform, userId: string, entry: SocialActivityRecord) {
    const current = await readActivity(platform, userId);
    const next = [entry, ...current].slice(0, MAX_ACTIVITY);
    await writeJsonFile(getActivityPath(platform, userId), next);
}

function getEnvValues(platform: SocialPlatform): Record<string, string> {
    if (platform === "instagram") {
        return normalizeStringMap({
            accessToken: process.env.INSTAGRAM_ACCESS_TOKEN,
            instagramUserId: process.env.INSTAGRAM_USER_ID,
            pageId: process.env.INSTAGRAM_PAGE_ID,
        });
    }

    if (platform === "facebook") {
        return normalizeStringMap({
            accessToken: process.env.FACEBOOK_PAGE_ACCESS_TOKEN,
            pageId: process.env.FACEBOOK_PAGE_ID,
        });
    }

    return normalizeStringMap({
        apiKey: process.env.X_API_KEY,
        apiSecret: process.env.X_API_SECRET,
        accessToken: process.env.X_ACCESS_TOKEN,
        accessTokenSecret: process.env.X_ACCESS_TOKEN_SECRET,
        userId: process.env.X_USER_ID,
    });
}

async function resolveConnection(platform: SocialPlatform, userId: string): Promise<ConnectionDetails> {
    const stored = await readStoredConnection(platform, userId);
    const envValues = getEnvValues(platform);
    const storedValues = stored?.values || {};
    const values = {
        ...envValues,
        ...storedValues,
    };
    const source = stored ? "saved" : Object.keys(envValues).length ? "env" : undefined;
    return {
        platform,
        source,
        values,
        stored,
    };
}

function assertRequiredFields(platform: SocialPlatform, values: Record<string, string>) {
    const missing = getPlatformFields(platform)
        .filter((field) => field.required && !String(values[field.key] || "").trim())
        .map((field) => field.label);
    if (missing.length) {
        throw new SocialPublishError(
            `Missing required ${platform} connection fields: ${missing.join(", ")}.`,
            "missing_social_connection_fields",
            400
        );
    }
}

function getMimeTypeFromPath(filePath: string) {
    const ext = path.extname(filePath).toLowerCase();
    if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
    if (ext === ".png") return "image/png";
    if (ext === ".webp") return "image/webp";
    if (ext === ".gif") return "image/gif";
    if (ext === ".mp4") return "video/mp4";
    if (ext === ".mov") return "video/quicktime";
    return "application/octet-stream";
}

function isVideoFile(filePathOrUrl: string) {
    return /\.(mp4|mov|m4v|webm)(\?.*)?$/i.test(filePathOrUrl);
}

function resolveAssetFilePath(assetUrl?: string) {
    const normalized = String(assetUrl || "").trim();
    if (!normalized.startsWith("/")) return null;
    return path.join(process.cwd(), "public", normalized.replace(/^\/+/, ""));
}

function resolveAbsoluteAssetUrl(assetUrl?: string) {
    const normalized = String(assetUrl || "").trim();
    if (!normalized) return null;
    if (/^https?:\/\//i.test(normalized)) return normalized;
    const origin = getPublicAppOrigin();
    if (!origin || !normalized.startsWith("/")) return null;
    return new URL(normalized, origin).toString();
}

async function getRecentGeneratedMedia(organizationId: string | null, userId: string) {
    const rows = await prisma.generatedMedia.findMany({
        where: {
            OR: [
                organizationId ? { organizationId } : undefined,
                { userId },
            ].filter(Boolean) as any,
            assetUrl: { not: null },
        },
        orderBy: { createdAt: "desc" },
        take: 8,
        select: {
            id: true,
            prompt: true,
            type: true,
            assetUrl: true,
            createdAt: true,
        },
    });

    return rows.map((row) => ({
        id: row.id,
        prompt: row.prompt,
        type: row.type,
        assetUrl: row.assetUrl || undefined,
        createdAt: row.createdAt.toISOString(),
    })) satisfies SocialRecentMedia[];
}

async function graphRequest<T>(
    platform: "instagram" | "facebook",
    endpoint: string,
    options: {
        method?: "GET" | "POST";
        params?: Record<string, string | number | undefined>;
        body?: URLSearchParams | FormData;
    } = {}
) {
    const version = getGraphApiVersion(platform);
    const url = new URL(`https://graph.facebook.com/${version}/${endpoint.replace(/^\/+/, "")}`);
    if (options.params) {
        Object.entries(options.params).forEach(([key, value]) => {
            if (value === undefined || value === null || value === "") return;
            url.searchParams.set(key, String(value));
        });
    }

    const response = await fetch(url.toString(), {
        method: options.method || "GET",
        body: options.body,
        cache: "no-store",
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data?.error) {
        const message = String(data?.error?.message || `Meta API request failed for ${endpoint}.`);
        throw new SocialPublishError(message, "meta_api_error", response.status || 500);
    }
    return data as T;
}

async function fetchInstagramDashboard(connection: ConnectionDetails) {
    assertRequiredFields("instagram", connection.values);
    const accessToken = connection.values.accessToken;
    const instagramUserId = connection.values.instagramUserId;
    const profile = await graphRequest<{
        id: string;
        username?: string;
        name?: string;
        profile_picture_url?: string;
        followers_count?: number;
        media_count?: number;
    }>("instagram", instagramUserId, {
        params: {
            fields: "id,username,name,profile_picture_url,followers_count,media_count",
            access_token: accessToken,
        },
    });

    const media = await graphRequest<{
        data?: Array<{
            id: string;
            caption?: string;
            media_type?: string;
            media_url?: string;
            thumbnail_url?: string;
            permalink?: string;
            timestamp?: string;
        }>;
    }>("instagram", `${instagramUserId}/media`, {
        params: {
            fields: "id,caption,media_type,media_url,thumbnail_url,permalink,timestamp",
            limit: 8,
            access_token: accessToken,
        },
    });

    return {
        profile: {
            title: profile.name || profile.username || "Instagram account",
            subtitle: profile.username ? `@${profile.username}` : `IG User ${profile.id}`,
            avatarUrl: profile.profile_picture_url,
        },
        recentContent: (media.data || []).map((item) => ({
            id: item.id,
            title: item.caption?.slice(0, 90) || item.media_type || "Instagram post",
            subtitle: item.media_type,
            mediaUrl: item.media_url || item.thumbnail_url,
            permalink: item.permalink,
            createdAt: item.timestamp,
        })) satisfies SocialRecentContent[],
    };
}

async function fetchFacebookDashboard(connection: ConnectionDetails) {
    assertRequiredFields("facebook", connection.values);
    const accessToken = connection.values.accessToken;
    const pageId = connection.values.pageId;
    const profile = await graphRequest<{
        id: string;
        name?: string;
        link?: string;
        fan_count?: number;
        followers_count?: number;
        picture?: { data?: { url?: string } };
    }>("facebook", pageId, {
        params: {
            fields: "id,name,link,fan_count,followers_count,picture{url}",
            access_token: accessToken,
        },
    });

    const posts = await graphRequest<{
        data?: Array<{
            id: string;
            message?: string;
            created_time?: string;
            permalink_url?: string;
        }>;
    }>("facebook", `${pageId}/posts`, {
        params: {
            fields: "id,message,created_time,permalink_url",
            limit: 8,
            access_token: accessToken,
        },
    });

    return {
        profile: {
            title: profile.name || "Facebook page",
            subtitle: profile.link || `Page ${profile.id}`,
            avatarUrl: profile.picture?.data?.url,
        },
        recentContent: (posts.data || []).map((item) => ({
            id: item.id,
            title: item.message?.slice(0, 90) || "Facebook post",
            subtitle: "Page post",
            permalink: item.permalink_url,
            createdAt: item.created_time,
        })) satisfies SocialRecentContent[],
    };
}

function createXClient(values: Record<string, string>) {
    return new TwitterApi({
        appKey: values.apiKey,
        appSecret: values.apiSecret,
        accessToken: values.accessToken,
        accessSecret: values.accessTokenSecret,
    });
}

async function fetchXDashboard(connection: ConnectionDetails) {
    assertRequiredFields("x", connection.values);
    const client = createXClient(connection.values);
    const me = await client.v2.me({
        "user.fields": ["description", "profile_image_url", "public_metrics", "username"],
    });

    const userId = connection.values.userId || me.data.id;
    const timeline = await client.v2.userTimeline(userId, {
        max_results: 8,
        expansions: ["attachments.media_keys"],
        "tweet.fields": ["created_at", "public_metrics", "attachments"],
        "media.fields": ["preview_image_url", "url", "type"],
    });

    const mediaByKey = new Map(
        (timeline.includes?.media || []).map((media) => [media.media_key, media])
    );

    return {
        profile: {
            title: me.data.name || "X account",
            subtitle: me.data.username ? `@${me.data.username}` : undefined,
            avatarUrl: me.data.profile_image_url,
        },
        recentContent: (timeline.data?.data || []).map((tweet) => {
            const firstMediaKey = tweet.attachments?.media_keys?.[0];
            const media = firstMediaKey ? mediaByKey.get(firstMediaKey) : undefined;
            return {
                id: tweet.id,
                title: tweet.text?.slice(0, 90) || "X post",
                subtitle: "Tweet / Post",
                mediaUrl: media?.url || media?.preview_image_url,
                permalink:
                    me.data.username && tweet.id
                        ? `https://x.com/${me.data.username}/status/${tweet.id}`
                        : undefined,
                createdAt: tweet.created_at,
            };
        }) satisfies SocialRecentContent[],
    };
}

export async function getSocialDashboard(options: {
    platform: SocialPlatform;
    userId: string;
    organizationId: string | null;
}) {
    const connection = await resolveConnection(options.platform, options.userId);
    const recentActivity = await readActivity(options.platform, options.userId);
    const recentMedia = await getRecentGeneratedMedia(options.organizationId, options.userId);

    if (!connection.source) {
        return {
            platform: options.platform,
            connected: false,
            fields: getPlatformFields(options.platform),
            connectionSummary: {},
            analytics: {
                recentOutboundCount: recentActivity.filter((item) => item.status === "sent").length,
                recentContentCount: 0,
                savedMediaCount: recentMedia.length,
            },
            capabilities: getPlatformCapabilities(options.platform),
            recentContent: [],
            recentMedia,
            recentActivity,
            warning: "Connect this workspace by saving platform credentials below or by filling the matching .env values.",
        } satisfies SocialDashboard;
    }

    try {
        const resolved =
            options.platform === "instagram"
                ? await fetchInstagramDashboard(connection)
                : options.platform === "facebook"
                    ? await fetchFacebookDashboard(connection)
                    : await fetchXDashboard(connection);

        return {
            platform: options.platform,
            connected: true,
            connectionSource: connection.source,
            profile: resolved.profile,
            fields: getPlatformFields(options.platform),
            connectionSummary: {
                tokenPreview: tokenPreview(connection.values.accessToken),
                accountIdPreview: idPreview(connection.values.instagramUserId || connection.values.userId),
                pageIdPreview: idPreview(connection.values.pageId),
                lastSyncAt: new Date().toISOString(),
            },
            analytics: {
                recentOutboundCount: recentActivity.filter((item) => item.status === "sent").length,
                recentContentCount: resolved.recentContent.length,
                savedMediaCount: recentMedia.length,
            },
            capabilities: getPlatformCapabilities(options.platform),
            recentContent: resolved.recentContent,
            recentMedia,
            recentActivity,
        } satisfies SocialDashboard;
    } catch (error) {
        const socialError = error as SocialPublishError;
        return {
            platform: options.platform,
            connected: false,
            connectionSource: connection.source,
            fields: getPlatformFields(options.platform),
            connectionSummary: {
                tokenPreview: tokenPreview(connection.values.accessToken),
                accountIdPreview: idPreview(connection.values.instagramUserId || connection.values.userId),
                pageIdPreview: idPreview(connection.values.pageId),
            },
            analytics: {
                recentOutboundCount: recentActivity.filter((item) => item.status === "sent").length,
                recentContentCount: 0,
                savedMediaCount: recentMedia.length,
            },
            capabilities: getPlatformCapabilities(options.platform),
            recentContent: [],
            recentMedia,
            recentActivity,
            warning: socialError.message || "Unable to validate the social connection with the platform API.",
        } satisfies SocialDashboard;
    }
}

export async function saveSocialConnection(options: {
    platform: SocialPlatform;
    userId: string;
    organizationId: string | null;
    values: Record<string, unknown>;
}) {
    const now = new Date().toISOString();
    const existing = await readStoredConnection(options.platform, options.userId);
    const record: StoredSocialConnection = {
        platform: options.platform,
        userId: options.userId,
        organizationId: options.organizationId,
        values: sanitizeConnectionValues(options.platform, options.values),
        createdAt: existing?.createdAt || now,
        updatedAt: now,
    };
    await writeStoredConnection(options.platform, options.userId, record);
    return getSocialDashboard({
        platform: options.platform,
        userId: options.userId,
        organizationId: options.organizationId,
    });
}

export async function disconnectSocialConnection(platform: SocialPlatform, userId: string) {
    await deleteStoredConnection(platform, userId);
}

function getPlatformCapabilities(platform: SocialPlatform) {
    if (platform === "instagram") {
        return ["Feed image publish", "Reel publish", "Recent media sync"];
    }
    if (platform === "facebook") {
        return ["Page posts", "Photo upload", "Video upload"];
    }
    return ["Text posts", "Image posts", "Recent timeline sync"];
}

async function waitForInstagramContainer(accessToken: string, creationId: string) {
    for (let index = 0; index < 12; index += 1) {
        const status = await graphRequest<{ status_code?: string; status?: string }>("instagram", creationId, {
            params: {
                fields: "status_code,status",
                access_token: accessToken,
            },
        });
        const code = String(status.status_code || status.status || "").toUpperCase();
        if (!code || code === "FINISHED" || code === "PUBLISHED") return;
        if (code === "ERROR" || code === "EXPIRED") {
            throw new SocialPublishError("Instagram media container failed before publish.", "instagram_container_failed", 400);
        }
        await new Promise((resolve) => setTimeout(resolve, 2500));
    }
}

async function publishToInstagram(connection: ConnectionDetails, payload: PublishOptions): Promise<PublishResult> {
    assertRequiredFields("instagram", connection.values);
    const accessToken = connection.values.accessToken;
    const instagramUserId = connection.values.instagramUserId;
    const absoluteAssetUrl = resolveAbsoluteAssetUrl(payload.assetUrl);
    const text = String(payload.text || payload.title || "").trim();
    if (!absoluteAssetUrl) {
        throw new SocialPublishError(
            "Instagram publishing needs a public asset URL. Set PUBLIC_APP_ORIGIN/NEXTAUTH_URL on the deployed app.",
            "instagram_public_asset_required",
            400
        );
    }

    const isVideo = isVideoFile(absoluteAssetUrl);
    const containerParams = new URLSearchParams();
    containerParams.set("access_token", accessToken);
    if (text) {
        containerParams.set("caption", text);
    }
    if (isVideo) {
        containerParams.set("media_type", "REELS");
        containerParams.set("video_url", absoluteAssetUrl);
    } else {
        containerParams.set("image_url", absoluteAssetUrl);
    }

    const creation = await graphRequest<{ id: string }>("instagram", `${instagramUserId}/media`, {
        method: "POST",
        body: containerParams,
    });

    await waitForInstagramContainer(accessToken, creation.id);

    const publish = await graphRequest<{ id: string }>("instagram", `${instagramUserId}/media_publish`, {
        method: "POST",
        body: new URLSearchParams({
            access_token: accessToken,
            creation_id: creation.id,
        }),
    });

    return {
        externalId: publish.id,
        externalUrl: `https://www.instagram.com/`,
        targetLabel: connection.values.instagramUserId,
    };
}

async function resolveAssetUpload(assetUrl?: string) {
    const localPath = resolveAssetFilePath(assetUrl);
    if (localPath) {
        const buffer = await readFile(localPath);
        return {
            buffer,
            fileName: path.basename(localPath),
            contentType: getMimeTypeFromPath(localPath),
            localPath,
        };
    }

    const absoluteUrl = resolveAbsoluteAssetUrl(assetUrl) || String(assetUrl || "").trim();
    if (!absoluteUrl) return null;

    const response = await fetch(absoluteUrl);
    if (!response.ok) {
        throw new SocialPublishError("Unable to fetch the selected asset for upload.", "asset_fetch_failed", 400);
    }
    const arrayBuffer = await response.arrayBuffer();
    return {
        buffer: Buffer.from(arrayBuffer),
        fileName: `asset${isVideoFile(absoluteUrl) ? ".mp4" : ".png"}`,
        contentType: response.headers.get("content-type") || (isVideoFile(absoluteUrl) ? "video/mp4" : "image/png"),
        localPath: null,
    };
}

async function publishToFacebook(connection: ConnectionDetails, payload: PublishOptions): Promise<PublishResult> {
    assertRequiredFields("facebook", connection.values);
    const accessToken = connection.values.accessToken;
    const pageId = connection.values.pageId;
    const text = String(payload.text || payload.title || "").trim();
    const upload = payload.assetUrl ? await resolveAssetUpload(payload.assetUrl) : null;

    if (!upload) {
        const post = await graphRequest<{ id: string }>("facebook", `${pageId}/feed`, {
            method: "POST",
            body: new URLSearchParams({
                access_token: accessToken,
                message: text,
            }),
        });

        return {
            externalId: post.id,
            targetLabel: pageId,
        };
    }

    const form = new FormData();
    form.set("access_token", accessToken);
    if (text) {
        form.set(upload.contentType.startsWith("video/") ? "description" : "caption", text);
    }
    form.set(
        upload.contentType.startsWith("video/") ? "source" : "source",
        new Blob([new Uint8Array(upload.buffer)], { type: upload.contentType }),
        upload.fileName
    );

    const endpoint = upload.contentType.startsWith("video/") ? `${pageId}/videos` : `${pageId}/photos`;
    const published = await graphRequest<{ id: string; post_id?: string }>("facebook", endpoint, {
        method: "POST",
        body: form,
    });

    return {
        externalId: published.post_id || published.id,
        targetLabel: pageId,
    };
}

async function publishToX(connection: ConnectionDetails, payload: PublishOptions): Promise<PublishResult> {
    assertRequiredFields("x", connection.values);
    const client = createXClient(connection.values);
    const text = String(payload.text || payload.title || "").trim();
    const upload = payload.assetUrl ? await resolveAssetUpload(payload.assetUrl) : null;
    let mediaIds: string[] | undefined;

    if (upload) {
        const mediaId = await client.v1.uploadMedia(upload.buffer, {
            mimeType: upload.contentType,
            target: "tweet",
        });
        mediaIds = [mediaId];
    }

    const tweet = await client.v2.tweet({
        text: text || "Shared from Nexora Media Studio",
        media: mediaIds ? { media_ids: [mediaIds[0]] as [string] } : undefined,
    });

    const userId = connection.values.userId || "";
    return {
        externalId: tweet.data.id,
        externalUrl: userId ? `https://x.com/i/web/status/${tweet.data.id}` : undefined,
        targetLabel: connection.values.userId || "X timeline",
    };
}

export async function publishToSocial(options: PublishOptions) {
    const connection = await resolveConnection(options.platform, options.userId);
    if (!connection.source) {
        throw new SocialPublishError(
            `Connect the ${options.platform} workspace before publishing from Media Studio.`,
            "social_connection_missing",
            400
        );
    }

    const result =
        options.platform === "instagram"
            ? await publishToInstagram(connection, options)
            : options.platform === "facebook"
                ? await publishToFacebook(connection, options)
                : await publishToX(connection, options);

    await appendActivity(options.platform, options.userId, {
        id: randomUUID(),
        platform: options.platform,
        direction: "OUTBOUND",
        action: options.action || "publish",
        status: "sent",
        targetLabel: result.targetLabel,
        textBody: String(options.text || options.title || "").slice(0, 400) || undefined,
        assetUrl: options.assetUrl,
        externalId: result.externalId,
        externalUrl: result.externalUrl,
        createdAt: new Date().toISOString(),
    });

    return result;
}
