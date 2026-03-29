import { mkdir, readFile, rm, writeFile } from "fs/promises";
import path from "path";
import { randomUUID } from "crypto";
import QRCode from "qrcode";
import { TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions";
import { Api } from "telegram/tl";
import { TelegramError } from "@/lib/telegram";

type TelegramUserCredentials = {
    apiId: number;
    apiHash: string;
};

export type TelegramUserDialogSummary = {
    id: string;
    peerRef: string;
    title: string;
    username?: string;
    type: "direct" | "group" | "channel";
    unreadCount: number;
    lastMessageAt?: string;
};

export type TelegramUserActivitySummary = {
    id: string;
    direction: "OUTBOUND";
    method: "sendMessage" | "sendPhoto" | "sendVideo";
    status: "sent" | "failed";
    targetPeer: string;
    targetLabel?: string;
    textBody?: string;
    mediaUrl?: string;
    error?: string;
    createdAt: string;
};

export type TelegramUserConnectionState = {
    configured: boolean;
    connected: boolean;
    status: "idle" | "awaiting_qr" | "awaiting_scan" | "awaiting_password" | "connected" | "error";
    telegramUserId?: string;
    displayName?: string;
    username?: string;
    phone?: string;
    qrCodeDataUrl?: string;
    qrLink?: string;
    qrExpiresAt?: string;
    passwordHint?: string;
    lastSyncAt?: string;
    warning?: string;
    recentDialogs: TelegramUserDialogSummary[];
    recentActivity: TelegramUserActivitySummary[];
};

type StoredTelegramUserConnection = {
    userId: string;
    organizationId?: string | null;
    sessionString: string;
    telegramUserId?: string;
    displayName?: string;
    username?: string;
    phone?: string;
    recentDialogs: TelegramUserDialogSummary[];
    recentActivity: TelegramUserActivitySummary[];
    lastSyncAt?: string;
    createdAt: string;
    updatedAt: string;
};

type PendingTelegramUserLogin = {
    userId: string;
    organizationId?: string | null;
    client: TelegramClient;
    status: TelegramUserConnectionState["status"];
    qrCodeDataUrl?: string;
    qrLink?: string;
    qrExpiresAt?: string;
    passwordHint?: string;
    error?: string;
    touchedAt: number;
    passwordResolver?: (password: string) => void;
    passwordRejecter?: (error: Error) => void;
};

type SendTelegramUserPayloadOptions = {
    userId: string;
    organizationId: string | null;
    type: "text" | "photo" | "video";
    targets: string[];
    body?: string;
    mediaUrl?: string;
    caption?: string;
};

const USER_CONNECTION_DIR = path.join(process.cwd(), ".nexora-cache", "telegram-user");
const USER_DIALOG_LIMIT = 24;
const USER_DASHBOARD_REFRESH_MS = 45_000;

const pendingUserLogins = new Map<string, PendingTelegramUserLogin>();
const userClientCache = new Map<string, { sessionString: string; client: TelegramClient; lastUsedAt: number }>();

function encodeTelegramQrToken(token: Buffer) {
    return token.toString("base64url");
}

function getTelegramUserCredentials(): TelegramUserCredentials | null {
    const apiId = Number(
        process.env.TELEGRAM_USER_API_ID ||
        process.env.TELEGRAM_API_ID ||
        0
    );
    const apiHash = String(
        process.env.TELEGRAM_USER_API_HASH ||
        process.env.TELEGRAM_API_HASH ||
        ""
    ).trim();

    if (!apiId || !apiHash) return null;
    return { apiId, apiHash };
}

function buildIdleUserConnectionState(warning?: string): TelegramUserConnectionState {
    return {
        configured: Boolean(getTelegramUserCredentials()),
        connected: false,
        status: "idle",
        warning,
        recentDialogs: [],
        recentActivity: [],
    };
}

async function ensureUserConnectionDir() {
    await mkdir(USER_CONNECTION_DIR, { recursive: true });
}

function getUserConnectionFilePath(userId: string) {
    return path.join(USER_CONNECTION_DIR, `${userId}.json`);
}

async function readStoredUserConnection(userId: string): Promise<StoredTelegramUserConnection | null> {
    try {
        const raw = await readFile(getUserConnectionFilePath(userId), "utf8");
        const parsed = JSON.parse(raw) as StoredTelegramUserConnection;
        if (!parsed?.sessionString) return null;
        return {
            ...parsed,
            recentDialogs: Array.isArray(parsed.recentDialogs) ? parsed.recentDialogs : [],
            recentActivity: Array.isArray(parsed.recentActivity) ? parsed.recentActivity : [],
        };
    } catch {
        return null;
    }
}

async function writeStoredUserConnection(record: StoredTelegramUserConnection) {
    await ensureUserConnectionDir();
    await writeFile(getUserConnectionFilePath(record.userId), JSON.stringify(record, null, 2), "utf8");
}

async function deleteStoredUserConnection(userId: string) {
    try {
        await rm(getUserConnectionFilePath(userId), { force: true });
    } catch {
        // ignore
    }
}

function buildDisplayName(user: Api.TypeUser | undefined) {
    if (!(user instanceof Api.User)) return undefined;
    return [user.firstName, user.lastName].filter(Boolean).join(" ").trim() || user.username || undefined;
}

async function summarizeDialogs(client: TelegramClient): Promise<TelegramUserDialogSummary[]> {
    const dialogs = await client.getDialogs({
        limit: USER_DIALOG_LIMIT,
        ignoreMigrated: true,
    });

    const summarized: TelegramUserDialogSummary[] = [];
    for (const dialog of dialogs) {
        if (!dialog?.entity || !dialog.inputEntity) continue;

        const username =
            dialog.entity instanceof Api.User || dialog.entity instanceof Api.Channel
                ? dialog.entity.username || undefined
                : undefined;
        const peerRef = String(await client.getPeerId(dialog.inputEntity));
        const type: TelegramUserDialogSummary["type"] = dialog.isChannel
            ? dialog.isGroup
                ? "group"
                : "channel"
            : dialog.isGroup
                ? "group"
                : "direct";
        const title = dialog.title || dialog.name || (username ? `@${username}` : peerRef);

        summarized.push({
            id: peerRef,
            peerRef,
            title,
            username: username ? `@${username}` : undefined,
            type,
            unreadCount: Number(dialog.unreadCount || 0),
            lastMessageAt: dialog.date ? new Date(dialog.date * 1000).toISOString() : undefined,
        });
    }

    return summarized;
}

function trimUserActivity(activity: TelegramUserActivitySummary[]) {
    return activity
        .slice(0, 36)
        .map((item) => ({
            ...item,
            textBody: item.textBody ? String(item.textBody).slice(0, 400) : undefined,
            error: item.error ? String(item.error).slice(0, 240) : undefined,
        }));
}

function toPublicUserConnectionState(
    record: StoredTelegramUserConnection,
    warning?: string
): TelegramUserConnectionState {
    return {
        configured: Boolean(getTelegramUserCredentials()),
        connected: true,
        status: "connected",
        telegramUserId: record.telegramUserId,
        displayName: record.displayName,
        username: record.username,
        phone: record.phone,
        lastSyncAt: record.lastSyncAt,
        warning,
        recentDialogs: record.recentDialogs || [],
        recentActivity: trimUserActivity(record.recentActivity || []),
    };
}

function pendingToPublicState(pending: PendingTelegramUserLogin): TelegramUserConnectionState {
    return {
        configured: Boolean(getTelegramUserCredentials()),
        connected: false,
        status: pending.status,
        qrCodeDataUrl: pending.qrCodeDataUrl,
        qrLink: pending.qrLink,
        qrExpiresAt: pending.qrExpiresAt,
        passwordHint: pending.passwordHint,
        warning: pending.error,
        recentDialogs: [],
        recentActivity: [],
    };
}

async function cleanupPendingLogin(userId: string) {
    const pending = pendingUserLogins.get(userId);
    if (!pending) return;

    if (pending.passwordRejecter) {
        pending.passwordRejecter(new Error("QR sign-in was interrupted."));
    }
    try {
        await pending.client.disconnect();
    } catch {
        // ignore
    }
    pendingUserLogins.delete(userId);
}

async function getCachedOrConnectedUserClient(record: StoredTelegramUserConnection) {
    const cached = userClientCache.get(record.userId);
    if (cached && cached.sessionString === record.sessionString) {
        cached.lastUsedAt = Date.now();
        if (await cached.client.isUserAuthorized()) {
            return cached.client;
        }
        userClientCache.delete(record.userId);
    }

    const credentials = getTelegramUserCredentials();
    if (!credentials) {
        throw new TelegramError(
            "Set TELEGRAM_USER_API_ID and TELEGRAM_USER_API_HASH to use Telegram user account login.",
            "telegram_user_api_missing",
            500
        );
    }

    const client = new TelegramClient(
        new StringSession(record.sessionString),
        credentials.apiId,
        credentials.apiHash,
        { connectionRetries: 5 }
    );
    await client.connect();

    if (!(await client.isUserAuthorized())) {
        throw new TelegramError(
            "Stored Telegram user session is no longer authorized. Reconnect with QR.",
            "telegram_user_session_invalid",
            401
        );
    }

    userClientCache.set(record.userId, {
        sessionString: record.sessionString,
        client,
        lastUsedAt: Date.now(),
    });
    return client;
}

async function refreshStoredUserConnection(record: StoredTelegramUserConnection): Promise<StoredTelegramUserConnection> {
    const client = await getCachedOrConnectedUserClient(record);
    const me = await client.getMe();
    const recentDialogs = await summarizeDialogs(client);
    const next: StoredTelegramUserConnection = {
        ...record,
        telegramUserId:
            me instanceof Api.User && me.id !== undefined
                ? String(me.id)
                : record.telegramUserId,
        displayName: buildDisplayName(me) || record.displayName,
        username:
            me instanceof Api.User && me.username
                ? `@${me.username}`
                : record.username,
        phone:
            me instanceof Api.User && me.phone
                ? `+${me.phone}`
                : record.phone,
        recentDialogs,
        lastSyncAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
    };
    await writeStoredUserConnection(next);
    return next;
}

async function waitForLoginState(userId: string, timeoutMs = 2500) {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
        const pending = pendingUserLogins.get(userId);
        if (!pending) break;
        if (
            pending.status === "awaiting_scan" ||
            pending.status === "awaiting_password" ||
            pending.status === "error"
        ) {
            return;
        }
        await new Promise((resolve) => setTimeout(resolve, 120));
    }
}

