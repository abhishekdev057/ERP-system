import crypto from "crypto";
import { Prisma, PdfDocument } from "@prisma/client";
import { prisma, PRISMA_SAFE_CONNECTION_LIMIT } from "@/lib/prisma";
import { withDatabaseFallback } from "@/lib/services/database-resilience";
import {
    normalizeAssignedUserIds,
    resolveAssignedUserIds,
    withAssignedUserIds,
} from "@/lib/document-metadata";
import {
    deleteOfflinePdfDocumentById,
    getOfflinePdfDocumentById,
    getOfflinePdfStats,
    listOfflinePdfDocuments,
    upsertOfflinePdfDocument,
} from "@/lib/services/offline-pdf-document-store";
import { NormalizedPdfInput } from "@/lib/pdf-validation";

export interface DocumentListOptions {
    limit: number;
    offset: number;
    minimal: boolean;
    includeWorkspaceStats?: boolean;
    organizationId: string | null;
    userId: string;
    role: string;
    sortBy: DocumentSortField;
    sortOrder: DocumentSortDirection;
    searchQuery?: string;
    assigneeFilter?: string | null;
}

export type PdfDocumentListRecord = Pick<
    PdfDocument,
    "id" | "title" | "subject" | "date" | "createdAt" | "updatedAt"
> & {
    assignedUserIds: string[];
    jsonData?: PdfDocument["jsonData"];
};

export type PdfDocumentListResult = {
    documents: PdfDocumentListRecord[];
    total: number;
};

export type DocumentSortField = "createdAt" | "updatedAt" | "title" | "subject" | "date";
export type DocumentSortDirection = "asc" | "desc";

const DOCUMENT_LIST_CACHE_TTL_MS = 12_000;
const DOCUMENT_DETAIL_CACHE_TTL_MS = 10_000;
const DOCUMENT_STATS_CACHE_TTL_MS = 15_000;
const ASSIGNMENT_BACKFILL_CHECK_TTL_MS = 60_000;

type CacheEntry<T> = {
    value: T;
    expiresAt: number;
};

const documentListCache = new Map<string, CacheEntry<PdfDocumentListResult>>();
const documentDetailCache = new Map<string, CacheEntry<PdfDocument | null>>();
const documentStatsCache = new Map<string, CacheEntry<{ totalDocs: number; todayDocs: number }>>();
const documentListPending = new Map<string, Promise<PdfDocumentListResult>>();
const documentDetailPending = new Map<string, Promise<PdfDocument | null>>();
const documentStatsPending = new Map<string, Promise<{ totalDocs: number; todayDocs: number }>>();
let assignmentBackfillPromise: Promise<void> | null = null;
let assignmentBackfillCheckedAt = 0;

const pdfDocumentMinimalListSelect = {
    id: true,
    title: true,
    subject: true,
    date: true,
    createdAt: true,
    updatedAt: true,
    assignedUserIds: true,
} as const;

const pdfDocumentFullListSelect = {
    ...pdfDocumentMinimalListSelect,
    jsonData: true,
} as const;

const pdfDocumentMinimalWithStatsSelect = {
    ...pdfDocumentMinimalListSelect,
    jsonData: true,
} as const;

async function runListAndCount<T>(queries: {
    list: () => Promise<T[]>;
    count: () => Promise<number>;
}): Promise<[T[], number]> {
    if (PRISMA_SAFE_CONNECTION_LIMIT <= 6) {
        const records = await queries.list();
        const total = await queries.count();
        return [records, total];
    }

    return Promise.all([queries.list(), queries.count()]);
}

function getCacheValue<T>(cache: Map<string, CacheEntry<T>>, key: string): T | null {
    const entry = cache.get(key);
    if (!entry) return null;
    if (entry.expiresAt <= Date.now()) {
        cache.delete(key);
        return null;
    }
    return entry.value;
}

function setCacheValue<T>(
    cache: Map<string, CacheEntry<T>>,
    key: string,
    value: T,
    ttlMs: number
): T {
    cache.set(key, {
        value,
        expiresAt: Date.now() + ttlMs,
    });
    return value;
}

function buildCacheKey(parts: unknown[]): string {
    return JSON.stringify(parts);
}

export function invalidatePdfDocumentCaches() {
    documentListCache.clear();
    documentDetailCache.clear();
    documentStatsCache.clear();
}

