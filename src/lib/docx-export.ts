import {
    Document, Packer, Paragraph, TextRun, AlignmentType,
    Table, TableRow, TableCell, WidthType, BorderStyle,
    UnderlineType, TabStopType,
} from "docx";
import { saveAs } from "file-saver";
import { PdfData } from "@/types/pdf";
import { getQuestionAnswerText, getRawQuestionAnswerValue } from "@/lib/question-utils";

// ─────────────────────────────────────────────────────────────────────────────
// Constants used throughout
// ─────────────────────────────────────────────────────────────────────────────
const BODY_FONT = "Times New Roman";
const HINDI_FONT = "Arial Unicode MS"; // Cross-platform Unicode — works on Mac, Windows, Linux
const Q_SIZE = 22; // 11pt – question text
const OPT_SIZE = 20; // 10pt – option text
const ANS_SIZE = 18; // 9pt  – answer line
const HEADING_SIZE = 28; // 14pt
const TEMPLATE_DOCX_FONT = "Noto Sans";
const TEMPLATE_DOCX_SIZE = 28; // 14pt

type BilingualOrder = "english-first" | "hindi-first";

function collapseWhitespace(value: string | undefined | null): string {
    return String(value || "").replace(/\s+/g, " ").trim();
}

function normalizeComparableText(value: string | undefined | null): string {
    return collapseWhitespace(value)
        .replace(/।/g, ".")
        .replace(/\s*([,.;:/!?()[\]{}-])\s*/g, "$1")
        .toLowerCase();
}

function isEquivalentText(first: string | undefined | null, second: string | undefined | null): boolean {
    if (!collapseWhitespace(first) || !collapseWhitespace(second)) return false;
    return normalizeComparableText(first) === normalizeComparableText(second);
}

function buildUniqueBilingual(
    english: string | undefined | null,
    hindi: string | undefined | null,
    order: BilingualOrder = "english-first"
): string[] {
    const primary = order === "english-first" ? collapseWhitespace(english) : collapseWhitespace(hindi);
    const secondary = order === "english-first" ? collapseWhitespace(hindi) : collapseWhitespace(english);
    if (!primary && !secondary) return [];
    if (!secondary) return primary ? [primary] : [];
    if (!primary) return [secondary];
    if (isEquivalentText(primary, secondary)) return [primary];
    return [primary, secondary];
}

function splitIntoNormalizedLines(
    value: string | undefined | null,
    splitInlineEnumerators = false
): string[] {
    const source = String(value || "").replace(/\r\n?/g, "\n").trim();
    if (!source) return [];

    let working = source;
    if (splitInlineEnumerators) {
        // Convert inline lettered items (a./(a)/A.) into separate lines for strict uploader parsing.
        working = working
            .replace(/\s+\(([A-Ha-h])\)\s+/g, "\n($1) ")
            .replace(/\s+([A-Ha-h])[.)]\s+/g, "\n$1. ");
    }

    return working
        .split(/\n+/)
        .map((line) => collapseWhitespace(line))
        .filter(Boolean);
}

function splitRawNormalizedLines(value: string | undefined | null): string[] {
    return String(value || "")
        .replace(/\r\n?/g, "\n")
        .split(/\n+/)
        .map((line) => collapseWhitespace(line))
        .filter(Boolean);
}

function dedupeComparableLines(lines: string[]): string[] {
    const seen = new Set<string>();
    const result: string[] = [];
    for (const raw of lines) {
        const clean = collapseWhitespace(raw);
        if (!clean) continue;
        const key = normalizeComparableText(clean);
        if (seen.has(key)) continue;
        seen.add(key);
        result.push(clean);
    }
    return result;
}

function buildUniqueBilingualLines(
    english: string | undefined | null,
    hindi: string | undefined | null,
    order: BilingualOrder = "english-first",
    splitInlineEnumerators = false
): string[] {
    const primaryRaw = order === "english-first" ? english : hindi;
    const secondaryRaw = order === "english-first" ? hindi : english;

    const primaryLines = splitIntoNormalizedLines(primaryRaw, splitInlineEnumerators);
    const secondaryLines = splitIntoNormalizedLines(secondaryRaw, splitInlineEnumerators);

    if (primaryLines.length === 0 && secondaryLines.length === 0) return [];
    if (secondaryLines.length === 0) return primaryLines;
    if (primaryLines.length === 0) return secondaryLines;

    const primaryWhole = primaryLines.join(" ");
    const secondaryWhole = secondaryLines.join(" ");
    if (isEquivalentText(primaryWhole, secondaryWhole)) {
        return primaryLines;
    }

    return dedupeComparableLines([...primaryLines, ...secondaryLines]);
}

function joinUniqueBilingual(
    english: string | undefined | null,
    hindi: string | undefined | null,
    order: BilingualOrder = "english-first",
    separator = " / "
): string {
    return buildUniqueBilingual(english, hindi, order).join(separator);
}

function getQuestionNumber(question: any, index: number): string {
    const explicit = collapseWhitespace(question?.number);
    return explicit || String(index + 1);
}

function getAnswerText(question: any): string {
    return getQuestionAnswerText(question, true);
}

function isInlineOptionLine(line: string): boolean {
    return /^(?:\([A-Ha-h]\)|[A-Ha-h][.)])\s+/.test(collapseWhitespace(line));
}

function stripInlineOptionPrefix(line: string): string {
    return collapseWhitespace(line).replace(/^(?:\([A-Ha-h]\)|[A-Ha-h][.)])\s+/, "");
}

function stripLeadingMatchLabel(line: string): string {
    return collapseWhitespace(line).replace(
        /^(?:\(\s*(?:[A-Ha-h]|[IVXLCDMivxlcdm]+|\d{1,2})\s*\)|(?:[A-Ha-h]|[IVXLCDMivxlcdm]+|\d{1,2})[.)])\s*/,
        ""
    );
}

