import { randomBytes } from "crypto";
import { prisma } from "@/lib/prisma";
import {
    getYouTubeQuotaSummary,
    getYouTubeQuotaBlockStatus,
    getNextYouTubeQuotaResetAt,
    markYouTubeQuotaExhausted,
    recordYouTubeQuotaUsage,
    type YouTubeQuotaSummary as RuntimeYouTubeQuotaSummary,
} from "@/lib/youtube-quota";

const GOOGLE_OAUTH_AUTHORIZE_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_OAUTH_TOKEN_URL = "https://oauth2.googleapis.com/token";
const YOUTUBE_API_BASE_URL = "https://www.googleapis.com/youtube/v3";
export const YOUTUBE_ACCOUNT_PROVIDER = "youtube";
export const YOUTUBE_OAUTH_STATE_COOKIE = "youtube_oauth_state";
export const YOUTUBE_OAUTH_RETURN_COOKIE = "youtube_oauth_return_to";
export const YOUTUBE_OAUTH_USER_COOKIE = "youtube_oauth_user";
export const YOUTUBE_OAUTH_MODE_COOKIE = "youtube_oauth_mode";
export const YOUTUBE_READONLY_SCOPE = "https://www.googleapis.com/auth/youtube.readonly";
export const YOUTUBE_MANAGE_SCOPE = "https://www.googleapis.com/auth/youtube.force-ssl";
export const YOUTUBE_CONNECT_SCOPES = [YOUTUBE_READONLY_SCOPE];
export const YOUTUBE_POLL_SCOPES = [YOUTUBE_READONLY_SCOPE, YOUTUBE_MANAGE_SCOPE];

type OAuthTokenResponse = {
    access_token?: string;
    expires_in?: number;
    refresh_token?: string;
    scope?: string;
    token_type?: string;
    id_token?: string;
    error?: string;
    error_description?: string;
};

type YouTubeApiErrorPayload = {
    error?: {
        code?: number;
        message?: string;
        errors?: Array<{
            reason?: string;
            message?: string;
        }>;
    };
};

type ChannelListResponse = {
    items?: Array<{
        id?: string;
        snippet?: {
            title?: string;
            description?: string;
            customUrl?: string;
            thumbnails?: Record<string, { url?: string }>;
        };
        statistics?: {
            subscriberCount?: string;
            videoCount?: string;
            viewCount?: string;
        };
        contentDetails?: {
            relatedPlaylists?: {
                uploads?: string;
            };
        };
    }>;
};

type PlaylistItemsResponse = {
    items?: Array<{
        snippet?: {
            title?: string;
            description?: string;
            publishedAt?: string;
            thumbnails?: Record<string, { url?: string }>;
            resourceId?: {
                videoId?: string;
            };
        };
        contentDetails?: {
            videoPublishedAt?: string;
            videoId?: string;
        };
    }>;
};

type VideosListResponse = {
    items?: Array<{
        id?: string;
        statistics?: {
            viewCount?: string;
            likeCount?: string;
            commentCount?: string;
        };
        liveStreamingDetails?: {
            concurrentViewers?: string;
        };
    }>;
};

type LiveBroadcastsResponse = {
    items?: Array<{
        id?: string;
        snippet?: {
            title?: string;
            description?: string;
            liveChatId?: string;
            scheduledStartTime?: string;
            actualStartTime?: string;
            actualEndTime?: string;
            thumbnails?: Record<string, { url?: string }>;
        };
        status?: {
            lifeCycleStatus?: string;
            privacyStatus?: string;
            recordingStatus?: string;
        };
        contentDetails?: {
            boundStreamId?: string;
        };
    }>;
};

type LiveBroadcastItem = NonNullable<LiveBroadcastsResponse["items"]>[number];

type LiveChatMessagesListResponse = {
    nextPageToken?: string;
    pollingIntervalMillis?: number;
    items?: Array<{
        id?: string;
        snippet?: {
            type?: string;
            publishedAt?: string;
            displayMessage?: string;
            textMessageDetails?: {
                messageText?: string;
            };
            superChatDetails?: {
                userComment?: string;
                amountDisplayString?: string;
            };
        };
        authorDetails?: {
            channelId?: string;
            channelUrl?: string;
            displayName?: string;
            profileImageUrl?: string;
            isChatOwner?: boolean;
            isChatModerator?: boolean;
            isChatSponsor?: boolean;
            isVerified?: boolean;
        };
    }>;
    activePollItem?: {
        id?: string;
        snippet?: {
            pollDetails?: {
                metadata?: {
                    questionText?: string;
                    status?: string;
                    options?: Array<{
                        optionText?: string;
                        tally?: string;
                    }>;
                };
            };
        };
    };
};

type CommentThreadsListResponse = {
    items?: Array<{
        id?: string;
        snippet?: {
            videoId?: string;
            totalReplyCount?: number;
            canReply?: boolean;
            topLevelComment?: {
                id?: string;
                snippet?: {
                    textDisplay?: string;
                    textOriginal?: string;
                    likeCount?: number;
                    publishedAt?: string;
                    authorDisplayName?: string;
                    authorProfileImageUrl?: string;
                    authorChannelId?: {
                        value?: string;
                    };
                };
            };
        };
        replies?: {
            comments?: Array<{
                id?: string;
                snippet?: {
                    textDisplay?: string;
                    textOriginal?: string;
                    likeCount?: number;
                    publishedAt?: string;
                    authorDisplayName?: string;
                    authorProfileImageUrl?: string;
                    authorChannelId?: {
                        value?: string;
                    };
                    parentId?: string;
                };
            }>;
        };
    }>;
};

type CommentThreadInsertResponse = {
    id?: string;
    snippet?: {
        videoId?: string;
        canReply?: boolean;
        topLevelComment?: {
            id?: string;
            snippet?: {
                textDisplay?: string;
                textOriginal?: string;
                likeCount?: number;
                publishedAt?: string;
                authorDisplayName?: string;
                authorProfileImageUrl?: string;
                authorChannelId?: {
                    value?: string;
                };
            };
        };
    };
};

type CommentInsertResponse = {
    id?: string;
    snippet?: {
        textDisplay?: string;
        textOriginal?: string;
        likeCount?: number;
        publishedAt?: string;
        authorDisplayName?: string;
        authorProfileImageUrl?: string;
        authorChannelId?: {
            value?: string;
        };
        parentId?: string;
    };
};

type CommentReplyItem = {
    id?: string;
    snippet?: {
        textDisplay?: string;
        textOriginal?: string;
        likeCount?: number;
        publishedAt?: string;
        authorDisplayName?: string;
        authorProfileImageUrl?: string;
        authorChannelId?: {
            value?: string;
        };
        parentId?: string;
    };
};

type LiveChatMessageResponse = {
    id?: string;
    snippet?: {
        liveChatId?: string;
        pollDetails?: {
            metadata?: {
                questionText?: string;
                status?: string;
                options?: Array<{
                    optionText?: string;
                    tally?: string;
                }>;
            };
        };
    };
};

export type YouTubePollSummary = {
    id: string;
    questionText: string;
    status: string;
    options: Array<{
        optionText: string;
        tally?: string;
    }>;
};

export type YouTubeChannelSummary = {
    id: string;
    title: string;
    description: string;
    customUrl?: string;
    thumbnailUrl?: string;
    subscriberCount?: string;
    videoCount?: string;
    viewCount?: string;
    uploadsPlaylistId?: string;
};

export type YouTubeVideoSummary = {
    id: string;
    title: string;
    description: string;
    publishedAt?: string;
    thumbnailUrl?: string;
    watchUrl: string;
    viewCount?: string;
    likeCount?: string;
    commentCount?: string;
};