async function ensureAssignedUserIdsBackfilled() {
    if (assignmentBackfillPromise) {
        await assignmentBackfillPromise;
        return;
    }

    if (assignmentBackfillCheckedAt && Date.now() - assignmentBackfillCheckedAt < ASSIGNMENT_BACKFILL_CHECK_TTL_MS) {
        return;
    }

    assignmentBackfillPromise = (async () => {
        assignmentBackfillCheckedAt = Date.now();

        const staleDocuments = await withDatabaseFallback(
            () =>
                prisma.pdfDocument.findMany({
                    where: {
                        assignedUserIds: {
                            isEmpty: true,
                        },
                    },
                    select: {
                        id: true,
                        jsonData: true,
                    },
                    take: 500,
                }),
            () => []
        );

        const updates = staleDocuments
            .map((document) => ({
                id: document.id,
                assignedUserIds: resolveAssignedUserIds(document.jsonData),
            }))
            .filter((document) => document.assignedUserIds.length > 0);

        if (updates.length === 0) {
            return;
        }

        if (PRISMA_SAFE_CONNECTION_LIMIT <= 6) {
            for (const document of updates) {
                await prisma.pdfDocument.update({
                    where: { id: document.id },
                    data: { assignedUserIds: document.assignedUserIds },
                });
            }
        } else {
            await Promise.all(
                updates.map((document) =>
                    prisma.pdfDocument.update({
                        where: { id: document.id },
                        data: { assignedUserIds: document.assignedUserIds },
                    })
                )
            );
        }

        invalidatePdfDocumentCaches();
    })()
        .catch((error) => {
            assignmentBackfillCheckedAt = 0;
            console.warn("[pdf-document-service] Failed to backfill assignedUserIds", error);
        })
        .finally(() => {
            assignmentBackfillPromise = null;
        });

    await assignmentBackfillPromise;
}

function withPendingRequest<T>(
    pendingMap: Map<string, Promise<T>>,
    key: string,
    operation: () => Promise<T>
): Promise<T> {
    const existing = pendingMap.get(key);
    if (existing) {
        return existing;
    }

    const requestPromise = operation().finally(() => {
        if (pendingMap.get(key) === requestPromise) {
            pendingMap.delete(key);
        }
    });

    pendingMap.set(key, requestPromise);
    return requestPromise;
}

function sortObjectKeys(value: unknown): unknown {
    if (Array.isArray(value)) {
        return value.map(sortObjectKeys);
    }

    if (value && typeof value === "object") {
        return Object.fromEntries(
            Object.entries(value as Record<string, unknown>)
                .filter(([key]) => key !== "_meta" && key !== "documentId")
                .sort(([left], [right]) => left.localeCompare(right))
                .map(([key, nestedValue]) => [key, sortObjectKeys(nestedValue)])
        );
    }

    return value;
}

export function buildWorkspacePayloadHash(payload: Record<string, unknown>): string {
    return crypto.createHash("sha256").update(JSON.stringify(sortObjectKeys(payload))).digest("hex");
}

export function readStoredContentHash(jsonData: unknown): string | null {
    if (!jsonData || typeof jsonData !== "object") return null;
    const meta = (jsonData as Record<string, unknown>)._meta;
    if (!meta || typeof meta !== "object") return null;
    const contentHash = (meta as Record<string, unknown>).contentHash;
    return typeof contentHash === "string" && contentHash.trim() ? contentHash : null;
}

export function normalizeDocumentSort(
    sortByRaw: unknown,
    sortOrderRaw: unknown
): { sortBy: DocumentSortField; sortOrder: DocumentSortDirection } {
    const sortByCandidate = String(sortByRaw ?? "createdAt").trim();
    const sortOrderCandidate = String(sortOrderRaw ?? "desc").trim().toLowerCase();

    const allowedSortBy: DocumentSortField[] = ["createdAt", "updatedAt", "title", "subject", "date"];
    const sortBy = allowedSortBy.includes(sortByCandidate as DocumentSortField)
        ? (sortByCandidate as DocumentSortField)
        : "createdAt";
    const sortOrder: DocumentSortDirection = sortOrderCandidate === "asc" ? "asc" : "desc";

    return { sortBy, sortOrder };
}

