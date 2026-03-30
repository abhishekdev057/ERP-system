import { PrismaClient } from "@prisma/client";
import {
    isDatabaseConnectivityError,
    isDatabaseQuotaError,
    isPoolTimeoutError,
    markDatabaseHealthy,
    markDatabaseUnavailable,
} from "@/lib/services/database-resilience";

const globalForPrisma = globalThis as unknown as {
    prisma: PrismaClient | undefined;
    prismaReconnectPromise: Promise<PrismaClient> | undefined;
    prismaRuntimeUrl: string | undefined;
};

function parsePositiveInt(value: string | undefined, fallback: number) {
    const parsed = Number.parseInt(String(value || ""), 10);
    if (!Number.isFinite(parsed) || parsed <= 0) {
        return fallback;
    }
    return parsed;
}

function clampToMinimum(value: number, minimum: number) {
    return Number.isFinite(value) ? Math.max(value, minimum) : minimum;
}

export const PRISMA_CONNECTION_LIMIT = parsePositiveInt(
    process.env.PRISMA_CONNECTION_LIMIT,
    process.env.NODE_ENV === "development" ? 5 : 8
);

export const PRISMA_SAFE_CONNECTION_LIMIT = clampToMinimum(
    PRISMA_CONNECTION_LIMIT,
    process.env.NODE_ENV === "development" ? 5 : 4
);

export const PRISMA_POOL_TIMEOUT_SECONDS = parsePositiveInt(
    process.env.PRISMA_POOL_TIMEOUT_SECONDS,
    3
);

export const PRISMA_CONNECT_TIMEOUT_SECONDS = parsePositiveInt(
    process.env.PRISMA_CONNECT_TIMEOUT_SECONDS,
    10
);

function buildRuntimeDatabaseUrl() {
    const runtimeUrl =
        process.env.POSTGRES_PRISMA_URL ||
        process.env.DATABASE_URL ||
        process.env.DATABASE_URL_UNPOOLED;

    if (!runtimeUrl) {
        return runtimeUrl;
    }

    try {
        const parsed = new URL(runtimeUrl);
        parsed.searchParams.set("sslmode", parsed.searchParams.get("sslmode") || "require");
        parsed.searchParams.set("connect_timeout", String(PRISMA_CONNECT_TIMEOUT_SECONDS));
        parsed.searchParams.set("pool_timeout", String(PRISMA_POOL_TIMEOUT_SECONDS));
        parsed.searchParams.set("connection_limit", String(PRISMA_SAFE_CONNECTION_LIMIT));
        return parsed.toString();
    } catch {
        return runtimeUrl;
    }
}

function createPrismaClient(databaseUrl = buildRuntimeDatabaseUrl()) {
    return new PrismaClient({
        datasources: {
            db: {
                // Keep a small pool: Next.js dev mode hot-reloads frequently and
                // spawns many concurrent route handlers. A large pool (default: 21)
                // can be exhausted by parallel API calls, causing P2024 timeouts.
                url: databaseUrl,
            },
        },
        log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
    });
}

function getRuntimeDatabaseUrl() {
    return buildRuntimeDatabaseUrl();
}

const runtimeDatabaseUrl = getRuntimeDatabaseUrl();

if (
    globalForPrisma.prisma &&
    globalForPrisma.prismaRuntimeUrl &&
    runtimeDatabaseUrl &&
    globalForPrisma.prismaRuntimeUrl !== runtimeDatabaseUrl
) {
    void globalForPrisma.prisma.$disconnect().catch(() => undefined);
    globalForPrisma.prisma = undefined;
}

export let prisma = globalForPrisma.prisma ?? createPrismaClient(runtimeDatabaseUrl);

if (process.env.NODE_ENV !== "production") {
    globalForPrisma.prisma = prisma;
    globalForPrisma.prismaRuntimeUrl = runtimeDatabaseUrl;
}

function sleep(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function reconnectPrismaClient(): Promise<PrismaClient> {
    if (globalForPrisma.prismaReconnectPromise) {
        return globalForPrisma.prismaReconnectPromise;
    }

    globalForPrisma.prismaReconnectPromise = (async () => {
        try {
            await prisma.$disconnect().catch(() => undefined);
        } catch {
            // Ignore disconnect failures during reconnect.
        }

        const nextRuntimeDatabaseUrl = getRuntimeDatabaseUrl();
        const nextClient = createPrismaClient(nextRuntimeDatabaseUrl);
        prisma = nextClient;
        globalForPrisma.prisma = nextClient;
        globalForPrisma.prismaRuntimeUrl = nextRuntimeDatabaseUrl;
        await nextClient.$connect();
        return nextClient;
    })();

    try {
        return await globalForPrisma.prismaReconnectPromise;
    } finally {
        globalForPrisma.prismaReconnectPromise = undefined;
    }
}

export async function runPrismaWithReconnect<T>(
    operation: (client: PrismaClient) => Promise<T>,
    options?: {
        maxAttempts?: number;
        retryDelayMs?: number;
    }
): Promise<T> {
    const maxAttempts = options?.maxAttempts ?? 3;
    const retryDelayMs = options?.retryDelayMs ?? 500;

    let lastError: unknown;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        try {
            const client = prisma;
            const result = await operation(client);
            markDatabaseHealthy();
            return result;
        } catch (error) {
            lastError = error;
            const poolTimedOut = isPoolTimeoutError(error);

            if (isDatabaseQuotaError(error)) {
                throw new Error("Neon database quota exceeded. Restore quota or switch DATABASE_URL before signing in again.");
            }

            if (!isDatabaseConnectivityError(error) || attempt >= maxAttempts) {
                throw error;
            }

            markDatabaseUnavailable(error);
            if (!poolTimedOut) {
                await reconnectPrismaClient();
            }
            await sleep((poolTimedOut ? 150 : retryDelayMs) * attempt);
        }
    }

    throw lastError instanceof Error ? lastError : new Error("Unknown Prisma error.");
}
