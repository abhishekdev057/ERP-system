import { promises as fs } from "fs";
import path from "path";

const GEMINI_USAGE_STORE_DIR = path.join(process.cwd(), ".nexora-cache");
const GEMINI_USAGE_STORE_FILE = path.join(GEMINI_USAGE_STORE_DIR, "gemini-usage.json");
const GEMINI_USAGE_STORE_VERSION = 1;
const GEMINI_SOFT_DAILY_LIMIT = Math.max(
    1,
    Number.parseInt(process.env.GEMINI_SOFT_DAILY_LIMIT || "240", 10) || 240
);
const GEMINI_SOFT_HOURLY_LIMIT = Math.max(
    1,
    Number.parseInt(process.env.GEMINI_SOFT_HOURLY_LIMIT || "48", 10) || 48
);

type GeminiActionDefinition = {
    label: string;
    model: string;
    weight: number;
    note: string;
};

type GeminiUsageEvent = {
    actionKey: string;
    at: string;
    weight: number;
};

type GeminiActionRecord = GeminiActionDefinition & {
    calls: number;
    weightedUsage: number;
    lastCalledAt?: string;
};

type GeminiUsageDayRecord = {
    totalCalls: number;
    totalWeightedUsage: number;
    lastUpdatedAt?: string;
    byAction: Record<string, GeminiActionRecord>;
    events: GeminiUsageEvent[];
};

type GeminiUsageStore = {
    version: number;
    days: Record<string, GeminiUsageDayRecord>;
    rateBlock?: {
        until?: string;
        setAt?: string;
        reason?: string;
        estimated?: boolean;
        retryAfterSeconds?: number;
    };
};

export type GeminiUsageConsumer = {
    key: string;
    label: string;
    model: string;
    weightPerCall: number;
    calls: number;
    weightedUsage: number;
    sharePercent: number;
    lastCalledAt?: string;
};

export type GeminiUsageSummary = {
    estimated: boolean;
    softDailyLimit: number;
    softHourlyLimit: number;
    usedWeightedUsage: number;
    remainingWeightedUsage: number;
    usagePercent: number;
    lastHourCalls: number;
    lastHourWeightedUsage: number;
    hourlyPercent: number;
    blocked: boolean;
    blockedUntil?: string;
    blockedReason?: string;
    blockedRetryAfterSeconds?: number;
    blockedResetEstimated: boolean;
    dayKey: string;
    nextResetAt: string;
    topConsumers: GeminiUsageConsumer[];
    warnings: string[];
    lastUpdatedAt?: string;
};

export type GeminiRateLimitInfo = {
    isRateLimited: boolean;
    isDailyQuota: boolean;
    retryAfterSeconds?: number;
};

const GEMINI_USAGE_ACTIONS: Record<string, GeminiActionDefinition> = {
    assistant_chat: {
        label: "Media assistant chat",
        model: "gemini-2.5-flash",
        weight: 1,
        note: "Knowledge and prompt-help chat runs.",
    },
    social_publish_copy: {
        label: "Social publish copy assist",
        model: "gemini-2.5-flash",
        weight: 1,
        note: "Caption or title generation before publishing.",
    },
    image_generation: {
        label: "Image generation",
        model: "gemini-2.5-flash-image",
        weight: 4,
        note: "Still visual generation requests.",
    },
    image_validation: {
        label: "Image QA validation",
        model: "gemini-2.5-flash",
        weight: 1,
        note: "Post-generation text and logo verification.",
    },
    video_generation: {
        label: "Video generation job",
        model: "veo-3.1-generate-preview",
        weight: 6,
        note: "Long-running video generation requests.",
    },
    video_status_poll: {
        label: "Video job status polling",
        model: "veo-3.1-generate-preview",
        weight: 1,
        note: "Polling for video generation completion.",
    },
    knowledge_index_embedding: {
        label: "Knowledge index embedding",
        model: "text-embedding-004",
        weight: 1,
        note: "Embedding refreshed knowledge chunks for enterprise retrieval.",
    },
    knowledge_query_embedding: {
        label: "Knowledge query embedding",
        model: "text-embedding-004",
        weight: 1,
        note: "Embedding the active user query for semantic retrieval.",
    },
};

let usageStoreCache: GeminiUsageStore | null = null;
let usageStoreWriteQueue: Promise<void> = Promise.resolve();

function createEmptyStore(): GeminiUsageStore {
    return {
        version: GEMINI_USAGE_STORE_VERSION,
        days: {},
        rateBlock: undefined,
    };
}

function getLocalDayKey(date = new Date()) {
    return new Intl.DateTimeFormat("en-CA", {
        timeZone: "Asia/Kolkata",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
    }).format(date);
}

function getNextLocalDayStart(date = new Date()) {
    const formatter = new Intl.DateTimeFormat("en-US", {
        timeZone: "Asia/Kolkata",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
    });
    const parts = formatter.formatToParts(date);
    const read = (type: string) => Number(parts.find((part) => part.type === type)?.value || "0");
    const localMidnightUtc = Date.UTC(read("year"), read("month") - 1, read("day") + 1, 0, 0, 0);
    return new Date(localMidnightUtc).toISOString();
}

