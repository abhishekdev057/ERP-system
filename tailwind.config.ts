import type { Config } from "tailwindcss";

const config: Config = {
    content: [
        "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
        "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
        "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
    ],
    theme: {
        extend: {
            colors: {
                navy: {
                    900: "#0a1628",
                    800: "#0f1d32",
                    700: "#1a2d4a",
                    600: "#243b5c",
                },
                accent: {
                    gold: "#f9c74f",
                    goldLight: "#faf3e0",
                    rose: "#f472b6",
                    roseLight: "#fdf2f8",
                    cyan: "#22d3ee",
                    cyanLight: "#ecfeff",
                    violet: "#a78bfa",
                    violetLight: "#f5f3ff",
                    emerald: "#34d399",
                    emeraldLight: "#ecfdf5",
                },
            },
            fontFamily: {
                sans: ["Outfit", "system-ui", "sans-serif"],
            },
            animation: {
                "fade-in-up": "fadeInUp 0.5s ease-out forwards",
                "float-slow": "float-slow 6s ease-in-out infinite",
            },
            keyframes: {
                fadeInUp: {
                    from: {
                        opacity: "0",
                        transform: "translateY(20px)",
                    },
                    to: {
                        opacity: "1",
                        transform: "translateY(0)",
                    },
                },
                "float-slow": {
                    "0%, 100%": {
                        transform: "translateY(0px)",
                    },
                    "50%": {
                        transform: "translateY(-15px)",
                    },
                },
            },
        },
    },
    plugins: [],
};

export default config;