export async function getTelegramUserConnectionState(userId: string): Promise<TelegramUserConnectionState> {
    const credentials = getTelegramUserCredentials();
    if (!credentials) {
        return buildIdleUserConnectionState(
            "Set TELEGRAM_USER_API_ID and TELEGRAM_USER_API_HASH to unlock QR-based Telegram user login."
        );
    }

    const pending = pendingUserLogins.get(userId);
    if (pending) {
        return pendingToPublicState(pending);
    }

    const record = await readStoredUserConnection(userId);
    if (!record) {
        return buildIdleUserConnectionState();
    }

    const shouldRefresh =
        !record.lastSyncAt ||
        Date.now() - new Date(record.lastSyncAt).getTime() > USER_DASHBOARD_REFRESH_MS;

    if (!shouldRefresh) {
        return toPublicUserConnectionState(record);
    }

    try {
        const refreshed = await refreshStoredUserConnection(record);
        return toPublicUserConnectionState(refreshed);
    } catch (error) {
        const message = error instanceof Error ? error.message : "Could not refresh Telegram user account.";
        if (/no longer authorized|reconnect with qr/i.test(message)) {
            await deleteStoredUserConnection(userId);
            return buildIdleUserConnectionState(message);
        }
        return toPublicUserConnectionState(record, message);
    }
}

