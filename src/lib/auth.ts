import { PrismaAdapter } from "@next-auth/prisma-adapter";
import { NextAuthOptions } from "next-auth";
import type { Adapter } from "next-auth/adapters";
import GoogleProvider from "next-auth/providers/google";
import CredentialsProvider from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { prisma, runPrismaWithReconnect } from "@/lib/prisma";

const SYSTEM_ADMIN_EMAIL = "abhishekdev057@gmail.com";
const AUTH_STATE_REFRESH_MS = 5 * 60 * 1000;
const ALL_TOOLS = ["pdf-to-pdf", "media-studio", "whiteboard", "library"] as const;

function normalizeAllowedTools(tools: string[] | undefined | null): string[] {
    const source = Array.isArray(tools) ? tools : [];
    const normalized = source.map((tool) => {
        if (tool === "json-to-pdf" || tool === "image-to-pdf") {
            return "pdf-to-pdf";
        }
        return tool;
    });
    return Array.from(new Set(normalized.filter((tool) => ALL_TOOLS.includes(tool as typeof ALL_TOOLS[number]))));
}

async function authDb<T>(operation: (client: typeof prisma) => Promise<T>) {
    return runPrismaWithReconnect(operation, {
        maxAttempts: 3,
        retryDelayMs: 700,
    });
}

function createResilientPrismaAdapter(): Adapter {
    const methodNames = [
        "createUser",
        "getUser",
        "getUserByEmail",
        "getUserByAccount",
        "updateUser",
        "deleteUser",
        "linkAccount",
        "unlinkAccount",
        "getSessionAndUser",
        "createSession",
        "updateSession",
        "deleteSession",
        "createVerificationToken",
        "useVerificationToken",
    ] as const;

    const adapter = {} as Record<(typeof methodNames)[number], (...args: any[]) => Promise<any>>;

    for (const methodName of methodNames) {
        adapter[methodName] = async (...args: any[]) =>
            authDb(async (client) => {
                const liveAdapter = PrismaAdapter(client) as Adapter & Record<string, (...innerArgs: any[]) => Promise<any>>;
                const method = liveAdapter[methodName];
                return method(...args);
            });
    }

    return adapter as unknown as Adapter;
}

