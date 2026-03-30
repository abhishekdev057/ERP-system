import { NextRequest, NextResponse } from "next/server";
import { runPrismaWithReconnect } from "@/lib/prisma";
import { enforceToolAccess } from "@/lib/api-auth";

export const dynamic = "force-dynamic";

type StudentCreateResult = {
    student: unknown;
    duplicate: boolean;
    message?: string;
    statusCode: number;
};

const pendingLeadCreates =
    (globalThis as typeof globalThis & {
        __studentLeadCreates?: Map<string, Promise<StudentCreateResult>>;
    }).__studentLeadCreates ??
    new Map<string, Promise<StudentCreateResult>>();

if (!(globalThis as typeof globalThis & { __studentLeadCreates?: Map<string, Promise<StudentCreateResult>> }).__studentLeadCreates) {
    (globalThis as typeof globalThis & { __studentLeadCreates?: Map<string, Promise<StudentCreateResult>> }).__studentLeadCreates =
        pendingLeadCreates;
}

const studentsCache =
    (globalThis as typeof globalThis & {
        __studentsApiCache?: Map<string, { value: unknown; expiresAt: number }>;
    }).__studentsApiCache ?? new Map<string, { value: unknown; expiresAt: number }>();

if (!(globalThis as typeof globalThis & { __studentsApiCache?: Map<string, { value: unknown; expiresAt: number }> }).__studentsApiCache) {
    (globalThis as typeof globalThis & { __studentsApiCache?: Map<string, { value: unknown; expiresAt: number }> }).__studentsApiCache =
        studentsCache;
}

const pendingStudentListRequests =
    (globalThis as typeof globalThis & {
        __studentsApiPending?: Map<string, Promise<unknown>>;
    }).__studentsApiPending ?? new Map<string, Promise<unknown>>();

if (!(globalThis as typeof globalThis & { __studentsApiPending?: Map<string, Promise<unknown>> }).__studentsApiPending) {
    (globalThis as typeof globalThis & { __studentsApiPending?: Map<string, Promise<unknown>> }).__studentsApiPending =
        pendingStudentListRequests;
}

const STUDENTS_CACHE_TTL_MS = 10_000;

function invalidateStudentsCache(organizationId: string) {
    for (const key of Array.from(studentsCache.keys())) {
        if (key.startsWith(`${organizationId}::`)) {
            studentsCache.delete(key);
        }
    }
}

function cleanText(value: unknown) {
    return typeof value === "string" ? value.trim() : "";
}

function cleanPhone(value: unknown) {
    return cleanText(value).replace(/\s+/g, " ");
}

function cleanEmail(value: unknown) {
    return cleanText(value).toLowerCase();
}

function buildLeadCreateKey(input: {
    organizationId: string;
    name: string;
    phone: string;
    email: string;
    classLevel: string;
    location: string;
}) {
    return [
        input.organizationId,
        input.name.toLowerCase(),
        input.phone.toLowerCase(),
        input.email.toLowerCase(),
        input.classLevel.toLowerCase(),
        input.location.toLowerCase(),
    ].join("::");
}

export async function GET(request: NextRequest) {
    try {
        const auth = await enforceToolAccess("pdf-to-pdf");
        
        const { searchParams } = new URL(request.url);
        const status = searchParams.get("status");
        const cacheKey = `${auth.organizationId || "global"}::${status || "all"}`;
        const cached = studentsCache.get(cacheKey);
        if (cached && cached.expiresAt > Date.now()) {
            return NextResponse.json(cached.value);
        }

        const pending = pendingStudentListRequests.get(cacheKey);
        if (pending) {
            const students = await pending;
            return NextResponse.json(students);
        }

        const requestPromise = runPrismaWithReconnect((client) =>
            client.student.findMany({
                where: {
                    organizationId: auth.organizationId as string,
                    ...(status ? { status: status as any } : {}),
                },
                include: {
                    assignedUser: { select: { id: true, name: true, image: true, designation: true } },
                },
                orderBy: { createdAt: "desc" },
            })
        ).then((students) => {
            studentsCache.set(cacheKey, {
                value: students,
                expiresAt: Date.now() + STUDENTS_CACHE_TTL_MS,
            });
            return students;
        });

        pendingStudentListRequests.set(cacheKey, requestPromise);

        try {
            const students = await requestPromise;
            return NextResponse.json(students);
        } finally {
            if (pendingStudentListRequests.get(cacheKey) === requestPromise) {
                pendingStudentListRequests.delete(cacheKey);
            }
        }
    } catch (error: any) {
        if (error instanceof Response) return error;
        console.error("GET /api/students error:", error);
        return NextResponse.json({ error: "Failed to fetch students" }, { status: 500 });
    }
}

