import { readFile } from "fs/promises";
import path from "path";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

const TELEGRAM_API_BASE = "https://api.telegram.org";
const TELEGRAM_ALLOWED_UPDATES = ["message", "edited_message", "channel_post", "edited_channel_post"];

export class TelegramError extends Error {
    code: string;
    status: number;
    retryAfterSeconds?: number;

    constructor(message: string, code = "telegram_error", status = 500, retryAfterSeconds?: number) {
        super(message);
        this.name = "TelegramError";
        this.code = code;
        this.status = status;
        this.retryAfterSeconds = retryAfterSeconds;
    }
}

type TelegramEnvelope<T> = {
    ok?: boolean;
    result?: T;
    description?: string;
    error_code?: number;
    parameters?: {
        retry_after?: number;
        migrate_to_chat_id?: number | string;
    };
};

type TelegramBotProfile = {
    id: number;
    is_bot: boolean;
    first_name: string;
    username?: string;
    can_join_groups?: boolean;
    can_read_all_group_messages?: boolean;
    supports_inline_queries?: boolean;
};

type TelegramWebhookInfo = {
    url?: string;
    has_custom_certificate?: boolean;
    pending_update_count?: number;
    ip_address?: string;
    last_error_date?: number;
    last_error_message?: string;
    max_connections?: number;
    allowed_updates?: string[];
};

type TelegramChat = {
    id: number | string;
    type?: string;
    title?: string;
    username?: string;
    first_name?: string;
    last_name?: string;
};

type TelegramUser = {
    id?: number;
    is_bot?: boolean;
    first_name?: string;
    last_name?: string;
    username?: string;
};

type TelegramMessagePayload = {
    message_id?: number;
    date?: number;
    text?: string;
    caption?: string;
    chat?: TelegramChat;
    from?: TelegramUser;
    sender_chat?: TelegramChat;
    photo?: Array<{ file_id?: string }>;
    video?: { file_id?: string };
    document?: { file_id?: string; file_name?: string };
    sticker?: { file_id?: string; emoji?: string };
};

type TelegramUpdate = {
    update_id: number;
    message?: TelegramMessagePayload;
    edited_message?: TelegramMessagePayload;
    channel_post?: TelegramMessagePayload;
    edited_channel_post?: TelegramMessagePayload;
};

type TelegramSendResponse = TelegramMessagePayload;

export type TelegramTargetSummary = {
    id: string;
    chatId: string;
    title: string;
    username?: string;
    type: string;
    source: string;
    isPinned: boolean;
    lastSeenAt?: string;
};

export type TelegramActivitySummary = {
    id: string;
    direction: string;
    method: string;
    status: string;
    updateType?: string;
    targetChatId: string;
    targetLabel?: string;
    authorName?: string;
    authorUsername?: string;
    textBody?: string;
    mediaUrl?: string;
    createdAt: string;
};

export type TelegramMediaAssetSummary = {
    id: string;
    type: string;
    prompt: string;
    assetUrl?: string;
    createdAt: string;
};

export type TelegramDashboard = {
    connected: boolean;
    configuredBotAvailable: boolean;
    connection?: {
        id: string;
        tokenPreview: string;
        lastSyncAt?: string;
        lastUpdateId?: number;
    };
    bot?: {
        id: string;
        username?: string;
        firstName: string;
        canJoinGroups: boolean;
        canReadAllGroupMessages: boolean;
        supportsInlineQueries: boolean;
    };
    webhook?: {
        url?: string;
        pendingUpdateCount: number;
        lastErrorMessage?: string;
        lastErrorAt?: string;
        canPoll: boolean;
    };
    targets: TelegramTargetSummary[];
    recentActivity: TelegramActivitySummary[];
    recentMedia: TelegramMediaAssetSummary[];
    analytics: {
        savedTargets: number;
        inboundToday: number;
        outboundToday: number;
        pendingWebhookUpdates: number;
        recentActivityCount: number;
    };
    capabilities: string[];
    warning?: string;
};

type UpsertTelegramConnectionOptions = {
    userId: string;
    organizationId: string | null;
    botToken?: string;
};

type SendTelegramPayloadOptions = {
    userId: string;
    organizationId: string | null;
    type: "text" | "photo" | "video";
    targets: string[];
    body?: string;
    mediaUrl?: string;
    caption?: string;
    pinTargets?: boolean;
};

