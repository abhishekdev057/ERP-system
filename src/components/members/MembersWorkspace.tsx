"use client";

import { useEffect, useMemo, useState } from "react";
import toast from "react-hot-toast";
import {
    Briefcase,
    CalendarDays,
    ChevronDown,
    LoaderCircle,
    Mail,
    Search,
    Users,
} from "lucide-react";
import { AddressLookupInput, type AddressSuggestion } from "@/components/ui/AddressLookupInput";

type Member = {
    id: string;
    name: string | null;
    email: string | null;
    image: string | null;
    role: string;
    designation: string | null;
    staffRole: string | null;
    bio: string | null;
    location: string | null;
    salaryMonthly?: number | null;
    allowedTools?: string[];
    dateOfJoining: string | null;
    onboardingDone: boolean;
    createdAt: string;
    updatedAt?: string;
};

type MemberDraft = {
    name: string;
    designation: string;
    staffRole: string;
    bio: string;
    location: string;
    salaryMonthly: string;
    dateOfJoining: string;
};

const STAFF_ROLES = [
    "PRINCIPAL",
    "DIRECTOR",
    "MANAGER",
    "TEACHER",
    "CLASS_TEACHER",
    "SUBJECT_TEACHER",
    "DRIVER",
    "STORE_MANAGER",
    "SUPPORT_STAFF",
    "OTHER",
];

function buildDraft(member: Member | null): MemberDraft {
    return {
        name: member?.name || "",
        designation: member?.designation || "",
        staffRole: member?.staffRole || "",
        bio: member?.bio || "",
        location: member?.location || "",
        salaryMonthly: member?.salaryMonthly ? String(member.salaryMonthly) : "",
        dateOfJoining: member?.dateOfJoining ? member.dateOfJoining.split("T")[0] : "",
    };
}

function formatDate(value: string | null | undefined) {
    if (!value) return "Not recorded";
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return value;
    return parsed.toLocaleDateString("en-IN", {
        day: "2-digit",
        month: "short",
        year: "numeric",
    });
}

function MemberSkeletonCard() {
    return (
        <div className="rounded-[26px] border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex items-start gap-3">
                <div className="h-12 w-12 animate-pulse rounded-2xl bg-slate-200" />
                <div className="flex-1">
                    <div className="h-4 w-2/3 animate-pulse rounded-full bg-slate-200" />
                    <div className="mt-2 h-3 w-1/2 animate-pulse rounded-full bg-slate-100" />
                </div>
            </div>
        </div>
    );
}