export type YouTubeLiveBroadcastSummary = {
    id: string;
    title: string;
    description: string;
    status: "active" | "upcoming" | "completed";
    lifeCycleStatus?: string;
    privacyStatus?: string;
    liveChatId?: string;
    scheduledStartTime?: string;
    actualStartTime?: string;
    actualEndTime?: string;
    thumbnailUrl?: string;
    watchUrl: string;
    activePoll?: YouTubePollSummary | null;
    concurrentViewers?: string;
    viewCount?: string;
    likeCount?: string;
    commentCount?: string;
};

export type YouTubeAnalyticsSummary = {
    activeBroadcastCount: number;
    upcomingBroadcastCount: number;
    completedBroadcastCount: number;
    uploadsLoadedCount: number;
    activePollCount: number;
    liveViewersNow: number;
    recentUploadViews: number;
    recentUploadLikes: number;
    recentUploadComments: number;
};

export type YouTubeQuotaSummary = RuntimeYouTubeQuotaSummary;

export type YouTubeLiveChatMessageSummary = {
    id: string;
    type: string;
    publishedAt?: string;
    messageText: string;
    amountText?: string;
    authorName: string;
    authorChannelId?: string;
    authorChannelUrl?: string;
    authorProfileImageUrl?: string;
    isOwner: boolean;
    isModerator: boolean;
    isSponsor: boolean;
    isVerified: boolean;
};

export type YouTubeVideoCommentReplySummary = {
    id: string;
    parentId?: string;
    text: string;
    publishedAt?: string;
    likeCount?: number;
    authorName: string;
    authorChannelId?: string;
    authorProfileImageUrl?: string;
};

export type YouTubeVideoCommentSummary = {
    id: string;
    threadId: string;
    videoId: string;
    text: string;
    publishedAt?: string;
    likeCount?: number;
    replyCount: number;
    canReply: boolean;
    authorName: string;
    authorChannelId?: string;
    authorProfileImageUrl?: string;
    replies: YouTubeVideoCommentReplySummary[];
};

export type YouTubeCommentsFeed = {
    broadcast: YouTubeLiveBroadcastSummary;
    liveChat: {
        enabled: boolean;
        nextPageToken?: string;
        pollingIntervalMillis?: number;
        messages: YouTubeLiveChatMessageSummary[];
    };
    videoComments: YouTubeVideoCommentSummary[];
    syncedAt?: string;
    liveChatFetched?: boolean;
    videoCommentsFetched?: boolean;
};

export type YouTubeDashboard = {
    connected: boolean;
    needsReconnect?: boolean;
    canManageLiveChat?: boolean;
    channel?: YouTubeChannelSummary;
    uploads: YouTubeVideoSummary[];
    liveBroadcasts: {
        active: YouTubeLiveBroadcastSummary[];
        upcoming: YouTubeLiveBroadcastSummary[];
        completed: YouTubeLiveBroadcastSummary[];
    };
    analytics: YouTubeAnalyticsSummary;
    quota: YouTubeQuotaSummary;
    warning?: string;
};

function createEmptyYouTubeLiveBroadcastGroups() {
    return {
        active: [] as YouTubeLiveBroadcastSummary[],
        upcoming: [] as YouTubeLiveBroadcastSummary[],
        completed: [] as YouTubeLiveBroadcastSummary[],
    };
}

function createEmptyYouTubeAnalytics(): YouTubeAnalyticsSummary {
    return {
        activeBroadcastCount: 0,
        upcomingBroadcastCount: 0,
        completedBroadcastCount: 0,
        uploadsLoadedCount: 0,
        activePollCount: 0,
        liveViewersNow: 0,
        recentUploadViews: 0,
        recentUploadLikes: 0,
        recentUploadComments: 0,
    };
}

function formatQuotaResetLabel(value: string) {
    return new Date(value).toLocaleString("en-IN", {
        day: "2-digit",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
    });
}

export async function buildYouTubeQuotaFallbackDashboard(userId: string, warning?: string): Promise<YouTubeDashboard> {
    const quota = await getYouTubeQuotaSummary();
    const cachedDashboard = readCache(DASHBOARD_CACHE, userId) || DASHBOARD_CACHE.get(userId)?.value || null;
    const existingAccount = await getStoredYouTubeAccount(userId);
    const nextResetAt = quota.nextResetAt || getNextYouTubeQuotaResetAt();
    const resetLabel = formatQuotaResetLabel(nextResetAt);
    const normalizedWarning = String(warning || "").trim();

    return {
        connected: Boolean(existingAccount || cachedDashboard?.connected),
        needsReconnect: cachedDashboard?.needsReconnect,
        canManageLiveChat: cachedDashboard?.canManageLiveChat ?? false,
        channel: cachedDashboard?.channel,
        uploads: cachedDashboard?.uploads || [],
        liveBroadcasts: cachedDashboard?.liveBroadcasts || createEmptyYouTubeLiveBroadcastGroups(),
        analytics: cachedDashboard?.analytics || createEmptyYouTubeAnalytics(),
        quota,
        warning:
            normalizedWarning
                ? `${normalizedWarning} Project access should restore around ${resetLabel} (Pacific Time reset window).`
                : `YouTube project quota is exhausted right now. It should restore around ${resetLabel} (Pacific Time reset window).`,
    };
}

export class YouTubeError extends Error {
    code: string;
    status: number;

    constructor(message: string, code = "youtube_error", status = 500) {
        super(message);
        this.name = "YouTubeError";
        this.code = code;
        this.status = status;
    }
}

function requireGoogleClientConfig() {
    const clientId = process.env.YOUTUBE_GOOGLE_CLIENT_ID || process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.YOUTUBE_GOOGLE_CLIENT_SECRET || process.env.GOOGLE_CLIENT_SECRET;

    if (!clientId || !clientSecret) {
        throw new YouTubeError(
            "Google OAuth client is not configured. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET.",
            "youtube_oauth_not_configured",
            500
        );
    }

    return { clientId, clientSecret };
}

function normalizeScopes(scopes: string[] | undefined): string[] {
    const selected = Array.isArray(scopes) && scopes.length > 0 ? scopes : YOUTUBE_CONNECT_SCOPES;
    return Array.from(new Set(selected.map((scope) => String(scope || "").trim()).filter(Boolean)));
}

function parseGrantedScopes(scopeValue: string | null | undefined): Set<string> {
    return new Set(
        String(scopeValue || "")
            .split(/\s+/)
            .map((scope) => scope.trim())
            .filter(Boolean)
    );
}

function hasGrantedScopes(scopeValue: string | null | undefined, scopes: string[] | string): boolean {
    const granted = parseGrantedScopes(scopeValue);
    const required = Array.isArray(scopes) ? scopes : [scopes];
    return required.every((scope) => granted.has(scope));
}

export function buildYouTubeRedirectUri(origin: string): string {
    return `${origin.replace(/\/$/, "")}/api/youtube/callback`;
}

export function normalizeYouTubeReturnPath(input: string | null | undefined): string {
    const fallback = "/content-studio/youtube";
    const raw = String(input || "").trim();
    if (!raw.startsWith("/")) return fallback;
    if (raw.startsWith("//")) return fallback;
    return raw;
}

export function createYouTubeOAuthState(): string {
    return randomBytes(24).toString("hex");
}

export function buildYouTubeConsentUrl(options: {
    origin: string;
    state: string;
    loginHint?: string;
    scopes?: string[];
}) {
    const { clientId } = requireGoogleClientConfig();
    const scopes = normalizeScopes(options.scopes);
    const params = new URLSearchParams({
        client_id: clientId,
        redirect_uri: buildYouTubeRedirectUri(options.origin),
        response_type: "code",
        access_type: "offline",
        include_granted_scopes: "true",
        prompt: "consent select_account",
        scope: scopes.join(" "),
        state: options.state,
    });

    if (options.loginHint) {
        params.set("login_hint", options.loginHint);
    }

    return `${GOOGLE_OAUTH_AUTHORIZE_URL}?${params.toString()}`;
}

