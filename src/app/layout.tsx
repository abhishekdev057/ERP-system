import type { Metadata } from "next";
import { JetBrains_Mono, Manrope } from "next/font/google";
import { Toaster } from "react-hot-toast";
import { SessionProvider } from "@/components/auth-provider";
import AmbientScene from "@/components/layout/AmbientScene";
import AppNavbar from "@/components/layout/AppNavbar";
import CommandPalette from "@/components/layout/CommandPalette";
import "./globals.css";

const manrope = Manrope({
    subsets: ["latin"],
    variable: "--font-sans",
    display: "swap",
});

const jetBrainsMono = JetBrains_Mono({
    subsets: ["latin"],
    variable: "--font-mono",
    display: "swap",
});

export const metadata: Metadata = {
    title: "Nexora by Sigma Fusion | Institute Suite",
    description:
        "Unified content studio to transform raw PDFs and pages into structured outputs with Nexora by Sigma Fusion.",
};

export default function RootLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    return (
        <html lang="en">
            <body className={`${manrope.variable} ${jetBrainsMono.variable} font-sans`}>
                <SessionProvider>
                    <div className="app-shell">
                        <AmbientScene />
                        <script dangerouslySetInnerHTML={{ __html: `if (typeof Promise.try !== 'function') { Promise.try = function(fn, ...args) { return new Promise(resolve => resolve(fn(...args))); }; }` }} />
                        <Toaster
                            position="top-right"
                            gutter={12}
                            containerStyle={{ top: 18, right: 18 }}
                            toastOptions={{
                                duration: 3600,
                                className: "nexora-toast nexora-toast-info",
                                style: {
                                    background: "transparent",
                                    color: "#f8fafc",
                                    border: "none",
                                    borderRadius: "14px",
                                    boxShadow: "none",
                                    fontSize: "13px",
                                    fontWeight: 600,
                                    maxWidth: "420px",
                                },
                                success: {
                                    className: "nexora-toast nexora-toast-success",
                                    iconTheme: {
                                        primary: "#22c55e",
                                        secondary: "#ffffff",
                                    },
                                },
                                error: {
                                    className: "nexora-toast nexora-toast-error",
                                    iconTheme: {
                                        primary: "#ef4444",
                                        secondary: "#ffffff",
                                    },
                                },
                                loading: {
                                    className: "nexora-toast nexora-toast-loading",
                                },
                            }}
                        />

                        <AppNavbar />
                        <CommandPalette />
                        <main className="app-main page-reveal">{children}</main>
                    </div>
                </SessionProvider>
            </body>
        </html>
    );
}
