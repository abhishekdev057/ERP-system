import { NextRequest, NextResponse } from "next/server";
import { listPdfDocuments, normalizePagination } from "@/lib/services/pdf-document-service";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
    try {
        const searchParams = req.nextUrl.searchParams;
        const { limit, offset } = normalizePagination(
            searchParams.get("limit"),
            searchParams.get("offset")
        );
        const minimal = searchParams.get("minimal") === "true";

        const documents = await listPdfDocuments({
            limit,
            offset,
            minimal,
        });

        return NextResponse.json({ documents });
    } catch (error) {
        console.error("Failed to fetch documents:", error);
        return NextResponse.json(
            { documents: [], error: "Database unavailable" },
            { status: 200 }
        );
    }
}
