"use client";

import { signIn } from "next-auth/react";
import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import toast from "react-hot-toast";
import { useEffect } from "react";

function SignInContent() {
    const [tab, setTab] = useState<"google" | "credentials">("google");
    const [organizationId, setOrganizationId] = useState("");
    const [username, setUsername] = useState("");
    const [password, setPassword] = useState("");
    const [loading, setLoading] = useState(false);
    const searchParams = useSearchParams();

    useEffect(() => {
        const error = searchParams.get("error");
        if (error === "AccessDenied") {
            toast.error("Access Denied: Your account has not been invited to this platform. Please contact your system administrator.");
        } else if (error === "OAuthAccountNotLinked") {
            toast.error("Account not linked. Please use your Organization credentials to sign in, or contact your admin.");
        }
    }, [searchParams]);

    const handleGoogleSignIn = async () => {
        setLoading(true);
        await signIn("google", { callbackUrl: "/" });
    };

    const handleCredentialsSignIn = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);

        try {
            const res = await signIn("credentials", {
                redirect: false,
                organizationId,
                username,
                password,
                callbackUrl: "/",
            });

            if (res?.error) {
                toast.error(res.error);
                setLoading(false);
            } else if (res?.url) {
                window.location.href = res.url;
            }
        } catch (error) {
            toast.error("An unexpected error occurred.");
            setLoading(false);
        }
    };

    return (
        <div className="flex min-h-screen bg-white">
            {/* Left side: Premium Image/Gradient */}
            <div className="hidden lg:flex lg:w-1/2 relative bg-slate-900 items-center justify-center overflow-hidden">
                <div className="absolute inset-0 z-0">
                    <img
                        src="https://images.unsplash.com/photo-1522202176988-66273c2fd55f?ixlib=rb-4.0.3&auto=format&fit=crop&w=1920&q=80"
                        alt="Students learning"
                        className="object-cover w-full h-full opacity-30 mix-blend-overlay"
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-slate-950 via-slate-900/80 to-transparent" />
                </div>

                <div className="relative z-10 p-12 lg:p-24 flex flex-col justify-end h-full w-full">
                    <div className="mb-8 max-w-md">
                        <div className="flex items-center gap-3 mb-6">
                            <div className="w-12 h-12 bg-blue-600 rounded-xl flex items-center justify-center shadow-2xl shadow-blue-500/30">
                                <span className="text-white font-extrabold text-xl">N</span>
                            </div>
                            <div>
                                <p className="text-white font-extrabold text-lg leading-none">Nexora by Sigma Fusion</p>
                                <p className="text-blue-300 text-xs font-medium tracking-widest uppercase mt-0.5">Institute Management</p>
                            </div>
                        </div>
                        <h1 className="text-4xl lg:text-5xl font-extrabold text-white tracking-tight mb-4 leading-tight">
                            Elevate your <br /><span className="text-blue-400">institute's</span> management.
                        </h1>
                        <p className="text-lg text-slate-300 leading-relaxed">
                            Nexora by Sigma Fusion is the complete operating system for modern coachings, schools, and academies. Access your secure workspace.
                        </p>
                    </div>
                </div>
            </div>

            {/* Right side: Login Form */}
            <div className="w-full lg:w-1/2 flex items-center justify-center p-8 sm:p-12 lg:p-24 bg-white">
                <div className="w-full max-w-md mx-auto">
                    <div className="mb-10 lg:hidden flex justify-center">
                        <div className="flex items-center gap-2">
                            <div className="w-10 h-10 bg-blue-600 rounded-xl flex items-center justify-center">
                                <span className="text-white font-extrabold text-lg">N</span>
                            </div>
                            <div>
                                <p className="font-extrabold text-slate-900 text-base leading-none">Nexora by Sigma Fusion</p>
                                <p className="text-slate-400 text-[10px] font-medium tracking-widest uppercase">Institute Management</p>
                            </div>
                        </div>
                    </div>

                    <h2 className="text-3xl font-extrabold text-slate-900 tracking-tight lg:text-left text-center">Welcome back</h2>
                    <p className="mt-2 text-sm text-slate-500 lg:text-left text-center mb-10">
                        Sign in to access your secure workspace.
                    </p>

                    {/* Tabs */}
                    <div className="flex bg-slate-100/80 p-1 rounded-xl mb-8">
                        <button
                            onClick={() => setTab("google")}
                            className={`flex-1 text-sm font-semibold py-3 rounded-lg transition-all ${tab === "google"
                                ? "bg-white text-slate-900 shadow-sm ring-1 ring-slate-200"
                                : "text-slate-500 hover:text-slate-700"
                                }`}
                        >
                            Google Account
                        </button>
                        <button
                            onClick={() => setTab("credentials")}
                            className={`flex-1 text-sm font-semibold py-3 rounded-lg transition-all ${tab === "credentials"
                                ? "bg-white text-slate-900 shadow-sm ring-1 ring-slate-200"
                                : "text-slate-500 hover:text-slate-700"
                                }`}
                        >
                            Organization
                        </button>
                    </div>

                    {tab === "google" ? (
                        <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-300">
                            <button
                                onClick={handleGoogleSignIn}
                                disabled={loading}
                                className="w-full flex items-center justify-center py-4 px-4 border border-slate-200 rounded-xl shadow-sm bg-white text-sm font-semibold text-slate-700 hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 transition-all active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                <svg className="w-5 h-5 mr-3" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                                    <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4" />
                                    <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
                                    <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
                                    <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
                                </svg>
                                {loading ? "Signing in..." : "Continue with Google"}
                            </button>
                            <p className="text-center text-xs text-slate-500 mt-6 lg:max-w-xs mx-auto">
                                Secure system access. If you are a System Admin or have an email linked to an organization, continue with Google.
                            </p>
                        </div>
                    ) : (
                        <form className="animate-in fade-in slide-in-from-bottom-2 duration-300" onSubmit={handleCredentialsSignIn}>
                            <div className="space-y-4">
                                <div>
                                    <label className="block text-sm font-semibold text-slate-700 mb-1.5">Organization ID</label>
                                    <input
                                        type="text"
                                        required
                                        value={organizationId}
                                        onChange={(e) => setOrganizationId(e.target.value)}
                                        className="appearance-none block w-full px-4 py-3.5 bg-slate-50 border border-slate-200 rounded-xl shadow-sm placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent focus:bg-white sm:text-sm transition-all"
                                        placeholder="e.g. 482931"
                                    />
                                </div>

                                <div>
                                    <label className="block text-sm font-semibold text-slate-700 mb-1.5">Username or Email</label>
                                    <input
                                        type="text"
                                        required
                                        value={username}
                                        onChange={(e) => setUsername(e.target.value)}
                                        className="appearance-none block w-full px-4 py-3.5 bg-slate-50 border border-slate-200 rounded-xl shadow-sm placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent focus:bg-white sm:text-sm transition-all"
                                        placeholder="user@coaching.com"
                                    />
                                </div>

                                <div>
                                    <label className="block text-sm font-semibold text-slate-700 mb-1.5">Password</label>
                                    <input
                                        type="password"
                                        required
                                        value={password}
                                        onChange={(e) => setPassword(e.target.value)}
                                        className="appearance-none block w-full px-4 py-3.5 bg-slate-50 border border-slate-200 rounded-xl shadow-sm placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent focus:bg-white sm:text-sm transition-all"
                                        placeholder="••••••••"
                                    />
                                </div>
                            </div>

                            <button
                                type="submit"
                                disabled={loading}
                                className="mt-8 w-full flex justify-center py-4 px-4 border border-transparent rounded-xl shadow-sm text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed transition-all active:scale-[0.98]"
                            >
                                {loading ? "Signing in..." : "Sign in to Workspace"}
                            </button>
                        </form>
                    )}
                </div>
            </div>
        </div>
    );
}

function SignInFallback() {
    return (
        <div className="flex min-h-screen items-center justify-center bg-white">
            <div className="w-10 h-10 border-4 border-slate-200 border-t-blue-600 rounded-full animate-spin" />
        </div>
    );
}

export default function SignInPage() {
    return (
        <Suspense fallback={<SignInFallback />}>
            <SignInContent />
        </Suspense>
    );
}
