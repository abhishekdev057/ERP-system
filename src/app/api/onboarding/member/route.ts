import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/api-auth";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
    try {
        const auth = await requireSession();

        if (auth.role === "SYSTEM_ADMIN") {
            return NextResponse.json({ error: "System admins do not have member onboarding" }, { status: 400 });
        }

        const { designation, bio, city } = await request.json();

        await prisma.user.update({
            where: { id: auth.userId },
            data: {
                designation: designation || null,
                bio: bio || null,
                location: city || null,
                onboardingDone: true,
            },
        });

        return NextResponse.json({ success: true });
    } catch (error) {
        if (error instanceof NextResponse) throw error;
        console.error("Member onboarding error:", error);
        return NextResponse.json({ error: "Failed to save profile data" }, { status: 500 });
    }
}