export async function startTelegramUserQrLogin(options: {
    userId: string;
    organizationId: string | null;
}): Promise<TelegramUserConnectionState> {
    const credentials = getTelegramUserCredentials();
    if (!credentials) {
        throw new TelegramError(
            "Set TELEGRAM_USER_API_ID and TELEGRAM_USER_API_HASH before starting QR login.",
            "telegram_user_api_missing",
            500
        );
    }

    const existingPending = pendingUserLogins.get(options.userId);
    if (existingPending) {
        return pendingToPublicState(existingPending);
    }

    await cleanupPendingLogin(options.userId);
    await deleteStoredUserConnection(options.userId);

    const client = new TelegramClient(
        new StringSession(""),
        credentials.apiId,
        credentials.apiHash,
        { connectionRetries: 5 }
    );
    await client.connect();

    const pending: PendingTelegramUserLogin = {
        userId: options.userId,
        organizationId: options.organizationId,
        client,
        status: "awaiting_qr",
        touchedAt: Date.now(),
    };
    pendingUserLogins.set(options.userId, pending);

    void (async () => {
        try {
            await client.signInUserWithQrCode(credentials, {
                qrCode: async ({ token, expires }) => {
                    const qrLink = `tg://login?token=${encodeTelegramQrToken(token)}`;
                    pending.status = "awaiting_scan";
                    pending.qrLink = qrLink;
                    pending.qrCodeDataUrl = await QRCode.toDataURL(qrLink, {
                        margin: 1,
                        width: 320,
                    });
                    pending.qrExpiresAt = new Date(expires * 1000).toISOString();
                    pending.touchedAt = Date.now();
                },
                password: async (hint?: string) => {
                    pending.status = "awaiting_password";
                    pending.passwordHint = hint || undefined;
                    pending.qrCodeDataUrl = undefined;
                    pending.qrLink = undefined;
                    pending.qrExpiresAt = undefined;
                    pending.touchedAt = Date.now();
                    return new Promise<string>((resolve, reject) => {
                        pending.passwordResolver = resolve;
                        pending.passwordRejecter = reject;
                    });
                },
                onError: async (error) => {
                    pending.status = "error";
                    pending.error = error.message;
                    pending.touchedAt = Date.now();
                    return false;
                },
            });

            const me = await client.getMe();
            const sessionString = (client.session as StringSession).save();
            const recentDialogs = await summarizeDialogs(client);
            const record: StoredTelegramUserConnection = {
                userId: options.userId,
                organizationId: options.organizationId,
                sessionString,
                telegramUserId:
                    me instanceof Api.User && me.id !== undefined
                        ? String(me.id)
                        : undefined,
                displayName: buildDisplayName(me),
                username:
                    me instanceof Api.User && me.username
                        ? `@${me.username}`
                        : undefined,
                phone:
                    me instanceof Api.User && me.phone
                        ? `+${me.phone}`
                        : undefined,
                recentDialogs,
                recentActivity: [],
                lastSyncAt: new Date().toISOString(),
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
            };
            await writeStoredUserConnection(record);
            userClientCache.set(options.userId, {
                sessionString,
                client,
                lastUsedAt: Date.now(),
            });
            pendingUserLogins.delete(options.userId);
        } catch (error) {
            pending.status = "error";
            pending.error =
                error instanceof Error
                    ? error.message
                    : "Telegram QR login failed.";
            pending.touchedAt = Date.now();
        }
    })();

    await waitForLoginState(options.userId);
    const livePending = pendingUserLogins.get(options.userId);
    return livePending ? pendingToPublicState(livePending) : getTelegramUserConnectionState(options.userId);
}

