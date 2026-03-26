"use client";

import { useEffect, useMemo, useState } from "react";
import toast from "react-hot-toast";
import {
    ArrowUpRight,
    Filter,
    GraduationCap,
    LoaderCircle,
    Mail,
    MessageSquare,
    Phone,
    Plus,
    Search,
    Send,
    Sparkles,
    User,
    Users,
    X,
} from "lucide-react";
import { AddressLookupInput, type AddressSuggestion } from "@/components/ui/AddressLookupInput";

type Student = {
    id: string;
    name: string;
    phone: string | null;
    email: string | null;
    status: "LEAD" | "ACTIVE" | "ALUMNI" | "DROPOUT";
    leadConfidence: "COLD" | "WARM" | "HOT" | null;
    tags: string[];
    location: string | null;
    classLevel: string | null;
    createdAt: string;
    conversations?: Conversation[];
    assignedUser?: { id: string; name: string | null; image: string | null; designation: string | null } | null;
};

type Conversation = {
    id: string;
    remark: string;
    channel: "WHATSAPP" | "PHONE" | "EMAIL" | "IN_PERSON" | "OTHER";
    date: string;
    member?: { name: string; designation: string | null };
};

type StudentDraft = {
    name: string;
    phone: string;
    email: string;
    location: string;
    classLevel: string;
    tags: string;
};

type LeadForm = {
    name: string;
    phone: string;
    email: string;
    location: string;
    classLevel: string;
};

const STATUS_OPTIONS = ["ALL", "LEAD", "ACTIVE", "ALUMNI", "DROPOUT"] as const;
const CONFIDENCE_OPTIONS = ["COLD", "WARM", "HOT"] as const;

function createEmptyLeadForm(): LeadForm {
    return {
        name: "",
        phone: "",
        email: "",
        location: "",
        classLevel: "",
    };
}

function buildStudentDraft(student: Student | null): StudentDraft {
    return {
        name: student?.name || "",
        phone: student?.phone || "",
        email: student?.email || "",
        location: student?.location || "",
        classLevel: student?.classLevel || "",
        tags: Array.isArray(student?.tags) ? student!.tags.join(", ") : "",
    };
}

function statusTone(status: Student["status"], confidence: Student["leadConfidence"]) {
    if (status === "ACTIVE") return "bg-emerald-100 text-emerald-700 border-emerald-200";
    if (status === "ALUMNI") return "bg-blue-100 text-blue-700 border-blue-200";
    if (status === "DROPOUT") return "bg-rose-100 text-rose-700 border-rose-200";
    if (confidence === "HOT") return "bg-rose-100 text-rose-700 border-rose-200";
    if (confidence === "WARM") return "bg-amber-100 text-amber-700 border-amber-200";
    return "bg-slate-100 text-slate-700 border-slate-200";
}

function formatDateTime(value: string) {
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return value;
    return parsed.toLocaleString("en-IN", {
        day: "2-digit",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
    });
}

function SkeletonCard() {
    return (
        <div className="rounded-3xl border border-slate-200 bg-white/90 p-4 shadow-sm">
            <div className="h-4 w-28 animate-pulse rounded-full bg-slate-200" />
            <div className="mt-3 h-6 w-3/4 animate-pulse rounded-full bg-slate-200" />
            <div className="mt-2 h-4 w-1/2 animate-pulse rounded-full bg-slate-100" />
        </div>
    );
}