function createEmptyDayRecord(): GeminiUsageDayRecord {
    return {
        totalCalls: 0,
        totalWeightedUsage: 0,
        lastUpdatedAt: undefined,
        byAction: {},
        events: [],
    };
}

async function ensureStoreDir() {
    await fs.mkdir(GEMINI_USAGE_STORE_DIR, { recursive: true });
}

async function readUsageStore(): Promise<GeminiUsageStore> {
    if (usageStoreCache) return usageStoreCache;

    try {
        const raw = await fs.readFile(GEMINI_USAGE_STORE_FILE, "utf-8");
        const parsed = JSON.parse(raw) as Partial<GeminiUsageStore>;
        usageStoreCache = {
            version: Number(parsed?.version) || GEMINI_USAGE_STORE_VERSION,
            days: parsed?.days && typeof parsed.days === "object" ? parsed.days : {},
            rateBlock:
                parsed?.rateBlock && typeof parsed.rateBlock === "object"
                    ? parsed.rateBlock
                    : undefined,
        };
        return usageStoreCache;
    } catch (error: any) {
        if (error?.code === "ENOENT") {
            usageStoreCache = createEmptyStore();
            return usageStoreCache;
        }
        throw error;
    }
}

function trimStore(store: GeminiUsageStore, keepDays = 14) {
    const keys = Object.keys(store.days).sort().reverse();
    for (const staleKey of keys.slice(keepDays)) {
        delete store.days[staleKey];
    }

    const cutoff = Date.now() - 36 * 60 * 60 * 1000;
    for (const dayKey of Object.keys(store.days)) {
        store.days[dayKey].events = store.days[dayKey].events.filter((event) => {
            const time = new Date(event.at).getTime();
            return Number.isFinite(time) && time >= cutoff;
        });
    }
}

async function persistUsageStore(store: GeminiUsageStore) {
    usageStoreCache = store;
    trimStore(store);
    usageStoreWriteQueue = usageStoreWriteQueue.then(async () => {
        await ensureStoreDir();
        await fs.writeFile(GEMINI_USAGE_STORE_FILE, JSON.stringify(store, null, 2), "utf-8");
    });
    await usageStoreWriteQueue;
}

function getActionDefinition(actionKey: string): GeminiActionDefinition {
    return (
        GEMINI_USAGE_ACTIONS[actionKey] || {
            label: actionKey,
            model: "gemini",
            weight: 1,
            note: "Unclassified Gemini action.",
        }
    );
}

function parseRetryAfterSeconds(message: string): number | undefined {
    const normalized = String(message || "");
    const patterns = [
        /retry in\s+([0-9.]+)s/i,
        /retry after\s+([0-9.]+)s/i,
        /retry after\s+([0-9.]+)\s+seconds?/i,
        /"retryDelay":"([0-9.]+)s"/i,
    ];

    for (const pattern of patterns) {
        const match = normalized.match(pattern);
        if (!match) continue;
        const parsed = Number.parseFloat(match[1]);
        if (Number.isFinite(parsed) && parsed > 0) return parsed;
    }

    return undefined;
}

export function parseGeminiRateLimitInfo(error: unknown): GeminiRateLimitInfo {
    const raw = String(error instanceof Error ? error.message : String(error ?? ""))
        .replace(/\s+/g, " ")
        .trim();
    const hasRateSignal = /\b429\b|too many requests|rate limit|resource exhausted/i.test(raw);
    const hasQuotaSignal = /quota|quota exceeded|daily limit|limit exceeded|quotafailure/i.test(raw);
    const isRateLimited = hasRateSignal || hasQuotaSignal;

    if (!isRateLimited) {
        return {
            isRateLimited: false,
            isDailyQuota: false,
        };
    }

    return {
        isRateLimited: true,
        isDailyQuota: /perday|daily|day quota|requests per day/i.test(raw),
        retryAfterSeconds: parseRetryAfterSeconds(raw),
    };
}

export function buildGeminiRateLimitMessage(info: GeminiRateLimitInfo): string {
    if (info.isDailyQuota) {
        return "Gemini daily quota appears exhausted. Retry after the next reset window or lower request volume.";
    }

    if (info.retryAfterSeconds !== undefined) {
        return `Gemini rate limit hit. Retry after ~${Math.ceil(info.retryAfterSeconds)}s.`;
    }

    return "Gemini API rate limit reached. Retry later or reduce request volume.";
}

export async function recordGeminiUsage(actionKey: string) {
    const definition = getActionDefinition(actionKey);
    const store = await readUsageStore();
    const dayKey = getLocalDayKey();
    const day = store.days[dayKey] || createEmptyDayRecord();
    const existing = day.byAction[actionKey] || {
        ...definition,
        calls: 0,
        weightedUsage: 0,
        lastCalledAt: undefined,
    };

    existing.calls += 1;
    existing.weightedUsage += definition.weight;
    existing.lastCalledAt = new Date().toISOString();
    day.byAction[actionKey] = existing;
    day.totalCalls += 1;
    day.totalWeightedUsage += definition.weight;
    day.lastUpdatedAt = new Date().toISOString();
    day.events.push({
        actionKey,
        at: new Date().toISOString(),
        weight: definition.weight,
    });

    store.days[dayKey] = day;
    await persistUsageStore(store);
}

