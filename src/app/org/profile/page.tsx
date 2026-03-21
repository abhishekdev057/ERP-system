import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import OrganizationProfileClient from "@/app/org/profile/client";

export default async function OrganizationProfilePage() {
    const session = await getServerSession(authOptions);
    const role = (session?.user as any)?.role;
    const organizationId = (session?.user as any)?.organizationId as string | undefined;

    if (role !== "ORG_ADMIN") {
        redirect("/");
    }

    if (!organizationId) {
        return <p className="text-sm text-slate-500">No organization is assigned to this account.</p>;
    }

    const organization = await prisma.organization.findUnique({
        where: { id: organizationId },
        select: {
            id: true,
            name: true,
            logo: true,
            orgType: true,
            tagline: true,
            description: true,
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
        },
    });

    if (!organization) {
        return <p className="text-sm text-slate-500">Organization not found.</p>;
    }

    return <OrganizationProfileClient organization={organization} />;
}
