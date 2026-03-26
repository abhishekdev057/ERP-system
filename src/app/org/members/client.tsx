"use client";

import { useState } from "react";
import { Trash2, Plus, Mail, Key, Eye, EyeOff, RefreshCw } from "lucide-react";
import UserAvatar from "@/components/ui/UserAvatar";

type Member = {
    id: string;
    name: string | null;
    email: string | null;
    username: string | null;
    role: string;
    designation: string | null;
    image: string | null;
    visiblePassword: string | null;
    allowedTools: string[];
    createdAt: string;
    salaryMonthly: number | null;
    dateOfJoining: string | null;
};

function generateUsername() {
    const adjectives = ["bright", "swift", "smart", "quick", "sharp"];
    const adj = adjectives[Math.floor(Math.random() * adjectives.length)];
    return `${adj}_${Math.floor(Math.random() * 9000 + 1000)}`;
}

function generatePassword(length = 12) {
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789!@#$";
    let pwd = "";
    const arr = new Uint8Array(length);
    crypto.getRandomValues(arr);
    arr.forEach(b => { pwd += chars[b % chars.length]; });
    return pwd;
}

type Props = {
    orgId: string;
    orgName: string;
    members: Member[];
    orgAllowedTools: string[];
    addMemberByEmail: (fd: FormData) => Promise<void>;
    addMemberByCredentials: (fd: FormData) => Promise<void>;
    removeMember: (fd: FormData) => Promise<void>;
};

function getToolLabel(toolId: string): string {
    if (toolId === "pdf-to-pdf") return "Institute Suite";
    if (toolId === "media-studio") return "Media Studio";
    if (toolId === "whiteboard") return "Whiteboard";
    if (toolId === "library") return "Library";
    return toolId;
}

function formatDate(value: string | null): string {
    if (!value) return "Not set";
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return "Not set";
    return parsed.toLocaleDateString("en-IN", {
        day: "2-digit",
        month: "short",
        year: "numeric",
    });
}

function formatSalary(value: number | null): string {
    if (!Number.isFinite(value || NaN)) return "Not set";
    return `₹${Number(value).toLocaleString("en-IN")}/month`;
}

