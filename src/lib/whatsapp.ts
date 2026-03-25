import { prisma } from "@/lib/prisma";

const DEFAULT_GRAPH_API_VERSION = process.env.WHATSAPP_GRAPH_API_VERSION || "v22.0";
const META_GRAPH_BASE_URL = `https://graph.facebook.com/${DEFAULT_GRAPH_API_VERSION}`;

export class WhatsAppError extends Error {
    code: string;
    status: number;

    constructor(message: string, code = "whatsapp_error", status = 500) {
        super(message);
        this.name = "WhatsAppError";
        this.code = code;
        this.status = status;
    }
}

type GraphErrorPayload = {
    error?: {
        message?: string;
        type?: string;
        code?: number;
        error_subcode?: number;
        error_data?: {
            details?: string;
        };
    };
};

type OAuthTokenResponse = {
    access_token?: string;
    token_type?: string;
    error?: {
        message?: string;
        type?: string;
        code?: number;
    };
};

type WhatsAppPhoneProfileResponse = {
    id?: string;
    display_phone_number?: string;
    verified_name?: string;
    quality_rating?: string;
    code_verification_status?: string;
    name_status?: string;
};

type WhatsAppBusinessResponse = {
    id?: string;
    name?: string;
};

type WhatsAppTemplateListResponse = {
    data?: Array<{
        id?: string;
        name?: string;
        language?: string;
        status?: string;
        category?: string;
        components?: Array<{
            type?: string;
            format?: string;
            text?: string;
        }>;
        quality_score?: {
            score?: string;
        };
    }>;
    paging?: {
        next?: string;
    };
};

type WhatsAppTemplateItem = NonNullable<WhatsAppTemplateListResponse["data"]>[number];
type WhatsAppTemplateComponent = NonNullable<WhatsAppTemplateItem["components"]>[number];

type WhatsAppMessageSendResponse = {
    messages?: Array<{
        id?: string;
        message_status?: string;
    }>;
};

export type WhatsAppTemplateSummary = {
    id: string;
    name: string;
    language: string;
    status: string;
    category: string;
    qualityScore?: string;
    bodyPreview?: string;
};

export type WhatsAppConversationSummary = {
    id: string;
    waId: string;
    profileName?: string;
    lastMessageText?: string;
    lastDirection?: string;
    lastMessageAt?: string;
    unreadCount: number;
};

