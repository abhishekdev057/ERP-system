"use client";

import { useEffect, useMemo, useState } from "react";
import toast from "react-hot-toast";
import {
    ArrowUpRight,
    Filter,
    GraduationCap,
    IndianRupee,
    LoaderCircle,
    Mail,
    MessageSquare,
    Phone,
    Plus,
    Search,
    Send,
    Sparkles,
    Trash2,
    User,
    Users,
    X,
} from "lucide-react";
import { AddressLookupInput, type AddressSuggestion } from "@/components/ui/AddressLookupInput";
import { computeStudentFeeSummary, STUDENT_FEE_AUDIT_TYPES, type StudentFeeAuditType } from "@/lib/student-fees";

type Student = {
    id: string;
    studentCode: string | null;
    name: string;
    guardianName: string | null;
    dateOfBirth: string | null;
    gender: string | null;
    phone: string | null;
    parentPhone: string | null;
    email: string | null;
    addressLine: string | null;
    pinCode: string | null;
    aadhaarOrIdNumber: string | null;
    idProofUrl: string | null;
    photoUrl: string | null;
    galleryImageUrls: string[];
    admissionDate: string | null;
    courseEnrolled: string | null;
    batchId: string | null;
    totalFees: number | null;
    status: "LEAD" | "ACTIVE" | "ALUMNI" | "DROPOUT";
    leadConfidence: "COLD" | "WARM" | "HOT" | null;
    tags: string[];
    location: string | null;
    classLevel: string | null;
    createdAt: string;
    conversations?: Conversation[];
    feeAudits?: FeeAudit[];
    assignedUser?: { id: string; name: string | null; image: string | null; designation: string | null } | null;
};

type FeeAudit = {
    id: string;
    type: StudentFeeAuditType;
    amount: number | null;
    note: string | null;
    effectiveDate: string;
    createdAt: string;
    member?: { name: string | null; designation: string | null } | null;
};

type Conversation = {
    id: string;
    remark: string;
    channel: "WHATSAPP" | "PHONE" | "EMAIL" | "IN_PERSON" | "OTHER";
    date: string;
    member?: { name: string; designation: string | null };
};

type StudentDraft = {
    studentCode: string;
    name: string;
    guardianName: string;
    dateOfBirth: string;
    gender: string;
    phone: string;
    parentPhone: string;
    email: string;
    addressLine: string;
    pinCode: string;
    aadhaarOrIdNumber: string;
    idProofUrl: string;
    photoUrl: string;
    admissionDate: string;
    courseEnrolled: string;
    batchId: string;
    totalFees: string;
    location: string;
    classLevel: string;
    tags: string;
};

type LeadForm = {
    studentCode: string;
    name: string;
    guardianName: string;
    dateOfBirth: string;
    gender: string;
    phone: string;
    parentPhone: string;
    email: string;
    addressLine: string;
    pinCode: string;
    aadhaarOrIdNumber: string;
    idProofUrl: string;
    photoUrl: string;
    admissionDate: string;
    courseEnrolled: string;
    batchId: string;
    totalFees: string;
    location: string;
    classLevel: string;
    tags: string;
};

type FeeAuditDraft = {
    type: StudentFeeAuditType;
    amount: string;
    note: string;
    effectiveDate: string;
};

const STATUS_OPTIONS = ["ALL", "LEAD", "ACTIVE", "ALUMNI", "DROPOUT"] as const;
const CONFIDENCE_OPTIONS = ["COLD", "WARM", "HOT"] as const;

function createEmptyLeadForm(): LeadForm {
    return {
        studentCode: "",
        name: "",
        guardianName: "",
        dateOfBirth: "",
        gender: "",
        phone: "",
        parentPhone: "",
        email: "",
        addressLine: "",
        pinCode: "",
        aadhaarOrIdNumber: "",
        idProofUrl: "",
        photoUrl: "",
        admissionDate: "",
        courseEnrolled: "",
        batchId: "",
        totalFees: "",
        location: "",
        classLevel: "",
        tags: "",
    };
}

function buildStudentDraft(student: Student | null): StudentDraft {
    return {
        studentCode: student?.studentCode || "",
        name: student?.name || "",
        guardianName: student?.guardianName || "",
        dateOfBirth: student?.dateOfBirth ? student.dateOfBirth.slice(0, 10) : "",
        gender: student?.gender || "",
        phone: student?.phone || "",
        parentPhone: student?.parentPhone || "",
        email: student?.email || "",
        addressLine: student?.addressLine || "",
        pinCode: student?.pinCode || "",
        aadhaarOrIdNumber: student?.aadhaarOrIdNumber || "",
        idProofUrl: student?.idProofUrl || "",
        photoUrl: student?.photoUrl || "",
        admissionDate: student?.admissionDate ? student.admissionDate.slice(0, 10) : "",
        courseEnrolled: student?.courseEnrolled || "",
        batchId: student?.batchId || "",
        totalFees: typeof student?.totalFees === "number" ? String(student.totalFees) : "",
        location: student?.location || "",
        classLevel: student?.classLevel || "",
        tags: Array.isArray(student?.tags) ? student!.tags.join(", ") : "",
    };
}

