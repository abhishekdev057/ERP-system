import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { Building2, Users, FileText, BookOpen, MapPin, Sparkles, ArrowRight } from "lucide-react";
import Link from "next/link";
import {
    buildOrganizationAiContext,
    computeOrganizationProfileCompletion,
} from "@/lib/organization-profile";

export default async function OrgOverviewPage() {
    const session = await getServerSession(authOptions);
    const orgId = (session?.user as any)?.organizationId;

    const org = await prisma.organization.findUnique({
        where: { id: orgId },
        include: {
            _count: { select: { users: true, pdfDocuments: true, books: true } }
        }
    });

    if (!org) {
        return <p className="text-slate-500">Organization not found.</p>;
    }

    const stats = [
        { label: "Members", value: org._count.users, icon: Users, color: "text-blue-600", bg: "bg-blue-50" },
        { label: "Generated PDFs", value: org._count.pdfDocuments, icon: FileText, color: "text-amber-600", bg: "bg-amber-50" },
        { label: "Library Books", value: org._count.books, icon: BookOpen, color: "text-purple-600", bg: "bg-purple-50" },
    ];

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

    const availableTools = [
        { id: "pdf-to-pdf", label: "Content Studio" },
        { id: "media-studio", label: "Media Studio" },
        { id: "library", label: "Library" },
        { id: "whiteboard", label: "Whiteboard" },
    ];

    return (
        <div className="space-y-8">
            <div className="flex flex-col items-start gap-4 sm:flex-row sm:gap-6">
                {org.logo ? (
                    <img src={org.logo} alt={org.name} className="h-16 w-16 rounded-2xl bg-white p-2 object-contain ring-1 ring-slate-200 sm:h-20 sm:w-20" />
                ) : (
                    <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-blue-100 sm:h-20 sm:w-20">
                        <Building2 className="w-10 h-10 text-blue-600" />
                    </div>
                )}
                <div className="min-w-0">
                    <h1 className="text-2xl font-extrabold text-slate-900">{org.name}</h1>
                    {org.tagline && <p className="text-sm font-medium text-sky-700 mt-1">{org.tagline}</p>}
                    {org.id && <p className="text-xs text-slate-400 font-mono mt-1 uppercase tracking-tight">Org ID: {org.id}</p>}
                    {org.orgType && <p className="text-xs text-slate-500 font-semibold uppercase tracking-[0.18em] mt-2">{org.orgType}</p>}
                    {(org.location || org.city) && (
                        <p className="text-sm text-slate-600 font-medium mt-1.5 flex items-center gap-1.5">
                            <MapPin className="w-3.5 h-3.5 text-blue-500" />
                            {org.location || org.city}
                        </p>
                    )}
                    {org.description && <p className="text-sm text-slate-600 mt-2 max-w-xl">{org.description}</p>}
                </div>
            </div>

            {/* Stats */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                {stats.map((s) => (
                    <div key={s.label} className="bg-white rounded-2xl p-6 ring-1 ring-slate-200 flex items-center gap-4">
                        <div className={`w-12 h-12 rounded-xl ${s.bg} flex items-center justify-center`}>
                            <s.icon className={`w-6 h-6 ${s.color}`} />
                        </div>
                        <div>
                            <p className="text-2xl font-bold text-slate-900">{s.value}</p>
                            <p className="text-sm text-slate-500">{s.label}</p>
                        </div>
                    </div>
                ))}
            </div>

            {/* Active Tools */}
            <div className="bg-white rounded-2xl p-6 ring-1 ring-slate-200">
                <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <h2 className="text-base font-semibold text-slate-900">Tools Available to Your Organization</h2>
                    <Link href="/org/tools" className="text-xs text-blue-600 hover:underline font-medium">Manage per-member →</Link>
                </div>
                <div className="flex flex-wrap gap-2">
                    {availableTools.map((t) => {
                        const has = org.allowedTools.includes(t.id);
                        return (
                            <span key={t.id} className={`px-3 py-1.5 rounded-lg text-xs font-semibold ${has ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-400 line-through"}`}>
                                {t.label}
                            </span>
                        );
                    })}
                </div>
                <p className="text-xs text-slate-400 mt-3">Tools granted by System Admin. You can restrict specific tools per member from the Tool Access tab.</p>
            </div>

            <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1.2fr)_minmax(320px,0.8fr)] gap-4">
                <div className="bg-white rounded-2xl p-6 ring-1 ring-slate-200">
                    <div className="flex items-start justify-between gap-4">
                        <div>
                            <h2 className="text-base font-semibold text-slate-900">Institution Context for AI</h2>
                            <p className="text-sm text-slate-500 mt-1">
                                This is the context the product can use to understand the institution.
                            </p>
                        </div>
                        <Link href="/org/profile" className="inline-flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50">
                            Edit Profile <ArrowRight className="w-3.5 h-3.5" />
                        </Link>
                    </div>
                    <pre className="mt-4 whitespace-pre-wrap rounded-2xl bg-slate-950 p-4 text-xs leading-6 text-slate-200 min-h-[220px]">
                        {aiContextPreview || "Profile is still too thin. Fill the Institution Profile to make AI outputs more specific to the institute."}
                    </pre>
                </div>

                <div className="bg-white rounded-2xl p-6 ring-1 ring-slate-200">
                    <div className="flex items-center gap-3">
                        <div className="w-12 h-12 rounded-2xl bg-sky-50 flex items-center justify-center">
                            <Sparkles className="w-6 h-6 text-sky-600" />
                        </div>
                        <div>
                            <p className="text-sm font-semibold text-slate-900">Profile Readiness</p>
                            <p className="text-xs text-slate-500">How much context the workspace currently has</p>
                        </div>
                    </div>
                    <div className="mt-5">
                        <p className="text-3xl font-black text-slate-950">{profileCompletion.percent}%</p>
                        <p className="text-sm text-slate-600 mt-1">
                            {profileCompletion.completed} of {profileCompletion.total} critical profile blocks completed
                        </p>
                    </div>
                    <div className="mt-5 h-3 rounded-full bg-slate-100 overflow-hidden">
                        <div
                            className="h-full rounded-full bg-sky-500"
                            style={{ width: `${profileCompletion.percent}%` }}
                        />
                    </div>
                    <div className="mt-5 space-y-3">
                        <Link href="/org/profile" className="block rounded-xl border border-slate-200 px-4 py-3 hover:bg-slate-50 transition">
                            <p className="font-semibold text-sm text-slate-900">Complete Institution Profile</p>
                            <p className="text-xs text-slate-500 mt-1">Add academic scope, document types, workflow needs, AI goals, and creative requirements.</p>
                        </Link>
                        <Link href="/pdf-to-pdf/new" className="block rounded-xl border border-slate-200 px-4 py-3 hover:bg-slate-50 transition">
                            <p className="font-semibold text-sm text-slate-900">Add Workspace Documents</p>
                            <p className="text-xs text-slate-500 mt-1">Use Content Studio to process institute question sets and source material.</p>
                        </Link>
                        <Link href="/library" className="block rounded-xl border border-slate-200 px-4 py-3 hover:bg-slate-50 transition">
                            <p className="font-semibold text-sm text-slate-900">Add Reference Library</p>
                            <p className="text-xs text-slate-500 mt-1">Store books and study material the team wants AI to reference.</p>
                        </Link>
                    </div>
                </div>
            </div>

            {/* Quick actions */}
            <div className="bg-white rounded-2xl p-6 ring-1 ring-slate-200">
                <h2 className="text-base font-semibold text-slate-900 mb-4">Quick Actions</h2>
                <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
                    <Link href="/org/profile" className="p-4 border border-slate-200 rounded-xl hover:bg-slate-50 transition-colors flex items-center gap-3">
                        <div className="w-10 h-10 bg-sky-50 rounded-xl flex items-center justify-center">
                            <Sparkles className="w-5 h-5 text-sky-600" />
                        </div>
                        <div>
                            <p className="font-semibold text-slate-900 text-sm">Institution Profile</p>
                            <p className="text-xs text-slate-500">Update AI-ready institute context</p>
                        </div>
                    </Link>
                    <Link href="/org/members" className="p-4 border border-slate-200 rounded-xl hover:bg-slate-50 transition-colors flex items-center gap-3">
                        <div className="w-10 h-10 bg-blue-50 rounded-xl flex items-center justify-center">
                            <Users className="w-5 h-5 text-blue-600" />
                        </div>
                        <div>
                            <p className="font-semibold text-slate-900 text-sm">Manage Members</p>
                            <p className="text-xs text-slate-500">Add or remove users in your org</p>
                        </div>
                    </Link>
                    <Link href="/org/tools" className="p-4 border border-slate-200 rounded-xl hover:bg-slate-50 transition-colors flex items-center gap-3">
                        <div className="w-10 h-10 bg-amber-50 rounded-xl flex items-center justify-center">
                            <Building2 className="w-5 h-5 text-amber-600" />
                        </div>
                        <div>
                            <p className="font-semibold text-slate-900 text-sm">Tool Access Control</p>
                            <p className="text-xs text-slate-500">Customize tools per member</p>
                        </div>
                    </Link>
                    <Link href="/pdf-to-pdf/new" className="p-4 border border-slate-200 rounded-xl hover:bg-slate-50 transition-colors flex items-center gap-3">
                        <div className="w-10 h-10 bg-emerald-50 rounded-xl flex items-center justify-center">
                            <FileText className="w-5 h-5 text-emerald-600" />
                        </div>
                        <div>
                            <p className="font-semibold text-slate-900 text-sm">Content Studio</p>
                            <p className="text-xs text-slate-500">Upload and transform question documents</p>
                        </div>
                    </Link>
                    <Link href="/library" className="p-4 border border-slate-200 rounded-xl hover:bg-slate-50 transition-colors flex items-center gap-3">
                        <div className="w-10 h-10 bg-purple-50 rounded-xl flex items-center justify-center">
                            <BookOpen className="w-5 h-5 text-purple-600" />
                        </div>
                        <div>
                            <p className="font-semibold text-slate-900 text-sm">Library</p>
                            <p className="text-xs text-slate-500">Add books and institutional source material</p>
                        </div>
                    </Link>
                </div>
            </div>
        </div>
    );
}
