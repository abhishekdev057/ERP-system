import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import UserAvatar from "@/components/ui/UserAvatar";

const ALL_TOOLS = [
    { id: "pdf-to-pdf", label: "Institute Suite" },
    { id: "media-studio", label: "Media Studio" },
    { id: "library", label: "Library" },
    { id: "whiteboard", label: "Whiteboard" },
];

export default async function OrgToolsPage() {
    const session = await getServerSession(authOptions);
    const orgId = (session?.user as any)?.organizationId;

    const org = await prisma.organization.findUnique({
        where: { id: orgId },
        select: { allowedTools: true }
    });

    const members = await prisma.user.findMany({
        where: { organizationId: orgId, role: { not: "SYSTEM_ADMIN" } },
        select: { id: true, name: true, username: true, email: true, image: true, allowedTools: true, role: true },
        orderBy: { createdAt: "asc" },
    });

    const orgTools = org?.allowedTools || [];

    async function saveUserTools(formData: FormData) {
        "use server";
        const s = await getServerSession(authOptions);
        const adminOrgId = (s?.user as any)?.organizationId;
        const userId = formData.get("userId") as string;
        if (!adminOrgId || !userId) return;

        // Verify target belongs to same org
        const target = await prisma.user.findUnique({ where: { id: userId } });
        if (target?.organizationId !== adminOrgId) return;

        const orgRecord = await prisma.organization.findUnique({
            where: { id: adminOrgId },
            select: { allowedTools: true },
        });
        const allowedByOrg = Array.isArray(orgRecord?.allowedTools)
            ? orgRecord.allowedTools
            : [];

        const selectedTools = formData.getAll("tools") as string[];
        // Only allow tools that the org itself has
        const validTools = selectedTools.filter((toolId) => allowedByOrg.includes(toolId));

        await prisma.user.update({
            where: { id: userId },
            data: { allowedTools: validTools },
        });

        revalidatePath("/org/tools");
    }

    return (
        <div className="space-y-6">
            <div>
                <h1 className="text-2xl font-extrabold text-slate-900">Tool Access Control</h1>
                <p className="text-sm text-slate-500 mt-1">
                    Customize which tools each member can access. You can only grant tools that your organization has been given by the System Admin.
                </p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                    {ALL_TOOLS.map(t => (
                        <span key={t.id} className={`text-xs font-semibold px-2.5 py-1 rounded-lg ${orgTools.includes(t.id) ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-400 line-through"}`}>
                            {t.label}
                        </span>
                    ))}
                </div>
                <p className="text-xs text-slate-400 mt-2">Strikethrough = not granted to your org by System Admin</p>
            </div>

            {members.length === 0 ? (
                <div className="text-center text-slate-400 py-16">No members in your organization yet.</div>
            ) : (
                <div className="space-y-4">
                    {members.map((m) => {
                        const effectiveTools = m.allowedTools.length > 0 ? m.allowedTools : orgTools;
                        return (
                            <div key={m.id} className="bg-white rounded-2xl ring-1 ring-slate-200 p-6">
                                <div className="flex items-center gap-3 mb-4">
                                    <UserAvatar
                                        src={m.image}
                                        name={m.name}
                                        email={m.email || m.username}
                                        sizeClass="w-9 h-9"
                                    />
                                    <div>
                                        <p className="font-semibold text-slate-900 text-sm">{m.name || "Unnamed"}</p>
                                        <p className="text-xs text-slate-500">{m.email || m.username}</p>
                                    </div>
                                    <span className={`ml-auto text-[10px] font-bold px-2 py-0.5 rounded-full ${m.role === "ORG_ADMIN" ? "bg-blue-100 text-blue-700" : "bg-slate-100 text-slate-600"}`}>
                                        {m.role === "ORG_ADMIN" ? "Admin" : "Member"}
                                    </span>
                                </div>

                                <form action={saveUserTools}>
                                    <input type="hidden" name="userId" value={m.id} />
                                    <div className="flex flex-wrap gap-2 mb-4">
                                        {ALL_TOOLS.filter(t => orgTools.includes(t.id)).map((tool) => {
                                            const isAdmin = m.role === "ORG_ADMIN" || m.role === "SYSTEM_ADMIN";
                                            const checked = isAdmin || effectiveTools.includes(tool.id);
                                            return (
                                                <label
                                                    key={tool.id}
                                                    className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border text-xs font-medium transition-all select-none ${checked
                                                        ? "bg-slate-900 border-slate-900 text-white"
                                                        : "bg-white border-slate-200 text-slate-500 hover:border-slate-400"
                                                        } ${isAdmin ? "opacity-75 cursor-not-allowed" : "cursor-pointer"}`}
                                                >
                                                    <input type="checkbox" name="tools" value={tool.id} defaultChecked={checked} disabled={isAdmin} className="hidden" />
                                                    {tool.label}
                                                </label>
                                            );
                                        })}
                                    </div>
                                    <div className="flex items-center justify-between">
                                        <p className="text-xs text-slate-400">
                                            {m.allowedTools.length === 0 ? "Inheriting org defaults" : `${m.allowedTools.length} custom tool(s)`}
                                        </p>
                                        <button type="submit" className="text-xs font-semibold bg-blue-600 text-white px-4 py-1.5 rounded-lg hover:bg-blue-700 transition">
                                            Save for {m.name?.split(" ")[0] || m.username}
                                        </button>
                                    </div>
                                </form>
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
}