function pickThumbnailUrl(
    thumbnails: Record<string, { url?: string }> | undefined
): string | undefined {
    if (!thumbnails) return undefined;
    const preferred = ["maxres", "standard", "high", "medium", "default"];
    for (const key of preferred) {
        const url = thumbnails[key]?.url;
        if (url) return url;
    }
    const fallback = Object.values(thumbnails).find((item) => item?.url)?.url;
    return fallback || undefined;
}

function parseApiError(payload: unknown, fallbackMessage: string, fallbackStatus = 500) {
    const errorPayload = payload as YouTubeApiErrorPayload;
    const nestedError = errorPayload?.error;
    const reason = nestedError?.errors?.[0]?.reason || "youtube_api_error";
    const message =
        nestedError?.errors?.[0]?.message ||
        nestedError?.message ||
        fallbackMessage;
    const status = Number.isFinite(Number(nestedError?.code))
        ? Number(nestedError?.code)
        : fallbackStatus;
    return new YouTubeError(message, String(reason), status);
}

function formatCount(value: string | undefined): string | undefined {
    if (!value) return undefined;
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return value;
    return new Intl.NumberFormat("en-US").format(numeric);
}

function parseCountNumber(value: string | undefined): number {
    const numeric = Number(String(value || "").replace(/,/g, "").trim());
    return Number.isFinite(numeric) ? numeric : 0;
}

type CacheEntry<T> = {
    expiresAt: number;
    value: T;
};

const DASHBOARD_CACHE = new Map<string, CacheEntry<Omit<YouTubeDashboard, "quota">>>();
const ACTIVE_POLL_CACHE = new Map<string, CacheEntry<YouTubePollSummary | null>>();
const VIDEO_STATS_CACHE = new Map<string, CacheEntry<Map<string, YouTubeVideoStats>>>();
const BROADCAST_CACHE = new Map<string, CacheEntry<YouTubeLiveBroadcastSummary>>();
const COMMENT_THREADS_CACHE = new Map<string, CacheEntry<YouTubeVideoCommentSummary[]>>();

const DASHBOARD_CACHE_TTL_MS = 45_000;
const DASHBOARD_CACHE_TTL_IDLE_MS = 90_000;
const ACTIVE_POLL_CACHE_TTL_MS = 12_000;
const VIDEO_STATS_CACHE_TTL_MS = 45_000;
const BROADCAST_CACHE_TTL_MS = 20_000;
const COMMENT_THREADS_CACHE_TTL_MS = 12_000;

function readCache<T>(store: Map<string, CacheEntry<T>>, key: string): T | null {
    const entry = store.get(key);
    if (!entry) return null;
    if (entry.expiresAt <= Date.now()) {
        store.delete(key);
        return null;
    }
    return entry.value;
}

function writeCache<T>(store: Map<string, CacheEntry<T>>, key: string, value: T, ttlMs: number) {
    store.set(key, {
        value,
        expiresAt: Date.now() + ttlMs,
    });
}

function clearUserScopedCacheEntries(store: Map<string, CacheEntry<unknown>>, userId: string) {
    for (const key of Array.from(store.keys())) {
        if (key.startsWith(`${userId}:`)) {
            store.delete(key);
        }
    }
}

export function clearYouTubeRuntimeCache(userId?: string) {
    if (!userId) {
        DASHBOARD_CACHE.clear();
        ACTIVE_POLL_CACHE.clear();
        VIDEO_STATS_CACHE.clear();
        BROADCAST_CACHE.clear();
        COMMENT_THREADS_CACHE.clear();
        return;
    }

    DASHBOARD_CACHE.delete(userId);
    clearUserScopedCacheEntries(ACTIVE_POLL_CACHE as Map<string, CacheEntry<unknown>>, userId);
    clearUserScopedCacheEntries(VIDEO_STATS_CACHE as Map<string, CacheEntry<unknown>>, userId);
    clearUserScopedCacheEntries(BROADCAST_CACHE as Map<string, CacheEntry<unknown>>, userId);
    clearUserScopedCacheEntries(COMMENT_THREADS_CACHE as Map<string, CacheEntry<unknown>>, userId);
}

async function exchangeCodeForTokens(options: {
    code: string;
    origin: string;
}) {
    const { clientId, clientSecret } = requireGoogleClientConfig();
    const body = new URLSearchParams({
        code: options.code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: buildYouTubeRedirectUri(options.origin),
        grant_type: "authorization_code",
    });

    const response = await fetch(GOOGLE_OAUTH_TOKEN_URL, {
        method: "POST",
        headers: {
            "Content-Type": "application/x-www-form-urlencoded",
        },
        body,
        cache: "no-store",
    });

    const payload = (await response.json().catch(() => ({}))) as OAuthTokenResponse;
    if (!response.ok || !payload.access_token) {
        throw parseApiError(
            payload,
            payload.error_description || "Failed to exchange YouTube authorization code.",
            response.status
        );
    }

    return payload;
}

async function refreshAccessToken(refreshToken: string) {
    const { clientId, clientSecret } = requireGoogleClientConfig();
    const body = new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: refreshToken,
        grant_type: "refresh_token",
    });

    const response = await fetch(GOOGLE_OAUTH_TOKEN_URL, {
        method: "POST",
        headers: {
            "Content-Type": "application/x-www-form-urlencoded",
        },
        body,
        cache: "no-store",
    });

    const payload = (await response.json().catch(() => ({}))) as OAuthTokenResponse;
    if (!response.ok || !payload.access_token) {
        throw parseApiError(
            payload,
            payload.error_description || "Failed to refresh YouTube access token.",
            response.status
        );
    }

    return payload;
}

function computeExpiresAt(expiresIn: number | undefined) {
    if (!expiresIn || !Number.isFinite(expiresIn)) return null;
    return Math.floor(Date.now() / 1000) + Math.max(60, Math.floor(expiresIn) - 60);
}

async function getStoredYouTubeAccount(userId: string) {
    return prisma.account.findFirst({
        where: {
            userId,
            provider: YOUTUBE_ACCOUNT_PROVIDER,
        },
    });
}

async function getRefreshedConnection(userId: string) {
    const account = await getStoredYouTubeAccount(userId);
    if (!account) return null;

    if (account.access_token && account.expires_at && account.expires_at > Math.floor(Date.now() / 1000) + 30) {
        return account;
    }

    if (!account.refresh_token) {
        throw new YouTubeError(
            "YouTube connection needs to be re-authorized.",
            "youtube_reconnect_required",
            401
        );
    }

    const refreshed = await refreshAccessToken(account.refresh_token);
    return prisma.account.update({
        where: { id: account.id },
        data: {
            access_token: refreshed.access_token,
            expires_at: computeExpiresAt(refreshed.expires_in),
            scope: refreshed.scope || account.scope,
            token_type: refreshed.token_type || account.token_type,
            id_token: refreshed.id_token || account.id_token,
        },
    });
}