export async function submitTelegramUserPassword(options: {
    userId: string;
    password: string;
}): Promise<TelegramUserConnectionState> {
    const pending = pendingUserLogins.get(options.userId);
    if (!pending || pending.status !== "awaiting_password" || !pending.passwordResolver) {
        throw new TelegramError(
            "Telegram user login is not waiting for a 2FA password right now.",
            "telegram_user_password_not_needed",
            400
        );
    }

    pending.passwordResolver(options.password);
    pending.passwordResolver = undefined;
    pending.passwordRejecter = undefined;
    pending.status = "awaiting_scan";
    pending.passwordHint = undefined;
    pending.touchedAt = Date.now();

    await waitForLoginState(options.userId, 4000);
    return getTelegramUserConnectionState(options.userId);
}

export async function disconnectTelegramUserConnection(userId: string) {
    await cleanupPendingLogin(userId);
    const cached = userClientCache.get(userId);
    if (cached) {
        try {
            await cached.client.disconnect();
        } catch {
            // ignore
        }
        userClientCache.delete(userId);
    }
    await deleteStoredUserConnection(userId);
    return true;
}

async function resolveUserOutgoingMedia(mediaUrl: string) {
    const normalized = String(mediaUrl || "").trim();
    if (!normalized) {
        throw new TelegramError("Media URL is required.", "telegram_user_media_required", 400);
    }

    if (normalized.startsWith("/")) {
        const absolutePath = path.join(process.cwd(), "public", normalized.replace(/^\/+/, ""));
        const buffer = await readFile(absolutePath);
        return {
            kind: "buffer" as const,
            value: buffer,
            sourceUrl: normalized,
        };
    }

    const response = await fetch(normalized, { cache: "no-store" });
    if (!response.ok) {
        throw new TelegramError(
            "Could not fetch the selected media asset for Telegram user send.",
            "telegram_user_media_fetch_failed",
            400
        );
    }
    return {
        kind: "buffer" as const,
        value: Buffer.from(await response.arrayBuffer()),
        sourceUrl: normalized,
    };
}

