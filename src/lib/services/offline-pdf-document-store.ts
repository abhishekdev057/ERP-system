import crypto from "crypto";
import { promises as fs } from "fs";
import path from "path";
import { PdfDocument, Prisma } from "@prisma/client";

type ListOptions = {
    limit: number;
    offset: number;
};

type OfflinePdfDocumentRecord = {
    id: string;
    title: string;
    subject: string;
    date: string;
    jsonData: Prisma.JsonValue;
    createdAt: string;
    updatedAt: string;
};

const OFFLINE_STORE_DIR = path.join(process.cwd(), ".nacc-cache");
const OFFLINE_STORE_FILE = path.join(OFFLINE_STORE_DIR, "offline-pdf-documents.json");

async function ensureStoreDir() {
    await fs.mkdir(OFFLINE_STORE_DIR, { recursive: true });
}

async function readRecords(): Promise<OfflinePdfDocumentRecord[]> {
    try {
        const raw = await fs.readFile(OFFLINE_STORE_FILE, "utf-8");
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) return [];
        return parsed.filter((item) => item && typeof item === "object") as OfflinePdfDocumentRecord[];
    } catch (error: any) {
        if (error?.code === "ENOENT") return [];
        throw error;
    }
}

async function writeRecords(records: OfflinePdfDocumentRecord[]) {
    await ensureStoreDir();
    await fs.writeFile(OFFLINE_STORE_FILE, JSON.stringify(records, null, 2), "utf-8");
}

function toPdfDocument(record: OfflinePdfDocumentRecord): PdfDocument {
    return {
        id: record.id,
        title: record.title,
        subject: record.subject,
        date: record.date,
        jsonData: record.jsonData,
        createdAt: new Date(record.createdAt),
        updatedAt: new Date(record.updatedAt),
    };
}

export async function upsertOfflinePdfDocument(input: {
    title: string;
    subject: string;
    date: string;
    jsonData: Prisma.JsonObject;
    documentId?: string | null;
}): Promise<PdfDocument> {
    const records = await readRecords();
    const now = new Date().toISOString();
    const existingIndex = input.documentId
        ? records.findIndex((item) => item.id === input.documentId)
        : -1;

    if (existingIndex >= 0) {
        const current = records[existingIndex];
        const updated: OfflinePdfDocumentRecord = {
            ...current,
            title: input.title,
            subject: input.subject,
            date: input.date,
            jsonData: input.jsonData,
            updatedAt: now,
        };
        records[existingIndex] = updated;
        await writeRecords(records);
        return toPdfDocument(updated);
    }

    const created: OfflinePdfDocumentRecord = {
        id: input.documentId?.trim() || `offline_${crypto.randomUUID()}`,
        title: input.title,
        subject: input.subject,
        date: input.date,
        jsonData: input.jsonData,
        createdAt: now,
        updatedAt: now,
    };
    records.unshift(created);
    await writeRecords(records);
    return toPdfDocument(created);
}

export async function listOfflinePdfDocuments(options: ListOptions): Promise<PdfDocument[]> {
    const records = await readRecords();
    const sorted = [...records].sort((a, b) => {
        return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });

    return sorted
        .slice(options.offset, options.offset + options.limit)
        .map(toPdfDocument);
}

export async function getOfflinePdfDocumentById(id: string): Promise<PdfDocument | null> {
    const records = await readRecords();
    const item = records.find((record) => record.id === id);
    return item ? toPdfDocument(item) : null;
}

export async function deleteOfflinePdfDocumentById(id: string): Promise<boolean> {
    const records = await readRecords();
    const next = records.filter((record) => record.id !== id);
    if (next.length === records.length) return false;
    await writeRecords(next);
    return true;
}

export async function getOfflinePdfStats() {
    const records = await readRecords();
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);

    const todayDocs = records.filter(
        (record) => new Date(record.createdAt).getTime() >= startOfToday.getTime()
    ).length;

    return {
        totalDocs: records.length,
        todayDocs,
    };
}