async function youtubeApiRequest<T>(
    userId: string,
    endpoint: string,
    init?: RequestInit,
    retry = true
): Promise<T> {
    const quotaBlock = await getYouTubeQuotaBlockStatus();
    if (quotaBlock.blocked) {
        throw new YouTubeError(
            `YouTube daily quota is exhausted for this project. It should restore around ${new Date(quotaBlock.nextResetAt).toLocaleString("en-IN", {
                day: "2-digit",
                month: "short",
                year: "numeric",
                hour: "2-digit",
                minute: "2-digit",
            })}.`,
            "quotaExceeded",
            403
        );
    }

    const account = await getRefreshedConnection(userId);
    if (!account?.access_token) {
        throw new YouTubeError("YouTube account is not connected.", "youtube_not_connected", 404);
    }

    const response = await fetch(endpoint, {
        ...init,
        cache: "no-store",
        headers: {
            Authorization: `Bearer ${account.access_token}`,
            Accept: "application/json",
            ...(init?.headers || {}),
        },
    });

    const payload = await response.json().catch(() => ({}));
    await recordYouTubeQuotaUsage({
        endpoint,
        method: init?.method || "GET",
    }).catch((error) => {
        console.error("Failed to record YouTube quota usage:", error);
    });
    if (response.ok) {
        return payload as T;
    }

    if (response.status === 401 && retry && account.refresh_token) {
        await refreshAccessToken(account.refresh_token)
            .then((tokenPayload) =>
                prisma.account.update({
                    where: { id: account.id },
                    data: {
                        access_token: tokenPayload.access_token,
                        expires_at: computeExpiresAt(tokenPayload.expires_in),
                        scope: tokenPayload.scope || account.scope,
                        token_type: tokenPayload.token_type || account.token_type,
                        id_token: tokenPayload.id_token || account.id_token,
                    },
                })
            )
            .catch(() => {
                throw new YouTubeError(
                    "YouTube connection expired. Please reconnect your channel.",
                    "youtube_reconnect_required",
                    401
                );
            });
        return youtubeApiRequest<T>(userId, endpoint, init, false);
    }

    const parsedError = parseApiError(payload, "YouTube API request failed.", response.status);
    if (parsedError.code === "quotaExceeded" || parsedError.code === "dailyLimitExceeded") {
        await markYouTubeQuotaExhausted(parsedError.message).catch((error) => {
            console.error("Failed to persist YouTube quota exhaustion state:", error);
        });
    }

    throw parsedError;
}

function buildYoutubeUrl(pathname: string, params?: Record<string, string | number | boolean | undefined>) {
    const url = new URL(`${YOUTUBE_API_BASE_URL}${pathname}`);
    Object.entries(params || {}).forEach(([key, value]) => {
        if (value === undefined || value === null || value === "") return;
        url.searchParams.set(key, String(value));
    });
    return url.toString();
}

function parsePoll(item: LiveChatMessageResponse | undefined | null): YouTubePollSummary | null {
    const metadata = item?.snippet?.pollDetails?.metadata;
    const id = String(item?.id || "").trim();
    const questionText = String(metadata?.questionText || "").trim();
    if (!id || !questionText) return null;

    return {
        id,
        questionText,
        status: String(metadata?.status || "active"),
        options: Array.isArray(metadata?.options)
            ? metadata.options
                .map((option) => ({
                    optionText: String(option?.optionText || "").trim(),
                    tally: option?.tally ? String(option.tally) : undefined,
                }))
                .filter((option) => option.optionText)
            : [],
    };
}

async function fetchActivePoll(userId: string, liveChatId: string) {
    const cacheKey = `${userId}:${liveChatId}`;
    const cached = readCache(ACTIVE_POLL_CACHE, cacheKey);
    if (cached !== null) {
        return cached;
    }

    const payload = await youtubeApiRequest<LiveChatMessagesListResponse>(
        userId,
        buildYoutubeUrl("/liveChat/messages", {
            part: "id,snippet",
            liveChatId,
            maxResults: 200,
        })
    );

    const poll = parsePoll(payload.activePollItem || null);
    writeCache(ACTIVE_POLL_CACHE, cacheKey, poll, ACTIVE_POLL_CACHE_TTL_MS);
    return poll;
}

async function fetchChannel(userId: string) {
    const payload = await youtubeApiRequest<ChannelListResponse>(
        userId,
        buildYoutubeUrl("/channels", {
            part: "snippet,contentDetails,statistics",
            mine: true,
        })
    );

    const channel = payload.items?.[0];
    if (!channel?.id) {
        throw new YouTubeError(
            "No YouTube channel was found for the authorized account.",
            "youtube_channel_not_found",
            404
        );
    }

    return {
        id: channel.id,
        title: String(channel.snippet?.title || "").trim() || "Connected YouTube Channel",
        description: String(channel.snippet?.description || "").trim(),
        customUrl: String(channel.snippet?.customUrl || "").trim() || undefined,
        thumbnailUrl: pickThumbnailUrl(channel.snippet?.thumbnails),
        subscriberCount: formatCount(channel.statistics?.subscriberCount),
        videoCount: formatCount(channel.statistics?.videoCount),
        viewCount: formatCount(channel.statistics?.viewCount),
        uploadsPlaylistId:
            String(channel.contentDetails?.relatedPlaylists?.uploads || "").trim() || undefined,
    } satisfies YouTubeChannelSummary;
}

async function fetchUploads(userId: string, uploadsPlaylistId: string | undefined) {
    if (!uploadsPlaylistId) return [];

    const payload = await youtubeApiRequest<PlaylistItemsResponse>(
        userId,
        buildYoutubeUrl("/playlistItems", {
            part: "snippet,contentDetails",
            playlistId: uploadsPlaylistId,
            maxResults: 12,
        })
    );

    const videos = (payload.items || [])
        .map((item) => {
            const videoId =
                String(item.contentDetails?.videoId || item.snippet?.resourceId?.videoId || "").trim();
            if (!videoId) return null;
            return {
                id: videoId,
                title: String(item.snippet?.title || "").trim() || "Untitled video",
                description: String(item.snippet?.description || "").trim(),
                publishedAt:
                    String(item.contentDetails?.videoPublishedAt || item.snippet?.publishedAt || "").trim() || undefined,
                thumbnailUrl: pickThumbnailUrl(item.snippet?.thumbnails),
                watchUrl: `https://www.youtube.com/watch?v=${videoId}`,
            } as YouTubeVideoSummary;
        })
        .filter(Boolean);

    const summaries = videos as YouTubeVideoSummary[];
    const statsById = await fetchVideoStatsMap(
        userId,
        summaries.map((video) => video.id)
    );

    return summaries.map((video) => {
        const stats = statsById.get(video.id);
        return {
            ...video,
            viewCount: formatCount(stats?.viewCount),
            likeCount: formatCount(stats?.likeCount),
            commentCount: formatCount(stats?.commentCount),
        };
    });
}

function classifyBroadcastStatus(
    item: LiveBroadcastItem
): "active" | "upcoming" | "completed" {
    const lifeCycleStatus = String(item?.status?.lifeCycleStatus || "").trim().toLowerCase();
    const actualStartTime = String(item?.snippet?.actualStartTime || "").trim();
    const actualEndTime = String(item?.snippet?.actualEndTime || "").trim();
    const scheduledStartTime = String(item?.snippet?.scheduledStartTime || "").trim();

    if (actualEndTime || lifeCycleStatus === "complete" || lifeCycleStatus === "revoked") {
        return "completed";
    }

    if (lifeCycleStatus === "live" || lifeCycleStatus === "livestarting" || actualStartTime) {
        return "active";
    }

    if (lifeCycleStatus === "created" || lifeCycleStatus === "ready" || lifeCycleStatus === "testing") {
        return "upcoming";
    }

    if (scheduledStartTime) {
        const scheduledAt = new Date(scheduledStartTime).getTime();
        if (Number.isFinite(scheduledAt) && scheduledAt > Date.now()) {
            return "upcoming";
        }
    }

    return "completed";
}