function splitInlineMatchLine(line: string): { left: string; right: string } | null {
    const parts = collapseWhitespace(line)
        .split(/\s*\|\|\s*/)
        .map((part) => collapseWhitespace(part))
        .filter(Boolean);

    if (parts.length < 2) return null;

    if (parts.length >= 3) {
        const englishLead = stripLeadingMatchLabel(parts[0]);
        const middle = stripLeadingMatchLabel(parts[1]);
        const trailing = stripLeadingMatchLabel(parts[parts.length - 1]);

        let leftText = [englishLead, middle].filter(Boolean).join(" / ");
        if (trailing) {
            const escapedTrailing = trailing.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
            leftText = leftText.replace(new RegExp(`(?:[\\s,.;:/-]+)?${escapedTrailing}$`, "i"), "").trim();
        }

        return {
            left: collapseWhitespace(leftText),
            right: collapseWhitespace(trailing),
        };
    }

    return {
        left: stripLeadingMatchLabel(parts[0]),
        right: stripLeadingMatchLabel(parts.slice(1).join(" ")),
    };
}

function isColumnHeadingLine(line: string): boolean {
    return /^(?:column\s*[i1]+|column\s*ii|सूची\s*[-–—]?\s*[i1]+|सूची\s*[-–—]?\s*ii|list\s*[-–—]?\s*[i1]+|list\s*[-–—]?\s*ii)\s*:?$/i.test(
        collapseWhitespace(line)
    );
}

function extractInlineMatchColumns(question: any): { left: string[]; right: string[] } {
    const left: string[] = [];
    const right: string[] = [];

    const consume = (value: string | undefined | null) => {
        splitRawNormalizedLines(value).forEach((line) => {
            const pair = splitInlineMatchLine(line);
            if (!pair) return;
            if (pair.left) left.push(pair.left);
            if (pair.right) right.push(pair.right);
        });
    };

    consume(question?.questionHindi);
    consume(question?.questionEnglish);

    return {
        left: dedupeComparableLines(left),
        right: dedupeComparableLines(right),
    };
}

function extractInlineLetteredOptions(value: string | undefined | null): string[] {
    const lines = splitIntoNormalizedLines(value, true);
    return lines
        .filter((line) => isInlineOptionLine(line))
        .map((line) => stripInlineOptionPrefix(line))
        .filter(Boolean);
}

function keepComparableLines(lines: string[]): string[] {
    return lines
        .map((line) => collapseWhitespace(line))
        .filter(Boolean);
}

function getFormat2QuestionLines(question: any): string[] {
    const allLines = buildUniqueBilingualLines(
        question?.questionEnglish,
        question?.questionHindi,
        "hindi-first",
        true
    );

    const stemLines = allLines.filter(
        (line) => !isInlineOptionLine(line) && !splitInlineMatchLine(line) && !isColumnHeadingLine(line)
    );
    return dedupeComparableLines(stemLines);
}

function getFormat3OptionLines(question: any): string[] {
    const explicitOptions = Array.isArray(question?.options) ? question.options : [];
    const explicitLines = keepComparableLines(
        explicitOptions
            .map((option: any) => joinUniqueBilingual(option?.english, option?.hindi, "english-first"))
            .map((line: string) => stripInlineOptionPrefix(line))
            .map((line: string) => collapseWhitespace(line))
            .filter(Boolean)
    );

    if (explicitLines.length > 0) return explicitLines;

    return keepComparableLines([
        ...extractInlineLetteredOptions(question?.questionEnglish),
        ...extractInlineLetteredOptions(question?.questionHindi),
    ]);
}

function getFormat2OptionLines(question: any): string[] {
    const explicitOptions = Array.isArray(question?.options) ? question.options : [];
    const explicitLines = keepComparableLines(
        explicitOptions
            .map((option: any) => joinUniqueBilingual(option?.english, option?.hindi, "hindi-first"))
            .map((line: string) => stripInlineOptionPrefix(line))
            .map((line: string) => collapseWhitespace(line))
            .filter(Boolean)
    );

    if (explicitLines.length > 0) return explicitLines;

    return keepComparableLines([
        ...extractInlineLetteredOptions(question?.questionHindi),
        ...extractInlineLetteredOptions(question?.questionEnglish),
    ]);
}

function getFormat2MatchColumnLines(question: any): { left: string[]; right: string[] } {
    const left = Array.isArray(question?.matchColumns?.left)
        ? question.matchColumns.left
            .map((entry: any) => joinUniqueBilingual(entry?.english, entry?.hindi, "hindi-first"))
            .map((line: string) => stripLeadingMatchLabel(line))
            .map((line: string) => collapseWhitespace(line))
            .filter(Boolean)
        : [];

    const right = Array.isArray(question?.matchColumns?.right)
        ? question.matchColumns.right
            .map((entry: any) => joinUniqueBilingual(entry?.english, entry?.hindi, "hindi-first"))
            .map((line: string) => stripLeadingMatchLabel(line))
            .map((line: string) => collapseWhitespace(line))
            .filter(Boolean)
        : [];

    if (left.length > 0 || right.length > 0) {
        return { left: dedupeComparableLines(left), right: dedupeComparableLines(right) };
    }

    return extractInlineMatchColumns(question);
}