export function StudentsWorkspace() {
    const [students, setStudents] = useState<Student[]>([]);
    const [selectedStudent, setSelectedStudent] = useState<Student | null>(null);
    const [studentDraft, setStudentDraft] = useState<StudentDraft>(buildStudentDraft(null));
    const [loading, setLoading] = useState(true);
    const [detailsLoading, setDetailsLoading] = useState(false);
    const [searchQuery, setSearchQuery] = useState("");
    const [statusFilter, setStatusFilter] = useState<(typeof STATUS_OPTIONS)[number]>("ALL");
    const [remarkText, setRemarkText] = useState("");
    const [remarkChannel, setRemarkChannel] = useState("PHONE");
    const [savingProfile, setSavingProfile] = useState(false);
    const [sendingRemark, setSendingRemark] = useState(false);
    const [isAddLeadModalOpen, setIsAddLeadModalOpen] = useState(false);
    const [leadForm, setLeadForm] = useState<LeadForm>(createEmptyLeadForm());
    const [leadLocationSuggestion, setLeadLocationSuggestion] = useState<AddressSuggestion | null>(null);
    const [studentLocationSuggestion, setStudentLocationSuggestion] = useState<AddressSuggestion | null>(null);

    useEffect(() => {
        void fetchStudents();
    }, []);

    const fetchStudents = async () => {
        try {
            setLoading(true);
            const res = await fetch("/api/students");
            if (!res.ok) throw new Error("Failed to load students");
            const data = await res.json();
            setStudents(Array.isArray(data) ? data : []);
        } catch {
            toast.error("Could not load student directory.");
        } finally {
            setLoading(false);
        }
    };

    const fetchStudentDetails = async (id: string) => {
        try {
            setDetailsLoading(true);
            const res = await fetch(`/api/students/${id}`);
            if (!res.ok) throw new Error("Failed to load details");
            const data = await res.json();
            setSelectedStudent(data);
            setStudentDraft(buildStudentDraft(data));
        } catch {
            toast.error("Could not load student profile.");
        } finally {
            setDetailsLoading(false);
        }
    };

    const handleCreateLead = async (event: React.FormEvent) => {
        event.preventDefault();
        try {
            const res = await fetch("/api/students", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    ...leadForm,
                    status: "LEAD",
                    leadConfidence: "WARM",
                }),
            });
            if (!res.ok) throw new Error("Failed to create");
            toast.success("Lead registered!");
            setLeadForm(createEmptyLeadForm());
            setLeadLocationSuggestion(null);
            setIsAddLeadModalOpen(false);
            await fetchStudents();
        } catch {
            toast.error("Error creating lead.");
        }
    };

    const handleUpdateStatus = async (status: Student["status"], confidence?: Student["leadConfidence"]) => {
        if (!selectedStudent) return;
        try {
            const res = await fetch(`/api/students/${selectedStudent.id}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    status,
                    ...(confidence ? { leadConfidence: confidence } : {}),
                }),
            });
            if (!res.ok) throw new Error("Update failed");
            toast.success("Student status updated");
            await Promise.all([fetchStudentDetails(selectedStudent.id), fetchStudents()]);
        } catch {
            toast.error("Failed to update student.");
        }
    };

    const handleSaveProfile = async () => {
        if (!selectedStudent) return;
        try {
            setSavingProfile(true);
            const res = await fetch(`/api/students/${selectedStudent.id}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    name: studentDraft.name.trim(),
                    phone: studentDraft.phone.trim() || null,
                    email: studentDraft.email.trim() || null,
                    location: studentDraft.location.trim() || null,
                    classLevel: studentDraft.classLevel.trim() || null,
                    tags: studentDraft.tags
                        .split(",")
                        .map((item) => item.trim())
                        .filter(Boolean),
                }),
            });
            if (!res.ok) throw new Error("Save failed");
            toast.success("Student profile saved");
            await Promise.all([fetchStudentDetails(selectedStudent.id), fetchStudents()]);
        } catch {
            toast.error("Failed to save profile.");
        } finally {
            setSavingProfile(false);
        }
    };

    const handleAddRemark = async (event: React.FormEvent) => {
        event.preventDefault();
        if (!selectedStudent || !remarkText.trim()) return;

        try {
            setSendingRemark(true);
            const res = await fetch(`/api/students/${selectedStudent.id}/conversations`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    remark: remarkText,
                    channel: remarkChannel,
                }),
            });
            if (!res.ok) throw new Error("Failed to add remark");
            setRemarkText("");
            toast.success("Timeline updated");
            await fetchStudentDetails(selectedStudent.id);
        } catch {
            toast.error("Error adding remark");
        } finally {
            setSendingRemark(false);
        }
    };

    const filteredStudents = useMemo(
        () =>
            students.filter((student) => {
                const matchesSearch =
                    student.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
                    (student.phone && student.phone.includes(searchQuery)) ||
                    (student.location && student.location.toLowerCase().includes(searchQuery.toLowerCase()));

                const matchesStatus = statusFilter === "ALL" || student.status === statusFilter;
                return matchesSearch && matchesStatus;
            }),
        [searchQuery, statusFilter, students]
    );

    const metrics = useMemo(() => {
        const activeCount = students.filter((student) => student.status === "ACTIVE").length;
        const leadCount = students.filter((student) => student.status === "LEAD").length;
        const hotCount = students.filter((student) => student.leadConfidence === "HOT").length;
        const alumniCount = students.filter((student) => student.status === "ALUMNI").length;
        return { activeCount, leadCount, hotCount, alumniCount };
    }, [students]);

    return (
        <section className="space-y-6 pb-10">
            <div className="grid gap-4 lg:grid-cols-4">
                {[
                    { label: "Directory", value: students.length, note: "tracked student profiles", tone: "from-violet-500 to-fuchsia-500" },
                    { label: "Active", value: metrics.activeCount, note: "currently enrolled", tone: "from-emerald-500 to-teal-500" },
                    { label: "Lead Heat", value: metrics.hotCount, note: "hot leads waiting", tone: "from-rose-500 to-orange-500" },
                    { label: "Alumni", value: metrics.alumniCount, note: "graduated journeys", tone: "from-blue-500 to-cyan-500" },
                ].map((card) => (
                    <article
                        key={card.label}
                        className="relative overflow-hidden rounded-[30px] border border-white/70 bg-white/85 p-5 shadow-[0_24px_60px_-30px_rgba(15,23,42,0.25)] backdrop-blur-xl"
                    >
                        <div className={`absolute inset-x-0 top-0 h-1 bg-gradient-to-r ${card.tone}`} />
                        <p className="text-[11px] font-bold uppercase tracking-[0.24em] text-slate-400">{card.label}</p>
                        <p className="mt-3 text-3xl font-semibold text-slate-950">{card.value}</p>
                        <p className="mt-1 text-sm text-slate-500">{card.note}</p>
                    </article>
                ))}
            </div>

            <div className="grid gap-6 xl:grid-cols-[360px_minmax(0,1fr)]">
                <article className="workspace-panel overflow-hidden bg-[linear-gradient(180deg,rgba(255,255,255,0.95),rgba(248,250,252,0.92))]">
                    <div className="workspace-panel-header border-b border-slate-100/80 bg-white/80">
                        <div className="flex items-start justify-between gap-3">
                            <div>
                                <p className="text-[11px] font-bold uppercase tracking-[0.24em] text-violet-500">Student Directory</p>
                                <h3 className="mt-2 text-xl font-semibold text-slate-950">Enrollment pipeline</h3>
                                <p className="mt-1 text-sm text-slate-500">
                                    Search, filter, and jump straight into lead or active profiles.
                                </p>
                            </div>
                            <button
                                type="button"
                                onClick={() => setIsAddLeadModalOpen(true)}
                                className="btn btn-primary gap-2 rounded-2xl px-4 py-2 text-xs"
                            >
                                <Plus className="h-4 w-4" />
                                New Lead
                            </button>
                        </div>

                        <div className="mt-4 space-y-3">
                            <div className="relative">
                                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                                <input
                                    type="text"
                                    value={searchQuery}
                                    onChange={(event) => setSearchQuery(event.target.value)}
                                    placeholder="Search by name, phone, or location..."
                                    className="w-full rounded-2xl border border-slate-200 bg-slate-50 pl-10 pr-4 py-3 text-sm outline-none transition focus:border-violet-400 focus:ring-4 focus:ring-violet-100/70"
                                />
                            </div>

                            <div className="flex flex-wrap gap-2">
                                {STATUS_OPTIONS.map((status) => (
                                    <button
                                        key={status}
                                        type="button"
                                        onClick={() => setStatusFilter(status)}
                                        className={`rounded-full border px-3 py-1.5 text-[11px] font-semibold transition ${
                                            statusFilter === status
                                                ? "border-violet-300 bg-violet-50 text-violet-700"
                                                : "border-slate-200 bg-white text-slate-500 hover:border-violet-200 hover:text-violet-600"
                                        }`}
                                    >
                                        {status === "ALL" ? "All" : status.replace("_", " ")}
                                    </button>
                                ))}
                            </div>
                        </div>
                    </div>

                    <div className="workspace-scroll space-y-3 p-4" style={{ minHeight: "min(760px, 72vh)" }}>
                        {loading ? (
                            <>
                                <SkeletonCard />
                                <SkeletonCard />
                                <SkeletonCard />
                            </>
                        ) : filteredStudents.length ? (
                            filteredStudents.map((student) => (
                                <button
                                    key={student.id}
                                    type="button"
                                    onClick={() => fetchStudentDetails(student.id)}
                                    className={`w-full rounded-[26px] border p-4 text-left shadow-sm transition ${
                                        selectedStudent?.id === student.id
                                            ? "border-violet-200 bg-violet-50/80"
                                            : "border-slate-200 bg-white hover:border-violet-200 hover:bg-violet-50/30"
                                    }`}
                                >
                                    <div className="flex items-start justify-between gap-3">
                                        <div className="min-w-0">
                                            <p className="truncate text-base font-semibold text-slate-950">{student.name}</p>
                                            <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-slate-500">
                                                {student.phone ? <span className="inline-flex items-center gap-1"><Phone className="h-3.5 w-3.5" />{student.phone}</span> : null}
                                                {student.classLevel ? <span className="inline-flex items-center gap-1"><GraduationCap className="h-3.5 w-3.5" />{student.classLevel}</span> : null}
                                            </div>
                                            {student.location ? (
                                                <p className="mt-2 line-clamp-1 text-xs text-slate-500">{student.location}</p>
                                            ) : null}
                                        </div>
                                        <span className={`rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.22em] ${statusTone(student.status, student.leadConfidence)}`}>
                                            {student.status === "LEAD" ? `Lead ${student.leadConfidence || ""}`.trim() : student.status}
                                        </span>
                                    </div>
                                </button>
                            ))
                        ) : (
                            <div className="rounded-[28px] border border-dashed border-slate-200 bg-slate-50/70 p-8 text-center">
                                <Filter className="mx-auto h-10 w-10 text-slate-300" />
                                <p className="mt-4 text-sm font-semibold text-slate-700">No students match this filter</p>
                                <p className="mt-1 text-xs text-slate-500">Try a different search or clear the status filter.</p>
                            </div>
                        )}
                    </div>
                </article>

                <article className="workspace-panel overflow-hidden bg-[linear-gradient(180deg,rgba(255,255,255,0.95),rgba(248,250,252,0.92))]">
                    {!selectedStudent && !detailsLoading ? (
                        <div className="flex min-h-[760px] flex-col items-center justify-center px-10 text-center">
                            <div className="flex h-24 w-24 items-center justify-center rounded-[28px] bg-[linear-gradient(135deg,#ede9fe,#dbeafe)] text-violet-600 shadow-[0_20px_50px_-28px_rgba(99,102,241,0.45)]">
                                <Users className="h-10 w-10" />
                            </div>
                            <h3 className="mt-6 text-2xl font-semibold text-slate-950">Select a student journey</h3>
                            <p className="mt-2 max-w-md text-sm leading-6 text-slate-500">
                                Open a lead or active student to manage contact context, location insights, class focus, and conversation history from one polished workspace.
                            </p>
                        </div>
                    ) : detailsLoading ? (
                        <div className="flex min-h-[760px] items-center justify-center">
                            <div className="flex items-center gap-3 rounded-3xl border border-violet-100 bg-white px-5 py-4 shadow-sm">
                                <LoaderCircle className="h-5 w-5 animate-spin text-violet-500" />
                                <div>
                                    <p className="text-sm font-semibold text-slate-900">Loading student profile</p>
                                    <p className="text-xs text-slate-500">Pulling latest conversations and details...</p>
                                </div>
                            </div>
                        </div>
                    ) : selectedStudent ? (
                        <div className="workspace-scroll p-6" style={{ minHeight: "min(760px, 72vh)" }}>
                            <div className="grid gap-5 xl:grid-cols-[minmax(0,1.1fr)_340px]">
                                <div className="space-y-5">
                                    <section className="relative overflow-hidden rounded-[30px] border border-violet-100 bg-[linear-gradient(135deg,#ffffff,#f5f3ff_48%,#eff6ff)] p-6 shadow-[0_24px_60px_-30px_rgba(15,23,42,0.2)]">
                                        <div className="absolute right-5 top-5 rounded-full border border-white/70 bg-white/80 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.22em] text-violet-600">
                                            {selectedStudent.status}
                                        </div>
                                        <div className="flex items-start gap-4">
                                            <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-[22px] bg-[linear-gradient(135deg,#8b5cf6,#6366f1)] text-2xl font-semibold text-white shadow-lg shadow-violet-500/20">
                                                {selectedStudent.name.charAt(0)}
                                            </div>
                                            <div className="min-w-0">
                                                <h3 className="text-2xl font-semibold text-slate-950">{selectedStudent.name}</h3>
                                                <div className="mt-3 flex flex-wrap gap-2">
                                                    <span className={`rounded-full border px-3 py-1 text-[10px] font-bold uppercase tracking-[0.22em] ${statusTone(selectedStudent.status, selectedStudent.leadConfidence)}`}>
                                                        {selectedStudent.status === "LEAD" ? `Lead ${selectedStudent.leadConfidence || ""}`.trim() : selectedStudent.status}
                                                    </span>
                                                    {selectedStudent.assignedUser?.name ? (
                                                        <span className="rounded-full border border-slate-200 bg-white/80 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.22em] text-slate-500">
                                                            Owner · {selectedStudent.assignedUser.name}
                                                        </span>
                                                    ) : null}
                                                </div>
                                            </div>
                                        </div>
                                        <div className="mt-5 grid gap-3 md:grid-cols-3">
                                            <div className="rounded-2xl border border-white/80 bg-white/80 p-4">
                                                <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-slate-400">Phone</p>
                                                <p className="mt-2 text-sm font-semibold text-slate-900">{selectedStudent.phone || "Not added yet"}</p>
                                            </div>
                                            <div className="rounded-2xl border border-white/80 bg-white/80 p-4">
                                                <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-slate-400">Class Focus</p>
                                                <p className="mt-2 text-sm font-semibold text-slate-900">{selectedStudent.classLevel || "Not defined"}</p>
                                            </div>
                                            <div className="rounded-2xl border border-white/80 bg-white/80 p-4">
                                                <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-slate-400">Joined pipeline</p>
                                                <p className="mt-2 text-sm font-semibold text-slate-900">{formatDateTime(selectedStudent.createdAt)}</p>
                                            </div>
                                        </div>
                                    </section>

                                    <section className="rounded-[30px] border border-slate-200 bg-white p-6 shadow-sm">
                                        <div className="flex items-start justify-between gap-3">
                                            <div>
                                                <p className="text-[11px] font-bold uppercase tracking-[0.24em] text-violet-500">Student profile</p>
                                                <h4 className="mt-2 text-xl font-semibold text-slate-950">Identity and contact desk</h4>
                                            </div>
                                            <button
                                                type="button"
                                                onClick={handleSaveProfile}
                                                disabled={savingProfile}
                                                className="btn btn-primary rounded-2xl px-4 py-2 text-xs disabled:opacity-60"
                                            >
                                                {savingProfile ? "Saving..." : "Save profile"}
                                            </button>
                                        </div>

                                        <div className="mt-5 grid gap-4 md:grid-cols-2">
                                            <label className="space-y-2">
                                                <span className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">Full Name</span>
                                                <input
                                                    value={studentDraft.name}
                                                    onChange={(event) => setStudentDraft((current) => ({ ...current, name: event.target.value }))}
                                                    className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none transition focus:border-violet-400 focus:ring-4 focus:ring-violet-100/70"
                                                />
                                            </label>
                                            <label className="space-y-2">
                                                <span className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">Phone</span>
                                                <input
                                                    value={studentDraft.phone}
                                                    onChange={(event) => setStudentDraft((current) => ({ ...current, phone: event.target.value }))}
                                                    className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none transition focus:border-violet-400 focus:ring-4 focus:ring-violet-100/70"
                                                />
                                            </label>
                                            <label className="space-y-2">
                                                <span className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">Email</span>
                                                <input
                                                    value={studentDraft.email}
                                                    onChange={(event) => setStudentDraft((current) => ({ ...current, email: event.target.value }))}
                                                    className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none transition focus:border-violet-400 focus:ring-4 focus:ring-violet-100/70"
                                                />
                                            </label>
                                            <label className="space-y-2">
                                                <span className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">Target Class</span>
                                                <input
                                                    value={studentDraft.classLevel}
                                                    onChange={(event) => setStudentDraft((current) => ({ ...current, classLevel: event.target.value }))}
                                                    className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none transition focus:border-violet-400 focus:ring-4 focus:ring-violet-100/70"
                                                />
                                            </label>
                                            <div className="md:col-span-2">
                                                <label className="space-y-2">
                                                    <span className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">Location intelligence</span>
                                                    <AddressLookupInput
                                                        value={studentDraft.location}
                                                        onChange={(value) =>
                                                            setStudentDraft((current) => ({ ...current, location: value }))
                                                        }
                                                        onSelectSuggestion={setStudentLocationSuggestion}
                                                        placeholder="Search village, city, district, state..."
                                                        inputClassName="w-full rounded-2xl border border-slate-200 bg-slate-50 pl-10 pr-4 py-3 text-sm outline-none transition focus:border-violet-400 focus:ring-4 focus:ring-violet-100/70"
                                                        panelClassName="relative z-20 mt-3 space-y-2 rounded-[24px] border border-slate-200 bg-white p-3 shadow-[0_24px_50px_-24px_rgba(15,23,42,0.3)]"
                                                        helperText="Powered by open OSM-based search. Pick a suggestion to preserve village, city, district, and state context."
                                                    />
                                                </label>
                                            </div>
                                            <label className="space-y-2 md:col-span-2">
                                                <span className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">Tags</span>
                                                <input
                                                    value={studentDraft.tags}
                                                    onChange={(event) => setStudentDraft((current) => ({ ...current, tags: event.target.value }))}
                                                    placeholder="agriculture, scholarship, hostel, warm lead"
                                                    className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none transition focus:border-violet-400 focus:ring-4 focus:ring-violet-100/70"
                                                />
                                            </label>
                                        </div>
                                    </section>

                                    <section className="rounded-[30px] border border-slate-200 bg-white p-6 shadow-sm">
                                        <div className="flex items-start justify-between gap-3">
                                            <div>
                                                <p className="text-[11px] font-bold uppercase tracking-[0.24em] text-violet-500">Timeline</p>
                                                <h4 className="mt-2 text-xl font-semibold text-slate-950">Conversation history</h4>
                                            </div>
                                            <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-[11px] font-semibold text-slate-500">
                                                {selectedStudent.conversations?.length || 0} entries
                                            </span>
                                        </div>

                                        <div className="mt-5 space-y-4">
                                            {selectedStudent.conversations?.length ? (
                                                selectedStudent.conversations.map((conversation) => (
                                                    <div key={conversation.id} className="flex gap-4 rounded-[24px] border border-slate-100 bg-slate-50/70 p-4">
                                                        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-white text-violet-600 shadow-sm">
                                                            {conversation.channel === "PHONE" ? (
                                                                <Phone className="h-4 w-4" />
                                                            ) : conversation.channel === "WHATSAPP" ? (
                                                                <MessageSquare className="h-4 w-4" />
                                                            ) : conversation.channel === "EMAIL" ? (
                                                                <Mail className="h-4 w-4" />
                                                            ) : (
                                                                <User className="h-4 w-4" />
                                                            )}
                                                        </div>
                                                        <div className="min-w-0 flex-1">
                                                            <div className="flex flex-wrap items-center gap-2">
                                                                <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.22em] text-slate-500">
                                                                    {conversation.channel}
                                                                </span>
                                                                <span className="text-xs text-slate-400">{formatDateTime(conversation.date)}</span>
                                                            </div>
                                                            <p className="mt-2 text-sm leading-6 text-slate-700">{conversation.remark}</p>
                                                            {conversation.member?.name ? (
                                                                <p className="mt-2 text-xs text-slate-500">
                                                                    Logged by <span className="font-semibold text-slate-700">{conversation.member.name}</span>
                                                                </p>
                                                            ) : null}
                                                        </div>
                                                    </div>
                                                ))
                                            ) : (
                                                <div className="rounded-[24px] border border-dashed border-slate-200 bg-slate-50/70 p-6 text-center text-sm text-slate-500">
                                                    No conversation history yet. Add the first remark below.
                                                </div>
                                            )}
                                        </div>
                                    </section>
                                </div>

                                <aside className="space-y-5">
                                    <section className="rounded-[30px] border border-slate-200 bg-white p-5 shadow-sm">
                                        <p className="text-[11px] font-bold uppercase tracking-[0.24em] text-violet-500">Lead controls</p>
                                        <div className="mt-4 space-y-3">
                                            <div className="grid gap-2">
                                                {CONFIDENCE_OPTIONS.map((confidence) => (
                                                    <button
                                                        key={confidence}
                                                        type="button"
                                                        onClick={() => handleUpdateStatus("LEAD", confidence)}
                                                        className={`rounded-2xl border px-4 py-3 text-left text-sm font-semibold transition ${
                                                            selectedStudent.leadConfidence === confidence && selectedStudent.status === "LEAD"
                                                                ? "border-violet-200 bg-violet-50 text-violet-700"
                                                                : "border-slate-200 bg-slate-50 text-slate-600 hover:border-violet-200 hover:bg-violet-50/60"
                                                        }`}
                                                    >
                                                        Mark as {confidence}
                                                    </button>
                                                ))}
                                            </div>
                                            <button
                                                type="button"
                                                onClick={() => handleUpdateStatus("ACTIVE")}
                                                className="btn btn-primary w-full justify-center rounded-2xl px-4 py-3 text-sm"
                                            >
                                                <ArrowUpRight className="h-4 w-4" />
                                                Enroll as Active
                                            </button>
                                        </div>
                                    </section>

                                    <section className="rounded-[30px] border border-slate-200 bg-white p-5 shadow-sm">
                                        <p className="text-[11px] font-bold uppercase tracking-[0.24em] text-violet-500">Quick signals</p>
                                        <div className="mt-4 grid gap-3">
                                            <div className="rounded-2xl border border-slate-100 bg-slate-50/70 p-4">
                                                <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-slate-400">Location</p>
                                                <p className="mt-2 text-sm font-semibold text-slate-900">
                                                    {studentLocationSuggestion?.city || studentLocationSuggestion?.district || selectedStudent.location || "Not mapped yet"}
                                                </p>
                                                <p className="mt-1 text-xs text-slate-500">
                                                    {studentLocationSuggestion?.state || "Search to enrich village / city / state context."}
                                                </p>
                                            </div>
                                            <div className="rounded-2xl border border-slate-100 bg-slate-50/70 p-4">
                                                <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-slate-400">Tags</p>
                                                <div className="mt-2 flex flex-wrap gap-2">
                                                    {(selectedStudent.tags || []).length ? (
                                                        selectedStudent.tags.map((tag) => (
                                                            <span key={tag} className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[10px] font-semibold text-slate-600">
                                                                {tag}
                                                            </span>
                                                        ))
                                                    ) : (
                                                        <span className="text-xs text-slate-500">No tags attached yet.</span>
                                                    )}
                                                </div>
                                            </div>
                                            <div className="rounded-2xl border border-slate-100 bg-slate-50/70 p-4">
                                                <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-slate-400">Assignment</p>
                                                <p className="mt-2 text-sm font-semibold text-slate-900">
                                                    {selectedStudent.assignedUser?.name || "Unassigned"}
                                                </p>
                                                <p className="mt-1 text-xs text-slate-500">
                                                    {selectedStudent.assignedUser?.designation || "No owner mapped yet."}
                                                </p>
                                            </div>
                                        </div>
                                    </section>

                                    <section className="rounded-[30px] border border-slate-200 bg-white p-5 shadow-sm">
                                        <p className="text-[11px] font-bold uppercase tracking-[0.24em] text-violet-500">Add timeline note</p>
                                        <form onSubmit={handleAddRemark} className="mt-4 space-y-3">
                                            <select
                                                value={remarkChannel}
                                                onChange={(event) => setRemarkChannel(event.target.value)}
                                                className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none transition focus:border-violet-400 focus:ring-4 focus:ring-violet-100/70"
                                            >
                                                <option value="PHONE">Phone Call</option>
                                                <option value="WHATSAPP">WhatsApp</option>
                                                <option value="IN_PERSON">In Person</option>
                                                <option value="EMAIL">Email</option>
                                                <option value="OTHER">Other</option>
                                            </select>
                                            <textarea
                                                value={remarkText}
                                                onChange={(event) => setRemarkText(event.target.value)}
                                                placeholder="Log a call summary, admission interest, follow-up, scholarship note, or parent discussion..."
                                                className="min-h-[130px] w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none transition focus:border-violet-400 focus:ring-4 focus:ring-violet-100/70"
                                            />
                                            <button
                                                type="submit"
                                                disabled={!remarkText.trim() || sendingRemark}
                                                className="btn btn-primary w-full justify-center rounded-2xl px-4 py-3 text-sm disabled:opacity-60"
                                            >
                                                {sendingRemark ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                                                {sendingRemark ? "Saving note..." : "Add conversation note"}
                                            </button>
                                        </form>
                                    </section>
                                </aside>
                            </div>
                        </div>
                    ) : null}
                </article>
            </div>

            {isAddLeadModalOpen ? (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 px-4 backdrop-blur-sm">
                    <div className="w-full max-w-2xl rounded-[32px] border border-white/70 bg-white p-8 shadow-[0_40px_100px_-40px_rgba(15,23,42,0.4)]">
                        <div className="flex items-start justify-between gap-4">
                            <div>
                                <p className="text-[11px] font-bold uppercase tracking-[0.24em] text-violet-500">Lead intake</p>
                                <h3 className="mt-2 text-2xl font-semibold text-slate-950">Register a new student lead</h3>
                                <p className="mt-1 text-sm text-slate-500">Capture the core contact profile and seed address intelligence from the start.</p>
                            </div>
                            <button type="button" onClick={() => setIsAddLeadModalOpen(false)} className="rounded-full border border-slate-200 p-2 text-slate-400 transition hover:text-slate-600">
                                <X className="h-5 w-5" />
                            </button>
                        </div>

                        <form onSubmit={handleCreateLead} className="mt-6 space-y-4">
                            <div className="grid gap-4 md:grid-cols-2">
                                <label className="space-y-2">
                                    <span className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">Full Name</span>
                                    <input
                                        required
                                        value={leadForm.name}
                                        onChange={(event) => setLeadForm((current) => ({ ...current, name: event.target.value }))}
                                        className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none transition focus:border-violet-400 focus:ring-4 focus:ring-violet-100/70"
                                    />
                                </label>
                                <label className="space-y-2">
                                    <span className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">Phone</span>
                                    <input
                                        value={leadForm.phone}
                                        onChange={(event) => setLeadForm((current) => ({ ...current, phone: event.target.value }))}
                                        className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none transition focus:border-violet-400 focus:ring-4 focus:ring-violet-100/70"
                                    />
                                </label>
                                <label className="space-y-2">
                                    <span className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">Email</span>
                                    <input
                                        value={leadForm.email}
                                        onChange={(event) => setLeadForm((current) => ({ ...current, email: event.target.value }))}
                                        className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none transition focus:border-violet-400 focus:ring-4 focus:ring-violet-100/70"
                                    />
                                </label>
                                <label className="space-y-2">
                                    <span className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">Target Class</span>
                                    <input
                                        value={leadForm.classLevel}
                                        onChange={(event) => setLeadForm((current) => ({ ...current, classLevel: event.target.value }))}
                                        className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none transition focus:border-violet-400 focus:ring-4 focus:ring-violet-100/70"
                                    />
                                </label>
                            </div>

                            <div>
                                <span className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">Address intelligence</span>
                                <div className="mt-2">
                                    <AddressLookupInput
                                        value={leadForm.location}
                                        onChange={(value) => setLeadForm((current) => ({ ...current, location: value }))}
                                        onSelectSuggestion={setLeadLocationSuggestion}
                                        placeholder="Search village, city, district, state..."
                                        inputClassName="w-full rounded-2xl border border-slate-200 bg-slate-50 pl-10 pr-4 py-3 text-sm outline-none transition focus:border-violet-400 focus:ring-4 focus:ring-violet-100/70"
                                        panelClassName="relative z-20 mt-3 space-y-2 rounded-[24px] border border-slate-200 bg-white p-3 shadow-[0_24px_50px_-24px_rgba(15,23,42,0.3)]"
                                        helperText="Pick a suggestion to preserve village, district, city, and state context in one line."
                                    />
                                </div>
                            </div>

                            {leadLocationSuggestion ? (
                                <div className="grid gap-3 rounded-[24px] border border-violet-100 bg-violet-50/60 p-4 md:grid-cols-4">
                                    {[
                                        { label: "Village", value: leadLocationSuggestion.village || "—" },
                                        { label: "City", value: leadLocationSuggestion.city || "—" },
                                        { label: "District", value: leadLocationSuggestion.district || "—" },
                                        { label: "State", value: leadLocationSuggestion.state || "—" },
                                    ].map((item) => (
                                        <div key={item.label} className="rounded-2xl border border-white/80 bg-white/90 p-3">
                                            <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-slate-400">{item.label}</p>
                                            <p className="mt-2 text-sm font-semibold text-slate-900">{item.value}</p>
                                        </div>
                                    ))}
                                </div>
                            ) : null}

                            <button type="submit" className="btn btn-primary w-full justify-center rounded-2xl px-4 py-3 text-sm">
                                <Sparkles className="h-4 w-4" />
                                Add to student pipeline
                            </button>
                        </form>
                    </div>
                </div>
            ) : null}
        </section>
    );
}
