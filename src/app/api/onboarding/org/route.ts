import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/api-auth";
import { normalizeOrganizationProfile } from "@/lib/organization-profile";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
    try {
        const auth = await requireSession();

        if (auth.role !== "ORG_ADMIN") {
            return NextResponse.json({ error: "Only Org Admins can complete this onboarding" }, { status: 403 });
        }

        const payload = await request.json();
        const normalized = normalizeOrganizationProfile(payload);

        // Update the organization
        if (auth.organizationId) {
            await prisma.organization.update({
                where: { id: auth.organizationId },
                data: {
                    description: normalized.description || null,
                    city: normalized.location || null,     // For legacy/simple display
                    location: normalized.location || null, // Hierarchical location
                    orgType: normalized.orgType || null,
                    onboardingDone: true,
                },
            });
        }

        // Mark the user as onboarded
        await prisma.user.update({
            where: { id: auth.userId },
            data: { onboardingDone: true },
        });

        return NextResponse.json({ success: true });
    } catch (error) {
        if (error instanceof NextResponse) throw error;
        console.error("Org onboarding error:", error);
        return NextResponse.json({ error: "Failed to save onboarding data" }, { status: 500 });
    }
}
