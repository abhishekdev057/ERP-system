import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import bcrypt from "bcryptjs";
import { OrgMembersClient } from "./client";

export default async function OrgMembersPage() {
    const session = await getServerSession(authOptions);
    const orgId = (session?.user as any)?.organizationId;

    const org = await prisma.organization.findUnique({
        where: { id: orgId },
        select: { id: true, name: true, allowedTools: true }
    });

    const members = await prisma.user.findMany({
        where: { organizationId: orgId },
        orderBy: { createdAt: "desc" },
        select: {
            id: true, name: true, email: true, username: true,
            role: true, designation: true, image: true,
            visiblePassword: true, allowedTools: true, createdAt: true,
            salaryMonthly: true, dateOfJoining: true,
        }
    });

    async function addMemberByEmail(formData: FormData) {
        "use server";
        const s = await getServerSession(authOptions);
        const adminOrgId = (s?.user as any)?.organizationId;
        if (!adminOrgId) return;
        const name = formData.get("name") as string;
        const email = formData.get("email") as string;
        const role = (formData.get("role") as string) || "MEMBER";
        const designation = ((formData.get("designation") as string) || "").trim() || null;
        const salaryRaw = (formData.get("salaryMonthly") as string) || "";
        const salaryMonthly = Number.parseInt(salaryRaw, 10);
        const dateOfJoiningRaw = (formData.get("dateOfJoining") as string) || "";
        const parsedDateOfJoining = dateOfJoiningRaw ? new Date(dateOfJoiningRaw) : null;
        const dateOfJoining =
            parsedDateOfJoining && !Number.isNaN(parsedDateOfJoining.getTime())
                ? parsedDateOfJoining
                : null;
        const requestedTools = formData.getAll("tools").map((item) => String(item));
        const orgRecord = await prisma.organization.findUnique({
            where: { id: adminOrgId },
            select: { allowedTools: true },
        });
        const allowedByOrg = orgRecord?.allowedTools || [];
        const validTools = requestedTools.filter((tool) => allowedByOrg.includes(tool));
        if (!email) return;
        await prisma.user.create({
            data: {
                name,
                email,
                organizationId: adminOrgId,
                role: role as any,
                designation,
                salaryMonthly: Number.isFinite(salaryMonthly) ? salaryMonthly : null,
                dateOfJoining,
                allowedTools: validTools,
                onboardingDone: false,
            }
        });
        revalidatePath("/org/members");
    }

    async function addMemberByCredentials(formData: FormData) {
        "use server";
        const s = await getServerSession(authOptions);
        const adminOrgId = (s?.user as any)?.organizationId;
        if (!adminOrgId) return;
        const name = formData.get("name") as string;
        const username = formData.get("username") as string;
        const rawPassword = formData.get("password") as string;
        const role = (formData.get("role") as string) || "MEMBER";
        const designation = ((formData.get("designation") as string) || "").trim() || null;
        const salaryRaw = (formData.get("salaryMonthly") as string) || "";
        const salaryMonthly = Number.parseInt(salaryRaw, 10);
        const dateOfJoiningRaw = (formData.get("dateOfJoining") as string) || "";
        const parsedDateOfJoining = dateOfJoiningRaw ? new Date(dateOfJoiningRaw) : null;
        const dateOfJoining =
            parsedDateOfJoining && !Number.isNaN(parsedDateOfJoining.getTime())
                ? parsedDateOfJoining
                : null;
        const requestedTools = formData.getAll("tools").map((item) => String(item));
        const orgRecord = await prisma.organization.findUnique({
            where: { id: adminOrgId },
            select: { allowedTools: true },
        });
        const allowedByOrg = orgRecord?.allowedTools || [];
        const validTools = requestedTools.filter((tool) => allowedByOrg.includes(tool));
        if (!username || !rawPassword) return;
        const hashedPassword = await bcrypt.hash(rawPassword, 10);
        await prisma.user.create({
            data: {
                name, username, password: hashedPassword,
                visiblePassword: rawPassword,
                organizationId: adminOrgId,
                role: role as any,
                designation,
                salaryMonthly: Number.isFinite(salaryMonthly) ? salaryMonthly : null,
                dateOfJoining,
                allowedTools: validTools,
                onboardingDone: false,
            }
        });
        revalidatePath("/org/members");
    }

    async function removeMember(formData: FormData) {
        "use server";
        const s = await getServerSession(authOptions);
        const adminOrgId = (s?.user as any)?.organizationId;
        const userId = formData.get("userId") as string;
        if (!userId || !adminOrgId) return;
        const target = await prisma.user.findUnique({ where: { id: userId } });
        if (target?.organizationId !== adminOrgId) return; // Security guard
        await prisma.user.delete({ where: { id: userId } });
        revalidatePath("/org/members");
    }

    return (
        <OrgMembersClient
            orgId={orgId}
            orgName={org?.name || ""}
            members={members as any}
            orgAllowedTools={org?.allowedTools || []}
            addMemberByEmail={addMemberByEmail}
            addMemberByCredentials={addMemberByCredentials}
            removeMember={removeMember}
        />
    );
}
