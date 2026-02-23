import { readFileSync } from 'fs';

// pdf-parse is a CommonJS module
const { PDFParse } = require('pdf-parse');

export interface PdfExtractionResult {
    text: string;
    pages: number;
    info?: any;
}

/**
 * Extract text content from a PDF file
 * @param filePath - Path to the PDF file
 * @returns Extracted text and metadata
 */
export async function extractTextFromPdf(filePath: string): Promise<PdfExtractionResult> {
    let parser: any;
    try {
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
