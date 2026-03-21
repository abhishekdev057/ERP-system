import { withAuth } from "next-auth/middleware";
import { NextResponse } from "next/server";

export default withAuth(
    function middleware(req) {
        const token = req.nextauth.token;
        const path = req.nextUrl.pathname;
        const isOnboardingRoute = path.startsWith("/onboarding");
        const isOnboardingDone = token?.onboardingDone === true;
        const role = token?.role;
        const isSystemAdmin = role === "SYSTEM_ADMIN";
        const isOrgAdmin = role === "ORG_ADMIN";
        const isMember = role === "MEMBER";
        const isOrgOrMember = isOrgAdmin || isMember;
        const isIncompleteOnboarding = isOrgOrMember && !isOnboardingDone;

        // First-time ORG_ADMIN/MEMBER users are only allowed on onboarding pages.
        if (isIncompleteOnboarding && !isOnboardingRoute) {
            return NextResponse.redirect(new URL("/onboarding", req.url));
        }

        // System admins and onboarded users should not revisit onboarding.
        if (isOnboardingRoute && (isOnboardingDone || isSystemAdmin)) {
            return NextResponse.redirect(new URL("/", req.url));
        }

        // Protect admin section.
        if (path.startsWith("/admin") && !isSystemAdmin) {
            return NextResponse.redirect(new URL("/", req.url));
        }

        // Protect org management section.
        if (path.startsWith("/org") && !isOrgAdmin) {
            return NextResponse.redirect(new URL("/", req.url));
        }

        return NextResponse.next();
    },
    {
        callbacks: {
            authorized: ({ token }) => !!token,
        },
    }
);

export const config = {
    matcher: [
        "/((?!api|auth|_next/|favicon.ico|uploads).*)",
    ],
};
