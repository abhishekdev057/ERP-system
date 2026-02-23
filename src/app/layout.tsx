import type { Metadata } from "next";
import "./globals.css";
import Link from "next/link";
import { Toaster } from "react-hot-toast";

export const metadata: Metadata = {
    title: "NACC PPT Maker — Generate Presentation PDFs",
    description:
        "Generate professional presentation-style PDFs with bilingual questions for NACC Agriculture Institute",
};

export default function RootLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    return (
        <html lang="en">
            <body>
                {/* Animated background */}
                <div className="particles-bg">
                    <div className="blob" />
                </div>

                {/* Toast Notifications */}
                <Toaster
                    position="top-right"
                    toastOptions={{
                        duration: 3000,
                        style: {
                            background: 'linear-gradient(135deg, #1e1e2e 0%, #0f0f1a 100%)',
                            color: '#fff',
                            borderRadius: '16px',
                            padding: '14px 20px',
                            fontSize: '13px',
                            fontWeight: 500,
                            boxShadow: '0 10px 40px rgba(0, 0, 0, 0.3)',
                        },
                        success: {
                            iconTheme: {
                                primary: '#34d399',
                                secondary: '#fff',
                            },
                        },
                        error: {
                            iconTheme: {
                                primary: '#f87171',
                                secondary: '#fff',
                            },
                        },
                    }}
                />

                {/* Navbar - Puffy & Soft */}
                <nav className="navbar">
                    <div className="max-w-7xl mx-auto px-5 py-2.5 flex items-center justify-between">
                        <Link href="/" className="flex items-center gap-2.5 no-underline group">
                            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-amber-100 via-amber-200 to-orange-200 flex items-center justify-center shadow-lg shadow-amber-200/50 group-hover:scale-105 transition-transform">
                                <span className="text-sm font-black text-amber-800 tracking-tight">
                                    N
                                </span>
                            </div>
                            <div>
                                <h1 className="text-base font-bold text-slate-800 leading-tight">
                                    NACC <span className="gradient-text">PPT Maker</span>
                                </h1>
                                <p className="text-[9px] text-slate-500 uppercase tracking-widest font-medium">
                                    Soft Slides PDF Studio
                                </p>
                            </div>
                        </Link>

                        <div className="flex items-center gap-1.5">
                            <Link
                                href="/"
                                className="navbar-link text-xs"
                            >
                                <span className="flex items-center gap-1.5">
                                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                        <rect x="3" y="3" width="7" height="7"></rect>
                                        <rect x="14" y="3" width="7" height="7"></rect>
                                        <rect x="14" y="14" width="7" height="7"></rect>
                                        <rect x="3" y="14" width="7" height="7"></rect>
                                    </svg>
                                    Dashboard
                                </span>
                            </Link>
                            <Link
                                href="/generate"
                                className="navbar-link text-xs"
                            >
                                <span className="flex items-center gap-1.5">
                                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                        <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"></path>
                                        <polyline points="14 2 14 8 20 8"></polyline>
                                        <line x1="12" y1="18" x2="12" y2="12"></line>
                                        <line x1="9" y1="15" x2="15" y2="15"></line>
                                    </svg>
                                    JSON to PDF
                                </span>
                            </Link>
                            <Link
                                href="/image-to-pdf"
                                className="navbar-link text-xs"
                            >
                                <span className="flex items-center gap-1.5">
                                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                        <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                                        <circle cx="8.5" cy="8.5" r="1.5" />
                                        <polyline points="21 15 16 10 5 21" />
                                    </svg>
                                    Image to PDF
                                </span>
                            </Link>
                            <Link
                                href="/history"
                                className="navbar-link text-xs"
                            >
                                <span className="flex items-center gap-1.5">
                                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                        <circle cx="12" cy="12" r="10"></circle>
                                        <polyline points="12 6 12 12 16 14"></polyline>
                                    </svg>
                                    History
                                </span>
                            </Link>
                            <Link
                                href="/books"
                                className="navbar-link text-xs"
                            >
                                <span className="flex items-center gap-1.5">
                                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                        <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"></path>
                                        <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"></path>
                                    </svg>
                                    Books
                                </span>
                            </Link>
                            <Link href="/generate" className="glow-btn text-xs px-4 py-2 ml-1.5">
                                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                    <path d="M12 5v14M5 12h14" />
                                </svg>
                                New PDF
                            </Link>
                        </div>
                    </div>
                </nav>

                {/* Main content */}
                <main className="relative z-10">{children}</main>
            </body>
        </html>
    );
}
