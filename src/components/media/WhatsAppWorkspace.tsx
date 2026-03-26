"use client";

import { useEffect, useRef, useState } from "react";
import { useSession } from "next-auth/react";
import toast from "react-hot-toast";
import {
    Activity,
    CheckCheck,
    Megaphone,
    MessageCircle,
    MessagesSquare,
    Send,
    ShieldCheck,
    Smartphone,
    Sparkles,
    Zap,
} from "lucide-react";

type WhatsAppPublicConfig = {
    ready: boolean;
    appId?: string;
    configId?: string;
    graphApiVersion: string;
    webhookUrl?: string;
    webhookVerifyTokenConfigured: boolean;
    redirectUri?: string;
    reason?: string;
};

type WhatsAppTemplateSummary = {
    id: string;
    name: string;
    language: string;
    status: string;
    category: string;
    qualityScore?: string;
    bodyPreview?: string;
};

type WhatsAppConversationSummary = {
    id: string;
    waId: string;
    profileName?: string;
    lastMessageText?: string;
    lastDirection?: string;
    lastMessageAt?: string;
    unreadCount: number;
};

type WhatsAppMessageSummary = {
    id: string;
    wamid?: string;
    direction: string;
    type: string;
    status?: string;
    textBody?: string;
    fromWaId?: string;
    toWaId?: string;
    createdAt: string;
    metaTimestamp?: string;
};

type WhatsAppCampaignSummary = {
    id: string;
    name: string;
    templateName: string;
    templateLanguage: string;
    status: string;
    sentCount: number;
    deliveredCount: number;
    readCount: number;
    failedCount: number;
    createdAt: string;
    lastRunAt?: string;
    lastError?: string;
};

type WhatsAppDashboard = {
    connected: boolean;
    connection?: {
        id: string;
        businessId?: string;
        wabaId: string;
        phoneNumberId: string;
        displayPhoneNumber?: string;
        verifiedName?: string;
        accountName?: string;
    };
    templates: WhatsAppTemplateSummary[];
    conversations: WhatsAppConversationSummary[];
    campaigns: WhatsAppCampaignSummary[];
    warning?: string;
};

type WhatsAppConversationPayload = {
    conversation: WhatsAppConversationSummary;
    messages: WhatsAppMessageSummary[];
};

type EmbeddedSignupInfo = {
    phoneNumberId?: string;
    wabaId?: string;
    businessId?: string;
    appScopedUserId?: string;
};

declare global {
    interface Window {
        FB?: any;
        fbAsyncInit?: () => void;
    }
}

let metaSdkPromise: Promise<void> | null = null;

function loadMetaSdk(appId: string, graphApiVersion: string) {
    if (typeof window === "undefined") return Promise.reject(new Error("Window is not available."));
    if (window.FB) {
        window.FB.init({
            appId,
            cookie: true,
            xfbml: false,
            version: graphApiVersion,
        });
        return Promise.resolve();
    }

    if (!metaSdkPromise) {
        metaSdkPromise = new Promise<void>((resolve, reject) => {
            window.fbAsyncInit = () => {
                try {
                    window.FB?.init({
                        appId,
                        cookie: true,
                        xfbml: false,
                        version: graphApiVersion,
                    });
                    resolve();
                } catch (error) {
                    reject(error);
                }
            };

            const existing = document.getElementById("facebook-jssdk");
            if (existing) return;

            const script = document.createElement("script");
            script.id = "facebook-jssdk";
            script.async = true;
            script.defer = true;
            script.crossOrigin = "anonymous";
            script.src = "https://connect.facebook.net/en_US/sdk.js";
            script.onerror = () => reject(new Error("Failed to load Meta SDK."));
            document.body.appendChild(script);
        });
    }

    return metaSdkPromise;
}

function formatDateTime(value: string | undefined) {
    if (!value) return "Unknown";
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return value;
    return parsed.toLocaleString("en-IN", {
        day: "2-digit",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
    });
}

function normalizeEmbeddedSignupData(raw: unknown): EmbeddedSignupInfo | null {
    const parseCandidate = (candidate: any): EmbeddedSignupInfo | null => {
        if (!candidate || typeof candidate !== "object") return null;

        const phoneNumberId = String(
            candidate.phone_number_id ||
            candidate.phoneNumberId ||
            candidate.phone_number?.id ||
            candidate.phone?.id ||
            ""
        ).trim();
        const wabaId = String(
            candidate.waba_id ||
            candidate.wabaId ||
            candidate.business_account_id ||
            candidate.whatsapp_business_account?.id ||
            ""
        ).trim();
        const businessId = String(
            candidate.business_id ||
            candidate.businessId ||
            candidate.business?.id ||
            ""
        ).trim();
        const appScopedUserId = String(
            candidate.app_scoped_user_id ||
            candidate.appScopedUserId ||
            candidate.user_id ||
            candidate.userId ||
            ""
        ).trim();

        if (!phoneNumberId && !wabaId && !businessId && !appScopedUserId) return null;
        return {
            phoneNumberId: phoneNumberId || undefined,
            wabaId: wabaId || undefined,
            businessId: businessId || undefined,
            appScopedUserId: appScopedUserId || undefined,
        };
    };

    let parsed: any = raw;
    if (typeof parsed === "string") {
        try {
            parsed = JSON.parse(parsed);
        } catch {
            return null;
        }
    }

    return (
        parseCandidate(parsed) ||
        parseCandidate(parsed?.data) ||
        parseCandidate(parsed?.payload) ||
        parseCandidate(parsed?.sessionInfo) ||
        parseCandidate(parsed?.response) ||
        null
    );
}