export async function setGeminiRateBlocked(options: {
    retryAfterSeconds?: number;
    reason?: string;
    isDailyQuota?: boolean;
}) {
    const store = await readUsageStore();
    const now = Date.now();
    const until = options.retryAfterSeconds
        ? new Date(now + Math.ceil(options.retryAfterSeconds) * 1000).toISOString()
        : options.isDailyQuota
            ? getNextLocalDayStart(new Date(now))
            : new Date(now + 15 * 60 * 1000).toISOString();

    store.rateBlock = {
        until,
        setAt: new Date(now).toISOString(),
        reason: String(options.reason || "").trim() || "Gemini rate limit active.",
        estimated: !options.retryAfterSeconds,
        retryAfterSeconds: options.retryAfterSeconds,
    };

    await persistUsageStore(store);
}

function getActiveRateBlock(store: GeminiUsageStore) {
    const until = String(store.rateBlock?.until || "").trim();
    if (!until) return undefined;
    const untilMs = new Date(until).getTime();
    if (!Number.isFinite(untilMs) || untilMs <= Date.now()) {
        store.rateBlock = undefined;
        return undefined;
    }
    return store.rateBlock;
}

function summarizeLastHour(store: GeminiUsageStore) {
    const cutoff = Date.now() - 60 * 60 * 1000;
    let calls = 0;
    let weightedUsage = 0;

    for (const day of Object.values(store.days)) {
        for (const event of day.events || []) {
            const time = new Date(event.at).getTime();
            if (!Number.isFinite(time) || time < cutoff) continue;
            calls += 1;
            weightedUsage += Number(event.weight || 0);
        }
    }

    return { calls, weightedUsage };
}

export async function getGeminiUsageSummary(): Promise<GeminiUsageSummary> {
    const store = await readUsageStore();
    const dayKey = getLocalDayKey();
    const day = store.days[dayKey] || createEmptyDayRecord();
    const block = getActiveRateBlock(store);
    const consumers = Object.entries(day.byAction || {})
        .map(([key, action]) => ({
            key,
            label: action.label,
            model: action.model,
            weightPerCall: action.weight,
            calls: action.calls,
            weightedUsage: action.weightedUsage,
            sharePercent:
                day.totalWeightedUsage > 0
                    ? Number(((action.weightedUsage / day.totalWeightedUsage) * 100).toFixed(1))
                    : 0,
            lastCalledAt: action.lastCalledAt,
        }))
        .sort((left, right) => {
            if (right.weightedUsage !== left.weightedUsage) return right.weightedUsage - left.weightedUsage;
            return right.calls - left.calls;
        });

    const lastHour = summarizeLastHour(store);
    const usedWeightedUsage = Number(day.totalWeightedUsage || 0);
    const usagePercent = Math.min(100, Number(((usedWeightedUsage / GEMINI_SOFT_DAILY_LIMIT) * 100).toFixed(1)));
    const hourlyPercent = Math.min(100, Number(((lastHour.weightedUsage / GEMINI_SOFT_HOURLY_LIMIT) * 100).toFixed(1)));
    const warnings: string[] = [];

    if (block) {
        warnings.push(
            block.estimated
                ? "Gemini is currently in a cooldown or estimated reset window. New runs should stay paused until the shown time."
                : "Gemini returned an explicit retry window. New runs should stay paused until the shown time."
        );
    }
    if (hourlyPercent >= 90) {
        warnings.push("The last-hour Gemini request load is very high. Slow down retries and heavy generations.");
    } else if (hourlyPercent >= 60) {
        warnings.push("The last-hour Gemini request load is elevated. Prefer tighter prompts and fewer retries.");
    }
    if (usagePercent >= 85) {
        warnings.push("The app-tracked daily Gemini load is high. Keep generation and assistant calls focused.");
    }
    if (consumers[0]?.key === "video_generation" || consumers[0]?.key === "video_status_poll") {
        warnings.push("Video generation is currently the biggest Gemini load driver.");
    }

    await persistUsageStore(store);

    return {
        estimated: true,
        softDailyLimit: GEMINI_SOFT_DAILY_LIMIT,
        softHourlyLimit: GEMINI_SOFT_HOURLY_LIMIT,
        usedWeightedUsage,
        remainingWeightedUsage: Math.max(0, GEMINI_SOFT_DAILY_LIMIT - usedWeightedUsage),
        usagePercent,
        lastHourCalls: lastHour.calls,
        lastHourWeightedUsage: lastHour.weightedUsage,
        hourlyPercent,
        blocked: Boolean(block),
        blockedUntil: block?.until,
        blockedReason: block?.reason,
        blockedRetryAfterSeconds: block?.retryAfterSeconds,
        blockedResetEstimated: Boolean(block?.estimated),
        dayKey,
        nextResetAt: getNextLocalDayStart(),
        topConsumers: consumers.slice(0, 5),
        warnings,
        lastUpdatedAt: day.lastUpdatedAt,
    };
}