export const authOptions: NextAuthOptions = {
    adapter: createResilientPrismaAdapter() as any,
    session: {
        strategy: "jwt",
    },
    pages: {
        signIn: "/auth/signin",
    },
    providers: [
        GoogleProvider({
            clientId: process.env.GOOGLE_CLIENT_ID!,
            clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
            // Auto-promote system admin on sign in if not already
            profile(profile) {
                return {
                    id: profile.sub,
                    name: profile.name,
                    email: profile.email,
                    image: profile.picture,
                    role: profile.email === SYSTEM_ADMIN_EMAIL ? "SYSTEM_ADMIN" : "MEMBER",
                    organizationId: null,
                };
            },
        }),
        CredentialsProvider({
            name: "Organization Credentials",
            credentials: {
                organizationId: { label: "Organization ID", type: "text" },
                username: { label: "Username / Email", type: "text" },
                password: { label: "Password", type: "password" },
            },
            async authorize(credentials) {
                if (!credentials?.organizationId || !credentials?.username || !credentials?.password) {
                    throw new Error("Missing credentials");
                }

                // Verify the organization exists
                const org = await authDb((client) =>
                    client.organization.findUnique({
                        where: { id: credentials.organizationId },
                    })
                );

                if (!org) {
                    throw new Error("Invalid Organization ID");
                }

                // Find user by username AND organizationId
                const user = await authDb((client) =>
                    client.user.findFirst({
                        where: {
                            organizationId: credentials.organizationId,
                            OR: [
                                { username: credentials.username },
                                { email: credentials.username },
                            ],
                        },
                    })
                );

                if (!user || !user.password) {
                    throw new Error("Invalid username or password");
                }

                // Verify password
                const isValid = await bcrypt.compare(credentials.password, user.password);

                if (!isValid) {
                    throw new Error("Invalid username or password");
                }

                return {
                    id: user.id,
                    name: user.name,
                    email: user.email,
                    role: user.role,
                    organizationId: user.organizationId,
                };
            },
        }),
    ],
    callbacks: {
        async signIn({ user, account, profile }) {
            // Strict invite-only for OAuth (Google)
            if (account?.provider === "google" && user.email) {
                if (user.email === SYSTEM_ADMIN_EMAIL) {
                    // Ensure system admin account is linked
                    const adminUser = await authDb((client) =>
                        client.user.findUnique({ where: { email: user.email } })
                    );
                    if (adminUser) {
                        const existingAccount = await authDb((client) =>
                            client.account.findFirst({
                                where: { userId: adminUser.id, provider: "google" }
                            })
                        );
                        if (!existingAccount && account.providerAccountId) {
                            await authDb((client) =>
                                client.account.create({
                                    data: {
                                        userId: adminUser.id,
                                        type: account.type,
                                        provider: account.provider,
                                        providerAccountId: account.providerAccountId,
                                        refresh_token: account.refresh_token,
                                        access_token: account.access_token,
                                        expires_at: account.expires_at,
                                        token_type: account.token_type,
                                        scope: account.scope,
                                        id_token: account.id_token,
                                    }
                                })
                            );
                        }
                    }
                    return true;
                }

                // Check if the user email was pre-registered in the DB by an admin
                const existingUser = await authDb((client) =>
                    client.user.findUnique({
                        where: { email: user.email },
                        include: { accounts: { where: { provider: "google" } } }
                    })
                );

                if (!existingUser) {
                    // Email not invited — block access
                    return "/auth/signin?error=AccessDenied";
                }

                // Email exists but no Google account linked yet (invited via email, first Google login)
                // Auto-link the Google account to the existing user
                if (existingUser.accounts.length === 0 && account.providerAccountId) {
                    await authDb((client) =>
                        client.account.create({
                            data: {
                                userId: existingUser.id,
                                type: account.type,
                                provider: account.provider,
                                providerAccountId: account.providerAccountId,
                                refresh_token: account.refresh_token,
                                access_token: account.access_token,
                                expires_at: account.expires_at,
                                token_type: account.token_type,
                                scope: account.scope,
                                id_token: account.id_token,
                            }
                        })
                    );
                    // Update user's token.sub to the existing user's ID
                    user.id = existingUser.id;
                }
            }
            return true;
        },
        async jwt({ token, user, trigger, session }) {
            // Initial sign in
            if (user) {
                token.role = user.role;
                token.organizationId = (user as any).organizationId || null;
            }

            // Sync with DB on sign-in and then only periodically to avoid
            // exhausting the database pool during frequent session checks.
            const lastSyncedAt = Number((token as any).userStateSyncedAt || 0);
            const shouldRefreshFromDb =
                Boolean(token.sub) && (
                    Boolean(user) ||
                    trigger === "update" ||
                    !token.role ||
                    typeof (token as any).onboardingDone === "undefined" ||
                    !Array.isArray((token as any).allowedTools) ||
                    !lastSyncedAt ||
                    Date.now() - lastSyncedAt > AUTH_STATE_REFRESH_MS
                );

            if (shouldRefreshFromDb && token.sub) {
                const dbUser = await authDb((client) =>
                    client.user.findUnique({
                        where: { id: token.sub },
                        select: {
                            role: true,
                            organizationId: true,
                            onboardingDone: true,
                            allowedTools: true,
                            organization: {
                                select: {
                                    allowedTools: true
                                }
                            }
                        },
                    })
                );

                // Auto-promote system admin if they somehow lose the role
                if (token.email === SYSTEM_ADMIN_EMAIL && dbUser?.role !== "SYSTEM_ADMIN") {
                    await authDb((client) =>
                        client.user.update({
                            where: { id: token.sub },
                            data: { role: "SYSTEM_ADMIN" },
                        })
                    );
                    token.role = "SYSTEM_ADMIN";
                    token.allowedTools = [...ALL_TOOLS];
                    token.organizationId = null;
                    token.onboardingDone = true; // System admin skips onboarding
                } else if (dbUser) {
                    token.role = dbUser.role;
                    token.organizationId = dbUser.organizationId;
                    token.onboardingDone = dbUser.onboardingDone;

                    if (dbUser.role === "SYSTEM_ADMIN" || dbUser.role === "ORG_ADMIN") {
                        token.allowedTools = [...ALL_TOOLS];
                    } else {
                        const orgTools = normalizeAllowedTools(dbUser.organization?.allowedTools || [...ALL_TOOLS]);
                        const userTools = normalizeAllowedTools(dbUser.allowedTools);
                        token.allowedTools = userTools.length > 0
                            ? orgTools.filter((t: string) => userTools.includes(t))
                            : orgTools;
                    }
                }

                (token as any).userStateSyncedAt = Date.now();
            }
            return token;
        },
        async session({ session, token }) {
            if (session.user) {
                session.user.id = token.sub as string;
                (session.user as any).role = token.role;
                (session.user as any).organizationId = token.organizationId;
                (session.user as any).allowedTools = token.allowedTools;
                (session.user as any).onboardingDone = token.onboardingDone;
            }
            return session;
        },
    },
};
