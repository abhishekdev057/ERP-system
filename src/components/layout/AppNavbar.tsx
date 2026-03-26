"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSession, signOut } from "next-auth/react";
import UserAvatar from "@/components/ui/UserAvatar";

const navItems = [
    { id: "profile", href: "/profile", label: "Profile" },
    { id: "dashboard", href: "/", label: "Dashboard" },
    { id: "pdf-to-pdf", href: "/content-studio", label: "Institute Suite" },
    { id: "library", href: "/books", label: "Library" },
    { id: "whiteboard", href: "/whiteboard", label: "Whiteboard" },
];

const adminNavItems = [
    { id: "admin-analytics", href: "/admin/dashboard", label: "Platform Analytics" },
    { id: "admin-institutes", href: "/admin/workspaces", label: "Institutes" },
    { id: "admin-users", href: "/admin/users", label: "Users" },
];

function isItemActive(pathname: string, href: string) {
    if (href === "/") return pathname === "/";
    return pathname === href || pathname.startsWith(`${href}/`);
}

export default function AppNavbar() {
    const pathname = usePathname();
    const { data: session, status } = useSession();
    const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
    const isWhiteboardRoute = pathname === "/whiteboard" || pathname.startsWith("/whiteboard/");
    const isOnboardingRoute = pathname.startsWith("/onboarding");

    const role = (session?.user as any)?.role;
    const onboardingDone = (session?.user as any)?.onboardingDone;
    const allowedTools = Array.isArray((session?.user as any)?.allowedTools)
        ? ((session?.user as any)?.allowedTools as string[])
        : [];
    const allowedToolsSet = new Set(allowedTools);
    const hasContentStudioAccess =
        allowedToolsSet.has("pdf-to-pdf") || allowedToolsSet.has("media-studio");

    const isToolAllowed = (id: string) => {
        if (id === "dashboard" || id === "profile") return true;
        if (id === "pdf-to-pdf") return hasContentStudioAccess;
        return allowedToolsSet.has(id);
    };

    useEffect(() => {
        setIsMobileMenuOpen(false);
    }, [pathname]);

    useEffect(() => {
        const closeMenuOnDesktop = () => {
            if (window.innerWidth >= 961) {
                setIsMobileMenuOpen(false);
            }
        };

        closeMenuOnDesktop();
        window.addEventListener("resize", closeMenuOnDesktop);
        return () => window.removeEventListener("resize", closeMenuOnDesktop);
    }, []);

    const primaryNavItems = useMemo(() => {
        if (role === "SYSTEM_ADMIN") {
            return adminNavItems;
        }

        if (role === "ORG_ADMIN") {
            return [
                { id: "org", href: "/org", label: "My Org" },
                ...navItems.filter((item) => isToolAllowed(item.id)),
            ];
        }

        return navItems.filter((item) => isToolAllowed(item.id));
    }, [role, hasContentStudioAccess, allowedTools]);

    const activeNavLabel = useMemo(
        () => primaryNavItems.find((item) => isItemActive(pathname, item.href))?.label || "Workspace",
        [pathname, primaryNavItems]
    );

    const sessionRoleLabel =
        role === "SYSTEM_ADMIN"
            ? "System Admin"
            : role === "ORG_ADMIN"
                ? "Workspace Admin"
                : (session?.user as any)?.organizationId
                    ? "Workspace Member"
                    : "No Workspace";

    if (isWhiteboardRoute || isOnboardingRoute || status !== "authenticated") {
        return null;
    }

    return (
        <header className="top-nav">
            <div className="top-nav-inner">
                <div className="top-nav-shell">
                    <div className="top-nav-brand">
                        <Link href="/" className="top-nav-brand-link">
                            <span className="brand-mark">N</span>
                            <div className="top-nav-brand-copy min-w-0">
                                <p className="text-sm font-extrabold leading-none tracking-tight text-slate-900">Nexora by Sigma Fusion</p>
                                <p className="text-[10px] text-slate-500 uppercase tracking-[0.17em] font-semibold">Institute Management</p>
                            </div>
                        </Link>
                        <div className="top-nav-brand-graphic" aria-hidden="true">
                            <span className="top-nav-brand-graphic-line top-nav-brand-graphic-line-a" />
                            <span className="top-nav-brand-graphic-line top-nav-brand-graphic-line-b" />
                            <span className="top-nav-brand-graphic-line top-nav-brand-graphic-line-c" />
                            <span className="top-nav-brand-graphic-dot" />
                        </div>
                    </div>

                    <div className="top-nav-desktop">
                        <button
                            type="button"
                            className="top-nav-hint top-nav-hint-compact"
                            onClick={() => window.dispatchEvent(new CustomEvent("open-command-palette"))}
                        >
                            <span className="top-nav-hint-badge">K</span>
                            <span>Ctrl/Cmd + K</span>
                        </button>

                        <div className="top-nav-nav-shell">
                            <nav className="nav-links" aria-label="Primary">
                                {primaryNavItems.map((item) => (
                                    <Link
                                        key={item.href}
                                        href={item.href}
                                        className={`nav-link ${isItemActive(pathname, item.href) ? "nav-link-active" : ""}`}
                                    >
                                        {item.label}
                                    </Link>
                                ))}
                            </nav>
                        </div>

                        {session ? (
                            <div className="top-nav-session top-nav-session-card">
                                <div className="top-nav-session-copy">
                                    <div className="top-nav-session-meta">
                                        <span className="top-nav-session-kicker">Signed in</span>
                                        <span className="top-nav-session-route">{activeNavLabel}</span>
                                    </div>
                                    <span className="text-sm font-semibold text-slate-900 leading-tight">
                                        {session.user?.name || session.user?.email?.split('@')[0] || "User"}
                                    </span>
                                    <span className="text-xs text-slate-500 font-medium">
                                        {sessionRoleLabel}
                                    </span>
                                </div>
                                <div className="relative">
                                    <UserAvatar
                                        src={session.user?.image}
                                        name={session.user?.name}
                                        email={session.user?.email}
                                        alt="Avatar"
                                        sizeClass="w-8 h-8"
                                        className="border border-slate-200"
                                        textClassName="text-sm"
                                    />
                                    {!onboardingDone && role !== "SYSTEM_ADMIN" && (
                                        <span
                                            className="absolute -top-1 -right-1 w-3 h-3 bg-amber-400 border-2 border-white rounded-full animate-pulse"
                                            title="Setup Required — click to complete your profile"
                                        />
                                    )}
                                </div>
                                <button
                                    onClick={() => signOut({ callbackUrl: "/auth/signin" })}
                                    className="top-nav-signout"
                                >
                                    Sign Out
                                </button>
                            </div>
                        ) : (
                            <div className="top-nav-session-card top-nav-session-card-guest">
                                <Link href="/auth/signin" className="text-sm font-semibold text-blue-600 hover:text-blue-700">
                                    Sign In
                                </Link>
                            </div>
                        )}
                    </div>

                    <div className="top-nav-mobile-actions">
                        <button
                            type="button"
                            className="top-nav-icon-btn"
                            aria-label="Open command palette"
                            onClick={() => window.dispatchEvent(new CustomEvent("open-command-palette"))}
                        >
                            <span className="font-bold text-[11px]">K</span>
                        </button>
                        <button
                            type="button"
                            className={`top-nav-icon-btn ${isMobileMenuOpen ? "is-active" : ""}`}
                            aria-label={isMobileMenuOpen ? "Close menu" : "Open menu"}
                            aria-expanded={isMobileMenuOpen}
                            onClick={() => setIsMobileMenuOpen((prev) => !prev)}
                        >
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
                                {isMobileMenuOpen ? (
                                    <>
                                        <path d="M6 6L18 18" />
                                        <path d="M18 6L6 18" />
                                    </>
                                ) : (
                                    <>
                                        <path d="M4 7H20" />
                                        <path d="M4 12H20" />
                                        <path d="M4 17H20" />
                                    </>
                                )}
                            </svg>
                        </button>
                    </div>
                </div>
            </div>

            <div className={`top-nav-mobile-panel ${isMobileMenuOpen ? "is-open" : ""}`}>
                <div className="top-nav-mobile-card">
                    {session ? (
                        <div className="top-nav-mobile-user">
                            <div className="flex items-center gap-3 min-w-0">
                                <div className="relative">
                                    <UserAvatar
                                        src={session.user?.image}
                                        name={session.user?.name}
                                        email={session.user?.email}
                                        alt="Avatar"
                                        sizeClass="w-10 h-10"
                                        className="border border-slate-200"
                                        textClassName="text-sm"
                                    />
                                    {!onboardingDone && role !== "SYSTEM_ADMIN" && (
                                        <span
                                            className="absolute -top-1 -right-1 w-3 h-3 bg-amber-400 border-2 border-white rounded-full animate-pulse"
                                            title="Setup Required — click to complete your profile"
                                        />
                                    )}
                                </div>
                                <div className="min-w-0">
                                    <p className="text-sm font-semibold text-slate-900 truncate">
                                        {session.user?.name || session.user?.email?.split("@")[0] || "User"}
                                    </p>
                                    <p className="text-xs text-slate-500 font-medium truncate">{sessionRoleLabel}</p>
                                </div>
                            </div>
                            <button
                                type="button"
                                onClick={() => signOut({ callbackUrl: "/auth/signin" })}
                                className="btn btn-ghost text-xs"
                            >
                                Sign Out
                            </button>
                        </div>
                    ) : (
                        <div className="top-nav-mobile-user">
                            <div>
                                <p className="text-sm font-semibold text-slate-900">Account</p>
                                <p className="text-xs text-slate-500">Sign in to access the workspace.</p>
                            </div>
                            <Link href="/auth/signin" className="btn btn-secondary text-xs" onClick={() => setIsMobileMenuOpen(false)}>
                                Sign In
                            </Link>
                        </div>
                    )}

                    <nav className="top-nav-mobile-links" aria-label="Mobile primary">
                        {primaryNavItems.map((item) => (
                            <Link
                                key={`mobile-${item.href}`}
                                href={item.href}
                                className={`top-nav-mobile-link ${isItemActive(pathname, item.href) ? "is-active" : ""}`}
                                onClick={() => setIsMobileMenuOpen(false)}
                            >
                                <span>{item.label}</span>
                                <span className="top-nav-mobile-link-arrow">/</span>
                            </Link>
                        ))}
                    </nav>

                    <div className="top-nav-mobile-actions-list">
                        <button
                            type="button"
                            className="btn btn-secondary text-xs"
                            onClick={() => {
                                setIsMobileMenuOpen(false);
                                window.dispatchEvent(new CustomEvent("open-command-palette"));
                            }}
                        >
                            Open Command K
                        </button>
                    </div>
                </div>
            </div>
        </header>
    );
}
