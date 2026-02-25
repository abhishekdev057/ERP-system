import { Prisma } from "@prisma/client";

const DB_UNAVAILABLE_WINDOW_MS = 45_000;
let dbUnavailableUntil = 0;

function hasNoNetworkResolution(message: string) {
    return (
        message.includes("Can't reach database server") ||
        message.includes("ENOTFOUND") ||
        message.includes("ECONNREFUSED") ||
        message.includes("ECONNRESET") ||
        message.includes("ETIMEDOUT")
    );
}

export function isDatabaseConnectivityError(error: unknown): boolean {
    if (error instanceof Prisma.PrismaClientInitializationError) {
        return true;
    }

    if (error instanceof Prisma.PrismaClientKnownRequestError) {
        return error.code === "P1001";
    }

    const message = error instanceof Error ? error.message : String(error);
    return hasNoNetworkResolution(message);
}

export function shouldBypassDatabase(): boolean {
    return Date.now() < dbUnavailableUntil;
}

export function markDatabaseUnavailable() {
    dbUnavailableUntil = Date.now() + DB_UNAVAILABLE_WINDOW_MS;
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
            markDatabaseUnavailable();
            const rawMessage = error instanceof Error ? error.message : String(error);
            const compactMessage = rawMessage.replace(/\s+/g, " ").trim();
            const summary = compactMessage.includes("Can't reach database server")
                ? "Can't reach database server."
                : compactMessage.slice(0, 220);
            console.warn("[db-resilience] Database unavailable. Using offline fallback.", summary);
            return Promise.resolve(fallback());
        }

        throw error;
    }
}