function normalizeTargets(values: string[]) {
    return Array.from(
        new Set(
            values
                .map((value) => String(value || "").trim())
                .filter(Boolean)
        )
    ).slice(0, 20);
}

function findDialogLabel(record: StoredTelegramUserConnection, target: string) {
    return record.recentDialogs.find(
        (dialog) =>
            dialog.peerRef === target ||
            dialog.username === target ||
            dialog.username === `@${target.replace(/^@/, "")}`
    )?.title;
}

export async function sendTelegramUserPayload(options: SendTelegramUserPayloadOptions) {
    const record = await readStoredUserConnection(options.userId);
    if (!record) {
        throw new TelegramError(
            "Telegram user account is not connected. Scan the QR code first.",
            "telegram_user_not_connected",
            404
        );
    }

    const recipients = normalizeTargets(options.targets);
    if (!recipients.length) {
        throw new TelegramError(
            "Add at least one Telegram direct chat, group, or channel target.",
            "telegram_user_target_required",
            400
        );
    }

    if (options.type === "text" && !String(options.body || "").trim()) {
        throw new TelegramError("Message body is required.", "telegram_user_text_required", 400);
    }

    if ((options.type === "photo" || options.type === "video") && !String(options.mediaUrl || "").trim()) {
        throw new TelegramError("Media asset is required for photo/video sends.", "telegram_user_media_required", 400);
    }

    const client = await getCachedOrConnectedUserClient(record);
    const outgoingMedia =
        options.type === "photo" || options.type === "video"
            ? await resolveUserOutgoingMedia(String(options.mediaUrl || ""))
            : null;

    const results: Array<{ target: string; status: "sent" | "failed"; messageId?: number; error?: string }> = [];
    let nextRecord = record;

    for (const recipient of recipients) {
        try {
            const entity = await client.getInputEntity(recipient);
            let sent: any;

            if (options.type === "text") {
                sent = await client.sendMessage(entity, {
                    message: String(options.body || "").trim(),
                    linkPreview: false,
                });
            } else {
                sent = await client.sendFile(entity, {
                    file: outgoingMedia!.value as any,
                    caption: String(options.caption || "").trim() || undefined,
                    supportsStreaming: options.type === "video",
                    forceDocument: false,
                });
            }

            const activity: TelegramUserActivitySummary = {
                id: randomUUID(),
                direction: "OUTBOUND",
                method:
                    options.type === "text"
                        ? "sendMessage"
                        : options.type === "photo"
                            ? "sendPhoto"
                            : "sendVideo",
                status: "sent",
                targetPeer: recipient,
                targetLabel: findDialogLabel(nextRecord, recipient) || recipient,
                textBody: String(options.body || options.caption || "").trim() || undefined,
                mediaUrl: outgoingMedia?.sourceUrl,
                createdAt: new Date().toISOString(),
            };
            nextRecord = {
                ...nextRecord,
                recentActivity: trimUserActivity([activity, ...(nextRecord.recentActivity || [])]),
                updatedAt: new Date().toISOString(),
                lastSyncAt: new Date().toISOString(),
            };
            await writeStoredUserConnection(nextRecord);

            results.push({
                target: recipient,
                status: "sent",
                messageId: Number(sent?.id || sent?.messageId || 0) || undefined,
            });
        } catch (error) {
            const message = error instanceof Error ? error.message : "Telegram user send failed.";
            const activity: TelegramUserActivitySummary = {
                id: randomUUID(),
                direction: "OUTBOUND",
                method:
                    options.type === "text"
                        ? "sendMessage"
                        : options.type === "photo"
                            ? "sendPhoto"
                            : "sendVideo",
                status: "failed",
                targetPeer: recipient,
                targetLabel: findDialogLabel(nextRecord, recipient) || recipient,
                textBody: String(options.body || options.caption || "").trim() || undefined,
                mediaUrl: outgoingMedia?.sourceUrl,
                error: message,
                createdAt: new Date().toISOString(),
            };
            nextRecord = {
                ...nextRecord,
                recentActivity: trimUserActivity([activity, ...(nextRecord.recentActivity || [])]),
                updatedAt: new Date().toISOString(),
            };
            await writeStoredUserConnection(nextRecord);

            results.push({
                target: recipient,
                status: "failed",
                error: message,
            });
        }
    }

    return {
        sentCount: results.filter((item) => item.status === "sent").length,
        failedCount: results.filter((item) => item.status === "failed").length,
        results,
    };
}