export async function POST(request: NextRequest) {
    try {
        const auth = await enforceToolAccess("pdf-to-pdf");
        const body = await request.json();

        const { name, phone, email, classLevel, location, leadConfidence, status, tags } = body;

        const normalizedName = cleanText(name);
        const normalizedPhone = cleanPhone(phone);
        const normalizedEmail = cleanEmail(email);
        const normalizedClassLevel = cleanText(classLevel);
        const normalizedLocation = cleanText(location);
        const normalizedStatus = status || "LEAD";

        if (!normalizedName) {
            return NextResponse.json({ error: "Student name is required" }, { status: 400 });
        }

        const duplicateClauses: Record<string, unknown>[] = [];
        const organizationId = auth.organizationId as string;

        if (normalizedPhone) {
            duplicateClauses.push({
                AND: [
                    { phone: { equals: normalizedPhone, mode: "insensitive" } },
                    { name: { equals: normalizedName, mode: "insensitive" } },
                ],
            });
        }

        if (normalizedEmail) {
            duplicateClauses.push({
                AND: [
                    { email: { equals: normalizedEmail, mode: "insensitive" } },
                    { name: { equals: normalizedName, mode: "insensitive" } },
                ],
            });
        }

        if (!normalizedPhone && !normalizedEmail && normalizedClassLevel && normalizedLocation) {
            duplicateClauses.push({
                AND: [
                    { name: { equals: normalizedName, mode: "insensitive" } },
                    { classLevel: { equals: normalizedClassLevel, mode: "insensitive" } },
                    { location: { equals: normalizedLocation, mode: "insensitive" } },
                ],
            });
        }

        const dedupeKey = buildLeadCreateKey({
            organizationId,
            name: normalizedName,
            phone: normalizedPhone,
            email: normalizedEmail,
            classLevel: normalizedClassLevel,
            location: normalizedLocation,
        });

        let createPromise = pendingLeadCreates.get(dedupeKey);

        if (!createPromise) {
            createPromise = (async () => {
                if (duplicateClauses.length) {
                    const existingStudent = await runPrismaWithReconnect((client) =>
                        client.student.findFirst({
                            where: {
                                organizationId,
                                OR: duplicateClauses,
                            },
                            include: {
                                assignedUser: { select: { id: true, name: true, image: true, designation: true } },
                            },
                            orderBy: { createdAt: "desc" },
                        })
                    );

                    if (existingStudent) {
                        return {
                            student: existingStudent,
                            duplicate: true,
                            message: "A lead with the same details already exists.",
                            statusCode: 200,
                        } satisfies StudentCreateResult;
                    }
                }

                const student = await runPrismaWithReconnect((client) =>
                    client.student.create({
                        data: {
                            name: normalizedName,
                            phone: normalizedPhone || null,
                            email: normalizedEmail || null,
                            classLevel: normalizedClassLevel || null,
                            location: normalizedLocation || null,
                            leadConfidence: leadConfidence || null,
                            status: normalizedStatus,
                            tags: Array.isArray(tags) ? tags : [],
                            organizationId,
                        },
                        include: {
                            assignedUser: { select: { id: true, name: true, image: true, designation: true } },
                        },
                    })
                );

                return {
                    student,
                    duplicate: false,
                    statusCode: 201,
                } satisfies StudentCreateResult;
            })();

            pendingLeadCreates.set(dedupeKey, createPromise);
        }

        try {
            const result = await createPromise;
            invalidateStudentsCache(organizationId);
            return NextResponse.json(
                {
                    student: result.student,
                    duplicate: result.duplicate,
                    message: result.message,
                },
                { status: result.statusCode }
            );
        } finally {
            if (pendingLeadCreates.get(dedupeKey) === createPromise) {
                pendingLeadCreates.delete(dedupeKey);
            }
        }
    } catch (error: any) {
        if (error instanceof Response) return error;
        console.error("POST /api/students error:", error);
        return NextResponse.json({ error: "Failed to create student" }, { status: 500 });
    }
}