export function normalizePagination(
    limitRaw: unknown,
    offsetRaw: unknown
): { limit: number; offset: number } {
    const parsedLimit = Number.parseInt(String(limitRaw ?? "50"), 10);
    const parsedOffset = Number.parseInt(String(offsetRaw ?? "0"), 10);

    const limit = Number.isFinite(parsedLimit) ? Math.min(Math.max(parsedLimit, 1), 200) : 50;
    const offset = Number.isFinite(parsedOffset) ? Math.max(parsedOffset, 0) : 0;
    return { limit, offset };
}

export function buildPdfContentHash(input: NormalizedPdfInput): string {
    const hashable = {
        title: input.title,
        subject: input.subject,
        date: input.date,
        instituteName: input.instituteName,
        templateId: input.templateId,
        customTemplate: input.customTemplate,
        optionDisplayOrder: input.optionDisplayOrder,
        previewResolution: input.previewResolution,
        questions: input.questions,
        sourceImages: input.sourceImages,
    };

    return crypto.createHash("sha256").update(JSON.stringify(hashable)).digest("hex");
}

type PersistOptions = {
    rawPayload: Record<string, unknown>;
    documentId?: string | null;
    organizationId: string | null;
    userId: string;
};

export async function persistPdfDocument(
    input: NormalizedPdfInput,
    options: PersistOptions
): Promise<PdfDocument> {
    const contentHash = buildPdfContentHash(input);
    const nextAssignedUserIds = resolveAssignedUserIds(options.rawPayload);
    let jsonData: Prisma.JsonObject = {
        ...options.rawPayload,
        title: input.title,
        subject: input.subject,
        date: input.date,
        instituteName: input.instituteName,
        templateId: input.templateId,
        customTemplate: input.customTemplate
            ? (input.customTemplate as unknown as Prisma.JsonObject)
            : null,
        optionDisplayOrder: input.optionDisplayOrder,
        previewResolution: input.previewResolution,
        questions: input.questions as unknown as Prisma.JsonArray,
        sourceImages: (input.sourceImages || []) as unknown as Prisma.JsonArray,
        _meta: {
            schemaVersion: 2,
            contentHash,
            normalizedAt: new Date().toISOString(),
        },
    };
    return withDatabaseFallback(
        async () => {
            if (options.documentId && !options.documentId.startsWith("offline_")) {
                try {
                    const existing = await prisma.pdfDocument.findUnique({
                        where: { id: options.documentId },
                        select: {
                            id: true,
                            organizationId: true,
                            userId: true,
                            title: true,
                            subject: true,
                            date: true,
                            jsonData: true,
                            assignedUserIds: true,
                            createdAt: true,
                            updatedAt: true,
                        },
                    });
                    if (existing && existing.organizationId !== options.organizationId) {
                        throw new Error("Unauthorized access to document");
                    }
                    if (existing && existing.userId && existing.userId !== options.userId) {
                        // For safety, only the creator defaults to being able to overwrite it, though admins might try
                        // Let's enforce that you can only overwrite your own document unless you want admins to overwrite members' docs.
                    }
                    if (existing) {
                        const existingAssignments = resolveAssignedUserIds(
                            existing.jsonData,
                            (existing as { assignedUserIds?: unknown }).assignedUserIds
                        );
                        const existingHash = readStoredContentHash(existing.jsonData);
                        if (
                            existingHash === contentHash &&
                            existing.title === input.title &&
                            existing.subject === input.subject &&
                            existing.date === input.date
                        ) {
                            return existing as PdfDocument;
                        }
                        if (existingAssignments.length > 0) {
                            jsonData = withAssignedUserIds(jsonData, existingAssignments) as Prisma.JsonObject;
                        }
                    }
                    const record = await prisma.pdfDocument.update({
                        where: { id: options.documentId },
                        data: {
                            title: input.title,
                            subject: input.subject,
                            date: input.date,
                            jsonData,
                            assignedUserIds:
                                resolveAssignedUserIds(jsonData, nextAssignedUserIds),
                        },
                    });
                    invalidatePdfDocumentCaches();
                    return record;
                } catch (error) {
                    if (
                        error instanceof Prisma.PrismaClientKnownRequestError &&
                        error.code === "P2025"
                    ) {
                        // If requested document id is missing on DB, promote it to create flow.
                    } else {
                        throw error;
                    }
                }
            }

            const record = await prisma.pdfDocument.create({
                data: {
                    title: input.title,
                    subject: input.subject,
                    date: input.date,
                    jsonData,
                    assignedUserIds: resolveAssignedUserIds(jsonData, nextAssignedUserIds),
                    organizationId: options.organizationId,
                    userId: options.userId,
                },
            });
            invalidatePdfDocumentCaches();
            return record;
        },
        () =>
            upsertOfflinePdfDocument({
                title: input.title,
                subject: input.subject,
                date: input.date,
                jsonData,
                documentId: options.documentId,
            })
    );
}