function getFormat3MatchColumnLines(question: any): { left: string[]; right: string[] } {
    const left = Array.isArray(question?.matchColumns?.left)
        ? question.matchColumns.left
            .map((entry: any) => joinUniqueBilingual(entry?.english, entry?.hindi, "english-first"))
            .map((line: string) => stripLeadingMatchLabel(line))
            .map((line: string) => collapseWhitespace(line))
            .filter(Boolean)
        : [];

    const right = Array.isArray(question?.matchColumns?.right)
        ? question.matchColumns.right
            .map((entry: any) => joinUniqueBilingual(entry?.english, entry?.hindi, "english-first"))
            .map((line: string) => stripLeadingMatchLabel(line))
            .map((line: string) => collapseWhitespace(line))
            .filter(Boolean)
        : [];

    if (left.length > 0 || right.length > 0) {
        return { left: dedupeComparableLines(left), right: dedupeComparableLines(right) };
    }

    return extractInlineMatchColumns(question);
}

function indexToLowerLetter(index: number): string {
    const n = index + 1;
    if (!Number.isFinite(n) || n <= 0) return "";
    // 1->a, 2->b ... 26->z, 27->aa
    let value = n;
    let label = "";
    while (value > 0) {
        const rem = (value - 1) % 26;
        label = String.fromCharCode(97 + rem) + label;
        value = Math.floor((value - 1) / 26);
    }
    return label;
}

function indexToUpperLetter(index: number): string {
    return indexToLowerLetter(index).toUpperCase();
}

function getLetterAnswerForFormat2(question: any, optionLines: string[]): string {
    const raw = getRawQuestionAnswerValue(question);
    if (!raw) return "";

    const clean = collapseWhitespace(raw).replace(/[()]/g, "");
    const normalizeLetter = (indexOneBased: number): string => {
        if (!Number.isFinite(indexOneBased) || indexOneBased <= 0 || indexOneBased > 26) return "";
        return indexToLowerLetter(indexOneBased - 1);
    };

    if (/^\d+$/.test(clean)) {
        const parsed = Number.parseInt(clean, 10);
        if (parsed === 0) return normalizeLetter(1);
        const normalized = normalizeLetter(parsed);
        if (normalized) return normalized;
    }

    if (/^[A-Za-z][.)]?$/.test(clean)) {
        return clean.charAt(0).toLowerCase();
    }

    if (/^(?:ans(?:wer)?|option)\s*\d+$/i.test(clean)) {
        const parsed = Number.parseInt(clean.replace(/\D+/g, ""), 10);
        const normalized = normalizeLetter(parsed);
        if (normalized) return normalized;
    }

    if (/^(?:ans(?:wer)?|option)\s*[A-Za-z][.)]?$/i.test(clean)) {
        return clean.replace(/^(?:ans(?:wer)?|option)\s*/i, "").charAt(0).toLowerCase();
    }

    const normalizedAnswerText = normalizeComparableText(clean);
    const matchedIndex = optionLines.findIndex(
        (optionText) => normalizeComparableText(optionText) === normalizedAnswerText
    );
    if (matchedIndex >= 0) return indexToLowerLetter(matchedIndex);

    return collapseWhitespace(raw).toLowerCase();
}

function getNumericAnswerForFormat3(question: any, optionLines: string[]): string {
    const raw = getRawQuestionAnswerValue(question);
    if (!raw) return "";

    const clean = collapseWhitespace(raw).replace(/[()]/g, "");
    const optionCount = optionLines.length;

    const normalizeNumeric = (num: number): string => {
        if (!Number.isFinite(num) || num < 1) return "";
        if (optionCount === 0) return String(num);
        if (num <= optionCount) return String(num);
        return "";
    };

    if (/^\d+$/.test(clean)) {
        const parsed = Number.parseInt(clean, 10);
        if (parsed === 0 && optionCount > 0) return "1";
        return normalizeNumeric(parsed);
    }

    if (/^[A-Za-z][.)]?$/.test(clean)) {
        const letter = clean.charAt(0).toUpperCase();
        return normalizeNumeric(letter.charCodeAt(0) - 64);
    }

    if (/^(?:ans(?:wer)?|option)\s*\d+$/i.test(clean)) {
        const parsed = Number.parseInt(clean.replace(/\D+/g, ""), 10);
        return normalizeNumeric(parsed);
    }

    if (/^(?:ans(?:wer)?|option)\s*[A-Za-z][.)]?$/i.test(clean)) {
        const letter = clean.replace(/^(?:ans(?:wer)?|option)\s*/i, "").charAt(0).toUpperCase();
        return normalizeNumeric(letter.charCodeAt(0) - 64);
    }

    const normalizedAnswerText = normalizeComparableText(clean);
    const matchedIndex = optionLines.findIndex(
        (optionText) => normalizeComparableText(optionText) === normalizedAnswerText
    );
    if (matchedIndex >= 0) return String(matchedIndex + 1);

    return "";
}

