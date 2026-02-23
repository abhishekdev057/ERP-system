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
                    gutter={12}
                    containerStyle={{ top: 18, right: 18 }}
                    toastOptions={{
                        duration: 3600,
                        className: "nacc-toast nacc-toast-info",
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
                            className: "nacc-toast nacc-toast-success",
                            iconTheme: {
                                primary: "#22c55e",
                                secondary: "#ffffff",
                            },
                        },
                        error: {
                            className: "nacc-toast nacc-toast-error",
                            iconTheme: {
                                primary: "#ef4444",
                                secondary: "#ffffff",
                            },
                        },
                        loading: {
                            className: "nacc-toast nacc-toast-loading",
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