export async function listPdfDocuments(
    options: DocumentListOptions
): Promise<PdfDocumentListResult> {
    const shouldAwaitAssignmentBackfill =
        options.role === "MEMBER" ||
        Boolean(String(options.assigneeFilter || "").trim());

    if (shouldAwaitAssignmentBackfill) {
        await ensureAssignedUserIdsBackfilled();
    } else {
        void ensureAssignedUserIdsBackfilled();
    }

    const cacheKey = buildCacheKey(["list", options]);
    const cached = getCacheValue(documentListCache, cacheKey);
    if (cached) return cached;

    const isMember = options.role === "MEMBER";
    const isSystemAdmin = options.role === "SYSTEM_ADMIN";
    const orderBy =
        options.sortBy === "createdAt"
            ? [{ createdAt: options.sortOrder }]
            : [{ [options.sortBy]: options.sortOrder }, { createdAt: "desc" as const }];
    const trimmedSearchQuery = String(options.searchQuery || "").trim();
    const trimmedAssigneeFilter = String(options.assigneeFilter || "").trim();
    const whereClauses: Prisma.PdfDocumentWhereInput[] = [];

    if (!isSystemAdmin) {
        whereClauses.push({
            organizationId: options.organizationId || null,
        });
    }

    if (isMember) {
        whereClauses.push({
            assignedUserIds: {
                has: options.userId,
            },
        });
    }

    if (trimmedAssigneeFilter === "unassigned") {
        whereClauses.push({
            assignedUserIds: {
                isEmpty: true,
            },
        });
    } else if (trimmedAssigneeFilter) {
        whereClauses.push({
            assignedUserIds: {
                has: trimmedAssigneeFilter,
            },
        });
    }

    if (trimmedSearchQuery) {
        whereClauses.push({
            OR: [
                {
                    title: {
                        contains: trimmedSearchQuery,
                        mode: "insensitive",
                    },
                },
                {
                    subject: {
                        contains: trimmedSearchQuery,
                        mode: "insensitive",
                    },
                },
                {
                    date: {
                        contains: trimmedSearchQuery,
                        mode: "insensitive",
                    },
                },
            ],
        });
    }

    const where =
        whereClauses.length === 0
            ? {}
            : whereClauses.length === 1
                ? whereClauses[0]
                : { AND: whereClauses };
    const select = options.minimal
        ? options.includeWorkspaceStats
            ? pdfDocumentMinimalWithStatsSelect
            : pdfDocumentMinimalListSelect
        : pdfDocumentFullListSelect;

    if (!isMember) {
        return withPendingRequest(documentListPending, cacheKey, () =>
            withDatabaseFallback(
                async () => {
                    const [records, total] = await runListAndCount({
                        list: () => prisma.pdfDocument.findMany({
                            where,
                            orderBy,
                            take: options.limit,
                            skip: options.offset,
                            select,
                        }),
                        count: () => prisma.pdfDocument.count({ where }),
                    });
                    const normalized = records.map((record) => ({
                        ...record,
                        assignedUserIds: resolveAssignedUserIds(
                            "jsonData" in record ? record.jsonData : undefined,
                            record.assignedUserIds
                        ),
                    }));
                    return setCacheValue(
                        documentListCache,
                        cacheKey,
                        { documents: normalized, total },
                        DOCUMENT_LIST_CACHE_TTL_MS
                    );
                },
                async () => {
                    const fallbackRecords = await listOfflinePdfDocuments({
                        limit: options.limit,
                        offset: options.offset,
                        sortBy: options.sortBy,
                        sortOrder: options.sortOrder,
                        searchQuery: trimmedSearchQuery,
                        assigneeFilter: trimmedAssigneeFilter || null,
                    });
                    const total = (
                        await listOfflinePdfDocuments({
                            limit: 100_000,
                            offset: 0,
                            sortBy: options.sortBy,
                            sortOrder: options.sortOrder,
                            searchQuery: trimmedSearchQuery,
                            assigneeFilter: trimmedAssigneeFilter || null,
                        })
                    ).length;
                    return { documents: fallbackRecords, total };
                }
            )
        );
    }

    return withPendingRequest(documentListPending, cacheKey, () =>
        withDatabaseFallback(
            async () => {
                const [memberRecords, total] = await runListAndCount({
                    list: () => prisma.pdfDocument.findMany({
                        where,
                        orderBy,
                        take: options.limit,
                        skip: options.offset,
                        select,
                    }),
                    count: () => prisma.pdfDocument.count({ where }),
                });

                const normalized = memberRecords.map((record) => ({
                    ...record,
                    assignedUserIds: resolveAssignedUserIds(
                        "jsonData" in record ? record.jsonData : undefined,
                        record.assignedUserIds
                    ),
                }));
                return setCacheValue(
                    documentListCache,
                    cacheKey,
                    { documents: normalized, total },
                    DOCUMENT_LIST_CACHE_TTL_MS
                );
            },
            async () => {
                const fallbackRecords = await listOfflinePdfDocuments({
                    limit: options.limit,
                    offset: options.offset,
                    sortBy: options.sortBy,
                    sortOrder: options.sortOrder,
                    searchQuery: trimmedSearchQuery,
                    assigneeFilter: trimmedAssigneeFilter || null,
                });
                const total = (
                    await listOfflinePdfDocuments({
                        limit: 100_000,
                        offset: 0,
                        sortBy: options.sortBy,
                        sortOrder: options.sortOrder,
                        searchQuery: trimmedSearchQuery,
                        assigneeFilter: trimmedAssigneeFilter || null,
                    })
                ).length;
                return { documents: fallbackRecords, total };
            }
        )
    );
}

