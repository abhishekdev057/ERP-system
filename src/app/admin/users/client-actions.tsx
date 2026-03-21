"use client";

import { Trash2, Key, Mail, RefreshCw } from "lucide-react";
import { useState } from "react";

export function RoleSelect({ role, isSelf }: { role: string; isSelf: boolean }) {
    return (
        <select
            name="role"
            defaultValue={role}
            onChange={(e) => e.target.form?.requestSubmit()}
            disabled={isSelf && role === "SYSTEM_ADMIN"}
            className="block w-full rounded-md border-0 py-1.5 pl-3 pr-8 text-slate-900 ring-1 ring-inset ring-slate-300 focus:ring-2 focus:ring-inset focus:ring-blue-600 sm:text-sm sm:leading-6"
        >
            <option value="MEMBER">Member</option>
            <option value="ORG_ADMIN">Org Admin</option>
            <option value="SYSTEM_ADMIN">System Admin</option>
        </select>
    );
}

export function DeleteButton({ userName }: { userName: string }) {
    return (
        <button
            type="submit"
            className="text-red-500 hover:text-red-700 hover:bg-red-50 p-2 rounded-lg transition-colors"
            title="Delete User"
            onClick={(e) => {
                if (!window.confirm(`Are you sure you want to permanently delete ${userName}?`)) {
                    e.preventDefault();
                }
            }}
        >
            <Trash2 className="w-4 h-4" />
        </button>
    );
}

export function UserCreationForm({ organizations, action }: { organizations: { id: string, name: string }[], action: (formData: FormData) => void }) {
    const [mode, setMode] = useState<"email" | "credentials">("email");
    const [generatedUsername, setGeneratedUsername] = useState("");
    const [generatedPassword, setGeneratedPassword] = useState("");

    const generateCredentials = () => {
        // Generate pseudo-random username like user_XXXX
        const r1 = Math.floor(1000 + Math.random() * 9000);
        setGeneratedUsername(`user_${r1}`);

        // Generate strong password natively
        const charset = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*";
        let password = "";
        const randomValues = new Uint32Array(12);
        window.crypto.getRandomValues(randomValues);
        for (let i = 0; i < randomValues.length; i++) {
            password += charset[randomValues[i] % charset.length];
        }
        setGeneratedPassword(password);
    };

    return (
        <div className="bg-white p-6 rounded-2xl shadow-sm ring-1 ring-slate-200">
            <div className="flex items-center justify-between mb-6">
                <h2 className="text-lg font-semibold text-slate-900">Provision New User</h2>
                <div className="flex bg-slate-100 p-1 rounded-lg">
                    <button
                        type="button"
                        onClick={() => setMode("email")}
                        className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${mode === "email" ? "bg-white text-slate-900 shadow-sm" : "text-slate-600 hover:text-slate-900"}`}
                    >
                        <Mail className="w-4 h-4" /> Email Login
                    </button>
                    <button
                        type="button"
                        onClick={() => setMode("credentials")}
                        className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${mode === "credentials" ? "bg-white text-slate-900 shadow-sm" : "text-slate-600 hover:text-slate-900"}`}
                    >
                        <Key className="w-4 h-4" /> Auto-Credentials
                    </button>
                </div>
            </div>

            <form action={action} className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {/* Organization Assignment */}
                    <div>
                        <label className="block text-sm font-medium text-slate-700">Assign to Institute</label>
                        <select name="orgId" required={mode === "credentials"} className="mt-1 w-full rounded-lg border-slate-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm py-2 px-3 border bg-white">
                            <option value="">{mode === "credentials" ? "Select Organization Required..." : "Optional: Select Organization..."}</option>
                            {organizations.map(org => (
                                <option key={org.id} value={org.id}>{org.name} (ID: {org.id})</option>
                            ))}
                        </select>
                    </div>

                    {/* Role Assignment */}
                    <div>
                        <label className="block text-sm font-medium text-slate-700">Role</label>
                        <select name="role" required className="mt-1 w-full rounded-lg border-slate-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm py-2 px-3 border bg-white">
                            <option value="MEMBER">Member</option>
                            <option value="ORG_ADMIN">Org Admin</option>
                            <option value="SYSTEM_ADMIN">System Admin</option>
                        </select>
                    </div>

                    {/* Basic Details */}
                    <div>
                        <label className="block text-sm font-medium text-slate-700">Full Name</label>
                        <input type="text" name="name" className="mt-1 w-full rounded-lg border-slate-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm py-2 px-3 border" placeholder="John Doe" />
                    </div>

                    {mode === "email" ? (
                        <div>
                            <label className="block text-sm font-medium text-slate-700">Email Address</label>
                            <input type="email" name="email" required className="mt-1 w-full rounded-lg border-slate-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm py-2 px-3 border" placeholder="john@example.com" />
                            <p className="mt-1 text-xs text-slate-500">The user will sign in with this Google account.</p>
                        </div>
                    ) : (
                        <div className="col-span-1 md:col-span-2 grid grid-cols-1 md:grid-cols-2 gap-4 border-t border-slate-100 pt-4 mt-2">
                            <div className="md:col-span-2 flex justify-end">
                                <button type="button" onClick={generateCredentials} className="flex items-center gap-2 px-3 py-1.5 bg-blue-50 text-blue-700 rounded-md text-sm font-medium hover:bg-blue-100 transition-colors">
                                    <RefreshCw className="w-4 h-4" /> Auto-Generate
                                </button>
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-slate-700">Username</label>
                                <input type="text" name="username" value={generatedUsername} onChange={(e) => setGeneratedUsername(e.target.value)} required className="mt-1 w-full rounded-lg border-slate-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm py-2 px-3 border bg-slate-50 font-mono" placeholder="user_1234" />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-slate-700">Password</label>
                                <input type="text" name="password" value={generatedPassword} onChange={(e) => setGeneratedPassword(e.target.value)} required className="mt-1 w-full rounded-lg border-slate-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm py-2 px-3 border bg-slate-50 font-mono" placeholder="Generated Password" />
                                <p className="mt-1 text-xs text-slate-500">Visible only to System Admins in the table below.</p>
                            </div>
                        </div>
                    )}
                </div>

                <div className="pt-4 flex justify-end">
                    <button type="submit" className="bg-slate-900 text-white rounded-lg px-6 py-2.5 font-semibold text-sm hover:bg-slate-800 transition shadow-sm">
                        Create and Provision User
                    </button>
                </div>
            </form>
        </div>
    );
}