async function fetchOwnedBroadcasts(
    userId: string,
    maxResults: number
) {
    const payload = await youtubeApiRequest<LiveBroadcastsResponse>(
        userId,
        buildYoutubeUrl("/liveBroadcasts", {
            part: "id,snippet,status,contentDetails",
            mine: true,
            broadcastType: "all",
            maxResults,
        })
    );

    const broadcasts = (payload.items || [])
        .map((item) => ({
            id: String(item.id || "").trim(),
            title: String(item.snippet?.title || "").trim() || "Untitled broadcast",
            description: String(item.snippet?.description || "").trim(),
            status: classifyBroadcastStatus(item),
            lifeCycleStatus: String(item.status?.lifeCycleStatus || "").trim() || undefined,
            privacyStatus: String(item.status?.privacyStatus || "").trim() || undefined,
            liveChatId: String(item.snippet?.liveChatId || "").trim() || undefined,
            scheduledStartTime: String(item.snippet?.scheduledStartTime || "").trim() || undefined,
            actualStartTime: String(item.snippet?.actualStartTime || "").trim() || undefined,
            actualEndTime: String(item.snippet?.actualEndTime || "").trim() || undefined,
            thumbnailUrl: pickThumbnailUrl(item.snippet?.thumbnails),
            watchUrl: `https://www.youtube.com/watch?v=${String(item.id || "").trim()}`,
            activePoll: null,
        }))
        .filter((item) => item.id);

    const statsById = await fetchVideoStatsMap(
        userId,
        broadcasts.map((broadcast) => broadcast.id)
    );

    return Promise.all(
        broadcasts.map(async (broadcast) => {
            const stats = statsById.get(broadcast.id);
            const enrichedBroadcast = {
                ...broadcast,
                concurrentViewers: formatCount(stats?.concurrentViewers),
                viewCount: formatCount(stats?.viewCount),
                likeCount: formatCount(stats?.likeCount),
                commentCount: formatCount(stats?.commentCount),
            };
            if (!broadcast.liveChatId || broadcast.status !== "active") return enrichedBroadcast;
            try {
                const activePoll = await fetchActivePoll(userId, broadcast.liveChatId);
                return {
                    ...enrichedBroadcast,
                    activePoll,
                };
            } catch {
                return enrichedBroadcast;
            }
        })
    );
}

export async function fetchYouTubeDashboard(userId: string): Promise<YouTubeDashboard> {
    const quota = await getYouTubeQuotaSummary();
    const cachedDashboard = readCache(DASHBOARD_CACHE, userId);
    if (cachedDashboard) {
        return {
            ...cachedDashboard,
            quota,
        };
    }

    const existingAccount = await getStoredYouTubeAccount(userId);
    if (!existingAccount) {
        return {
            connected: false,
            canManageLiveChat: false,
            uploads: [],
            liveBroadcasts: createEmptyYouTubeLiveBroadcastGroups(),
            analytics: createEmptyYouTubeAnalytics(),
            quota,
        };
    }

    try {
        const canManageLiveChat = hasGrantedScopes(existingAccount.scope, YOUTUBE_MANAGE_SCOPE);
        const channel = await fetchChannel(userId);
        const uploads = await fetchUploads(userId, channel.uploadsPlaylistId);

        let active: YouTubeLiveBroadcastSummary[] = [];
        let upcoming: YouTubeLiveBroadcastSummary[] = [];
        let completed: YouTubeLiveBroadcastSummary[] = [];
        const warnings: string[] = [];

        try {
            const ownedBroadcasts = await fetchOwnedBroadcasts(userId, 25);
            active = ownedBroadcasts.filter((broadcast) => broadcast.status === "active");
            upcoming = ownedBroadcasts.filter((broadcast) => broadcast.status === "upcoming");
            completed = ownedBroadcasts.filter((broadcast) => broadcast.status === "completed");
        } catch (error) {
            const youtubeError = error as YouTubeError;
            if (
                youtubeError?.code === "liveStreamingNotEnabled" ||
                youtubeError?.code === "insufficientLivePermissions"
            ) {
                warnings.push(youtubeError.message);
            } else {
                throw error;
            }
        }

        if (!canManageLiveChat) {
            warnings.push(
                "Channel connection is active, but live poll controls need an extra YouTube permission approval. Use Enable Poll Controls when you are ready."
            );
        }

        const nextDashboard = {
            connected: true,
            canManageLiveChat,
            channel,
            uploads,
            liveBroadcasts: {
                active,
                upcoming,
                completed,
            },
            analytics: {
                activeBroadcastCount: active.length,
                upcomingBroadcastCount: upcoming.length,
                completedBroadcastCount: completed.length,
                uploadsLoadedCount: uploads.length,
                activePollCount: active.filter((broadcast) => Boolean(broadcast.activePoll?.id)).length,
                liveViewersNow: active.reduce((sum, broadcast) => sum + parseCountNumber(broadcast.concurrentViewers), 0),
                recentUploadViews: uploads.reduce((sum, video) => sum + parseCountNumber(video.viewCount), 0),
                recentUploadLikes: uploads.reduce((sum, video) => sum + parseCountNumber(video.likeCount), 0),
                recentUploadComments: uploads.reduce((sum, video) => sum + parseCountNumber(video.commentCount), 0),
            },
            warning: warnings.length > 0 ? warnings.join(" ") : undefined,
        } satisfies Omit<YouTubeDashboard, "quota">;

        writeCache(
            DASHBOARD_CACHE,
            userId,
            nextDashboard,
            active.length > 0 ? DASHBOARD_CACHE_TTL_MS : DASHBOARD_CACHE_TTL_IDLE_MS
        );

        return {
            ...nextDashboard,
            quota,
        };
    } catch (error) {
        const youtubeError = error as YouTubeError;
        if (
            youtubeError?.code === "youtube_reconnect_required" ||
            youtubeError?.status === 401
        ) {
            const reconnectDashboard = {
                connected: true,
                needsReconnect: true,
                canManageLiveChat: false,
                uploads: [],
                liveBroadcasts: createEmptyYouTubeLiveBroadcastGroups(),
                analytics: createEmptyYouTubeAnalytics(),
                warning: youtubeError.message,
            } satisfies Omit<YouTubeDashboard, "quota">;

            writeCache(DASHBOARD_CACHE, userId, reconnectDashboard, DASHBOARD_CACHE_TTL_IDLE_MS);

            return {
                ...reconnectDashboard,
                quota,
            };
        }
        if (youtubeError?.code === "quotaExceeded" || youtubeError?.code === "dailyLimitExceeded") {
            return buildYouTubeQuotaFallbackDashboard(userId, youtubeError.message);
        }
        throw error;
    }
}

type YouTubeVideoStats = {
    viewCount?: string;
    likeCount?: string;
    commentCount?: string;
    concurrentViewers?: string;
};

async function fetchVideoStatsMap(userId: string, videoIds: string[]) {
    const ids = Array.from(new Set(videoIds.map((id) => String(id || "").trim()).filter(Boolean))).slice(0, 50);
    const statsById = new Map<string, YouTubeVideoStats>();
    if (!ids.length) return statsById;

    const cacheKey = `${userId}:${ids.join(",")}`;
    const cached = readCache(VIDEO_STATS_CACHE, cacheKey);
    if (cached) {
        return cached;
    }

    const payload = await youtubeApiRequest<VideosListResponse>(
        userId,
        buildYoutubeUrl("/videos", {
            part: "statistics,liveStreamingDetails",
            id: ids.join(","),
            maxResults: ids.length,
        })
    );

    for (const item of payload.items || []) {
        const id = String(item.id || "").trim();
        if (!id) continue;
        statsById.set(id, {
            viewCount: item.statistics?.viewCount,
            likeCount: item.statistics?.likeCount,
            commentCount: item.statistics?.commentCount,
            concurrentViewers: item.liveStreamingDetails?.concurrentViewers,
        });
    }

    writeCache(VIDEO_STATS_CACHE, cacheKey, statsById, VIDEO_STATS_CACHE_TTL_MS);
    return statsById;
}