function getSolutionLines(question: any): string[] {
    const solutionEnglish = question?.solutionEnglish;
    const solutionHindi = question?.solutionHindi;
    const bilingualSolution = buildUniqueBilingual(solutionEnglish, solutionHindi, "english-first");
    if (bilingualSolution.length > 0) return bilingualSolution;

    const solution = String(question?.solution || "");
    if (collapseWhitespace(solution)) {
        return solution
            .split(/\r?\n+/)
            .map((line: string) => collapseWhitespace(line))
            .filter(Boolean);
    }

    const explanation = String(question?.explanation || "");
    if (collapseWhitespace(explanation)) {
        return explanation
            .split(/\r?\n+/)
            .map((line: string) => collapseWhitespace(line))
            .filter(Boolean);
    }

    return [];
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers for Format 4 (exam paper)
// ─────────────────────────────────────────────────────────────────────────────

/** Thin horizontal rule */
function hrLine(): Paragraph {
    return new Paragraph({
        text: "",
        spacing: { before: 80, after: 80 },
        border: { bottom: { color: "999999", space: 1, style: BorderStyle.SINGLE, size: 2 } },
    });
}

/**
 * A section heading with shaded background:
 *   █ MCQ – Multiple Choice Questions
 */
function sectionHeading(text: string): Paragraph {
    return new Paragraph({
        children: [
            new TextRun({ text, bold: true, size: HEADING_SIZE, font: BODY_FONT }),
        ],
        alignment: AlignmentType.CENTER,
        spacing: { before: 200, after: 100 },
        shading: { fill: "EEEEEE" },
    });
}

/**
 * Question stem, combining Q number + Hindi + English.
 * Hindi is in italic; English is in italic too (matching sample style).
 */
function questionStem(num: string, hindi: string, english: string): Paragraph {
    const parts = buildUniqueBilingual(english, hindi, "hindi-first");
    const runs: TextRun[] = [];

    // Bold number + period
    runs.push(new TextRun({ text: `${num}. `, bold: true, size: Q_SIZE, font: BODY_FONT }));

    parts.forEach((text, index) => {
        const isLast = index === parts.length - 1;
        runs.push(
            new TextRun({
                text: text + (isLast ? "" : " / "),
                italics: true,
                size: Q_SIZE,
                font: BODY_FONT,
            })
        );
    });

    if (parts.length === 0) {
        runs.push(new TextRun({ text: "", italics: true, size: Q_SIZE, font: HINDI_FONT }));
    }

    return new Paragraph({
        children: runs,
        spacing: { before: 160, after: 40 },
    });
}

/**
 * MCQ options on ONE LINE: A) opt   B) opt   C) opt   D) opt
 * Uses tab stops so options are evenly aligned across the page.
 */
function mcqOptionsRow(options: { hindi?: string; english?: string }[]): Paragraph[] {
    // Build up to 4 options per line, each at quarter-page tab stops
    // Tab positions (in twips, 1 inch = 1440 twips, page = ~8640 twips usable)
    // We'll do 4 cols: 0, 2160, 4320, 6480
    const TAB = [2000, 4000, 6000]; // 3 tab stops after first item

    const labels = ["A", "B", "C", "D", "E", "F", "G", "H"];

    // Build runs for a single row of up to 4 options
    function rowRuns(opts: typeof options, startIdx: number): TextRun[] {
        const runs: TextRun[] = [];
        opts.forEach((opt, i) => {
            if (i > 0) runs.push(new TextRun({ text: "\t", size: OPT_SIZE }));
            const label = labels[startIdx + i];
            const text = joinUniqueBilingual(opt.english, opt.hindi, "hindi-first");
            runs.push(new TextRun({ text: `${label}) `, bold: true, size: OPT_SIZE, font: BODY_FONT }));
            runs.push(new TextRun({ text, size: OPT_SIZE, font: BODY_FONT }));
        });
        return runs;
    }

    const COLS = 4;
    const paragraphs: Paragraph[] = [];

    for (let r = 0; r < options.length; r += COLS) {
        const chunk = options.slice(r, r + COLS);
        const tabStops = TAB.slice(0, chunk.length - 1).map((pos, i) => ({
            type: TabStopType.LEFT,
            position: pos,
        }));

        paragraphs.push(
            new Paragraph({
                children: rowRuns(chunk, r),
                tabStops,
                indent: { left: 0 },
                spacing: { after: 40 },
            })
        );
    }

    return paragraphs;
}

/** Inline answer displayed right after the question */
function inlineAnswer(ans: string, sol?: string): Paragraph {
    return new Paragraph({
        children: [
            new TextRun({ text: "Ans: ", bold: true, size: ANS_SIZE, color: "1A6E1A", font: BODY_FONT }),
            new TextRun({ text: ans, size: ANS_SIZE, color: "1A6E1A", font: BODY_FONT }),
            ...(sol ? [
                new TextRun({ text: "   Sol: ", bold: true, size: ANS_SIZE, color: "555555", font: BODY_FONT }),
                new TextRun({ text: sol, size: ANS_SIZE, color: "555555", font: BODY_FONT }),
            ] : []),
        ],
        spacing: { before: 30, after: 80 },
        indent: { left: 0 },
    });
}

/** Assertion & Reason block */
function assertionBlock(opts: { hindi?: string; english?: string }[]): Paragraph[] {
    const paras: Paragraph[] = [];
    const labels = ["Statement (I)", "Statement (II)", "Statement (III)", "Statement (IV)"];
    opts.slice(0, 4).forEach((opt, i) => {
        const text = joinUniqueBilingual(opt.english, opt.hindi, "hindi-first");
        paras.push(new Paragraph({
            children: [
                new TextRun({ text: `${labels[i]}: `, bold: true, underline: { type: UnderlineType.SINGLE }, size: OPT_SIZE, font: BODY_FONT }),
                new TextRun({ text, size: OPT_SIZE, font: BODY_FONT }),
            ],
            spacing: { after: 40 },
            indent: { left: 360 },
        }));
    });
    return paras;
}

/** Match the Column table */
function matchTable(left: any[], right: any[]): Table {
    const maxRows = Math.max(left.length, right.length);
    const rows = [];

    // Header row
    rows.push(new TableRow({
        children: [
            new TableCell({
                children: [new Paragraph({ children: [new TextRun({ text: "Column A", bold: true, size: OPT_SIZE, font: BODY_FONT })] })],
                shading: { fill: "E8EAF6" },
                margins: { top: 80, bottom: 80, left: 160, right: 160 },
                width: { size: 50, type: WidthType.PERCENTAGE },
            }),
            new TableCell({
                children: [new Paragraph({ children: [new TextRun({ text: "Column B", bold: true, size: OPT_SIZE, font: BODY_FONT })] })],
                shading: { fill: "E8EAF6" },
                margins: { top: 80, bottom: 80, left: 160, right: 160 },
                width: { size: 50, type: WidthType.PERCENTAGE },
            }),
        ],
    }));

    for (let i = 0; i < maxRows; i++) {
        const lLabel = String.fromCharCode(65 + i); // A, B, C...
        const rLabel = `${i + 1}`;
        const lText = left[i] ? joinUniqueBilingual(left[i].english, left[i].hindi, "hindi-first") : "";
        const rText = right[i] ? joinUniqueBilingual(right[i].english, right[i].hindi, "hindi-first") : "";

        rows.push(new TableRow({
            children: [
                new TableCell({
                    children: [new Paragraph({
                        children: [
                            new TextRun({ text: `${lLabel}. `, bold: true, size: OPT_SIZE, font: BODY_FONT }),
                            new TextRun({ text: lText, size: OPT_SIZE, font: BODY_FONT }),
                        ]
                    })],
                    margins: { top: 60, bottom: 60, left: 160, right: 160 },
                    width: { size: 50, type: WidthType.PERCENTAGE },
                }),
                new TableCell({
                    children: [new Paragraph({
                        children: [
                            new TextRun({ text: `${rLabel}. `, bold: true, size: OPT_SIZE, font: BODY_FONT }),
                            new TextRun({ text: rText, size: OPT_SIZE, font: BODY_FONT }),
                        ]
                    })],
                    margins: { top: 60, bottom: 60, left: 160, right: 160 },
                    width: { size: 50, type: WidthType.PERCENTAGE },
                }),
            ],
        }));
    }

    return new Table({
        rows,
        width: { size: 100, type: WidthType.PERCENTAGE },
        columnWidths: [4700, 4700], // ~50% each in twips (approx 3.25" each)
        margins: { bottom: 100 },
        borders: {
            top: { style: BorderStyle.SINGLE, size: 1, color: "AAAAAA" },
            bottom: { style: BorderStyle.SINGLE, size: 1, color: "AAAAAA" },
            left: { style: BorderStyle.SINGLE, size: 1, color: "AAAAAA" },
            right: { style: BorderStyle.SINGLE, size: 1, color: "AAAAAA" },
            insideHorizontal: { style: BorderStyle.DOTTED, size: 1, color: "CCCCCC" },
            insideVertical: { style: BorderStyle.DOTTED, size: 1, color: "CCCCCC" },
        }
    });
}

function createInvisibleBorder() {
    return { style: BorderStyle.NONE, size: 0, color: "FFFFFF" };
}

function format2MatchColumnsTable(left: string[], right: string[]): Table {
    const maxRows = Math.max(left.length, right.length, 1);
    const rows: TableRow[] = [];
    const noBorder = createInvisibleBorder();

    rows.push(new TableRow({
        children: [
            new TableCell({
                children: [
                    new Paragraph({
                        children: [new TextRun({ text: "Column I:", bold: true, size: OPT_SIZE, font: BODY_FONT })],
                        spacing: { after: 10 },
                    }),
                ],
                margins: { top: 40, bottom: 40, left: 40, right: 180 },
                width: { size: 50, type: WidthType.PERCENTAGE },
            }),
            new TableCell({
                children: [
                    new Paragraph({
                        children: [new TextRun({ text: "Column II:", bold: true, size: OPT_SIZE, font: BODY_FONT })],
                        spacing: { after: 10 },
                    }),
                ],
                margins: { top: 40, bottom: 40, left: 180, right: 40 },
                width: { size: 50, type: WidthType.PERCENTAGE },
            }),
        ],
    }));

    for (let i = 0; i < maxRows; i++) {
        const leftText = left[i] ? `(${indexToUpperLetter(i)}) ${left[i]}` : "";
        const rightText = right[i] ? `(${i + 1}) ${right[i]}` : "";

        rows.push(new TableRow({
            children: [
                new TableCell({
                    children: [
                        new Paragraph({
                            children: [new TextRun({ text: leftText, size: OPT_SIZE, font: BODY_FONT })],
                            spacing: { after: 0 },
                        }),
                    ],
                    margins: { top: 25, bottom: 25, left: 40, right: 180 },
                    width: { size: 50, type: WidthType.PERCENTAGE },
                }),
                new TableCell({
                    children: [
                        new Paragraph({
                            children: [new TextRun({ text: rightText, size: OPT_SIZE, font: BODY_FONT })],
                            spacing: { after: 0 },
                        }),
                    ],
                    margins: { top: 25, bottom: 25, left: 180, right: 40 },
                    width: { size: 50, type: WidthType.PERCENTAGE },
                }),
            ],
        }));
    }

    return new Table({
        rows,
        width: { size: 100, type: WidthType.PERCENTAGE },
        columnWidths: [4700, 4700],
        borders: {
            top: noBorder,
            bottom: noBorder,
            left: noBorder,
            right: noBorder,
            insideHorizontal: noBorder,
            insideVertical: noBorder,
        },
        margins: { bottom: 80 },
    });
}

function format2MatchColumnsParagraphs(left: string[], right: string[]): Paragraph[] {
    const paragraphs: Paragraph[] = [];

    if (left.length > 0) {
        paragraphs.push(
            new Paragraph({
                children: [new TextRun({ text: "Column I:", bold: true, size: OPT_SIZE, font: BODY_FONT })],
                spacing: { before: 10, after: 20 },
            })
        );

        left.forEach((line, index) => {
            paragraphs.push(
                new Paragraph({
                    children: [new TextRun({ text: `(${indexToUpperLetter(index)}) ${line}`, size: OPT_SIZE, font: BODY_FONT })],
                    spacing: { after: 15 },
                })
            );
        });
    }

    if (right.length > 0) {
        paragraphs.push(
            new Paragraph({
                children: [new TextRun({ text: "Column II:", bold: true, size: OPT_SIZE, font: BODY_FONT })],
                spacing: { before: 25, after: 20 },
            })
        );

        right.forEach((line, index) => {
            paragraphs.push(
                new Paragraph({
                    children: [new TextRun({ text: `(${index + 1}) ${line}`, size: OPT_SIZE, font: BODY_FONT })],
                    spacing: { after: 15 },
                })
            );
        });
    }

    return paragraphs;
}

// ─────────────────────────────────────────────────────────────────────────────
// Main exporter
// ─────────────────────────────────────────────────────────────────────────────

export async function exportToDocx(data: PdfData, format: "1" | "2" | "3" | "4" = "1") {
    const children: any[] = [];

    // ── Title block ──────────────────────────────────────────────────────────
    if (format === "1" || format === "4") {
        if (data.instituteName) {
            children.push(new Paragraph({
                children: [new TextRun({ text: data.instituteName, bold: true, size: 36, font: BODY_FONT })],
                alignment: AlignmentType.CENTER,
                spacing: { after: 80 },
            }));
        }
        children.push(new Paragraph({
            children: [new TextRun({ text: data.title || "", bold: true, size: 28, font: BODY_FONT })],
            alignment: AlignmentType.CENTER,
            spacing: { after: 60 },
        }));
        if (data.subject || data.date) {
            children.push(new Paragraph({
                children: [
                    new TextRun({ text: [data.subject, data.date ? `Date: ${data.date}` : ""].filter(Boolean).join("   |   "), size: 18, color: "555555", font: BODY_FONT })
                ],
                alignment: AlignmentType.CENTER,
                spacing: { after: 160 },
            }));
        }
        children.push(hrLine());
    }

    // ─────────────────────────────────────────────────────────────────────────
    if (format === "1") {
        // FORMAT 1: TABLE LAYOUT
        const rows = [];
        rows.push(new TableRow({
            children: ["#", "Question", "Type", "Options", "Answer", "Marks"].map(h =>
                new TableCell({
                    children: [new Paragraph({ children: [new TextRun({ text: h, bold: true, size: 18, font: BODY_FONT })] })],
                    shading: { fill: "D8DCF8" },
                    margins: { top: 60, bottom: 60, left: 80, right: 80 }
                })
            )
        }));

        data.questions.forEach((q, idx) => {
            const qNum = getQuestionNumber(q, idx);
            const qText = joinUniqueBilingual(q.questionEnglish, q.questionHindi, "hindi-first");
            const optText = (q.options || [])
                .map((o, i) => `${String.fromCharCode(65 + i)}) ${joinUniqueBilingual(o.english, o.hindi, "hindi-first")}`)
                .join("\n");
            const ans = getAnswerText(q);
            const posM = (q as any).positiveMarks || ""; const negM = (q as any).negativeMarks || "";

            rows.push(new TableRow({
                children: [
                    new TableCell({ children: [new Paragraph({ text: qNum })], margins: { top: 60, bottom: 60, left: 80, right: 80 } }),
                    new TableCell({ children: qText.split("\n").map(t => new Paragraph({ text: t, spacing: { after: 0 } })), margins: { top: 60, bottom: 60, left: 80, right: 80 } }),
                    new TableCell({ children: [new Paragraph({ text: q.questionType || "" })], margins: { top: 60, bottom: 60, left: 80, right: 80 } }),
                    new TableCell({ children: optText.split("\n").map(t => new Paragraph({ text: t, spacing: { after: 0 } })), margins: { top: 60, bottom: 60, left: 80, right: 80 } }),
                    new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: ans, color: "1A6E1A", bold: true })] })], margins: { top: 60, bottom: 60, left: 80, right: 80 } }),
                    new TableCell({ children: [new Paragraph({ text: posM || negM ? `+${posM} / -${negM}` : "" })], margins: { top: 60, bottom: 60, left: 80, right: 80 } }),
                ]
            }));
        });

        children.push(new Table({ rows, width: { size: 100, type: WidthType.PERCENTAGE }, borders: { top: { style: BorderStyle.SINGLE, size: 1, color: "AAAAAA" }, bottom: { style: BorderStyle.SINGLE, size: 1, color: "AAAAAA" }, left: { style: BorderStyle.SINGLE, size: 1, color: "AAAAAA" }, right: { style: BorderStyle.SINGLE, size: 1, color: "AAAAAA" }, insideHorizontal: { style: BorderStyle.SINGLE, size: 1, color: "DDDDDD" }, insideVertical: { style: BorderStyle.SINGLE, size: 1, color: "DDDDDD" } } }));

    } else if (format === "2") {
        // FORMAT 2: "Question/Options/Answer/Solution/Marks" flow (question-2.docx style)
        data.questions.forEach((q, idx) => {
            const questionLines = getFormat2QuestionLines(q);
            const primaryQuestionLine = questionLines[0] || "";
            const secondaryQuestionLines = questionLines.slice(1);

            children.push(new Paragraph({
                children: [
                    new TextRun({ text: "Question: ", bold: false, size: Q_SIZE, font: BODY_FONT }),
                    new TextRun({ text: primaryQuestionLine, size: Q_SIZE, font: BODY_FONT }),
                ],
                spacing: { before: idx === 0 ? 80 : 180, after: 40 },
            }));

            secondaryQuestionLines.forEach((line) => {
                children.push(new Paragraph({
                    children: [new TextRun({ text: line, size: Q_SIZE, font: BODY_FONT })],
                    spacing: { after: 30 },
                }));
            });

            const matchColumnLines = getFormat2MatchColumnLines(q);
            const hasMatchColumns = matchColumnLines.left.length > 0 || matchColumnLines.right.length > 0;
            if (hasMatchColumns) {
                children.push(...format2MatchColumnsParagraphs(matchColumnLines.left, matchColumnLines.right));
                children.push(new Paragraph({
                    children: [new TextRun({ text: "", size: OPT_SIZE, font: BODY_FONT })],
                    spacing: { after: 15 },
                }));
            }

            const optionLines = getFormat2OptionLines(q);
            optionLines.forEach((optionText, optionIndex) => {
                const optionLabel = indexToLowerLetter(optionIndex);
                children.push(new Paragraph({
                    children: [new TextRun({ text: `(${optionLabel}) ${optionText}`, size: OPT_SIZE, font: BODY_FONT })],
                    spacing: { after: 25 },
                }));
            });

            const answerLetter = getLetterAnswerForFormat2(q, optionLines);
            children.push(new Paragraph({
                children: [
                    new TextRun({ text: "Answer: ", size: OPT_SIZE, font: BODY_FONT }),
                    new TextRun({ text: answerLetter, size: OPT_SIZE, font: BODY_FONT }),
                ],
                spacing: { before: 20, after: 30 },
            }));

            const solutionLines = getSolutionLines(q);
            const firstSolutionLine = solutionLines[0] || "";
            children.push(new Paragraph({
                children: [
                    new TextRun({ text: "Solution: ", size: OPT_SIZE, font: BODY_FONT }),
                    new TextRun({ text: firstSolutionLine, size: OPT_SIZE, font: BODY_FONT }),
                ],
                spacing: { after: 25 },
            }));

            solutionLines.slice(1).forEach((line) => {
                children.push(new Paragraph({
                    children: [new TextRun({ text: line, size: OPT_SIZE, font: BODY_FONT })],
                    spacing: { after: 20 },
                }));
            });

            const positiveMarks = collapseWhitespace((q as any)?.positiveMarks) || "1";
            const negativeMarks = collapseWhitespace((q as any)?.negativeMarks) || "0";

            children.push(new Paragraph({
                children: [new TextRun({ text: `Positive Marks: ${positiveMarks}`, size: OPT_SIZE, font: BODY_FONT })],
                spacing: { after: 25 },
            }));

            children.push(new Paragraph({
                children: [new TextRun({ text: `Negative Marks: ${negativeMarks}`, size: OPT_SIZE, font: BODY_FONT })],
                spacing: { after: 80 },
            }));

            children.push(new Paragraph({
                children: [new TextRun({ text: "", size: OPT_SIZE, font: BODY_FONT })],
                spacing: { after: 140 },
            }));
        });

    } else if (format === "3") {
        // FORMAT 3: BULK-UPLOADER TEMPLATE (matches question_format_2.docx)
        data.questions.forEach((q, idx) => {
            const qNum = getQuestionNumber(q, idx);
            const questionLines = buildUniqueBilingualLines(
                q.questionEnglish,
                q.questionHindi,
                "english-first",
                true
            );
            const primaryQuestionLine = questionLines[0] || "";

            children.push(new Paragraph({
                children: [
                    new TextRun({ text: `${qNum}. `, bold: true, size: TEMPLATE_DOCX_SIZE, font: TEMPLATE_DOCX_FONT }),
                    new TextRun({ text: primaryQuestionLine, size: TEMPLATE_DOCX_SIZE, font: TEMPLATE_DOCX_FONT }),
                ],
                spacing: { before: idx === 0 ? 0 : 140, after: 80 },
            }));

            questionLines.slice(1).forEach((line) => {
                children.push(new Paragraph({
                    children: [new TextRun({ text: line, size: TEMPLATE_DOCX_SIZE, font: TEMPLATE_DOCX_FONT })],
                    spacing: { after: 100 },
                }));
            });

            const format3MatchColumns = getFormat3MatchColumnLines(q);
            const hasFormat3MatchColumns =
                format3MatchColumns.left.length > 0 || format3MatchColumns.right.length > 0;
            if (hasFormat3MatchColumns) {
                children.push(new Paragraph({
                    children: [new TextRun({ text: "Column I:", bold: true, size: TEMPLATE_DOCX_SIZE, font: TEMPLATE_DOCX_FONT })],
                    spacing: { before: 20, after: 60 },
                }));

                format3MatchColumns.left.forEach((line, lineIndex) => {
                    children.push(new Paragraph({
                        children: [new TextRun({ text: `(${indexToUpperLetter(lineIndex)}) ${line}`, size: TEMPLATE_DOCX_SIZE, font: TEMPLATE_DOCX_FONT })],
                        spacing: { after: 45 },
                    }));
                });

                children.push(new Paragraph({
                    children: [new TextRun({ text: "Column II:", bold: true, size: TEMPLATE_DOCX_SIZE, font: TEMPLATE_DOCX_FONT })],
                    spacing: { before: 40, after: 60 },
                }));

                format3MatchColumns.right.forEach((line, lineIndex) => {
                    children.push(new Paragraph({
                        children: [new TextRun({ text: `(${lineIndex + 1}) ${line}`, size: TEMPLATE_DOCX_SIZE, font: TEMPLATE_DOCX_FONT })],
                        spacing: { after: 45 },
                    }));
                });
            }

            const format3Options = getFormat3OptionLines(q);
            format3Options.forEach((optionText, i) => {
                if (!optionText) return;
                children.push(new Paragraph({
                    children: [new TextRun({ text: `${i + 1}. ${optionText}`, size: TEMPLATE_DOCX_SIZE, font: TEMPLATE_DOCX_FONT })],
                    spacing: { after: 60 },
                }));
            });

            const ans = getNumericAnswerForFormat3(q, format3Options);
            children.push(new Paragraph({
                children: [new TextRun({ text: ans ? `Answer ${ans}` : "Answer", size: TEMPLATE_DOCX_SIZE, font: TEMPLATE_DOCX_FONT })],
                spacing: { before: 20, after: 60 },
            }));

            children.push(new Paragraph({
                children: [new TextRun({ text: "Solution.", size: TEMPLATE_DOCX_SIZE, font: TEMPLATE_DOCX_FONT })],
                spacing: { after: 60 },
            }));

            const solutionLines = getSolutionLines(q);
            solutionLines.forEach((line) => {
                const bulletLine = /^(?:[-*•o])\s+/.test(line) ? line : `• ${line}`;
                children.push(new Paragraph({
                    children: [new TextRun({ text: bulletLine, size: TEMPLATE_DOCX_SIZE, font: TEMPLATE_DOCX_FONT })],
                    spacing: { after: 40 },
                }));
            });

            children.push(new Paragraph({
                children: [new TextRun({ text: "", size: TEMPLATE_DOCX_SIZE, font: TEMPLATE_DOCX_FONT })],
                spacing: { after: 120 },
            }));
        });

    } else if (format === "4") {
        // ──────────────────────────────────────────────────────────────────────
        // FORMAT 4: PAGEMAKER-STYLE EXAM PAPER
        //
        // Layout (matching the sample image exactly):
        //   1. [N]. [Question italic text]
        //   A) opt1      B) opt2      C) opt3      D) opt4
        //   Ans: X   Sol: ...
        // ──────────────────────────────────────────────────────────────────────

        const TYPE_LABELS: Record<string, string> = {
            MCQ: "Multiple Choice Questions",
            TRUE_FALSE: "True / False",
            ASSERTION_REASON: "Assertion & Reason",
            MATCH_COLUMN: "Match the Column",
            FIB: "Fill in the Blanks",
            NUMERICAL: "Numerical",
            LONG_ANSWER: "Long Answer",
        };

        let currentType: string | null = null;

        data.questions.forEach((q, idx) => {
            const qNum = getQuestionNumber(q, idx);
            const qType = q.questionType || "MCQ";
            const ans = getAnswerText(q);
            const sol = getSolutionLines(q).join(" ");

            // ── Section heading on type change ─────────────────────────────
            if (qType !== currentType) {
                if (currentType !== null) children.push(hrLine());
                currentType = qType;
                children.push(sectionHeading(TYPE_LABELS[qType] || qType));
            }

            // ── Question stem ──────────────────────────────────────────────
            children.push(questionStem(qNum, q.questionHindi || "", q.questionEnglish || ""));

            // ── Type-specific body ─────────────────────────────────────────
            if (qType === "MCQ" || qType === "TRUE_FALSE") {
                // All options on ONE row (or two rows of 4 if more than 4)
                children.push(...mcqOptionsRow(q.options || []));

            } else if (qType === "ASSERTION_REASON") {
                // Show statement blocks then options below
                children.push(...assertionBlock(q.options || []));
                // If there are more than 2 options, show them as MCQ choices
                const choices = (q.options || []).slice(2);
                if (choices.length > 0) {
                    children.push(new Paragraph({ text: "Choose correct option:", spacing: { before: 40, after: 20 } }));
                    children.push(...mcqOptionsRow(choices));
                }

            } else if (qType === "MATCH_COLUMN" && q.matchColumns) {
                children.push(matchTable(q.matchColumns.left || [], q.matchColumns.right || []));
                // If options are available for match type
                if ((q.options || []).length > 0) {
                    children.push(new Paragraph({ text: "Codes:", spacing: { before: 60, after: 20 } }));
                    children.push(...mcqOptionsRow(q.options || []));
                }

            } else if (qType === "FIB") {
                // Blank answer line
                children.push(new Paragraph({
                    children: [new TextRun({ text: "Fill: __________________________________________________", size: OPT_SIZE, font: BODY_FONT })],
                    spacing: { before: 40, after: 80 },
                    indent: { left: 0 },
                }));

            } else if (qType === "NUMERICAL") {
                children.push(new Paragraph({
                    children: [new TextRun({ text: "Answer: ________", size: OPT_SIZE, font: BODY_FONT })],
                    spacing: { before: 40, after: 80 },
                }));

            } else if (qType === "LONG_ANSWER") {
                for (let i = 0; i < 4; i++) {
                    children.push(new Paragraph({
                        children: [new TextRun({ text: "____________________________________________________________", size: 16, color: "BBBBBB" })],
                        spacing: { after: 40 },
                    }));
                }
            }

            // ── Inline answer (right after question / options) ────────────
            if (ans || sol) {
                children.push(inlineAnswer(ans, sol || undefined));
            }
        });
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Assemble Document
    // ─────────────────────────────────────────────────────────────────────────
    const doc = new Document({
        creator: "Nexora by Sigma Fusion",
        title: data.title || "Exported Document",
        description: data.subject || "Questions",
        styles: {
            default: {
                document: {
                    run: {
                        font: format === "3" ? TEMPLATE_DOCX_FONT : BODY_FONT,
                        size: format === "3" ? TEMPLATE_DOCX_SIZE : 22,
                    },
                    paragraph: { spacing: { line: format === "3" ? 278 : 240 } },
                },
            },
        },
        sections: [
            {
                properties: {
                    page: {
                        // A4 size
                        size: { width: 11906, height: 16838 },
                        margin: format === "3"
                            ? { top: 1440, bottom: 1440, left: 1440, right: 1440 }
                            : { top: 1080, bottom: 1080, left: 1260, right: 1260 },
                    },
                },
                children,
            },
        ],
    });

    const blob = await Packer.toBlob(doc);
    saveAs(blob, `${(data.title || "exam-paper").replace(/[\\/:*?"<>|]+/g, "-")}.docx`);
}
