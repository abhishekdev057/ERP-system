import { promises as fs } from "fs";
import path from "path";

export const YOUTUBE_DAILY_QUOTA_LIMIT = 10_000;
const YOUTUBE_QUOTA_STORE_DIR = path.join(process.cwd(), ".nexora-cache");
const YOUTUBE_QUOTA_STORE_FILE = path.join(YOUTUBE_QUOTA_STORE_DIR, "youtube-quota-usage.json");
const YOUTUBE_QUOTA_STORE_VERSION = 1;
const YOUTUBE_QUOTA_TIMEZONE = "America/Los_Angeles";

type YouTubeQuotaActionDefinition = {
    label: string;
    method: string;
    path: string;
    unitsPerCall: number;
    note: string;
};

type YouTubeQuotaActionRecord = YouTubeQuotaActionDefinition & {
    calls: number;
    units: number;
    lastCalledAt?: string;
};

type YouTubeQuotaDayRecord = {
    totalCalls: number;
    totalUnits: number;
    lastUpdatedAt?: string;
    byAction: Record<string, YouTubeQuotaActionRecord>;
};

type YouTubeQuotaStore = {
    version: number;
    days: Record<string, YouTubeQuotaDayRecord>;
    quotaBlock?: {
        until?: string;
        setAt?: string;
        reason?: string;
    };
};

export type YouTubeQuotaConsumer = {
    key: string;
    label: string;
    method: string;
    path: string;
    unitsPerCall: number;
    calls: number;
    units: number;
    sharePercent: number;
    lastCalledAt?: string;
};

export type YouTubeQuotaActionGuide = {
    key: string;
    label: string;
    unitsPerCall: number;
    method: string;
    path: string;
    note: string;
};

export type YouTubeQuotaSummary = {
    estimated: boolean;
    dailyLimit: number;
    usedUnits: number;
    remainingUnits: number;
    usagePercent: number;
    exhausted: boolean;
    totalCalls: number;
    dayKey: string;
    timezone: string;
    nextResetAt: string;
    blockedUntil?: string;
    blockedReason?: string;
    topConsumers: YouTubeQuotaConsumer[];
    expensiveActions: YouTubeQuotaActionGuide[];
    warnings: string[];
    lastUpdatedAt?: string;
};

const YOUTUBE_QUOTA_ACTIONS: Record<string, YouTubeQuotaActionDefinition> = {
    "GET /channels": {
        label: "Channel profile",
        method: "GET",
        path: "/channels",
        unitsPerCall: 1,
        note: "Read-only channel details.",
    },
    "GET /playlistItems": {
        label: "Uploads playlist",
        method: "GET",
        path: "/playlistItems",
        unitsPerCall: 1,
        note: "Recent upload listing.",
    },
    "GET /videos": {
        label: "Video statistics",
        method: "GET",
        path: "/videos",
        unitsPerCall: 1,
        note: "Views, likes, comments, and live viewer stats.",
    },
    "GET /liveBroadcasts": {
        label: "Live broadcast listing",
        method: "GET",
        path: "/liveBroadcasts",
        unitsPerCall: 1,
        note: "Active, upcoming, and completed stream metadata.",
    },
    "GET /liveChat/messages": {
        label: "Live chat / active poll reads",
        method: "GET",
        path: "/liveChat/messages",
        unitsPerCall: 1,
        note: "Realtime live chat refreshes and active poll lookups.",
    },
    "GET /commentThreads": {
        label: "Video comment threads",
        method: "GET",
        path: "/commentThreads",
        unitsPerCall: 1,
        note: "Loads public comment threads under a video.",
    },
    "POST /liveChat/messages": {
        label: "Poll start / live chat send",
        method: "POST",
        path: "/liveChat/messages",
        unitsPerCall: 50,
        note: "High-cost write action. Used for starting polls or sending live chat messages.",
    },
    "POST /liveChat/messages/transition": {
        label: "Poll transition",
        method: "POST",
        path: "/liveChat/messages/transition",
        unitsPerCall: 50,
        note: "Closes or transitions an active poll.",
    },
    "POST /comments": {
        label: "Comment replies",
        method: "POST",
        path: "/comments",
        unitsPerCall: 50,
        note: "Posts a reply under an existing user comment.",
    },
    "POST /commentThreads": {
        label: "New comment threads",
        method: "POST",
        path: "/commentThreads",
        unitsPerCall: 50,
        note: "Starts a new top-level public comment thread.",
    },
};

let quotaStoreCache: YouTubeQuotaStore | null = null;
let quotaStoreWriteQueue: Promise<void> = Promise.resolve();

function getPacificDayKey(date = new Date()) {
    const formatter = new Intl.DateTimeFormat("en-CA", {
        timeZone: YOUTUBE_QUOTA_TIMEZONE,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
    });

    return formatter.format(date);
}

function createEmptyStore(): YouTubeQuotaStore {
    return {
        version: YOUTUBE_QUOTA_STORE_VERSION,
        days: {},
        quotaBlock: undefined,
    };
}