export function MembersWorkspace() {
    const [members, setMembers] = useState<Member[]>([]);
    const [selectedMember, setSelectedMember] = useState<Member | null>(null);
    const [memberDraft, setMemberDraft] = useState<MemberDraft>(buildDraft(null));
    const [loading, setLoading] = useState(true);
    const [detailsLoading, setDetailsLoading] = useState(false);
    const [saving, setSaving] = useState(false);
    const [searchQuery, setSearchQuery] = useState("");
    const [onboardingFilter, setOnboardingFilter] = useState<"ALL" | "ONBOARDED" | "PENDING">("ALL");
    const [locationSuggestion, setLocationSuggestion] = useState<AddressSuggestion | null>(null);

    useEffect(() => {
        void fetchMembers();
    }, []);

    const fetchMembers = async () => {
        try {
            setLoading(true);
            const res = await fetch("/api/members");
            if (!res.ok) throw new Error("Failed to load staff members");
            const data = await res.json();
            setMembers(Array.isArray(data) ? data : []);
        } catch {
            toast.error("Could not load staff directory.");
        } finally {
            setLoading(false);
        }
    };

    const fetchMemberDetails = async (id: string) => {
        try {
            setDetailsLoading(true);
            const res = await fetch(`/api/members/${id}`);
            if (!res.ok) throw new Error("Failed to load details");
            const data = await res.json();
            setSelectedMember(data);
            setMemberDraft(buildDraft(data));
        } catch {
            toast.error("Could not load staff profile.");
        } finally {
            setDetailsLoading(false);
        }
    };

    const handleSaveMember = async () => {
        if (!selectedMember) return;
        try {
            setSaving(true);
            const res = await fetch(`/api/members/${selectedMember.id}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    name: memberDraft.name.trim(),
                    designation: memberDraft.designation.trim() || null,
                    staffRole: memberDraft.staffRole || null,
                    bio: memberDraft.bio.trim() || null,
                    location: memberDraft.location.trim() || null,
                    salaryMonthly: memberDraft.salaryMonthly.trim() || null,
                    dateOfJoining: memberDraft.dateOfJoining || null,
                }),
            });
            if (!res.ok) throw new Error("Failed to update member");
            toast.success("Staff profile saved");
            await Promise.all([fetchMemberDetails(selectedMember.id), fetchMembers()]);
        } catch {
            toast.error("Failed to update profile.");
        } finally {
            setSaving(false);
        }
    };

    const filteredMembers = useMemo(
        () =>
            members.filter((member) => {
                const search = searchQuery.toLowerCase();
                const matchesSearch =
                    (member.name || "").toLowerCase().includes(search) ||
                    (member.email || "").toLowerCase().includes(search) ||
                    (member.staffRole || "").toLowerCase().includes(search) ||
                    (member.location || "").toLowerCase().includes(search);

                const matchesOnboarding =
                    onboardingFilter === "ALL" ||
                    (onboardingFilter === "ONBOARDED" && member.onboardingDone) ||
                    (onboardingFilter === "PENDING" && !member.onboardingDone);

                return matchesSearch && matchesOnboarding;
            }),
        [members, onboardingFilter, searchQuery]
    );

    const metrics = useMemo(() => {
        const onboarded = members.filter((member) => member.onboardingDone).length;
        const pending = members.length - onboarded;
        const teachers = members.filter((member) =>
            ["TEACHER", "CLASS_TEACHER", "SUBJECT_TEACHER"].includes(member.staffRole || "")
        ).length;
        const leaders = members.filter((member) =>
            ["PRINCIPAL", "DIRECTOR", "MANAGER"].includes(member.staffRole || "")
        ).length;
        return { onboarded, pending, teachers, leaders };
    }, [members]);

    return (
        <section className="space-y-6 pb-10">
            <div className="grid gap-4 lg:grid-cols-4">
                {[
                    { label: "Staff Directory", value: members.length, note: "people in workspace" },
                    { label: "Onboarded", value: metrics.onboarded, note: "ready inside the suite" },
                    { label: "Teachers", value: metrics.teachers, note: "teaching-facing staff" },
                    { label: "Leadership", value: metrics.leaders, note: "principal / director / managers" },
                ].map((item, index) => (
                    <article
                        key={item.label}
                        className="rounded-[30px] border border-white/70 bg-white/85 p-5 shadow-[0_24px_60px_-30px_rgba(15,23,42,0.25)] backdrop-blur-xl"
                    >
                        <p className="text-[11px] font-bold uppercase tracking-[0.24em] text-slate-400">{item.label}</p>
                        <p className="mt-3 text-3xl font-semibold text-slate-950">{item.value}</p>
                        <p className="mt-1 text-sm text-slate-500">{item.note}</p>
                    </article>
                ))}
            </div>

            <div className="grid gap-6 xl:grid-cols-[360px_minmax(0,1fr)]">
                <article className="workspace-panel overflow-hidden bg-[linear-gradient(180deg,rgba(255,255,255,0.95),rgba(248,250,252,0.92))]">
                    <div className="workspace-panel-header border-b border-slate-100/80 bg-white/80">
                        <div>
                            <p className="text-[11px] font-bold uppercase tracking-[0.24em] text-blue-500">Members Desk</p>
                            <h3 className="mt-2 text-xl font-semibold text-slate-950">People and identities</h3>
                            <p className="mt-1 text-sm text-slate-500">
                                Maintain staff roles, location context, onboarding state, and internal people signals.
                            </p>
                        </div>

                        <div className="mt-4 space-y-3">
                            <div className="relative">
                                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                                <input
                                    value={searchQuery}
                                    onChange={(event) => setSearchQuery(event.target.value)}
                                    placeholder="Search by name, email, role, or base location..."
                                    className="w-full rounded-2xl border border-slate-200 bg-slate-50 pl-10 pr-4 py-3 text-sm outline-none transition focus:border-blue-400 focus:ring-4 focus:ring-blue-100/70"
                                />
                            </div>

                            <div className="flex flex-wrap gap-2">
                                {[
                                    { id: "ALL", label: "All staff" },
                                    { id: "ONBOARDED", label: "Onboarded" },
                                    { id: "PENDING", label: "Pending setup" },
                                ].map((item) => (
                                    <button
                                        key={item.id}
                                        type="button"
                                        onClick={() => setOnboardingFilter(item.id as typeof onboardingFilter)}
                                        className={`rounded-full border px-3 py-1.5 text-[11px] font-semibold transition ${
                                            onboardingFilter === item.id
                                                ? "border-blue-300 bg-blue-50 text-blue-700"
                                                : "border-slate-200 bg-white text-slate-500 hover:border-blue-200 hover:text-blue-600"
                                        }`}
                                    >
                                        {item.label}
                                    </button>
                                ))}
                            </div>
                        </div>
                    </div>

                    <div className="workspace-scroll space-y-3 p-4" style={{ minHeight: "min(760px, 72vh)" }}>
                        {loading ? (
                            <>
                                <MemberSkeletonCard />
                                <MemberSkeletonCard />
                                <MemberSkeletonCard />
                            </>
                        ) : filteredMembers.length ? (
                            filteredMembers.map((member) => (
                                <button
                                    key={member.id}
                                    type="button"
                                    onClick={() => fetchMemberDetails(member.id)}
                                    className={`w-full rounded-[26px] border p-4 text-left shadow-sm transition ${
                                        selectedMember?.id === member.id
                                            ? "border-blue-200 bg-blue-50/80"
                                            : "border-slate-200 bg-white hover:border-blue-200 hover:bg-blue-50/30"
                                    }`}
                                >
                                    <div className="flex items-start gap-3">
                                        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-[18px] bg-[linear-gradient(135deg,#93c5fd,#60a5fa)] text-base font-semibold text-white shadow-sm">
                                            {(member.name || "U").charAt(0)}
                                        </div>
                                        <div className="min-w-0 flex-1">
                                            <div className="flex items-start justify-between gap-3">
                                                <div className="min-w-0">
                                                    <p className="truncate text-base font-semibold text-slate-950">{member.name || "Unnamed"}</p>
                                                    <p className="truncate text-xs text-slate-500">{member.email || "No email"}</p>
                                                </div>
                                                <span className={`rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.22em] ${
                                                    member.onboardingDone
                                                        ? "border-emerald-200 bg-emerald-100 text-emerald-700"
                                                        : "border-amber-200 bg-amber-100 text-amber-700"
                                                }`}>
                                                    {member.onboardingDone ? "Ready" : "Pending"}
                                                </span>
                                            </div>
                                            <div className="mt-3 flex flex-wrap gap-2">
                                                {member.staffRole ? (
                                                    <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[10px] font-semibold text-slate-600">
                                                        {member.staffRole.replace(/_/g, " ")}
                                                    </span>
                                                ) : null}
                                                {member.designation ? (
                                                    <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[10px] font-semibold text-slate-600">
                                                        {member.designation}
                                                    </span>
                                                ) : null}
                                            </div>
                                        </div>
                                    </div>
                                </button>
                            ))
                        ) : (
                            <div className="rounded-[28px] border border-dashed border-slate-200 bg-slate-50/70 p-8 text-center">
                                <Users className="mx-auto h-10 w-10 text-slate-300" />
                                <p className="mt-4 text-sm font-semibold text-slate-700">No staff match the current filters</p>
                                <p className="mt-1 text-xs text-slate-500">Try a different search or onboarding view.</p>
                            </div>
                        )}
                    </div>
                </article>

                <article className="workspace-panel overflow-hidden bg-[linear-gradient(180deg,rgba(255,255,255,0.95),rgba(248,250,252,0.92))]">
                    {!selectedMember && !detailsLoading ? (
                        <div className="flex min-h-[760px] flex-col items-center justify-center px-10 text-center">
                            <div className="flex h-24 w-24 items-center justify-center rounded-[28px] bg-[linear-gradient(135deg,#dbeafe,#ecfeff)] text-blue-600 shadow-[0_20px_50px_-28px_rgba(37,99,235,0.45)]">
                                <Briefcase className="h-10 w-10" />
                            </div>
                            <h3 className="mt-6 text-2xl font-semibold text-slate-950">Select a staff identity</h3>
                            <p className="mt-2 max-w-md text-sm leading-6 text-slate-500">
                                Open a team member to manage role, designation, base location intelligence, bio, salary reference, and tool access visibility.
                            </p>
                        </div>
                    ) : detailsLoading ? (
                        <div className="flex min-h-[760px] items-center justify-center">
                            <div className="flex items-center gap-3 rounded-3xl border border-blue-100 bg-white px-5 py-4 shadow-sm">
                                <LoaderCircle className="h-5 w-5 animate-spin text-blue-500" />
                                <div>
                                    <p className="text-sm font-semibold text-slate-900">Loading staff profile</p>
                                    <p className="text-xs text-slate-500">Refreshing member record and access details...</p>
                                </div>
                            </div>
                        </div>
                    ) : selectedMember ? (
                        <div className="workspace-scroll p-6" style={{ minHeight: "min(760px, 72vh)" }}>
                            <div className="grid gap-5 xl:grid-cols-[minmax(0,1.1fr)_340px]">
                                <div className="space-y-5">
                                    <section className="relative overflow-hidden rounded-[30px] border border-blue-100 bg-[linear-gradient(135deg,#ffffff,#eff6ff_48%,#ecfeff)] p-6 shadow-[0_24px_60px_-30px_rgba(15,23,42,0.2)]">
                                        <div className="absolute right-5 top-5 rounded-full border border-white/70 bg-white/85 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.22em] text-blue-600">
                                            {selectedMember.onboardingDone ? "Onboarded" : "Pending setup"}
                                        </div>
                                        <div className="flex items-start gap-4">
                                            <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-[22px] bg-[linear-gradient(135deg,#3b82f6,#2563eb)] text-2xl font-semibold text-white shadow-lg shadow-blue-500/20">
                                                {(selectedMember.name || "U").charAt(0)}
                                            </div>
                                            <div className="min-w-0">
                                                <h3 className="text-2xl font-semibold text-slate-950">{selectedMember.name || "Unnamed"}</h3>
                                                <p className="mt-2 inline-flex items-center gap-2 text-sm text-slate-500">
                                                    <Mail className="h-4 w-4" />
                                                    {selectedMember.email || "No email on file"}
                                                </p>
                                                <div className="mt-3 flex flex-wrap gap-2">
                                                    <span className="rounded-full border border-slate-200 bg-white/80 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.22em] text-slate-600">
                                                        {selectedMember.role}
                                                    </span>
                                                    {selectedMember.staffRole ? (
                                                        <span className="rounded-full border border-blue-200 bg-blue-50 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.22em] text-blue-700">
                                                            {selectedMember.staffRole.replace(/_/g, " ")}
                                                        </span>
                                                    ) : null}
                                                </div>
                                            </div>
                                        </div>
                                        <div className="mt-5 grid gap-3 md:grid-cols-3">
                                            <div className="rounded-2xl border border-white/80 bg-white/80 p-4">
                                                <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-slate-400">Designation</p>
                                                <p className="mt-2 text-sm font-semibold text-slate-900">{selectedMember.designation || "Not assigned"}</p>
                                            </div>
                                            <div className="rounded-2xl border border-white/80 bg-white/80 p-4">
                                                <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-slate-400">Joined</p>
                                                <p className="mt-2 text-sm font-semibold text-slate-900">{formatDate(selectedMember.dateOfJoining)}</p>
                                            </div>
                                            <div className="rounded-2xl border border-white/80 bg-white/80 p-4">
                                                <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-slate-400">Tool access</p>
                                                <p className="mt-2 text-sm font-semibold text-slate-900">
                                                    {selectedMember.allowedTools?.length || 0} tool area(s)
                                                </p>
                                            </div>
                                        </div>
                                    </section>

                                    <section className="rounded-[30px] border border-slate-200 bg-white p-6 shadow-sm">
                                        <div className="flex items-start justify-between gap-3">
                                            <div>
                                                <p className="text-[11px] font-bold uppercase tracking-[0.24em] text-blue-500">Member profile</p>
                                                <h4 className="mt-2 text-xl font-semibold text-slate-950">Role and identity editor</h4>
                                            </div>
                                            <button
                                                type="button"
                                                onClick={handleSaveMember}
                                                disabled={saving}
                                                className="btn btn-primary rounded-2xl px-4 py-2 text-xs disabled:opacity-60"
                                            >
                                                {saving ? "Saving..." : "Save profile"}
                                            </button>
                                        </div>

                                        <div className="mt-5 grid gap-4 md:grid-cols-2">
                                            <label className="space-y-2">
                                                <span className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">Full Name</span>
                                                <input
                                                    value={memberDraft.name}
                                                    onChange={(event) => setMemberDraft((current) => ({ ...current, name: event.target.value }))}
                                                    className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none transition focus:border-blue-400 focus:ring-4 focus:ring-blue-100/70"
                                                />
                                            </label>
                                            <label className="space-y-2">
                                                <span className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">Designation</span>
                                                <input
                                                    value={memberDraft.designation}
                                                    onChange={(event) => setMemberDraft((current) => ({ ...current, designation: event.target.value }))}
                                                    className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none transition focus:border-blue-400 focus:ring-4 focus:ring-blue-100/70"
                                                />
                                            </label>
                                            <label className="space-y-2">
                                                <span className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">System Staff Role</span>
                                                <div className="relative">
                                                    <select
                                                        value={memberDraft.staffRole}
                                                        onChange={(event) => setMemberDraft((current) => ({ ...current, staffRole: event.target.value }))}
                                                        className="w-full appearance-none rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none transition focus:border-blue-400 focus:ring-4 focus:ring-blue-100/70"
                                                    >
                                                        <option value="">Unassigned</option>
                                                        {STAFF_ROLES.map((role) => (
                                                            <option key={role} value={role}>
                                                                {role.replace(/_/g, " ")}
                                                            </option>
                                                        ))}
                                                    </select>
                                                    <ChevronDown className="pointer-events-none absolute right-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                                                </div>
                                            </label>
                                            <label className="space-y-2">
                                                <span className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">Salary / Month</span>
                                                <input
                                                    value={memberDraft.salaryMonthly}
                                                    onChange={(event) => setMemberDraft((current) => ({ ...current, salaryMonthly: event.target.value }))}
                                                    placeholder="Optional"
                                                    className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none transition focus:border-blue-400 focus:ring-4 focus:ring-blue-100/70"
                                                />
                                            </label>
                                            <label className="space-y-2 md:col-span-2">
                                                <span className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">Location intelligence</span>
                                                <AddressLookupInput
                                                    value={memberDraft.location}
                                                    onChange={(value) => setMemberDraft((current) => ({ ...current, location: value }))}
                                                    onSelectSuggestion={setLocationSuggestion}
                                                    placeholder="Search village, city, district, state..."
                                                    inputClassName="w-full rounded-2xl border border-slate-200 bg-slate-50 pl-10 pr-4 py-3 text-sm outline-none transition focus:border-blue-400 focus:ring-4 focus:ring-blue-100/70"
                                                    panelClassName="relative z-20 mt-3 space-y-2 rounded-[24px] border border-slate-200 bg-white p-3 shadow-[0_24px_50px_-24px_rgba(15,23,42,0.3)]"
                                                    helperText="Open OSM-based suggestion search for village, district, city, and state hints."
                                                />
                                            </label>
                                            <label className="space-y-2">
                                                <span className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">Hire Date</span>
                                                <div className="relative">
                                                    <CalendarDays className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                                                    <input
                                                        type="date"
                                                        value={memberDraft.dateOfJoining}
                                                        onChange={(event) => setMemberDraft((current) => ({ ...current, dateOfJoining: event.target.value }))}
                                                        className="w-full rounded-2xl border border-slate-200 bg-slate-50 pl-10 pr-4 py-3 text-sm outline-none transition focus:border-blue-400 focus:ring-4 focus:ring-blue-100/70"
                                                    />
                                                </div>
                                            </label>
                                            <label className="space-y-2 md:col-span-2">
                                                <span className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">Bio / Notes</span>
                                                <textarea
                                                    value={memberDraft.bio}
                                                    onChange={(event) => setMemberDraft((current) => ({ ...current, bio: event.target.value }))}
                                                    rows={4}
                                                    className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none transition focus:border-blue-400 focus:ring-4 focus:ring-blue-100/70"
                                                />
                                            </label>
                                        </div>
                                    </section>
                                </div>

                                <aside className="space-y-5">
                                    <section className="rounded-[30px] border border-slate-200 bg-white p-5 shadow-sm">
                                        <p className="text-[11px] font-bold uppercase tracking-[0.24em] text-blue-500">Location intelligence</p>
                                        <div className="mt-4 grid gap-3">
                                            {[
                                                { label: "Village", value: locationSuggestion?.village || "—" },
                                                { label: "City", value: locationSuggestion?.city || "—" },
                                                { label: "District", value: locationSuggestion?.district || "—" },
                                                { label: "State", value: locationSuggestion?.state || "—" },
                                            ].map((item) => (
                                                <div key={item.label} className="rounded-2xl border border-slate-100 bg-slate-50/70 p-4">
                                                    <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-slate-400">{item.label}</p>
                                                    <p className="mt-2 text-sm font-semibold text-slate-900">{item.value}</p>
                                                </div>
                                            ))}
                                        </div>
                                    </section>

                                    <section className="rounded-[30px] border border-slate-200 bg-white p-5 shadow-sm">
                                        <p className="text-[11px] font-bold uppercase tracking-[0.24em] text-blue-500">Access visibility</p>
                                        <div className="mt-4 space-y-3">
                                            <div className="rounded-2xl border border-slate-100 bg-slate-50/70 p-4">
                                                <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-slate-400">System Role</p>
                                                <p className="mt-2 text-sm font-semibold text-slate-900">{selectedMember.role}</p>
                                            </div>
                                            <div className="rounded-2xl border border-slate-100 bg-slate-50/70 p-4">
                                                <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-slate-400">Allowed Tools</p>
                                                <div className="mt-2 flex flex-wrap gap-2">
                                                    {(selectedMember.allowedTools || []).length ? (
                                                        selectedMember.allowedTools!.map((tool) => (
                                                            <span key={tool} className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[10px] font-semibold text-slate-600">
                                                                {tool}
                                                            </span>
                                                        ))
                                                    ) : (
                                                        <span className="text-xs text-slate-500">Inherited or not explicitly set.</span>
                                                    )}
                                                </div>
                                            </div>
                                            <div className="rounded-2xl border border-slate-100 bg-slate-50/70 p-4">
                                                <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-slate-400">Onboarding state</p>
                                                <p className="mt-2 text-sm font-semibold text-slate-900">
                                                    {selectedMember.onboardingDone ? "Fully onboarded" : "Still pending profile completion"}
                                                </p>
                                                <p className="mt-1 text-xs text-slate-500">
                                                    Last update {formatDate(selectedMember.updatedAt || selectedMember.createdAt)}
                                                </p>
                                            </div>
                                        </div>
                                    </section>
                                </aside>
                            </div>
                        </div>
                    ) : null}
                </article>
            </div>
        </section>
    );
}
