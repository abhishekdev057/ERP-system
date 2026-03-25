import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { invalidatePdfDocumentCaches } from "@/lib/services/pdf-document-service";
import { upsertOfflinePdfDocument } from "@/lib/services/offline-pdf-document-store";

export type YouTubePollHistoryEntry = {
    candidateId: string;
    questionNumber?: string;
    questionText: string;
    optionTexts: string[];
    pollId?: string;
    startedAt: string;
    endedAt?: string;
};

type YouTubePollBroadcastHistory = {
    updatedAt: string;
    candidates: Record<string, YouTubePollHistoryEntry>;
};

type YouTubePollHistoryState = {
    version: 1;
    broadcasts: Record<string, YouTubePollBroadcastHistory>;
};

type PersistableDocument = {
    id: string;
    title: string;
    subject: string;
    date: string;
    jsonData: unknown;
};

function asJsonObject(value: unknown): Prisma.JsonObject {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        return {} as Prisma.JsonObject;
    }
    return value as Prisma.JsonObject;
}

function readHistoryState(jsonData: unknown): YouTubePollHistoryState {
    const payload = asJsonObject(jsonData);
    const meta = asJsonObject(payload._meta);
    const raw = meta.youtubePollHistory;

    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
        return {
            version: 1,
            broadcasts: {},
        };
    }

    const parsed = raw as Partial<YouTubePollHistoryState>;
    if (parsed.version !== 1 || !parsed.broadcasts || typeof parsed.broadcasts !== "object") {
        return {
            version: 1,
            broadcasts: {},
        };
    }

    return {
        version: 1,
        broadcasts: parsed.broadcasts as Record<string, YouTubePollBroadcastHistory>,
    };
}

export function getYouTubePollHistoryForBroadcast(
    jsonData: unknown,
    broadcastId: string | null | undefined
): Record<string, YouTubePollHistoryEntry> {
    const key = String(broadcastId || "").trim();
    if (!key) return {};

    const state = readHistoryState(jsonData);
    const broadcast = state.broadcasts[key];
    if (!broadcast || typeof broadcast !== "object") return {};
    return broadcast.candidates || {};
}

export function getCompletedYouTubePollCandidateIds(
    jsonData: unknown,
    broadcastId: string | null | undefined
): string[] {
    return Object.keys(getYouTubePollHistoryForBroadcast(jsonData, broadcastId));
}

export function withStartedYouTubePollHistory(
    jsonData: unknown,
    options: {
        broadcastId: string;
        candidateId: string;
        questionNumber?: string;
        questionText: string;
        optionTexts: string[];
        pollId?: string;
        startedAt?: string;
    }
): Prisma.JsonObject {
    const broadcastId = String(options.broadcastId || "").trim();
    const candidateId = String(options.candidateId || "").trim();

    if (!broadcastId || !candidateId) {
        return asJsonObject(jsonData);
    }

    const base = asJsonObject(jsonData);
    const meta = asJsonObject(base._meta);
    const state = readHistoryState(jsonData);
    const now = options.startedAt || new Date().toISOString();
    const previousBroadcast = state.broadcasts[broadcastId];
    const previousCandidates = previousBroadcast?.candidates || {};
    const previousEntry = previousCandidates[candidateId];

    const nextEntry: YouTubePollHistoryEntry = {
        candidateId,
        questionNumber: options.questionNumber || previousEntry?.questionNumber,
        questionText: options.questionText,
        optionTexts: options.optionTexts.map((item) => String(item || "").trim()).filter(Boolean),
        pollId: options.pollId || previousEntry?.pollId,
        startedAt: previousEntry?.startedAt || now,
        endedAt: previousEntry?.endedAt,
    };

    return {
        ...base,
        _meta: {
            ...meta,
            youtubePollHistory: {
                ...state,
                broadcasts: {
                    ...state.broadcasts,
                    [broadcastId]: {
                        updatedAt: now,
                        candidates: {
                            ...previousCandidates,
                            [candidateId]: nextEntry,
                        },
                    },
                },
            } as unknown as Prisma.JsonObject,
        },
    };
}

export function withEndedYouTubePollHistory(
    jsonData: unknown,
    options: {
        broadcastId: string;
        candidateId?: string;
        pollId?: string;
        endedAt?: string;
    }
): Prisma.JsonObject {
    const broadcastId = String(options.broadcastId || "").trim();
    if (!broadcastId) {
        return asJsonObject(jsonData);
    }

    const base = asJsonObject(jsonData);
    const meta = asJsonObject(base._meta);
    const state = readHistoryState(jsonData);
    const broadcast = state.broadcasts[broadcastId];
    if (!broadcast) {
        return base;
    }

    const candidates = { ...broadcast.candidates };
    const requestedCandidateId = String(options.candidateId || "").trim();
    const pollId = String(options.pollId || "").trim();
    const matchedCandidateId =
        requestedCandidateId ||
        Object.values(candidates).find((entry) => entry.pollId && entry.pollId === pollId)?.candidateId;

    if (!matchedCandidateId || !candidates[matchedCandidateId]) {
        return base;
    }

    const endedAt = options.endedAt || new Date().toISOString();
    candidates[matchedCandidateId] = {
        ...candidates[matchedCandidateId],
        endedAt,
        pollId: pollId || candidates[matchedCandidateId].pollId,
    };

    return {
        ...base,
        _meta: {
            ...meta,
            youtubePollHistory: {
                ...state,
                broadcasts: {
                    ...state.broadcasts,
                    [broadcastId]: {
                        ...broadcast,
                        updatedAt: endedAt,
                        candidates,
                    },
                },
            } as unknown as Prisma.JsonObject,
        },
    };
}

export async function persistYouTubePollDocumentJson(
    document: PersistableDocument,
    nextJsonData: Prisma.JsonObject
) {
    if (String(document.id || "").startsWith("offline_")) {
        await upsertOfflinePdfDocument({
            documentId: document.id,
            title: document.title,
            subject: document.subject,
            date: document.date,
            jsonData: nextJsonData,
        });
        return;
    }

    await prisma.pdfDocument.update({
        where: { id: document.id },
        data: {
            jsonData: nextJsonData,
        },
    });
    invalidatePdfDocumentCaches();
}