function createEmptyFeeAuditDraft(): FeeAuditDraft {
    return {
        type: "PAYMENT",
        amount: "",
        note: "",
        effectiveDate: "",
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

function formatCurrency(amount: number | null | undefined) {
    return new Intl.NumberFormat("en-IN", {
        style: "currency",
        currency: "INR",
        maximumFractionDigits: 0,
    }).format(Number(amount || 0));
}

function SkeletonCard() {
    return (
        <div className="rounded-[24px] border border-slate-200 bg-white p-4 shadow-sm">
            <div className="h-4 w-28 animate-pulse rounded-full bg-slate-200" />
            <div className="mt-3 h-6 w-3/4 animate-pulse rounded-full bg-slate-200" />
            <div className="mt-2 h-4 w-1/2 animate-pulse rounded-full bg-slate-100" />
        </div>
    );
}

function SectionTitle({ eyebrow, title }: { eyebrow: string; title: string }) {
    return (
        <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.24em] text-slate-400">{eyebrow}</p>
            <h4 className="mt-1 text-base font-semibold text-slate-950">{title}</h4>
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
    const [creatingLead, setCreatingLead] = useState(false);
    const [feeAuditDraft, setFeeAuditDraft] = useState<FeeAuditDraft>(createEmptyFeeAuditDraft());
    const [savingFeeAudit, setSavingFeeAudit] = useState(false);
    const [deletingStudent, setDeletingStudent] = useState(false);
    const [leadLocationSuggestion, setLeadLocationSuggestion] = useState<AddressSuggestion | null>(null);
    const [studentLocationSuggestion, setStudentLocationSuggestion] = useState<AddressSuggestion | null>(null);
    const [uploadingAssetKind, setUploadingAssetKind] = useState<"photo" | "idProof" | "gallery" | null>(null);

    useEffect(() => {
        void fetchStudents();
    }, []);

    const syncStudentIntoState = (student: Student) => {
        const mergedStudent = {
            ...selectedStudent,
            ...student,
            conversations: student.conversations || selectedStudent?.conversations || [],
            feeAudits: student.feeAudits || selectedStudent?.feeAudits || [],
        } as Student;
        setSelectedStudent(mergedStudent);
        setStudentDraft(buildStudentDraft(mergedStudent));
        setStudents((current) => {
            const existing = current.some((item) => item.id === student.id);
            if (!existing) return [student, ...current];
            return current.map((item) => (item.id === student.id ? { ...item, ...student } : item));
        });
    };

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
        if (creatingLead) return;
        try {
            setCreatingLead(true);
            const res = await fetch("/api/students", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    ...leadForm,
                    location: leadForm.location || leadForm.addressLine,
                    tags: leadForm.tags
                        .split(",")
                        .map((item) => item.trim())
                        .filter(Boolean),
                    status: "LEAD",
                    leadConfidence: "WARM",
                }),
            });
            if (!res.ok) throw new Error("Failed to create");
            const data = await res.json();
            const student = data?.student;

            if (data?.duplicate && student?.id) {
                toast.success("Lead already exists. Opened the existing profile.");
                setIsAddLeadModalOpen(false);
                setLeadForm(createEmptyLeadForm());
                setLeadLocationSuggestion(null);
                await Promise.all([fetchStudents(), fetchStudentDetails(student.id)]);
                return;
            }

            toast.success("Lead registered!");
            setLeadForm(createEmptyLeadForm());
            setLeadLocationSuggestion(null);
            setIsAddLeadModalOpen(false);
            await fetchStudents();
            if (student?.id) {
                await fetchStudentDetails(student.id);
            }
        } catch {
            toast.error("Error creating lead.");
        } finally {
            setCreatingLead(false);
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
                    studentCode: studentDraft.studentCode.trim() || null,
                    name: studentDraft.name.trim(),
                    guardianName: studentDraft.guardianName.trim() || null,
                    dateOfBirth: studentDraft.dateOfBirth || null,
                    gender: studentDraft.gender || null,
                    phone: studentDraft.phone.trim() || null,
                    parentPhone: studentDraft.parentPhone.trim() || null,
                    email: studentDraft.email.trim() || null,
                    addressLine: studentDraft.addressLine.trim() || null,
                    pinCode: studentDraft.pinCode.trim() || null,
                    aadhaarOrIdNumber: studentDraft.aadhaarOrIdNumber.trim() || null,
                    idProofUrl: studentDraft.idProofUrl.trim() || null,
                    photoUrl: studentDraft.photoUrl.trim() || null,
                    admissionDate: studentDraft.admissionDate || null,
                    courseEnrolled: studentDraft.courseEnrolled.trim() || null,
                    batchId: studentDraft.batchId.trim() || null,
                    totalFees: studentDraft.totalFees.trim() || null,
                    location: studentDraft.location.trim() || null,
                    classLevel: studentDraft.classLevel.trim() || null,
                    tags: studentDraft.tags
                        .split(",")
                        .map((item) => item.trim())
                        .filter(Boolean),
                }),
            });
            if (!res.ok) throw new Error("Save failed");
            const updated = await res.json();
            toast.success("Student profile saved");
            syncStudentIntoState(updated);
        } catch {
            toast.error("Failed to save profile.");
        } finally {
            setSavingProfile(false);
        }
    };

    const handleAddFeeAudit = async (event: React.FormEvent) => {
        event.preventDefault();
        if (!selectedStudent || savingFeeAudit) return;
        if (feeAuditDraft.type !== "NOTE" && !feeAuditDraft.amount.trim()) {
            toast.error("Amount is required for this fee entry.");
            return;
        }

        try {
            setSavingFeeAudit(true);
            const res = await fetch(`/api/students/${selectedStudent.id}/fees`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    type: feeAuditDraft.type,
                    amount: feeAuditDraft.type === "NOTE" ? null : feeAuditDraft.amount.trim(),
                    note: feeAuditDraft.note.trim() || null,
                    effectiveDate: feeAuditDraft.effectiveDate || null,
                }),
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(data.error || "Could not add fee entry");
            toast.success("Fee audit updated");
            setFeeAuditDraft(createEmptyFeeAuditDraft());
            await fetchStudentDetails(selectedStudent.id);
        } catch (error) {
            toast.error(error instanceof Error ? error.message : "Could not add fee entry.");
        } finally {
            setSavingFeeAudit(false);
        }
    };

    const handleDeleteStudent = async () => {
        if (!selectedStudent || deletingStudent) return;
        const confirmed = window.confirm(`Delete ${selectedStudent.name}? This will remove the student, conversations, and fee history.`);
        if (!confirmed) return;

        try {
            setDeletingStudent(true);
            const res = await fetch(`/api/students/${selectedStudent.id}`, {
                method: "DELETE",
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(data.error || "Could not delete student");
            toast.success("Student deleted");
            setSelectedStudent(null);
            setStudentDraft(buildStudentDraft(null));
            setFeeAuditDraft(createEmptyFeeAuditDraft());
            await fetchStudents();
        } catch (error) {
            toast.error(error instanceof Error ? error.message : "Could not delete student.");
        } finally {
            setDeletingStudent(false);
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

    const handleStudentAssetUpload = async (kind: "photo" | "idProof" | "gallery", files: FileList | null) => {
        if (!selectedStudent || !files?.length) return;

        try {
            setUploadingAssetKind(kind);
            const formData = new FormData();
            formData.append("kind", kind);
            Array.from(files).forEach((file) => formData.append("files", file));

            const response = await fetch(`/api/students/${selectedStudent.id}/assets`, {
                method: "POST",
                body: formData,
            });
            const data = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(data.error || "Upload failed");

            if (data?.student) {
                syncStudentIntoState(data.student as Student);
            }

            toast.success(
                kind === "gallery"
                    ? "Reference images added"
                    : kind === "photo"
                        ? "Student photo uploaded"
                        : "ID proof uploaded"
            );
        } catch (error) {
            toast.error(error instanceof Error ? error.message : "Could not upload file.");
        } finally {
            setUploadingAssetKind(null);
        }
    };

    const filteredStudents = useMemo(
        () =>
            students.filter((student) => {
                const matchesSearch =
                    student.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
                    (student.studentCode && student.studentCode.toLowerCase().includes(searchQuery.toLowerCase())) ||
                    (student.phone && student.phone.includes(searchQuery)) ||
                    (student.parentPhone && student.parentPhone.includes(searchQuery)) ||
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
    const feeSummary = useMemo(
        () => computeStudentFeeSummary(selectedStudent?.totalFees, selectedStudent?.feeAudits || []),
        [selectedStudent]
    );

    return (
        <section className="space-y-6 pb-10">
            <div className="grid gap-4 lg:grid-cols-4">
                {[
                    { label: "Directory", value: students.length, note: "profiles", tone: "bg-violet-500" },
                    { label: "Active", value: metrics.activeCount, note: "enrolled", tone: "bg-emerald-500" },
                    { label: "Lead Heat", value: metrics.hotCount, note: "hot", tone: "bg-rose-500" },
                    { label: "Alumni", value: metrics.alumniCount, note: "archived", tone: "bg-sky-500" },
                ].map((card) => (
                    <article
                        key={card.label}
                        className="relative overflow-hidden rounded-[24px] border border-slate-200 bg-white p-5 shadow-[0_20px_50px_-32px_rgba(15,23,42,0.24)]"
                    >
                        <div className={`absolute left-0 top-0 h-full w-1 ${card.tone}`} />
                        <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-slate-400">{card.label}</p>
                        <div className="mt-3 flex items-end justify-between gap-3">
                            <p className="text-3xl font-semibold text-slate-950">{card.value}</p>
                            <p className="text-xs font-medium uppercase tracking-[0.16em] text-slate-400">{card.note}</p>
                        </div>
                    </article>
                ))}
            </div>

            <div className="grid gap-6 xl:grid-cols-[360px_minmax(0,1fr)]">
                <article className="workspace-panel overflow-hidden border border-slate-200 bg-white shadow-[0_24px_60px_-40px_rgba(15,23,42,0.2)]">
                    <div className="workspace-panel-header border-b border-slate-200 bg-white">
                        <div className="flex items-start justify-between gap-3">
                            <div>
                                <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-slate-400">Students</p>
                                <h3 className="mt-1 text-xl font-semibold text-slate-950">Directory</h3>
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
                                                ? "border-slate-900 bg-slate-900 text-white"
                                                : "border-slate-200 bg-white text-slate-500 hover:border-slate-300 hover:text-slate-700"
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
                                            {student.studentCode ? (
                                                <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-violet-500">
                                                    {student.studentCode}
                                                </p>
                                            ) : null}
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

                <article className="workspace-panel overflow-hidden border border-slate-200 bg-white shadow-[0_24px_60px_-40px_rgba(15,23,42,0.2)]">
                    {!selectedStudent && !detailsLoading ? (
                        <div className="flex min-h-[760px] flex-col items-center justify-center px-10 text-center">
                            <div className="flex h-20 w-20 items-center justify-center rounded-[24px] border border-slate-200 bg-slate-50 text-slate-700">
                                <Users className="h-10 w-10" />
                            </div>
                            <h3 className="mt-6 text-2xl font-semibold text-slate-950">Select a student</h3>
                        </div>
                    ) : detailsLoading ? (
                        <div className="flex min-h-[760px] items-center justify-center">
                            <div className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white px-5 py-4 shadow-sm">
                                <LoaderCircle className="h-5 w-5 animate-spin text-slate-700" />
                                <p className="text-sm font-semibold text-slate-900">Loading profile</p>
                            </div>
                        </div>
                    ) : selectedStudent ? (
                        <div className="workspace-scroll p-6" style={{ minHeight: "min(760px, 72vh)" }}>
                            <div className="grid gap-5 xl:grid-cols-[minmax(0,1.1fr)_340px]">
                                <div className="space-y-5">
                                    <section className="relative overflow-hidden rounded-[24px] border border-slate-200 bg-white p-6 shadow-sm">
                                        <div className="absolute right-5 top-5 rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.22em] text-slate-600">
                                            {selectedStudent.status}
                                        </div>
                                        <div className="flex items-start gap-4">
                                            {selectedStudent.photoUrl ? (
                                                <img
                                                    src={selectedStudent.photoUrl}
                                                    alt={selectedStudent.name}
                                                    className="h-16 w-16 shrink-0 rounded-[22px] object-cover shadow-lg shadow-violet-500/20"
                                                />
                                            ) : (
                                                <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-[22px] bg-[linear-gradient(135deg,#8b5cf6,#6366f1)] text-2xl font-semibold text-white shadow-lg shadow-violet-500/20">
                                                    {selectedStudent.name.charAt(0)}
                                                </div>
                                            )}
                                            <div className="min-w-0">
                                                {selectedStudent.studentCode ? (
                                                    <p className="text-[10px] font-bold uppercase tracking-[0.24em] text-violet-500">
                                                        {selectedStudent.studentCode}
                                                    </p>
                                                ) : null}
                                                <h3 className="text-2xl font-semibold text-slate-950">{selectedStudent.name}</h3>
                                                <div className="mt-3 flex flex-wrap gap-2">
                                                    <span className={`rounded-full border px-3 py-1 text-[10px] font-bold uppercase tracking-[0.22em] ${statusTone(selectedStudent.status, selectedStudent.leadConfidence)}`}>
                                                        {selectedStudent.status === "LEAD" ? `Lead ${selectedStudent.leadConfidence || ""}`.trim() : selectedStudent.status}
                                                    </span>
                                                    {selectedStudent.assignedUser?.name ? (
                                                        <span className="rounded-full border border-slate-200 bg-white px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.22em] text-slate-500">
                                                            Owner · {selectedStudent.assignedUser.name}
                                                        </span>
                                                    ) : null}
                                                </div>
                                            </div>
                                        </div>
                                        <div className="mt-5 grid gap-3 md:grid-cols-3">
                                            <div className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4">
                                                <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-slate-400">Student Phone</p>
                                                <p className="mt-2 text-sm font-semibold text-slate-900">{selectedStudent.phone || "Not added yet"}</p>
                                            </div>
                                            <div className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4">
                                                <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-slate-400">Course / Batch</p>
                                                <p className="mt-2 text-sm font-semibold text-slate-900">
                                                    {selectedStudent.courseEnrolled || selectedStudent.batchId
                                                        ? [selectedStudent.courseEnrolled, selectedStudent.batchId && `Batch ${selectedStudent.batchId}`]
                                                            .filter(Boolean)
                                                            .join(" · ")
                                                        : "Not defined"}
                                                </p>
                                            </div>
                                            <div className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4">
                                                <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-slate-400">Admission / Pipeline</p>
                                                <p className="mt-2 text-sm font-semibold text-slate-900">
                                                    {selectedStudent.admissionDate
                                                        ? formatDateTime(selectedStudent.admissionDate)
                                                        : formatDateTime(selectedStudent.createdAt)}
                                                </p>
                                            </div>
                                        </div>
                                    </section>

                                    <section className="rounded-[24px] border border-slate-200 bg-white p-6 shadow-sm">
                                        <div className="flex items-start justify-between gap-3">
                                            <SectionTitle eyebrow="Profile" title="Details" />
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
                                                <span className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">Student ID</span>
                                                <input
                                                    value={studentDraft.studentCode}
                                                    onChange={(event) => setStudentDraft((current) => ({ ...current, studentCode: event.target.value }))}
                                                    placeholder="Auto generated if left blank"
                                                    className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none transition focus:border-violet-400 focus:ring-4 focus:ring-violet-100/70"
                                                />
                                            </label>
                                            <label className="space-y-2">
                                                <span className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">Full Name</span>
                                                <input
                                                    value={studentDraft.name}
                                                    onChange={(event) => setStudentDraft((current) => ({ ...current, name: event.target.value }))}
                                                    className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none transition focus:border-violet-400 focus:ring-4 focus:ring-violet-100/70"
                                                />
                                            </label>
                                            <label className="space-y-2">
                                                <span className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">Father / Mother Name</span>
                                                <input
                                                    value={studentDraft.guardianName}
                                                    onChange={(event) => setStudentDraft((current) => ({ ...current, guardianName: event.target.value }))}
                                                    className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none transition focus:border-violet-400 focus:ring-4 focus:ring-violet-100/70"
                                                />
                                            </label>
                                            <label className="space-y-2">
                                                <span className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">Date of Birth</span>
                                                <input
                                                    type="date"
                                                    value={studentDraft.dateOfBirth}
                                                    onChange={(event) => setStudentDraft((current) => ({ ...current, dateOfBirth: event.target.value }))}
                                                    className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none transition focus:border-violet-400 focus:ring-4 focus:ring-violet-100/70"
                                                />
                                            </label>
                                            <label className="space-y-2">
                                                <span className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">Gender</span>
                                                <select
                                                    value={studentDraft.gender}
                                                    onChange={(event) => setStudentDraft((current) => ({ ...current, gender: event.target.value }))}
                                                    className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none transition focus:border-violet-400 focus:ring-4 focus:ring-violet-100/70"
                                                >
                                                    <option value="">Select gender</option>
                                                    <option value="Male">Male</option>
                                                    <option value="Female">Female</option>
                                                    <option value="Other">Other</option>
                                                    <option value="Prefer not to say">Prefer not to say</option>
                                                </select>
                                            </label>
                                            <label className="space-y-2">
                                                <span className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">Student Mobile</span>
                                                <input
                                                    value={studentDraft.phone}
                                                    onChange={(event) => setStudentDraft((current) => ({ ...current, phone: event.target.value }))}
                                                    className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none transition focus:border-violet-400 focus:ring-4 focus:ring-violet-100/70"
                                                />
                                            </label>
                                            <label className="space-y-2">
                                                <span className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">Parent Mobile</span>
                                                <input
                                                    value={studentDraft.parentPhone}
                                                    onChange={(event) => setStudentDraft((current) => ({ ...current, parentPhone: event.target.value }))}
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
                                            <label className="space-y-2">
                                                <span className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">Admission Date</span>
                                                <input
                                                    type="date"
                                                    value={studentDraft.admissionDate}
                                                    onChange={(event) => setStudentDraft((current) => ({ ...current, admissionDate: event.target.value }))}
                                                    className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none transition focus:border-violet-400 focus:ring-4 focus:ring-violet-100/70"
                                                />
                                            </label>
                                            <label className="space-y-2">
                                                <span className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">Course Enrolled</span>
                                                <input
                                                    value={studentDraft.courseEnrolled}
                                                    onChange={(event) => setStudentDraft((current) => ({ ...current, courseEnrolled: event.target.value }))}
                                                    className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none transition focus:border-violet-400 focus:ring-4 focus:ring-violet-100/70"
                                                />
                                            </label>
                                            <label className="space-y-2">
                                                <span className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">Batch ID</span>
                                                <input
                                                    value={studentDraft.batchId}
                                                    onChange={(event) => setStudentDraft((current) => ({ ...current, batchId: event.target.value }))}
                                                    className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none transition focus:border-violet-400 focus:ring-4 focus:ring-violet-100/70"
                                                />
                                            </label>
                                            <label className="space-y-2">
                                                <span className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">Total Fees</span>
                                                <input
                                                    value={studentDraft.totalFees}
                                                    onChange={(event) => setStudentDraft((current) => ({ ...current, totalFees: event.target.value }))}
                                                    placeholder="e.g. 45000"
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
                                                <span className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">Full Address</span>
                                                <textarea
                                                    value={studentDraft.addressLine}
                                                    onChange={(event) => setStudentDraft((current) => ({ ...current, addressLine: event.target.value }))}
                                                    className="min-h-[96px] w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none transition focus:border-violet-400 focus:ring-4 focus:ring-violet-100/70"
                                                />
                                            </label>
                                            <label className="space-y-2">
                                                <span className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">PIN Code</span>
                                                <input
                                                    value={studentDraft.pinCode}
                                                    onChange={(event) => setStudentDraft((current) => ({ ...current, pinCode: event.target.value }))}
                                                    className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none transition focus:border-violet-400 focus:ring-4 focus:ring-violet-100/70"
                                                />
                                            </label>
                                            <label className="space-y-2">
                                                <span className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">Aadhaar / ID Number</span>
                                                <input
                                                    value={studentDraft.aadhaarOrIdNumber}
                                                    onChange={(event) => setStudentDraft((current) => ({ ...current, aadhaarOrIdNumber: event.target.value }))}
                                                    className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none transition focus:border-violet-400 focus:ring-4 focus:ring-violet-100/70"
                                                />
                                            </label>
                                            <label className="space-y-2 md:col-span-2">
                                                <span className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">Profile Photo URL</span>
                                                <input
                                                    value={studentDraft.photoUrl}
                                                    onChange={(event) => setStudentDraft((current) => ({ ...current, photoUrl: event.target.value }))}
                                                    placeholder="https://... or /uploads/students/..."
                                                    className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none transition focus:border-violet-400 focus:ring-4 focus:ring-violet-100/70"
                                                />
                                            </label>
                                            <label className="space-y-2 md:col-span-2">
                                                <span className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">ID Proof URL / File Path</span>
                                                <input
                                                    value={studentDraft.idProofUrl}
                                                    onChange={(event) => setStudentDraft((current) => ({ ...current, idProofUrl: event.target.value }))}
                                                    placeholder="https://... or /uploads/students/..."
                                                    className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none transition focus:border-violet-400 focus:ring-4 focus:ring-violet-100/70"
                                                />
                                            </label>
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

                                    <section className="rounded-[24px] border border-slate-200 bg-white p-6 shadow-sm">
                                        <div className="flex items-start justify-between gap-3">
                                            <SectionTitle eyebrow="Timeline" title="Conversation history" />
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
                                                    No timeline entries yet.
                                                </div>
                                            )}
                                        </div>
                                    </section>
                                </div>

                                <aside className="space-y-5">
                                    <section className="rounded-[24px] border border-slate-200 bg-white p-5 shadow-sm">
                                        <SectionTitle eyebrow="Assets" title="Media & proofs" />
                                        <div className="mt-4 space-y-4">
                                            <div className="grid gap-3">
                                                <label className="flex cursor-pointer items-center justify-between rounded-2xl border border-slate-200 bg-slate-50/80 px-4 py-3 text-sm font-semibold text-slate-700 transition hover:border-violet-200 hover:bg-violet-50/50">
                                                    <span>Upload primary photo</span>
                                                    <input
                                                        type="file"
                                                        accept="image/*"
                                                        className="hidden"
                                                        onChange={(event) => {
                                                            void handleStudentAssetUpload("photo", event.target.files);
                                                            event.currentTarget.value = "";
                                                        }}
                                                    />
                                                    <span className="text-xs text-violet-600">{uploadingAssetKind === "photo" ? "Uploading..." : "Choose image"}</span>
                                                </label>
                                                <label className="flex cursor-pointer items-center justify-between rounded-2xl border border-slate-200 bg-slate-50/80 px-4 py-3 text-sm font-semibold text-slate-700 transition hover:border-violet-200 hover:bg-violet-50/50">
                                                    <span>Upload Aadhaar / ID proof</span>
                                                    <input
                                                        type="file"
                                                        accept="image/*,application/pdf"
                                                        className="hidden"
                                                        onChange={(event) => {
                                                            void handleStudentAssetUpload("idProof", event.target.files);
                                                            event.currentTarget.value = "";
                                                        }}
                                                    />
                                                    <span className="text-xs text-violet-600">{uploadingAssetKind === "idProof" ? "Uploading..." : "Choose file"}</span>
                                                </label>
                                                <label className="flex cursor-pointer items-center justify-between rounded-2xl border border-slate-200 bg-slate-50/80 px-4 py-3 text-sm font-semibold text-slate-700 transition hover:border-violet-200 hover:bg-violet-50/50">
                                                    <span>Add reference photos for AI/media</span>
                                                    <input
                                                        type="file"
                                                        accept="image/*"
                                                        multiple
                                                        className="hidden"
                                                        onChange={(event) => {
                                                            void handleStudentAssetUpload("gallery", event.target.files);
                                                            event.currentTarget.value = "";
                                                        }}
                                                    />
                                                    <span className="text-xs text-violet-600">{uploadingAssetKind === "gallery" ? "Uploading..." : "Add photos"}</span>
                                                </label>
                                            </div>

                                            {selectedStudent.photoUrl ? (
                                                <div className="rounded-2xl border border-slate-100 bg-slate-50/70 p-4">
                                                    <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-slate-400">Primary Photo</p>
                                                    <img
                                                        src={selectedStudent.photoUrl}
                                                        alt={selectedStudent.name}
                                                        className="mt-3 h-36 w-full rounded-2xl object-cover"
                                                    />
                                                </div>
                                            ) : null}

                                            {selectedStudent.galleryImageUrls?.length ? (
                                                <div className="rounded-2xl border border-slate-100 bg-slate-50/70 p-4">
                                                    <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-slate-400">Reference Gallery</p>
                                                    <div className="mt-3 grid grid-cols-2 gap-3">
                                                        {selectedStudent.galleryImageUrls.map((imageUrl) => (
                                                            <img
                                                                key={imageUrl}
                                                                src={imageUrl}
                                                                alt="Student reference"
                                                                className="h-28 w-full rounded-2xl object-cover"
                                                            />
                                                        ))}
                                                    </div>
                                                </div>
                                            ) : null}

                                            {selectedStudent.idProofUrl ? (
                                                <a
                                                    href={selectedStudent.idProofUrl}
                                                    target="_blank"
                                                    rel="noreferrer"
                                                    className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:border-violet-200 hover:text-violet-700"
                                                >
                                                    <ArrowUpRight className="h-4 w-4" />
                                                    Open uploaded ID proof
                                                </a>
                                            ) : null}
                                        </div>
                                    </section>

                                    <section className="rounded-[24px] border border-slate-200 bg-white p-5 shadow-sm">
                                        <SectionTitle eyebrow="Controls" title="Lead state" />
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

                                    <section className="rounded-[24px] border border-slate-200 bg-white p-5 shadow-sm">
                                        <SectionTitle eyebrow="Signals" title="Operational view" />
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
                                            <div className="rounded-2xl border border-slate-100 bg-slate-50/70 p-4">
                                                <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-slate-400">Admission context</p>
                                                <p className="mt-2 text-sm font-semibold text-slate-900">
                                                    {selectedStudent.guardianName || "Guardian not added"}
                                                </p>
                                                <p className="mt-1 text-xs text-slate-500">
                                                    {[selectedStudent.courseEnrolled, selectedStudent.batchId && `Batch ${selectedStudent.batchId}`]
                                                        .filter(Boolean)
                                                        .join(" · ") || "Course and batch not mapped yet."}
                                                </p>
                                            </div>
                                        </div>
                                    </section>

                                    <section className="rounded-[24px] border border-slate-200 bg-white p-5 shadow-sm">
                                        <SectionTitle eyebrow="Fees" title="Billing desk" />
                                        <div className="mt-4 grid gap-3 sm:grid-cols-3">
                                            {[
                                                { label: "Total", value: formatCurrency(feeSummary.adjustedTotal) },
                                                { label: "Paid", value: formatCurrency(feeSummary.payments) },
                                                { label: "Pending", value: formatCurrency(feeSummary.pending) },
                                            ].map((item) => (
                                                <div key={item.label} className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4">
                                                    <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-slate-400">{item.label}</p>
                                                    <p className="mt-2 text-sm font-semibold text-slate-900">{item.value}</p>
                                                </div>
                                            ))}
                                        </div>

                                        <form onSubmit={handleAddFeeAudit} className="mt-4 space-y-3">
                                            <div className="grid gap-3 md:grid-cols-2">
                                                <label className="space-y-2">
                                                    <span className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">Entry Type</span>
                                                    <select
                                                        value={feeAuditDraft.type}
                                                        onChange={(event) => setFeeAuditDraft((current) => ({ ...current, type: event.target.value as StudentFeeAuditType }))}
                                                        className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none transition focus:border-violet-400 focus:ring-4 focus:ring-violet-100/70"
                                                    >
                                                        {STUDENT_FEE_AUDIT_TYPES.map((type) => (
                                                            <option key={type} value={type}>
                                                                {type}
                                                            </option>
                                                        ))}
                                                    </select>
                                                </label>
                                                <label className="space-y-2">
                                                    <span className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">Amount</span>
                                                    <div className="relative">
                                                        <IndianRupee className="absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                                                        <input
                                                            value={feeAuditDraft.amount}
                                                            onChange={(event) => setFeeAuditDraft((current) => ({ ...current, amount: event.target.value }))}
                                                            placeholder={feeAuditDraft.type === "NOTE" ? "Optional" : "0"}
                                                            className="w-full rounded-2xl border border-slate-200 bg-slate-50 pl-10 pr-4 py-3 text-sm outline-none transition focus:border-violet-400 focus:ring-4 focus:ring-violet-100/70"
                                                        />
                                                    </div>
                                                </label>
                                                <label className="space-y-2">
                                                    <span className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">Effective Date</span>
                                                    <input
                                                        type="date"
                                                        value={feeAuditDraft.effectiveDate}
                                                        onChange={(event) => setFeeAuditDraft((current) => ({ ...current, effectiveDate: event.target.value }))}
                                                        className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none transition focus:border-violet-400 focus:ring-4 focus:ring-violet-100/70"
                                                    />
                                                </label>
                                                <label className="space-y-2">
                                                    <span className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">Note</span>
                                                    <input
                                                        value={feeAuditDraft.note}
                                                        onChange={(event) => setFeeAuditDraft((current) => ({ ...current, note: event.target.value }))}
                                                        placeholder="Receipt, waiver, manual note"
                                                        className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none transition focus:border-violet-400 focus:ring-4 focus:ring-violet-100/70"
                                                    />
                                                </label>
                                            </div>
                                            <button
                                                type="submit"
                                                disabled={savingFeeAudit}
                                                className="btn btn-primary w-full justify-center rounded-2xl px-4 py-3 text-sm disabled:opacity-60"
                                            >
                                                {savingFeeAudit ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <IndianRupee className="h-4 w-4" />}
                                                {savingFeeAudit ? "Updating..." : "Add fee entry"}
                                            </button>
                                        </form>

                                        <div className="mt-4 space-y-3">
                                            {(selectedStudent.feeAudits || []).length ? (
                                                selectedStudent.feeAudits!.slice(0, 6).map((entry) => (
                                                    <div key={entry.id} className="rounded-2xl border border-slate-200 bg-slate-50/60 p-4">
                                                        <div className="flex items-center justify-between gap-3">
                                                            <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.22em] text-slate-500">
                                                                {entry.type}
                                                            </span>
                                                            <span className="text-xs font-semibold text-slate-700">
                                                                {entry.amount ? formatCurrency(entry.amount) : "Note"}
                                                            </span>
                                                        </div>
                                                        {entry.note ? <p className="mt-2 text-sm text-slate-700">{entry.note}</p> : null}
                                                        <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-slate-500">
                                                            <span>{formatDateTime(entry.effectiveDate)}</span>
                                                            {entry.member?.name ? <span>· {entry.member.name}</span> : null}
                                                        </div>
                                                    </div>
                                                ))
                                            ) : (
                                                <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50/60 p-4 text-sm text-slate-500">
                                                    No fee entries yet.
                                                </div>
                                            )}
                                        </div>
                                    </section>

                                    <section className="rounded-[24px] border border-slate-200 bg-white p-5 shadow-sm">
                                        <SectionTitle eyebrow="Notes" title="Add timeline note" />
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

                                    <section className="rounded-[24px] border border-rose-200 bg-rose-50/60 p-5 shadow-sm">
                                        <SectionTitle eyebrow="Danger" title="Delete record" />
                                        <button
                                            type="button"
                                            onClick={handleDeleteStudent}
                                            disabled={deletingStudent}
                                            className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-2xl border border-rose-200 bg-white px-4 py-3 text-sm font-semibold text-rose-700 transition hover:bg-rose-100 disabled:opacity-60"
                                        >
                                            {deletingStudent ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                                            {deletingStudent ? "Deleting..." : "Delete student"}
                                        </button>
                                    </section>
                                </aside>
                            </div>
                        </div>
                    ) : null}
                </article>
            </div>

            {isAddLeadModalOpen ? (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 px-4 backdrop-blur-sm">
                    <div className="flex max-h-[90vh] w-full max-w-6xl flex-col overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-[0_40px_100px_-40px_rgba(15,23,42,0.35)]">
                        <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-8 py-6">
                            <div>
                                <p className="text-[10px] font-bold uppercase tracking-[0.24em] text-slate-400">Admissions</p>
                                <h3 className="mt-1 text-2xl font-semibold text-slate-950">New student record</h3>
                                <div className="mt-3 flex flex-wrap gap-2">
                                    {["Identity", "Contact", "Admission", "Proofs"].map((item) => (
                                        <span
                                            key={item}
                                            className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500"
                                        >
                                            {item}
                                        </span>
                                    ))}
                                </div>
                            </div>
                            <button type="button" disabled={creatingLead} onClick={() => setIsAddLeadModalOpen(false)} className="rounded-full border border-slate-200 p-2 text-slate-400 transition hover:text-slate-600 disabled:cursor-not-allowed disabled:opacity-50">
                                <X className="h-5 w-5" />
                            </button>
                        </div>

                        <form onSubmit={handleCreateLead} className="flex min-h-0 flex-1 flex-col">
                            <div className="space-y-6 overflow-y-auto px-8 py-6">
                                <section className="rounded-[24px] border border-slate-200 bg-slate-50/50 p-5">
                                    <SectionTitle eyebrow="Identity" title="Core details" />
                                    <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                                        <label className="space-y-2">
                                            <span className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">Student ID</span>
                                            <input
                                                value={leadForm.studentCode}
                                                onChange={(event) => setLeadForm((current) => ({ ...current, studentCode: event.target.value }))}
                                                placeholder="Auto"
                                                className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm outline-none transition focus:border-slate-400 focus:ring-4 focus:ring-slate-100"
                                            />
                                        </label>
                                        <label className="space-y-2 md:col-span-2">
                                            <span className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">Full Name</span>
                                            <input
                                                required
                                                value={leadForm.name}
                                                onChange={(event) => setLeadForm((current) => ({ ...current, name: event.target.value }))}
                                                className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm outline-none transition focus:border-slate-400 focus:ring-4 focus:ring-slate-100"
                                            />
                                        </label>
                                        <label className="space-y-2">
                                            <span className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">Gender</span>
                                            <select
                                                value={leadForm.gender}
                                                onChange={(event) => setLeadForm((current) => ({ ...current, gender: event.target.value }))}
                                                className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm outline-none transition focus:border-slate-400 focus:ring-4 focus:ring-slate-100"
                                            >
                                                <option value="">Select</option>
                                                <option value="Male">Male</option>
                                                <option value="Female">Female</option>
                                                <option value="Other">Other</option>
                                                <option value="Prefer not to say">Prefer not to say</option>
                                            </select>
                                        </label>
                                        <label className="space-y-2 md:col-span-2">
                                            <span className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">Father / Mother Name</span>
                                            <input
                                                value={leadForm.guardianName}
                                                onChange={(event) => setLeadForm((current) => ({ ...current, guardianName: event.target.value }))}
                                                className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm outline-none transition focus:border-slate-400 focus:ring-4 focus:ring-slate-100"
                                            />
                                        </label>
                                        <label className="space-y-2">
                                            <span className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">Date of Birth</span>
                                            <input
                                                type="date"
                                                value={leadForm.dateOfBirth}
                                                onChange={(event) => setLeadForm((current) => ({ ...current, dateOfBirth: event.target.value }))}
                                                className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm outline-none transition focus:border-slate-400 focus:ring-4 focus:ring-slate-100"
                                            />
                                        </label>
                                        <label className="space-y-2">
                                            <span className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">Target Class</span>
                                            <input
                                                value={leadForm.classLevel}
                                                onChange={(event) => setLeadForm((current) => ({ ...current, classLevel: event.target.value }))}
                                                className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm outline-none transition focus:border-slate-400 focus:ring-4 focus:ring-slate-100"
                                            />
                                        </label>
                                    </div>
                                </section>

                                <section className="rounded-[24px] border border-slate-200 bg-slate-50/50 p-5">
                                    <SectionTitle eyebrow="Contact" title="Reach & admission" />
                                    <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                                        <label className="space-y-2">
                                            <span className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">Student Mobile</span>
                                            <input
                                                value={leadForm.phone}
                                                onChange={(event) => setLeadForm((current) => ({ ...current, phone: event.target.value }))}
                                                className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm outline-none transition focus:border-slate-400 focus:ring-4 focus:ring-slate-100"
                                            />
                                        </label>
                                        <label className="space-y-2">
                                            <span className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">Parent Mobile</span>
                                            <input
                                                value={leadForm.parentPhone}
                                                onChange={(event) => setLeadForm((current) => ({ ...current, parentPhone: event.target.value }))}
                                                className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm outline-none transition focus:border-slate-400 focus:ring-4 focus:ring-slate-100"
                                            />
                                        </label>
                                        <label className="space-y-2 md:col-span-2">
                                            <span className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">Email</span>
                                            <input
                                                value={leadForm.email}
                                                onChange={(event) => setLeadForm((current) => ({ ...current, email: event.target.value }))}
                                                className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm outline-none transition focus:border-slate-400 focus:ring-4 focus:ring-slate-100"
                                            />
                                        </label>
                                        <label className="space-y-2">
                                            <span className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">Admission Date</span>
                                            <input
                                                type="date"
                                                value={leadForm.admissionDate}
                                                onChange={(event) => setLeadForm((current) => ({ ...current, admissionDate: event.target.value }))}
                                                className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm outline-none transition focus:border-slate-400 focus:ring-4 focus:ring-slate-100"
                                            />
                                        </label>
                                        <label className="space-y-2">
                                            <span className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">Course Enrolled</span>
                                            <input
                                                value={leadForm.courseEnrolled}
                                                onChange={(event) => setLeadForm((current) => ({ ...current, courseEnrolled: event.target.value }))}
                                                className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm outline-none transition focus:border-slate-400 focus:ring-4 focus:ring-slate-100"
                                            />
                                        </label>
                                        <label className="space-y-2">
                                            <span className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">Batch ID</span>
                                            <input
                                                value={leadForm.batchId}
                                                onChange={(event) => setLeadForm((current) => ({ ...current, batchId: event.target.value }))}
                                                className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm outline-none transition focus:border-slate-400 focus:ring-4 focus:ring-slate-100"
                                            />
                                        </label>
                                        <label className="space-y-2">
                                            <span className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">Total Fees</span>
                                            <input
                                                value={leadForm.totalFees}
                                                onChange={(event) => setLeadForm((current) => ({ ...current, totalFees: event.target.value }))}
                                                placeholder="e.g. 45000"
                                                className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm outline-none transition focus:border-slate-400 focus:ring-4 focus:ring-slate-100"
                                            />
                                        </label>
                                        <label className="space-y-2">
                                            <span className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">Tags</span>
                                            <input
                                                value={leadForm.tags}
                                                onChange={(event) => setLeadForm((current) => ({ ...current, tags: event.target.value }))}
                                                placeholder="biology, agriculture"
                                                className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm outline-none transition focus:border-slate-400 focus:ring-4 focus:ring-slate-100"
                                            />
                                        </label>
                                    </div>
                                </section>

                                <section className="rounded-[24px] border border-slate-200 bg-slate-50/50 p-5">
                                    <SectionTitle eyebrow="Address" title="Location" />
                                    <div className="mt-4 space-y-4">
                                        <AddressLookupInput
                                            value={leadForm.location}
                                            onChange={(value) => setLeadForm((current) => ({ ...current, location: value }))}
                                            onSelectSuggestion={setLeadLocationSuggestion}
                                            placeholder="Search village, city, district, state..."
                                            inputClassName="w-full rounded-2xl border border-slate-200 bg-white pl-10 pr-4 py-3 text-sm outline-none transition focus:border-slate-400 focus:ring-4 focus:ring-slate-100"
                                            panelClassName="relative z-20 mt-3 space-y-2 rounded-[20px] border border-slate-200 bg-white p-3 shadow-[0_24px_50px_-24px_rgba(15,23,42,0.3)]"
                                            helperText=""
                                        />
                                        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                                            <label className="space-y-2 xl:col-span-2">
                                                <span className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">Full Address</span>
                                                <textarea
                                                    value={leadForm.addressLine}
                                                    onChange={(event) => setLeadForm((current) => ({ ...current, addressLine: event.target.value }))}
                                                    className="min-h-[112px] w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm outline-none transition focus:border-slate-400 focus:ring-4 focus:ring-slate-100"
                                                />
                                            </label>
                                            <label className="space-y-2">
                                                <span className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">PIN Code</span>
                                                <input
                                                    value={leadForm.pinCode}
                                                    onChange={(event) => setLeadForm((current) => ({ ...current, pinCode: event.target.value }))}
                                                    className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm outline-none transition focus:border-slate-400 focus:ring-4 focus:ring-slate-100"
                                                />
                                            </label>
                                            <label className="space-y-2">
                                                <span className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">Aadhaar / ID Number</span>
                                                <input
                                                    value={leadForm.aadhaarOrIdNumber}
                                                    onChange={(event) => setLeadForm((current) => ({ ...current, aadhaarOrIdNumber: event.target.value }))}
                                                    className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm outline-none transition focus:border-slate-400 focus:ring-4 focus:ring-slate-100"
                                                />
                                            </label>
                                        </div>
                                    </div>
                                </section>

                                <section className="rounded-[24px] border border-slate-200 bg-slate-50/50 p-5">
                                    <SectionTitle eyebrow="Proofs" title="Links & documents" />
                                    <div className="mt-4 grid gap-4 md:grid-cols-2">
                                        <label className="space-y-2">
                                            <span className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">Photo URL</span>
                                            <input
                                                value={leadForm.photoUrl}
                                                onChange={(event) => setLeadForm((current) => ({ ...current, photoUrl: event.target.value }))}
                                                placeholder="https://... or /uploads/..."
                                                className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm outline-none transition focus:border-slate-400 focus:ring-4 focus:ring-slate-100"
                                            />
                                        </label>
                                        <label className="space-y-2">
                                            <span className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">ID Proof URL</span>
                                            <input
                                                value={leadForm.idProofUrl}
                                                onChange={(event) => setLeadForm((current) => ({ ...current, idProofUrl: event.target.value }))}
                                                placeholder="https://... or /uploads/..."
                                                className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm outline-none transition focus:border-slate-400 focus:ring-4 focus:ring-slate-100"
                                            />
                                        </label>
                                    </div>
                                </section>

                                {leadLocationSuggestion ? (
                                <div className="grid gap-3 rounded-[20px] border border-slate-200 bg-white p-4 md:grid-cols-4">
                                    {[
                                        { label: "Village", value: leadLocationSuggestion.village || "—" },
                                        { label: "City", value: leadLocationSuggestion.city || "—" },
                                        { label: "District", value: leadLocationSuggestion.district || "—" },
                                        { label: "State", value: leadLocationSuggestion.state || "—" },
                                    ].map((item) => (
                                        <div key={item.label} className="rounded-2xl border border-slate-200 bg-slate-50/70 p-3">
                                            <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-slate-400">{item.label}</p>
                                            <p className="mt-2 text-sm font-semibold text-slate-900">{item.value}</p>
                                        </div>
                                    ))}
                                </div>
                            ) : null}
                            </div>

                            <div className="flex items-center justify-between gap-3 border-t border-slate-200 px-8 py-4">
                                <button
                                    type="button"
                                    disabled={creatingLead}
                                    onClick={() => setIsAddLeadModalOpen(false)}
                                    className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-600 transition hover:border-slate-300 hover:text-slate-900"
                                >
                                    Cancel
                                </button>
                                <button type="submit" disabled={creatingLead} className="btn btn-primary min-w-[220px] justify-center rounded-2xl px-4 py-3 text-sm disabled:opacity-60">
                                    {creatingLead ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                                    {creatingLead ? "Saving..." : "Create student"}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            ) : null}
        </section>
    );
}