type ResolvedOutgoingMedia =
    | { kind: "url"; value: string }
    | { kind: "file"; buffer: Buffer; fileName: string; contentType: string };

function getDefaultTelegramBotToken() {
    return String(process.env.TELEGRAM_BOT_TOKEN || "").trim();
}

function slugifyCode(value: string) {
    return value
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "_")
        .replace(/^_+|_+$/g, "") || "telegram_error";
}

function parseTelegramError(payload: unknown, fallbackMessage: string, fallbackStatus = 500) {
    const envelope = payload as TelegramEnvelope<unknown>;
    const message = String(envelope?.description || fallbackMessage).trim() || fallbackMessage;
    const status = Number(envelope?.error_code || fallbackStatus) || fallbackStatus;
    const retryAfter = Number(envelope?.parameters?.retry_after || 0) || undefined;
    return new TelegramError(message, slugifyCode(message), status, retryAfter);
}

async function telegramApiRequest<T>(token: string, method: string, body?: Record<string, unknown>) {
    const response = await fetch(`${TELEGRAM_API_BASE}/bot${token}/${method}`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
        },
        body: JSON.stringify(body || {}),
        cache: "no-store",
    });

    const payload = (await response.json().catch(() => ({}))) as TelegramEnvelope<T>;
    if (response.ok && payload.ok) {
        return payload.result as T;
    }
    throw parseTelegramError(payload, `Telegram API request failed for ${method}.`, response.status);
}

async function telegramMultipartRequest<T>(
    token: string,
    method: string,
    fields: Record<string, string>,
    upload: { fieldName: string; fileName: string; contentType: string; buffer: Buffer }
) {
    const formData = new FormData();
    Object.entries(fields).forEach(([key, value]) => {
        formData.set(key, value);
    });
    formData.set(
        upload.fieldName,
        new Blob([new Uint8Array(upload.buffer)], { type: upload.contentType }),
        upload.fileName
    );

    const response = await fetch(`${TELEGRAM_API_BASE}/bot${token}/${method}`, {
        method: "POST",
        body: formData,
        cache: "no-store",
    });

    const payload = (await response.json().catch(() => ({}))) as TelegramEnvelope<T>;
    if (response.ok && payload.ok) {
        return payload.result as T;
    }
    throw parseTelegramError(payload, `Telegram API request failed for ${method}.`, response.status);
}

function resolvePublicAssetPath(assetUrl: string | null | undefined): string | null {
    const normalized = String(assetUrl || "").trim();
    if (!normalized || !normalized.startsWith("/")) return null;
    return path.join(process.cwd(), "public", normalized.replace(/^\/+/, ""));
}

function mimeTypeFromFilePath(filePath: string): string {
    const ext = path.extname(filePath).toLowerCase();
    if (ext === ".png") return "image/png";
    if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
    if (ext === ".webp") return "image/webp";
    if (ext === ".mp4") return "video/mp4";
    if (ext === ".mov") return "video/quicktime";
    if (ext === ".webm") return "video/webm";
    return "application/octet-stream";
}

async function resolveOutgoingMedia(mediaUrl: string) {
    const normalized = String(mediaUrl || "").trim();
    if (!normalized) {
        throw new TelegramError("Media URL is required.", "telegram_media_required", 400);
    }

    const localPath = resolvePublicAssetPath(normalized);
    if (localPath) {
        const buffer = await readFile(localPath);
        return {
            kind: "file",
            buffer,
            fileName: path.basename(localPath),
            contentType: mimeTypeFromFilePath(localPath),
        } satisfies ResolvedOutgoingMedia;
    }

    return {
        kind: "url",
        value: normalized,
    } satisfies ResolvedOutgoingMedia;
}

function maskToken(token: string) {
    if (token.length <= 10) return token;
    return `${token.slice(0, 6)}…${token.slice(-4)}`;
}

function normalizeTargetList(values: string[] | string) {
    const source = Array.isArray(values) ? values : [values];
    return Array.from(
        new Set(
            source
                .join("\n")
                .split(/[\n,]/)
                .map((item) => String(item || "").trim())
                .filter(Boolean)
        )
    ).slice(0, 20);
}

