function cleanText(value: unknown): string {
    return typeof value === "string" ? value.trim() : "";
}

export function cleanStudentText(value: unknown): string | null {
    const normalized = cleanText(value);
    return normalized || null;
}

export function cleanStudentPhone(value: unknown): string | null {
    const normalized = cleanText(value).replace(/\s+/g, " ");
    return normalized || null;
}

export function cleanStudentEmail(value: unknown): string | null {
    const normalized = cleanText(value).toLowerCase();
    return normalized || null;
}

export function cleanStudentCode(value: unknown): string | null {
    const normalized = cleanText(value)
        .replace(/[^a-z0-9/-]+/gi, "-")
        .replace(/-+/g, "-")
        .replace(/^-|-$/g, "")
        .toUpperCase();
    return normalized || null;
}

export function cleanStudentUrl(value: unknown): string | null {
    const normalized = cleanText(value);
    if (!normalized) return null;
    if (normalized.startsWith("/")) return normalized;

    try {
        const parsed = new URL(normalized);
        if (parsed.protocol === "http:" || parsed.protocol === "https:") {
            return normalized;
        }
    } catch {
        return null;
    }

    return null;
}

export function cleanStudentStringArray(value: unknown): string[] {
    if (!Array.isArray(value)) return [];

    return value
        .map((item) => cleanText(item))
        .filter(Boolean)
        .slice(0, 24);
}

export function parseStudentDate(value: unknown): Date | null {
    const normalized = cleanText(value);
    if (!normalized) return null;

    const parsed = new Date(normalized);
    if (Number.isNaN(parsed.getTime())) return null;
    return parsed;
}

export function parseStudentMoney(value: unknown): number | null {
    if (typeof value === "number" && Number.isFinite(value)) {
        return Math.max(0, Math.round(value));
    }

    const normalized = cleanText(value).replace(/,/g, "");
    if (!normalized) return null;

    const parsed = Number(normalized);
    if (!Number.isFinite(parsed)) return null;
    return Math.max(0, Math.round(parsed));
}

export function normalizeStudentGender(value: unknown): string | null {
    const normalized = cleanText(value);
    if (!normalized) return null;

    const compact = normalized.toLowerCase();
    if (compact === "male") return "Male";
    if (compact === "female") return "Female";
    if (compact === "other") return "Other";
    if (compact === "prefer_not_to_say" || compact === "prefer not to say") {
        return "Prefer not to say";
    }

    return normalized;
}