export function OrgMembersClient({
    orgId,
    orgName,
    members,
    orgAllowedTools,
    addMemberByEmail,
    addMemberByCredentials,
    removeMember,
}: Props) {
    const [mode, setMode] = useState<"email" | "credentials">("email");
    const [showPwd, setShowPwd] = useState<Record<string, boolean>>({});
    const [username, setUsername] = useState(generateUsername());
    const [password, setPassword] = useState(generatePassword());

    const refresh = () => {
        setUsername(generateUsername());
        setPassword(generatePassword());
    };

    return (
        <div className="space-y-6">
            {/* Header */}
            <div>
                <h1 className="text-2xl font-extrabold text-slate-900">Members</h1>
                <p className="text-sm text-slate-500 mt-1">Add and manage members of <span className="font-semibold text-slate-700">{orgName}</span>.</p>
            </div>

            {/* Add Member Card */}
            <div className="bg-white rounded-2xl ring-1 ring-slate-200 p-6">
                <div className="flex items-center justify-between mb-5">
                    <h2 className="font-semibold text-slate-900">Add New Member</h2>
                    <div className="flex bg-slate-100 p-0.5 rounded-lg">
                        <button onClick={() => setMode("email")} className={`px-3 py-1.5 text-xs font-semibold rounded-md transition ${mode === "email" ? "bg-white shadow text-slate-900" : "text-slate-500"}`}>
                            <Mail className="w-3.5 h-3.5 inline mr-1" />Email Login
                        </button>
                        <button onClick={() => setMode("credentials")} className={`px-3 py-1.5 text-xs font-semibold rounded-md transition ${mode === "credentials" ? "bg-white shadow text-slate-900" : "text-slate-500"}`}>
                            <Key className="w-3.5 h-3.5 inline mr-1" />Credentials
                        </button>
                    </div>
                </div>

                {mode === "email" ? (
                    <form action={addMemberByEmail} className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <input type="text" name="name" placeholder="Full Name" className="col-span-2 sm:col-span-1 input-field px-4 py-2 border border-slate-200 rounded-xl text-sm" />
                        <input type="email" name="email" required placeholder="Email Address (Google)" className="col-span-2 sm:col-span-1 px-4 py-2 border border-slate-200 rounded-xl text-sm" />
                        <input type="text" name="designation" placeholder="Designation (e.g. Teacher)" className="col-span-2 sm:col-span-1 px-4 py-2 border border-slate-200 rounded-xl text-sm" />
                        <input type="date" name="dateOfJoining" className="col-span-2 sm:col-span-1 px-4 py-2 border border-slate-200 rounded-xl text-sm" />
                        <input type="number" name="salaryMonthly" min={0} step={1} placeholder="Monthly Salary (INR)" className="col-span-2 sm:col-span-1 px-4 py-2 border border-slate-200 rounded-xl text-sm" />
                        <select name="role" className="col-span-2 sm:col-span-1 px-4 py-2 border border-slate-200 rounded-xl text-sm bg-white">
                            <option value="MEMBER">Member</option>
                            <option value="ORG_ADMIN">Org Admin</option>
                        </select>
                        <div className="col-span-2 border border-slate-200 rounded-xl p-3 bg-slate-50">
                            <p className="text-xs font-semibold text-slate-600 mb-2">Tool Access</p>
                            <div className="flex flex-wrap gap-2">
                                {orgAllowedTools.map((toolId) => (
                                    <label key={toolId} className="inline-flex items-center gap-2 px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white text-xs font-medium text-slate-700">
                                        <input type="checkbox" name="tools" value={toolId} defaultChecked />
                                        {getToolLabel(toolId)}
                                    </label>
                                ))}
                            </div>
                        </div>
                        <button type="submit" className="col-span-2 sm:col-span-1 bg-slate-900 text-white rounded-xl py-2 text-sm font-semibold hover:bg-slate-800 transition flex items-center justify-center gap-2">
                            <Plus className="w-4 h-4" /> Add via Email
                        </button>
                    </form>
                ) : (
                    <form action={addMemberByCredentials} className="space-y-4">
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            <div>
                                <label className="block text-xs font-semibold text-slate-600 mb-1">Full Name</label>
                                <input type="text" name="name" placeholder="e.g. Rahul Sharma" className="w-full px-4 py-2.5 border border-slate-200 rounded-xl text-sm" />
                            </div>
                            <div>
                                <label className="block text-xs font-semibold text-slate-600 mb-1">Role</label>
                                <select name="role" className="w-full px-4 py-2.5 border border-slate-200 rounded-xl text-sm bg-white">
                                    <option value="MEMBER">Member</option>
                                    <option value="ORG_ADMIN">Org Admin</option>
                                </select>
                            </div>
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                            <div>
                                <label className="block text-xs font-semibold text-slate-600 mb-1">Designation</label>
                                <input type="text" name="designation" placeholder="Teacher / Staff" className="w-full px-4 py-2.5 border border-slate-200 rounded-xl text-sm" />
                            </div>
                            <div>
                                <label className="block text-xs font-semibold text-slate-600 mb-1">Date of Joining</label>
                                <input type="date" name="dateOfJoining" className="w-full px-4 py-2.5 border border-slate-200 rounded-xl text-sm" />
                            </div>
                            <div>
                                <label className="block text-xs font-semibold text-slate-600 mb-1">Monthly Salary (INR)</label>
                                <input type="number" name="salaryMonthly" min={0} step={1} className="w-full px-4 py-2.5 border border-slate-200 rounded-xl text-sm" />
                            </div>
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            <div>
                                <label className="block text-xs font-semibold text-slate-600 mb-1">Username</label>
                                <div className="flex gap-2">
                                    <input value={username} onChange={e => setUsername(e.target.value)} name="username" required className="flex-1 px-4 py-2.5 border border-slate-200 rounded-xl text-sm font-mono" />
                                    <button type="button" onClick={refresh} title="Regenerate" className="px-2.5 py-2.5 border border-slate-200 rounded-xl hover:bg-slate-50">
                                        <RefreshCw className="w-4 h-4 text-slate-500" />
                                    </button>
                                </div>
                            </div>
                            <div>
                                <label className="block text-xs font-semibold text-slate-600 mb-1">Password</label>
                                <div className="flex gap-2">
                                    <input value={password} onChange={e => setPassword(e.target.value)} name="password" required className="flex-1 px-4 py-2.5 border border-slate-200 rounded-xl text-sm font-mono" />
                                    <button type="button" onClick={refresh} title="Regenerate" className="px-2.5 py-2.5 border border-slate-200 rounded-xl hover:bg-slate-50">
                                        <RefreshCw className="w-4 h-4 text-slate-500" />
                                    </button>
                                </div>
                            </div>
                        </div>
                        <div className="border border-slate-200 rounded-xl p-3 bg-slate-50">
                            <p className="text-xs font-semibold text-slate-600 mb-2">Tool Access</p>
                            <div className="flex flex-wrap gap-2">
                                {orgAllowedTools.map((toolId) => (
                                    <label key={toolId} className="inline-flex items-center gap-2 px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white text-xs font-medium text-slate-700">
                                        <input type="checkbox" name="tools" value={toolId} defaultChecked />
                                        {getToolLabel(toolId)}
                                    </label>
                                ))}
                            </div>
                        </div>
                        <button type="submit" className="w-full bg-slate-900 text-white rounded-xl py-2.5 text-sm font-semibold hover:bg-slate-800 transition flex items-center justify-center gap-2">
                            <Plus className="w-4 h-4" /> Create Member with Credentials
                        </button>
                    </form>
                )}
            </div>

            {/* Members Table */}
            <div className="bg-white rounded-2xl ring-1 ring-slate-200 overflow-hidden">
                <div className="px-6 py-4 border-b border-slate-100">
                    <h2 className="font-semibold text-slate-900">All Members ({members.length})</h2>
                </div>
                {members.length === 0 ? (
                    <p className="text-center text-sm text-slate-400 py-10">No members yet. Add one above.</p>
                ) : (
                    <div className="divide-y divide-slate-100">
                        {members.map((m) => (
                            <div key={m.id} className="px-6 py-4 flex items-center justify-between gap-4">
                                <div className="flex items-center gap-3">
                                    <UserAvatar
                                        src={m.image}
                                        name={m.name}
                                        email={m.email || m.username}
                                        sizeClass="w-9 h-9"
                                    />
                                    <div>
                                        <p className="text-sm font-semibold text-slate-900">{m.name || "Unnamed"}</p>
                                        <p className="text-xs text-slate-500">{m.email || m.username}</p>
                                        {m.designation && <p className="text-xs text-slate-400 italic">{m.designation}</p>}
                                        <p className="text-xs text-slate-500 mt-0.5">
                                            DOJ: {formatDate(m.dateOfJoining)} · Salary: {formatSalary(m.salaryMonthly)}
                                        </p>
                                        <div className="flex flex-wrap gap-1 mt-1.5">
                                            {(m.allowedTools || []).map((toolId) => (
                                                <span key={toolId} className="px-1.5 py-0.5 rounded-md text-[10px] font-semibold bg-slate-100 text-slate-600 border border-slate-200">
                                                    {getToolLabel(toolId)}
                                                </span>
                                            ))}
                                        </div>
                                    </div>
                                </div>
                                <div className="flex items-center gap-3">
                                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider ${m.role === "ORG_ADMIN" ? "bg-blue-100 text-blue-700" : "bg-slate-100 text-slate-600"}`}>
                                        {m.role === "ORG_ADMIN" ? "Workspace Admin" : "Workspace Member"}
                                    </span>
                                    {m.visiblePassword && (
                                        <div className="flex items-center gap-1">
                                            <span className="text-xs font-mono bg-amber-50 text-amber-700 border border-amber-200 px-2 py-0.5 rounded">
                                                {showPwd[m.id] ? m.visiblePassword : "••••••••"}
                                            </span>
                                            <button
                                                type="button"
                                                onClick={() => setShowPwd(p => ({ ...p, [m.id]: !p[m.id] }))}
                                                className="text-slate-400 hover:text-slate-700"
                                            >
                                                {showPwd[m.id] ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                                            </button>
                                        </div>
                                    )}
                                    <form action={removeMember}>
                                        <input type="hidden" name="userId" value={m.id} />
                                        <button type="submit" onClick={(e) => { if (!confirm(`Remove ${m.name || m.username}?`)) e.preventDefault(); }}
                                            className="text-red-400 hover:text-red-600 transition">
                                            <Trash2 className="w-4 h-4" />
                                        </button>
                                    </form>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}