async function fetchBroadcastById(userId: string, broadcastId: string) {
    const cacheKey = `${userId}:${broadcastId}`;
    const cached = readCache(BROADCAST_CACHE, cacheKey);
    if (cached) {
        return cached;
    }

    const payload = await youtubeApiRequest<LiveBroadcastsResponse>(
        userId,
        buildYoutubeUrl("/liveBroadcasts", {
            part: "id,snippet,status,contentDetails",
            id: broadcastId,
        })
    );

    const item = (payload.items || [])[0];
    if (!item?.id) {
        throw new YouTubeError("Selected live stream was not found.", "youtube_broadcast_not_found", 404);
    }

    const statsById = await fetchVideoStatsMap(userId, [String(item.id)]);
    const stats = statsById.get(String(item.id).trim());

    const broadcast: YouTubeLiveBroadcastSummary = {
        id: String(item.id || "").trim(),
        title: String(item.snippet?.title || "").trim() || "Untitled broadcast",
        description: String(item.snippet?.description || "").trim(),
        status: classifyBroadcastStatus(item),
        lifeCycleStatus: String(item.status?.lifeCycleStatus || "").trim() || undefined,
        privacyStatus: String(item.status?.privacyStatus || "").trim() || undefined,
        liveChatId: String(item.snippet?.liveChatId || "").trim() || undefined,
        scheduledStartTime: String(item.snippet?.scheduledStartTime || "").trim() || undefined,
        actualStartTime: String(item.snippet?.actualStartTime || "").trim() || undefined,
        actualEndTime: String(item.snippet?.actualEndTime || "").trim() || undefined,
        thumbnailUrl: pickThumbnailUrl(item.snippet?.thumbnails),
        watchUrl: `https://www.youtube.com/watch?v=${String(item.id || "").trim()}`,
        activePoll: null,
        concurrentViewers: formatCount(stats?.concurrentViewers),
        viewCount: formatCount(stats?.viewCount),
        likeCount: formatCount(stats?.likeCount),
        commentCount: formatCount(stats?.commentCount),
    };

    if (broadcast.liveChatId && broadcast.status === "active") {
        try {
            broadcast.activePoll = await fetchActivePoll(userId, broadcast.liveChatId);
        } catch {
            broadcast.activePoll = null;
        }
    }

    writeCache(BROADCAST_CACHE, cacheKey, broadcast, BROADCAST_CACHE_TTL_MS);
    return broadcast;
}

function parseLiveChatMessageItem(
    item: NonNullable<LiveChatMessagesListResponse["items"]>[number]
): YouTubeLiveChatMessageSummary | null {
    const id = String(item?.id || "").trim();
    if (!id) return null;

    const snippet = item?.snippet;
    const author = item?.authorDetails;
    const text = String(
        snippet?.displayMessage ||
            snippet?.textMessageDetails?.messageText ||
            snippet?.superChatDetails?.userComment ||
            ""
    ).trim();

    return {
        id,
        type: String(snippet?.type || "textMessageEvent").trim() || "textMessageEvent",
        publishedAt: String(snippet?.publishedAt || "").trim() || undefined,
        messageText: text || "Unsupported message type",
        amountText: String(snippet?.superChatDetails?.amountDisplayString || "").trim() || undefined,
        authorName: String(author?.displayName || "YouTube Viewer").trim(),
        authorChannelId: String(author?.channelId || "").trim() || undefined,
        authorChannelUrl: String(author?.channelUrl || "").trim() || undefined,
        authorProfileImageUrl: String(author?.profileImageUrl || "").trim() || undefined,
        isOwner: Boolean(author?.isChatOwner),
        isModerator: Boolean(author?.isChatModerator),
        isSponsor: Boolean(author?.isChatSponsor),
        isVerified: Boolean(author?.isVerified),
    };
}

async function fetchLiveChatMessages(options: {
    userId: string;
    liveChatId: string;
    pageToken?: string;
}) {
    const payload = await youtubeApiRequest<LiveChatMessagesListResponse>(
        options.userId,
        buildYoutubeUrl("/liveChat/messages", {
            part: "id,snippet,authorDetails",
            liveChatId: options.liveChatId,
            maxResults: 50,
            pageToken: options.pageToken,
        })
    );

    return {
        nextPageToken: String(payload.nextPageToken || "").trim() || undefined,
        pollingIntervalMillis: Number(payload.pollingIntervalMillis) || 10000,
        messages: (payload.items || [])
            .map((item) => parseLiveChatMessageItem(item))
            .filter(Boolean) as YouTubeLiveChatMessageSummary[],
    };
}

function parseVideoCommentReply(item: CommentReplyItem): YouTubeVideoCommentReplySummary | null {
    const id = String(item?.id || "").trim();
    if (!id) return null;
    return {
        id,
        parentId: String(item?.snippet?.parentId || "").trim() || undefined,
        text: String(item?.snippet?.textDisplay || item?.snippet?.textOriginal || "").trim(),
        publishedAt: String(item?.snippet?.publishedAt || "").trim() || undefined,
        likeCount: typeof item?.snippet?.likeCount === "number" ? item.snippet.likeCount : undefined,
        authorName: String(item?.snippet?.authorDisplayName || "YouTube Viewer").trim(),
        authorChannelId: String(item?.snippet?.authorChannelId?.value || "").trim() || undefined,
        authorProfileImageUrl: String(item?.snippet?.authorProfileImageUrl || "").trim() || undefined,
    };
}

function parseVideoCommentThread(
    item: NonNullable<CommentThreadsListResponse["items"]>[number]
): YouTubeVideoCommentSummary | null {
    const threadId = String(item?.id || "").trim();
    const topLevel = item?.snippet?.topLevelComment;
    const topLevelId = String(topLevel?.id || "").trim();
    if (!topLevelId || !threadId) return null;

    return {
        id: topLevelId,
        threadId,
        videoId: String(item?.snippet?.videoId || "").trim(),
        text: String(topLevel?.snippet?.textDisplay || topLevel?.snippet?.textOriginal || "").trim(),
        publishedAt: String(topLevel?.snippet?.publishedAt || "").trim() || undefined,
        likeCount: typeof topLevel?.snippet?.likeCount === "number" ? topLevel.snippet.likeCount : undefined,
        replyCount: Number(item?.snippet?.totalReplyCount) || 0,
        canReply: item?.snippet?.canReply !== false,
        authorName: String(topLevel?.snippet?.authorDisplayName || "YouTube Viewer").trim(),
        authorChannelId: String(topLevel?.snippet?.authorChannelId?.value || "").trim() || undefined,
        authorProfileImageUrl: String(topLevel?.snippet?.authorProfileImageUrl || "").trim() || undefined,
        replies: Array.isArray(item?.replies?.comments)
            ? item.replies.comments.map((reply) => parseVideoCommentReply(reply)).filter(Boolean) as YouTubeVideoCommentReplySummary[]
            : [],
    };
}

async function fetchVideoCommentThreads(userId: string, videoId: string) {
    const cacheKey = `${userId}:${videoId}`;
    const cached = readCache(COMMENT_THREADS_CACHE, cacheKey);
    if (cached) {
        return cached;
    }

    const payload = await youtubeApiRequest<CommentThreadsListResponse>(
        userId,
        buildYoutubeUrl("/commentThreads", {
            part: "snippet,replies",
            videoId,
            maxResults: 20,
            order: "time",
            textFormat: "plainText",
        })
    );

    const comments = (payload.items || [])
        .map((item) => parseVideoCommentThread(item))
        .filter(Boolean) as YouTubeVideoCommentSummary[];
    writeCache(COMMENT_THREADS_CACHE, cacheKey, comments, COMMENT_THREADS_CACHE_TTL_MS);
    return comments;
}

