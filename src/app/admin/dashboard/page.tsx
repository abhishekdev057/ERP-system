"use client";

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Building2, Users, FileText, Library, Activity } from "lucide-react";

interface AdminStats {
    totalOrgs: number;
    totalUsers: number;
    totalDocs: number;
    totalBooks: number;
}

export default function AdminDashboardPage() {
    const { data: session, status } = useSession();
    const router = useRouter();
    const [stats, setStats] = useState<AdminStats | null>(null);
    const [isLoading, setIsLoading] = useState(true);

    useEffect(() => {
        if (status === "unauthenticated" || (status === "authenticated" && session?.user?.role !== "SYSTEM_ADMIN")) {
            router.replace("/");
        }
    }, [status, session, router]);

    useEffect(() => {
        async function fetchStats() {
            if (session?.user?.role !== "SYSTEM_ADMIN") return;
            try {
                const res = await fetch("/api/admin/stats");
                if (res.ok) {
                    const data = await res.json();
                    setStats(data);
                }
            } catch (error) {
                console.error("Error fetching stats:", error);
            } finally {
                setIsLoading(false);
            }
        }
        fetchStats();
    }, [session]);

    if (status === "loading" || isLoading) {
        return (
            <div className="page-container flex flex-col items-center justify-center min-h-[60vh] gap-4">
                <div className="w-10 h-10 border-4 border-slate-200 border-t-blue-600 rounded-full animate-spin" />
                <p className="text-sm font-medium text-slate-500 animate-pulse">Loading system analytics...</p>
            </div>
        );
    }

    if (!session || session.user.role !== "SYSTEM_ADMIN") {
        return null; // Will redirect
    }

    return (
        <div className="page-container">
            <header className="page-header mb-8">
                <div>
                    <span className="eyebrow flex items-center gap-2 text-blue-600">
                        <Activity className="w-4 h-4" /> System Administration
                    </span>
                    <h1 className="heading-xl mt-3">Platform Overview</h1>
                    <p className="text-sm text-slate-500 mt-2">
                        Global metrics and resource utilization across all registered institutes.
                    </p>
                </div>
                <div className="flex flex-wrap gap-3">
                    <Link href="/admin/workspaces" className="btn btn-secondary">
                        Manage Institutes
                    </Link>
                    <Link href="/admin/users" className="btn btn-primary">
                        Manage Users
                    </Link>
                </div>
            </header>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                <div className="surface-premium p-6 rounded-2xl hover-lift flex flex-col gap-4">
                    <div className="flex items-center justify-between">
                        <h3 className="text-sm font-semibold text-slate-600">Total Institutes</h3>
                        <div className="p-2 bg-blue-50 rounded-lg text-blue-600">
                            <Building2 className="w-5 h-5" />
                        </div>
                    </div>
                    <div>
                        <p className="text-3xl font-bold tracking-tight text-slate-900">
                            {stats?.totalOrgs || 0}
                        </p>
                    </div>
                </div>

                <div className="surface-premium p-6 rounded-2xl hover-lift flex flex-col gap-4">
                    <div className="flex items-center justify-between">
                        <h3 className="text-sm font-semibold text-slate-600">Active Users</h3>
                        <div className="p-2 bg-emerald-50 rounded-lg text-emerald-600">
                            <Users className="w-5 h-5" />
                        </div>
                    </div>
                    <div>
                        <p className="text-3xl font-bold tracking-tight text-slate-900">
                            {stats?.totalUsers || 0}
                        </p>
                    </div>
                </div>

                <div className="surface-premium p-6 rounded-2xl hover-lift flex flex-col gap-4">
                    <div className="flex items-center justify-between">
                        <h3 className="text-sm font-semibold text-slate-600">Generated PDFs</h3>
                        <div className="p-2 bg-amber-50 rounded-lg text-amber-600">
                            <FileText className="w-5 h-5" />
                        </div>
                    </div>
                    <div>
                        <p className="text-3xl font-bold tracking-tight text-slate-900">
                            {stats?.totalDocs || 0}
                        </p>
                    </div>
                </div>

                <div className="surface-premium p-6 rounded-2xl hover-lift flex flex-col gap-4">
                    <div className="flex items-center justify-between">
                        <h3 className="text-sm font-semibold text-slate-600">Library Books</h3>
                        <div className="p-2 bg-purple-50 rounded-lg text-purple-600">
                            <Library className="w-5 h-5" />
                        </div>
                    </div>
                    <div>
                        <p className="text-3xl font-bold tracking-tight text-slate-900">
                            {stats?.totalBooks || 0}
                        </p>
                    </div>
                </div>
            </div>

            <section className="mt-12 surface p-6 rounded-2xl">
                <h2 className="text-lg font-bold text-slate-900 mb-4">Quick Governance Actions</h2>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <Link href="/admin/workspaces" className="p-4 border border-slate-200 rounded-xl hover:bg-slate-50 transition-colors flex items-start gap-4">
                        <div className="p-2 bg-slate-100 rounded-lg">
                            <Building2 className="w-5 h-5 text-slate-700" />
                        </div>
                        <div>
                            <h4 className="font-semibold text-slate-900">Provision Institutes</h4>
                            <p className="text-sm text-slate-500 mt-1">Create new orgs, assign tool permissions (e.g., enable Whiteboard), and manage tenant lifecycles.</p>
                        </div>
                    </Link>
                    <Link href="/admin/users" className="p-4 border border-slate-200 rounded-xl hover:bg-slate-50 transition-colors flex items-start gap-4">
                        <div className="p-2 bg-slate-100 rounded-lg">
                            <Users className="w-5 h-5 text-slate-700" />
                        </div>
                        <div>
                            <h4 className="font-semibold text-slate-900">User Identity & Access</h4>
                            <p className="text-sm text-slate-500 mt-1">View all registered users across institutes and generate new organization-specific credentials.</p>
                        </div>
                    </Link>
                </div>
            </section>
        </div>
    );
}
