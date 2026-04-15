import { randomBytes } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { runPrismaWithReconnect } from "@/lib/prisma";
import { enforceToolAccess } from "@/lib/api-auth";
import { scheduleKnowledgeIndexRefresh } from "@/lib/knowledge-index";
import {
    cleanStudentCode,
    cleanStudentEmail,
    cleanStudentPhone,
    cleanStudentStringArray,
    cleanStudentText,
    cleanStudentUrl,
    normalizeStudentGender,
    parseStudentDate,
    parseStudentMoney,
} from "@/lib/student-profile";

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
const STUDENT_STATUS_VALUES = ["LEAD", "ACTIVE", "ALUMNI", "DROPOUT"] as const;
const LEAD_CONFIDENCE_VALUES = ["COLD", "WARM", "HOT"] as const;

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

function cleanTags(value: unknown) {
    if (Array.isArray(value)) {
        return value
            .map((item) => cleanText(item))
            .filter(Boolean)
            .slice(0, 24);
    }

    if (typeof value === "string") {
        return value
            .split(",")
            .map((item) => item.trim())
            .filter(Boolean)
            .slice(0, 24);
    }

    return [];
}

function normalizeStudentPayload(body: Record<string, unknown>) {
    const rawStatus = cleanText(body.status);
    const rawLeadConfidence = cleanText(body.leadConfidence);

    return {
        name: cleanText(body.name),
        studentCode: cleanStudentCode(body.studentCode),
        guardianName: cleanStudentText(body.guardianName),
        dateOfBirth: parseStudentDate(body.dateOfBirth),
        gender: normalizeStudentGender(body.gender),
        phone: cleanStudentPhone(body.phone),
        parentPhone: cleanStudentPhone(body.parentPhone),
        email: cleanStudentEmail(body.email),
        addressLine: cleanStudentText(body.addressLine),
        pinCode: cleanStudentText(body.pinCode),
        aadhaarOrIdNumber: cleanStudentText(body.aadhaarOrIdNumber),
        idProofUrl: cleanStudentUrl(body.idProofUrl),
        photoUrl: cleanStudentUrl(body.photoUrl),
        galleryImageUrls: cleanStudentStringArray(body.galleryImageUrls),
        admissionDate: parseStudentDate(body.admissionDate),
        courseEnrolled: cleanStudentText(body.courseEnrolled),
        batchId: cleanStudentText(body.batchId),
        totalFees: parseStudentMoney(body.totalFees),
        status: (STUDENT_STATUS_VALUES.includes(rawStatus as (typeof STUDENT_STATUS_VALUES)[number]) ? rawStatus : "LEAD") as (typeof STUDENT_STATUS_VALUES)[number],
        leadConfidence: (LEAD_CONFIDENCE_VALUES.includes(rawLeadConfidence as (typeof LEAD_CONFIDENCE_VALUES)[number]) ? rawLeadConfidence : null) as (typeof LEAD_CONFIDENCE_VALUES)[number] | null,
        tags: cleanTags(body.tags),
        location: cleanText(body.location || body.addressLine) || "",
        classLevel: cleanText(body.classLevel),
    };
}

async function generateStudentCode(organizationId: string) {
    for (let attempt = 0; attempt < 6; attempt += 1) {
        const code = `STU-${new Date().getFullYear()}-${randomBytes(3).toString("hex").toUpperCase()}`;
        const existing = await runPrismaWithReconnect((client) =>
            client.student.findFirst({
                where: {
                    organizationId,
                    studentCode: code,
                },
                select: { id: true },
            })
        );

        if (!existing) {
            return code;
        }
    }

    return `STU-${Date.now()}`;
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

        const normalized = normalizeStudentPayload(body);
        const normalizedName = normalized.name;
        const normalizedPhone = normalized.phone || "";
        const normalizedEmail = normalized.email || "";
        const normalizedClassLevel = normalized.classLevel || "";
        const normalizedLocation = normalized.location || "";
        const normalizedStatus = normalized.status || "LEAD";

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

                const studentCode = normalized.studentCode || (await generateStudentCode(organizationId));
                const student = await runPrismaWithReconnect((client) =>
                    client.student.create({
                        data: {
                            name: normalizedName,
                            phone: normalizedPhone || null,
                            parentPhone: normalized.parentPhone,
                            email: normalizedEmail || null,
                            studentCode,
                            guardianName: normalized.guardianName,
                            dateOfBirth: normalized.dateOfBirth,
                            gender: normalized.gender,
                            addressLine: normalized.addressLine,
                            pinCode: normalized.pinCode,
                            aadhaarOrIdNumber: normalized.aadhaarOrIdNumber,
                            idProofUrl: normalized.idProofUrl,
                            photoUrl: normalized.photoUrl,
                            galleryImageUrls: normalized.galleryImageUrls,
                            admissionDate: normalized.admissionDate,
                            courseEnrolled: normalized.courseEnrolled,
                            batchId: normalized.batchId,
                            totalFees: normalized.totalFees,
                            classLevel: normalizedClassLevel || null,
                            location: normalizedLocation || null,
                            leadConfidence: normalized.leadConfidence as any,
                            status: normalizedStatus,
                            tags: normalized.tags,
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
            void scheduleKnowledgeIndexRefresh(organizationId).catch((error) => {
                console.error("Student create knowledge refresh failed:", error);
            });
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
