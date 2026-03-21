import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

function formatDate(date: Date | null): string {
    if (!date) return "Not set";
    return date.toLocaleDateString("en-IN", {
        day: "2-digit",
        month: "short",
        year: "numeric",
    });
}

function formatCurrency(value: number | null): string {
    if (!Number.isFinite(value || NaN)) return "Not set";
    return `₹${Number(value).toLocaleString("en-IN")}/month`;
}

export default async function ProfilePage() {
    const session = await getServerSession(authOptions);
    const userId = (session?.user as any)?.id as string | undefined;

    if (!userId) {
        redirect("/auth/signin");
    }

    const user = await prisma.user.findUnique({
        where: { id: userId },
        select: {
            id: true,
            name: true,
            email: true,
            username: true,
            role: true,
            designation: true,
            image: true,
            location: true,
            salaryMonthly: true,
            dateOfJoining: true,
            allowedTools: true,
            organization: {
                select: {
                    name: true,
                    id: true,
                    allowedTools: true,
                },
            },
        },
    });

    if (!user) {
        return (
            <div className="page-container">
                <div className="surface p-6">
                    <h1 className="heading-xl">Profile Not Found</h1>
                </div>
            </div>
        );
    }

    const effectiveTools =
        user.role === "SYSTEM_ADMIN" || user.role === "ORG_ADMIN"
            ? ["pdf-to-pdf", "media-studio", "library", "whiteboard"]
            : user.allowedTools.length > 0
                ? user.allowedTools
                : user.organization?.allowedTools || [];

    return (
        <div className="page-container">
            <header className="page-header">
                <div>
                    <span className="eyebrow">Member Profile</span>
                    <h1 className="heading-xl mt-3">Profile Details</h1>
                    <p className="text-sm text-muted mt-2">
                        Personal details, employment info, and current tool access.
                    </p>
                </div>
            </header>

            <section className="grid grid-cols-1 xl:grid-cols-3 gap-4">
                <article className="surface p-5 xl:col-span-2">
                    <p className="text-xs font-bold uppercase tracking-wide text-slate-500 mb-3">
                        Identity
                    </p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
                        <div>
                            <p className="text-slate-500 text-xs uppercase tracking-wide">Name</p>
                            <p className="font-semibold text-slate-900">{user.name || "Not set"}</p>
                        </div>
                        <div>
                            <p className="text-slate-500 text-xs uppercase tracking-wide">Role</p>
                            <p className="font-semibold text-slate-900">
                                {user.role === "ORG_ADMIN" ? "Workspace Admin" : user.role}
                            </p>
                        </div>
                        <div>
                            <p className="text-slate-500 text-xs uppercase tracking-wide">Email</p>
                            <p className="font-semibold text-slate-900">{user.email || "Not set"}</p>
                        </div>
                        <div>
                            <p className="text-slate-500 text-xs uppercase tracking-wide">Username</p>
                            <p className="font-semibold text-slate-900">{user.username || "Not set"}</p>
                        </div>
                    </div>
                </article>

                <article className="surface p-5">
                    <p className="text-xs font-bold uppercase tracking-wide text-slate-500 mb-3">
                        Organization
                    </p>
                    <p className="font-semibold text-slate-900">
                        {user.organization?.name || "No organization"}
                    </p>
                    <p className="text-xs text-slate-500 mt-1">
                        ID: {user.organization?.id || "N/A"}
                    </p>
                </article>

                <article className="surface p-5 xl:col-span-2">
                    <p className="text-xs font-bold uppercase tracking-wide text-slate-500 mb-3">
                        Employment
                    </p>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-sm">
                        <div>
                            <p className="text-slate-500 text-xs uppercase tracking-wide">Designation</p>
                            <p className="font-semibold text-slate-900">{user.designation || "Not set"}</p>
                        </div>
                        <div>
                            <p className="text-slate-500 text-xs uppercase tracking-wide">Date of Joining</p>
                            <p className="font-semibold text-slate-900">{formatDate(user.dateOfJoining)}</p>
                        </div>
                        <div>
                            <p className="text-slate-500 text-xs uppercase tracking-wide">Salary</p>
                            <p className="font-semibold text-slate-900">{formatCurrency(user.salaryMonthly)}</p>
                        </div>
                    </div>
                </article>

                <article className="surface p-5">
                    <p className="text-xs font-bold uppercase tracking-wide text-slate-500 mb-3">
                        Tool Access
                    </p>
                    <div className="flex flex-wrap gap-2">
                        {effectiveTools.length === 0 ? (
                            <span className="text-xs text-slate-500">No tools assigned</span>
                        ) : (
                            effectiveTools.map((tool) => (
                                <span
                                    key={tool}
                                    className="px-2.5 py-1 rounded-lg text-xs font-semibold bg-slate-100 text-slate-700 border border-slate-200"
                                >
                                    {tool}
                                </span>
                            ))
                        )}
                    </div>
                </article>
            </section>
        </div>
    );
}
