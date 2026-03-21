import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as {
    prisma: PrismaClient | undefined;
};

function createPrismaClient() {
    return new PrismaClient({
        datasources: {
            db: {
                // Keep a small pool: Next.js dev mode hot-reloads frequently and
                // spawns many concurrent route handlers. A large pool (default: 21)
                // can be exhausted by parallel API calls, causing P2024 timeouts.
                url: process.env.DATABASE_URL,
            },
        },
        log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
    });
}

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
