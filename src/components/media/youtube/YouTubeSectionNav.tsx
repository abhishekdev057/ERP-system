"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BarChart3, MessagesSquare, Vote } from "lucide-react";

const sections = [
    { href: "/content-studio/youtube", label: "Overview", icon: BarChart3 },
    { href: "/content-studio/youtube/polls", label: "Poll Command", icon: Vote },
    { href: "/content-studio/youtube/comments", label: "Comment Desk", icon: MessagesSquare },
];

export function YouTubeSectionNav() {
    const pathname = usePathname();

    return (
        <div className="mb-6 flex flex-wrap gap-3">
            {sections.map((section) => {
                const active = pathname === section.href;
                return (
                    <Link
                        key={section.href}
                        href={section.href}
                        className={`inline-flex items-center gap-2 rounded-full border px-4 py-2 text-sm font-semibold transition ${
                            active
                                ? "border-red-200 bg-red-50 text-red-700 shadow-[0_14px_30px_rgba(239,68,68,0.12)]"
                                : "border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:text-slate-900"
                        }`}
                    >
                        <section.icon className="h-4 w-4" />
                        {section.label}
                    </Link>
                );
            })}
        </div>
    );
}
