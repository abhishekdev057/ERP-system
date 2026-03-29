import { Prisma } from "@prisma/client";

const DB_UNAVAILABLE_WINDOW_MS = 45_000;
// Pool timeouts resolve quickly — use a shorter backoff so normal queries resume fast
const POOL_TIMEOUT_WINDOW_MS = 10_000;
let dbUnavailableUntil = 0;

export function isDatabaseQuotaError(error: unknown): boolean {
    const message = error instanceof Error ? error.message : String(error);
    return (
        message.includes("exceeded the data transfer quota") ||
        message.includes("Upgrade your plan to increase limits")
    );
}

function hasNoNetworkResolution(message: string) {
    return (
        message.includes("Can't reach database server") ||
        message.includes("ENOTFOUND") ||
        message.includes("ECONNREFUSED") ||
        message.includes("ECONNRESET") ||
        message.includes("ETIMEDOUT")
    );
}

// P2024 = connection pool timeout (too many concurrent requests)
export function isPoolTimeoutError(error: unknown): boolean {
    return (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2024"
    );
}

export function isDatabaseConnectivityError(error: unknown): boolean {
    if (isDatabaseQuotaError(error)) {
        return false;
    }

    if (error instanceof Prisma.PrismaClientInitializationError) {
        return true;
    }

    if (error instanceof Prisma.PrismaClientKnownRequestError) {
        // P1001 = can't reach DB, P2024 = pool exhausted
        return error.code === "P1001" || error.code === "P2024";
    }

    const message = error instanceof Error ? error.message : String(error);
    return hasNoNetworkResolution(message);
}

export function shouldBypassDatabase(): boolean {
    return Date.now() < dbUnavailableUntil;
}

export function markDatabaseUnavailable(error?: unknown) {
    // Use a shorter backoff for pool timeouts since they self-resolve quickly
    const window = isPoolTimeoutError(error) ? POOL_TIMEOUT_WINDOW_MS : DB_UNAVAILABLE_WINDOW_MS;
    dbUnavailableUntil = Date.now() + window;
}

export function markDatabaseHealthy() {
    dbUnavailableUntil = 0;
}

export async function withDatabaseFallback<T>(
    operation: () => Promise<T>,
    fallback: () => Promise<T> | T
): Promise<T> {
    if (shouldBypassDatabase()) {
        return Promise.resolve(fallback());
    }

    try {
        const result = await operation();
        markDatabaseHealthy();
        return result;
    } catch (error) {
        if (isDatabaseConnectivityError(error)) {
            markDatabaseUnavailable(error);
            const rawMessage = error instanceof Error ? error.message : String(error);
            const compactMessage = rawMessage.replace(/\s+/g, " ").trim();
            const isPoolTimeout = isPoolTimeoutError(error);
            const summary = isPoolTimeout
                ? "Connection pool exhausted — using offline fallback for 10 s."
                : compactMessage.includes("Can't reach database server")
                    ? "Can't reach database server."
                    : compactMessage.slice(0, 220);
            console.warn("[db-resilience] Database unavailable. Using offline fallback.", summary);
            return Promise.resolve(fallback());
        }

        throw error;
    }
}
