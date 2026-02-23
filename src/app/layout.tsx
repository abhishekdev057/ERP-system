import type { Metadata } from "next";
import { JetBrains_Mono, Manrope } from "next/font/google";
import { Toaster } from "react-hot-toast";
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
    title: "NACC Studio | PDF Workspace",
    description:
        "Modern workspace to generate NACC presentation PDFs from JSON and image extraction.",
};

export default function RootLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    return (
        <html lang="en">
            <body className={`${manrope.variable} ${jetBrainsMono.variable} font-sans`}>
                <Toaster
                    position="top-right"
                    toastOptions={{
                        duration: 3200,
                        style: {
                            background: "#0f172a",
                            color: "#ffffff",
                            borderRadius: "12px",
                            border: "1px solid rgba(148, 163, 184, 0.25)",
                            fontSize: "13px",
                            fontWeight: 600,
                        },
                        success: {
                            iconTheme: {
                                primary: "#22c55e",
                                secondary: "#ffffff",
                            },
                        },
                        error: {
                            iconTheme: {
                                primary: "#ef4444",
                                secondary: "#ffffff",
                            },
                        },
                    }}
                />

                <AppNavbar />
                <CommandPalette />
                <main>{children}</main>
            </body>
        </html>
    );
}
