"use client";

import { useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
    BookOpen,
    Building2,
    FileText,
    Globe,
    GraduationCap,
    ImagePlus,
    Languages,
    Mail,
    MapPin,
    Phone,
    Save,
    Sparkles,
} from "lucide-react";
import toast from "react-hot-toast";
import {
    BRAND_TONE_OPTIONS,
    DOCUMENT_TYPE_SUGGESTIONS,
    ORG_TYPE_OPTIONS,
    buildOrganizationAiContext,
    computeOrganizationProfileCompletion,
} from "@/lib/organization-profile";

type OrganizationProfilePageData = {
    id: string;
    name: string;
    logo: string | null;
    orgType: string | null;
    tagline: string | null;
    description: string | null;
    location: string | null;
    website: string | null;
    contactEmail: string | null;
    contactPhone: string | null;
    primaryContactName: string | null;
    audienceSummary: string | null;
    boards: string[];
    classLevels: string[];
    subjects: string[];
    languages: string[];
    documentTypes: string[];
    workflowNeeds: string | null;
    creativeNeeds: string | null;
    aiGoals: string | null;
    brandTone: string | null;
    notesForAI: string | null;
    _count: {
        pdfDocuments: number;
        books: number;
        users: number;
    };
};

type Props = {
    organization: OrganizationProfilePageData;
};

type FormState = {
    name: string;
    orgType: string;
    tagline: string;
    description: string;
    location: string;
    website: string;
    contactEmail: string;
    contactPhone: string;
    primaryContactName: string;
    audienceSummary: string;
    boards: string;
    classLevels: string;
    subjects: string;
    languages: string;
    documentTypes: string;
    workflowNeeds: string;
    creativeNeeds: string;
    aiGoals: string;
    brandTone: string;
    notesForAI: string;
};

function joinTags(values: string[]): string {
    return values.join("\n");
}

function buildInitialState(organization: OrganizationProfilePageData): FormState {
    return {
        name: organization.name || "",
        orgType: organization.orgType || "",
        tagline: organization.tagline || "",
        description: organization.description || "",
        location: organization.location || "",
        website: organization.website || "",
        contactEmail: organization.contactEmail || "",
        contactPhone: organization.contactPhone || "",
        primaryContactName: organization.primaryContactName || "",
        audienceSummary: organization.audienceSummary || "",
        boards: joinTags(organization.boards),
        classLevels: joinTags(organization.classLevels),
        subjects: joinTags(organization.subjects),
        languages: joinTags(organization.languages),
        documentTypes: joinTags(organization.documentTypes),
        workflowNeeds: organization.workflowNeeds || "",
        creativeNeeds: organization.creativeNeeds || "",
        aiGoals: organization.aiGoals || "",
        brandTone: organization.brandTone || "",
        notesForAI: organization.notesForAI || "",
    };
}

function splitTags(raw: string): string[] {
    return raw
        .split(/\n|,/g)
        .map((item) => item.trim())
        .filter(Boolean);
}

function FieldLabel({ title, hint }: { title: string; hint?: string }) {
    return (
        <label className="block">
            <span className="text-sm font-semibold text-slate-900">{title}</span>
            {hint ? <span className="block text-xs text-slate-500 mt-1">{hint}</span> : null}
        </label>
    );
}

