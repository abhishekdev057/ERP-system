import { randomBytes } from "crypto";
import { prisma } from "@/lib/prisma";

const GOOGLE_OAUTH_AUTHORIZE_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_OAUTH_TOKEN_URL = "https://oauth2.googleapis.com/token";
const YOUTUBE_API_BASE_URL = "https://www.googleapis.com/youtube/v3";
export const YOUTUBE_ACCOUNT_PROVIDER = "youtube";
export const YOUTUBE_OAUTH_STATE_COOKIE = "youtube_oauth_state";
export const YOUTUBE_OAUTH_RETURN_COOKIE = "youtube_oauth_return_to";
export const YOUTUBE_OAUTH_USER_COOKIE = "youtube_oauth_user";
export const YOUTUBE_CONNECT_SCOPES = [
    "https://www.googleapis.com/auth/youtube.readonly",
    "https://www.googleapis.com/auth/youtube.force-ssl",
];

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

type LiveChatMessagesListResponse = {
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
};

export type YouTubeDashboard = {
    connected: boolean;
    needsReconnect?: boolean;
    channel?: YouTubeChannelSummary;
    uploads: YouTubeVideoSummary[];
    liveBroadcasts: {
        active: YouTubeLiveBroadcastSummary[];
        upcoming: YouTubeLiveBroadcastSummary[];
        completed: YouTubeLiveBroadcastSummary[];
    };
    warning?: string;
};

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
    const clientId = process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;

    if (!clientId || !clientSecret) {
        throw new YouTubeError(
            "Google OAuth client is not configured. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET.",
            "youtube_oauth_not_configured",
            500
        );
    }

    return { clientId, clientSecret };
}

export function buildYouTubeRedirectUri(origin: string): string {
    return `${origin.replace(/\/$/, "")}/api/youtube/callback`;
}

export function normalizeYouTubeReturnPath(input: string | null | undefined): string {
    const fallback = "/pdf-to-pdf/media";
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
}) {
    const { clientId } = requireGoogleClientConfig();
    const params = new URLSearchParams({
        client_id: clientId,
        redirect_uri: buildYouTubeRedirectUri(options.origin),
        response_type: "code",
        access_type: "offline",
        include_granted_scopes: "true",
        prompt: "consent select_account",
        scope: YOUTUBE_CONNECT_SCOPES.join(" "),
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

    throw parseApiError(payload, "YouTube API request failed.", response.status);
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
    const payload = await youtubeApiRequest<LiveChatMessagesListResponse>(
        userId,
        buildYoutubeUrl("/liveChat/messages", {
            part: "id,snippet",
            liveChatId,
            maxResults: 200,
        })
    );

    return parsePoll(payload.activePollItem || null);
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

    return videos as YouTubeVideoSummary[];
}

async function fetchBroadcastGroup(
    userId: string,
    status: "active" | "upcoming" | "completed",
    maxResults: number
) {
    const payload = await youtubeApiRequest<LiveBroadcastsResponse>(
        userId,
        buildYoutubeUrl("/liveBroadcasts", {
            part: "id,snippet,status,contentDetails",
            mine: true,
            broadcastStatus: status,
            broadcastType: "all",
            maxResults,
        })
    );

    const broadcasts = (payload.items || [])
        .map((item) => ({
            id: String(item.id || "").trim(),
            title: String(item.snippet?.title || "").trim() || "Untitled broadcast",
            description: String(item.snippet?.description || "").trim(),
            status,
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

    if (status !== "active") {
        return broadcasts;
    }

    return Promise.all(
        broadcasts.map(async (broadcast) => {
            if (!broadcast.liveChatId) return broadcast;
            try {
                const activePoll = await fetchActivePoll(userId, broadcast.liveChatId);
                return {
                    ...broadcast,
                    activePoll,
                };
            } catch {
                return broadcast;
            }
        })
    );
}

export async function fetchYouTubeDashboard(userId: string): Promise<YouTubeDashboard> {
    const existingAccount = await getStoredYouTubeAccount(userId);
    if (!existingAccount) {
        return {
            connected: false,
            uploads: [],
            liveBroadcasts: {
                active: [],
                upcoming: [],
                completed: [],
            },
        };
    }

    try {
        const channel = await fetchChannel(userId);
        const uploads = await fetchUploads(userId, channel.uploadsPlaylistId);

        let active: YouTubeLiveBroadcastSummary[] = [];
        let upcoming: YouTubeLiveBroadcastSummary[] = [];
        let completed: YouTubeLiveBroadcastSummary[] = [];
        let warning: string | undefined;

        try {
            [active, upcoming, completed] = await Promise.all([
                fetchBroadcastGroup(userId, "active", 8),
                fetchBroadcastGroup(userId, "upcoming", 8),
                fetchBroadcastGroup(userId, "completed", 8),
            ]);
        } catch (error) {
            const youtubeError = error as YouTubeError;
            if (
                youtubeError?.code === "liveStreamingNotEnabled" ||
                youtubeError?.code === "insufficientLivePermissions"
            ) {
                warning = youtubeError.message;
            } else {
                throw error;
            }
        }

        return {
            connected: true,
            channel,
            uploads,
            liveBroadcasts: {
                active,
                upcoming,
                completed,
            },
            warning,
        };
    } catch (error) {
        const youtubeError = error as YouTubeError;
        if (
            youtubeError?.code === "youtube_reconnect_required" ||
            youtubeError?.status === 401
        ) {
            return {
                connected: true,
                needsReconnect: true,
                uploads: [],
                liveBroadcasts: {
                    active: [],
                    upcoming: [],
                    completed: [],
                },
                warning: youtubeError.message,
            };
        }
        throw error;
    }
}

export async function storeYouTubeConnection(options: {
    userId: string;
    origin: string;
    code: string;
}) {
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
        scope: tokenPayload.scope || YOUTUBE_CONNECT_SCOPES.join(" "),
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

    return deleted.count > 0;
}

export async function createYouTubeLivePoll(options: {
    userId: string;
    liveChatId: string;
    questionText: string;
    optionTexts: string[];
}) {
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
    return poll;
}

export async function closeYouTubeLivePoll(options: {
    userId: string;
    pollId: string;
}) {
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
    return poll;
}