function normalizeUsername(value: string | undefined | null) {
    const raw = String(value || "").trim();
    if (!raw) return undefined;
    return raw.startsWith("@") ? raw.slice(1) : raw;
}

function formatTelegramDate(unixSeconds: number | undefined) {
    if (!unixSeconds) return undefined;
    const date = new Date(unixSeconds * 1000);
    return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

function getMessageBody(message: TelegramMessagePayload | undefined) {
    if (!message) return undefined;
    const text = String(message.text || message.caption || "").trim();
    if (text) return text;
    if (Array.isArray(message.photo) && message.photo.length) return "[Photo]";
    if (message.video) return "[Video]";
    if (message.document) return `[Document${message.document.file_name ? `: ${message.document.file_name}` : ""}]`;
    if (message.sticker) return `[Sticker${message.sticker.emoji ? ` ${message.sticker.emoji}` : ""}]`;
    return "[Unsupported message]";
}

function pickUpdateMessage(update: TelegramUpdate): { message: TelegramMessagePayload; updateType: string } | null {
    if (update.message) return { message: update.message, updateType: "message" };
    if (update.edited_message) return { message: update.edited_message, updateType: "edited_message" };
    if (update.channel_post) return { message: update.channel_post, updateType: "channel_post" };
    if (update.edited_channel_post) return { message: update.edited_channel_post, updateType: "edited_channel_post" };
    return null;
}

function buildChatTitle(chat: TelegramChat | undefined) {
    if (!chat) return "Unknown chat";
    const name = [chat.first_name, chat.last_name].filter(Boolean).join(" ").trim();
    return String(chat.title || name || chat.username || chat.id || "Unknown chat").trim();
}

function summarizeTarget(target: {
    id: string;
    chatId: string;
    title: string;
    username: string | null;
    type: string;
    source: string;
    isPinned: boolean;
    lastSeenAt: Date | null;
}) {
    return {
        id: target.id,
        chatId: target.chatId,
        title: target.title,
        username: target.username || undefined,
        type: target.type,
        source: target.source,
        isPinned: target.isPinned,
        lastSeenAt: target.lastSeenAt?.toISOString(),
    } satisfies TelegramTargetSummary;
}

function summarizeActivity(message: {
    id: string;
    direction: string;
    method: string;
    status: string;
    updateType: string | null;
    targetChatId: string;
    targetLabel: string | null;
    authorName: string | null;
    authorUsername: string | null;
    textBody: string | null;
    mediaUrl: string | null;
    createdAt: Date;
}) {
    return {
        id: message.id,
        direction: message.direction,
        method: message.method,
        status: message.status,
        updateType: message.updateType || undefined,
        targetChatId: message.targetChatId,
        targetLabel: message.targetLabel || undefined,
        authorName: message.authorName || undefined,
        authorUsername: message.authorUsername || undefined,
        textBody: message.textBody || undefined,
        mediaUrl: message.mediaUrl || undefined,
        createdAt: message.createdAt.toISOString(),
    } satisfies TelegramActivitySummary;
}

function summarizeMedia(record: {
    id: string;
    type: string;
    prompt: string;
    assetUrl: string | null;
    createdAt: Date;
}) {
    return {
        id: record.id,
        type: record.type,
        prompt: record.prompt,
        assetUrl: record.assetUrl || undefined,
        createdAt: record.createdAt.toISOString(),
    } satisfies TelegramMediaAssetSummary;
}

function toPrismaJson(value: unknown): Prisma.InputJsonValue | Prisma.NullableJsonNullValueInput | undefined {
    if (value === undefined) return undefined;
    if (value === null) return Prisma.JsonNull;
    return value as Prisma.InputJsonValue;
}

async function getStoredConnection(userId: string) {
    return prisma.telegramConnection.findUnique({
        where: { userId },
    });
}

async function ensureTelegramConnection(userId: string) {
    const connection = await getStoredConnection(userId);
    if (!connection?.botToken) {
        throw new TelegramError("Telegram bot is not connected.", "telegram_not_connected", 404);
    }
    return connection;
}

async function upsertTargetRecord(options: {
    connectionId: string;
    userId: string;
    organizationId: string | null;
    chatId: string;
    title: string;
    username?: string;
    type: string;
    source: string;
    isPinned?: boolean;
    lastSeenAt?: Date;
    metadata?: Record<string, unknown>;
}) {
    const existing = await prisma.telegramTarget.findUnique({
        where: {
            connectionId_chatId: {
                connectionId: options.connectionId,
                chatId: options.chatId,
            },
        },
    });

    return existing
        ? prisma.telegramTarget.update({
            where: { id: existing.id },
            data: {
                title: options.title || existing.title,
                username: options.username || existing.username,
                type: options.type || existing.type,
                source: existing.source === "manual" ? existing.source : options.source,
                isPinned: options.isPinned ?? existing.isPinned,
                lastSeenAt: options.lastSeenAt || existing.lastSeenAt,
                metadata: toPrismaJson(options.metadata ?? existing.metadata),
            },
        })
        : prisma.telegramTarget.create({
            data: {
                connectionId: options.connectionId,
                userId: options.userId,
                organizationId: options.organizationId,
                chatId: options.chatId,
                title: options.title,
                username: options.username,
                type: options.type,
                source: options.source,
                isPinned: options.isPinned ?? false,
                lastSeenAt: options.lastSeenAt,
                metadata: toPrismaJson(options.metadata),
            },
        });
}

async function recordIncomingUpdate(connection: {
    id: string;
    userId: string;
    organizationId: string | null;
}, update: TelegramUpdate) {
    const picked = pickUpdateMessage(update);
    if (!picked) return;

    const chat = picked.message.chat;
    if (!chat?.id) return;

    const chatId = String(chat.id).trim();
    const senderName = [picked.message.from?.first_name, picked.message.from?.last_name]
        .filter(Boolean)
        .join(" ")
        .trim() || buildChatTitle(picked.message.sender_chat);
    const senderUsername = normalizeUsername(
        picked.message.from?.username || picked.message.sender_chat?.username
    );
    const createdAt = picked.message.date ? new Date(picked.message.date * 1000) : new Date();
    const body = getMessageBody(picked.message);

    const target = await upsertTargetRecord({
        connectionId: connection.id,
        userId: connection.userId,
        organizationId: connection.organizationId,
        chatId,
        title: buildChatTitle(chat),
        username: normalizeUsername(chat.username),
        type: String(chat.type || "private"),
        source: "update",
        lastSeenAt: createdAt,
        metadata: {
            chatType: chat.type,
        },
    });

    await prisma.telegramMessage.upsert({
        where: {
            telegramUpdateId: update.update_id,
        },
        update: {
            targetId: target.id,
            direction: "INBOUND",
            method: "getUpdates",
            updateType: picked.updateType,
            telegramMessageId: picked.message.message_id || null,
            targetChatId: chatId,
            targetLabel: target.title,
            authorName: senderName || null,
            authorUsername: senderUsername || null,
            textBody: body || null,
            status: "received",
            payload: toPrismaJson(update as unknown as Prisma.InputJsonValue),
            createdAt,
        },
        create: {
            connectionId: connection.id,
            userId: connection.userId,
            organizationId: connection.organizationId,
            targetId: target.id,
            direction: "INBOUND",
            method: "getUpdates",
            updateType: picked.updateType,
            telegramUpdateId: update.update_id,
            telegramMessageId: picked.message.message_id || null,
            targetChatId: chatId,
            targetLabel: target.title,
            authorName: senderName || null,
            authorUsername: senderUsername || null,
            textBody: body || null,
            status: "received",
            payload: toPrismaJson(update as unknown as Prisma.InputJsonValue),
            createdAt,
        },
    });
}

async function syncTelegramUpdates(connection: {
    id: string;
    userId: string;
    organizationId: string | null;
    botToken: string;
    lastUpdateId: number | null;
}) {
    const updates = await telegramApiRequest<TelegramUpdate[]>(connection.botToken, "getUpdates", {
        offset: connection.lastUpdateId || 0,
        limit: 20,
        timeout: 0,
        allowed_updates: TELEGRAM_ALLOWED_UPDATES,
    });

    if (!Array.isArray(updates) || !updates.length) {
        await prisma.telegramConnection.update({
            where: { id: connection.id },
            data: { lastSyncAt: new Date() },
        });
        return;
    }

    let nextOffset = connection.lastUpdateId || 0;
    for (const update of updates) {
        nextOffset = Math.max(nextOffset, Number(update.update_id || 0) + 1);
        await recordIncomingUpdate(connection, update);
    }

    await prisma.telegramConnection.update({
        where: { id: connection.id },
        data: {
            lastSyncAt: new Date(),
            lastUpdateId: nextOffset,
        },
    });
}

async function sendChatActionSafe(token: string, chatId: string, action: string) {
    try {
        await telegramApiRequest(token, "sendChatAction", {
            chat_id: chatId,
            action,
        });
    } catch (error) {
        console.warn("Telegram chat action skipped:", error);
    }
}

function inferTargetTitleFromReference(reference: string) {
    if (reference.startsWith("@")) return reference;
    return `Chat ${reference}`;
}

export async function upsertTelegramConnection(options: UpsertTelegramConnectionOptions) {
    const botToken = String(options.botToken || getDefaultTelegramBotToken()).trim();
    if (!botToken) {
        throw new TelegramError(
            "Paste a Telegram bot token or configure TELEGRAM_BOT_TOKEN on the server.",
            "telegram_token_required",
            400
        );
    }

    const bot = await telegramApiRequest<TelegramBotProfile>(botToken, "getMe");
    const webhook = await telegramApiRequest<TelegramWebhookInfo>(botToken, "getWebhookInfo");
    const existing = await prisma.telegramConnection.findUnique({
        where: { userId: options.userId },
    });

    const connection = existing
        ? await prisma.telegramConnection.update({
            where: { id: existing.id },
            data: {
                organizationId: options.organizationId,
                botToken,
                botId: String(bot.id),
                botUsername: bot.username || null,
                botFirstName: bot.first_name || "Telegram Bot",
                canJoinGroups: Boolean(bot.can_join_groups ?? true),
                canReadAllGroupMessages: Boolean(bot.can_read_all_group_messages ?? false),
                supportsInlineQueries: Boolean(bot.supports_inline_queries ?? false),
                webhookUrl: String(webhook.url || "").trim() || null,
                webhookPendingCount: Number(webhook.pending_update_count || 0),
                lastSyncAt: new Date(),
            },
        })
        : await prisma.telegramConnection.create({
            data: {
                userId: options.userId,
                organizationId: options.organizationId,
                botToken,
                botId: String(bot.id),
                botUsername: bot.username || null,
                botFirstName: bot.first_name || "Telegram Bot",
                canJoinGroups: Boolean(bot.can_join_groups ?? true),
                canReadAllGroupMessages: Boolean(bot.can_read_all_group_messages ?? false),
                supportsInlineQueries: Boolean(bot.supports_inline_queries ?? false),
                webhookUrl: String(webhook.url || "").trim() || null,
                webhookPendingCount: Number(webhook.pending_update_count || 0),
                lastSyncAt: new Date(),
            },
        });

    return connection;
}

export async function disconnectTelegramConnection(userId: string) {
    const deleted = await prisma.telegramConnection.deleteMany({
        where: { userId },
    });
    return deleted.count > 0;
}

export async function saveTelegramTarget(options: {
    userId: string;
    organizationId: string | null;
    chatId: string;
    title?: string;
    username?: string;
    type?: string;
    isPinned?: boolean;
}) {
    const connection = await ensureTelegramConnection(options.userId);
    const normalizedChatId = String(options.chatId || "").trim();
    if (!normalizedChatId) {
        throw new TelegramError("Target chat ID or @username is required.", "telegram_target_required", 400);
    }

    return upsertTargetRecord({
        connectionId: connection.id,
        userId: connection.userId,
        organizationId: connection.organizationId,
        chatId: normalizedChatId,
        title: String(options.title || inferTargetTitleFromReference(normalizedChatId)).trim(),
        username: normalizeUsername(options.username || (normalizedChatId.startsWith("@") ? normalizedChatId : "")),
        type: String(options.type || (normalizedChatId.startsWith("@") ? "channel" : "direct")).trim(),
        source: "manual",
        isPinned: options.isPinned ?? true,
        lastSeenAt: new Date(),
    });
}

export async function removeTelegramTarget(options: { userId: string; targetId: string }) {
    const connection = await ensureTelegramConnection(options.userId);
    const deleted = await prisma.telegramTarget.deleteMany({
        where: {
            id: options.targetId,
            connectionId: connection.id,
        },
    });
    return deleted.count > 0;
}

export async function fetchTelegramDashboard(userId: string): Promise<TelegramDashboard> {
    const configuredBotAvailable = Boolean(getDefaultTelegramBotToken());
    const connection = await prisma.telegramConnection.findUnique({
        where: { userId },
    });

    if (!connection) {
        return {
            connected: false,
            configuredBotAvailable,
            targets: [],
            recentActivity: [],
            recentMedia: [],
            analytics: {
                savedTargets: 0,
                inboundToday: 0,
                outboundToday: 0,
                pendingWebhookUpdates: 0,
                recentActivityCount: 0,
            },
            capabilities: ["sendMessage", "sendPhoto", "sendVideo", "getMe", "getWebhookInfo", "getUpdates"],
            warning: configuredBotAvailable
                ? "A server-level Telegram bot token is available. Connect it once to unlock this workspace."
                : "Paste a BotFather token or configure TELEGRAM_BOT_TOKEN on the server to start using Telegram.",
        };
    }

    const bot = await telegramApiRequest<TelegramBotProfile>(connection.botToken, "getMe");
    const webhook = await telegramApiRequest<TelegramWebhookInfo>(connection.botToken, "getWebhookInfo");
    let effectiveLastSyncAt = connection.lastSyncAt;
    let effectiveLastUpdateId = connection.lastUpdateId;

    await prisma.telegramConnection.update({
        where: { id: connection.id },
        data: {
            botId: String(bot.id),
            botUsername: bot.username || null,
            botFirstName: bot.first_name || "Telegram Bot",
            canJoinGroups: Boolean(bot.can_join_groups ?? true),
            canReadAllGroupMessages: Boolean(bot.can_read_all_group_messages ?? false),
            supportsInlineQueries: Boolean(bot.supports_inline_queries ?? false),
            webhookUrl: String(webhook.url || "").trim() || null,
            webhookPendingCount: Number(webhook.pending_update_count || 0),
        },
    });

    let warning: string | undefined;
    const canPoll = !String(webhook.url || "").trim();

    if (canPoll) {
        try {
            await syncTelegramUpdates({
                id: connection.id,
                userId: connection.userId,
                organizationId: connection.organizationId,
                botToken: connection.botToken,
                lastUpdateId: connection.lastUpdateId,
            });
            const refreshedConnection = await prisma.telegramConnection.findUnique({
                where: { id: connection.id },
                select: {
                    lastSyncAt: true,
                    lastUpdateId: true,
                },
            });
            effectiveLastSyncAt = refreshedConnection?.lastSyncAt || new Date();
            effectiveLastUpdateId = refreshedConnection?.lastUpdateId ?? connection.lastUpdateId;
        } catch (error) {
            const telegramError = error as TelegramError;
            warning = telegramError.message || "Telegram polling could not refresh right now.";
        }
    } else {
        warning = "Webhook mode is active on this bot, so live polling is paused. Recent activity below comes from stored history and any manual sends.";
    }

    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);

    const [targets, recentActivity, recentMedia, inboundToday, outboundToday] = await prisma.$transaction([
        prisma.telegramTarget.findMany({
            where: { connectionId: connection.id },
            orderBy: [{ isPinned: "desc" }, { lastSeenAt: "desc" }, { updatedAt: "desc" }],
            take: 12,
        }),
        prisma.telegramMessage.findMany({
            where: { connectionId: connection.id },
            orderBy: { createdAt: "desc" },
            take: 18,
        }),
        prisma.generatedMedia.findMany({
            where: connection.organizationId
                ? { organizationId: connection.organizationId }
                : { userId },
            orderBy: { createdAt: "desc" },
            take: 6,
            select: {
                id: true,
                type: true,
                prompt: true,
                assetUrl: true,
                createdAt: true,
            },
        }),
        prisma.telegramMessage.count({
            where: {
                connectionId: connection.id,
                direction: "INBOUND",
                createdAt: { gte: startOfDay },
            },
        }),
        prisma.telegramMessage.count({
            where: {
                connectionId: connection.id,
                direction: "OUTBOUND",
                createdAt: { gte: startOfDay },
            },
        }),
    ]);

    return {
        connected: true,
        configuredBotAvailable,
        connection: {
            id: connection.id,
            tokenPreview: maskToken(connection.botToken),
            lastSyncAt: effectiveLastSyncAt?.toISOString(),
            lastUpdateId: effectiveLastUpdateId || undefined,
        },
        bot: {
            id: String(bot.id),
            username: bot.username || undefined,
            firstName: bot.first_name || "Telegram Bot",
            canJoinGroups: Boolean(bot.can_join_groups ?? true),
            canReadAllGroupMessages: Boolean(bot.can_read_all_group_messages ?? false),
            supportsInlineQueries: Boolean(bot.supports_inline_queries ?? false),
        },
        webhook: {
            url: String(webhook.url || "").trim() || undefined,
            pendingUpdateCount: Number(webhook.pending_update_count || 0),
            lastErrorMessage: String(webhook.last_error_message || "").trim() || undefined,
            lastErrorAt: formatTelegramDate(webhook.last_error_date),
            canPoll,
        },
        targets: targets.map(summarizeTarget),
        recentActivity: recentActivity.map(summarizeActivity),
        recentMedia: recentMedia.map(summarizeMedia),
        analytics: {
            savedTargets: targets.length,
            inboundToday,
            outboundToday,
            pendingWebhookUpdates: Number(webhook.pending_update_count || 0),
            recentActivityCount: recentActivity.length,
        },
        capabilities: [
            "sendMessage",
            "sendPhoto",
            "sendVideo",
            "sendChatAction",
            "getMe",
            "getWebhookInfo",
            canPoll ? "getUpdates" : "webhook-mode",
        ],
        warning,
    };
}