export type WhatsAppMessageSummary = {
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

export type WhatsAppCampaignSummary = {
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

export type WhatsAppDashboard = {
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

export type WhatsAppPublicConfig = {
    ready: boolean;
    appId?: string;
    configId?: string;
    graphApiVersion: string;
    webhookUrl?: string;
    webhookVerifyTokenConfigured: boolean;
    redirectUri?: string;
    reason?: string;
};

function requireMetaAppConfig() {
    const appId = process.env.WHATSAPP_META_APP_ID || process.env.META_APP_ID || process.env.FACEBOOK_APP_ID;
    const appSecret = process.env.WHATSAPP_META_APP_SECRET || process.env.META_APP_SECRET || process.env.FACEBOOK_APP_SECRET;

    if (!appId || !appSecret) {
        throw new WhatsAppError(
            "Meta app is not configured. Set WHATSAPP_META_APP_ID and WHATSAPP_META_APP_SECRET.",
            "whatsapp_meta_not_configured",
            500
        );
    }

    return { appId, appSecret };
}

function getEmbeddedSignupConfigId() {
    return (
        process.env.WHATSAPP_EMBEDDED_SIGNUP_CONFIG_ID ||
        process.env.META_EMBEDDED_SIGNUP_CONFIG_ID ||
        ""
    ).trim();
}

function parseGraphError(payload: unknown, fallbackMessage: string, fallbackStatus = 500) {
    const graphError = (payload as GraphErrorPayload)?.error;
    const message =
        graphError?.error_data?.details ||
        graphError?.message ||
        fallbackMessage;
    const code =
        String(graphError?.type || graphError?.code || "whatsapp_api_error");
    return new WhatsAppError(message, code, fallbackStatus);
}

function graphUrl(pathname: string, params?: Record<string, string | number | boolean | undefined>) {
    const url = new URL(`${META_GRAPH_BASE_URL}/${pathname.replace(/^\//, "")}`);
    Object.entries(params || {}).forEach(([key, value]) => {
        if (value === undefined || value === null || value === "") return;
        url.searchParams.set(key, String(value));
    });
    return url.toString();
}

async function graphApiRequest<T>(
    accessToken: string,
    pathname: string,
    options?: {
        method?: "GET" | "POST";
        params?: Record<string, string | number | boolean | undefined>;
        body?: unknown;
    }
): Promise<T> {
    const response = await fetch(graphUrl(pathname, options?.params), {
        method: options?.method || "GET",
        headers: {
            Authorization: `Bearer ${accessToken}`,
            Accept: "application/json",
            ...(options?.body ? { "Content-Type": "application/json" } : {}),
        },
        body: options?.body ? JSON.stringify(options.body) : undefined,
        cache: "no-store",
    });

    const payload = await response.json().catch(() => ({}));
    if (response.ok) {
        return payload as T;
    }
    throw parseGraphError(payload, "WhatsApp API request failed.", response.status);
}

function normalizePhoneNumber(value: string) {
    return String(value || "").replace(/[^\d]/g, "");
}

function parseMetaTimestamp(value: unknown): Date | undefined {
    const raw = String(value || "").trim();
    if (!raw) return undefined;
    const seconds = Number(raw);
    if (Number.isFinite(seconds) && seconds > 0) {
        return new Date(seconds * 1000);
    }
    const direct = new Date(raw);
    if (Number.isNaN(direct.getTime())) return undefined;
    return direct;
}

function extractTemplateBodyPreview(template: WhatsAppTemplateItem) {
    const components = Array.isArray(template?.components) ? template.components : [];
    const body = components.find((component: WhatsAppTemplateComponent) => String(component?.type || "").toUpperCase() === "BODY");
    return String(body?.text || "").trim() || undefined;
}

function parseRecipientsInput(value: string): string[] {
    return Array.from(
        new Set(
            String(value || "")
                .split(/[\n,]/)
                .map((item) => normalizePhoneNumber(item))
                .filter((item) => item.length >= 8)
        )
    ).slice(0, 200);
}

function parseTemplateVariables(value: string | undefined | null): string[] {
    return String(value || "")
        .split(/\n|,/)
        .map((item) => item.trim())
        .filter(Boolean)
        .slice(0, 10);
}

async function getStoredConnection(userId: string) {
    return prisma.whatsAppConnection.findUnique({
        where: { userId },
    });
}

async function ensureConnectionOwnership(userId: string) {
    const connection = await getStoredConnection(userId);
    if (!connection?.accessToken) {
        throw new WhatsAppError("WhatsApp account is not connected.", "whatsapp_not_connected", 404);
    }
    return connection;
}

export function buildWhatsAppRedirectUri(origin: string) {
    return `${origin.replace(/\/$/, "")}/pdf-to-pdf/media`;
}

export function getWhatsAppPublicConfig(origin: string): WhatsAppPublicConfig {
    const appId = (process.env.WHATSAPP_META_APP_ID || process.env.META_APP_ID || process.env.FACEBOOK_APP_ID || "").trim();
    const configId = getEmbeddedSignupConfigId();
    const webhookVerifyTokenConfigured = Boolean((process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN || "").trim());
    const ready = Boolean(appId && configId);

    return {
        ready,
        appId: appId || undefined,
        configId: configId || undefined,
        graphApiVersion: DEFAULT_GRAPH_API_VERSION,
        webhookUrl: `${origin.replace(/\/$/, "")}/api/whatsapp/webhook`,
        webhookVerifyTokenConfigured,
        redirectUri: buildWhatsAppRedirectUri(origin),
        reason: ready ? undefined : "Set WHATSAPP_META_APP_ID and WHATSAPP_EMBEDDED_SIGNUP_CONFIG_ID to enable Embedded Signup.",
    };
}

async function exchangeCodeForAccessToken(options: {
    code: string;
    origin: string;
}) {
    const { appId, appSecret } = requireMetaAppConfig();
    const redirectUri = buildWhatsAppRedirectUri(options.origin);

    const attempt = async (includeRedirectUri: boolean) => {
        const response = await fetch(
            graphUrl("oauth/access_token", {
                client_id: appId,
                client_secret: appSecret,
                code: options.code,
                ...(includeRedirectUri ? { redirect_uri: redirectUri } : {}),
            }),
            {
                method: "GET",
                headers: {
                    Accept: "application/json",
                },
                cache: "no-store",
            }
        );
        const payload = (await response.json().catch(() => ({}))) as OAuthTokenResponse;
        if (!response.ok || !payload.access_token) {
            throw parseGraphError(payload, "Failed to exchange WhatsApp authorization code.", response.status);
        }
        return payload;
    };

    try {
        return await attempt(true);
    } catch (error) {
        const whatsappError = error as WhatsAppError;
        if (whatsappError.code === "OAuthException") {
            return attempt(false);
        }
        throw error;
    }
}

async function fetchPhoneProfile(accessToken: string, phoneNumberId: string) {
    return graphApiRequest<WhatsAppPhoneProfileResponse>(accessToken, phoneNumberId, {
        params: {
            fields: "id,display_phone_number,verified_name,quality_rating,code_verification_status,name_status",
        },
    });
}

async function fetchBusinessProfile(accessToken: string, wabaId: string) {
    return graphApiRequest<WhatsAppBusinessResponse>(accessToken, wabaId, {
        params: {
            fields: "id,name",
        },
    });
}

async function fetchRemoteTemplates(connection: {
    accessToken: string | null;
    wabaId: string;
}) {
    if (!connection.accessToken) return [];
    const payload = await graphApiRequest<WhatsAppTemplateListResponse>(connection.accessToken, `${connection.wabaId}/message_templates`, {
        params: {
            limit: 50,
            fields: "id,name,language,status,category,components,quality_score",
        },
    });

    return (payload.data || []).map((template) => ({
        id: String(template.id || template.name || "").trim() || `${template.name || "template"}:${template.language || "unknown"}`,
        name: String(template.name || "").trim() || "Unnamed template",
        language: String(template.language || "").trim() || "en",
        status: String(template.status || "").trim() || "UNKNOWN",
        category: String(template.category || "").trim() || "UTILITY",
        qualityScore: String(template.quality_score?.score || "").trim() || undefined,
        bodyPreview: extractTemplateBodyPreview(template),
    })) satisfies WhatsAppTemplateSummary[];
}

function summarizeConversation(conversation: {
    id: string;
    waId: string;
    profileName: string | null;
    lastMessageText: string | null;
    lastDirection: string | null;
    lastMessageAt: Date | null;
    unreadCount: number;
}) {
    return {
        id: conversation.id,
        waId: conversation.waId,
        profileName: conversation.profileName || undefined,
        lastMessageText: conversation.lastMessageText || undefined,
        lastDirection: conversation.lastDirection || undefined,
        lastMessageAt: conversation.lastMessageAt?.toISOString(),
        unreadCount: conversation.unreadCount,
    } satisfies WhatsAppConversationSummary;
}

function summarizeMessage(message: {
    id: string;
    wamid: string | null;
    direction: string;
    type: string;
    status: string | null;
    textBody: string | null;
    fromWaId: string | null;
    toWaId: string | null;
    createdAt: Date;
    metaTimestamp: Date | null;
}) {
    return {
        id: message.id,
        wamid: message.wamid || undefined,
        direction: message.direction,
        type: message.type,
        status: message.status || undefined,
        textBody: message.textBody || undefined,
        fromWaId: message.fromWaId || undefined,
        toWaId: message.toWaId || undefined,
        createdAt: message.createdAt.toISOString(),
        metaTimestamp: message.metaTimestamp?.toISOString(),
    } satisfies WhatsAppMessageSummary;
}

function summarizeCampaign(campaign: {
    id: string;
    name: string;
    templateName: string;
    templateLanguage: string;
    status: string;
    sentCount: number;
    deliveredCount: number;
    readCount: number;
    failedCount: number;
    createdAt: Date;
    lastRunAt: Date | null;
    lastError: string | null;
}) {
    return {
        id: campaign.id,
        name: campaign.name,
        templateName: campaign.templateName,
        templateLanguage: campaign.templateLanguage,
        status: campaign.status,
        sentCount: campaign.sentCount,
        deliveredCount: campaign.deliveredCount,
        readCount: campaign.readCount,
        failedCount: campaign.failedCount,
        createdAt: campaign.createdAt.toISOString(),
        lastRunAt: campaign.lastRunAt?.toISOString(),
        lastError: campaign.lastError || undefined,
    } satisfies WhatsAppCampaignSummary;
}

export async function upsertWhatsAppConnection(options: {
    userId: string;
    organizationId?: string | null;
    origin: string;
    code: string;
    businessId?: string | null;
    wabaId: string;
    phoneNumberId: string;
    appScopedUserId?: string | null;
}) {
    const tokenPayload = await exchangeCodeForAccessToken({
        code: options.code,
        origin: options.origin,
    });

    const [phoneProfile, businessProfile] = await Promise.all([
        fetchPhoneProfile(tokenPayload.access_token || "", options.phoneNumberId),
        fetchBusinessProfile(tokenPayload.access_token || "", options.wabaId),
    ]);

    const existingByPhone = await prisma.whatsAppConnection.findUnique({
        where: { phoneNumberId: options.phoneNumberId },
    });
    if (existingByPhone && existingByPhone.userId !== options.userId) {
        throw new WhatsAppError(
            "This WhatsApp phone number is already connected to another workspace user.",
            "whatsapp_phone_already_connected",
            409
        );
    }

    const existingForUser = await prisma.whatsAppConnection.findUnique({
        where: { userId: options.userId },
    });

    const data = {
        organizationId: options.organizationId || null,
        businessId: options.businessId || null,
        wabaId: options.wabaId,
        phoneNumberId: options.phoneNumberId,
        displayPhoneNumber: phoneProfile.display_phone_number || existingForUser?.displayPhoneNumber || null,
        verifiedName: phoneProfile.verified_name || existingForUser?.verifiedName || null,
        accountName: businessProfile.name || existingForUser?.accountName || null,
        appScopedUserId: options.appScopedUserId || existingForUser?.appScopedUserId || null,
        accessToken: tokenPayload.access_token || existingForUser?.accessToken || null,
        tokenType: tokenPayload.token_type || existingForUser?.tokenType || "Bearer",
        scope: existingForUser?.scope || null,
        webhookVerified: existingForUser?.webhookVerified || false,
    };

    const connection = existingForUser
        ? await prisma.whatsAppConnection.update({
            where: { id: existingForUser.id },
            data,
        })
        : await prisma.whatsAppConnection.create({
            data: {
                userId: options.userId,
                ...data,
            },
        });

    return {
        id: connection.id,
        wabaId: connection.wabaId,
        phoneNumberId: connection.phoneNumberId,
        displayPhoneNumber: connection.displayPhoneNumber || undefined,
        verifiedName: connection.verifiedName || undefined,
        accountName: connection.accountName || undefined,
    };
}

export async function fetchWhatsAppDashboard(userId: string): Promise<WhatsAppDashboard> {
    const connection = await prisma.whatsAppConnection.findUnique({
        where: { userId },
        include: {
            conversations: {
                orderBy: [{ lastMessageAt: "desc" }, { updatedAt: "desc" }],
                take: 20,
            },
            campaigns: {
                orderBy: { createdAt: "desc" },
                take: 12,
            },
        },
    });

    if (!connection) {
        return {
            connected: false,
            templates: [],
            conversations: [],
            campaigns: [],
        };
    }

    let templates: WhatsAppTemplateSummary[] = [];
    let warning: string | undefined;
    try {
        templates = await fetchRemoteTemplates(connection);
    } catch (error) {
        const whatsappError = error as WhatsAppError;
        warning = whatsappError.message;
    }

    return {
        connected: true,
        connection: {
            id: connection.id,
            businessId: connection.businessId || undefined,
            wabaId: connection.wabaId,
            phoneNumberId: connection.phoneNumberId,
            displayPhoneNumber: connection.displayPhoneNumber || undefined,
            verifiedName: connection.verifiedName || undefined,
            accountName: connection.accountName || undefined,
        },
        templates,
        conversations: connection.conversations.map(summarizeConversation),
        campaigns: connection.campaigns.map(summarizeCampaign),
        warning,
    };
}

export async function listWhatsAppConversationMessages(userId: string, conversationId: string) {
    const connection = await ensureConnectionOwnership(userId);
    const conversation = await prisma.whatsAppConversation.findFirst({
        where: {
            id: conversationId,
            connectionId: connection.id,
        },
        include: {
            messages: {
                orderBy: { createdAt: "asc" },
                take: 100,
            },
        },
    });

    if (!conversation) {
        throw new WhatsAppError("Conversation not found.", "whatsapp_conversation_not_found", 404);
    }

    await prisma.whatsAppConversation.update({
        where: { id: conversation.id },
        data: { unreadCount: 0 },
    });

    return {
        conversation: summarizeConversation(conversation),
        messages: conversation.messages.map(summarizeMessage),
    };
}

async function ensureConversation(
    connectionId: string,
    waId: string,
    profileName?: string,
    lastMessageText?: string,
    direction?: string,
    lastMessageAt?: Date
) {
    return prisma.whatsAppConversation.upsert({
        where: {
            connectionId_waId: {
                connectionId,
                waId,
            },
        },
        update: {
            profileName: profileName || undefined,
            lastMessageText: lastMessageText || undefined,
            lastDirection: direction || undefined,
            lastMessageAt: lastMessageAt || undefined,
            unreadCount: direction === "inbound" ? { increment: 1 } : undefined,
        },
        create: {
            connectionId,
            waId,
            profileName: profileName || null,
            lastMessageText: lastMessageText || null,
            lastDirection: direction || null,
            lastMessageAt: lastMessageAt || null,
            unreadCount: direction === "inbound" ? 1 : 0,
        },
    });
}

function buildTemplateComponents(variables: string[]) {
    if (variables.length === 0) return undefined;
    return [
        {
            type: "body",
            parameters: variables.map((text) => ({
                type: "text",
                text,
            })),
        },
    ];
}

async function createOutboundMessageRecord(options: {
    connectionId: string;
    conversationId: string;
    campaignId?: string;
    wamid?: string;
    toWaId: string;
    textBody?: string;
    templateName?: string;
    status?: string;
    payload?: unknown;
}) {
    return prisma.whatsAppMessage.create({
        data: {
            connectionId: options.connectionId,
            conversationId: options.conversationId,
            campaignId: options.campaignId || null,
            wamid: options.wamid || null,
            direction: "outbound",
            type: options.templateName ? "template" : "text",
            toWaId: options.toWaId,
            textBody: options.textBody || null,
            templateName: options.templateName || null,
            status: options.status || "sent",
            payload: options.payload as any,
            metaTimestamp: new Date(),
        },
    });
}

async function recomputeCampaignStats(campaignId: string) {
    const messages = await prisma.whatsAppMessage.findMany({
        where: { campaignId },
        select: { status: true },
    });

    const sentCount = messages.length;
    const deliveredCount = messages.filter((message: { status: string | null }) => message.status === "delivered" || message.status === "read").length;
    const readCount = messages.filter((message: { status: string | null }) => message.status === "read").length;
    const failedCount = messages.filter((message: { status: string | null }) => ["failed", "undelivered"].includes(String(message.status || ""))).length;

    await prisma.whatsAppCampaign.update({
        where: { id: campaignId },
        data: {
            sentCount,
            deliveredCount,
            readCount,
            failedCount,
            lastRunAt: new Date(),
        },
    });
}

export async function sendWhatsAppTextMessage(options: {
    userId: string;
    to: string;
    body: string;
}) {
    const connection = await ensureConnectionOwnership(options.userId);
    const to = normalizePhoneNumber(options.to);
    const body = String(options.body || "").trim();

    if (!to) {
        throw new WhatsAppError("Recipient phone number is required.", "whatsapp_recipient_required", 400);
    }
    if (!body) {
        throw new WhatsAppError("Message body is required.", "whatsapp_message_required", 400);
    }

    const conversation = await ensureConversation(connection.id, to, undefined, body, "outbound", new Date());

    const payload = await graphApiRequest<WhatsAppMessageSendResponse>(connection.accessToken || "", `${connection.phoneNumberId}/messages`, {
        method: "POST",
        body: {
            messaging_product: "whatsapp",
            recipient_type: "individual",
            to,
            type: "text",
            text: {
                preview_url: false,
                body,
            },
        },
    });

    const wamid = String(payload.messages?.[0]?.id || "").trim() || undefined;
    await createOutboundMessageRecord({
        connectionId: connection.id,
        conversationId: conversation.id,
        wamid,
        toWaId: to,
        textBody: body,
        status: payload.messages?.[0]?.message_status || "sent",
        payload,
    });

    return { wamid, conversationId: conversation.id };
}

export async function sendWhatsAppTemplateMessage(options: {
    userId: string;
    to: string;
    templateName: string;
    languageCode: string;
    variables?: string[];
    campaignId?: string;
}) {
    const connection = await ensureConnectionOwnership(options.userId);
    const to = normalizePhoneNumber(options.to);
    const templateName = String(options.templateName || "").trim();
    const languageCode = String(options.languageCode || "").trim() || "en";
    const variables = Array.isArray(options.variables) ? options.variables.map((value) => String(value).trim()).filter(Boolean) : [];

    if (!to) {
        throw new WhatsAppError("Recipient phone number is required.", "whatsapp_recipient_required", 400);
    }
    if (!templateName) {
        throw new WhatsAppError("Template name is required.", "whatsapp_template_required", 400);
    }

    const conversation = await ensureConversation(connection.id, to, undefined, `Template: ${templateName}`, "outbound", new Date());
    const payload = await graphApiRequest<WhatsAppMessageSendResponse>(connection.accessToken || "", `${connection.phoneNumberId}/messages`, {
        method: "POST",
        body: {
            messaging_product: "whatsapp",
            recipient_type: "individual",
            to,
            type: "template",
            template: {
                name: templateName,
                language: {
                    code: languageCode,
                },
                components: buildTemplateComponents(variables),
            },
        },
    });

    const wamid = String(payload.messages?.[0]?.id || "").trim() || undefined;
    await createOutboundMessageRecord({
        connectionId: connection.id,
        conversationId: conversation.id,
        campaignId: options.campaignId,
        wamid,
        toWaId: to,
        textBody: `Template: ${templateName}`,
        templateName,
        status: payload.messages?.[0]?.message_status || "sent",
        payload,
    });

    if (options.campaignId) {
        await recomputeCampaignStats(options.campaignId);
    }

    return { wamid, conversationId: conversation.id };
}

export async function createWhatsAppCampaign(options: {
    userId: string;
    organizationId?: string | null;
    name: string;
    templateName: string;
    languageCode: string;
    recipientsRaw: string;
    variablesRaw?: string;
}) {
    const connection = await ensureConnectionOwnership(options.userId);
    const recipients = parseRecipientsInput(options.recipientsRaw);
    const variables = parseTemplateVariables(options.variablesRaw);

    if (!options.name.trim()) {
        throw new WhatsAppError("Campaign name is required.", "whatsapp_campaign_name_required", 400);
    }
    if (!options.templateName.trim()) {
        throw new WhatsAppError("Template name is required.", "whatsapp_template_required", 400);
    }
    if (recipients.length === 0) {
        throw new WhatsAppError("Add at least one recipient phone number.", "whatsapp_recipients_required", 400);
    }

    const campaign = await prisma.whatsAppCampaign.create({
        data: {
            connectionId: connection.id,
            userId: options.userId,
            organizationId: options.organizationId || null,
            name: options.name.trim(),
            templateName: options.templateName.trim(),
            templateLanguage: String(options.languageCode || "en").trim(),
            status: "running",
            recipients: recipients as any,
            variables: variables.length > 0 ? (variables as any) : undefined,
            lastRunAt: new Date(),
        },
    });

    let failures = 0;
    for (const recipient of recipients) {
        try {
            await sendWhatsAppTemplateMessage({
                userId: options.userId,
                to: recipient,
                templateName: options.templateName,
                languageCode: options.languageCode,
                variables,
                campaignId: campaign.id,
            });
        } catch (error) {
            failures += 1;
            console.error(`Failed WhatsApp campaign send to ${recipient}:`, error);
        }
    }

    await recomputeCampaignStats(campaign.id);
    const updated = await prisma.whatsAppCampaign.update({
        where: { id: campaign.id },
        data: {
            status: failures > 0 ? (failures === recipients.length ? "failed" : "partial") : "completed",
            lastError: failures > 0 ? `${failures} recipient(s) failed.` : null,
        },
    });

    return summarizeCampaign(updated);
}

export async function disconnectWhatsAppConnection(userId: string) {
    const deleted = await prisma.whatsAppConnection.deleteMany({
        where: { userId },
    });
    return deleted.count > 0;
}

function extractMessageText(message: any) {
    if (message?.text?.body) return String(message.text.body).trim();
    if (message?.button?.text) return String(message.button.text).trim();
    if (message?.interactive?.button_reply?.title) return String(message.interactive.button_reply.title).trim();
    if (message?.interactive?.list_reply?.title) return String(message.interactive.list_reply.title).trim();
    if (message?.image?.caption) return String(message.image.caption).trim();
    if (message?.document?.caption) return String(message.document.caption).trim();
    return "";
}

export async function ingestWhatsAppWebhook(payload: any) {
    const entries = Array.isArray(payload?.entry) ? payload.entry : [];

    for (const entry of entries) {
        const changes = Array.isArray(entry?.changes) ? entry.changes : [];
        for (const change of changes) {
            const value = change?.value || {};
            const phoneNumberId = String(value?.metadata?.phone_number_id || "").trim();
            if (!phoneNumberId) continue;

            const connection = await prisma.whatsAppConnection.findUnique({
                where: { phoneNumberId },
            });
            if (!connection) continue;

            const contacts = Array.isArray(value?.contacts) ? value.contacts : [];
            const contactMap = new Map<string, string>();
            contacts.forEach((contact: any) => {
                const waId = String(contact?.wa_id || "").trim();
                const name = String(contact?.profile?.name || "").trim();
                if (waId && name) {
                    contactMap.set(waId, name);
                }
            });

            const messages = Array.isArray(value?.messages) ? value.messages : [];
            for (const message of messages) {
                const fromWaId = String(message?.from || "").trim();
                if (!fromWaId) continue;
                const textBody = extractMessageText(message);
                const metaTimestamp = parseMetaTimestamp(message?.timestamp) || new Date();
                const conversation = await ensureConversation(
                    connection.id,
                    fromWaId,
                    contactMap.get(fromWaId),
                    textBody || `Incoming ${String(message?.type || "message")}`,
                    "inbound",
                    metaTimestamp
                );

                const inboundWamid = String(message?.id || "").trim();
                if (inboundWamid) {
                    await prisma.whatsAppMessage.upsert({
                        where: {
                            wamid: inboundWamid,
                        },
                        update: {
                            status: "received",
                            payload: message,
                            textBody: textBody || undefined,
                        },
                        create: {
                            connectionId: connection.id,
                            conversationId: conversation.id,
                            wamid: inboundWamid,
                            direction: "inbound",
                            type: String(message?.type || "unknown").trim() || "unknown",
                            fromWaId,
                            textBody: textBody || null,
                            status: "received",
                            payload: message,
                            metaTimestamp,
                        },
                    });
                } else {
                    await prisma.whatsAppMessage.create({
                        data: {
                            connectionId: connection.id,
                            conversationId: conversation.id,
                            wamid: null,
                            direction: "inbound",
                            type: String(message?.type || "unknown").trim() || "unknown",
                            fromWaId,
                            textBody: textBody || null,
                            status: "received",
                            payload: message,
                            metaTimestamp,
                        },
                    });
                }
            }

            const statuses = Array.isArray(value?.statuses) ? value.statuses : [];
            for (const status of statuses) {
                const wamid = String(status?.id || "").trim();
                if (!wamid) continue;
                const metaTimestamp = parseMetaTimestamp(status?.timestamp);
                const updatedMessage = await prisma.whatsAppMessage.updateMany({
                    where: {
                        connectionId: connection.id,
                        wamid,
                    },
                    data: {
                        status: String(status?.status || "").trim() || "sent",
                        payload: status,
                        metaTimestamp: metaTimestamp || undefined,
                    },
                });

                if (updatedMessage.count > 0) {
                    const messageRecord = await prisma.whatsAppMessage.findFirst({
                        where: {
                            connectionId: connection.id,
                            wamid,
                        },
                        select: {
                            campaignId: true,
                            conversationId: true,
                            toWaId: true,
                            textBody: true,
                        },
                    });

                    if (messageRecord?.campaignId) {
                        await recomputeCampaignStats(messageRecord.campaignId);
                    }

                    if (messageRecord?.conversationId) {
                        await prisma.whatsAppConversation.update({
                            where: { id: messageRecord.conversationId },
                            data: {
                                lastMessageText: messageRecord.textBody || undefined,
                                lastDirection: "outbound",
                                lastMessageAt: metaTimestamp || new Date(),
                            },
                        }).catch(() => undefined);
                    }
                }
            }
        }
    }
}

export async function verifyWhatsAppWebhook(params: URLSearchParams) {
    const mode = String(params.get("hub.mode") || "");
    const verifyToken = String(params.get("hub.verify_token") || "");
    const challenge = String(params.get("hub.challenge") || "");
    const expectedToken = String(process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN || "").trim();

    if (mode !== "subscribe" || !verifyToken || !expectedToken || verifyToken !== expectedToken) {
        throw new WhatsAppError("Webhook verification failed.", "whatsapp_webhook_verification_failed", 403);
    }

    return challenge;
}