export async function fetchYouTubeCommentsFeed(options: {
    userId: string;
    broadcastId: string;
    liveChatPageToken?: string;
    includeLiveChat?: boolean;
    includeVideoComments?: boolean;
}): Promise<YouTubeCommentsFeed> {
    const broadcast = await fetchBroadcastById(options.userId, options.broadcastId);
    const includeLiveChat = options.includeLiveChat !== false;
    const includeVideoComments = options.includeVideoComments !== false;

    const [liveChat, videoComments] = await Promise.all([
        includeLiveChat && broadcast.liveChatId && broadcast.status === "active"
            ? fetchLiveChatMessages({
                userId: options.userId,
                liveChatId: broadcast.liveChatId,
                pageToken: options.liveChatPageToken,
            })
            : Promise.resolve({
                nextPageToken: undefined,
                pollingIntervalMillis: undefined,
                messages: [],
            }),
        includeVideoComments
            ? fetchVideoCommentThreads(options.userId, broadcast.id).catch(() => [])
            : Promise.resolve([]),
    ]);

    return {
        broadcast,
        liveChat: {
            enabled: Boolean(broadcast.liveChatId && broadcast.status === "active"),
            nextPageToken: liveChat.nextPageToken,
            pollingIntervalMillis: liveChat.pollingIntervalMillis,
            messages: liveChat.messages,
        },
        videoComments,
        syncedAt: new Date().toISOString(),
        liveChatFetched: includeLiveChat,
        videoCommentsFetched: includeVideoComments,
    };
}

export async function sendYouTubeLiveChatMessage(options: {
    userId: string;
    liveChatId: string;
    broadcastId?: string;
    authorName?: string;
    messageText: string;
}) {
    const stripAstralSymbols = (value: string) =>
        String(value || "").replace(/[\uD800-\uDBFF][\uDC00-\uDFFF]/g, "").replace(/[\uD800-\uDFFF]/g, "");
    const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

    const account = await getRefreshedConnection(options.userId);
    if (!account) {
        throw new YouTubeError("YouTube account is not connected.", "youtube_not_connected", 404);
    }
    if (!hasGrantedScopes(account.scope, YOUTUBE_MANAGE_SCOPE)) {
        throw new YouTubeError(
            "Comment reply controls need the extra YouTube manage permission approval.",
            "youtube_scope_upgrade_required",
            403
        );
    }

    const sanitizedMessageText = String(options.messageText || "")
        .replace(/\r\n?/g, "\n")
        .replace(/\n+/g, " ")
        .replace(/\s+/g, " ")
        .replace(/[\u0000-\u001F\u007F]/g, "")
        .trim()
        .slice(0, 200);
    const safeMessageText = stripAstralSymbols(sanitizedMessageText).trim();
    if (!safeMessageText) {
        throw new YouTubeError("Reply text is empty after sanitization.", "youtube_reply_empty", 400);
    }

    const resolvedBroadcast =
        options.broadcastId ? await fetchBroadcastById(options.userId, options.broadcastId).catch(() => null) : null;
    const resolvedLiveChatId = resolvedBroadcast?.liveChatId || options.liveChatId;
    if (!resolvedLiveChatId) {
        throw new YouTubeError("Active live chat was not found for this broadcast.", "youtube_live_chat_not_found", 404);
    }

    const normalizedAuthorName = stripAstralSymbols(String(options.authorName || ""))
        .replace(/^@+/, "")
        .trim();
    const baseReplyText = safeMessageText
        .replace(new RegExp(`^(?:@+${escapeRegExp(normalizedAuthorName)}\\s+)+`, "i"), "")
        .trim();
    const candidateMessages = [
        normalizedAuthorName ? `@${normalizedAuthorName} ${baseReplyText || safeMessageText}`.trim() : "",
        normalizedAuthorName ? `${normalizedAuthorName}: ${baseReplyText || safeMessageText}`.trim() : "",
        safeMessageText,
    ]
        .map((value) =>
            stripAstralSymbols(value)
                .replace(/\s+/g, " ")
                .trim()
                .slice(0, 200)
                .trim()
        )
        .filter((value, index, array) => Boolean(value) && array.indexOf(value) === index);

    const send = (liveChatId: string, messageText: string) =>
        youtubeApiRequest<LiveChatMessageResponse>(
            options.userId,
            buildYoutubeUrl("/liveChat/messages", {
                part: "snippet",
            }),
            {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({
                    snippet: {
                        liveChatId,
                        type: "textMessageEvent",
                        textMessageDetails: {
                            messageText,
                        },
                    },
                }),
            }
        );

    const trySendCandidates = async (liveChatId: string) => {
        let lastError: unknown = null;
        for (const candidate of candidateMessages) {
            try {
                return await send(liveChatId, candidate);
            } catch (error) {
                const youtubeError = error as YouTubeError;
                lastError = error;
                if (youtubeError?.status !== 400) {
                    throw error;
                }
            }
        }
        throw lastError;
    };

    let message: LiveChatMessageResponse;
    try {
        message = await trySendCandidates(resolvedLiveChatId);
    } catch (error) {
        const youtubeError = error as YouTubeError;
        const refreshedBroadcast =
            youtubeError?.status === 400 && options.broadcastId
                ? await fetchBroadcastById(options.userId, options.broadcastId).catch(() => null)
                : null;
        const refreshedLiveChatId = refreshedBroadcast?.liveChatId;

        if (
            youtubeError?.status === 400 &&
            refreshedLiveChatId &&
            refreshedLiveChatId !== resolvedLiveChatId
        ) {
            message = await trySendCandidates(refreshedLiveChatId);
        } else {
            throw error;
        }
    }
    clearYouTubeRuntimeCache(options.userId);
    return message;
}

export async function sendYouTubeVideoCommentReply(options: {
    userId: string;
    parentCommentId: string;
    parentThreadId?: string;
    messageText: string;
}) {
    const account = await getRefreshedConnection(options.userId);
    if (!account) {
        throw new YouTubeError("YouTube account is not connected.", "youtube_not_connected", 404);
    }
    if (!hasGrantedScopes(account.scope, YOUTUBE_MANAGE_SCOPE)) {
        throw new YouTubeError(
            "Comment reply controls need the extra YouTube manage permission approval.",
            "youtube_scope_upgrade_required",
            403
        );
    }

    const tryInsert = (parentId: string) =>
        youtubeApiRequest<CommentInsertResponse>(
            options.userId,
            buildYoutubeUrl("/comments", {
                part: "snippet",
            }),
            {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({
                    snippet: {
                        parentId,
                        textOriginal: options.messageText,
                    },
                }),
            }
        );

    try {
        const reply = await tryInsert(options.parentCommentId);
        clearYouTubeRuntimeCache(options.userId);
        return reply;
    } catch (error) {
        const youtubeError = error as YouTubeError;
        const canRetryWithThreadId =
            options.parentThreadId &&
            options.parentThreadId !== options.parentCommentId &&
            (youtubeError?.status === 400 ||
                youtubeError?.status === 404 ||
                youtubeError?.code === "commentNotFound" ||
                youtubeError?.code === "parentCommentNotFound" ||
                youtubeError?.code === "processingFailure" ||
                youtubeError?.code === "invalidValue");

        if (!canRetryWithThreadId) {
            throw error;
        }

        const reply = await tryInsert(options.parentThreadId as string);
        clearYouTubeRuntimeCache(options.userId);
        return reply;
    }
}

