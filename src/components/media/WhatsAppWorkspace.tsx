"use client";

import { useEffect, useRef, useState } from "react";
import { useSession } from "next-auth/react";
import toast from "react-hot-toast";

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
        <section className="mt-6 grid grid-cols-1 xl:grid-cols-3 gap-4">
            <article className="surface p-4 xl:col-span-1">
                <div className="flex items-center justify-between gap-3 mb-4">
                    <div>
                        <p className="text-xs font-bold uppercase tracking-wide text-slate-500">WhatsApp Cloud</p>
                        <h2 className="text-lg font-semibold text-slate-900 mt-1">Inbox And Campaigns</h2>
                    </div>
                    <span className="status-badge">
                        {dashboard?.connected ? "Connected" : loading ? "Loading" : "Disconnected"}
                    </span>
                </div>

                {dashboard?.connection ? (
                    <div className="surface-subtle p-4 rounded-2xl border border-slate-200">
                        <p className="text-sm font-semibold text-slate-900">
                            {dashboard.connection.accountName || dashboard.connection.verifiedName || "Connected Business"}
                        </p>
                        <div className="flex flex-wrap gap-2 mt-3">
                            {dashboard.connection.displayPhoneNumber && (
                                <span className="tool-chip">{dashboard.connection.displayPhoneNumber}</span>
                            )}
                            <span className="tool-chip">Phone ID: {dashboard.connection.phoneNumberId}</span>
                            <span className="tool-chip">WABA: {dashboard.connection.wabaId}</span>
                        </div>
                        <div className="flex flex-wrap gap-2 mt-4">
                            <button
                                type="button"
                                onClick={handleEmbeddedSignup}
                                disabled={action !== null}
                                className="btn btn-primary text-xs"
                            >
                                {action === "connect" ? "Connecting..." : "Reconnect WhatsApp"}
                            </button>
                            <button
                                type="button"
                                onClick={handleDisconnect}
                                disabled={action !== null}
                                className="btn btn-ghost text-xs"
                            >
                                {action === "disconnect" ? "Disconnecting..." : "Disconnect"}
                            </button>
                        </div>
                    </div>
                ) : (
                    <div className="surface-subtle p-4 rounded-2xl border border-dashed border-slate-200">
                        <p className="text-sm text-slate-700">
                            Connect a WhatsApp Business Platform number with Meta Embedded Signup, then manage inbox conversations and run template campaigns from one place.
                        </p>
                        <button
                            type="button"
                            onClick={handleEmbeddedSignup}
                            disabled={action !== null || !config?.ready}
                            className="btn btn-primary text-xs mt-4"
                        >
                            {action === "connect" ? "Opening Meta..." : "Connect WhatsApp"}
                        </button>
                        <p className="text-[11px] text-slate-500 mt-3">
                            {config?.reason || "Add Meta app ID, Embedded Signup config ID, and webhook verify token to enable this workspace."}
                        </p>
                    </div>
                )}

                <div className="mt-5 rounded-2xl border border-slate-200 bg-white p-4">
                    <p className="text-xs font-bold uppercase tracking-wide text-slate-500">Meta Setup Notes</p>
                    <div className="space-y-2 mt-3 text-xs text-slate-600">
                        <p>Webhook URL: <span className="font-semibold text-slate-900 break-all">{config?.webhookUrl || "Unavailable"}</span></p>
                        <p>Redirect URI: <span className="font-semibold text-slate-900 break-all">{config?.redirectUri || "Unavailable"}</span></p>
                        <p>Verify Token: <span className="font-semibold text-slate-900">{config?.webhookVerifyTokenConfigured ? "Configured" : "Missing"}</span></p>
                    </div>
                    {dashboard?.warning && (
                        <p className="text-xs text-amber-700 mt-3">{dashboard.warning}</p>
                    )}
                </div>

                <div className="mt-5 rounded-2xl border border-slate-200 bg-white p-4">
                    <div className="flex items-center justify-between gap-2">
                        <div>
                            <p className="text-xs font-bold uppercase tracking-wide text-slate-500">Quick Send</p>
                            <p className="text-[11px] text-slate-500 mt-1">Send a direct text reply or outreach message.</p>
                        </div>
                    </div>
                    <div className="space-y-3 mt-4">
                        <input
                            value={textRecipient}
                            onChange={(event) => setTextRecipient(event.target.value)}
                            placeholder="Recipient number, e.g. 9198xxxxxx"
                            className="input"
                            disabled={!dashboard?.connected}
                        />
                        <textarea
                            value={textBody}
                            onChange={(event) => setTextBody(event.target.value)}
                            placeholder="Write a WhatsApp message"
                            className="textarea min-h-[120px]"
                            disabled={!dashboard?.connected}
                        />
                        <button
                            type="button"
                            onClick={() => void handleSendText()}
                            disabled={!dashboard?.connected || action !== null}
                            className="btn btn-primary text-xs"
                        >
                            {action === "send" ? "Sending..." : "Send Message"}
                        </button>
                    </div>
                </div>
            </article>

            <article className="surface p-4 xl:col-span-2">
                <div className="grid grid-cols-1 2xl:grid-cols-2 gap-4">
                    <div>
                        <div className="flex items-center justify-between gap-2 mb-3">
                            <p className="text-xs font-bold uppercase tracking-wide text-slate-500">Inbox</p>
                            <span className="status-badge">{dashboard?.conversations.length || 0} conversation(s)</span>
                        </div>
                        <div className="space-y-3 max-h-[72vh] overflow-auto pr-1">
                            {!dashboard?.connected ? (
                                <div className="empty-state py-10">
                                    <h3>WhatsApp not connected</h3>
                                    <p className="text-sm">Use Embedded Signup to link a business number first.</p>
                                </div>
                            ) : dashboard.conversations.length === 0 ? (
                                <div className="empty-state py-10">
                                    <h3>No conversations yet</h3>
                                    <p className="text-sm">Incoming webhook messages will start populating your inbox here.</p>
                                </div>
                            ) : (
                                dashboard.conversations.map((conversation) => (
                                    <button
                                        key={conversation.id}
                                        type="button"
                                        onClick={() => setSelectedConversationId(conversation.id)}
                                        className={`w-full text-left surface-subtle p-3 border rounded-xl transition ${
                                            selectedConversationId === conversation.id ? "border-emerald-300 bg-emerald-50" : "border-slate-200"
                                        }`}
                                    >
                                        <div className="flex items-start justify-between gap-3">
                                            <div className="min-w-0">
                                                <p className="text-sm font-semibold text-slate-900 truncate">
                                                    {conversation.profileName || conversation.waId}
                                                </p>
                                                <p className="text-xs text-slate-500 truncate mt-1">{conversation.waId}</p>
                                                {conversation.lastMessageText && (
                                                    <p className="text-xs text-slate-700 line-clamp-2 mt-2">{conversation.lastMessageText}</p>
                                                )}
                                            </div>
                                            <div className="text-right">
                                                {conversation.unreadCount > 0 && (
                                                    <span className="inline-flex px-2 py-1 rounded-full bg-emerald-100 text-emerald-700 text-[10px] font-bold">
                                                        {conversation.unreadCount} new
                                                    </span>
                                                )}
                                                <p className="text-[11px] text-slate-500 mt-2">{formatDateTime(conversation.lastMessageAt)}</p>
                                            </div>
                                        </div>
                                    </button>
                                ))
                            )}
                        </div>
                    </div>

                    <div>
                        <div className="flex items-center justify-between gap-2 mb-3">
                            <p className="text-xs font-bold uppercase tracking-wide text-slate-500">Conversation</p>
                            {selectedConversation && (
                                <span className="status-badge">{selectedConversation.profileName || selectedConversation.waId}</span>
                            )}
                        </div>

                        {!selectedConversation ? (
                            <div className="empty-state py-10">
                                <h3>No conversation selected</h3>
                                <p className="text-sm">Choose a thread from the inbox to read messages and reply faster.</p>
                            </div>
                        ) : messagesLoading ? (
                            <div className="empty-state py-10">
                                <h3>Loading conversation</h3>
                                <p className="text-sm">Pulling the latest WhatsApp messages for this thread.</p>
                            </div>
                        ) : (
                            <div className="surface-subtle border border-slate-200 rounded-2xl p-4 max-h-[72vh] overflow-auto space-y-3">
                                {messages.length === 0 ? (
                                    <div className="empty-state py-10">
                                        <h3>No messages yet</h3>
                                        <p className="text-sm">This contact is ready for replies once messages arrive or you send one.</p>
                                    </div>
                                ) : (
                                    messages.map((message) => (
                                        <div
                                            key={message.id}
                                            className={`max-w-[85%] rounded-2xl px-4 py-3 border text-sm ${
                                                message.direction === "outbound"
                                                    ? "ml-auto bg-emerald-50 border-emerald-200 text-slate-900"
                                                    : "bg-white border-slate-200 text-slate-900"
                                            }`}
                                        >
                                            <p>{message.textBody || `Unsupported ${message.type} message`}</p>
                                            <div className="flex items-center justify-between gap-3 mt-2 text-[11px] text-slate-500">
                                                <span>{message.type}</span>
                                                <span>{message.status || message.direction}</span>
                                            </div>
                                        </div>
                                    ))
                                )}
                            </div>
                        )}
                    </div>
                </div>

                <div className="mt-5 border-t border-slate-200 pt-5">
                    <div className="grid grid-cols-1 2xl:grid-cols-2 gap-4">
                        <div>
                            <div className="flex items-center justify-between gap-2 mb-3">
                                <p className="text-xs font-bold uppercase tracking-wide text-slate-500">Template Library</p>
                                <span className="status-badge">{dashboard?.templates.length || 0} template(s)</span>
                            </div>
                            <div className="space-y-3 max-h-[40vh] overflow-auto pr-1">
                                {!dashboard?.connected ? (
                                    <div className="empty-state py-10">
                                        <h3>Templates unavailable</h3>
                                        <p className="text-sm">Connect WhatsApp first to fetch approved template messages.</p>
                                    </div>
                                ) : dashboard.templates.length === 0 ? (
                                    <div className="empty-state py-10">
                                        <h3>No templates loaded</h3>
                                        <p className="text-sm">Create and approve templates in Meta Business Manager, then refresh this workspace.</p>
                                    </div>
                                ) : (
                                    dashboard.templates.map((template) => (
                                        <button
                                            key={template.id}
                                            type="button"
                                            onClick={() => {
                                                setCampaignTemplate(template.name);
                                                setCampaignLanguage(template.language);
                                            }}
                                            className={`w-full text-left surface-subtle p-3 border rounded-xl ${
                                                campaignTemplate === template.name ? "border-indigo-300 bg-indigo-50" : "border-slate-200"
                                            }`}
                                        >
                                            <div className="flex items-center justify-between gap-3">
                                                <p className="text-sm font-semibold text-slate-900">{template.name}</p>
                                                <span className={`px-2 py-1 rounded-md text-[10px] font-bold uppercase ${campaignTone(template.status.toLowerCase())}`}>
                                                    {template.status}
                                                </span>
                                            </div>
                                            <div className="flex flex-wrap gap-2 mt-2">
                                                <span className="tool-chip">{template.language}</span>
                                                <span className="tool-chip">{template.category}</span>
                                                {template.qualityScore && <span className="tool-chip">Quality: {template.qualityScore}</span>}
                                            </div>
                                            {template.bodyPreview && (
                                                <p className="text-xs text-slate-600 mt-2 line-clamp-3">{template.bodyPreview}</p>
                                            )}
                                        </button>
                                    ))
                                )}
                            </div>
                        </div>

                        <div>
                            <div className="flex items-center justify-between gap-2 mb-3">
                                <div>
                                    <p className="text-xs font-bold uppercase tracking-wide text-slate-500">Campaign Sender</p>
                                    <p className="text-[11px] text-slate-500 mt-1">Run a template campaign across multiple recipients in one click.</p>
                                </div>
                            </div>
                            <div className="surface-subtle border border-slate-200 rounded-2xl p-4 space-y-3">
                                <input
                                    value={campaignName}
                                    onChange={(event) => setCampaignName(event.target.value)}
                                    placeholder="Campaign name"
                                    className="input"
                                    disabled={!dashboard?.connected}
                                />
                                <select
                                    value={campaignTemplate}
                                    onChange={(event) => setCampaignTemplate(event.target.value)}
                                    className="select"
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
                                    className="input"
                                    disabled={!dashboard?.connected}
                                />
                                <textarea
                                    value={campaignRecipients}
                                    onChange={(event) => setCampaignRecipients(event.target.value)}
                                    placeholder="Recipient numbers, one per line or comma separated"
                                    className="textarea min-h-[120px]"
                                    disabled={!dashboard?.connected}
                                />
                                <textarea
                                    value={campaignVariables}
                                    onChange={(event) => setCampaignVariables(event.target.value)}
                                    placeholder="Optional body variables, comma or newline separated"
                                    className="textarea min-h-[90px]"
                                    disabled={!dashboard?.connected}
                                />
                                <button
                                    type="button"
                                    onClick={() => void handleSendCampaign()}
                                    disabled={!dashboard?.connected || action !== null}
                                    className="btn btn-primary text-xs"
                                >
                                    {action === "campaign" ? "Sending Campaign..." : "Run Template Campaign"}
                                </button>
                            </div>

                            <div className="mt-4 rounded-2xl border border-slate-200 bg-white p-4">
                                <div className="flex items-center justify-between gap-2">
                                    <p className="text-xs font-bold uppercase tracking-wide text-slate-500">Recent Campaigns</p>
                                    <span className="status-badge">{dashboard?.campaigns.length || 0}</span>
                                </div>
                                <div className="space-y-3 mt-3 max-h-[28vh] overflow-auto pr-1">
                                    {dashboard?.campaigns.length ? (
                                        dashboard.campaigns.map((campaign) => (
                                            <div key={campaign.id} className="surface-subtle p-3 border border-slate-200 rounded-xl">
                                                <div className="flex items-start justify-between gap-3">
                                                    <div>
                                                        <p className="text-sm font-semibold text-slate-900">{campaign.name}</p>
                                                        <p className="text-xs text-slate-500 mt-1">
                                                            {campaign.templateName} · {campaign.templateLanguage}
                                                        </p>
                                                    </div>
                                                    <span className={`px-2 py-1 rounded-md text-[10px] font-bold uppercase ${campaignTone(campaign.status)}`}>
                                                        {campaign.status}
                                                    </span>
                                                </div>
                                                <div className="flex flex-wrap gap-2 mt-3 text-[11px] text-slate-600">
                                                    <span className="tool-chip">Sent: {campaign.sentCount}</span>
                                                    <span className="tool-chip">Delivered: {campaign.deliveredCount}</span>
                                                    <span className="tool-chip">Read: {campaign.readCount}</span>
                                                    <span className="tool-chip">Failed: {campaign.failedCount}</span>
                                                </div>
                                                {campaign.lastError && (
                                                    <p className="text-[11px] text-amber-700 mt-2">{campaign.lastError}</p>
                                                )}
                                            </div>
                                        ))
                                    ) : (
                                        <p className="text-xs text-slate-500">No campaigns have been run yet.</p>
                                    )}
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </article>
        </section>
    );
}
