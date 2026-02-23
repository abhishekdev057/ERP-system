import { NextRequest, NextResponse } from "next/server";
import { generatePdf, PdfInput } from "@/lib/pdf-generator";
import { prisma } from "@/lib/prisma";

export async function POST(request: NextRequest) {
    try {
        const body = await request.json();

        // Validate input
        if (!body.title || !body.questions || !Array.isArray(body.questions)) {
            return NextResponse.json(
                { error: "Invalid JSON format. Required: title, questions[]" },
                { status: 400 }
            );
        }

        const { shouldSave = true } = body;

        // Construct input for generator
        const pdfInput: PdfInput = {
            title: body.title,
            date: body.date || new Date().toLocaleDateString("en-GB", {
                day: "2-digit",
                month: "short",
                year: "numeric",
            }),
            instituteName: body.instituteName || "NACC AGRICULTURE INSTITUTE",
            questions: body.questions,
            templateId: body.templateId || "professional",
        };

        // Generate PDF
        const pdfBuffer = await generatePdf(pdfInput);

        // Save to database only if shouldSave is true
        let dbRecord = null;
        if (shouldSave) {
            try {
                // If documentId is provided, update the existing document
                if (body.documentId) {
                    dbRecord = await prisma.pdfDocument.update({
                        where: { id: body.documentId },
                        data: {
                            title: pdfInput.title,
                            subject: body.subject || pdfInput.title,
                            date: pdfInput.date,
                            jsonData: body,
                        },
                    });
                    console.log("Updated existing document:", dbRecord.id);
                } else {
                    // Create a hash of the questions content to check for duplicates
                    const contentHash = JSON.stringify(body.questions);

                    // First, try to find any document with the same content hash
                    const allDocs = await prisma.pdfDocument.findMany({
                        orderBy: { createdAt: 'desc' },
                    });

                    // Check if any document has the same questions content
                    let existingDoc = null;
                    for (const doc of allDocs) {
                        const existingJson = doc.jsonData as Record<string, unknown>;
                        const existingQuestions = existingJson?.questions;
                        if (existingQuestions) {
                            const existingContent = JSON.stringify(existingQuestions);
                            if (existingContent === contentHash) {
                                existingDoc = doc;
                                break;
                            }
                        }
                    }

                    if (existingDoc) {
                        // Content is identical - return existing record without creating new
                        dbRecord = existingDoc;
                        console.log("Duplicate content detected - using existing record:", existingDoc.id);
                    } else {
                        // No duplicate content found - create new document
                        dbRecord = await prisma.pdfDocument.create({
                            data: {
                                title: pdfInput.title,
                                subject: body.subject || pdfInput.title,
                                date: pdfInput.date,
                                jsonData: body,
                            },
                        });
                        console.log("Created new document:", dbRecord.id);
                    }
                }
            } catch (dbError) {
                console.error("Database save failed:", dbError);
            }
        }

        // Return PDF
        const headers = new Headers();
        const filename = `${pdfInput.date}-${pdfInput.title}.pdf`;
        // Encode filename to handle Unicode characters (Hindi/Devanagari)
        const encodedFilename = encodeURIComponent(filename);
        headers.set("Content-Type", "application/pdf");
        headers.set(
            "Content-Disposition",
            `attachment; filename*=UTF-8''${encodedFilename}`
        );
        headers.set("X-Document-Id", dbRecord?.id || "offline");

        return new NextResponse(new Uint8Array(pdfBuffer), { status: 200, headers });
    } catch (error) {
        console.error("PDF generation error:", error);
        return NextResponse.json(
            { error: "Failed to generate PDF", details: String(error) },
            { status: 500 }
        );
    }
}