export async function sendYouTubeVideoCommentThread(options: {
    userId: string;
    videoId: string;
    messageText: string;
}) {
    const account = await getRefreshedConnection(options.userId);
    if (!account) {
        throw new YouTubeError("YouTube account is not connected.", "youtube_not_connected", 404);
    }
    if (!hasGrantedScopes(account.scope, YOUTUBE_MANAGE_SCOPE)) {
        throw new YouTubeError(
            "Comment reply controls need the extra YouTube manage permission approval.",
            "youtube_scope_upgrade_required",
            403
        );
    }
    const channelId = String(account.providerAccountId || "").trim();
    if (!channelId) {
        throw new YouTubeError(
            "Connected YouTube channel ID is missing. Please reconnect the channel once.",
            "youtube_channel_not_found",
            404
        );
    }

    const thread = await youtubeApiRequest<CommentThreadInsertResponse>(
        options.userId,
        buildYoutubeUrl("/commentThreads", {
            part: "snippet",
        }),
        {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                snippet: {
                    channelId,
                    videoId: options.videoId,
                    topLevelComment: {
                        snippet: {
                            textOriginal: options.messageText,
                        },
                    },
                },
            }),
        }
    );
    clearYouTubeRuntimeCache(options.userId);
    return thread;
}

export async function storeYouTubeConnection(options: {
    userId: string;
    origin: string;
    code: string;
    scopes?: string[];
}) {
    const requestedScopes = normalizeScopes(options.scopes);
    const tokenPayload = await exchangeCodeForTokens({
        code: options.code,
        origin: options.origin,
    });

    const accessToken = tokenPayload.access_token || "";
    const response = await fetch(
        buildYoutubeUrl("/channels", {
            part: "snippet,contentDetails,statistics",
            mine: true,
        }),
        {
            headers: {
                Authorization: `Bearer ${accessToken}`,
                Accept: "application/json",
            },
            cache: "no-store",
        }
    );
    const channelPayload = (await response.json().catch(() => ({}))) as
        | ChannelListResponse
        | YouTubeApiErrorPayload;
    await recordYouTubeQuotaUsage({
        endpoint: buildYoutubeUrl("/channels", {
            part: "snippet,contentDetails,statistics",
            mine: true,
        }),
        method: "GET",
    }).catch((error) => {
        console.error("Failed to record YouTube quota usage:", error);
    });
    if (!response.ok) {
        throw parseApiError(channelPayload, "Failed to load YouTube channel details.", response.status);
    }

    const channel = (channelPayload as ChannelListResponse).items?.[0];
    const channelId = String(channel?.id || "").trim();
    if (!channelId) {
        throw new YouTubeError(
            "No YouTube channel was found for the authorized Google account.",
            "youtube_channel_not_found",
            404
        );
    }
    const ensuredChannel = channel;

    const existingByChannel = await prisma.account.findUnique({
        where: {
            provider_providerAccountId: {
                provider: YOUTUBE_ACCOUNT_PROVIDER,
                providerAccountId: channelId,
            },
        },
    });

    if (existingByChannel && existingByChannel.userId !== options.userId) {
        throw new YouTubeError(
            "This YouTube channel is already connected to another workspace user.",
            "youtube_channel_already_connected",
            409
        );
    }

    const existingForUser = await getStoredYouTubeAccount(options.userId);
    const accountData = {
        type: "oauth",
        provider: YOUTUBE_ACCOUNT_PROVIDER,
        providerAccountId: channelId,
        access_token: tokenPayload.access_token || existingForUser?.access_token || null,
        refresh_token: tokenPayload.refresh_token || existingForUser?.refresh_token || null,
        expires_at: computeExpiresAt(tokenPayload.expires_in),
        token_type: tokenPayload.token_type || existingForUser?.token_type || "Bearer",
        scope: tokenPayload.scope || requestedScopes.join(" "),
        id_token: tokenPayload.id_token || existingForUser?.id_token || null,
    };

    let stored;
    if (existingForUser) {
        stored = await prisma.account.update({
            where: { id: existingForUser.id },
            data: accountData,
        });
    } else {
        stored = await prisma.account.create({
            data: {
                userId: options.userId,
                ...accountData,
            },
        });
    }

    await prisma.account.deleteMany({
        where: {
            userId: options.userId,
            provider: YOUTUBE_ACCOUNT_PROVIDER,
            NOT: {
                id: stored.id,
            },
        },
    });

    clearYouTubeRuntimeCache(options.userId);
    return {
        accountId: stored.id,
        channel: {
            id: channelId,
            title: String(ensuredChannel?.snippet?.title || "").trim() || "Connected YouTube Channel",
        },
    };
}

export async function disconnectYouTubeConnection(userId: string) {
    const deleted = await prisma.account.deleteMany({
        where: {
            userId,
            provider: YOUTUBE_ACCOUNT_PROVIDER,
        },
    });

    clearYouTubeRuntimeCache(userId);
    return deleted.count > 0;
}

export async function createYouTubeLivePoll(options: {
    userId: string;
    liveChatId: string;
    questionText: string;
    optionTexts: string[];
}) {
    const account = await getRefreshedConnection(options.userId);
    if (!account) {
        throw new YouTubeError("YouTube account is not connected.", "youtube_not_connected", 404);
    }
    if (!hasGrantedScopes(account.scope, YOUTUBE_MANAGE_SCOPE)) {
        throw new YouTubeError(
            "Live poll controls need an extra YouTube permission approval before a poll can start.",
            "youtube_scope_upgrade_required",
            403
        );
    }

    const existingPoll = await fetchActivePoll(options.userId, options.liveChatId).catch(() => null);
    if (existingPoll?.id) {
        throw new YouTubeError(
            "A live poll is already active for this stream. End it before starting a new one.",
            "youtube_poll_already_active",
            409
        );
    }

    const payload = await youtubeApiRequest<LiveChatMessageResponse>(
        options.userId,
        buildYoutubeUrl("/liveChat/messages", {
            part: "snippet",
        }),
        {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                snippet: {
                    liveChatId: options.liveChatId,
                    type: "pollEvent",
                    pollDetails: {
                        metadata: {
                            questionText: options.questionText,
                            options: options.optionTexts.map((optionText) => ({ optionText })),
                        },
                    },
                },
            }),
        }
    );

    const poll = parsePoll(payload);
    if (!poll) {
        throw new YouTubeError("YouTube did not return a valid poll payload.", "youtube_poll_invalid", 502);
    }
    clearYouTubeRuntimeCache(options.userId);
    return poll;
}

export async function closeYouTubeLivePoll(options: {
    userId: string;
    pollId: string;
}) {
    const account = await getRefreshedConnection(options.userId);
    if (!account) {
        throw new YouTubeError("YouTube account is not connected.", "youtube_not_connected", 404);
    }
    if (!hasGrantedScopes(account.scope, YOUTUBE_MANAGE_SCOPE)) {
        throw new YouTubeError(
            "Live poll controls need an extra YouTube permission approval before a poll can be ended.",
            "youtube_scope_upgrade_required",
            403
        );
    }

    const payload = await youtubeApiRequest<LiveChatMessageResponse>(
        options.userId,
        buildYoutubeUrl("/liveChat/messages/transition", {
            id: options.pollId,
            status: "closed",
            part: "snippet",
        }),
        {
            method: "POST",
        }
    );

    const poll = parsePoll(payload);
    if (!poll) {
        throw new YouTubeError("YouTube did not return a closed poll payload.", "youtube_poll_close_invalid", 502);
    }
    clearYouTubeRuntimeCache(options.userId);
    return poll;
}
