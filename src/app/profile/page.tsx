import { getServerSession } from "next-auth";
import Link from "next/link";
import { redirect } from "next/navigation";
import {
    BadgeCheck,
    Briefcase,
    Building2,
    MapPin,
    User2,
} from "lucide-react";
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

function formatRole(role: string) {
    if (role === "ORG_ADMIN") return "Workspace Admin";
    if (role === "SYSTEM_ADMIN") return "System Admin";
    return role;
}

const TOOL_LABELS: Record<string, string> = {
    "pdf-to-pdf": "Content Studio",
    "media-studio": "Media Studio",
    whiteboard: "Whiteboard",
    library: "Library",
};

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
                <section className="surface surface-premium p-8">
                    <span className="eyebrow">Profile</span>
                    <h1 className="heading-xl mt-4">Profile not found</h1>
                </section>
            </div>
        );
    }

    const effectiveTools =
        user.role === "SYSTEM_ADMIN" || user.role === "ORG_ADMIN"
            ? ["pdf-to-pdf", "media-studio", "whiteboard", "library"]
            : user.allowedTools.length > 0
                ? user.allowedTools
                : user.organization?.allowedTools || [];

    const initials = String(user.name || user.email || "N")
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 2)
        .map((part) => part[0]?.toUpperCase() || "")
        .join("");

    return (
        <div className="page-container">
            <section className="dashboard-hero surface-premium fade-in-up">
                <div className="dashboard-hero-copy">
                    <span className="eyebrow">Member Profile</span>
                    <div className="mt-4 flex flex-col gap-4 sm:flex-row sm:items-start">
                        {user.image ? (
                            <img
                                src={user.image}
                                alt={user.name || "User avatar"}
                                className="h-20 w-20 rounded-[24px] border border-white/80 bg-white object-cover shadow-lg"
                            />
                        ) : (
                            <div className="flex h-20 w-20 items-center justify-center rounded-[24px] border border-white/80 bg-white text-2xl font-bold text-blue-700 shadow-lg">
                                {initials || "N"}
                            </div>
                        )}
                        <div className="min-w-0">
                            <h1 className="heading-xl">{user.name || "Profile Details"}</h1>
                            <p className="text-sm font-semibold text-blue-700 mt-2">{formatRole(user.role)}</p>
                            <div className="mt-3 flex flex-wrap gap-2">
                                {user.designation ? (
                                    <span className="pill pill-active">
                                        <Briefcase className="h-3.5 w-3.5" />
                                        {user.designation}
                                    </span>
                                ) : null}
                                {user.location ? (
                                    <span className="pill">
                                        <MapPin className="h-3.5 w-3.5" />
                                        {user.location}
                                    </span>
                                ) : null}
                                <span className="pill">
                                    <Building2 className="h-3.5 w-3.5" />
                                    {user.organization?.name || "No organization"}
                                </span>
                            </div>
                            <p className="text-sm text-muted mt-4 max-w-3xl">
                                Personal identity, organization alignment, employment metadata, and tool permissions are all visible from one polished workspace profile.
                            </p>
                        </div>
                    </div>

                    <div className="dashboard-quick-grid mt-6">
                        <Link href="/content-studio" className="dashboard-quick-card">
                            <span className="dashboard-quick-kicker">Workspace</span>
                            <strong>Open Content Studio</strong>
                            <span>Jump straight into extractor, media, YouTube, and WhatsApp workspaces.</span>
                        </Link>
                        <Link href="/org" className="dashboard-quick-card">
                            <span className="dashboard-quick-kicker">Organization</span>
                            <strong>View organization overview</strong>
                            <span>See institute context, AI readiness, members, and workspace status.</span>
                        </Link>
                        <Link href="/books" className="dashboard-quick-card">
                            <span className="dashboard-quick-kicker">Library</span>
                            <strong>Browse the reference library</strong>
                            <span>Open your institution materials and source references in one place.</span>
                        </Link>
                    </div>
                </div>

                <div className="dashboard-hero-side">
                    <div className="dashboard-live-card">
                        <p className="dashboard-side-label">Access Summary</p>
                        <p className="dashboard-live-time">{effectiveTools.length}</p>
                        <p className="text-xs">Active workspace tool area(s) available to this member right now.</p>
                        <div className="mt-4 flex flex-wrap gap-2">
                            {effectiveTools.map((toolId) => (
                                <span key={toolId} className="status-badge bg-white/10 text-slate-100 border-white/10">
                                    {TOOL_LABELS[toolId] || toolId}
                                </span>
                            ))}
                        </div>
                    </div>

                    <div className="dashboard-mini-grid">
                        <article className="dashboard-mini-card">
                            <span>Joined</span>
                            <strong>{formatDate(user.dateOfJoining)}</strong>
                            <p>Employment start date recorded for this member.</p>
                        </article>
                        <article className="dashboard-mini-card">
                            <span>Salary</span>
                            <strong>{formatCurrency(user.salaryMonthly)}</strong>
                            <p>Current monthly compensation shown in the profile record.</p>
                        </article>
                        <article className="dashboard-mini-card">
                            <span>Org</span>
                            <strong>{user.organization?.id ? "Linked" : "Pending"}</strong>
                            <p>Organization membership and inherited access status.</p>
                        </article>
                    </div>
                </div>

                <div className="dashboard-hero-orb dashboard-hero-orb-a" />
                <div className="dashboard-hero-orb dashboard-hero-orb-b" />
            </section>

            <section className="grid grid-cols-1 gap-4 xl:grid-cols-2">
                <article className="surface surface-premium p-5">
                    <div className="flex items-center gap-3">
                        <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-blue-50 text-blue-600">
                            <User2 className="h-6 w-6" />
                        </div>
                        <div>
                            <p className="text-sm font-semibold text-slate-900">Identity</p>
                            <p className="text-xs text-slate-500">Core member credentials and account identity</p>
                        </div>
                    </div>
                    <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2">
                        <div className="rounded-2xl border border-slate-200 bg-white/80 p-4">
                            <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-slate-500">Full Name</p>
                            <p className="text-base font-semibold text-slate-900 mt-2">{user.name || "Not set"}</p>
                        </div>
                        <div className="rounded-2xl border border-slate-200 bg-white/80 p-4">
                            <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-slate-500">Role</p>
                            <p className="text-base font-semibold text-slate-900 mt-2">{formatRole(user.role)}</p>
                        </div>
                        <div className="rounded-2xl border border-slate-200 bg-white/80 p-4">
                            <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-slate-500">Email</p>
                            <p className="text-sm font-semibold text-slate-900 mt-2 break-all">{user.email || "Not set"}</p>
                        </div>
                        <div className="rounded-2xl border border-slate-200 bg-white/80 p-4">
                            <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-slate-500">Username</p>
                            <p className="text-base font-semibold text-slate-900 mt-2">{user.username || "Not set"}</p>
                        </div>
                    </div>
                </article>

                <article className="surface surface-premium p-5">
                    <div className="flex items-center gap-3">
                        <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-600">
                            <Building2 className="h-6 w-6" />
                        </div>
                        <div>
                            <p className="text-sm font-semibold text-slate-900">Organization</p>
                            <p className="text-xs text-slate-500">Current workspace and inherited access structure</p>
                        </div>
                    </div>
                    <div className="mt-5 rounded-[24px] border border-slate-200 bg-slate-950 p-5 text-slate-100">
                        <div className="flex items-center gap-2 text-sm font-semibold">
                            <BadgeCheck className="h-4 w-4 text-sky-300" />
                            {user.organization?.name || "No organization linked"}
                        </div>
                        <p className="text-xs text-slate-400 mt-2">Organization ID: {user.organization?.id || "N/A"}</p>
                        <div className="mt-4 flex flex-wrap gap-2">
                            {(user.organization?.allowedTools || []).map((toolId) => (
                                <span key={toolId} className="status-badge bg-white/10 text-slate-100 border-white/10">
                                    {TOOL_LABELS[toolId] || toolId}
                                </span>
                            ))}
                        </div>
                        <div className="mt-5 flex flex-wrap gap-2">
                            <Link href="/org" className="btn btn-secondary text-xs">
                                View Organization
                            </Link>
                            <Link href="/org/tools" className="btn btn-ghost text-xs text-slate-200">
                                Tool Policies
                            </Link>
                        </div>
                    </div>
                </article>
            </section>

            <section className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1.15fr)_minmax(320px,0.85fr)] mt-4">
                <article className="surface surface-premium p-5">
                    <div className="flex items-center gap-3">
                        <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-amber-50 text-amber-600">
                            <Briefcase className="h-6 w-6" />
                        </div>
                        <div>
                            <p className="text-sm font-semibold text-slate-900">Employment Details</p>
                            <p className="text-xs text-slate-500">Designation, tenure, and payroll metadata</p>
                        </div>
                    </div>
                    <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-3">
                        <div className="kpi-card surface-premium">
                            <p className="kpi-label">Designation</p>
                            <p className="kpi-value text-[1.45rem]">{user.designation || "Not set"}</p>
                            <p className="kpi-footnote">Current role title inside the organization.</p>
                        </div>
                        <div className="kpi-card surface-premium">
                            <p className="kpi-label">Joining Date</p>
                            <p className="kpi-value text-[1.45rem]">{formatDate(user.dateOfJoining)}</p>
                            <p className="kpi-footnote">Date recorded in the workspace profile.</p>
                        </div>
                        <div className="kpi-card surface-premium">
                            <p className="kpi-label">Salary</p>
                            <p className="kpi-value text-[1.2rem]">{formatCurrency(user.salaryMonthly)}</p>
                            <p className="kpi-footnote">Monthly compensation metadata stored for the member.</p>
                        </div>
                    </div>
                </article>

                <article className="surface surface-premium p-5">
                    <p className="text-xs font-bold uppercase tracking-[0.16em] text-slate-500">Quick Profile Actions</p>
                    <div className="mt-4 space-y-3">
                        <Link href="/content-studio/extractor" className="dashboard-quick-card min-h-0">
                            <span className="dashboard-quick-kicker">Extractor</span>
                            <strong>Resume question workflows</strong>
                            <span>Jump back into structured question documents and review decks.</span>
                        </Link>
                        <Link href="/books" className="dashboard-quick-card min-h-0">
                            <span className="dashboard-quick-kicker">Library</span>
                            <strong>Open reference materials</strong>
                            <span>Browse institute books, notes, and PDFs without leaving profile context.</span>
                        </Link>
                        <Link href="/whiteboard" className="dashboard-quick-card min-h-0">
                            <span className="dashboard-quick-kicker">Whiteboard</span>
                            <strong>Continue saved boards</strong>
                            <span>Open whiteboard sessions with autosave, document restore, and board history.</span>
                        </Link>
                    </div>
                </article>
            </section>
        </div>
    );
}
