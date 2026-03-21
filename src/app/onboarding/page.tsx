import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { redirect } from "next/navigation";

export default async function OnboardingRouter() {
    const session = await getServerSession(authOptions);

    if (!session?.user) {
        redirect("/auth/signin");
    }

    const role = (session.user as any).role;

    if (role === "ORG_ADMIN") {
        redirect("/onboarding/org");
    } else if (role === "MEMBER") {
        redirect("/onboarding/member");
    } else {
        // System Admin or unknown role — skip onboarding
        redirect("/");
    }
}