export async function sendTelegramPayload(options: SendTelegramPayloadOptions) {
    const connection = await ensureTelegramConnection(options.userId);
    const recipients = normalizeTargetList(options.targets);
    if (!recipients.length) {
        throw new TelegramError("Add at least one Telegram chat ID or @username.", "telegram_target_required", 400);
    }

    if (options.type === "text" && !String(options.body || "").trim()) {
        throw new TelegramError("Message body is required.", "telegram_text_required", 400);
    }

    if ((options.type === "photo" || options.type === "video") && !String(options.mediaUrl || "").trim()) {
        throw new TelegramError("Media asset is required for photo/video sends.", "telegram_media_required", 400);
    }

    const outgoingMedia =
        options.type === "photo" || options.type === "video"
            ? await resolveOutgoingMedia(String(options.mediaUrl || "").trim())
            : null;

    const results: Array<{ target: string; status: "sent" | "failed"; messageId?: number; error?: string }> = [];

    for (const recipient of recipients) {
        const baseTarget = await upsertTargetRecord({
            connectionId: connection.id,
            userId: connection.userId,
            organizationId: connection.organizationId,
            chatId: recipient,
            title: inferTargetTitleFromReference(recipient),
            username: normalizeUsername(recipient.startsWith("@") ? recipient : ""),
            type: recipient.startsWith("@") ? "channel" : "direct",
            source: "manual",
            isPinned: options.pinTargets ?? false,
            lastSeenAt: new Date(),
        });

        try {
            if (options.type === "text") {
                await sendChatActionSafe(connection.botToken, recipient, "typing");
            } else if (options.type === "photo") {
                await sendChatActionSafe(connection.botToken, recipient, "upload_photo");
            } else {
                await sendChatActionSafe(connection.botToken, recipient, "upload_video");
            }

            let sent: TelegramSendResponse;
            if (options.type === "text") {
                sent = await telegramApiRequest<TelegramSendResponse>(connection.botToken, "sendMessage", {
                    chat_id: recipient,
                    text: String(options.body || "").trim(),
                    disable_web_page_preview: true,
                });
            } else if (options.type === "photo") {
                if (outgoingMedia?.kind === "file") {
                    sent = await telegramMultipartRequest<TelegramSendResponse>(
                        connection.botToken,
                        "sendPhoto",
                        {
                            chat_id: recipient,
                            ...(options.caption ? { caption: options.caption } : {}),
                        },
                        {
                            fieldName: "photo",
                            fileName: outgoingMedia.fileName,
                            contentType: outgoingMedia.contentType,
                            buffer: outgoingMedia.buffer,
                        }
                    );
                } else {
                    sent = await telegramApiRequest<TelegramSendResponse>(connection.botToken, "sendPhoto", {
                        chat_id: recipient,
                        photo: outgoingMedia?.value,
                        ...(options.caption ? { caption: options.caption } : {}),
                    });
                }
            } else {
                if (outgoingMedia?.kind === "file") {
                    sent = await telegramMultipartRequest<TelegramSendResponse>(
                        connection.botToken,
                        "sendVideo",
                        {
                            chat_id: recipient,
                            ...(options.caption ? { caption: options.caption } : {}),
                        },
                        {
                            fieldName: "video",
                            fileName: outgoingMedia.fileName,
                            contentType: outgoingMedia.contentType,
                            buffer: outgoingMedia.buffer,
                        }
                    );
                } else {
                    sent = await telegramApiRequest<TelegramSendResponse>(connection.botToken, "sendVideo", {
                        chat_id: recipient,
                        video: outgoingMedia?.value,
                        ...(options.caption ? { caption: options.caption } : {}),
                    });
                }
            }

            const sentChatId = String(sent.chat?.id || recipient);
            const savedTarget = await upsertTargetRecord({
                connectionId: connection.id,
                userId: connection.userId,
                organizationId: connection.organizationId,
                chatId: sentChatId,
                title: buildChatTitle(sent.chat) || baseTarget.title,
                username: normalizeUsername(sent.chat?.username || baseTarget.username),
                type: String(sent.chat?.type || baseTarget.type || "direct"),
                source: "manual",
                isPinned: options.pinTargets ?? baseTarget.isPinned,
                lastSeenAt: sent.date ? new Date(sent.date * 1000) : new Date(),
                metadata: {
                    sourceRecipient: recipient,
                },
            });

            await prisma.telegramMessage.create({
                data: {
                    connectionId: connection.id,
                    userId: connection.userId,
                    organizationId: connection.organizationId,
                    targetId: savedTarget.id,
                    direction: "OUTBOUND",
                    method: options.type === "text" ? "sendMessage" : options.type === "photo" ? "sendPhoto" : "sendVideo",
                    telegramMessageId: sent.message_id || null,
                    targetChatId: savedTarget.chatId,
                    targetLabel: savedTarget.title,
                    authorName: connection.botFirstName || "Telegram Bot",
                    authorUsername: connection.botUsername || null,
                    textBody: String(options.body || options.caption || "").trim() || null,
                    mediaUrl: outgoingMedia?.kind === "url" ? outgoingMedia.value : options.mediaUrl || null,
                    status: "sent",
                    payload: toPrismaJson(sent as unknown as Prisma.InputJsonValue),
                    createdAt: sent.date ? new Date(sent.date * 1000) : new Date(),
                },
            });

            results.push({
                target: recipient,
                status: "sent",
                messageId: sent.message_id,
            });
        } catch (error) {
            const telegramError = error as TelegramError;
            await prisma.telegramMessage.create({
                data: {
                    connectionId: connection.id,
                    userId: connection.userId,
                    organizationId: connection.organizationId,
                    targetId: baseTarget.id,
                    direction: "OUTBOUND",
                    method: options.type === "text" ? "sendMessage" : options.type === "photo" ? "sendPhoto" : "sendVideo",
                    targetChatId: baseTarget.chatId,
                    targetLabel: baseTarget.title,
                    authorName: connection.botFirstName || "Telegram Bot",
                    authorUsername: connection.botUsername || null,
                    textBody: String(options.body || options.caption || "").trim() || null,
                    mediaUrl: outgoingMedia?.kind === "url" ? outgoingMedia.value : options.mediaUrl || null,
                    status: "failed",
                    payload: toPrismaJson({
                        error: telegramError.message,
                        code: telegramError.code,
                        retryAfterSeconds: telegramError.retryAfterSeconds,
                    }),
                },
            });

            results.push({
                target: recipient,
                status: "failed",
                error: telegramError.message,
            });
        }
    }

    return {
        sentCount: results.filter((item) => item.status === "sent").length,
        failedCount: results.filter((item) => item.status === "failed").length,
        results,
    };
}
