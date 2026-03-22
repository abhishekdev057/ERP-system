import { readFileSync } from 'fs';

export interface PdfExtractionResult {
    text: string;
    pages: number;
    info?: any;
}

type PdfParseCtor = new (options: { data: Buffer }) => {
    getText: () => Promise<{ text?: string; total?: number }>;
    getInfo: () => Promise<{ info?: any }>;
    destroy: () => Promise<void>;
};

let cachedPdfParseCtor: PdfParseCtor | null = null;

async function getPdfParseCtor(): Promise<PdfParseCtor> {
    if (cachedPdfParseCtor) {
        return cachedPdfParseCtor;
    }

    const mod = await import("pdf-parse");
    const PDFParse = (mod as any).PDFParse ?? (mod as any).default?.PDFParse ?? (mod as any).default;

    if (typeof PDFParse !== "function") {
        throw new Error("pdf-parse did not expose a usable PDFParse constructor");
    }

    cachedPdfParseCtor = PDFParse as PdfParseCtor;
    return cachedPdfParseCtor;
}

/**
 * Extract text content from a PDF file
 * @param filePath - Path to the PDF file
 * @returns Extracted text and metadata
 */
export async function extractTextFromPdf(filePath: string): Promise<PdfExtractionResult> {
    let parser: any;
    try {
        const PDFParse = await getPdfParseCtor();
        const dataBuffer = readFileSync(filePath);
        parser = new PDFParse({ data: dataBuffer });
        const data = await parser.getText();
        const info = await parser.getInfo().catch(() => undefined);

        return {
            text: data.text || '',
            pages: data.total || 0,
            info: info?.info
        };
    } catch (error) {
        console.error('PDF extraction error:', error);
        throw new Error(`Failed to extract text from PDF: ${error}`);
    } finally {
        if (parser) {
            await parser.destroy().catch(() => undefined);
        }
    }
}

/**
 * Clean and normalize extracted text
 * @param text - Raw extracted text
 * @returns Cleaned text
 */
export function cleanExtractedText(text: string): string {
    return text
        .replace(/\s+/g, ' ') // Replace multiple spaces with single space
        .replace(/\n{3,}/g, '\n\n') // Replace multiple newlines with double newline
        .trim();
}