async function ensureStoreDir() {
    await fs.mkdir(YOUTUBE_QUOTA_STORE_DIR, { recursive: true });
}

async function readQuotaStore(): Promise<YouTubeQuotaStore> {
    if (quotaStoreCache) {
        return quotaStoreCache;
    }

    try {
        const raw = await fs.readFile(YOUTUBE_QUOTA_STORE_FILE, "utf-8");
        const parsed = JSON.parse(raw) as Partial<YouTubeQuotaStore>;
        quotaStoreCache = {
            version: Number(parsed?.version) || YOUTUBE_QUOTA_STORE_VERSION,
            days: parsed?.days && typeof parsed.days === "object" ? parsed.days : {},
            quotaBlock:
                parsed?.quotaBlock && typeof parsed.quotaBlock === "object"
                    ? parsed.quotaBlock
                    : undefined,
        };
        return quotaStoreCache;
    } catch (error: any) {
        if (error?.code === "ENOENT") {
            quotaStoreCache = createEmptyStore();
            return quotaStoreCache;
        }
        throw error;
    }
}

function trimOldDays(store: YouTubeQuotaStore, keepDays = 14) {
    const keys = Object.keys(store.days).sort().reverse();
    for (const staleKey of keys.slice(keepDays)) {
        delete store.days[staleKey];
    }
}

async function persistQuotaStore(store: YouTubeQuotaStore) {
    quotaStoreCache = store;
    trimOldDays(store);
    quotaStoreWriteQueue = quotaStoreWriteQueue.then(async () => {
        await ensureStoreDir();
        await fs.writeFile(YOUTUBE_QUOTA_STORE_FILE, JSON.stringify(store, null, 2), "utf-8");
    });
    await quotaStoreWriteQueue;
}

function normalizeYoutubeApiPath(endpoint: string) {
    try {
        const url = new URL(endpoint);
        return url.pathname.replace(/^\/youtube\/v3/, "") || "/";
    } catch {
        return endpoint;
    }
}

function getTimeZoneParts(date: Date, timeZone: string) {
    const formatter = new Intl.DateTimeFormat("en-US", {
        timeZone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false,
    });

    const parts = formatter.formatToParts(date);
    const read = (type: string) => Number(parts.find((part) => part.type === type)?.value || "0");

    return {
        year: read("year"),
        month: read("month"),
        day: read("day"),
        hour: read("hour"),
        minute: read("minute"),
        second: read("second"),
    };
}

function getTimeZoneOffsetMs(date: Date, timeZone: string) {
    const parts = getTimeZoneParts(date, timeZone);
    const asUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
    return asUtc - date.getTime();
}

export function getNextYouTubeQuotaResetAt(date = new Date()) {
    const parts = getTimeZoneParts(date, YOUTUBE_QUOTA_TIMEZONE);
    const offsetMs = getTimeZoneOffsetMs(date, YOUTUBE_QUOTA_TIMEZONE);
    const nextMidnightAsUtc = Date.UTC(parts.year, parts.month - 1, parts.day + 1, 0, 0, 0, 0);
    return new Date(nextMidnightAsUtc - offsetMs).toISOString();
}

async function getQuotaBlock(store?: YouTubeQuotaStore) {
    const source = store || await readQuotaStore();
    const blockedUntil = String(source.quotaBlock?.until || "").trim();
    if (!blockedUntil) {
        return null;
    }

    const blockedUntilMs = new Date(blockedUntil).getTime();
    if (!Number.isFinite(blockedUntilMs) || blockedUntilMs <= Date.now()) {
        if (source.quotaBlock) {
            source.quotaBlock = undefined;
            await persistQuotaStore(source);
        }
        return null;
    }

    return {
        blockedUntil,
        reason: String(source.quotaBlock?.reason || "").trim() || undefined,
        setAt: String(source.quotaBlock?.setAt || "").trim() || undefined,
    };
}

function resolveQuotaAction(endpoint: string, method: string) {
    const normalizedMethod = String(method || "GET").trim().toUpperCase();
    const pathName = normalizeYoutubeApiPath(endpoint);
    const key = `${normalizedMethod} ${pathName}`;
    const known = YOUTUBE_QUOTA_ACTIONS[key];

    if (known) {
        return { key, definition: known };
    }

    return {
        key,
        definition: {
            label: `${normalizedMethod} ${pathName}`,
            method: normalizedMethod,
            path: pathName,
            unitsPerCall: normalizedMethod === "GET" ? 1 : 50,
            note: normalizedMethod === "GET"
                ? "Fallback estimate for an unclassified read request."
                : "Fallback estimate for an unclassified write request.",
        } satisfies YouTubeQuotaActionDefinition,
    };
}

