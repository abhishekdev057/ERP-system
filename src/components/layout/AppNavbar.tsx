"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const navItems = [
    { href: "/", label: "Dashboard" },
    { href: "/generate", label: "JSON to PDF" },
    { href: "/image-to-pdf", label: "Image to PDF" },
    { href: "/history", label: "History" },
    { href: "/books", label: "Library" },
];

function isItemActive(pathname: string, href: string) {
    if (href === "/") return pathname === "/";
    return pathname === href || pathname.startsWith(`${href}/`);
}

export default function AppNavbar() {
    const pathname = usePathname();

    return (
        <header className="top-nav">
            <div className="top-nav-inner">
                <div className="flex items-center gap-3 min-w-0">
                    <Link href="/" className="flex items-center gap-2 no-underline min-w-0">
                        <span className="brand-mark">N</span>
                        <div className="min-w-0">
                            <p className="text-sm font-extrabold leading-none tracking-tight text-slate-900">NACC Studio</p>
                            <p className="text-[10px] text-slate-500 uppercase tracking-[0.17em] font-semibold">Presentation Platform</p>
                        </div>
                    </Link>
                </div>

                <div className="flex items-center gap-2">
                    <nav className="nav-links" aria-label="Primary">
                        {navItems.map((item) => {
                            const active = isItemActive(pathname, item.href);
                            return (
                                <Link
                                    key={item.href}
                                    href={item.href}
                                    className={`nav-link ${active ? "nav-link-active" : ""}`}
                                >
                                    {item.label}
                                </Link>
                            );
                        })}
                    </nav>
                    <Link href="/generate" className="btn btn-primary text-xs">
                        New PDF
                    </Link>
                </div>
            </div>
        </header>
    );
}