export async function getPdfDocumentById(id: string, organizationId: string | null, userId: string, role: string) {
    await ensureAssignedUserIdsBackfilled();

    const cacheKey = buildCacheKey(["doc", id, organizationId, userId, role]);
    const cached = getCacheValue(documentDetailCache, cacheKey);
    if (cached !== null) return cached;

    return withPendingRequest(documentDetailPending, cacheKey, () =>
        withDatabaseFallback(
            async () => {
                const doc = await prisma.pdfDocument.findFirst({
                    where: {
                        id,
                        ...(role === "SYSTEM_ADMIN" ? {} : { organizationId: organizationId || null }),
                        ...(role === "MEMBER"
                            ? {
                                assignedUserIds: {
                                    has: userId,
                                },
                            }
                            : {}),
                    },
                });
                return setCacheValue(
                    documentDetailCache,
                    cacheKey,
                    doc,
                    DOCUMENT_DETAIL_CACHE_TTL_MS
                );
            },
            () => getOfflinePdfDocumentById(id)
        )
    );
}

export async function deletePdfDocumentById(id: string, organizationId: string | null, userId: string, role: string) {
    return withDatabaseFallback(
        async () => {
            const doc = await prisma.pdfDocument.findUnique({ where: { id } });
            if (!doc) throw new Error("Not found or unauthorized");
            if (role !== "SYSTEM_ADMIN" && doc.organizationId !== organizationId) {
                throw new Error("Not found or unauthorized");
            }
            if (role === "MEMBER") {
                throw new Error("Not authorized to delete this document");
            }
            const deleted = await prisma.pdfDocument.delete({
                where: { id },
            });
            invalidatePdfDocumentCaches();
            return deleted;
        },
        async () => {
            const deleted = await deleteOfflinePdfDocumentById(id);
            if (!deleted) {
                throw new Error("Document not found");
            }

            const now = new Date();
            return {
                id,
                title: "Deleted document",
                subject: "Deleted document",
                date: now.toLocaleDateString("en-GB"),
                jsonData: {},
                assignedUserIds: [],
                createdAt: now,
                updatedAt: now,
                organizationId: null,
                userId: null,
            } satisfies PdfDocument;
        }
    );
}