export default function OrganizationProfileClient({ organization }: Props) {
    const [form, setForm] = useState<FormState>(() => buildInitialState(organization));
    const [logo, setLogo] = useState<string | null>(organization.logo);
    const [saving, setSaving] = useState(false);
    const [uploadingLogo, setUploadingLogo] = useState(false);
    const fileRef = useRef<HTMLInputElement>(null);

    const completion = useMemo(
        () =>
            computeOrganizationProfileCompletion({
                logo,
                orgType: form.orgType,
                description: form.description,
                location: form.location,
                boards: splitTags(form.boards),
                classLevels: splitTags(form.classLevels),
                subjects: splitTags(form.subjects),
                languages: splitTags(form.languages),
                workflowNeeds: form.workflowNeeds,
                aiGoals: form.aiGoals,
                creativeNeeds: form.creativeNeeds,
            }),
        [form, logo]
    );

    const aiBrief = useMemo(
        () =>
            buildOrganizationAiContext({
                name: form.name || organization.name,
                orgType: form.orgType,
                tagline: form.tagline,
                description: form.description,
                location: form.location,
                audienceSummary: form.audienceSummary,
                boards: splitTags(form.boards),
                classLevels: splitTags(form.classLevels),
                subjects: splitTags(form.subjects),
                languages: splitTags(form.languages),
                documentTypes: splitTags(form.documentTypes),
                workflowNeeds: form.workflowNeeds,
                creativeNeeds: form.creativeNeeds,
                aiGoals: form.aiGoals,
                brandTone: form.brandTone,
                notesForAI: form.notesForAI,
            }),
        [form, organization.name]
    );

    function updateField<K extends keyof FormState>(key: K, value: FormState[K]) {
        setForm((current) => ({ ...current, [key]: value }));
    }

    async function handleSave() {
        setSaving(true);
        try {
            const response = await fetch("/api/org/profile", {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(form),
            });

            const data = await response.json();
            if (!response.ok) {
                throw new Error(data.error || "Failed to save institution profile");
            }

            toast.success("Institution profile updated");
        } catch (error) {
            const message = error instanceof Error ? error.message : "Failed to save institution profile";
            toast.error(message);
        } finally {
            setSaving(false);
        }
    }

    async function handleLogoChange(file: File | null) {
        if (!file) return;
        setUploadingLogo(true);
        try {
            const formData = new FormData();
            formData.append("file", file);
            const response = await fetch("/api/uploads/logo", {
                method: "POST",
                body: formData,
            });
            const data = await response.json();
            if (!response.ok) {
                throw new Error(data.error || "Failed to upload logo");
            }
            setLogo(data.logo || null);
            toast.success("Logo updated");
        } catch (error) {
            const message = error instanceof Error ? error.message : "Failed to upload logo";
            toast.error(message);
        } finally {
            setUploadingLogo(false);
        }
    }

    const infoCards = [
        { label: "Team Members", value: organization._count.users, icon: Building2 },
        { label: "Workspace Documents", value: organization._count.pdfDocuments, icon: FileText },
        { label: "Library Files", value: organization._count.books, icon: BookOpen },
    ];

    return (
        <div className="space-y-8">
            <header className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
                <div>
                    <span className="text-xs font-bold uppercase tracking-[0.28em] text-sky-600">
                        Institution Profile
                    </span>
                    <h1 className="mt-3 text-3xl font-black tracking-tight text-slate-950">
                        Make the institute understandable to the product
                    </h1>
                    <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-600">
                        Fill the profile the way an AI operator would need it: what the institution teaches, who it serves,
                        what documents it works with, how the workflow runs, and what kind of creative output it expects.
                    </p>
                </div>
                <div className="flex items-center gap-3">
                    <div className="rounded-2xl border border-sky-100 bg-sky-50 px-4 py-3">
                        <p className="text-xs font-semibold uppercase tracking-[0.22em] text-sky-700">
                            Profile Completion
                        </p>
                        <p className="mt-1 text-2xl font-black text-slate-950">{completion.percent}%</p>
                        <p className="text-xs text-slate-600">
                            {completion.completed} of {completion.total} key context blocks filled
                        </p>
                    </div>
                    <button
                        type="button"
                        onClick={handleSave}
                        disabled={saving}
                        className="inline-flex items-center gap-2 rounded-2xl bg-slate-950 px-5 py-3 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                        <Save className="h-4 w-4" />
                        {saving ? "Saving..." : "Save Profile"}
                    </button>
                </div>
            </header>

            <section className="grid gap-4 md:grid-cols-3">
                {infoCards.map((card) => (
                    <div key={card.label} className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
                        <div className="flex items-center gap-3">
                            <div className="rounded-2xl bg-slate-100 p-3">
                                <card.icon className="h-5 w-5 text-slate-700" />
                            </div>
                            <div>
                                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">{card.label}</p>
                                <p className="mt-1 text-2xl font-black text-slate-950">{card.value}</p>
                            </div>
                        </div>
                    </div>
                ))}
            </section>

            <div className="grid gap-6 xl:grid-cols-[minmax(0,1.55fr)_minmax(320px,0.95fr)]">
                <div className="space-y-6">
                    <section className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-sm">
                        <div className="flex flex-col gap-5 md:flex-row md:items-start md:justify-between">
                            <div className="flex items-start gap-4">
                                {logo ? (
                                    <img
                                        src={logo}
                                        alt={form.name || organization.name}
                                        className="h-24 w-24 rounded-3xl border border-slate-200 bg-white object-contain p-3"
                                    />
                                ) : (
                                    <div className="flex h-24 w-24 items-center justify-center rounded-3xl bg-slate-100">
                                        <Building2 className="h-10 w-10 text-slate-400" />
                                    </div>
                                )}
                                <div className="space-y-2">
                                    <h2 className="text-lg font-bold text-slate-950">Identity and contact</h2>
                                    <p className="max-w-2xl text-sm text-slate-600">
                                        Start with the basics the team and the AI both need: institution identity, location,
                                        public contact points, and a short positioning statement.
                                    </p>
                                    <button
                                        type="button"
                                        onClick={() => fileRef.current?.click()}
                                        disabled={uploadingLogo}
                                        className="inline-flex items-center gap-2 rounded-xl border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
                                    >
                                        <ImagePlus className="h-4 w-4" />
                                        {uploadingLogo ? "Uploading logo..." : "Upload Logo"}
                                    </button>
                                    <input
                                        ref={fileRef}
                                        type="file"
                                        accept="image/*"
                                        className="hidden"
                                        onChange={(event) => handleLogoChange(event.target.files?.[0] || null)}
                                    />
                                </div>
                            </div>
                            <div className="rounded-2xl border border-amber-100 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                                <p className="font-semibold">Priority fields</p>
                                <p className="mt-1 text-xs leading-5 text-amber-800">
                                    Institution type, audience, subjects, document types, workflow needs, AI goals.
                                </p>
                            </div>
                        </div>

                        <div className="mt-6 grid gap-4 md:grid-cols-2">
                            <div className="space-y-2">
                                <FieldLabel title="Institution name" hint="This appears across the workspace and in AI context." />
                                <input
                                    value={form.name}
                                    onChange={(event) => updateField("name", event.target.value)}
                                    className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-sky-400 focus:ring-4 focus:ring-sky-100"
                                    placeholder="NACC Agriculture Institute"
                                />
                            </div>
                            <div className="space-y-2">
                                <FieldLabel title="Institution type" hint="School, coaching institute, academy, college, etc." />
                                <input
                                    list="org-type-options"
                                    value={form.orgType}
                                    onChange={(event) => updateField("orgType", event.target.value)}
                                    className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-sky-400 focus:ring-4 focus:ring-sky-100"
                                    placeholder="Coaching Institute"
                                />
                                <datalist id="org-type-options">
                                    {ORG_TYPE_OPTIONS.map((option) => (
                                        <option key={option} value={option} />
                                    ))}
                                </datalist>
                            </div>
                            <div className="space-y-2 md:col-span-2">
                                <FieldLabel title="Tagline" hint="One-line positioning statement used in briefs and creatives." />
                                <input
                                    value={form.tagline}
                                    onChange={(event) => updateField("tagline", event.target.value)}
                                    className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-sky-400 focus:ring-4 focus:ring-sky-100"
                                    placeholder="Competitive exam preparation with bilingual learning support"
                                />
                            </div>
                            <div className="space-y-2 md:col-span-2">
                                <FieldLabel title="About the institution" hint="What you do, what you are known for, and what kind of learners you serve." />
                                <textarea
                                    value={form.description}
                                    onChange={(event) => updateField("description", event.target.value)}
                                    rows={5}
                                    className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm leading-6 text-slate-900 outline-none transition focus:border-sky-400 focus:ring-4 focus:ring-sky-100"
                                    placeholder="Describe the institute in a way that helps AI understand the academic and business context."
                                />
                            </div>
                            <div className="space-y-2">
                                <FieldLabel title="Location" hint="Campus/locality, district, state or service region." />
                                <div className="relative">
                                    <MapPin className="pointer-events-none absolute left-4 top-3.5 h-4 w-4 text-slate-400" />
                                    <input
                                        value={form.location}
                                        onChange={(event) => updateField("location", event.target.value)}
                                        className="w-full rounded-2xl border border-slate-200 py-3 pl-11 pr-4 text-sm text-slate-900 outline-none transition focus:border-sky-400 focus:ring-4 focus:ring-sky-100"
                                        placeholder="Jaipur, Rajasthan"
                                    />
                                </div>
                            </div>
                            <div className="space-y-2">
                                <FieldLabel title="Website" hint="Optional public website or landing page." />
                                <div className="relative">
                                    <Globe className="pointer-events-none absolute left-4 top-3.5 h-4 w-4 text-slate-400" />
                                    <input
                                        value={form.website}
                                        onChange={(event) => updateField("website", event.target.value)}
                                        className="w-full rounded-2xl border border-slate-200 py-3 pl-11 pr-4 text-sm text-slate-900 outline-none transition focus:border-sky-400 focus:ring-4 focus:ring-sky-100"
                                        placeholder="www.example.com"
                                    />
                                </div>
                            </div>
                            <div className="space-y-2">
                                <FieldLabel title="Primary contact name" hint="Main person for approvals or strategic instructions." />
                                <input
                                    value={form.primaryContactName}
                                    onChange={(event) => updateField("primaryContactName", event.target.value)}
                                    className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-sky-400 focus:ring-4 focus:ring-sky-100"
                                    placeholder="Abhishek Mahala"
                                />
                            </div>
                            <div className="space-y-2">
                                <FieldLabel title="Contact phone" hint="Useful for internal reference and admin workflows." />
                                <div className="relative">
                                    <Phone className="pointer-events-none absolute left-4 top-3.5 h-4 w-4 text-slate-400" />
                                    <input
                                        value={form.contactPhone}
                                        onChange={(event) => updateField("contactPhone", event.target.value)}
                                        className="w-full rounded-2xl border border-slate-200 py-3 pl-11 pr-4 text-sm text-slate-900 outline-none transition focus:border-sky-400 focus:ring-4 focus:ring-sky-100"
                                        placeholder="+91 98765 43210"
                                    />
                                </div>
                            </div>
                            <div className="space-y-2 md:col-span-2">
                                <FieldLabel title="Contact email" hint="Email that should be associated with institution-level communication." />
                                <div className="relative">
                                    <Mail className="pointer-events-none absolute left-4 top-3.5 h-4 w-4 text-slate-400" />
                                    <input
                                        value={form.contactEmail}
                                        onChange={(event) => updateField("contactEmail", event.target.value)}
                                        className="w-full rounded-2xl border border-slate-200 py-3 pl-11 pr-4 text-sm text-slate-900 outline-none transition focus:border-sky-400 focus:ring-4 focus:ring-sky-100"
                                        placeholder="info@institute.com"
                                    />
                                </div>
                            </div>
                        </div>
                    </section>

                    <section className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-sm">
                        <h2 className="text-lg font-bold text-slate-950">Academic footprint</h2>
                        <p className="mt-2 text-sm text-slate-600">
                            These fields help the platform understand the academic scope before generating documents, exam material,
                            study resources, or campaign content.
                        </p>
                        <div className="mt-6 grid gap-4 md:grid-cols-2">
                            <div className="space-y-2 md:col-span-2">
                                <FieldLabel title="Audience summary" hint="Who are your primary students or learners?" />
                                <textarea
                                    value={form.audienceSummary}
                                    onChange={(event) => updateField("audienceSummary", event.target.value)}
                                    rows={4}
                                    className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm leading-6 text-slate-900 outline-none transition focus:border-sky-400 focus:ring-4 focus:ring-sky-100"
                                    placeholder="Competitive exam aspirants, rural Hindi-medium learners, UG agriculture students, etc."
                                />
                            </div>
                            <div className="space-y-2">
                                <FieldLabel title="Boards / exams" hint="One item per line or comma-separated." />
                                <textarea
                                    value={form.boards}
                                    onChange={(event) => updateField("boards", event.target.value)}
                                    rows={5}
                                    className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm leading-6 text-slate-900 outline-none transition focus:border-sky-400 focus:ring-4 focus:ring-sky-100"
                                    placeholder={"REET\nCUET\nAgriculture Supervisor"}
                                />
                            </div>
                            <div className="space-y-2">
                                <FieldLabel title="Class levels / cohorts" hint="What levels do you teach?" />
                                <textarea
                                    value={form.classLevels}
                                    onChange={(event) => updateField("classLevels", event.target.value)}
                                    rows={5}
                                    className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm leading-6 text-slate-900 outline-none transition focus:border-sky-400 focus:ring-4 focus:ring-sky-100"
                                    placeholder={"Class 9-10\nClass 11-12\nUG Agriculture"}
                                />
                            </div>
                            <div className="space-y-2">
                                <FieldLabel title="Subjects / domains" hint="The key subject areas you repeatedly work on." />
                                <textarea
                                    value={form.subjects}
                                    onChange={(event) => updateField("subjects", event.target.value)}
                                    rows={5}
                                    className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm leading-6 text-slate-900 outline-none transition focus:border-sky-400 focus:ring-4 focus:ring-sky-100"
                                    placeholder={"Biology\nAgriculture\nReasoning"}
                                />
                            </div>
                            <div className="space-y-2">
                                <FieldLabel title="Languages used" hint="Teaching and document languages." />
                                <div className="relative">
                                    <Languages className="pointer-events-none absolute left-4 top-3.5 h-4 w-4 text-slate-400" />
                                    <textarea
                                        value={form.languages}
                                        onChange={(event) => updateField("languages", event.target.value)}
                                        rows={5}
                                        className="w-full rounded-2xl border border-slate-200 py-3 pl-11 pr-4 text-sm leading-6 text-slate-900 outline-none transition focus:border-sky-400 focus:ring-4 focus:ring-sky-100"
                                        placeholder={"Hindi\nEnglish\nBilingual"}
                                    />
                                </div>
                            </div>
                        </div>
                    </section>

                    <section className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-sm">
                        <h2 className="text-lg font-bold text-slate-950">Documents, workflow and AI goals</h2>
                        <p className="mt-2 text-sm text-slate-600">
                            This is the part that makes the institution operationally understandable. If these fields are weak,
                            the product will stay generic.
                        </p>
                        <div className="mt-6 grid gap-4">
                            <div className="space-y-2">
                                <FieldLabel title="Document types you work with" hint="One per line or comma-separated." />
                                <textarea
                                    value={form.documentTypes}
                                    onChange={(event) => updateField("documentTypes", event.target.value)}
                                    rows={4}
                                    className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm leading-6 text-slate-900 outline-none transition focus:border-sky-400 focus:ring-4 focus:ring-sky-100"
                                    placeholder={DOCUMENT_TYPE_SUGGESTIONS.join("\n")}
                                />
                            </div>
                            <div className="grid gap-4 md:grid-cols-2">
                                <div className="space-y-2">
                                    <FieldLabel title="Workflow needs" hint="What recurring work should the product help with?" />
                                    <textarea
                                        value={form.workflowNeeds}
                                        onChange={(event) => updateField("workflowNeeds", event.target.value)}
                                        rows={6}
                                        className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm leading-6 text-slate-900 outline-none transition focus:border-sky-400 focus:ring-4 focus:ring-sky-100"
                                        placeholder="Convert PDFs to slides, extract questions with diagrams, prepare exam sets, translate Hinglish, organize books, etc."
                                    />
                                </div>
                                <div className="space-y-2">
                                    <FieldLabel title="AI goals" hint="What outcomes do you want AI to deliver for the institution?" />
                                    <textarea
                                        value={form.aiGoals}
                                        onChange={(event) => updateField("aiGoals", event.target.value)}
                                        rows={6}
                                        className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm leading-6 text-slate-900 outline-none transition focus:border-sky-400 focus:ring-4 focus:ring-sky-100"
                                        placeholder="Higher content throughput, faster question paper prep, admissions creatives, reusable bilingual assets, staff productivity, etc."
                                    />
                                </div>
                            </div>
                            <div className="grid gap-4 md:grid-cols-2">
                                <div className="space-y-2">
                                    <FieldLabel title="Creative needs" hint="What kind of promotional or visual content do you need?" />
                                    <textarea
                                        value={form.creativeNeeds}
                                        onChange={(event) => updateField("creativeNeeds", event.target.value)}
                                        rows={6}
                                        className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm leading-6 text-slate-900 outline-none transition focus:border-sky-400 focus:ring-4 focus:ring-sky-100"
                                        placeholder="Instagram posts, admission campaigns, results creatives, faculty spotlights, topper posts, brochure visuals, etc."
                                    />
                                </div>
                                <div className="space-y-2">
                                    <FieldLabel title="Notes for AI" hint="Important constraints, non-negotiables, or recurring instructions." />
                                    <textarea
                                        value={form.notesForAI}
                                        onChange={(event) => updateField("notesForAI", event.target.value)}
                                        rows={6}
                                        className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm leading-6 text-slate-900 outline-none transition focus:border-sky-400 focus:ring-4 focus:ring-sky-100"
                                        placeholder="Prefer bilingual outputs, keep exam language formal, highlight agriculture expertise, avoid exaggerated claims, etc."
                                    />
                                </div>
                            </div>
                            <div className="space-y-2">
                                <FieldLabel title="Brand tone" hint="How should the institution sound across generated content?" />
                                <input
                                    list="brand-tone-options"
                                    value={form.brandTone}
                                    onChange={(event) => updateField("brandTone", event.target.value)}
                                    className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-sky-400 focus:ring-4 focus:ring-sky-100"
                                    placeholder="Professional"
                                />
                                <datalist id="brand-tone-options">
                                    {BRAND_TONE_OPTIONS.map((option) => (
                                        <option key={option} value={option} />
                                    ))}
                                </datalist>
                            </div>
                        </div>
                    </section>
                </div>

                <aside className="space-y-6">
                    <section className="rounded-[28px] border border-slate-200 bg-slate-950 p-6 text-white shadow-sm">
                        <div className="flex items-center gap-3">
                            <div className="rounded-2xl bg-white/10 p-3">
                                <Sparkles className="h-5 w-5 text-sky-300" />
                            </div>
                            <div>
                                <p className="text-xs font-semibold uppercase tracking-[0.22em] text-sky-300">AI Context Preview</p>
                                <h2 className="text-lg font-bold">What the product can understand</h2>
                            </div>
                        </div>
                        <pre className="mt-5 whitespace-pre-wrap rounded-2xl bg-white/5 p-4 text-xs leading-6 text-slate-200">
                            {aiBrief || "Complete the profile to create institution-specific AI context."}
                        </pre>
                    </section>

                    <section className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-sm">
                        <div className="flex items-center gap-3">
                            <div className="rounded-2xl bg-slate-100 p-3">
                                <GraduationCap className="h-5 w-5 text-slate-700" />
                            </div>
                            <div>
                                <h2 className="text-lg font-bold text-slate-950">Next actions</h2>
                                <p className="text-sm text-slate-600">Use the profile immediately in workflow-heavy tools.</p>
                            </div>
                        </div>
                        <div className="mt-5 space-y-3">
                            <Link
                                href="/content-studio/extractor"
                                className="block rounded-2xl border border-slate-200 px-4 py-4 transition hover:bg-slate-50"
                            >
                                <p className="font-semibold text-slate-950">Open Institute Suite</p>
                                <p className="mt-1 text-sm text-slate-600">
                                    Extract questions, generate slides, and process institute documents.
                                </p>
                            </Link>
                            <Link
                                href="/library"
                                className="block rounded-2xl border border-slate-200 px-4 py-4 transition hover:bg-slate-50"
                            >
                                <p className="font-semibold text-slate-950">Open Library</p>
                                <p className="mt-1 text-sm text-slate-600">
                                    Add books and reference material the institute wants the system to work from.
                                </p>
                            </Link>
                            <Link
                                href="/org"
                                className="block rounded-2xl border border-slate-200 px-4 py-4 transition hover:bg-slate-50"
                            >
                                <p className="font-semibold text-slate-950">Back to Organization Overview</p>
                                <p className="mt-1 text-sm text-slate-600">
                                    Review members, tools, and overall workspace activity.
                                </p>
                            </Link>
                        </div>
                    </section>
                </aside>
            </div>
        </div>
    );
}
