export function normalizeAssignedUserIds(assignedUserIds: unknown): string[] {
    if (!Array.isArray(assignedUserIds)) return [];
    return Array.from(
        new Set(
            assignedUserIds
                .map((item) => String(item || "").trim())
                .filter(Boolean)
        )
    );
}

export function extractAssignedUserIds(jsonData: unknown): string[] {
    if (!jsonData || typeof jsonData !== "object") return [];
    const payload = jsonData as Record<string, unknown>;
    if (!payload._access || typeof payload._access !== "object") return [];
    const access = payload._access as Record<string, unknown>;
    return normalizeAssignedUserIds(access.assignedUserIds);
}

export function resolveAssignedUserIds(
    jsonData: unknown,
    assignedUserIds?: unknown
): string[] {
    const normalizedAssignedUserIds = normalizeAssignedUserIds(assignedUserIds);
    return normalizedAssignedUserIds.length > 0
        ? normalizedAssignedUserIds
        : extractAssignedUserIds(jsonData);
}

export function withAssignedUserIds(
    jsonData: unknown,
    assignedUserIds: string[]
): Record<string, unknown> {
    const payload =
        jsonData && typeof jsonData === "object"
            ? ({ ...(jsonData as Record<string, unknown>) } as Record<string, unknown>)
            : {};
    const access =
        payload._access && typeof payload._access === "object"
            ? ({ ...(payload._access as Record<string, unknown>) } as Record<string, unknown>)
            : {};

    access.assignedUserIds = normalizeAssignedUserIds(assignedUserIds);
    access.assignedAt = new Date().toISOString();

    payload._access = access;
    return payload;
}

export function extractCorrectionMarkCount(jsonData: unknown): number {
    if (!jsonData || typeof jsonData !== "object") return 0;
    const payload = jsonData as Record<string, unknown>;
    const marks = Array.isArray(payload.correctionMarks) ? payload.correctionMarks : [];
    return marks.length;
}
