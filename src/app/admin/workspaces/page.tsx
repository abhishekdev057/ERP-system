import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import { CheckSquare, Square, Users, Building2 } from "lucide-react";
import Link from "next/link";
import { CopyButton, DeleteOrgButton } from "./client-actions";

export default async function AdminWorkspacesPage() {
    const session = await getServerSession(authOptions);

    if (session?.user?.role !== "SYSTEM_ADMIN") {
        redirect("/");
    }

    const organizations = await prisma.organization.findMany({
        include: {
            users: {
                select: { id: true, name: true, email: true, username: true, visiblePassword: true, role: true }
            },
            _count: {
                select: { pdfDocuments: true, books: true }
            }
        },
        orderBy: { createdAt: "desc" }
    });

    async function createOrganization(formData: FormData) {
        "use server";
        const name = formData.get("name") as string;
        if (!name) return;

        // Generate a unique 6-digit numeric ID
        let id: string;
        let attempts = 0;
        do {
            id = Math.floor(100000 + Math.random() * 900000).toString();
            const existing = await prisma.organization.findUnique({ where: { id } });
            if (!existing) break;
            attempts++;
        } while (attempts < 10);

        await prisma.organization.create({ data: { id: id!, name } });
        revalidatePath("/admin/workspaces");
    }

    async function deleteOrganization(formData: FormData) {
        "use server";
        const orgId = formData.get("orgId") as string;
        if (!orgId) return;
        // Delete the org — cascade will remove related data
        await prisma.organization.delete({ where: { id: orgId } });
        revalidatePath("/admin/workspaces");
    }

    async function toggleToolAccess(formData: FormData) {
        "use server";
        const orgId = formData.get("orgId") as string;
        const tool = formData.get("tool") as string;
        const currentTools = formData.getAll("currentTools") as string[];

        const newTools = currentTools.includes(tool)
            ? currentTools.filter(t => t !== tool)
            : [...currentTools, tool];

        await prisma.organization.update({
            where: { id: orgId },
            data: { allowedTools: newTools }
        });

        revalidatePath("/admin/workspaces");
    }

    const availableTools = [
        { id: "pdf-to-pdf", label: "Institute Suite" },
        { id: "media-studio", label: "Media Studio" },
        { id: "library", label: "Library" },
        { id: "whiteboard", label: "Whiteboard" },
    ];

    return (
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
            <div className="flex items-center justify-between mb-8">
                <div>
                    <h1 className="text-3xl font-extrabold text-slate-900 tracking-tight flex items-center gap-3">
                        <Building2 className="w-8 h-8 text-blue-600" /> Institutes
                    </h1>
                    <p className="mt-2 text-sm text-slate-500">
                        Manage coachings and schools. Use <Link href="/admin/users" className="text-blue-600 hover:underline font-medium">Users ↗</Link> to provision accounts for any institute.
                    </p>
                </div>

                {/* Create Institute Panel */}
                <div className="bg-white p-5 rounded-2xl shadow-sm ring-1 ring-slate-200 w-80">
                    <h2 className="text-sm font-semibold text-slate-900 mb-3">Create New Institute</h2>
                    <form action={createOrganization} className="flex gap-2">
                        <input
                            type="text"
                            name="name"
                            required
                            className="flex-1 rounded-lg border-slate-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm py-2 px-3 border"
                            placeholder="e.g. Apex Coaching"
                        />
                        <button type="submit" className="px-4 py-2 bg-slate-900 text-white rounded-lg font-semibold text-sm hover:bg-slate-800 transition whitespace-nowrap">
                            + Create
                        </button>
                    </form>
                    <p className="mt-2 text-xs text-slate-400">An auto-generated 6-digit ID will be assigned.</p>
                </div>
            </div>

            {/* Institutes Grid */}
            {organizations.length === 0 ? (
                <div className="text-center py-20 text-slate-400">
                    <Building2 className="w-12 h-12 mx-auto mb-4 opacity-30" />
                    <p className="font-medium">No institutes yet.</p>
                    <p className="text-sm mt-1">Create your first institute above.</p>
                </div>
            ) : (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                    {organizations.map((org) => (
                        <div key={org.id} className="bg-white rounded-2xl shadow-sm ring-1 ring-slate-200 overflow-hidden flex flex-col">
                            {/* Header */}
                            <div className="p-6 border-b border-slate-100">
                                <div className="flex items-start justify-between">
                                    <div>
                                        <h3 className="text-lg font-bold text-slate-900">{org.name}</h3>
                                        <div className="flex items-center gap-2 mt-1">
                                            <span className="text-xs font-mono text-slate-500 bg-slate-100 px-2 py-0.5 rounded">
                                                ID: {org.id}
                                            </span>
                                            <CopyButton text={org.id} />
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-blue-50 text-blue-700">
                                            {org._count.pdfDocuments} PDFs
                                        </span>
                                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-purple-50 text-purple-700">
                                            {org._count.books} Books
                                        </span>
                                    </div>
                                </div>
                            </div>

                            {/* Members Section */}
                            <div className="p-6 flex-1">
                                <div className="flex items-center justify-between mb-3">
                                    <p className="text-xs font-semibold text-slate-600 uppercase tracking-wider">
                                        Members ({org.users.length})
                                    </p>
                                    <Link
                                        href={`/admin/users`}
                                        className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800 font-medium transition-colors"
                                    >
                                        <Users className="w-3.5 h-3.5" /> Manage in Users ↗
                                    </Link>
                                </div>
                                {org.users.length === 0 ? (
                                    <div className="text-center py-4 rounded-lg border border-dashed border-slate-200">
                                        <p className="text-xs text-slate-400">No users provisioned yet.</p>
                                        <Link href="/admin/users" className="text-xs text-blue-600 hover:underline mt-1 block">
                                            ＋ Add users from the Users page
                                        </Link>
                                    </div>
                                ) : (
                                    <div className="space-y-2">
                                        {org.users.map(u => (
                                            <div key={u.id} className="flex items-center justify-between p-2.5 rounded-lg border border-slate-100 bg-slate-50">
                                                <div className="flex items-center gap-3">
                                                    <div className="w-7 h-7 rounded-full bg-slate-300 flex items-center justify-center text-slate-700 font-bold text-xs">
                                                        {(u.name || u.username || "U")[0].toUpperCase()}
                                                    </div>
                                                    <div>
                                                        <p className="text-sm font-semibold text-slate-800 leading-tight">{u.name || "Unnamed"}</p>
                                                        <p className="text-xs text-slate-500 font-mono">{u.username || u.email}</p>
                                                    </div>
                                                </div>
                                                <div className="flex flex-col items-end gap-1">
                                                    <span className={`text-[10px] font-bold uppercase px-1.5 py-0.5 rounded ${u.role === "ORG_ADMIN" ? "bg-blue-100 text-blue-700" : "bg-slate-100 text-slate-600"}`}>
                                                        {u.role === "ORG_ADMIN" ? "Admin" : u.role === "SYSTEM_ADMIN" ? "Sys Admin" : "Member"}
                                                    </span>
                                                    {u.visiblePassword && (
                                                        <span className="text-[10px] font-mono bg-amber-50 text-amber-700 border border-amber-100 px-1.5 py-0.5 rounded">
                                                            pw: {u.visiblePassword}
                                                        </span>
                                                    )}
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>

                            {/* Tool Permissions */}
                            <div className="px-6 pb-4">
                                <p className="text-xs font-semibold text-slate-600 uppercase tracking-wider mb-2">Tool Access</p>
                                <div className="flex flex-wrap gap-1.5">
                                    {availableTools.map((tool) => {
                                        const hasAccess = org.allowedTools.includes(tool.id);
                                        return (
                                            <form action={toggleToolAccess} key={tool.id} className="inline-block">
                                                <input type="hidden" name="orgId" value={org.id} />
                                                <input type="hidden" name="tool" value={tool.id} />
                                                {org.allowedTools.map(t => (
                                                    <input key={t} type="hidden" name="currentTools" value={t} />
                                                ))}
                                                <button
                                                    type="submit"
                                                    title={hasAccess ? `Revoke ${tool.label}` : `Grant ${tool.label}`}
                                                    className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium border transition-colors ${hasAccess
                                                        ? "bg-slate-900 border-slate-900 text-white"
                                                        : "bg-white border-slate-200 text-slate-500 hover:border-slate-400"
                                                        }`}
                                                >
                                                    {hasAccess ? <CheckSquare className="w-3 h-3" /> : <Square className="w-3 h-3" />}
                                                    {tool.label}
                                                </button>
                                            </form>
                                        );
                                    })}
                                </div>
                            </div>

                            {/* Footer Actions */}
                            <div className="px-6 py-3 bg-slate-50 border-t border-slate-100 flex items-center justify-between">
                                <span className="text-xs text-slate-400">
                                    Created {new Date(org.createdAt).toLocaleDateString("en-IN")}
                                </span>
                                <form action={deleteOrganization}>
                                    <input type="hidden" name="orgId" value={org.id} />
                                    <DeleteOrgButton orgName={org.name} />
                                </form>
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}