function campaignTone(status: string) {
    if (status === "completed") return "bg-emerald-100 text-emerald-700";
    if (status === "partial") return "bg-amber-100 text-amber-700";
    if (status === "failed") return "bg-rose-100 text-rose-700";
    if (status === "running") return "bg-indigo-100 text-indigo-700";
    return "bg-slate-100 text-slate-700";
}

function formatNumberCompact(value: number) {
    if (value >= 1000000) return `${(value / 1000000).toFixed(1)}M`;
    if (value >= 1000) return `${(value / 1000).toFixed(1)}K`;
    return value.toString();
}

function statCard(label: string, value: string, meta: string, tone: string) {
    return (
        <div className={`relative overflow-hidden rounded-[28px] border p-5 shadow-[0_30px_60px_rgba(15,23,42,0.08)] ${tone}`}>
            <div className="absolute right-4 top-4 h-16 w-16 rounded-full bg-white/40 blur-2xl" />
            <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-slate-500">{label}</p>
            <p className="mt-4 text-3xl font-semibold text-slate-950">{value}</p>
            <p className="mt-2 text-sm text-slate-600">{meta}</p>
        </div>
    );
}

export function WhatsAppWorkspace() {
    const { data: session } = useSession();
    const role = (session?.user as any)?.role || "MEMBER";
    const allowedTools = Array.isArray((session?.user as any)?.allowedTools)
        ? ((session?.user as any)?.allowedTools as string[])
        : [];

    const hasAccess =
        role === "SYSTEM_ADMIN" ||
        role === "ORG_ADMIN" ||
        allowedTools.includes("media-studio") ||
        allowedTools.includes("pdf-to-pdf");

    const [config, setConfig] = useState<WhatsAppPublicConfig | null>(null);
    const [dashboard, setDashboard] = useState<WhatsAppDashboard | null>(null);
    const [loading, setLoading] = useState(false);
    const [action, setAction] = useState<"connect" | "disconnect" | "send" | "campaign" | null>(null);
    const [selectedConversationId, setSelectedConversationId] = useState("");
    const [messagesLoading, setMessagesLoading] = useState(false);
    const [messages, setMessages] = useState<WhatsAppMessageSummary[]>([]);
    const [signupInfo, setSignupInfo] = useState<EmbeddedSignupInfo>({});
    const signupInfoRef = useRef<EmbeddedSignupInfo>({});

    const [textRecipient, setTextRecipient] = useState("");
    const [textBody, setTextBody] = useState("");
    const [campaignName, setCampaignName] = useState("");
    const [campaignTemplate, setCampaignTemplate] = useState("");
    const [campaignLanguage, setCampaignLanguage] = useState("en");
    const [campaignRecipients, setCampaignRecipients] = useState("");
    const [campaignVariables, setCampaignVariables] = useState("");

    const selectedConversation = dashboard?.conversations.find((item) => item.id === selectedConversationId) || null;

    const loadConfig = async () => {
        const response = await fetch("/api/whatsapp/config", { cache: "no-store" });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
            throw new Error(data.error || "Failed to load WhatsApp config.");
        }
        setConfig(data as WhatsAppPublicConfig);
        return data as WhatsAppPublicConfig;
    };

    const loadDashboard = async () => {
        setLoading(true);
        try {
            const response = await fetch("/api/whatsapp/dashboard", { cache: "no-store" });
            const data = await response.json().catch(() => ({}));
            if (!response.ok) {
                throw new Error(data.error || "Failed to load WhatsApp dashboard.");
            }
            const nextDashboard = data as WhatsAppDashboard;
            setDashboard(nextDashboard);
            if (!selectedConversationId && nextDashboard.conversations[0]?.id) {
                setSelectedConversationId(nextDashboard.conversations[0].id);
            }
        } catch (error: any) {
            console.error(error);
            toast.error(error.message || "Failed to load WhatsApp dashboard.");
        } finally {
            setLoading(false);
        }
    };

    const loadConversation = async (conversationId: string) => {
        if (!conversationId) {
            setMessages([]);
            return;
        }
        setMessagesLoading(true);
        try {
            const response = await fetch(`/api/whatsapp/conversations/${conversationId}`, {
                cache: "no-store",
            });
            const data = await response.json().catch(() => ({}));
            if (!response.ok) {
                throw new Error(data.error || "Failed to load conversation.");
            }
            const payload = data as WhatsAppConversationPayload;
            setMessages(payload.messages || []);
        } catch (error: any) {
            console.error(error);
            toast.error(error.message || "Failed to load conversation.");
        } finally {
            setMessagesLoading(false);
        }
    };

    useEffect(() => {
        if (!hasAccess) return;
        void loadConfig();
        void loadDashboard();
    }, [hasAccess]);

    useEffect(() => {
        if (!hasAccess) return;
        void loadConversation(selectedConversationId);
    }, [hasAccess, selectedConversationId]);

    useEffect(() => {
        if (!hasAccess) return;
        const handleMessage = (event: MessageEvent) => {
            const info = normalizeEmbeddedSignupData(event.data);
            if (!info) return;
            signupInfoRef.current = {
                ...signupInfoRef.current,
                ...info,
            };
            setSignupInfo(signupInfoRef.current);
        };

        window.addEventListener("message", handleMessage);
        return () => window.removeEventListener("message", handleMessage);
    }, [hasAccess]);

    useEffect(() => {
        if (selectedConversation?.waId) {
            setTextRecipient((current) => current || selectedConversation.waId);
        }
    }, [selectedConversation?.waId]);

    const handleEmbeddedSignup = async () => {
        setAction("connect");
        try {
            const resolvedConfig = config || await loadConfig();
            if (!resolvedConfig.ready || !resolvedConfig.appId || !resolvedConfig.configId) {
                throw new Error(resolvedConfig.reason || "Embedded Signup is not configured.");
            }

            signupInfoRef.current = {};
            setSignupInfo({});
            await loadMetaSdk(resolvedConfig.appId, resolvedConfig.graphApiVersion);

            const response = await new Promise<any>((resolve) => {
                window.FB.login(resolve, {
                    config_id: resolvedConfig.configId,
                    response_type: "code",
                    override_default_response_type: true,
                    extras: {
                        feature: "whatsapp_embedded_signup",
                        sessionInfoVersion: 3,
                        setup: {},
                    },
                });
            });

            const code = String(response?.authResponse?.code || "").trim();
            if (!code) {
                throw new Error("WhatsApp Embedded Signup did not return an authorization code.");
            }

            const info = signupInfoRef.current;
            if (!info.phoneNumberId || !info.wabaId) {
                throw new Error("Embedded Signup completed, but Meta did not return phone number details. Please finish the full phone onboarding flow in the popup and try again.");
            }

            const connectResponse = await fetch("/api/whatsapp/connect", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    code,
                    phoneNumberId: info.phoneNumberId,
                    wabaId: info.wabaId,
                    businessId: info.businessId,
                    appScopedUserId: info.appScopedUserId,
                }),
            });

            const data = await connectResponse.json().catch(() => ({}));
            if (!connectResponse.ok) {
                throw new Error(data.error || "Failed to connect WhatsApp.");
            }

            toast.success("WhatsApp business account connected.");
            await loadDashboard();
        } catch (error: any) {
            console.error(error);
            toast.error(error.message || "Failed to connect WhatsApp.");
        } finally {
            setAction(null);
        }
    };

    const handleDisconnect = async () => {
        setAction("disconnect");
        try {
            const response = await fetch("/api/whatsapp/connection", { method: "DELETE" });
            const data = await response.json().catch(() => ({}));
            if (!response.ok) {
                throw new Error(data.error || "Failed to disconnect WhatsApp.");
            }
            setDashboard({
                connected: false,
                templates: [],
                conversations: [],
                campaigns: [],
            });
            setSelectedConversationId("");
            setMessages([]);
            toast.success("WhatsApp account disconnected.");
        } catch (error: any) {
            console.error(error);
            toast.error(error.message || "Failed to disconnect WhatsApp.");
        } finally {
            setAction(null);
        }
    };

    const handleSendText = async () => {
        setAction("send");
        try {
            const response = await fetch("/api/whatsapp/messages/send", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    type: "text",
                    to: textRecipient,
                    body: textBody,
                }),
            });
            const data = await response.json().catch(() => ({}));
            if (!response.ok) {
                throw new Error(data.error || "Failed to send WhatsApp message.");
            }
            setTextBody("");
            toast.success("WhatsApp message sent.");
            await loadDashboard();
            if (selectedConversationId) {
                await loadConversation(selectedConversationId);
            }
        } catch (error: any) {
            console.error(error);
            toast.error(error.message || "Failed to send WhatsApp message.");
        } finally {
            setAction(null);
        }
    };

    const handleSendCampaign = async () => {
        setAction("campaign");
        try {
            const response = await fetch("/api/whatsapp/campaigns", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    name: campaignName,
                    templateName: campaignTemplate,
                    languageCode: campaignLanguage,
                    recipients: campaignRecipients,
                    variables: campaignVariables,
                }),
            });
            const data = await response.json().catch(() => ({}));
            if (!response.ok) {
                throw new Error(data.error || "Failed to run WhatsApp campaign.");
            }
            toast.success("WhatsApp campaign sent.");
            setCampaignName("");
            setCampaignRecipients("");
            setCampaignVariables("");
            await loadDashboard();
        } catch (error: any) {
            console.error(error);
            toast.error(error.message || "Failed to run WhatsApp campaign.");
        } finally {
            setAction(null);
        }
    };

    useEffect(() => {
        if (!campaignTemplate && dashboard?.templates[0]) {
            setCampaignTemplate(dashboard.templates[0].name);
            setCampaignLanguage(dashboard.templates[0].language || "en");
        }
    }, [campaignTemplate, dashboard?.templates]);

    if (!hasAccess) {
        return (
            <div className="surface p-10 text-center">
                <h2 className="heading-xl">WhatsApp Workspace Access Required</h2>
                <p className="text-sm text-slate-500 mt-2">
                    Ask your workspace admin to grant `media-studio` access.
                </p>
            </div>
        );
    }

    return (
        <section className="space-y-6">
            <div className="relative overflow-hidden rounded-[34px] border border-emerald-100 bg-[linear-gradient(135deg,#f0fdf4_0%,#fff_45%,#f8fafc_100%)] p-6 shadow-[0_40px_90px_rgba(15,23,42,0.08)]">
                <div className="absolute inset-y-0 right-0 hidden w-[34%] lg:block">
                    <div className="absolute right-10 top-10 h-40 w-40 rounded-[32px] border border-white/60 bg-[linear-gradient(180deg,rgba(255,255,255,0.82),rgba(209,250,229,0.5))] shadow-[0_30px_60px_rgba(16,185,129,0.14)] [transform:rotate(-10deg)]" />
                    <div className="absolute right-24 top-24 h-44 w-44 rounded-[36px] border border-emerald-100 bg-[linear-gradient(180deg,rgba(255,255,255,0.82),rgba(167,243,208,0.72))] shadow-[0_30px_60px_rgba(5,150,105,0.16)] [transform:rotate(8deg)]" />
                    <div className="absolute bottom-10 right-12 h-24 w-56 rounded-[26px] border border-slate-200 bg-slate-950 px-5 py-4 text-white shadow-[0_40px_80px_rgba(15,23,42,0.24)]">
                        <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-slate-400">Realtime Pulse</p>
                        <div className="mt-3 flex items-end justify-between gap-3">
                            <div>
                                <p className="text-3xl font-semibold">{formatNumberCompact(dashboard?.conversations.reduce((acc, c) => acc + c.unreadCount, 0) || 0)}</p>
                                <p className="text-xs text-slate-400">unread messages</p>
                            </div>
                            <div className="grid grid-cols-3 gap-2">
                                {[dashboard?.conversations.length || 0, dashboard?.campaigns.length || 0, dashboard?.templates.length || 0].map((value, index) => (
                                    <div key={index} className="h-10 w-10 rounded-2xl bg-white/10" />
                                ))}
                            </div>
                        </div>
                    </div>
                </div>

                <div className="relative z-10 grid gap-6 xl:grid-cols-[1.35fr,0.9fr]">
                    <div className="space-y-5">
                        <div className="inline-flex items-center gap-2 rounded-full border border-emerald-200 bg-white/80 px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.28em] text-emerald-700">
                            <MessageCircle className="h-4 w-4" />
                            WhatsApp Command Center
                        </div>
                        <div className="max-w-3xl">
                            <h2 className="text-4xl font-semibold tracking-tight text-slate-950 md:text-5xl">
                                Run outreach campaigns, templates, and student conversations from one deck.
                            </h2>
                            <p className="mt-4 max-w-2xl text-base leading-7 text-slate-600">
                                This workspace connects your official WhatsApp Business number directly to the studio, keeping student chats, lead nurturing, and bulk broadcast templates in one organized control surface.
                            </p>
                        </div>

                        <div className="flex flex-wrap gap-3">
                            <button
                                type="button"
                                onClick={() => void loadDashboard()}
                                disabled={loading}
                                className="btn btn-secondary text-sm"
                            >
                                {loading ? "Refreshing..." : "Refresh Inbox"}
                            </button>
                        </div>

                        <div className="flex flex-wrap gap-3 text-xs text-slate-600">
                            <span className="tool-chip bg-white/90">Official Cloud API</span>
                            <span className="tool-chip bg-white/90">Template Engine</span>
                            <span className="tool-chip bg-white/90">Central Inbox</span>
                        </div>
                    </div>

                    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-1">
                        <div className="rounded-[28px] border border-slate-200 bg-white/85 p-5 shadow-[0_24px_60px_rgba(15,23,42,0.08)]">
                            <div className="flex items-start gap-4">
                                <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-emerald-100 text-emerald-700">
                                    <Smartphone className="h-7 w-7" />
                                </div>
                                <div className="min-w-0 flex-1">
                                    <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-slate-500">Connected Number</p>
                                    <p className="mt-2 text-lg font-semibold text-slate-950 line-clamp-1">
                                        {dashboard?.connection ? dashboard.connection.accountName || dashboard.connection.verifiedName || "Connected Business" : "Connect your Business Phone"}
                                    </p>
                                    {dashboard?.connection?.displayPhoneNumber && (
                                        <p className="mt-1 truncate text-sm text-slate-500">{dashboard.connection.displayPhoneNumber}</p>
                                    )}
                                </div>
                            </div>

                            <div className="mt-4 flex flex-wrap gap-2">
                                {dashboard?.connection && (
                                    <>
                                        <span className="tool-chip">ID: {dashboard.connection.phoneNumberId}</span>
                                        <span className="tool-chip">WABA: {dashboard.connection.wabaId}</span>
                                    </>
                                )}
                            </div>

                            <div className="mt-5 flex flex-wrap gap-2">
                                {dashboard?.connected ? (
                                    <>
                                        <button
                                            type="button"
                                            onClick={handleEmbeddedSignup}
                                            disabled={action !== null}
                                            className="btn btn-primary text-xs"
                                        >
                                            {action === "connect" ? "Connecting..." : "Reconnect"}
                                        </button>
                                        <button
                                            type="button"
                                            onClick={handleDisconnect}
                                            disabled={action !== null}
                                            className="btn btn-ghost text-xs"
                                        >
                                            {action === "disconnect" ? "Disconnecting..." : "Disconnect"}
                                        </button>
                                    </>
                                ) : (
                                    <button
                                        type="button"
                                        onClick={handleEmbeddedSignup}
                                        disabled={action !== null || !config?.ready}
                                        className="btn btn-primary text-xs"
                                    >
                                        {action === "connect" ? "Opening Meta..." : "Connect WhatsApp"}
                                    </button>
                                )}
                            </div>

                            {!dashboard?.connected && (
                                <p className="mt-4 text-[10px] text-slate-500 leading-4">
                                    {config?.reason || "Configuration requires Meta App ID and Webhook verify token setup."}
                                </p>
                            )}
                            {dashboard?.warning && (
                                <p className="mt-4 text-xs text-amber-700">{dashboard.warning}</p>
                            )}
                        </div>

                        <div className="rounded-[28px] border border-slate-200 bg-[linear-gradient(160deg,#0f172a,#1e293b)] p-5 text-white shadow-[0_30px_70px_rgba(15,23,42,0.28)]">
                            <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.28em] text-emerald-200">
                                <Sparkles className="h-4 w-4" />
                                Ops Stack
                            </div>
                            <div className="mt-5 grid grid-cols-3 gap-3">
                                {[
                                    { label: "Threads", value: dashboard?.conversations.length || 0, icon: MessagesSquare },
                                    { label: "Campaigns", value: dashboard?.campaigns.length || 0, icon: Megaphone },
                                    { label: "Templates", value: dashboard?.templates.length || 0, icon: CheckCheck },
                                ].map((item) => (
                                    <div key={item.label} className="rounded-2xl border border-white/10 bg-white/5 p-3">
                                        <item.icon className="h-4 w-4 text-emerald-300" />
                                        <p className="mt-3 text-2xl font-semibold">{formatNumberCompact(item.value)}</p>
                                        <p className="mt-1 text-[11px] uppercase tracking-[0.22em] text-slate-300">{item.label}</p>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                {statCard("Active Chats", String(dashboard?.conversations.length || 0), "Total threads actively synced.", "border-emerald-100 bg-[linear-gradient(160deg,#ecfdf5,#ffffff)]")}
                {statCard("Unread Messages", String(dashboard?.conversations.reduce((acc, c) => acc + c.unreadCount, 0) || 0), "Awaiting your reply right now.", "border-amber-100 bg-[linear-gradient(160deg,#fffbeb,#ffffff)]")}
                {statCard("Templates Approved", String(dashboard?.templates.filter((t) => t.status.toLowerCase() === "approved").length || 0), "Ready for broadcast campaigns.", "border-blue-100 bg-[linear-gradient(160deg,#eff6ff,#ffffff)]")}
                {statCard("Campaigns Sent", String(dashboard?.campaigns.length || 0), "Total templates distributed.", "border-violet-100 bg-[linear-gradient(160deg,#f5f3ff,#ffffff)]")}
            </div>

            <div className="grid gap-5 xl:grid-cols-[0.9fr,1.1fr]">
                <article className="rounded-[30px] border border-slate-200 bg-[linear-gradient(180deg,#fff,#f8fafc)] p-6 shadow-[0_24px_60px_rgba(15,23,42,0.08)]">
                    <div className="flex items-center justify-between gap-3 mb-5">
                        <div>
                            <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-slate-500">Inbox</p>
                            <h3 className="mt-2 text-2xl font-semibold text-slate-950">Conversations</h3>
                        </div>
                        <span className="rounded-full px-3 py-1 text-[10px] font-bold uppercase bg-slate-100 text-slate-600">
                            {dashboard?.conversations.length || 0} Threads
                        </span>
                    </div>

                    <div className="space-y-3 max-h-[650px] overflow-auto pr-2 scrollbar-thin scrollbar-thumb-slate-200">
                        {!dashboard?.connected ? (
                            <div className="rounded-[28px] border border-dashed border-slate-200 bg-slate-50 p-8 text-center">
                                <p className="text-lg font-semibold text-slate-900">WhatsApp not connected</p>
                                <p className="mt-2 text-sm text-slate-500">Use Embedded Signup to link a business number first.</p>
                            </div>
                        ) : dashboard.conversations.length === 0 ? (
                            <div className="rounded-[28px] border border-dashed border-slate-200 bg-slate-50 p-8 text-center">
                                <p className="text-lg font-semibold text-slate-900">No conversations yet</p>
                                <p className="mt-2 text-sm text-slate-500">Incoming webhook messages will start populating your inbox here.</p>
                            </div>
                        ) : (
                            dashboard.conversations.map((conversation) => (
                                <button
                                    key={conversation.id}
                                    type="button"
                                    onClick={() => setSelectedConversationId(conversation.id)}
                                    className={`w-full group text-left p-4 rounded-[22px] border transition-all ${
                                        selectedConversationId === conversation.id 
                                            ? "border-emerald-300 bg-emerald-50 shadow-[0_10px_30px_rgba(16,185,129,0.1)]" 
                                            : "border-slate-200 bg-white hover:-translate-y-0.5 hover:shadow-md"
                                    }`}
                                >
                                    <div className="flex items-start justify-between gap-3">
                                        <div className="min-w-0 flex-1">
                                            <div className="flex items-center gap-2">
                                                <p className="text-sm font-semibold text-slate-950 truncate">
                                                    {conversation.profileName || conversation.waId}
                                                </p>
                                                {conversation.unreadCount > 0 && (
                                                    <span className="h-2 w-2 rounded-full bg-emerald-500" />
                                                )}
                                            </div>
                                            <p className="text-xs text-slate-500 truncate mt-1">{conversation.waId}</p>
                                            {conversation.lastMessageText && (
                                                <p className="text-sm text-slate-600 line-clamp-2 mt-3">{conversation.lastMessageText}</p>
                                            )}
                                        </div>
                                        <div className="text-right whitespace-nowrap">
                                            {conversation.unreadCount > 0 && (
                                                <span className="inline-flex px-2 py-1 rounded-full bg-emerald-100 text-emerald-700 text-[10px] font-bold">
                                                    {conversation.unreadCount} new
                                                </span>
                                            )}
                                            <p className="text-[11px] text-slate-400 mt-2">{formatDateTime(conversation.lastMessageAt).split(',')[0]}</p>
                                        </div>
                                    </div>
                                </button>
                            ))
                        )}
                    </div>
                </article>

                <article className="rounded-[30px] border border-slate-200 bg-[#efeae2] p-1 flex flex-col shadow-[0_24px_60px_rgba(15,23,42,0.08)] relative overflow-hidden h-[800px]">
                    <div className="absolute inset-0 opacity-40 mix-blend-multiply pointer-events-none" style={{ backgroundImage: "url('https://static.whatsapp.net/rsrc.php/v3/yl/r/r2-o_4m8qWw.png')", backgroundSize: "400px" }} />
                    <div className="relative z-10 bg-white/95 backdrop-blur-md rounded-t-[28px] border-b border-slate-200 p-4 shrink-0 flex items-center justify-between">
                        <div>
                            <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-slate-500">Live Chat</p>
                            <h3 className="mt-1 text-lg font-semibold text-slate-950">
                                {selectedConversation ? (selectedConversation.profileName || selectedConversation.waId) : "Select a thread"}
                            </h3>
                        </div>
                        {selectedConversation && (
                            <span className="rounded-full bg-emerald-100 text-emerald-700 px-3 py-1 text-xs font-semibold">Active</span>
                        )}
                    </div>

                    <div className="relative z-10 flex-1 overflow-auto p-4 space-y-4 scrollbar-thin scrollbar-thumb-slate-300">
                         {!selectedConversation ? (
                            <div className="flex h-full items-center justify-center">
                                <div className="rounded-2xl bg-white/80 backdrop-blur px-6 py-4 text-center shadow-sm">
                                    <p className="text-sm font-medium text-slate-600">Choose a thread from the inbox to read messages and reply faster.</p>
                                </div>
                            </div>
                        ) : messagesLoading ? (
                            <div className="flex h-full items-center justify-center">
                                <div className="rounded-2xl bg-white/80 backdrop-blur px-6 py-4 text-center shadow-sm">
                                    <Activity className="h-5 w-5 text-emerald-600 animate-spin mx-auto mb-2" />
                                    <p className="text-sm font-medium text-slate-600">Pulling latest messages...</p>
                                </div>
                            </div>
                        ) : messages.length === 0 ? (
                            <div className="flex h-full items-center justify-center">
                                <div className="rounded-2xl bg-white/80 backdrop-blur px-6 py-4 text-center shadow-sm">
                                    <p className="text-sm font-medium text-slate-600">No messages yet. Send a quick reply to start.</p>
                                </div>
                            </div>
                        ) : (
                            messages.map((message) => {
                                const isOutbound = message.direction === "outbound";
                                return (
                                    <div key={message.id} className={`flex ${isOutbound ? 'justify-end' : 'justify-start'}`}>
                                        <div className={`max-w-[80%] rounded-[18px] px-4 py-2.5 shadow-sm text-[15px] leading-relaxed relative ${
                                            isOutbound 
                                                ? "bg-[#d9fdd3] text-[#111b21] rounded-tr-sm" 
                                                : "bg-white text-[#111b21] rounded-tl-sm"
                                        }`}>
                                            <p className="whitespace-pre-wrap breakdown-words">{message.textBody || `[Unsupported ${message.type} message]`}</p>
                                            <div className={`flex items-center gap-1 mt-1 justify-end ${isOutbound ? "text-[#667781]" : "text-[#667781]"}`}>
                                                <span className="text-[10px]">{formatDateTime(message.createdAt).split(',')[1]}</span>
                                                {isOutbound && (
                                                    <CheckCheck className={`h-3.5 w-3.5 ${message.status === 'read' ? 'text-[#53bdeb]' : ''}`} />
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                );
                            })
                        )}
                    </div>

                    {selectedConversation && (
                        <div className="relative z-10 bg-[#f0f2f5] rounded-b-[28px] p-3 shrink-0 flex items-end gap-2">
                            <textarea
                                value={textBody}
                                onChange={(event) => setTextBody(event.target.value)}
                                placeholder="Type a message"
                                className="w-full bg-white rounded-2xl px-4 py-3 outline-none text-[15px] resize-none max-h-32 min-h-[44px] shadow-sm"
                                rows={1}
                                onKeyDown={(e) => {
                                    if(e.key === 'Enter' && !e.shiftKey) {
                                        e.preventDefault();
                                        if(textBody.trim()) handleSendText();
                                    }
                                }}
                            />
                            <button
                                type="button"
                                onClick={handleSendText}
                                disabled={!textBody.trim() || action !== null}
                                className="bg-[#00a884] text-white p-3 rounded-full hover:bg-[#008f6f] transition disabled:opacity-50 shadow-sm shrink-0"
                            >
                                <Send className="h-5 w-5" />
                            </button>
                        </div>
                    )}
                </article>
            </div>

            <div className="grid gap-5 xl:grid-cols-[1.1fr,0.9fr]">
                <article className="rounded-[30px] border border-slate-200 bg-white p-6 shadow-[0_24px_60px_rgba(15,23,42,0.08)]">
                    <div className="flex items-center justify-between gap-3 mb-5">
                        <div>
                            <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-slate-500">Live Broadcast Matrix</p>
                            <h3 className="mt-2 text-2xl font-semibold text-slate-950">Template Campaign Sender</h3>
                        </div>
                    </div>

                    <div className="grid gap-6 md:grid-cols-2">
                        <div className="space-y-4">
                            <div className="rounded-[24px] border border-slate-200 bg-[linear-gradient(180deg,#fff,#f8fafc)] p-5">
                                <p className="text-sm font-semibold text-slate-900 mb-4">Run a new bulk template</p>
                                <div className="space-y-3">
                                    <input
                                        value={campaignName}
                                        onChange={(event) => setCampaignName(event.target.value)}
                                        placeholder="Campaign name"
                                        className="input bg-white"
                                        disabled={!dashboard?.connected}
                                    />
                                    <select
                                        value={campaignTemplate}
                                        onChange={(event) => setCampaignTemplate(event.target.value)}
                                        className="select bg-white"
                                        disabled={!dashboard?.connected}
                                    >
                                        <option value="">Select approved template</option>
                                        {dashboard?.templates.map((template) => (
                                            <option key={template.id} value={template.name}>
                                                {template.name} ({template.language})
                                            </option>
                                        ))}
                                    </select>
                                    <input
                                        value={campaignLanguage}
                                        onChange={(event) => setCampaignLanguage(event.target.value)}
                                        placeholder="Template language code"
                                        className="input bg-white hidden"
                                        disabled={!dashboard?.connected}
                                    />
                                </div>
                            </div>
                        </div>
                        <div className="space-y-4">
                            <div className="rounded-[24px] border border-slate-200 bg-[linear-gradient(180deg,#fff,#f8fafc)] p-5 h-full flex flex-col">
                                <p className="text-sm font-semibold text-slate-900 mb-4">Audience & Variables</p>
                                <div className="space-y-3 flex-1 flex flex-col">
                                    <textarea
                                        value={campaignRecipients}
                                        onChange={(event) => setCampaignRecipients(event.target.value)}
                                        placeholder="Recipient numbers, one per line or comma separated..."
                                        className="textarea bg-white flex-1 min-h-[100px]"
                                        disabled={!dashboard?.connected}
                                    />
                                    <textarea
                                        value={campaignVariables}
                                        onChange={(event) => setCampaignVariables(event.target.value)}
                                        placeholder="Variables (optional), e.g. John, Math Course"
                                        className="textarea bg-white min-h-[60px]"
                                        disabled={!dashboard?.connected}
                                    />
                                </div>
                            </div>
                        </div>
                    </div>
                    <div className="mt-5 flex justify-end">
                        <button
                            type="button"
                            onClick={() => void handleSendCampaign()}
                            disabled={!dashboard?.connected || action !== null || !campaignTemplate || !campaignRecipients}
                            className="btn btn-primary text-sm px-8"
                        >
                            {action === "campaign" ? "Sending Campaign..." : "Launch Campaign"}
                        </button>
                    </div>
                </article>

                <article className="rounded-[30px] border border-slate-200 bg-white p-6 shadow-[0_24px_60px_rgba(15,23,42,0.08)]">
                    <div className="flex items-center justify-between gap-3 mb-5">
                        <div>
                            <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-slate-500">Analytics</p>
                            <h3 className="mt-2 text-2xl font-semibold text-slate-950">Recent Campaigns</h3>
                        </div>
                        <span className="status-badge">{dashboard?.campaigns.length || 0} run</span>
                    </div>

                    <div className="space-y-3 max-h-[350px] overflow-auto pr-1">
                        {dashboard?.campaigns.length ? (
                            dashboard.campaigns.map((campaign) => (
                                <div key={campaign.id} className="rounded-[22px] border border-slate-200 bg-[linear-gradient(180deg,#fff,#f8fafc)] p-4">
                                    <div className="flex items-start justify-between gap-3">
                                        <div>
                                            <p className="text-sm font-semibold text-slate-950">{campaign.name}</p>
                                            <p className="text-xs text-slate-500 mt-1">
                                                {campaign.templateName} · {campaign.templateLanguage}
                                            </p>
                                        </div>
                                        <span className={`px-2 py-1 rounded-md text-[10px] font-bold uppercase ${campaignTone(campaign.status)}`}>
                                            {campaign.status}
                                        </span>
                                    </div>
                                    <div className="flex flex-wrap gap-2 mt-4 text-xs text-slate-600">
                                        <span className="tool-chip bg-white">Sent: {campaign.sentCount}</span>
                                        <span className="tool-chip bg-emerald-50 text-emerald-700 border-emerald-200">Read: {campaign.readCount}</span>
                                        <span className="tool-chip bg-white">Failed: {campaign.failedCount}</span>
                                    </div>
                                    {campaign.lastError && (
                                        <p className="text-[11px] text-amber-700 mt-2">{campaign.lastError}</p>
                                    )}
                                </div>
                            ))
                        ) : (
                            <div className="rounded-[28px] border border-dashed border-slate-200 bg-slate-50 p-8 text-center">
                                <p className="text-lg font-semibold text-slate-900">No campaigns launched</p>
                                <p className="mt-2 text-sm text-slate-500">
                                    Your distributed template broadcasts and analytics will appear here.
                                </p>
                            </div>
                        )}
                    </div>
                </article>
            </div>

            <div className="grid gap-4 md:grid-cols-3">
                {[
                    {
                        icon: MessagesSquare,
                        title: "Live Chat Threads",
                        description: "Student queries and automated flow drop-offs enter here, allowing seamless human takeover.",
                    },
                    {
                        icon: Megaphone,
                        title: "Bulk Templates",
                        description: "Push Meta-approved personalized templates to hundreds of numbers effortlessly.",
                    },
                    {
                        icon: ShieldCheck,
                        title: "Official API Access",
                        description: "Using secure, enterprise Cloud APIs to guarantee high delivery rates and maintain green-tick verification.",
                    },
                ].map((item) => (
                    <div key={item.title} className="rounded-[26px] border border-slate-200 bg-white p-5 shadow-[0_24px_60px_rgba(15,23,42,0.06)]">
                        <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-100 text-slate-700">
                            <item.icon className="h-5 w-5" />
                        </div>
                        <h4 className="mt-4 text-lg font-semibold text-slate-950">{item.title}</h4>
                        <p className="mt-2 text-sm leading-6 text-slate-600">{item.description}</p>
                    </div>
                ))}
            </div>

            <div className="rounded-[30px] border border-slate-200 bg-white p-6 shadow-[0_24px_60px_rgba(15,23,42,0.08)]">
                <div className="flex items-center justify-between gap-3 mb-5">
                    <div>
                        <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-slate-500">Verification & Setup</p>
                        <h3 className="mt-2 text-lg font-semibold text-slate-950">Approved Business Templates</h3>
                    </div>
                    <span className="status-badge">{dashboard?.templates.length || 0} template(s)</span>
                </div>
                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3 max-h-[400px] overflow-auto pr-1">
                    {!dashboard?.connected ? (
                        <div className="col-span-full rounded-[24px] border border-dashed border-slate-200 bg-slate-50 p-6 text-center">
                            <p className="text-sm font-semibold text-slate-900">Templates unavailable</p>
                        </div>
                    ) : dashboard.templates.length === 0 ? (
                        <div className="col-span-full rounded-[24px] border border-dashed border-slate-200 bg-slate-50 p-6 text-center">
                            <p className="text-sm font-semibold text-slate-900">No templates loaded</p>
                        </div>
                    ) : (
                        dashboard.templates.map((template) => (
                            <div key={template.id} className="rounded-[22px] border border-slate-200 bg-[linear-gradient(180deg,#fff,#f8fafc)] p-4 flex flex-col">
                                <div className="flex items-start justify-between gap-2">
                                    <p className="text-sm font-semibold text-slate-900 truncate">{template.name}</p>
                                    <span className={`px-2 py-1 rounded-md text-[10px] font-bold uppercase ${campaignTone(template.status.toLowerCase())}`}>
                                        {template.status}
                                    </span>
                                </div>
                                <div className="flex flex-wrap gap-2 mt-2">
                                    <span className="tool-chip bg-white">{template.language}</span>
                                    <span className="tool-chip bg-white">{template.category}</span>
                                    {template.qualityScore && <span className="tool-chip bg-white">Quality: {template.qualityScore}</span>}
                                </div>
                                {template.bodyPreview && (
                                    <p className="text-xs text-slate-600 mt-3 line-clamp-3 bg-white p-2 border border-slate-100 rounded-lg flex-1">{template.bodyPreview}</p>
                                )}
                            </div>
                        ))
                    )}
                </div>
                <div className="mt-6 border-t border-slate-100 pt-5">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-slate-500 mb-3">API Routing Overrides</p>
                    <div className="flex flex-wrap gap-4 text-xs text-slate-600">
                        <p>Webhook: <span className="font-mono bg-slate-100 px-1 py-0.5 rounded">{config?.webhookUrl || "Unknown"}</span></p>
                        <p>Verify Token: <span className="font-semibold text-slate-900">{config?.webhookVerifyTokenConfigured ? "Setup Complete" : "Missing Token"}</span></p>
                    </div>
                </div>
            </div>
        </section>
    );
}
