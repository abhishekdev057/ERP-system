import { DefaultSession, DefaultUser } from "next-auth";
import { JWT, DefaultJWT } from "next-auth/jwt";

declare module "next-auth" {
    interface Session {
        user: {
            id: string;
            role: "SYSTEM_ADMIN" | "ORG_ADMIN" | "MEMBER";
            organizationId: string | null;
            allowedTools: string[];
        } & DefaultSession["user"];
    }

    interface User extends DefaultUser {
        role: "SYSTEM_ADMIN" | "ORG_ADMIN" | "MEMBER";
        organizationId: string | null;
    }
}

declare module "next-auth/jwt" {
    interface JWT extends DefaultJWT {
        sub: string;
        role: "SYSTEM_ADMIN" | "ORG_ADMIN" | "MEMBER";
        organizationId: string | null;
        allowedTools?: string[];
    }
}
