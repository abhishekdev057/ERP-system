import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/api-auth";
import {
    computeOrganizationProfileCompletion,
    normalizeOrganizationProfile,
} from "@/lib/organization-profile";

export const dynamic = "force-dynamic";

const organizationProfileSelect = {
    id: true,
    name: true,
    logo: true,
    orgType: true,
    tagline: true,
    description: true,
    city: true,
    location: true,
    website: true,
    contactEmail: true,
    contactPhone: true,
    primaryContactName: true,
    audienceSummary: true,
    boards: true,
    classLevels: true,
    subjects: true,
    languages: true,
    documentTypes: true,
    workflowNeeds: true,
    creativeNeeds: true,
    aiGoals: true,
    brandTone: true,
    notesForAI: true,
    _count: {
        select: {
            users: true,
            pdfDocuments: true,
            books: true,
        },
    },
} as const;

async function getOrganizationForAuth() {
    const auth = await requireSession();
    if (auth.role !== "ORG_ADMIN" && auth.role !== "SYSTEM_ADMIN") {
        throw NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    if (!auth.organizationId) {
        throw NextResponse.json({ error: "No organization assigned" }, { status: 400 });
    }
    return auth.organizationId;
}

export async function GET() {
    try {
        const organizationId = await getOrganizationForAuth();
        const organization = await prisma.organization.findUnique({
            where: { id: organizationId },
            select: organizationProfileSelect,
        });

        if (!organization) {
            return NextResponse.json({ error: "Organization not found" }, { status: 404 });
        }

        return NextResponse.json({
            organization,
            completion: computeOrganizationProfileCompletion(organization),
        });
    } catch (error) {
        if (error instanceof NextResponse) throw error;
        console.error("Failed to load organization profile:", error);
        return NextResponse.json({ error: "Failed to load organization profile" }, { status: 500 });
    }
}

export async function PUT(request: NextRequest) {
    try {
        const organizationId = await getOrganizationForAuth();
        const normalized = normalizeOrganizationProfile(await request.json());

        if (!normalized.name) {
            return NextResponse.json({ error: "Institution name is required" }, { status: 400 });
        }

        const organization = await prisma.organization.update({
            where: { id: organizationId },
            data: {
                name: normalized.name,
                orgType: normalized.orgType,
                tagline: normalized.tagline,
                description: normalized.description,
                city: normalized.location,
                location: normalized.location,
                website: normalized.website,
                contactEmail: normalized.contactEmail,
                contactPhone: normalized.contactPhone,
                primaryContactName: normalized.primaryContactName,
                audienceSummary: normalized.audienceSummary,
                boards: normalized.boards,
                classLevels: normalized.classLevels,
                subjects: normalized.subjects,
                languages: normalized.languages,
                documentTypes: normalized.documentTypes,
                workflowNeeds: normalized.workflowNeeds,
                creativeNeeds: normalized.creativeNeeds,
                aiGoals: normalized.aiGoals,
                brandTone: normalized.brandTone,
                notesForAI: normalized.notesForAI,
            },
            select: organizationProfileSelect,
        });

        return NextResponse.json({
            success: true,
            organization,
            completion: computeOrganizationProfileCompletion(organization),
        });
    } catch (error) {
        if (error instanceof NextResponse) throw error;
        console.error("Failed to update organization profile:", error);
        return NextResponse.json({ error: "Failed to update organization profile" }, { status: 500 });
    }
}