export async function updatePdfDocumentAssignments(
    id: string,
    organizationId: string | null,
    role: string,
    assignedUserIds: string[]
) {
    if (role !== "ORG_ADMIN" && role !== "SYSTEM_ADMIN") {
        throw new Error("Not authorized to assign this document");
    }

    const normalizedIds = normalizeAssignedUserIds(assignedUserIds);

    return withDatabaseFallback(
        async () => {
            const doc = await prisma.pdfDocument.findUnique({ where: { id } });
            if (!doc) throw new Error("Document not found");
            if (role !== "SYSTEM_ADMIN" && doc.organizationId !== organizationId) {
                throw new Error("Not found or unauthorized");
            }

            if (normalizedIds.length > 0) {
                const users = await prisma.user.findMany({
                    where: {
                        id: { in: normalizedIds },
                        ...(doc.organizationId ? { organizationId: doc.organizationId } : {}),
                        role: "MEMBER",
                    },
                    select: { id: true },
                });
                const validIds = new Set(users.map((user) => user.id));
                const invalidIds = normalizedIds.filter((item) => !validIds.has(item));
                if (invalidIds.length > 0) {
                    throw new Error("Some selected members are invalid for this document organization.");
                }
            }

            const nextJsonData = withAssignedUserIds(doc.jsonData, normalizedIds);
            const updated = await prisma.pdfDocument.update({
                where: { id },
                data: {
                    jsonData: nextJsonData as Prisma.InputJsonValue,
                    assignedUserIds: normalizedIds,
                },
            });
            invalidatePdfDocumentCaches();
            return updated;
        },
        () => {
            throw new Error("Document assignment is unavailable while database is offline.");
        }
    );
}

export async function getPdfDashboardStats(
    organizationId: string | null,
    role: string = "MEMBER",
    userId?: string
) {
    await ensureAssignedUserIdsBackfilled();

    const cacheKey = buildCacheKey(["stats", organizationId, role, userId]);
    const cached = getCacheValue(documentStatsCache, cacheKey);
    if (cached) return cached;

    return withPendingRequest(documentStatsPending, cacheKey, () =>
        withDatabaseFallback(
            async () => {
                const startOfToday = new Date();
                startOfToday.setHours(0, 0, 0, 0);
                const baseWhere = role === "SYSTEM_ADMIN" ? {} : { organizationId: organizationId || null };

                if (role === "MEMBER" && userId) {
                    const memberWhere = {
                        ...baseWhere,
                        assignedUserIds: {
                            has: userId,
                        },
                    };
                    const [totalDocs, todayDocs] = PRISMA_SAFE_CONNECTION_LIMIT <= 6
                        ? [
                            await prisma.pdfDocument.count({ where: memberWhere }),
                            await prisma.pdfDocument.count({
                                where: {
                                    ...memberWhere,
                                    createdAt: {
                                        gte: startOfToday,
                                    },
                                },
                            }),
                        ]
                        : await Promise.all([
                            prisma.pdfDocument.count({ where: memberWhere }),
                            prisma.pdfDocument.count({
                                where: {
                                    ...memberWhere,
                                    createdAt: {
                                        gte: startOfToday,
                                    },
                                },
                            }),
                        ]);
                    return setCacheValue(
                        documentStatsCache,
                        cacheKey,
                        { totalDocs, todayDocs },
                        DOCUMENT_STATS_CACHE_TTL_MS
                    );
                }

                const [totalDocs, todayDocs] = PRISMA_SAFE_CONNECTION_LIMIT <= 6
                    ? [
                        await prisma.pdfDocument.count({ where: baseWhere }),
                        await prisma.pdfDocument.count({
                            where: {
                                ...baseWhere,
                                createdAt: {
                                    gte: startOfToday,
                                },
                            },
                        }),
                    ]
                    : await Promise.all([
                        prisma.pdfDocument.count({ where: baseWhere }),
                        prisma.pdfDocument.count({
                            where: {
                                ...baseWhere,
                                createdAt: {
                                    gte: startOfToday,
                                },
                            },
                        }),
                    ]);

                return setCacheValue(
                    documentStatsCache,
                    cacheKey,
                    { totalDocs, todayDocs },
                    DOCUMENT_STATS_CACHE_TTL_MS
                );
            },
            () => getOfflinePdfStats()
        )
    );
}