export async function recordYouTubeQuotaUsage(options: {
    endpoint: string;
    method?: string;
}) {
    const store = await readQuotaStore();
    const dayKey = getPacificDayKey();
    const { key, definition } = resolveQuotaAction(options.endpoint, options.method || "GET");
    const now = new Date().toISOString();

    const dayRecord = store.days[dayKey] || {
        totalCalls: 0,
        totalUnits: 0,
        byAction: {},
    };

    const actionRecord = dayRecord.byAction[key] || {
        ...definition,
        calls: 0,
        units: 0,
    };

    actionRecord.calls += 1;
    actionRecord.units += definition.unitsPerCall;
    actionRecord.lastCalledAt = now;

    dayRecord.totalCalls += 1;
    dayRecord.totalUnits += definition.unitsPerCall;
    dayRecord.lastUpdatedAt = now;
    dayRecord.byAction[key] = actionRecord;
    store.days[dayKey] = dayRecord;

    await persistQuotaStore(store);
}

export async function markYouTubeQuotaExhausted(reason?: string) {
    const store = await readQuotaStore();
    const nextResetAt = getNextYouTubeQuotaResetAt();
    store.quotaBlock = {
        until: nextResetAt,
        setAt: new Date().toISOString(),
        reason: String(reason || "").trim() || "YouTube project quota exhausted.",
    };
    await persistQuotaStore(store);
    return {
        blockedUntil: nextResetAt,
        reason: store.quotaBlock.reason,
    };
}

export async function getYouTubeQuotaBlockStatus() {
    const block = await getQuotaBlock();
    if (!block) {
        return {
            blocked: false,
            nextResetAt: getNextYouTubeQuotaResetAt(),
        };
    }

    return {
        blocked: true,
        blockedUntil: block.blockedUntil,
        blockedReason: block.reason,
        nextResetAt: block.blockedUntil,
    };
}

export async function getYouTubeQuotaSummary(): Promise<YouTubeQuotaSummary> {
    const store = await readQuotaStore();
    const block = await getQuotaBlock(store);
    const dayKey = getPacificDayKey();
    const dayRecord = store.days[dayKey] || {
        totalCalls: 0,
        totalUnits: 0,
        byAction: {},
    };

    const topConsumers = Object.entries(dayRecord.byAction)
        .map(([key, action]) => ({
            key,
            label: action.label,
            method: action.method,
            path: action.path,
            unitsPerCall: action.unitsPerCall,
            calls: action.calls,
            units: action.units,
            sharePercent: dayRecord.totalUnits > 0 ? (action.units / dayRecord.totalUnits) * 100 : 0,
            lastCalledAt: action.lastCalledAt,
        }))
        .sort((left, right) => right.units - left.units || right.calls - left.calls)
        .slice(0, 6);

    const expensiveActions = Object.entries(YOUTUBE_QUOTA_ACTIONS)
        .map(([key, action]) => ({
            key,
            label: action.label,
            unitsPerCall: action.unitsPerCall,
            method: action.method,
            path: action.path,
            note: action.note,
        }))
        .sort((left, right) => right.unitsPerCall - left.unitsPerCall || left.label.localeCompare(right.label))
        .slice(0, 6);

    const nextResetAt = block?.blockedUntil || getNextYouTubeQuotaResetAt();
    const exhausted = Boolean(block?.blockedUntil);
    const estimatedUsedUnits = exhausted
        ? Math.max(dayRecord.totalUnits, YOUTUBE_DAILY_QUOTA_LIMIT)
        : dayRecord.totalUnits;
    const usagePercent = YOUTUBE_DAILY_QUOTA_LIMIT > 0
        ? Math.min((estimatedUsedUnits / YOUTUBE_DAILY_QUOTA_LIMIT) * 100, 100)
        : 0;
    const remainingUnits = exhausted
        ? 0
        : Math.max(YOUTUBE_DAILY_QUOTA_LIMIT - dayRecord.totalUnits, 0);

    const warnings: string[] = [];
    if (exhausted) {
        warnings.push("YouTube daily project quota is exhausted. The workspace should resume automatically after the next Pacific Time reset.");
    }
    if (usagePercent >= 80) {
        warnings.push("Estimated usage is above 80% of the 10,000-unit daily budget.");
    } else if (usagePercent >= 50) {
        warnings.push("Estimated usage has crossed 50% of the daily budget. Keep refreshes tighter.");
    }

    const liveChatReads = topConsumers.find((action) => action.key === "GET /liveChat/messages");
    if (liveChatReads && liveChatReads.sharePercent >= 35) {
        warnings.push("Live chat refreshes are currently the biggest quota consumer.");
    }

    const writeActions = topConsumers.filter((action) => action.unitsPerCall >= 50);
    if (writeActions.length > 0) {
        warnings.push("Poll starts, poll ends, and comment writes are the highest-cost actions in this workspace.");
    }

    return {
        estimated: true,
        dailyLimit: YOUTUBE_DAILY_QUOTA_LIMIT,
        usedUnits: estimatedUsedUnits,
        remainingUnits,
        usagePercent,
        exhausted,
        totalCalls: dayRecord.totalCalls,
        dayKey,
        timezone: YOUTUBE_QUOTA_TIMEZONE,
        nextResetAt,
        blockedUntil: block?.blockedUntil,
        blockedReason: block?.reason,
        topConsumers,
        expensiveActions,
        warnings,
        lastUpdatedAt: dayRecord.lastUpdatedAt,
    };
}
