import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { redirect } from "next/navigation";
import Link from "next/link";
import { Building2, Sparkles, Users, Wrench } from "lucide-react";

export default async function OrgLayout({ children }: { children: React.ReactNode }) {
    const session = await getServerSession(authOptions);

    if ((session?.user as any)?.role !== "ORG_ADMIN") {
        redirect("/");
    }

    return (
        <div className="page-container">
            <nav className="mb-6 flex max-w-full items-center gap-1 overflow-x-auto rounded-2xl border border-slate-200 bg-white/85 p-1.5 shadow-sm backdrop-blur">
                <Link href="/org" className="flex shrink-0 items-center gap-2 whitespace-nowrap rounded-xl px-3.5 py-2 text-sm font-semibold text-slate-600 transition-all hover:bg-slate-50 hover:text-slate-900">
                    <Building2 className="w-4 h-4" /> Overview
                </Link>
                <Link href="/org/profile" className="flex shrink-0 items-center gap-2 whitespace-nowrap rounded-xl px-3.5 py-2 text-sm font-semibold text-slate-600 transition-all hover:bg-slate-50 hover:text-slate-900">
                    <Sparkles className="w-4 h-4" /> Institution Profile
                </Link>
                <Link href="/org/members" className="flex shrink-0 items-center gap-2 whitespace-nowrap rounded-xl px-3.5 py-2 text-sm font-semibold text-slate-600 transition-all hover:bg-slate-50 hover:text-slate-900">
                    <Users className="w-4 h-4" /> Members
                </Link>
                <Link href="/org/tools" className="flex shrink-0 items-center gap-2 whitespace-nowrap rounded-xl px-3.5 py-2 text-sm font-semibold text-slate-600 transition-all hover:bg-slate-50 hover:text-slate-900">
                    <Wrench className="w-4 h-4" /> Tool Access
                </Link>
            </nav>
            {children}
        </div>
    );
}
