import { getServerSession } from "next-auth";
import Link from "next/link";
import {
    ArrowRight,
    Building2,
    MapPin,
    ShieldCheck,
    Sparkles,
} from "lucide-react";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
    buildOrganizationAiContext,
    computeOrganizationProfileCompletion,
} from "@/lib/organization-profile";

const TOOL_LABELS: Record<string, string> = {
    "pdf-to-pdf": "Content Studio",
    "media-studio": "Media Studio",
    whiteboard: "Whiteboard",
    library: "Library",
};

export default async function OrgOverviewPage() {
    const session = await getServerSession(authOptions);
    const orgId = (session?.user as any)?.organizationId;

    const org = await prisma.organization.findUnique({
        where: { id: orgId },
        include: {
            _count: { select: { users: true, pdfDocuments: true, books: true } },
        },
    });

    if (!org) {
        return (
            <div className="page-container">
                <section className="surface surface-premium p-8">
                    <span className="eyebrow">Organization</span>
                    <h1 className="heading-xl mt-4">Organization not found</h1>
                    <p className="text-sm text-muted mt-3">
                        We could not load your workspace organization details right now.
                    </p>
                </section>
            </div>
        );
    }

    const profileCompletion = computeOrganizationProfileCompletion(org);
    const aiContextPreview = buildOrganizationAiContext({
        name: org.name,
        orgType: org.orgType,
        tagline: org.tagline,
        description: org.description,
        location: org.location || org.city,
        audienceSummary: org.audienceSummary,
        boards: org.boards,
        classLevels: org.classLevels,
        subjects: org.subjects,
        languages: org.languages,
        documentTypes: org.documentTypes,
        workflowNeeds: org.workflowNeeds,
        creativeNeeds: org.creativeNeeds,
        aiGoals: org.aiGoals,
        brandTone: org.brandTone,
        notesForAI: org.notesForAI,
    });

    const allowedToolCount = Array.isArray(org.allowedTools) ? org.allowedTools.length : 0;

    const quickActions = [
        {
            href: "/org/profile",
            title: "Institution Profile",
            description: "Tune institute context, tone, academic scope, and AI goals.",
        },
        {
            href: "/org/members",
            title: "Members",
            description: "Manage your team, access, and workspace contributors.",
        },
        {
            href: "/org/tools",
            title: "Tool Access",
            description: "Control which tools are available across the organization.",
        },
    ];

    return (
        <div className="page-container">
            <section className="dashboard-hero surface-premium fade-in-up">
                <div className="dashboard-hero-copy">
                    <span className="eyebrow">Organization</span>
                    <div className="mt-4 flex flex-col gap-4 sm:flex-row sm:items-start">
                        {org.logo ? (
                            <img
                                src={org.logo}
                                alt={org.name}
                                className="h-20 w-20 rounded-[24px] border border-white/70 bg-white/90 object-contain p-3 shadow-lg"
                            />
                        ) : (
                            <div className="flex h-20 w-20 items-center justify-center rounded-[24px] border border-white/70 bg-white/90 shadow-lg">
                                <Building2 className="h-10 w-10 text-blue-600" />
                            </div>
                        )}
                        <div className="min-w-0">
                            <h1 className="heading-xl">{org.name}</h1>
                            {org.tagline ? (
                                <p className="text-sm font-semibold text-blue-700 mt-2">{org.tagline}</p>
                            ) : null}
                            <div className="mt-3 flex flex-wrap gap-2">
                                {org.orgType ? <span className="pill pill-active">{org.orgType}</span> : null}
                                {(org.location || org.city) ? (
                                    <span className="pill">
                                        <MapPin className="h-3.5 w-3.5" />
                                        {org.location || org.city}
                                    </span>
                                ) : null}
                                <span className="pill">
                                    <ShieldCheck className="h-3.5 w-3.5" />
                                    Org ID {org.id}
                                </span>
                            </div>
                            {org.description ? (
                                <p className="text-sm text-muted mt-4 max-w-3xl leading-relaxed">{org.description}</p>
                            ) : null}
                        </div>
                    </div>

                    <div className="dashboard-quick-grid mt-6">
                        {quickActions.map((action) => (
                            <Link key={action.href} href={action.href} className="dashboard-quick-card">
                                <span className="dashboard-quick-kicker">Workspace Control</span>
                                <strong>{action.title}</strong>
                                <span>{action.description}</span>
                            </Link>
                        ))}
                    </div>
                </div>

                <div className="dashboard-hero-side">
                    <div className="dashboard-live-card">
                        <p className="dashboard-side-label">Profile Readiness</p>
                        <p className="dashboard-live-time">{profileCompletion.percent}%</p>
                        <p className="text-xs">
                            {profileCompletion.completed} of {profileCompletion.total} critical institute blocks are ready for AI.
                        </p>
                        <div className="mt-4 h-2.5 overflow-hidden rounded-full bg-white/10">
                            <div
                                className="h-full rounded-full bg-gradient-to-r from-sky-400 via-blue-400 to-emerald-300"
                                style={{ width: `${profileCompletion.percent}%` }}
                            />
                        </div>
                        <Link href="/org/profile" className="btn btn-secondary mt-4 text-xs">
                            Refine Profile
                        </Link>
                    </div>

                    <div className="dashboard-mini-grid">
                        <article className="dashboard-mini-card">
                            <span>Members</span>
                            <strong>{org._count.users}</strong>
                            <p>Active teammates inside this workspace.</p>
                        </article>
                        <article className="dashboard-mini-card">
                            <span>Documents</span>
                            <strong>{org._count.pdfDocuments}</strong>
                            <p>Saved extractor and question workspaces.</p>
                        </article>
                        <article className="dashboard-mini-card">
                            <span>Library</span>
                            <strong>{org._count.books}</strong>
                            <p>Reference books available to AI systems.</p>
                        </article>
                    </div>
                </div>

                <div className="dashboard-hero-orb dashboard-hero-orb-a" />
                <div className="dashboard-hero-orb dashboard-hero-orb-b" />
            </section>

            <section className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1.1fr)_minmax(320px,0.9fr)]">
                <article className="surface surface-premium p-5">
                    <div className="flex items-start justify-between gap-3">
                        <div>
                            <span className="eyebrow">AI Context</span>
                            <h2 className="text-xl font-semibold text-slate-950 mt-4">
                                Institution Context For Every AI Tool
                            </h2>
                            <p className="text-sm text-muted mt-2">
                                This is the institute summary the platform can reuse across media, extractor, and publishing workflows.
                            </p>
                        </div>
                        <Link href="/org/profile" className="btn btn-secondary text-xs">
                            Edit Context
                            <ArrowRight className="h-3.5 w-3.5" />
                        </Link>
                    </div>

                    <pre className="mt-5 min-h-[260px] whitespace-pre-wrap rounded-[24px] border border-slate-800 bg-slate-950 p-5 text-xs leading-6 text-slate-200 shadow-inner">
                        {aiContextPreview || "Profile is still thin. Add institute details to make AI outputs specific and consistent."}
                    </pre>
                </article>

                <div className="space-y-4">
                    <article className="surface surface-premium p-5">
                        <div className="flex items-center gap-3">
                            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-blue-50 text-blue-600">
                                <Sparkles className="h-6 w-6" />
                            </div>
                            <div>
                                <p className="text-sm font-semibold text-slate-900">Workspace Tool Access</p>
                                <p className="text-xs text-slate-500">What your organization can currently use</p>
                            </div>
                        </div>
                        <div className="mt-4 flex flex-wrap gap-2">
                            {Object.entries(TOOL_LABELS).map(([toolId, label]) => {
                                const enabled = org.allowedTools.includes(toolId);
                                return (
                                    <span
                                        key={toolId}
                                        className={`rounded-full px-3 py-1.5 text-xs font-semibold ${
                                            enabled
                                                ? "bg-slate-950 text-white"
                                                : "bg-slate-100 text-slate-400 line-through"
                                        }`}
                                    >
                                        {label}
                                    </span>
                                );
                            })}
                        </div>
                        <p className="text-xs text-slate-500 mt-4">
                            {allowedToolCount} tool area(s) are available right now. Per-member overrides can still be managed separately.
                        </p>
                        <Link href="/org/tools" className="btn btn-secondary mt-4 text-xs">
                            Manage Tool Access
                        </Link>
                    </article>

                    <article className="surface surface-premium p-5">
                        <p className="text-xs font-bold uppercase tracking-[0.16em] text-slate-500">Recommended Next Steps</p>
                        <div className="mt-4 space-y-3">
                            <Link href="/content-studio/extractor" className="dashboard-quick-card min-h-0">
                                <span className="dashboard-quick-kicker">Documents</span>
                                <strong>Feed fresh question sets</strong>
                                <span>Bring extractor workspaces in so AI and teams can reference recent material.</span>
                            </Link>
                            <Link href="/books" className="dashboard-quick-card min-h-0">
                                <span className="dashboard-quick-kicker">Library</span>
                                <strong>Grow the institute library</strong>
                                <span>Add books, notes, and reference PDFs that should shape future outputs.</span>
                            </Link>
                            <Link href="/whiteboard" className="dashboard-quick-card min-h-0">
                                <span className="dashboard-quick-kicker">Teaching</span>
                                <strong>Open the premium whiteboard</strong>
                                <span>Continue sessions with autosave, page docking, and your saved institute documents.</span>
                            </Link>
                        </div>
                    </article>
                </div>
            </section>

            <section className="grid grid-cols-1 gap-4 md:grid-cols-3 mt-4">
                <article className="kpi-card surface-premium">
                    <p className="kpi-label">Team Scale</p>
                    <p className="kpi-value">{org._count.users}</p>
                    <p className="kpi-footnote">Teachers, admins, and operators collaborating inside this organization.</p>
                </article>
                <article className="kpi-card surface-premium">
                    <p className="kpi-label">Content Output</p>
                    <p className="kpi-value">{org._count.pdfDocuments}</p>
                    <p className="kpi-footnote">Structured extractor workspaces and generated question document records.</p>
                </article>
                <article className="kpi-card surface-premium">
                    <p className="kpi-label">Knowledge Stack</p>
                    <p className="kpi-value">{org._count.books}</p>
                    <p className="kpi-footnote">Library items that can feed context into media and other AI-assisted tools.</p>
                </article>
            </section>
        </div>
    );
}
