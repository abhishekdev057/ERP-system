import fs from "fs";
import fsp from "fs/promises";
import os from "os";
import path from "path";
import { PDF_TEMPLATES, PdfTemplateConfig, resolvePdfTemplate } from "@/lib/pdf-templates";
import {
    MatchColumnEntry,
    OptionDisplayOrder,
    PdfInput,
    Question,
    QuestionType,
} from "@/types/pdf";
import { getQuestionAnswerText } from "@/lib/question-utils";
import { launchServerBrowser } from "@/lib/server-browser";

export type TemplateConfig = PdfTemplateConfig;

type PageSpec = {
    cssPageSize: string;
    sheetWidth: string;
    sheetHeight: string;
    pdfWidth: string;
    pdfHeight: string;
    viewportWidth: number;
    viewportHeight: number;
};

type EmbeddedAssets = {
    fontBase64: string;
    logoDataUri: string;
    backgroundDataUri: string;
    simpleBackgroundDataUri: string;
    boardBackgroundDataUri: string;
};

type StatementPair = {
    label?: string;
    hindi: string;
    english: string;
};

type ParsedTable = {
    header: string[];
    rows: string[][];
};

type StructuredQuestionArtifacts = {
    sanitizedHindi: string;
    sanitizedEnglish: string;
    statementPairs: StatementPair[];
    structureKind: "statements" | "reference-list" | null;
    markdownTable: ParsedTable | null;
};

type QuestionTextMetrics = {
    size: number;
    lineBreaks: number;
    lineUnits: number;
};

type OptionTextMetrics = {
    count: number;
    size: number;
    lineBreaks: number;
    lineUnits: number;
    longestLength: number;
    longestUnits: number;
};

type MatchColumnMetrics = {
    itemCount: number;
    lineUnits: number;
    longestUnits: number;
};

type LayoutQuestionType =
    | "MCQ"
    | "FIB"
    | "MATCH_COLUMN"
    | "TRUE_FALSE"
    | "ASSERTION_REASON"
    | "NUMERICAL"
    | "SHORT_ANSWER"
    | "LONG_ANSWER"
    | "UNKNOWN";

let cachedAssets: EmbeddedAssets | null = null;

function resolvePageSpec(resolution: PdfInput["previewResolution"]): PageSpec {
    if (resolution === "1920x1080") {
        return {
            cssPageSize: "1920px 1080px",
            sheetWidth: "1920px",
            sheetHeight: "1080px",
            pdfWidth: "1920px",
            pdfHeight: "1080px",
            viewportWidth: 1920,
            viewportHeight: 1080,
        };
    }

    return {
        cssPageSize: "A4 landscape",
        sheetWidth: "297mm",
        sheetHeight: "210mm",
        pdfWidth: "297mm",
        pdfHeight: "210mm",
        viewportWidth: 1600,
        viewportHeight: 900,
    };
}

function getFileBase64(filePath: string): string {
    if (!fs.existsSync(filePath)) return "";
    return fs.readFileSync(filePath).toString("base64");
}

function getImageMimeType(filePath: string): string {
    const ext = path.extname(filePath).toLowerCase();
    switch (ext) {
        case ".png":
            return "image/png";
        case ".jpg":
        case ".jpeg":
            return "image/jpeg";
        case ".webp":
            return "image/webp";
        case ".gif":
            return "image/gif";
        case ".svg":
            return "image/svg+xml";
        default:
            return "application/octet-stream";
    }
}

function getFileDataUri(filePath: string): string {
    if (!fs.existsSync(filePath)) return "";
    return `data:${getImageMimeType(filePath)};base64,${fs.readFileSync(filePath).toString("base64")}`;
}

function loadEmbeddedAssets(): EmbeddedAssets {
    if (cachedAssets) return cachedAssets;

    const fontPath = path.join(process.cwd(), "public", "fonts", "NotoSansDevanagari-Regular.ttf");
    const logoPath = path.join(process.cwd(), "public", "nexora-logo.png");
    const backgroundPath = path.join(process.cwd(), "public", "background.png");
    const simpleBackgroundPath = path.join(process.cwd(), "public", "simple-background.png");
    const boardBackgroundPath = path.join(process.cwd(), "public", "board-background.png");

    const fontBase64 = getFileBase64(fontPath);

    cachedAssets = {
        fontBase64,
        logoDataUri: getFileDataUri(logoPath),
        backgroundDataUri: getFileDataUri(backgroundPath),
        simpleBackgroundDataUri: getFileDataUri(simpleBackgroundPath),
        boardBackgroundDataUri: getFileDataUri(boardBackgroundPath),
    };

    return cachedAssets;
}

function escapeHtml(value: string | undefined | null): string {
    if (!value) return "";
    return value
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/\"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

const CHEMICAL_ELEMENT_SYMBOLS = new Set([
    "H", "He", "Li", "Be", "B", "C", "N", "O", "F", "Ne",
    "Na", "Mg", "Al", "Si", "P", "S", "Cl", "Ar", "K", "Ca",
    "Sc", "Ti", "V", "Cr", "Mn", "Fe", "Co", "Ni", "Cu", "Zn",
    "Ga", "Ge", "As", "Se", "Br", "Kr", "Rb", "Sr", "Y", "Zr",
    "Nb", "Mo", "Tc", "Ru", "Rh", "Pd", "Ag", "Cd", "In", "Sn",
    "Sb", "Te", "I", "Xe", "Cs", "Ba", "La", "Ce", "Pr", "Nd",
    "Pm", "Sm", "Eu", "Gd", "Tb", "Dy", "Ho", "Er", "Tm", "Yb",
    "Lu", "Hf", "Ta", "W", "Re", "Os", "Ir", "Pt", "Au", "Hg",
    "Tl", "Pb", "Bi", "Po", "At", "Rn", "Fr", "Ra", "Ac", "Th",
    "Pa", "U", "Np", "Pu", "Am", "Cm", "Bk", "Cf", "Es", "Fm",
    "Md", "No", "Lr", "Rf", "Db", "Sg", "Bh", "Hs", "Mt", "Ds",
    "Rg", "Cn", "Nh", "Fl", "Mc", "Lv", "Ts", "Og",
]);

function extractChemicalElementSymbols(token: string): string[] {
    return token.match(/[A-Z][a-z]?/g) || [];
}

function isChemicalTokenCandidate(token: string): boolean {
    if (!/[0-9]/.test(token) && !/[+-]$/.test(token)) {
        return false;
    }

    const elementSymbols = extractChemicalElementSymbols(token);
    if (elementSymbols.length === 0) {
        return false;
    }

    return elementSymbols.every((symbol) => CHEMICAL_ELEMENT_SYMBOLS.has(symbol));
}

function formatChemicalTokenHtml(token: string): string {
    if (!isChemicalTokenCandidate(token)) {
        return escapeHtml(token);
    }

    let body = token;
    let charge = "";
    const signMatch = body.match(/([+-])$/);

    if (signMatch) {
        const sign = signMatch[1];
        body = body.slice(0, -1);
        const trailingDigits = body.match(/(\d+)$/)?.[1] || "";
        const coreBeforeDigits = trailingDigits ? body.slice(0, -trailingDigits.length) : body;
        const elementGroupCount = extractChemicalElementSymbols(coreBeforeDigits).length;
        const endsWithGroup = coreBeforeDigits.endsWith(")");

        if (trailingDigits) {
            if (endsWithGroup || elementGroupCount <= 1) {
                body = coreBeforeDigits;
                charge = `${trailingDigits}${sign}`;
            } else if (trailingDigits.length > 1) {
                body = `${coreBeforeDigits}${trailingDigits.slice(0, -1)}`;
                charge = `${trailingDigits.slice(-1)}${sign}`;
            } else {
                charge = sign;
                body = `${coreBeforeDigits}${trailingDigits}`;
            }
        } else {
            charge = sign;
        }
    }

    const formattedBody = escapeHtml(body).replace(/([A-Za-z)\]])(\d+)/g, "$1<sub>$2</sub>");
    return `${formattedBody}${charge ? `<sup>${escapeHtml(charge)}</sup>` : ""}`;
}

function inlineHtml(value: string | undefined | null): string {
    if (!value) return "";
    const raw = String(value);
    const tokenPattern = /[A-Z][A-Za-z0-9()]*\d[A-Za-z0-9()]*[+-]?|[A-Z][A-Za-z0-9()]*[+-]/g;
    let cursor = 0;
    let html = "";

    let match: RegExpExecArray | null;
    while ((match = tokenPattern.exec(raw)) !== null) {
        const index = match.index;
        const token = match[0];
        html += escapeHtml(raw.slice(cursor, index));
        html += formatChemicalTokenHtml(token);
        cursor = index + token.length;
    }

    html += escapeHtml(raw.slice(cursor));
    return html;
}

function multilineHtml(value: string | undefined | null): string {
    if (!value) return "";
    return inlineHtml(value).replace(/\n/g, "<br />");
}

function normalizeDisplayText(value: string | undefined | null): string {
    return String(value || "")
        .replace(/\r\n?/g, "\n")
        .replace(/\n{3,}/g, "\n\n");
}

function collapseWhitespace(value: string | undefined | null): string {
    return String(value || "").replace(/\s+/g, " ").trim();
}

function normalizeTextBlock(value: string | undefined | null): string {
    return String(value || "")
        .replace(/\r\n?/g, "\n")
        .replace(/[^\S\n]+/g, " ")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
}

function countDevanagariCharacters(value: string): number {
    return (value.match(/[\u0900-\u097F]/g) || []).length;
}

function countLatinCharacters(value: string): number {
    return (value.match(/[A-Za-z]/g) || []).length;
}

function inferDominantLanguage(
    line: string
): "hindi" | "english" | "neutral" {
    const devanagariCount = countDevanagariCharacters(line);
    const latinCount = countLatinCharacters(line);

    if (devanagariCount >= 2 && devanagariCount >= latinCount) {
        return "hindi";
    }

    if (latinCount >= 2 && latinCount > devanagariCount) {
        return "english";
    }

    return "neutral";
}

function dedupeComparableLines(lines: string[]): string[] {
    const seen = new Set<string>();
    const result: string[] = [];

    for (const line of lines) {
        const comparable = normalizeComparableText(line);
        if (!comparable || seen.has(comparable)) continue;
        seen.add(comparable);
        result.push(line);
    }

    return result;
}

function rebalanceBilingualBlocks(
    english: string | undefined | null,
    hindi: string | undefined | null
): { english: string; hindi: string } {
    const englishLines = splitTextLines(english);
    const hindiLines = splitTextLines(hindi);

    const hasCrossLanguageLines =
        englishLines.some((line) => inferDominantLanguage(line) === "hindi") ||
        hindiLines.some((line) => inferDominantLanguage(line) === "english");

    if (!hasCrossLanguageLines) {
        return {
            english: normalizeTextBlock(english),
            hindi: normalizeTextBlock(hindi),
        };
    }

    const nextHindi: string[] = [];
    const nextEnglish: string[] = [];

    const consume = (lines: string[], source: "english" | "hindi") => {
        for (const line of lines) {
            const dominantLanguage = inferDominantLanguage(line);
            if (dominantLanguage === "hindi") {
                nextHindi.push(line);
                continue;
            }
            if (dominantLanguage === "english") {
                nextEnglish.push(line);
                continue;
            }
            if (source === "hindi") {
                nextHindi.push(line);
            } else {
                nextEnglish.push(line);
            }
        }
    };

    consume(hindiLines, "hindi");
    consume(englishLines, "english");

    return {
        hindi: dedupeComparableLines(nextHindi).join("\n").trim(),
        english: dedupeComparableLines(nextEnglish).join("\n").trim(),
    };
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

function uniqueBilingualLines(
    english: string | undefined | null,
    hindi: string | undefined | null,
    order: OptionDisplayOrder = "english-first"
): string[] {
    const repaired = rebalanceBilingualBlocks(english, hindi);
    const primary =
        order === "english-first"
            ? collapseWhitespace(repaired.english)
            : collapseWhitespace(repaired.hindi);
    const secondary =
        order === "english-first"
            ? collapseWhitespace(repaired.hindi)
            : collapseWhitespace(repaired.english);
    if (!primary && !secondary) return [];
    if (!secondary) return primary ? [primary] : [];
    if (!primary) return [secondary];
    if (isEquivalentText(primary, secondary)) return [primary];
    return [primary, secondary];
}

function uniqueBilingualBlocks(
    english: string | undefined | null,
    hindi: string | undefined | null,
    order: OptionDisplayOrder = "english-first"
): string[] {
    const repaired = rebalanceBilingualBlocks(english, hindi);
    const primary =
        order === "english-first"
            ? normalizeTextBlock(repaired.english)
            : normalizeTextBlock(repaired.hindi);
    const secondary =
        order === "english-first"
            ? normalizeTextBlock(repaired.hindi)
            : normalizeTextBlock(repaired.english);
    if (!primary && !secondary) return [];
    if (!secondary) return primary ? [primary] : [];
    if (!primary) return [secondary];
    if (isEquivalentText(primary, secondary)) return [primary];
    return [primary, secondary];
}

function splitTextLines(value: string | undefined | null): string[] {
    return normalizeTextBlock(value)
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean);
}

function getStructuredMarkerPattern() {
    return /(\(\s*(?:[A-Za-z]|[IVXLCDMivxlcdm]+|\d{1,2}|[\u0966-\u096F]{1,2})\s*\)|(?:[A-Za-z]|[IVXLCDMivxlcdm]+|\d{1,2}|[\u0966-\u096F]{1,2})[.)])\s+\S+/g;
}

function splitStructuredInlineSegments(value: string | undefined | null): string[] {
    const lines = splitTextLines(value);
    const result: string[] = [];

    for (const line of lines) {
        const markerPattern = getStructuredMarkerPattern();
        const matches = Array.from(line.matchAll(markerPattern));
        const firstMarkerIndex = matches[0]?.index ?? -1;

        if (matches.length <= 1 && firstMarkerIndex <= 0) {
            result.push(line);
            continue;
        }

        if (firstMarkerIndex > 0) {
            const prefix = line.slice(0, firstMarkerIndex).trim();
            if (prefix) result.push(prefix);
        }

        matches.forEach((match, index) => {
            const start = match.index ?? 0;
            const end = index + 1 < matches.length ? (matches[index + 1].index ?? line.length) : line.length;
            const segment = line.slice(start, end).trim();
            if (segment) result.push(segment);
        });
    }

    return result;
}

function extractStructuredLineLabel(line: string): string | null {
    const trimmed = line.trim();
    const match = trimmed.match(/^(\(\s*(?:[A-Za-z]|[IVXLCDMivxlcdm]+|\d{1,2}|[\u0966-\u096F]{1,2})\s*\)|(?:[A-Za-z]|[IVXLCDMivxlcdm]+|\d{1,2}|[\u0966-\u096F]{1,2})[.)])/);
    if (!match) return null;
    return match[1].replace(/[().]/g, "").trim();
}

function stripStructuredLineLabel(line: string): string {
    return line
        .replace(/^(\(\s*(?:[A-Za-z]|[IVXLCDMivxlcdm]+|\d{1,2}|[\u0966-\u096F]{1,2})\s*\)|(?:[A-Za-z]|[IVXLCDMivxlcdm]+|\d{1,2}|[\u0966-\u096F]{1,2})[.)])\s*/, "")
        .trim();
}

function isStatementPromptLine(line: string): boolean {
    return /^(?:कथन|अभिकथन|Assertion|Reason|Statement)\s*[-:–—]?\s*[A-Za-z0-9IVX]*/i.test(line.trim());
}

function isStructuredStatementLine(line: string): boolean {
    return isStatementPromptLine(line) || isStructuredListLine(line);
}

function isMarkdownTableLine(line: string): boolean {
    return /\|/.test(line) && line.split("|").filter((part) => part.trim()).length >= 2;
}

function isMarkdownSeparatorRow(cells: string[]): boolean {
    return cells.every((cell) => /^:?-{2,}:?$/.test(cell.trim()));
}

function isColumnStructureMarker(line: string): boolean {
    return /^(?:match columns?|column\s*[- ]?[ivx]+|column\s+[ivx]+|स्तम्भ|स्तंभ|स्तम्भ\s*[ivx]+|स्तंभ\s*[ivx]+)/i.test(
        line.trim()
    );
}

function isStructuredListLine(line: string): boolean {
    const trimmed = line.trim();
    if (!trimmed) return false;

    return [
        /^\(\s*(?:[A-Za-z]|[IVXLCDMivxlcdm]+|\d{1,2}|[\u0966-\u096F]{1,2})\s*\)\s+\S+/i,
        /^(?:[A-Za-z]|[IVXLCDMivxlcdm]+|\d{1,2}|[\u0966-\u096F]{1,2})\s*[.)\-:]\s+\S+/i,
        /^(?:column|col\.?|स्तम्भ|स्तंभ)\s*(?:[-: ]?\s*(?:[A-Za-z]|[IVXLCDMivxlcdm]+|\d{1,2}|[\u0966-\u096F]{1,2}))?\s*[:.)-]?\s+\S+/i,
        /^(?:[+\-*•●◦▪])\s+\S+/,
    ].some((pattern) => pattern.test(trimmed));
}

function parseMarkdownTable(text: string | undefined | null): ParsedTable | null {
    const lines = splitTextLines(text).filter((line) => isMarkdownTableLine(line));
    if (lines.length < 2) return null;

    const rows = lines
        .map((line) =>
            line
                .split("|")
                .map((cell) => collapseWhitespace(cell))
                .filter(Boolean)
        )
        .filter((cells) => cells.length >= 2)
        .filter((cells) => !isMarkdownSeparatorRow(cells));

    if (rows.length < 2) return null;

    return {
        header: rows[0],
        rows: rows.slice(1),
    };
}

function pickBestMarkdownTable(question: Question): ParsedTable | null {
    const hindiTable = parseMarkdownTable(question.questionHindi);
    const englishTable = parseMarkdownTable(question.questionEnglish);

    if (!hindiTable) return englishTable;
    if (!englishTable) return hindiTable;

    const hindiScore = hindiTable.header.length + hindiTable.rows.length * 2;
    const englishScore = englishTable.header.length + englishTable.rows.length * 2;
    return hindiScore >= englishScore ? hindiTable : englishTable;
}

function extractStatementPairs(question: Question): StatementPair[] {
    const hindiLines = splitStructuredInlineSegments(question.questionHindi).filter(isStructuredStatementLine);
    const englishLines = splitStructuredInlineSegments(question.questionEnglish).filter(isStructuredStatementLine);
    const pairCount = Math.max(hindiLines.length, englishLines.length);

    if (pairCount < 2) return [];

    return Array.from({ length: pairCount }, (_, index) => ({
        label:
            extractStructuredLineLabel(hindiLines[index] || "") ||
            extractStructuredLineLabel(englishLines[index] || "") ||
            undefined,
        hindi: stripStructuredLineLabel(hindiLines[index] || ""),
        english: stripStructuredLineLabel(englishLines[index] || ""),
    })).filter((pair) => pair.hindi || pair.english);
}

function hasStatementTerminology(question: Question): boolean {
    const lines = [
        ...splitStructuredInlineSegments(question.questionHindi),
        ...splitStructuredInlineSegments(question.questionEnglish),
    ];

    return lines.some((line) =>
        /^(?:कथन|अभिकथन|Assertion|Reason|Statement)\b/i.test(line.trim())
    );
}

function normalizeStructuredLabel(label: string | undefined | null): string {
    return String(label || "")
        .replace(/[().\s]/g, "")
        .trim()
        .toUpperCase();
}

function escapeRegex(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function optionTextsReferenceStructuredLabels(question: Question, pairs: StatementPair[]): boolean {
    const labels = Array.from(
        new Set(
            pairs
                .map((pair) => normalizeStructuredLabel(pair.label))
                .filter((label) => /^[A-Z]$|^[IVXLCDM]+$|^\d{1,2}$/.test(label))
        )
    );

    if (labels.length === 0) return false;

    const optionCorpus = (question.options || [])
        .flatMap((option) => [option.hindi, option.english])
        .join(" ")
        .toUpperCase();

    return labels.some((label) => {
        const matcher = new RegExp(`(^|[^A-Z0-9])${escapeRegex(label)}($|[^A-Z0-9])`, "i");
        return matcher.test(optionCorpus);
    });
}

function looksLikeEnumeratedReferenceList(question: Question, pairs: StatementPair[]): boolean {
    if (pairs.length < 3) return false;

    const normalizedLabels = pairs
        .map((pair) => normalizeStructuredLabel(pair.label))
        .filter(Boolean);

    const simpleSequenceLabelCount = normalizedLabels.filter((label) =>
        /^[A-Z]$|^[IVXLCDM]+$|^\d{1,2}$/.test(label)
    ).length;
    const mostlySimpleLabels =
        simpleSequenceLabelCount >= Math.max(2, Math.ceil(normalizedLabels.length * 0.6));

    if (!mostlySimpleLabels) return false;

    if (optionTextsReferenceStructuredLabels(question, pairs)) {
        return true;
    }

    return !hasStatementTerminology(question);
}

function detectStructureKind(
    question: Question,
    pairs: StatementPair[]
): StructuredQuestionArtifacts["structureKind"] {
    if (pairs.length === 0) {
        return null;
    }

    if (looksLikeEnumeratedReferenceList(question, pairs)) {
        return "reference-list";
    }

    if (question.questionType === "ASSERTION_REASON" || hasStatementTerminology(question)) {
        return "statements";
    }

    return "reference-list";
}

function sanitizeQuestionText(
    text: string | undefined | null,
    options?: {
        stripStatements?: boolean;
        stopAtStructuredBlock?: boolean;
    }
): string {
    const lines = splitStructuredInlineSegments(text);
    const kept: string[] = [];
    let encounteredStructuredBlock = false;

    for (const line of lines) {
        if (options?.stripStatements && isStructuredStatementLine(line)) {
            continue;
        }

        const startsStructuredBlock =
            isMarkdownTableLine(line) ||
            isColumnStructureMarker(line) ||
            (options?.stopAtStructuredBlock && isStructuredListLine(line));

        if (startsStructuredBlock) {
            encounteredStructuredBlock = true;
            continue;
        }

        if (encounteredStructuredBlock) {
            continue;
        }

        kept.push(line);
    }

    return kept.join("\n").trim();
}

function deriveStructuredQuestionArtifacts(question: Question): StructuredQuestionArtifacts {
    const repairedQuestionBlocks = rebalanceBilingualBlocks(
        question.questionEnglish,
        question.questionHindi
    );
    const hasMatchColumns =
        question.questionType === "MATCH_COLUMN" &&
        Boolean(question.matchColumns?.left.length && question.matchColumns?.right.length);
    const statementPairs =
        question.questionType === "ASSERTION_REASON" || hasStructuredPrompt(question)
            ? extractStatementPairs(question)
            : [];
    const structureKind = detectStructureKind(question, statementPairs);
    const markdownTable = pickBestMarkdownTable(question);
    const stopAtStructuredBlock = hasMatchColumns || Boolean(markdownTable);

    return {
        sanitizedHindi: sanitizeQuestionText(repairedQuestionBlocks.hindi, {
            stripStatements: statementPairs.length > 0,
            stopAtStructuredBlock,
        }),
        sanitizedEnglish: sanitizeQuestionText(repairedQuestionBlocks.english, {
            stripStatements: statementPairs.length > 0,
            stopAtStructuredBlock,
        }),
        statementPairs,
        structureKind,
        markdownTable,
    };
}

function isStructuredPromptLine(line: string): boolean {
    return /^(?:\(?[A-H]\)|[A-H][.)]|[1-9][.)]|कथन\s*[-:IVX0-9]+|Statement\s*[-:IVX0-9]+|Assertion\b|Reason\b)/i.test(
        line.trim()
    );
}

function isInstructionPromptLine(line: string): boolean {
    return /^(?:नीचे दिए गए|नीचे दिये गए|सही उत्तर|सही विकल्प|उक्त कथनों|Choose|Select|Read the following|Which of the above)/i.test(
        line.trim()
    );
}

function hasStructuredPrompt(question: Question): boolean {
    const lines = [
        ...splitTextLines(question.questionHindi),
        ...splitTextLines(question.questionEnglish),
    ];
    return lines.some((line) => isStructuredPromptLine(line) || isInstructionPromptLine(line));
}

function countStructuredQuestionLines(question: Question): number {
    const lines = [
        ...splitTextLines(question.questionHindi),
        ...splitTextLines(question.questionEnglish),
    ];
    return lines.filter((line) => isStructuredPromptLine(line)).length;
}

function countLineBreaks(value: string | undefined | null): number {
    const normalized = normalizeTextBlock(value);
    return normalized ? (normalized.match(/\n/g) || []).length : 0;
}

function isRenderableQuestion(question: Question): boolean {
    return Boolean(
        normalizeTextBlock(question.questionHindi) ||
        normalizeTextBlock(question.questionEnglish) ||
        question.diagramImagePath ||
        question.autoDiagramImagePath ||
        question.matchColumns?.left.length ||
        question.matchColumns?.right.length ||
        (question.options || []).some((option) => collapseWhitespace(option.english) || collapseWhitespace(option.hindi))
    );
}

function hasRenderableMatchColumns(question: Question): boolean {
    return Boolean(
        question.matchColumns &&
        question.matchColumns.left.length > 0 &&
        question.matchColumns.right.length > 0
    );
}

function resolveLayoutQuestionType(
    question: Question,
    artifacts?: StructuredQuestionArtifacts
): LayoutQuestionType {
    if (question.questionType === "MATCH_COLUMN" && !hasRenderableMatchColumns(question)) {
        return (question.options || []).length > 0 ? "MCQ" : "MATCH_COLUMN";
    }

    if (artifacts?.statementPairs && artifacts.statementPairs.length > 0) {
        return "MCQ";
    }

    return (question.questionType || "UNKNOWN") as LayoutQuestionType;
}

function estimateLineUnits(
    value: string | undefined | null,
    devanagariCharsPerLine: number,
    latinCharsPerLine: number
): number {
    const lines = splitTextLines(value);
    if (lines.length === 0) return 0;

    return lines.reduce((total, line) => {
        const collapsed = collapseWhitespace(line);
        if (!collapsed) return total;

        const devanagariCount = countDevanagariCharacters(collapsed);
        const latinCount = countLatinCharacters(collapsed);
        const otherCount = Math.max(0, collapsed.length - devanagariCount - latinCount);

        const devanagariUnits = devanagariCount / Math.max(1, devanagariCharsPerLine);
        const latinUnits = latinCount / Math.max(1, latinCharsPerLine);
        const otherUnits = otherCount / Math.max(1, Math.round((devanagariCharsPerLine + latinCharsPerLine) / 2));
        return total + Math.max(1, Math.ceil(devanagariUnits + latinUnits + otherUnits));
    }, 0);
}

function clampNumber(value: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, value));
}

function getQuestionTextMetrics(question: Question): QuestionTextMetrics {
    return {
        size:
            collapseWhitespace(question.questionHindi).length +
            collapseWhitespace(question.questionEnglish).length,
        lineBreaks:
            countLineBreaks(question.questionHindi) +
            countLineBreaks(question.questionEnglish),
        lineUnits:
            estimateLineUnits(question.questionHindi, 15, 20) +
            estimateLineUnits(question.questionEnglish, 20, 26),
    };
}

function getOptionTextMetrics(question: Question): OptionTextMetrics {
    const options = question.options || [];

    return options.reduce<OptionTextMetrics>(
        (metrics, option) => {
            const optionSize =
                collapseWhitespace(option.hindi).length +
                collapseWhitespace(option.english).length;
            const longestLength = Math.max(
                collapseWhitespace(option.hindi).length,
                collapseWhitespace(option.english).length
            );
            const optionUnits =
                estimateLineUnits(option.hindi, 14, 18) +
                estimateLineUnits(option.english, 18, 24);

            return {
                count: metrics.count + 1,
                size: metrics.size + optionSize,
                lineBreaks:
                    metrics.lineBreaks +
                    countLineBreaks(option.hindi) +
                    countLineBreaks(option.english),
                lineUnits: metrics.lineUnits + optionUnits,
                longestLength: Math.max(metrics.longestLength, longestLength),
                longestUnits: Math.max(metrics.longestUnits, optionUnits),
            };
        },
        {
            count: 0,
            size: 0,
            lineBreaks: 0,
            lineUnits: 0,
            longestLength: 0,
            longestUnits: 0,
        }
    );
}

function getMatchColumnMetrics(question: Question): MatchColumnMetrics {
    const entries = [...(question.matchColumns?.left || []), ...(question.matchColumns?.right || [])];

    return entries.reduce<MatchColumnMetrics>(
        (metrics, entry) => {
            const entryUnits =
                estimateLineUnits(entry.hindi, 16, 20) +
                estimateLineUnits(entry.english, 20, 24);

            return {
                itemCount: metrics.itemCount + 1,
                lineUnits: metrics.lineUnits + entryUnits,
                longestUnits: Math.max(metrics.longestUnits, entryUnits),
            };
        },
        {
            itemCount: 0,
            lineUnits: 0,
            longestUnits: 0,
        }
    );
}

function isOptionHeavySlide(
    question: Question,
    layoutQuestionType: LayoutQuestionType = (question.questionType || "UNKNOWN") as LayoutQuestionType
): boolean {
    const optionMetrics = getOptionTextMetrics(question);
    if (optionMetrics.count === 0) return false;
    const questionMetrics = getQuestionTextMetrics(question);

    return (
        optionMetrics.size > Math.max(240, questionMetrics.size * 1.12) ||
        optionMetrics.lineBreaks >= 2 ||
        optionMetrics.longestLength >= 64 ||
        optionMetrics.lineUnits >= 11 ||
        optionMetrics.longestUnits >= 4 ||
        optionMetrics.count >= 5 ||
        (layoutQuestionType === "ASSERTION_REASON" && optionMetrics.lineUnits >= 9) ||
        (optionMetrics.count >= 4 &&
            (optionMetrics.size > Math.max(280, questionMetrics.size * 1.15) ||
                optionMetrics.longestLength >= 58 ||
                optionMetrics.lineUnits >= 10 ||
                optionMetrics.longestUnits >= 4))
    );
}

function isQuestionHeavySlide(
    question: Question,
    artifacts?: StructuredQuestionArtifacts
): boolean {
    const questionMetrics = getQuestionTextMetrics(question);
    const hasStatements = Boolean(artifacts?.statementPairs && artifacts.statementPairs.length > 0);

    return (
        questionMetrics.size > 170 ||
        questionMetrics.lineBreaks >= 2 ||
        questionMetrics.lineUnits >= 9 ||
        hasStatements
    );
}

function isListHeavySlide(question: Question): boolean {
    return countStructuredQuestionLines(question) >= 3;
}

function normalizeSlideDensity(
    question: Question,
    hasDiagram: boolean,
    resolution: PdfInput["previewResolution"],
    layoutQuestionType: LayoutQuestionType = (question.questionType || "UNKNOWN") as LayoutQuestionType,
    artifacts?: StructuredQuestionArtifacts
): "normal" | "dense" | "compact" {
    const questionMetrics = getQuestionTextMetrics(question);
    const optionMetrics = getOptionTextMetrics(question);
    const statementCount = artifacts?.statementPairs.length || 0;
    const referenceListCount = artifacts?.structureKind === "reference-list" ? statementCount : 0;
    const matchColumnsSize =
        (question.matchColumns?.left.length || 0) * 80 +
        (question.matchColumns?.right.length || 0) * 80;
    const structureWeight =
        layoutQuestionType === "MATCH_COLUMN"
            ? 210
            : layoutQuestionType === "FIB"
                ? 90
                : layoutQuestionType === "ASSERTION_REASON"
                    ? 140
                : layoutQuestionType === "LONG_ANSWER"
                    ? 120
                    : 0;
    const lineBreakWeight = questionMetrics.lineBreaks * 70 + optionMetrics.lineBreaks * 28;
    const structuredPromptWeight = hasStructuredPrompt(question) ? 170 : 0;

    const total =
        questionMetrics.size +
        optionMetrics.size +
        matchColumnsSize +
        structureWeight +
        structuredPromptWeight +
        lineBreakWeight +
        questionMetrics.lineUnits * 22 +
        optionMetrics.lineUnits * 20 +
        (hasDiagram ? 280 : 0);

    if (resolution === "1920x1080") {
        if (
            total > 640 ||
            question.options.length >= 6 ||
            questionMetrics.lineBreaks >= 4 ||
            statementCount >= 4 ||
            referenceListCount >= 4 ||
            (statementCount >= 3 && questionMetrics.lineUnits >= 9) ||
            (referenceListCount >= 3 && questionMetrics.lineUnits >= 7) ||
            (hasStructuredPrompt(question) && total > 460) ||
            (isOptionHeavySlide(question, layoutQuestionType) && total > 460) ||
            optionMetrics.lineUnits >= 13 ||
            optionMetrics.longestUnits >= 6 ||
            (question.options.length >= 4 && optionMetrics.lineUnits >= 11) ||
            questionMetrics.lineUnits >= 12
        ) {
            return "compact";
        }
        if (
            total > 420 ||
            question.options.length >= 5 ||
            hasDiagram ||
            questionMetrics.lineBreaks >= 2 ||
            hasStructuredPrompt(question) ||
            referenceListCount >= 3 ||
            isQuestionHeavySlide(question, artifacts) ||
            isOptionHeavySlide(question, layoutQuestionType) ||
            optionMetrics.lineUnits >= 8 ||
            optionMetrics.longestUnits >= 4 ||
            questionMetrics.lineUnits >= 8
        ) {
            return "dense";
        }
        return "normal";
    }

    if (total > 950 || question.options.length >= 8) return "compact";
    if (total > 620 || question.options.length >= 6 || hasDiagram) return "dense";
    return "normal";
}

function imageMimeType(imagePath: string): string {
    const extension = path.extname(imagePath).toLowerCase();
    if (extension === ".jpg" || extension === ".jpeg") return "image/jpeg";
    if (extension === ".webp") return "image/webp";
    if (extension === ".gif") return "image/gif";
    return "image/png";
}

function resolvePublicImagePathToLocalUri(
    imagePath: string | undefined,
    cache: Map<string, string>
): string | undefined {
    if (!imagePath) return undefined;
    if (imagePath.startsWith("data:image/")) return imagePath;
    if (imagePath.startsWith("file://")) return imagePath;
    if (!imagePath.startsWith("/uploads/") || imagePath.includes("..")) return undefined;

    if (cache.has(imagePath)) {
        return cache.get(imagePath);
    }

    const absolutePath = path.join(process.cwd(), "public", imagePath.replace(/^\/+/, ""));
    if (!fs.existsSync(absolutePath)) return undefined;

    const fileUri = `file://${absolutePath}`;
    cache.set(imagePath, fileUri);
    return fileUri;
}

function renderOption(
    option: Question["options"][number],
    index: number,
    optionDisplayOrder: OptionDisplayOrder
): string {
    const primaryRaw = optionDisplayOrder === "english-first" ? option.english : option.hindi;
    const secondaryRaw = optionDisplayOrder === "english-first" ? option.hindi : option.english;
    const primary = normalizeDisplayText(primaryRaw);
    const secondary = normalizeDisplayText(secondaryRaw);
    const lines = isEquivalentText(primary, secondary)
        ? [primary || secondary]
        : [primary, secondary].filter((value) => collapseWhitespace(value).length > 0);
    const first = stripLeadingOptionLabel(lines[0] || "");
    const second = stripLeadingOptionLabel(lines[1] || "");
    const firstClass = optionDisplayOrder === "english-first" ? "option-english" : "option-hindi";
    const secondClass = optionDisplayOrder === "english-first" ? "option-hindi" : "option-english";
    const optionNumber = `(${index + 1})`;

    return `
        <article class="option-card">
            <div class="option-head">${escapeHtml(optionNumber)}</div>
            <div class="option-line">
                <span class="option-number">${escapeHtml(optionNumber)}</span>
                <div class="option-content">
                    <div class="${firstClass}">${multilineHtml(first)}</div>
                    ${second ? `<div class="${secondClass}">${multilineHtml(second)}</div>` : ""}
                </div>
            </div>
        </article>
    `;
}

function stripLeadingOptionLabel(value: string): string {
    const trimmed = value.trimStart();
    return trimmed
        .replace(
            /^(?:\(?\s*(?:[0-9]{1,2}|[A-Ha-h])\s*\)|(?:[0-9]{1,2}|[A-Ha-h])[.)]|Option\s*\d+\s*[:.-]?|विकल्प\s*\d+\s*[:.-]?)\s*/i,
            ""
        )
        .trimStart();
}

function isOptionQuestionType(questionType: QuestionType | undefined): boolean {
    return (
        questionType === "MCQ" ||
        questionType === "TRUE_FALSE" ||
        questionType === "ASSERTION_REASON" ||
        questionType === "MATCH_COLUMN"
    );
}

function getQuestionTypeLabel(questionType: QuestionType | undefined): string {
    switch (questionType) {
        case "MCQ":
            return "MCQ";
        case "FIB":
            return "Fill in the Blank";
        case "MATCH_COLUMN":
            return "Match the Column";
        case "TRUE_FALSE":
            return "True/False";
        case "ASSERTION_REASON":
            return "Assertion Reason";
        case "NUMERICAL":
            return "Numerical";
        case "LONG_ANSWER":
            return "Long Answer";
        case "SHORT_ANSWER":
            return "Short Answer";
        default:
            return "Question";
    }
}

function renderMatchColumnItems(items: MatchColumnEntry[]): string {
    return items
        .map(
            (item, index) => {
                const lines = uniqueBilingualLines(item.english, item.hindi, "hindi-first");
                const first = lines[0] || "";
                const second = lines[1] || "";
                return `
            <div class="match-row">
                <span class="match-row-id">${index + 1}</span>
                <div class="match-row-body">
                    ${first ? `<div class="match-row-hindi">${multilineHtml(first)}</div>` : ""}
                    ${second ? `<div class="match-row-english">${multilineHtml(second)}</div>` : ""}
                </div>
            </div>
        `;
            }
        )
        .join("");
}

function renderStatementPairs(pairs: StatementPair[]): string {
    return pairs
        .map((pair, index) => {
            const label = pair.label || String(index + 1);
            return `
                <div class="statement-row">
                    <div class="statement-label">${escapeHtml(label)}</div>
                    <div class="statement-body">
                        ${pair.hindi ? `<div class="statement-hindi">${multilineHtml(pair.hindi)}</div>` : ""}
                        ${pair.english ? `<div class="statement-english">${multilineHtml(pair.english)}</div>` : ""}
                    </div>
                </div>
            `;
        })
        .join("");
}

function renderReferenceListPairs(pairs: StatementPair[]): string {
    const longestBodyLength = pairs.reduce((max, pair) => {
        const bodyLength =
            collapseWhitespace(pair.hindi).length + collapseWhitespace(pair.english).length;
        return Math.max(max, bodyLength);
    }, 0);
    const twoColumnClass =
        pairs.length >= 6 && longestBodyLength <= 88 ? " reference-list-grid--two-column" : "";

    return `
        <div class="reference-list-grid${twoColumnClass}">
            ${pairs
                .map((pair, index) => {
                    const label = pair.label || String(index + 1);
                    return `
                        <div class="reference-list-item">
                            <div class="reference-list-label">${escapeHtml(label)}</div>
                            <div class="reference-list-body">
                                ${pair.hindi ? `<div class="reference-list-hindi">${multilineHtml(pair.hindi)}</div>` : ""}
                                ${pair.english ? `<div class="reference-list-english">${multilineHtml(pair.english)}</div>` : ""}
                            </div>
                        </div>
                    `;
                })
                .join("")}
        </div>
    `;
}

function renderMarkdownTable(table: ParsedTable): string {
    const columnCount = Math.max(table.header.length, ...table.rows.map((row) => row.length));
    const gridTemplate = `repeat(${Math.max(2, columnCount)}, minmax(0, 1fr))`;

    return `
        <div class="reference-table" style="grid-template-columns:${gridTemplate}">
            ${table.header
                .map((cell) => `<div class="reference-table-head">${multilineHtml(cell)}</div>`)
                .join("")}
            ${table.rows
                .map((row) =>
                    row
                        .map((cell) => `<div class="reference-table-cell">${multilineHtml(cell)}</div>`)
                        .join("")
                )
                .join("")}
        </div>
    `;
}

function renderQuestionCopyBlock(
    text: string | undefined | null,
    variant: "question-hindi" | "question-english"
): string {
    const lines = splitTextLines(text);
    if (lines.length === 0) return "";

    return `
        <div class="question-copy question-copy-${variant === "question-hindi" ? "hindi" : "english"}">
            ${lines
                .map((line, index) => {
                    const modifier = isInstructionPromptLine(line)
                        ? "instruction"
                        : isStructuredPromptLine(line)
                            ? "detail"
                            : index === 0
                                ? "lead"
                                : "continuation";
                    return `<div class="${variant} ${variant}-line ${variant}-line--${modifier}">${multilineHtml(line)}</div>`;
                })
                .join("")}
        </div>
    `;
}

function shouldCompactReferenceListPrompt(
    question: Question,
    artifacts?: StructuredQuestionArtifacts
): boolean {
    return (
        Boolean(artifacts?.structureKind === "reference-list") &&
        (artifacts?.statementPairs.length || 0) >= 3 &&
        (question.options?.length || 0) >= 2
    );
}

function trimQuestionCopyForReferenceList(
    text: string | undefined | null,
    question: Question,
    artifacts?: StructuredQuestionArtifacts
): string {
    const normalized = normalizeTextBlock(text);
    if (!normalized || !shouldCompactReferenceListPrompt(question, artifacts)) {
        return normalized;
    }

    const originalLines = splitTextLines(normalized);
    const filteredLines = originalLines.filter((line) => !isInstructionPromptLine(line));
    const condensed = filteredLines.join("\n").trim();

    return condensed || normalized;
}

function renderQuestionStructureBlock(
    question: Question,
    artifacts?: StructuredQuestionArtifacts
): string {
    if (
        question.questionType === "MATCH_COLUMN" &&
        question.matchColumns &&
        question.matchColumns.left.length > 0 &&
        question.matchColumns.right.length > 0
    ) {
        return `
            <section class="structure-block">
                <div class="structure-head">Match Columns</div>
                <div class="match-grid">
                    <div class="match-col">
                        <div class="match-col-title">Column I</div>
                        ${renderMatchColumnItems(question.matchColumns.left)}
                    </div>
                    <div class="match-col">
                        <div class="match-col-title">Column II</div>
                        ${renderMatchColumnItems(question.matchColumns.right)}
                    </div>
                </div>
            </section>
        `;
    }

    if (artifacts?.statementPairs && artifacts.statementPairs.length > 0) {
        if (artifacts.structureKind === "reference-list") {
            return `
                <section class="structure-block structure-block-reference-list">
                    <div class="structure-head">Given Items</div>
                    ${renderReferenceListPairs(artifacts.statementPairs)}
                </section>
            `;
        }

        return `
            <section class="structure-block structure-block-statements">
                <div class="structure-head">Statements</div>
                <div class="statement-grid">
                    ${renderStatementPairs(artifacts.statementPairs)}
                </div>
            </section>
        `;
    }

    if (artifacts?.markdownTable) {
        return `
            <section class="structure-block structure-block-table">
                <div class="structure-head">Reference Table</div>
                ${renderMarkdownTable(artifacts.markdownTable)}
            </section>
        `;
    }

    if (question.questionType === "FIB") {
        const blankCount = Math.max(1, question.blankCount || 1);
        return `
            <section class="structure-block">
                <div class="structure-head">Fill in the blank</div>
                <div class="structure-note">${blankCount} blank${blankCount > 1 ? "s" : ""} detected</div>
                <div class="fib-lines">
                    ${new Array(Math.min(blankCount, 5))
                .fill(null)
                .map(() => '<div class="fib-line"></div>')
                .join("")}
                </div>
            </section>
        `;
    }

    if (
        question.questionType &&
        !isOptionQuestionType(question.questionType) &&
        question.questionType !== "UNKNOWN"
    ) {
        return `
            <section class="structure-block">
                <div class="structure-head">Question Structure</div>
                <div class="structure-note">${escapeHtml(getQuestionTypeLabel(question.questionType))}</div>
            </section>
        `;
    }

    return "";
}

function renderOptionsPanel(question: Question, optionDisplayOrder: OptionDisplayOrder): string {
    const options = question.options || [];
    if (
        isOptionQuestionType(question.questionType) ||
        (!question.questionType && options.length >= 2)
    ) {
        return options.map((option, optionIndex) => renderOption(option, optionIndex, optionDisplayOrder)).join("");
    }

    return `
        <article class="option-card option-card-empty">
            <div class="option-head">Answer Mode</div>
            <div class="option-english">${escapeHtml(getQuestionTypeLabel(question.questionType))}</div>
            <div class="option-hindi">Structured response format</div>
        </article>
    `;
}

function resolveImageToDataUri(
    imagePath: string | undefined,
    cache: Map<string, string>
): string {
    if (!imagePath) return "";

    if (imagePath.startsWith("data:image/")) {
        return imagePath;
    }

    if (imagePath.startsWith("file://")) {
        const absolutePath = imagePath.replace(/^file:\/\//, "");
        const dataUri = getFileDataUri(absolutePath);
        if (!dataUri) {
            console.warn(`[DiagramResolver] file:// path not found: ${absolutePath}`);
        }
        return dataUri;
    }

    if (imagePath.startsWith("/uploads/") && !imagePath.includes("..")) {
        if (cache.has(imagePath)) return cache.get(imagePath)!;
        const absolutePath = path.join(process.cwd(), "public", imagePath.replace(/^\/+/, ""));
        if (!fs.existsSync(absolutePath)) {
            console.warn(`[DiagramResolver] /uploads/ file not found: ${absolutePath}`);
            return "";
        }
        const dataUri = getFileDataUri(absolutePath);
        cache.set(imagePath, dataUri);
        return dataUri;
    }

    console.warn(`[DiagramResolver] Unrecognized path scheme, skipping: ${imagePath.slice(0, 60)}`);
    return "";
}

function renderDiagramFigure(
    question: Question,
    imageCache: Map<string, string>,
    // kept for API compatibility, no longer used for CSS injection
    _diagramCssMap: Map<string, string>
): { hasDiagram: boolean; html: string } {
    const configuredDiagramPath = question.diagramImagePath || question.autoDiagramImagePath;

    // Legacy fallback check
    const isLegacyFallback = question.diagramBounds && question.sourceImagePath && configuredDiagramPath === question.sourceImagePath;

    const pathTarget = isLegacyFallback ? question.sourceImagePath : configuredDiagramPath;
    if (!pathTarget) return { hasDiagram: false, html: "" };

    const srcUri = resolveImageToDataUri(pathTarget, imageCache);
    const caption =
        question.diagramCaptionEnglish ||
        question.diagramCaptionHindi ||
        "Diagram";

    // If the image file couldn't be loaded, show a placeholder so the layout is preserved
    if (!srcUri) {
        console.warn(`[DiagramRenderer] Could not resolve diagram image: ${pathTarget.slice(0, 80)}`);
        return {
            hasDiagram: true,
            html: `
                <figure class="diagram-section">
                    <div class="diagram-viewport diagram-viewport-placeholder">
                        <span class="diagram-placeholder-text">📷 Diagram</span>
                    </div>
                    <figcaption class="diagram-caption">${multilineHtml(caption)}</figcaption>
                </figure>
            `,
        };
    }

    if (isLegacyFallback && question.diagramBounds) {
        const { x, y, width, height } = question.diagramBounds;
        const safeWidth = Math.max(width, 0.03);
        const safeHeight = Math.max(height, 0.03);
        const scaledWidth = 100 / safeWidth;
        const scaledHeight = 100 / safeHeight;
        const offsetLeft = -(x / safeWidth) * 100;
        const offsetTop = -(y / safeHeight) * 100;

        return {
            hasDiagram: true,
            html: `
                <figure class="diagram-section">
                    <div class="diagram-viewport">
                        <img
                            class="diagram-image diagram-image-cropped"
                            src="${srcUri}"
                            style="left:${offsetLeft.toFixed(4)}%;top:${offsetTop.toFixed(4)}%;width:${scaledWidth.toFixed(4)}%;height:${scaledHeight.toFixed(4)}%;"
                            alt="Question diagram"
                        />
                    </div>
                    <figcaption class="diagram-caption">${multilineHtml(caption)}</figcaption>
                </figure>
            `,
        };
    }

    return {
        hasDiagram: true,
        html: `
            <figure class="diagram-section">
                <div class="diagram-viewport">
                    <img class="diagram-image" src="${srcUri}" alt="Question diagram" />
                </div>
                <figcaption class="diagram-caption">${multilineHtml(caption)}</figcaption>
            </figure>
            `,
    };
}

function getDensityTier(density: "normal" | "dense" | "compact"): 0 | 1 | 2 {
    if (density === "compact") return 2;
    if (density === "dense") return 1;
    return 0;
}

function buildCssVariableStyle(vars: Record<string, string | undefined>): string {
    const declarations = Object.entries(vars)
        .filter(([, value]) => Boolean(value))
        .map(([key, value]) => `${key}:${value}`);

    return declarations.length > 0 ? ` style="${declarations.join(";")}"` : "";
}

function getBoardMcqLayoutStyle(
    question: Question,
    density: "normal" | "dense" | "compact"
): string {
    const questionMetrics = getQuestionTextMetrics(question);
    const optionMetrics = getOptionTextMetrics(question);
    const densityTier = getDensityTier(density);
    const questionTier =
        questionMetrics.lineUnits >= 10 || questionMetrics.size >= 180
            ? 3
            : questionMetrics.lineUnits >= 8 || questionMetrics.size >= 140
                ? 2
                : questionMetrics.lineUnits >= 6 || questionMetrics.size >= 100
                    ? 1
                    : 0;
    const optionTier =
        optionMetrics.lineUnits >= 18 || optionMetrics.longestUnits >= 7 || optionMetrics.longestLength >= 100
            ? 3
            : optionMetrics.lineUnits >= 14 || optionMetrics.longestUnits >= 5 || optionMetrics.longestLength >= 72
                ? 2
                : optionMetrics.lineUnits >= 9 || optionMetrics.longestUnits >= 4 || optionMetrics.longestLength >= 52
                    ? 1
                    : 0;
    const tightness = clampNumber(
        Math.max(densityTier, optionTier, questionTier >= 3 ? 2 : questionTier >= 2 ? 1 : 0),
        0,
        3
    );

    const balanceScore =
        optionMetrics.lineUnits +
        optionMetrics.longestUnits * 1.6 +
        optionMetrics.count * 0.7 -
        (questionMetrics.lineUnits * 1.45 + questionMetrics.size / 55);
    const widthMode =
        balanceScore >= 10
            ? "option-max"
            : balanceScore >= 4
                ? "option-wide"
                : balanceScore <= -5
                    ? "question-max"
                    : balanceScore <= -2
                        ? "question-wide"
                        : "balanced";

    const sizePresets = [
        { qh: 66, qe: 54, dh: 60, de: 50, oh: 62, oe: 52 },
        { qh: 60, qe: 49, dh: 54, de: 45, oh: 54, oe: 46 },
        { qh: 54, qe: 44, dh: 46, de: 38, oh: 46, oe: 39 },
        { qh: 50, qe: 40, dh: 40, de: 34, oh: 39, oe: 33 },
    ] as const;
    const spacingPresets = [
        {
            bodyPadding: "112px 24px 126px 54px",
            bodyGap: "18px",
            questionGap: "20px",
            questionCopyGap: "14px",
            questionEnglishMargin: "42px",
            optionsPadding: "74px 18px 24px 0",
            optionsGap: "14px",
            optionNumberSize: "36px",
            optionLineGap: "12px",
            optionLineHeightHindi: "1.08",
            optionLineHeightEnglish: "1.06",
        },
        {
            bodyPadding: "108px 20px 118px 48px",
            bodyGap: "16px",
            questionGap: "16px",
            questionCopyGap: "10px",
            questionEnglishMargin: "28px",
            optionsPadding: "54px 14px 16px 0",
            optionsGap: "10px",
            optionNumberSize: "32px",
            optionLineGap: "10px",
            optionLineHeightHindi: "1.06",
            optionLineHeightEnglish: "1.05",
        },
        {
            bodyPadding: "104px 16px 112px 42px",
            bodyGap: "12px",
            questionGap: "12px",
            questionCopyGap: "8px",
            questionEnglishMargin: "18px",
            optionsPadding: "36px 10px 10px 0",
            optionsGap: "8px",
            optionNumberSize: "29px",
            optionLineGap: "8px",
            optionLineHeightHindi: "1.04",
            optionLineHeightEnglish: "1.03",
        },
        {
            bodyPadding: "100px 14px 108px 38px",
            bodyGap: "10px",
            questionGap: "10px",
            questionCopyGap: "6px",
            questionEnglishMargin: "12px",
            optionsPadding: "24px 8px 8px 0",
            optionsGap: "6px",
            optionNumberSize: "26px",
            optionLineGap: "7px",
            optionLineHeightHindi: "1.02",
            optionLineHeightEnglish: "1.01",
        },
    ] as const;
    const bodyColumnsByMode: Record<string, string> = {
        balanced: "minmax(0, 0.14fr) minmax(0, 1.0fr) minmax(0, 0.86fr)",
        "question-wide": "minmax(0, 0.14fr) minmax(0, 1.08fr) minmax(0, 0.78fr)",
        "question-max": "minmax(0, 0.14fr) minmax(0, 1.14fr) minmax(0, 0.72fr)",
        "option-wide": "minmax(0, 0.12fr) minmax(0, 0.9fr) minmax(0, 0.98fr)",
        "option-max": "minmax(0, 0.12fr) minmax(0, 0.84fr) minmax(0, 1.04fr)",
    };
    const optionCardWidthByMode: Record<string, string> = {
        balanced: "min(100%, 660px)",
        "question-wide": "min(100%, 620px)",
        "question-max": "min(100%, 600px)",
        "option-wide": "min(100%, 700px)",
        "option-max": "min(100%, 740px)",
    };

    const sizes = sizePresets[tightness];
    const spacing = spacingPresets[tightness];

    return buildCssVariableStyle({
        "--board-question-hindi-size": `${sizes.qh}px`,
        "--board-question-english-size": `${sizes.qe}px`,
        "--board-detail-hindi-size": `${sizes.dh}px`,
        "--board-detail-english-size": `${sizes.de}px`,
        "--board-option-hindi-size": `${sizes.oh}px`,
        "--board-option-english-size": `${sizes.oe}px`,
        "--board-mcq-body-columns": bodyColumnsByMode[widthMode],
        "--board-mcq-body-padding": spacing.bodyPadding,
        "--board-mcq-body-gap": spacing.bodyGap,
        "--board-mcq-question-gap": spacing.questionGap,
        "--board-mcq-question-copy-gap": spacing.questionCopyGap,
        "--board-mcq-question-english-margin": spacing.questionEnglishMargin,
        "--board-mcq-options-padding": spacing.optionsPadding,
        "--board-mcq-options-gap": spacing.optionsGap,
        "--board-mcq-options-justify": "space-between",
        "--board-mcq-option-number-size": spacing.optionNumberSize,
        "--board-mcq-option-line-gap": spacing.optionLineGap,
        "--board-mcq-option-card-width": optionCardWidthByMode[widthMode],
        "--board-mcq-option-line-height-hindi": spacing.optionLineHeightHindi,
        "--board-mcq-option-line-height-english": spacing.optionLineHeightEnglish,
    });
}

function getBoardMatchLayoutStyle(
    question: Question,
    density: "normal" | "dense" | "compact"
): string {
    const questionMetrics = getQuestionTextMetrics(question);
    const optionMetrics = getOptionTextMetrics(question);
    const matchMetrics = getMatchColumnMetrics(question);
    const densityTier = getDensityTier(density);
    const questionTier =
        questionMetrics.lineUnits >= 9 || questionMetrics.size >= 150
            ? 2
            : questionMetrics.lineUnits >= 6 || questionMetrics.size >= 100
                ? 1
                : 0;
    const matchTier =
        matchMetrics.lineUnits >= 26 || matchMetrics.longestUnits >= 7 || matchMetrics.itemCount >= 8
            ? 2
            : matchMetrics.lineUnits >= 16 || matchMetrics.longestUnits >= 5 || matchMetrics.itemCount >= 6
                ? 1
                : 0;
    const optionTier = optionMetrics.longestUnits >= 5 || optionMetrics.lineUnits >= 10 ? 1 : 0;
    const tightness = clampNumber(Math.max(densityTier, questionTier, matchTier, optionTier), 0, 2);
    const widthMode =
        matchTier >= 2
            ? "structure-max"
            : matchTier >= 1
                ? "structure-wide"
                : optionTier >= 1
                    ? "options-wide"
                    : questionTier >= 2
                        ? "question-wide"
                        : "balanced";

    const sizePresets = [
        { qh: 58, qe: 46, dh: 38, de: 32, mh: 34, me: 30, oh: 46, oe: 40 },
        { qh: 50, qe: 40, dh: 34, de: 29, mh: 30, me: 27, oh: 42, oe: 36 },
        { qh: 44, qe: 35, dh: 31, de: 27, mh: 27, me: 24, oh: 38, oe: 33 },
    ] as const;
    const spacingPresets = [
        {
            bodyPadding: "118px 32px 132px 72px",
            bodyGap: "24px",
            questionGap: "14px",
            questionCopyGap: "8px",
            questionEnglishMargin: "18px",
            structureGap: "10px",
            matchGridGap: "10px",
            optionsPadding: "118px 20px 0 0",
            optionsGap: "18px",
            optionCardWidth: "min(100%, 440px)",
        },
        {
            bodyPadding: "110px 24px 120px 58px",
            bodyGap: "18px",
            questionGap: "10px",
            questionCopyGap: "6px",
            questionEnglishMargin: "12px",
            structureGap: "8px",
            matchGridGap: "8px",
            optionsPadding: "94px 14px 0 0",
            optionsGap: "14px",
            optionCardWidth: "min(100%, 420px)",
        },
        {
            bodyPadding: "104px 18px 114px 48px",
            bodyGap: "14px",
            questionGap: "8px",
            questionCopyGap: "5px",
            questionEnglishMargin: "8px",
            structureGap: "6px",
            matchGridGap: "6px",
            optionsPadding: "76px 10px 0 0",
            optionsGap: "10px",
            optionCardWidth: "min(100%, 390px)",
        },
    ] as const;
    const bodyColumnsByMode: Record<string, string> = {
        balanced: "minmax(0, 0.34fr) minmax(0, 1.02fr) minmax(0, 0.64fr)",
        "question-wide": "minmax(0, 0.30fr) minmax(0, 1.10fr) minmax(0, 0.60fr)",
        "structure-wide": "minmax(0, 0.28fr) minmax(0, 1.14fr) minmax(0, 0.58fr)",
        "structure-max": "minmax(0, 0.24fr) minmax(0, 1.20fr) minmax(0, 0.56fr)",
        "options-wide": "minmax(0, 0.30fr) minmax(0, 0.94fr) minmax(0, 0.76fr)",
    };

    const sizes = sizePresets[tightness];
    const spacing = spacingPresets[tightness];

    return buildCssVariableStyle({
        "--board-question-hindi-size": `${sizes.qh}px`,
        "--board-question-english-size": `${sizes.qe}px`,
        "--board-detail-hindi-size": `${sizes.dh}px`,
        "--board-detail-english-size": `${sizes.de}px`,
        "--board-match-hindi-size": `${sizes.mh}px`,
        "--board-match-english-size": `${sizes.me}px`,
        "--board-option-hindi-size": `${sizes.oh}px`,
        "--board-option-english-size": `${sizes.oe}px`,
        "--board-match-body-columns": bodyColumnsByMode[widthMode],
        "--board-match-body-padding": spacing.bodyPadding,
        "--board-match-body-gap": spacing.bodyGap,
        "--board-match-question-gap": spacing.questionGap,
        "--board-match-question-copy-gap": spacing.questionCopyGap,
        "--board-match-question-english-margin": spacing.questionEnglishMargin,
        "--board-match-structure-gap": spacing.structureGap,
        "--board-match-grid-gap": spacing.matchGridGap,
        "--board-match-options-padding": spacing.optionsPadding,
        "--board-match-options-gap": spacing.optionsGap,
        "--board-match-option-card-width": spacing.optionCardWidth,
    });
}

function getBoardSlideStyle(
    question: Question,
    layoutQuestionType: LayoutQuestionType,
    density: "normal" | "dense" | "compact",
    templateId: string,
    resolution: PdfInput["previewResolution"]
): string {
    if (templateId !== "board" || resolution !== "1920x1080") {
        return "";
    }

    if (
        layoutQuestionType === "MCQ" ||
        layoutQuestionType === "TRUE_FALSE" ||
        layoutQuestionType === "ASSERTION_REASON"
    ) {
        return getBoardMcqLayoutStyle(question, density);
    }

    if (layoutQuestionType === "MATCH_COLUMN") {
        return getBoardMatchLayoutStyle(question, density);
    }

    return "";
}


function renderSlide(
    question: Question,
    index: number,
    totalSlides: number,
    payload: PdfInput,
    template: PdfTemplateConfig,
    assets: EmbeddedAssets,
    imageCache: Map<string, string>,
    diagramCssMap: Map<string, string>
): string {
    const diagram = renderDiagramFigure(question, imageCache, diagramCssMap);
    const hasDiagram = diagram.hasDiagram;
    const structuredArtifacts = deriveStructuredQuestionArtifacts(question);
    const layoutQuestionType = resolveLayoutQuestionType(question, structuredArtifacts);
    const density = normalizeSlideDensity(
        question,
        hasDiagram,
        payload.previewResolution,
        layoutQuestionType,
        structuredArtifacts
    );
    const optionDisplayOrder: OptionDisplayOrder = "hindi-first";
    const questionLines = uniqueBilingualBlocks(
        structuredArtifacts.sanitizedEnglish,
        structuredArtifacts.sanitizedHindi,
        "hindi-first"
    );
    const compactQuestionHindi = trimQuestionCopyForReferenceList(
        questionLines[0],
        question,
        structuredArtifacts
    );
    const compactQuestionEnglish = trimQuestionCopyForReferenceList(
        questionLines[1],
        question,
        structuredArtifacts
    );
    const questionHindiHtml = renderQuestionCopyBlock(compactQuestionHindi, "question-hindi");
    const questionEnglishHtml = renderQuestionCopyBlock(compactQuestionEnglish, "question-english");
    const questionTypeLabel = getQuestionTypeLabel(question.questionType);
    const answerText = payload.includeAnswers === false ? "" : getQuestionAnswerText(question, true);
    const structureBlock = renderQuestionStructureBlock(question, structuredArtifacts);
    const optionsPanel = renderOptionsPanel(question, optionDisplayOrder);
    const optionHeavy = isOptionHeavySlide(question, layoutQuestionType);
    const questionHeavy = isQuestionHeavySlide(question, structuredArtifacts);
    const listHeavy = isListHeavySlide(question);
    const referenceListHeavy =
        structuredArtifacts.structureKind === "reference-list" &&
        structuredArtifacts.statementPairs.length >= 3;

    const isSimpleTemplate = template.id === "simple";
    const isBoardTemplate = template.id === "board";
    const isHd1920 = payload.previewResolution === "1920x1080";
    const slideStyle = getBoardSlideStyle(
        question,
        layoutQuestionType,
        density,
        template.id,
        payload.previewResolution
    );

    const questionTypeClass = layoutQuestionType
        ? ` question-type-${layoutQuestionType.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`
        : "";
    const sheetClass = `sheet density-${density}${hasDiagram ? " has-diagram" : ""}${isSimpleTemplate ? " sheet-simple" : ""}${isBoardTemplate ? " sheet-board" : ""}${isHd1920 ? " sheet-hd-1920" : ""}${optionHeavy ? " content-option-heavy" : ""}${questionHeavy ? " content-question-heavy" : ""}${listHeavy ? " content-list-heavy" : ""}${referenceListHeavy ? " content-reference-list" : ""}${questionTypeClass}`;
    // Background is injected via CSS variable in the <head> — do NOT inline per-slide.
    // This prevents the HTML from growing to 100+ MB with many slides.
    const bgImgHtml = `<div class="sheet-bg${isSimpleTemplate || isBoardTemplate ? " sheet-bg-full" : ""}"></div>`;

    return `
    <section class="${sheetClass}"${slideStyle}>
        ${bgImgHtml}

        <header class="sheet-header">
            <div>
                <div class="institute">${escapeHtml(payload.instituteName)}</div>
            </div>
            ${assets.logoDataUri ? `<img class="logo" src="${assets.logoDataUri}" alt="Nexora logo" />` : ""}
        </header>

        <main class="sheet-body">
            <section class="question-panel">
                <div class="question-head-row">
                    <div class="question-index">Question ${escapeHtml(question.number || String(index + 1))}</div>
                    <div class="question-meta-tags">
                        <div class="question-type-tag">${escapeHtml(questionTypeLabel)}</div>
                        ${answerText ? `<div class="question-answer-tag">Answer: ${inlineHtml(answerText)}</div>` : ""}
                    </div>
                </div>
                ${questionHindiHtml}
                ${questionEnglishHtml}

                ${structureBlock}
                ${diagram.html}
            </section>

            <aside class="options-panel">
                ${optionsPanel}
            </aside>
        </main>

        ${assets.logoDataUri ? `<img class="watermark" src="${assets.logoDataUri}" alt="" />` : ""}
    </section>
    `;
}

function generateHtml(payload: PdfInput, template: PdfTemplateConfig, pageSpec: PageSpec, imageCache: Map<string, string>): string {
    const assets = loadEmbeddedAssets();
    const diagramCssMap = new Map<string, string>(); // kept for renderSlide signature; no longer used

    const fontFace = assets.fontBase64
        ? `
        @font-face {
            font-family: "NotoSansHindi";
            src: url(data:font/truetype;charset=utf-8;base64,${assets.fontBase64}) format("truetype");
            font-weight: 400;
            font-style: normal;
        }
    `
        : "";

    // CRITICAL: Define background images ONCE in CSS, NOT inline per-slide.
    // With 100 slides, embedding base64 per-slide creates a 100+ MB HTML file
    // that crashes Puppeteer. Instead, we use CSS to reference a single definition.
    const isSimpleTemplate = template.id === "simple";
    const isBoardTemplate = template.id === "board";
    const bgUri = isBoardTemplate
        ? (assets.boardBackgroundDataUri || assets.simpleBackgroundDataUri || assets.backgroundDataUri)
        : isSimpleTemplate
            ? (assets.simpleBackgroundDataUri || assets.backgroundDataUri)
            : assets.backgroundDataUri;

    const backgroundCss = bgUri
        ? `
        /* Background image defined ONCE here; referenced by every .sheet-bg via CSS background-image. */
        .sheet-bg {
            background-image: url("${bgUri}");
            background-size: cover;
            background-position: center;
            background-repeat: no-repeat;
        }
    `
        : "";

    const renderableQuestions = payload.questions.filter(isRenderableQuestion);
    const slides = renderableQuestions
        .map((question, index) =>
            renderSlide(question, index, renderableQuestions.length, payload, template, assets, imageCache, diagramCssMap)
        )
        .join("\n");

    const hd1920LayoutOverrides =
        payload.previewResolution === "1920x1080"
            ? `
        .sheet-hd-1920 {
            /* Preserve a larger writing margin on the left while using the right side more fully. */
            padding: 1in 1.45in 4in 2.55in;
        }

        .sheet-hd-1920 .sheet-header {
            height: auto;
            min-height: 0;
            padding: 0 0 18px;
            border-bottom-width: 2px;
        }

        .sheet-hd-1920 .institute {
            font-size: 48px;
            line-height: 1.08;
            max-width: none;
            letter-spacing: 0.01em;
            text-shadow: 0 2px 10px rgba(0, 0, 0, 0.18);
        }

        .sheet-hd-1920 .logo {
            height: 64px;
        }

        .sheet-hd-1920 .sheet-body {
            padding: 18px 0 0;
            gap: 18px;
            grid-template-columns: 1.48fr 0.88fr;
            align-items: stretch;
        }

        .sheet-hd-1920 .question-panel,
        .sheet-hd-1920 .options-panel {
            border-width: 2px;
            border-radius: 24px;
        }

        .sheet-hd-1920 .question-panel {
            padding: 22px;
            gap: 15px;
        }

        .sheet-hd-1920.density-normal .question-panel {
            justify-content: center;
        }

        .sheet-hd-1920.density-normal .options-panel {
            justify-content: stretch;
        }

        .sheet-hd-1920.density-normal .option-card {
            flex: 1 1 0;
            justify-content: center;
        }

        .sheet-hd-1920 .question-head-row {
            gap: 10px;
            margin-bottom: 4px;
        }

        .sheet-hd-1920 .question-meta-tags {
            gap: 8px;
        }

        .sheet-hd-1920 .question-index {
            font-size: 34px;
            padding: 10px 22px;
            border-width: 2px;
            font-weight: 800;
            letter-spacing: 0.015em;
        }

        .sheet-hd-1920 .question-type-tag,
        .sheet-hd-1920 .question-answer-tag {
            font-size: 20px;
            padding: 8px 16px;
            border-width: 2px;
        }

        .sheet-hd-1920 .question-hindi {
            font-size: 68px;
            line-height: 1.35;
            margin-top: 8px;
            margin-bottom: 4px;
        }

        .sheet-hd-1920 .question-english {
            font-size: 54px;
            line-height: 1.28;
            margin-top: 10px;
            margin-bottom: 4px;
            font-weight: 600;
        }

        .sheet-hd-1920 .question-copy {
            gap: 10px;
        }

        .sheet-hd-1920 .question-copy-hindi {
            margin-top: 10px;
        }

        .sheet-hd-1920 .question-copy-english {
            margin-top: 8px;
        }

        .sheet-hd-1920 .question-hindi-line--detail,
        .sheet-hd-1920 .question-hindi-line--continuation {
            font-size: 50px;
            line-height: 1.35;
        }

        .sheet-hd-1920 .question-hindi-line--instruction {
            font-size: 40px;
            line-height: 1.28;
        }

        .sheet-hd-1920 .question-english-line--detail,
        .sheet-hd-1920 .question-english-line--continuation {
            font-size: 42px;
            line-height: 1.28;
        }

        .sheet-hd-1920 .question-english-line--instruction {
            font-size: 34px;
            line-height: 1.2;
        }

        .sheet-hd-1920 .structure-block {
            border-width: 2px;
            border-radius: 14px;
            padding: 16px;
            gap: 10px;
        }

        .sheet-hd-1920 .structure-head {
            font-size: 18px;
        }

        .sheet-hd-1920 .structure-note {
            font-size: 23px;
            line-height: 1.22;
        }

        .sheet-hd-1920 .match-grid {
            gap: 12px;
        }

        .sheet-hd-1920 .match-col {
            border-width: 2px;
            border-radius: 12px;
            padding: 12px;
            gap: 8px;
        }

        .sheet-hd-1920 .match-col-title {
            font-size: 18px;
        }

        .sheet-hd-1920 .match-row-english {
            font-size: 29px;
            line-height: 1.22;
        }

        .sheet-hd-1920 .match-row-hindi {
            font-size: 33px;
            line-height: 1.22;
        }

        .sheet-hd-1920 .statement-label {
            min-width: 36px;
            font-size: 20px;
        }

        .sheet-hd-1920 .statement-hindi {
            font-size: 31px;
            line-height: 1.18;
        }

        .sheet-hd-1920 .statement-english {
            font-size: 27px;
            line-height: 1.18;
        }

        .sheet-hd-1920 .reference-table-head {
            font-size: 18px;
            line-height: 1.18;
            padding: 10px 12px;
        }

        .sheet-hd-1920 .reference-table-cell {
            font-size: 24px;
            line-height: 1.2;
            padding: 10px 12px;
        }

        .sheet-hd-1920 .options-panel {
            padding: 18px;
            gap: 14px;
            align-content: start;
            overflow: visible;
            display: flex;
            flex-direction: column;
            justify-content: space-between;
        }

        .sheet-hd-1920 .option-card {
            border-width: 2px;
            border-radius: 16px;
            padding: 15px 17px;
            display: flex;
            flex-direction: column;
            gap: 12px;
            min-height: min-content;
            height: auto;
            flex-shrink: 0;
        }

        .sheet-hd-1920 .option-head {
            font-size: 24px;
            margin-bottom: 4px;
            letter-spacing: 0.07em;
            line-height: 1.18;
        }

        .sheet-hd-1920 .option-hindi {
            font-size: 46px;
            line-height: 1.35;
            margin-top: 0;
        }

        .sheet-hd-1920 .option-english {
            font-size: 40px;
            line-height: 1.28;
            margin-top: 0;
        }

        .sheet-hd-1920 .diagram-section {
            border-width: 2px;
            border-radius: 14px;
            padding: 14px;
            gap: 10px;
        }

        .sheet-hd-1920 .diagram-caption {
            font-size: 17px;
            line-height: 1.26;
        }

        .sheet-hd-1920 .watermark {
            width: 42%;
            max-width: none;
            opacity: 0.12;
        }

        .sheet-hd-1920.content-option-heavy .sheet-body {
            gap: 14px;
            grid-template-columns: 1.1fr 1.22fr;
        }

        .sheet-hd-1920.content-option-heavy .question-panel {
            padding: 20px;
            gap: 14px;
        }

        .sheet-hd-1920.content-option-heavy .options-panel {
            padding: 16px;
            gap: 12px;
            justify-content: flex-start;
        }

        .sheet-hd-1920.content-option-heavy .option-card {
            padding: 14px 16px;
            gap: 10px;
        }

        .sheet-hd-1920.content-option-heavy .option-hindi {
            font-size: 42px;
            line-height: 1.35;
        }

        .sheet-hd-1920.content-option-heavy .option-english {
            font-size: 36px;
            line-height: 1.28;
        }

        .sheet-hd-1920.density-compact .question-copy {
            gap: 6px;
        }

        .sheet-hd-1920.density-compact .question-copy-hindi {
            margin-top: 8px;
        }

        .sheet-hd-1920.density-compact .question-copy-english {
            margin-top: 4px;
        }

        .sheet-hd-1920.density-dense .option-card {
            gap: 14px;
            padding: 14px 16px;
        }

        .sheet-hd-1920.density-dense .question-hindi {
            font-size: 62px;
            line-height: 1.35;
        }

        .sheet-hd-1920.density-dense .question-english {
            font-size: 48px;
            line-height: 1.28;
        }

        .sheet-hd-1920.density-dense .question-hindi-line--detail,
        .sheet-hd-1920.density-dense .question-hindi-line--continuation {
            font-size: 45px;
            line-height: 1.35;
        }

        .sheet-hd-1920.density-dense .question-hindi-line--instruction {
            font-size: 36px;
            line-height: 1.28;
        }

        .sheet-hd-1920.density-dense .question-english-line--detail,
        .sheet-hd-1920.density-dense .question-english-line--continuation {
            font-size: 38px;
            line-height: 1.28;
        }

        .sheet-hd-1920.density-dense .question-english-line--instruction {
            font-size: 30px;
            line-height: 1.2;
        }

        .sheet-hd-1920.density-dense .option-hindi {
            font-size: 40px;
            line-height: 1.35;
        }

        .sheet-hd-1920.density-dense .option-english {
            font-size: 36px;
            line-height: 1.28;
        }

        .sheet-hd-1920.density-compact .option-card {
            gap: 8px;
            padding: 10px 12px;
        }

        .sheet-hd-1920.density-compact .sheet-body {
            grid-template-columns: 1.62fr 0.68fr;
            gap: 24px;
        }

        .sheet-hd-1920.density-compact .question-panel {
            padding: 18px;
            gap: 10px;
        }

        .sheet-hd-1920.density-compact .question-hindi {
            font-size: 50px;
            line-height: 1.35;
        }

        .sheet-hd-1920.density-compact .question-english {
            font-size: 40px;
            line-height: 1.28;
        }

        .sheet-hd-1920.density-compact .question-hindi-line--detail,
        .sheet-hd-1920.density-compact .question-hindi-line--continuation {
            font-size: 40px;
            line-height: 1.35;
        }

        .sheet-hd-1920.density-compact .question-hindi-line--instruction {
            font-size: 32px;
            line-height: 1.28;
        }

        .sheet-hd-1920.density-compact .question-english-line--detail,
        .sheet-hd-1920.density-compact .question-english-line--continuation {
            font-size: 34px;
            line-height: 1.28;
        }

        .sheet-hd-1920.density-compact .question-english-line--instruction {
            font-size: 26px;
            line-height: 1.2;
        }

        .sheet-hd-1920.density-compact .statement-hindi {
            font-size: 26px;
            line-height: 1.14;
        }

        .sheet-hd-1920.density-compact .statement-english {
            font-size: 23px;
            line-height: 1.14;
        }

        .sheet-hd-1920.density-compact .reference-table-cell {
            font-size: 21px;
            line-height: 1.16;
        }

        .sheet-hd-1920.density-compact .options-panel {
            padding: 14px;
            gap: 12px;
            justify-content: flex-start;
        }

        .sheet-hd-1920.density-compact .option-hindi {
            font-size: 34px;
            line-height: 1.35;
        }

        .sheet-hd-1920.density-compact .option-english {
            font-size: 30px;
            line-height: 1.28;
        }
    `
            : "";

    return `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <style>
        ${fontFace}
        ${backgroundCss}

        :root {
            --page-bg: ${template.palette.pageBg};
            --page-bg-alt: ${template.palette.pageBgAlt};
            --panel-bg: ${template.palette.panelBg};
            --panel-border: ${template.palette.panelBorder};
            --accent: ${template.palette.accent};
            --accent-soft: ${template.palette.accentSoft};
            --title: ${template.palette.title};
            --hindi: ${template.palette.hindi};
            --english: ${template.palette.english};
            --option-bg: ${template.palette.optionBg};
            --option-border: ${template.palette.optionBorder};
            --option-label: ${template.palette.optionLabel};
            --footer: ${template.palette.footer};
            --watermark-opacity: ${template.watermarkOpacity};
        }

        @page {
            size: ${pageSpec.cssPageSize};
            margin: 0;
        }

        * {
            box-sizing: border-box;
            margin: 0;
            padding: 0;
        }

        html,
        body {
            font-family: "NotoSansHindi", "Noto Sans Devanagari", "Nirmala UI", "Segoe UI", sans-serif;
            -webkit-font-smoothing: antialiased;
            text-rendering: optimizeLegibility;
            background: #fff;
        }

        .sheet sup,
        .sheet sub {
            font-size: 0.66em;
            line-height: 0;
            position: relative;
            vertical-align: baseline;
            font-weight: 700;
        }

        .sheet sup {
            top: -0.42em;
        }

        .sheet sub {
            bottom: -0.16em;
        }

        .sheet {
            width: ${pageSpec.sheetWidth};
            height: ${pageSpec.sheetHeight};
            position: relative;
            background:
                radial-gradient(circle at 12% 0%, var(--accent-soft), transparent 35%),
                radial-gradient(circle at 90% 100%, var(--accent-soft), transparent 30%),
                linear-gradient(180deg, var(--page-bg-alt), var(--page-bg));
            color: var(--title);
            overflow: hidden;
            page-break-after: always;
            page-break-inside: avoid;
            display: flex;
            flex-direction: column;
        }

        .sheet:last-child {
            page-break-after: auto;
        }

        .sheet-bg {
            position: absolute;
            inset: 0;
            width: 100%;
            height: 100%;
            object-fit: cover;
            opacity: 0.06;
            pointer-events: none;
            z-index: 0;
        }

        .sheet-header,
        .sheet-body,
        .sheet-footer {
            position: relative;
            z-index: 2;
        }

        .sheet-header {
            height: 24mm;
            padding: 8mm 10mm 5mm;
            display: flex;
            align-items: flex-start;
            justify-content: space-between;
            border-bottom: 0.4mm solid var(--panel-border);
            background: linear-gradient(180deg, rgba(255,255,255,0.08), rgba(255,255,255,0));
        }

        .institute {
            font-size: 7.2mm;
            line-height: 1.15;
            font-weight: 700;
            letter-spacing: 0.02em;
            color: var(--title);
            max-width: 190mm;
        }

        .meta-line {
            margin-top: 1.6mm;
            font-size: 3.8mm;
            color: var(--footer);
            line-height: 1.25;
        }

        .logo {
            height: 15mm;
            width: auto;
            object-fit: contain;
            filter: drop-shadow(0 1mm 1.5mm rgba(0, 0, 0, 0.3));
        }

        .sheet-body {
            display: grid;
            grid-template-columns: 1.28fr 0.92fr;
            gap: 7mm;
            flex: 1;
            min-height: 0;
            padding: 8mm 10mm 7mm;
        }

        .question-panel,
        .options-panel {
            border: 0.35mm solid var(--panel-border);
            border-radius: 4.8mm;
            background: var(--panel-bg);
        }

        .question-panel {
            padding: 5.8mm;
            display: flex;
            flex-direction: column;
            min-height: 0;
            overflow: hidden;
            gap: 2.2mm;
        }

        .question-head-row {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 2mm;
            flex-wrap: wrap;
        }

        .question-meta-tags {
            display: flex;
            align-items: center;
            justify-content: flex-end;
            flex-wrap: wrap;
            gap: 1.4mm;
        }

        .question-index {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            width: fit-content;
            padding: 1.5mm 3.6mm;
            border-radius: 999px;
            border: 0.3mm solid var(--option-border);
            background: rgba(255,255,255,0.08);
            color: var(--option-label);
            font-size: 3.6mm;
            font-weight: 700;
            letter-spacing: 0.02em;
        }

        .question-type-tag {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            width: fit-content;
            padding: 1.4mm 3.2mm;
            border-radius: 999px;
            border: 0.28mm solid var(--option-border);
            background: rgba(15, 23, 42, 0.22);
            color: var(--footer);
            font-size: 3.2mm;
            font-weight: 700;
            letter-spacing: 0.03em;
            text-transform: uppercase;
        }

        .question-answer-tag {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            width: fit-content;
            padding: 1.4mm 3.2mm;
            border-radius: 999px;
            border: 0.28mm solid #2f9e44;
            background: rgba(47, 158, 68, 0.18);
            color: #d3f9d8;
            font-size: 3.2mm;
            font-weight: 700;
            letter-spacing: 0.02em;
            text-transform: uppercase;
        }

        .question-hindi {
            margin-top: 1.2mm;
            font-size: 8.6mm;
            line-height: 1.35;
            color: var(--hindi);
            font-weight: 700;
            word-break: break-word;
        }

        .question-copy {
            display: flex;
            flex-direction: column;
            gap: 1.15mm;
            min-height: 0;
        }

        .question-panel sub,
        .question-panel sup,
        .option-card sub,
        .option-card sup {
            font-size: 0.62em;
            line-height: 0;
            position: relative;
            vertical-align: baseline;
        }

        .question-panel sub,
        .option-card sub {
            bottom: -0.18em;
        }

        .question-panel sup,
        .option-card sup {
            top: -0.42em;
        }

        .question-copy-hindi {
            margin-top: 1.2mm;
        }

        .question-copy-english {
            margin-top: 0.8mm;
        }

        .question-copy .question-hindi,
        .question-copy .question-english {
            margin-top: 0;
        }

        .question-hindi-line--detail,
        .question-hindi-line--continuation {
            font-size: 0.94em;
            line-height: 1.35;
            font-weight: 650;
        }

        .question-hindi-line--instruction {
            font-size: 0.8em;
            line-height: 1.35;
            color: var(--footer);
            font-weight: 600;
        }

        .question-english {
            margin-top: 1.2mm;
            font-family: "Segoe UI", "Helvetica Neue", Arial, sans-serif;
            font-size: 6.6mm;
            line-height: 1.38;
            color: var(--english);
            word-break: break-word;
        }

        .question-english-line--detail,
        .question-english-line--continuation {
            font-size: 0.94em;
            line-height: 1.35;
            font-weight: 560;
        }

        .question-english-line--instruction {
            font-size: 0.82em;
            line-height: 1.35;
            color: var(--footer);
        }

        .structure-block {
            border: 0.28mm solid var(--option-border);
            border-radius: 3mm;
            background: rgba(15, 23, 42, 0.18);
            padding: 2.2mm;
            display: flex;
            flex-direction: column;
            gap: 1.5mm;
            min-height: 0;
        }

        .structure-head {
            font-size: 3.2mm;
            color: var(--option-label);
            letter-spacing: 0.05em;
            text-transform: uppercase;
            font-weight: 700;
        }

        .structure-note {
            font-size: 3.6mm;
            color: var(--english);
            line-height: 1.3;
        }

        .match-grid {
            display: grid;
            grid-template-columns: repeat(2, minmax(0, 1fr));
            gap: 2.2mm;
            min-height: 0;
        }

        .match-col {
            border: 0.24mm solid var(--option-border);
            border-radius: 2.2mm;
            padding: 1.8mm;
            background: rgba(255, 255, 255, 0.04);
            display: flex;
            flex-direction: column;
            gap: 1.2mm;
            min-height: 0;
        }

        .match-col-title {
            font-size: 3.6mm;
            color: var(--option-label);
            font-weight: 700;
            letter-spacing: 0.04em;
            text-transform: uppercase;
        }

        .match-row {
            display: grid;
            grid-template-columns: auto 1fr;
            gap: 1.5mm;
            align-items: start;
            min-height: 0;
        }

        .match-row-id {
            font-size: 3.8mm;
            color: var(--option-label);
            font-weight: 700;
            margin-top: 0.2mm;
        }

        .match-row-body {
            min-height: 0;
        }

        .match-row-english {
            font-size: 4.6mm;
            line-height: 1.28;
            color: var(--english);
            word-break: break-word;
        }

        .match-row-hindi {
            font-size: 5.0mm;
            line-height: 1.28;
            color: var(--hindi);
            margin-top: 0.25mm;
            word-break: break-word;
        }

        .statement-grid {
            display: flex;
            flex-direction: column;
            gap: 1.6mm;
        }

        .statement-row {
            display: grid;
            grid-template-columns: auto 1fr;
            gap: 1.6mm;
            align-items: start;
        }

        .statement-label {
            min-width: 7mm;
            font-size: 3.5mm;
            line-height: 1.2;
            color: var(--option-label);
            font-weight: 800;
            text-transform: uppercase;
        }

        .statement-body {
            display: flex;
            flex-direction: column;
            gap: 0.7mm;
            min-height: 0;
        }

        .statement-hindi {
            font-size: 5.0mm;
            line-height: 1.24;
            color: var(--hindi);
            font-weight: 650;
            word-break: break-word;
        }

        .statement-english {
            font-size: 4.5mm;
            line-height: 1.24;
            color: var(--english);
            word-break: break-word;
        }

        .reference-list-grid {
            display: grid;
            grid-template-columns: minmax(0, 1fr);
            gap: 1.8mm;
        }

        .reference-list-grid--two-column {
            grid-template-columns: repeat(2, minmax(0, 1fr));
            gap: 1.6mm 2mm;
        }

        .reference-list-item {
            display: grid;
            grid-template-columns: auto 1fr;
            gap: 1.6mm;
            align-items: start;
            min-height: 0;
        }

        .reference-list-label {
            min-width: 7mm;
            font-size: 3.6mm;
            line-height: 1.15;
            color: var(--option-label);
            font-weight: 800;
            text-transform: uppercase;
        }

        .reference-list-body {
            display: flex;
            flex-direction: column;
            gap: 0.7mm;
            min-height: 0;
        }

        .reference-list-hindi {
            font-size: 5.1mm;
            line-height: 1.24;
            color: var(--hindi);
            font-weight: 650;
            word-break: break-word;
        }

        .reference-list-english {
            font-size: 4.5mm;
            line-height: 1.22;
            color: var(--english);
            word-break: break-word;
        }

        .reference-table {
            display: grid;
            gap: 0;
            border: 0.24mm solid rgba(255,255,255,0.1);
            border-radius: 2.2mm;
            overflow: hidden;
        }

        .reference-table-head,
        .reference-table-cell {
            padding: 1.4mm 1.6mm;
            border-right: 0.22mm solid rgba(255,255,255,0.08);
            border-bottom: 0.22mm solid rgba(255,255,255,0.08);
            word-break: break-word;
        }

        .reference-table-head {
            font-size: 3.2mm;
            line-height: 1.22;
            color: var(--option-label);
            font-weight: 700;
            text-transform: uppercase;
            background: rgba(255,255,255,0.04);
        }

        .reference-table-cell {
            font-size: 4.0mm;
            line-height: 1.22;
            color: var(--english);
        }

        .fib-lines {
            display: grid;
            gap: 1.5mm;
        }

        .fib-line {
            width: 100%;
            border-bottom: 0.24mm dashed var(--option-border);
            height: 5.0mm;
        }

        .diagram-section {
            margin-top: 1.8mm;
            border: 0.28mm solid var(--option-border);
            border-radius: 3mm;
            background: rgba(0, 0, 0, 0.12);
            padding: 2.2mm;
            display: flex;
            flex-direction: column;
            gap: 1.8mm;
            min-height: 0;
        }

        .diagram-viewport {
            width: 100%;
            max-height: 60mm;
            min-height: 40mm;
            border-radius: 2.2mm;
            background: rgba(255, 255, 255, 0.95);
            border: 0.22mm solid rgba(15, 23, 42, 0.12);
            position: relative;
            overflow: hidden;
            display: flex;
            align-items: center;
            justify-content: center;
        }

        .diagram-image {
            width: 100%;
            height: 100%;
            object-fit: contain;
            background: rgba(255, 255, 255, 0.92);
        }

        .diagram-image-cropped {
            position: absolute;
            max-width: none;
            max-height: none;
            object-fit: fill;
        }

        /* Placeholder when diagram image file cannot be loaded */
        .diagram-viewport-placeholder {
            background: rgba(15, 23, 42, 0.25) !important;
            border: 0.3mm dashed var(--option-border) !important;
        }

        .diagram-placeholder-text {
            font-size: 3.6mm;
            color: var(--footer);
            font-weight: 600;
            letter-spacing: 0.03em;
        }

        .diagram-caption {
            font-size: 3.4mm;
            line-height: 1.25;
            color: var(--footer);
        }

        .options-panel {
            padding: 5.2mm;
            display: grid;
            align-content: start;
            gap: 2.8mm;
            min-height: 0;
            overflow: hidden;
        }

        .option-card {
            border: 0.28mm solid var(--option-border);
            border-radius: 3.2mm;
            background: var(--option-bg);
            padding: 2.6mm 3.2mm;
            min-height: 0;
        }

        .option-head {
            font-family: "Segoe UI", "Helvetica Neue", Arial, sans-serif;
            font-size: 3.2mm;
            letter-spacing: 0.05em;
            color: var(--option-label);
            margin-bottom: 1.4mm;
            font-weight: 700;
        }

        .option-line {
            display: grid;
            grid-template-columns: auto minmax(0, 1fr);
            column-gap: 2.2mm;
            align-items: start;
        }

        .option-number {
            font-family: "Segoe UI", "Helvetica Neue", Arial, sans-serif;
            font-size: 5.0mm;
            line-height: 1.2;
            color: var(--option-label);
            font-weight: 800;
            white-space: nowrap;
        }

        .option-content {
            min-width: 0;
        }

        .option-hindi {
            margin-top: 1.2mm;
            font-size: 6.2mm;
            line-height: 1.35;
            color: var(--hindi);
            font-weight: 700;
            word-break: break-word;
        }

        .option-english {
            margin-top: 0.5mm;
            font-family: "Segoe UI", "Helvetica Neue", Arial, sans-serif;
            font-size: 5.6mm;
            line-height: 1.35;
            color: var(--english);
            font-weight: 600;
            word-break: break-word;
        }

        .option-card .option-hindi:first-of-type,
        .option-card .option-english:first-of-type {
            margin-top: 0;
        }

        .option-card-empty {
            min-height: 48mm;
            display: flex;
            flex-direction: column;
            justify-content: center;
        }

        .sheet-footer {
            height: 11mm;
            padding: 0 10mm 5mm;
            display: flex;
            align-items: flex-end;
            justify-content: space-between;
            font-size: 3.6mm;
            font-weight: 600;
            color: var(--footer);
            letter-spacing: 0.02em;
        }

        .watermark {
            position: absolute;
            width: 120mm;
            max-width: 70%;
            inset: 50% auto auto 50%;
            transform: translate(-50%, -45%);
            opacity: var(--watermark-opacity);
            pointer-events: none;
            z-index: 1;
            filter: grayscale(0.2);
        }

        .density-dense .question-hindi {
            font-size: 8.0mm;
            line-height: 1.35;
        }

        .density-dense .question-english {
            font-size: 6.0mm;
            line-height: 1.28;
        }

        .density-dense .question-type-tag {
            font-size: 2.8mm;
        }

        .density-dense .question-answer-tag {
            font-size: 2.8mm;
            padding: 1.2mm 2.8mm;
        }

        .density-dense .option-hindi {
            font-size: 5.6mm;
            line-height: 1.35;
        }

        .density-dense .option-english {
            font-size: 5.0mm;
            line-height: 1.28;
        }

        .density-dense .match-row-english {
            font-size: 4.2mm;
            line-height: 1.26;
        }

        .density-dense .match-row-hindi {
            font-size: 4.8mm;
            line-height: 1.26;
        }

        .density-dense .diagram-image {
            max-height: 52mm;
        }

        .density-compact .question-hindi {
            font-size: 7.2mm;
            line-height: 1.35;
        }

        .density-compact .question-english {
            font-size: 5.4mm;
            line-height: 1.28;
        }

        .density-compact .question-copy {
            gap: 0.6mm;
        }

        .density-compact .question-copy-hindi {
            margin-top: 0.8mm;
        }

        .density-compact .question-copy-english {
            margin-top: 0.45mm;
        }

        .density-compact .question-hindi-line--detail,
        .density-compact .question-hindi-line--continuation {
            font-size: 0.88em;
            line-height: 1.35;
        }

        .density-compact .question-hindi-line--instruction {
            font-size: 0.78em;
            line-height: 1.35;
        }

        .density-compact .question-english-line--detail,
        .density-compact .question-english-line--continuation {
            font-size: 0.88em;
            line-height: 1.35;
        }

        .density-compact .question-english-line--instruction {
            font-size: 0.78em;
            line-height: 1.35;
        }

        .density-compact .question-type-tag {
            font-size: 2.6mm;
            padding: 1.2mm 2.6mm;
        }

        .density-compact .question-answer-tag {
            font-size: 2.5mm;
            padding: 1.1mm 2.4mm;
        }

        .density-compact .option-hindi {
            font-size: 5.2mm;
            line-height: 1.35;
        }

        .density-compact .option-english {
            font-size: 4.6mm;
            line-height: 1.28;
        }

        .density-compact .options-panel {
            gap: 2.2mm;
            padding: 4.4mm;
        }

        .density-compact .option-card {
            padding: 1.7mm 2.1mm;
        }

        .density-compact .diagram-image {
            max-height: 36mm;
        }

        .density-dense .diagram-viewport {
            min-height: 30mm;
            max-height: 46mm;
        }

        .density-compact .diagram-viewport {
            min-height: 24mm;
            max-height: 36mm;
        }

        .density-compact .match-row-english {
            font-size: 4.0mm;
            line-height: 1.24;
        }

        .density-compact .match-row-hindi {
            font-size: 4.6mm;
            line-height: 1.24;
        }

        /* ── GREEN BOARD TEMPLATE OVERRIDES ──────────────────────── */

        .sheet-board {
            background: none !important;
            position: relative !important;
            --board-question-hindi-size: 82px;
            --board-question-english-size: 66px;
            --board-detail-hindi-size: 64px;
            --board-detail-english-size: 54px;
            --board-match-hindi-size: 42px;
            --board-match-english-size: 38px;
            --board-option-hindi-size: 68px;
            --board-option-english-size: 58px;
        }

        .sheet-board.question-type-mcq {
            --board-question-hindi-size: 66px;
            --board-question-english-size: 54px;
            --board-detail-hindi-size: 60px;
            --board-detail-english-size: 50px;
            --board-option-hindi-size: 64px;
            --board-option-english-size: 54px;
        }

        .sheet-board.question-type-mcq:not(.content-option-heavy) {
            --board-question-hindi-size: 66px;
            --board-question-english-size: 54px;
            --board-detail-hindi-size: 64px;
            --board-detail-english-size: 54px;
            --board-option-hindi-size: 68px;
            --board-option-english-size: 58px;
        }

        .sheet-board.question-type-mcq.content-question-heavy {
            --board-question-hindi-size: 56px;
            --board-question-english-size: 46px;
            --board-detail-hindi-size: 54px;
            --board-detail-english-size: 44px;
            --board-option-hindi-size: 64px;
            --board-option-english-size: 54px;
        }

        .sheet-board.question-type-mcq.content-option-heavy {
            --board-question-hindi-size: 58px;
            --board-question-english-size: 48px;
            --board-detail-hindi-size: 48px;
            --board-detail-english-size: 40px;
            --board-option-hindi-size: 46px;
            --board-option-english-size: 38px;
        }

        .sheet-board.question-type-mcq.density-dense.content-option-heavy {
            --board-question-hindi-size: 54px;
            --board-question-english-size: 44px;
            --board-detail-hindi-size: 44px;
            --board-detail-english-size: 37px;
            --board-option-hindi-size: 40px;
            --board-option-english-size: 34px;
        }

        .sheet-board.question-type-mcq.density-compact.content-option-heavy {
            --board-question-hindi-size: 50px;
            --board-question-english-size: 40px;
            --board-detail-hindi-size: 40px;
            --board-detail-english-size: 34px;
            --board-option-hindi-size: 34px;
            --board-option-english-size: 29px;
        }

        .sheet-board.question-type-match-column {
            --board-question-hindi-size: 58px;
            --board-question-english-size: 46px;
            --board-detail-hindi-size: 38px;
            --board-detail-english-size: 32px;
            --board-match-hindi-size: 34px;
            --board-match-english-size: 30px;
            --board-option-hindi-size: 46px;
            --board-option-english-size: 40px;
        }

        .sheet-board.question-type-match-column.content-question-heavy,
        .sheet-board.question-type-match-column.content-list-heavy,
        .sheet-board.question-type-match-column.density-dense {
            --board-question-hindi-size: 50px;
            --board-question-english-size: 40px;
            --board-detail-hindi-size: 34px;
            --board-detail-english-size: 29px;
            --board-match-hindi-size: 30px;
            --board-match-english-size: 27px;
            --board-option-hindi-size: 42px;
            --board-option-english-size: 36px;
        }

        .sheet-board.question-type-match-column.density-compact {
            --board-question-hindi-size: 44px;
            --board-question-english-size: 35px;
            --board-detail-hindi-size: 31px;
            --board-detail-english-size: 27px;
            --board-match-hindi-size: 27px;
            --board-match-english-size: 24px;
            --board-option-hindi-size: 38px;
            --board-option-english-size: 33px;
        }

        .sheet-board .sheet-header {
            position: absolute !important;
            top: 0 !important;
            left: 0 !important;
            right: 0 !important;
            border-bottom: none !important;
            background: rgba(17, 74, 37, 0.96) !important;
            padding: 22px 42px !important;
            display: flex !important;
            align-items: center !important;
            justify-content: space-between !important;
            height: auto !important;
        }

        .sheet-hd-1920.sheet-board {
            padding: 0 !important;
        }

        .sheet-board .sheet-bg {
            position: absolute !important;
            inset: 0 !important;
            width: 100% !important;
            height: 100% !important;
            object-fit: cover !important;
            z-index: 0 !important;
        }

        .sheet-hd-1920.sheet-board .sheet-body {
            position: relative !important;
            z-index: 5 !important;
            display: grid !important;
            grid-template-columns: minmax(0, 0.62fr) minmax(0, 1.38fr) !important;
            grid-template-rows: auto 1fr !important;
            padding: 118px 82px 132px 82px !important;
            box-sizing: border-box !important;
            overflow: hidden !important;
            gap: 32px 0 !important;
            align-items: stretch !important;
        }

        .sheet-board .logo {
            height: 84px !important;
        }

        .sheet-board .institute {
            color: #ffffff !important;
            font-size: 52px !important;
            line-height: 1.04 !important;
            letter-spacing: 0.01em !important;
            text-shadow: 0 3px 12px rgba(0, 0, 0, 0.35) !important;
        }

        .sheet-board .question-panel,
        .sheet-board .options-panel,
        .sheet-board .option-card,
        .sheet-board .structure-block,
        .sheet-board .match-col,
        .sheet-board .diagram-section {
            border: none !important;
            background: transparent !important;
            box-shadow: none !important;
        }

        .sheet-board .question-panel {
            grid-column: 2 !important;
            grid-row: 1 !important;
            padding: 10px 0 0 !important;
            gap: 18px !important;
            min-height: 38% !important;
            justify-content: flex-start !important;
            flex: 0 0 auto !important;
        }

        .sheet-board .question-head-row {
            margin-bottom: 4px !important;
        }

        .sheet-board .question-meta-tags {
            display: none !important;
        }

        .sheet-board .question-index {
            color: #ffffff !important;
            border: 0.28mm solid rgba(255,255,255,0.4) !important;
            background: rgba(0, 0, 0, 0.22) !important;
            font-size: 38px !important;
            padding: 11px 26px !important;
        }

        .sheet-board .question-hindi {
            color: #facc15 !important;
            font-size: var(--board-question-hindi-size) !important;
            line-height: 1.35 !important;
            margin-top: 6px !important;
            margin-bottom: 6px !important;
            overflow-wrap: anywhere !important;
        }

        .sheet-board .question-english {
            color: #fde047 !important;
            font-size: var(--board-question-english-size) !important;
            line-height: 1.28 !important;
            margin-top: 10px !important;
            margin-bottom: 6px !important;
            overflow-wrap: anywhere !important;
        }

        .sheet-board .question-hindi-line--detail,
        .sheet-board .question-hindi-line--continuation {
            color: #facc15 !important;
            font-size: var(--board-detail-hindi-size) !important;
            line-height: 1.16 !important;
            overflow-wrap: anywhere !important;
        }

        .sheet-board .question-english-line--detail,
        .sheet-board .question-english-line--continuation {
            color: #fde047 !important;
            font-size: var(--board-detail-english-size) !important;
            line-height: 1.16 !important;
            overflow-wrap: anywhere !important;
        }

        .sheet-board .question-hindi-line--instruction,
        .sheet-board .question-english-line--instruction,
        .sheet-board .structure-head,
        .sheet-board .structure-note,
        .sheet-board .match-col-title,
        .sheet-board .match-row-id,
        .sheet-board .match-row-english,
        .sheet-board .match-row-hindi,
        .sheet-board .statement-label,
        .sheet-board .statement-hindi,
        .sheet-board .statement-english,
        .sheet-board .reference-list-label,
        .sheet-board .reference-list-hindi,
        .sheet-board .reference-list-english,
        .sheet-board .reference-table-head,
        .sheet-board .reference-table-cell,
        .sheet-board .diagram-caption {
            color: #fde68a !important;
        }

        .sheet-board .structure-head {
            font-size: 28px !important;
            line-height: 1.02 !important;
            margin-bottom: 12px !important;
            letter-spacing: 0.05em !important;
        }

        .sheet-board .match-col-title,
        .sheet-board .reference-table-head,
        .sheet-board .statement-label,
        .sheet-board .reference-list-label {
            font-size: 26px !important;
            line-height: 1.02 !important;
            letter-spacing: 0.04em !important;
        }

        .sheet-board .match-row-id {
            font-size: 20px !important;
        }

        .sheet-board .match-row-english,
        .sheet-board .statement-english,
        .sheet-board .reference-list-english,
        .sheet-board .reference-table-cell,
        .sheet-board .diagram-caption {
            font-size: var(--board-match-english-size) !important;
            line-height: 1.08 !important;
        }

        .sheet-board .match-row-hindi,
        .sheet-board .statement-hindi,
        .sheet-board .reference-list-hindi {
            font-size: var(--board-match-hindi-size) !important;
            line-height: 1.08 !important;
        }

        .sheet-board .options-panel {
            grid-column: 2 !important;
            grid-row: 2 !important;
            padding: 6px 25px 0 0 !important;
            flex: 1 1 auto !important;
            display: flex !important;
            flex-direction: column !important;
            justify-content: flex-start !important;
            gap: 28px !important;
            width: 100% !important;
            height: 100% !important;
            min-width: 0 !important;
            margin: 0 !important;
            box-sizing: border-box !important;
            align-items: flex-end !important;
        }

        .sheet-board.content-option-heavy .options-panel {
            justify-content: flex-start !important;
        }

        .sheet-board .option-card {
            padding: 0 !important;
            gap: 5px !important;
            justify-content: flex-start !important;
            min-height: 0 !important;
            height: auto !important;
            width: min(100%, 560px) !important;
            display: flex !important;
            flex-direction: column !important;
            align-items: flex-start !important;
            margin: 0 !important;
            align-self: flex-end !important;
        }

        .sheet-board .option-head {
            display: none !important;
        }

        .sheet-board .option-line {
            width: 100% !important;
            column-gap: 14px !important;
        }

        .sheet-board .option-number {
            color: #fde047 !important;
            font-size: 40px !important;
            line-height: 1.04 !important;
        }

        .sheet-board .option-hindi {
            color: #facc15 !important;
            font-size: var(--board-option-hindi-size) !important;
            line-height: 1.35 !important;
            margin: 0 !important;
            white-space: pre-wrap !important;
        }

        .sheet-board .option-english {
            color: #fde047 !important;
            font-size: var(--board-option-english-size) !important;
            line-height: 1.28 !important;
            margin: 0 !important;
            white-space: pre-wrap !important;
        }

        .sheet-board .watermark {
            width: 30% !important;
            right: 8% !important;
            bottom: 8% !important;
            opacity: 0.07 !important;
        }

        .sheet-hd-1920.sheet-board.question-type-match-column .sheet-body {
            grid-template-columns: var(--board-match-body-columns, minmax(0, 0.34fr) minmax(0, 1.02fr) minmax(0, 0.64fr)) !important;
            grid-template-rows: 1fr !important;
            padding: var(--board-match-body-padding, 118px 32px 132px 72px) !important;
            gap: 0 var(--board-match-body-gap, 24px) !important;
            align-items: stretch !important;
        }

        .sheet-hd-1920.sheet-board.question-type-mcq .sheet-body {
            grid-template-columns: var(--board-mcq-body-columns, minmax(0, 0.16fr) minmax(0, 0.98fr) minmax(0, 0.86fr)) !important;
            grid-template-rows: 1fr !important;
            padding: var(--board-mcq-body-padding, 112px 24px 126px 54px) !important;
            gap: 0 var(--board-mcq-body-gap, 18px) !important;
            align-items: stretch !important;
        }

        .sheet-hd-1920.sheet-board.question-type-mcq.content-option-heavy .sheet-body {
            grid-template-columns: var(--board-mcq-body-columns, minmax(0, 0.14fr) minmax(0, 0.72fr) minmax(0, 1.14fr)) !important;
            padding: var(--board-mcq-body-padding, 112px 24px 126px 54px) !important;
            gap: 0 var(--board-mcq-body-gap, 18px) !important;
        }

        .sheet-hd-1920.sheet-board.question-type-mcq:not(.content-option-heavy) .sheet-body {
            grid-template-columns: var(--board-mcq-body-columns, minmax(0, 0.14fr) minmax(0, 1.18fr) minmax(0, 0.68fr)) !important;
            padding: var(--board-mcq-body-padding, 112px 24px 126px 54px) !important;
            gap: 0 var(--board-mcq-body-gap, 20px) !important;
        }

        .sheet-hd-1920.sheet-board.question-type-mcq.content-question-heavy:not(.content-option-heavy) .sheet-body {
            grid-template-columns: var(--board-mcq-body-columns, minmax(0, 0.14fr) minmax(0, 1.24fr) minmax(0, 0.62fr)) !important;
            padding: var(--board-mcq-body-padding, 112px 24px 126px 54px) !important;
            gap: 0 var(--board-mcq-body-gap, 22px) !important;
        }

        .sheet-hd-1920.sheet-board.question-type-mcq.content-list-heavy:not(.content-option-heavy) .sheet-body {
            grid-template-columns: var(--board-mcq-body-columns, minmax(0, 0.08fr) minmax(0, 1.42fr) minmax(0, 0.46fr)) !important;
            padding: var(--board-mcq-body-padding, 112px 24px 126px 54px) !important;
            gap: 0 var(--board-mcq-body-gap, 18px) !important;
        }

        .sheet-hd-1920.sheet-board.question-type-mcq.content-reference-list:not(.content-option-heavy) .sheet-body {
            grid-template-columns: var(--board-mcq-body-columns, minmax(0, 0.06fr) minmax(0, 1.5fr) minmax(0, 0.4fr)) !important;
            padding: var(--board-mcq-body-padding, 108px 22px 122px 50px) !important;
            gap: 0 var(--board-mcq-body-gap, 16px) !important;
        }

        .sheet-board.question-type-mcq .question-panel {
            grid-column: 2 !important;
            grid-row: 1 !important;
            min-height: 0 !important;
            height: 100% !important;
            overflow: hidden !important;
            padding-top: 16px !important;
            gap: var(--board-mcq-question-gap, 20px) !important;
        }

        .sheet-board.question-type-mcq .question-copy-hindi,
        .sheet-board.question-type-mcq .question-copy-english {
            gap: var(--board-mcq-question-copy-gap, 14px) !important;
        }

        .sheet-board.question-type-mcq .question-copy-english {
            margin-top: var(--board-mcq-question-english-margin, 42px) !important;
        }

        .sheet-board.question-type-mcq .question-hindi {
            line-height: 1.2 !important;
        }

        .sheet-board.question-type-mcq .question-english {
            line-height: 1.2 !important;
        }

        .sheet-board.question-type-mcq.content-question-heavy .question-hindi,
        .sheet-board.question-type-mcq.content-question-heavy .question-english {
            line-height: 1.2 !important;
        }

        .sheet-board.question-type-mcq.content-question-heavy .question-panel {
            gap: var(--board-mcq-question-gap, 16px) !important;
        }

        .sheet-board.question-type-mcq.content-question-heavy .question-copy-english {
            margin-top: var(--board-mcq-question-english-margin, 36px) !important;
        }

        .sheet-board.question-type-mcq.content-list-heavy .question-panel {
            gap: var(--board-mcq-question-gap, 8px) !important;
        }

        .sheet-board.question-type-mcq.content-list-heavy .question-copy-hindi,
        .sheet-board.question-type-mcq.content-list-heavy .question-copy-english {
            gap: var(--board-mcq-question-copy-gap, 6px) !important;
        }

        .sheet-board.question-type-mcq.content-list-heavy .question-copy-english {
            margin-top: var(--board-mcq-question-english-margin, 10px) !important;
        }

        .sheet-board.question-type-mcq.content-reference-list .question-panel {
            gap: var(--board-mcq-question-gap, 6px) !important;
        }

        .sheet-board.question-type-mcq.content-reference-list .question-copy-hindi,
        .sheet-board.question-type-mcq.content-reference-list .question-copy-english {
            gap: var(--board-mcq-question-copy-gap, 4px) !important;
        }

        .sheet-board.question-type-mcq.content-reference-list .question-copy-english {
            margin-top: var(--board-mcq-question-english-margin, 8px) !important;
        }

        .sheet-board.question-type-mcq.content-reference-list .question-hindi {
            font-size: 44px !important;
            line-height: 1.12 !important;
        }

        .sheet-board.question-type-mcq.content-reference-list .question-english {
            font-size: 31px !important;
            line-height: 1.1 !important;
        }

        .sheet-board.question-type-mcq.content-reference-list .question-hindi-line--detail,
        .sheet-board.question-type-mcq.content-reference-list .question-hindi-line--continuation {
            font-size: 28px !important;
            line-height: 1.14 !important;
        }

        .sheet-board.question-type-mcq.content-reference-list .question-english-line--detail,
        .sheet-board.question-type-mcq.content-reference-list .question-english-line--continuation {
            font-size: 22px !important;
            line-height: 1.12 !important;
        }

        .sheet-board.question-type-mcq.content-list-heavy .question-hindi {
            font-size: var(--board-question-hindi-size, 48px) !important;
            line-height: 1.14 !important;
        }

        .sheet-board.question-type-mcq.content-list-heavy .question-english {
            font-size: var(--board-question-english-size, 34px) !important;
            line-height: 1.14 !important;
        }

        .sheet-board.question-type-mcq.content-list-heavy .question-hindi-line--detail,
        .sheet-board.question-type-mcq.content-list-heavy .question-hindi-line--continuation {
            font-size: var(--board-detail-hindi-size, 32px) !important;
            line-height: 1.18 !important;
        }

        .sheet-board.question-type-mcq.content-list-heavy .question-english-line--detail,
        .sheet-board.question-type-mcq.content-list-heavy .question-english-line--continuation {
            font-size: var(--board-detail-english-size, 25px) !important;
            line-height: 1.18 !important;
        }

        .sheet-board.question-type-mcq.content-list-heavy .structure-block {
            padding: 10px 12px !important;
            gap: 6px !important;
            margin-top: 2px !important;
        }

        .sheet-board.question-type-mcq.content-list-heavy .structure-head {
            font-size: 20px !important;
            margin-bottom: 4px !important;
            line-height: 1 !important;
        }

        .sheet-board.question-type-mcq.content-list-heavy .statement-grid {
            gap: 8px !important;
        }

        .sheet-board.question-type-mcq.content-list-heavy .statement-label {
            font-size: 18px !important;
            min-width: 20px !important;
            line-height: 1 !important;
        }

        .sheet-board.question-type-mcq.content-list-heavy .statement-hindi {
            font-size: 28px !important;
            line-height: 1.12 !important;
        }

        .sheet-board.question-type-mcq.content-list-heavy .statement-english {
            font-size: 22px !important;
            line-height: 1.12 !important;
        }

        .sheet-board.question-type-mcq.content-list-heavy .structure-block-reference-list {
            padding: 8px 10px !important;
            gap: 4px !important;
        }

        .sheet-board.question-type-mcq.content-list-heavy .structure-block-reference-list .structure-head {
            font-size: 16px !important;
            margin-bottom: 2px !important;
            opacity: 0.88 !important;
        }

        .sheet-board.question-type-mcq.content-list-heavy .reference-list-grid {
            gap: 8px !important;
        }

        .sheet-board.question-type-mcq.content-list-heavy .reference-list-grid--two-column {
            gap: 8px 14px !important;
        }

        .sheet-board.question-type-mcq.content-list-heavy .reference-list-item {
            gap: 10px !important;
        }

        .sheet-board.question-type-mcq.content-list-heavy .reference-list-label {
            font-size: 22px !important;
            min-width: 22px !important;
            line-height: 1 !important;
        }

        .sheet-board.question-type-mcq.content-list-heavy .reference-list-hindi {
            font-size: 34px !important;
            line-height: 1.1 !important;
        }

        .sheet-board.question-type-mcq.content-list-heavy .reference-list-english {
            font-size: 26px !important;
            line-height: 1.08 !important;
        }

        .sheet-board.question-type-mcq.content-list-heavy .options-panel {
            gap: 16px !important;
            padding: 28px 12px 18px 0 !important;
        }

        .sheet-board.question-type-mcq.content-reference-list .options-panel {
            gap: 12px !important;
            padding: 22px 8px 14px 0 !important;
        }

        .sheet-board.question-type-mcq.content-reference-list .option-card {
            width: min(100%, 360px) !important;
        }

        .sheet-board.question-type-mcq.content-list-heavy .option-card {
            width: min(100%, 420px) !important;
        }

        .sheet-board.question-type-mcq .options-panel {
            grid-column: 3 !important;
            grid-row: 1 !important;
            height: 100% !important;
            min-height: 0 !important;
            padding: var(--board-mcq-options-padding, 90px 25px 42px 0) !important;
            justify-content: var(--board-mcq-options-justify, space-between) !important;
            align-items: flex-end !important;
            gap: var(--board-mcq-options-gap, 22px) !important;
            overflow: hidden !important;
        }

        .sheet-board.question-type-mcq.content-option-heavy .options-panel {
            padding: var(--board-mcq-options-padding, 58px 14px 18px 0) !important;
            gap: var(--board-mcq-options-gap, 10px) !important;
            justify-content: var(--board-mcq-options-justify, space-between) !important;
        }

        .sheet-board.question-type-mcq:not(.content-option-heavy) .options-panel {
            justify-content: var(--board-mcq-options-justify, space-between) !important;
            gap: var(--board-mcq-options-gap, 20px) !important;
        }

        .sheet-board.question-type-mcq.content-question-heavy:not(.content-option-heavy) .options-panel {
            gap: var(--board-mcq-options-gap, 22px) !important;
        }

        .sheet-board.question-type-mcq .option-card {
            width: var(--board-mcq-option-card-width, min(100%, 660px)) !important;
            align-self: flex-end !important;
        }

        .sheet-board.question-type-mcq.content-option-heavy .option-card {
            width: var(--board-mcq-option-card-width, 100%) !important;
            max-width: none !important;
        }

        .sheet-board.question-type-mcq .option-line {
            column-gap: var(--board-mcq-option-line-gap, 14px) !important;
        }

        .sheet-board.question-type-mcq .option-number {
            font-size: var(--board-mcq-option-number-size, 40px) !important;
            line-height: 1.02 !important;
        }

        .sheet-board.question-type-mcq .option-hindi,
        .sheet-board.question-type-mcq .option-english {
            line-height: var(--board-mcq-option-line-height-hindi, 1.12) !important;
        }

        .sheet-board.question-type-mcq .option-english {
            line-height: var(--board-mcq-option-line-height-english, 1.08) !important;
        }

        .sheet-board.question-type-match-column .question-panel {
            grid-column: 2 !important;
            grid-row: 1 !important;
            min-height: 0 !important;
            height: 100% !important;
            overflow: hidden !important;
            padding-top: 12px !important;
            gap: var(--board-match-question-gap, 14px) !important;
        }

        .sheet-board.question-type-match-column .question-copy-hindi,
        .sheet-board.question-type-match-column .question-copy-english {
            gap: var(--board-match-question-copy-gap, 8px) !important;
        }

        .sheet-board.question-type-match-column .question-copy-english {
            margin-top: var(--board-match-question-english-margin, 18px) !important;
        }

        .sheet-board.question-type-match-column .structure-block {
            gap: var(--board-match-structure-gap, 10px) !important;
        }

        .sheet-board.question-type-match-column .match-grid {
            gap: var(--board-match-grid-gap, 10px) !important;
        }

        .sheet-board.question-type-match-column .options-panel {
            grid-column: 3 !important;
            grid-row: 1 !important;
            height: 100% !important;
            min-height: 0 !important;
            padding: var(--board-match-options-padding, 118px 25px 0 0) !important;
            justify-content: flex-end !important;
            align-items: flex-end !important;
            gap: var(--board-match-options-gap, 18px) !important;
            overflow: hidden !important;
        }

        .sheet-board.question-type-match-column .option-card {
            width: var(--board-match-option-card-width, min(100%, 440px)) !important;
        }

        .sheet-board.question-type-match-column .option-hindi {
            font-size: var(--board-option-hindi-size) !important;
            line-height: 1.06 !important;
        }

        .sheet-board.question-type-match-column .option-english {
            font-size: var(--board-option-english-size) !important;
            line-height: 1.06 !important;
        }

        .sheet-board.density-dense .sheet-body {
            grid-template-columns: minmax(0, 0.58fr) minmax(0, 1.42fr) !important;
            padding: 112px 74px 124px 74px !important;
            gap: 24px 0 !important;
        }

        .sheet-hd-1920.sheet-board.question-type-match-column.density-dense .sheet-body {
            grid-template-columns: var(--board-match-body-columns, minmax(0, 0.3fr) minmax(0, 1.04fr) minmax(0, 0.66fr)) !important;
            padding: var(--board-match-body-padding, 112px 28px 124px 64px) !important;
            gap: 0 var(--board-match-body-gap, 18px) !important;
        }

        .sheet-hd-1920.sheet-board.question-type-mcq.density-dense .sheet-body,
        .sheet-hd-1920.sheet-board.question-type-mcq.density-compact .sheet-body {
            grid-template-columns: var(--board-mcq-body-columns, minmax(0, 0.16fr) minmax(0, 0.98fr) minmax(0, 0.86fr)) !important;
            grid-template-rows: 1fr !important;
            padding: var(--board-mcq-body-padding, 112px 24px 126px 54px) !important;
            gap: 0 var(--board-mcq-body-gap, 18px) !important;
        }

        .sheet-hd-1920.sheet-board.question-type-mcq.density-dense.content-option-heavy .sheet-body,
        .sheet-hd-1920.sheet-board.question-type-mcq.density-compact.content-option-heavy .sheet-body {
            grid-template-columns: var(--board-mcq-body-columns, minmax(0, 0.12fr) minmax(0, 0.64fr) minmax(0, 1.24fr)) !important;
            padding: var(--board-mcq-body-padding, 108px 18px 116px 46px) !important;
            gap: 0 var(--board-mcq-body-gap, 14px) !important;
        }

        .sheet-hd-1920.sheet-board.question-type-mcq.density-dense:not(.content-option-heavy) .sheet-body,
        .sheet-hd-1920.sheet-board.question-type-mcq.density-compact:not(.content-option-heavy) .sheet-body {
            grid-template-columns: var(--board-mcq-body-columns, minmax(0, 0.14fr) minmax(0, 1.18fr) minmax(0, 0.68fr)) !important;
            padding: var(--board-mcq-body-padding, 112px 24px 126px 54px) !important;
            gap: 0 var(--board-mcq-body-gap, 20px) !important;
        }

        .sheet-hd-1920.sheet-board.question-type-mcq.density-dense.content-question-heavy:not(.content-option-heavy) .sheet-body,
        .sheet-hd-1920.sheet-board.question-type-mcq.density-compact.content-question-heavy:not(.content-option-heavy) .sheet-body {
            grid-template-columns: var(--board-mcq-body-columns, minmax(0, 0.14fr) minmax(0, 1.24fr) minmax(0, 0.62fr)) !important;
            padding: var(--board-mcq-body-padding, 112px 24px 126px 54px) !important;
            gap: 0 var(--board-mcq-body-gap, 22px) !important;
        }

        .sheet-hd-1920.sheet-board.question-type-mcq.density-dense.content-list-heavy:not(.content-option-heavy) .sheet-body,
        .sheet-hd-1920.sheet-board.question-type-mcq.density-compact.content-list-heavy:not(.content-option-heavy) .sheet-body {
            grid-template-columns: var(--board-mcq-body-columns, minmax(0, 0.12fr) minmax(0, 1.28fr) minmax(0, 0.6fr)) !important;
            padding: var(--board-mcq-body-padding, 112px 24px 126px 54px) !important;
            gap: 0 var(--board-mcq-body-gap, 24px) !important;
        }

        .sheet-board.density-dense .options-panel {
            gap: 22px !important;
            padding: 6px 25px 0 0 !important;
            width: 100% !important;
            margin: 0 !important;
        }

        .sheet-board.question-type-mcq.density-dense .question-panel,
        .sheet-board.question-type-mcq.density-compact .question-panel {
            min-height: 0 !important;
            height: 100% !important;
            padding-top: 16px !important;
            gap: var(--board-mcq-question-gap, 20px) !important;
        }

        .sheet-board.question-type-mcq.density-dense.content-list-heavy .question-panel,
        .sheet-board.question-type-mcq.density-compact.content-list-heavy .question-panel {
            gap: var(--board-mcq-question-gap, 12px) !important;
        }

        .sheet-board.question-type-mcq.density-dense .options-panel,
        .sheet-board.question-type-mcq.density-compact .options-panel {
            padding: var(--board-mcq-options-padding, 90px 25px 42px 0) !important;
            gap: var(--board-mcq-options-gap, 22px) !important;
            justify-content: var(--board-mcq-options-justify, space-between) !important;
            align-items: flex-end !important;
        }

        .sheet-board.question-type-mcq.density-dense.content-option-heavy .options-panel,
        .sheet-board.question-type-mcq.density-compact.content-option-heavy .options-panel {
            padding: var(--board-mcq-options-padding, 42px 12px 12px 0) !important;
            gap: var(--board-mcq-options-gap, 8px) !important;
        }

        .sheet-board.question-type-mcq.density-compact.content-option-heavy .options-panel {
            padding: var(--board-mcq-options-padding, 28px 10px 10px 0) !important;
            gap: var(--board-mcq-options-gap, 6px) !important;
        }

        .sheet-board.question-type-mcq.density-dense:not(.content-option-heavy) .options-panel,
        .sheet-board.question-type-mcq.density-compact:not(.content-option-heavy) .options-panel {
            justify-content: var(--board-mcq-options-justify, space-between) !important;
            gap: var(--board-mcq-options-gap, 20px) !important;
        }

        .sheet-board.question-type-mcq.density-dense .option-card,
        .sheet-board.question-type-mcq.density-compact .option-card {
            width: var(--board-mcq-option-card-width, min(100%, 660px)) !important;
        }

        .sheet-board.question-type-mcq.density-dense.content-option-heavy .option-card,
        .sheet-board.question-type-mcq.density-compact.content-option-heavy .option-card {
            width: var(--board-mcq-option-card-width, 100%) !important;
            max-width: none !important;
        }

        .sheet-board.question-type-mcq.density-dense.content-option-heavy .option-number {
            font-size: var(--board-mcq-option-number-size, 32px) !important;
        }

        .sheet-board.question-type-mcq.density-compact.content-option-heavy .option-number {
            font-size: var(--board-mcq-option-number-size, 30px) !important;
        }

        .sheet-board.question-type-mcq.density-dense.content-option-heavy .option-hindi,
        .sheet-board.question-type-mcq.density-dense.content-option-heavy .option-english {
            line-height: var(--board-mcq-option-line-height-hindi, 1.04) !important;
        }

        .sheet-board.question-type-mcq.density-dense.content-option-heavy .option-english {
            line-height: var(--board-mcq-option-line-height-english, 1.03) !important;
        }

        .sheet-board.question-type-mcq.density-compact.content-option-heavy .option-hindi,
        .sheet-board.question-type-mcq.density-compact.content-option-heavy .option-english {
            line-height: var(--board-mcq-option-line-height-hindi, 1.02) !important;
        }

        .sheet-board.question-type-mcq.density-compact.content-option-heavy .option-english {
            line-height: var(--board-mcq-option-line-height-english, 1.01) !important;
        }

        .sheet-board.question-type-match-column.density-dense .options-panel {
            padding: var(--board-match-options-padding, 112px 25px 0 0) !important;
            gap: var(--board-match-options-gap, 14px) !important;
        }

        .sheet-board.question-type-match-column.density-dense .option-card {
            width: var(--board-match-option-card-width, min(100%, 410px)) !important;
        }

        .sheet-board.density-compact .sheet-body {
            grid-template-columns: minmax(0, 0.52fr) minmax(0, 1.48fr) !important;
            padding: 108px 64px 118px 64px !important;
            gap: 20px 0 !important;
        }

        .sheet-hd-1920.sheet-board.question-type-match-column.density-compact .sheet-body {
            grid-template-columns: var(--board-match-body-columns, minmax(0, 0.28fr) minmax(0, 1.06fr) minmax(0, 0.66fr)) !important;
            padding: var(--board-match-body-padding, 106px 24px 116px 56px) !important;
            gap: 0 var(--board-match-body-gap, 16px) !important;
        }

        .sheet-board.density-compact .question-panel {
            min-height: 36% !important;
            gap: 12px !important;
        }

        .sheet-board.density-compact .options-panel {
            justify-content: flex-start !important;
            gap: 16px !important;
            padding: 4px 25px 0 0 !important;
            width: 100% !important;
            margin: 0 !important;
        }

        .sheet-board.density-compact .option-card {
            width: min(100%, 500px) !important;
            margin: 0 !important;
        }

        .sheet-board.question-type-match-column.density-compact .options-panel {
            padding: var(--board-match-options-padding, 102px 25px 0 0) !important;
            gap: var(--board-match-options-gap, 12px) !important;
        }

        .sheet-board.question-type-match-column.density-compact .option-card {
            width: var(--board-match-option-card-width, min(100%, 390px)) !important;
        }


        /* ── SIMPLE AUTHENTIC TEMPLATE OVERRIDES ─────────────────── */

        /* Full-opacity background image */
        .sheet-bg-full {
            opacity: 1 !important;
        }

        /* Sheet itself: no gradient overlay, just the texture, ensure relative positioning for absolute background */
        .sheet-simple {
            background: none !important;
            position: relative !important;
        }

        /* Header: bold background, rounded bottom corners, full width */
        .sheet-simple .sheet-header {
            position: absolute !important;
            top: 0 !important;
            left: 0 !important;
            right: 0 !important;
            border-bottom: none !important;
            background: rgba(0, 0, 0, 0.4) !important;
            border-bottom-left-radius: 40px !important;
            border-bottom-right-radius: 40px !important;
            padding: 20px 40px !important;
            display: flex !important;
            align-items: center !important;
            justify-content: space-between !important;
            height: auto !important;
        }

        /* Override outer padding so absolute elements anchor correctly */
        .sheet-hd-1920.sheet-simple {
            padding: 0 !important;
        }

        /* Ensure the background image spans the full physical 1920x1080 bounds */
        .sheet-simple .sheet-bg {
            position: absolute !important;
            top: 0 !important;
            left: 0 !important;
            width: 100% !important;
            height: 100% !important;
            object-fit: cover !important;
            z-index: 0 !important;
        }

        /* Keep the simple template's visual frame but let the shared HD layout drive geometry and typography. */
        .sheet-hd-1920.sheet-simple .sheet-body {
            position: relative !important;
            z-index: 5 !important;
            padding: 128px 86px 172px 170px !important;
            box-sizing: border-box !important;
            overflow: hidden !important;
            gap: 20px !important;
            grid-template-columns: 1.42fr 0.92fr !important;
        }

        /* Increase logo size in simple header */
        .sheet-simple .logo {
            height: 82px !important;
        }

        .sheet-hd-1920.sheet-simple .question-panel {
            padding: 26px 26px 20px 26px !important;
            gap: 16px !important;
        }

        .sheet-hd-1920.sheet-simple .options-panel {
            padding: 12px 6px 8px 8px !important;
            gap: 12px !important;
            justify-content: stretch !important;
        }

        .sheet-hd-1920.sheet-simple.density-normal .option-card {
            flex: 1 1 0 !important;
            justify-content: center !important;
        }

        .sheet-hd-1920.sheet-simple .question-index {
            font-size: 36px !important;
            padding: 10px 24px !important;
            color: #ffffff !important;
        }

        .sheet-hd-1920.sheet-simple .question-type-tag,
        .sheet-hd-1920.sheet-simple .question-answer-tag {
            font-size: 21px !important;
            padding: 8px 16px !important;
            color: #ffffff !important;
        }

        .sheet-hd-1920.sheet-simple .question-hindi {
            font-size: 70px !important;
            line-height: 1.14 !important;
            margin-top: 10px !important;
            margin-bottom: 6px !important;
            color: #facc15 !important;
        }

        .sheet-hd-1920.sheet-simple .question-english {
            font-size: 54px !important;
            line-height: 1.14 !important;
            margin-top: 12px !important;
            margin-bottom: 6px !important;
            color: #fef08a !important;
        }

        .sheet-hd-1920.sheet-simple .question-hindi-line--detail,
        .sheet-hd-1920.sheet-simple .question-hindi-line--continuation {
            font-size: 52px !important;
            line-height: 1.28 !important;
            color: #facc15 !important;
        }

        .sheet-hd-1920.sheet-simple .question-hindi-line--instruction {
            font-size: 36px !important;
            line-height: 1.1 !important;
            color: #fde68a !important;
        }

        .sheet-hd-1920.sheet-simple .question-english-line--detail,
        .sheet-hd-1920.sheet-simple .question-english-line--continuation {
            font-size: 36px !important;
            line-height: 1.12 !important;
            color: #fef08a !important;
        }

        .sheet-hd-1920.sheet-simple .question-english-line--instruction {
            font-size: 28px !important;
            line-height: 1.1 !important;
            color: #fef3c7 !important;
        }

        .sheet-hd-1920.sheet-simple .option-card {
            gap: 10px !important;
            padding-top: 10px !important;
            padding-bottom: 10px !important;
        }

        .sheet-hd-1920.sheet-simple .option-head {
            font-size: 26px !important;
            margin-bottom: 6px !important;
            color: #ffffff !important;
        }

        .sheet-hd-1920.sheet-simple .option-hindi {
            font-size: 42px !important;
            line-height: 1.14 !important;
            color: #facc15 !important;
        }

        .sheet-hd-1920.sheet-simple .option-english {
            font-size: 38px !important;
            line-height: 1.14 !important;
            color: #fef08a !important;
        }

        .sheet-hd-1920.sheet-simple.density-dense .question-hindi {
            font-size: 62px !important;
            line-height: 1.14 !important;
        }

        .sheet-hd-1920.sheet-simple.density-dense .question-english {
            font-size: 47px !important;
            line-height: 1.15 !important;
        }

        .sheet-hd-1920.sheet-simple.density-dense .question-hindi-line--detail,
        .sheet-hd-1920.sheet-simple.density-dense .question-hindi-line--continuation {
            font-size: 46px !important;
        }

        .sheet-hd-1920.sheet-simple.density-dense .question-english-line--detail,
        .sheet-hd-1920.sheet-simple.density-dense .question-english-line--continuation {
            font-size: 38px !important;
        }

        .sheet-hd-1920.sheet-simple.density-dense .option-hindi {
            font-size: 37px !important;
            line-height: 1.14 !important;
        }

        .sheet-hd-1920.sheet-simple.density-dense .option-english {
            font-size: 33px !important;
            line-height: 1.14 !important;
        }

        .sheet-hd-1920.sheet-simple.density-compact .sheet-body {
            grid-template-columns: 1.5fr 0.82fr !important;
            gap: 22px !important;
        }

        .sheet-hd-1920.sheet-simple.density-compact .question-panel {
            padding: 22px 24px 18px 24px !important;
            gap: 12px !important;
        }

        .sheet-hd-1920.sheet-simple.density-compact .options-panel {
            padding: 10px 4px 6px 8px !important;
            gap: 10px !important;
            justify-content: flex-start !important;
        }

        .sheet-hd-1920.sheet-simple.density-compact .question-hindi {
            font-size: 52px !important;
            line-height: 1.12 !important;
        }

        .sheet-hd-1920.sheet-simple.density-compact .question-english {
            font-size: 40px !important;
            line-height: 1.13 !important;
        }

        .sheet-hd-1920.sheet-simple.density-compact .question-hindi-line--detail,
        .sheet-hd-1920.sheet-simple.density-compact .question-hindi-line--continuation {
            font-size: 40px !important;
            line-height: 1.28 !important;
        }

        .sheet-hd-1920.sheet-simple.density-compact .question-english-line--detail,
        .sheet-hd-1920.sheet-simple.density-compact .question-english-line--continuation {
            font-size: 32px !important;
            line-height: 1.28 !important;
        }

        .sheet-hd-1920.sheet-simple.density-compact .option-hindi {
            font-size: 32px !important;
            line-height: 1.12 !important;
        }

        .sheet-hd-1920.sheet-simple.density-compact .option-english {
            font-size: 28px !important;
            line-height: 1.12 !important;
        }

        .sheet-hd-1920.sheet-simple.question-type-mcq.content-question-heavy:not(.content-option-heavy) .sheet-body {
            grid-template-columns: 1.58fr 0.74fr !important;
            gap: 18px !important;
        }

        .sheet-hd-1920.sheet-simple.question-type-mcq.content-list-heavy:not(.content-option-heavy) .sheet-body {
            grid-template-columns: 1.7fr 0.62fr !important;
            gap: 18px !important;
        }

        .sheet-hd-1920.sheet-simple.question-type-mcq.content-list-heavy .question-panel {
            padding: 20px 22px 16px 22px !important;
            gap: 10px !important;
        }

        .sheet-hd-1920.sheet-simple.question-type-mcq.content-list-heavy .question-copy-english {
            margin-top: 8px !important;
        }

        .sheet-hd-1920.sheet-simple.question-type-mcq.content-list-heavy .question-hindi {
            font-size: 48px !important;
            line-height: 1.14 !important;
        }

        .sheet-hd-1920.sheet-simple.question-type-mcq.content-list-heavy .question-english {
            font-size: 36px !important;
            line-height: 1.14 !important;
        }

        .sheet-hd-1920.sheet-simple.question-type-mcq.content-list-heavy .question-hindi-line--detail,
        .sheet-hd-1920.sheet-simple.question-type-mcq.content-list-heavy .question-hindi-line--continuation {
            font-size: 34px !important;
            line-height: 1.22 !important;
        }

        .sheet-hd-1920.sheet-simple.question-type-mcq.content-list-heavy .question-english-line--detail,
        .sheet-hd-1920.sheet-simple.question-type-mcq.content-list-heavy .question-english-line--continuation {
            font-size: 27px !important;
            line-height: 1.2 !important;
        }

        .sheet-hd-1920.sheet-simple.question-type-mcq.content-list-heavy .structure-block-statements {
            padding: 12px 14px !important;
        }

        .sheet-hd-1920.sheet-simple.question-type-mcq.content-list-heavy .statement-hindi {
            font-size: 28px !important;
            line-height: 1.2 !important;
        }

        .sheet-hd-1920.sheet-simple.question-type-mcq.content-list-heavy .statement-english {
            font-size: 23px !important;
            line-height: 1.18 !important;
        }

        /* Remove all panel borders and backgrounds */
        .sheet-simple .question-panel,
        .sheet-simple .options-panel {
            border: none !important;
            background: transparent !important;
        }

        /* Remove option card boxes */
        .sheet-simple .option-card {
            border: none !important;
            background: transparent !important;
            padding-left: 0 !important;
            padding-right: 0 !important;
        }

        /* Add a thin separator between options instead of boxes */
        .sheet-simple .option-card + .option-card {
            border-top: 0.25mm solid rgba(255,255,255,0.18) !important;
            padding-top: 1.8mm !important;
        }

        /* Remove structure block and match-column boxes */
        .sheet-simple .structure-block,
        .sheet-simple .match-col {
            border: none !important;
            background: transparent !important;
        }

        /* Remove question-index bubble border */
        .sheet-simple .question-index,
        .sheet-simple .question-type-tag,
        .sheet-simple .question-answer-tag {
            border: 0.25mm solid rgba(255,255,255,0.35) !important;
            background: rgba(0,0,0,0.25) !important;
        }

        /* Remove diagram section box */
        .sheet-simple .diagram-section {
            border: none !important;
            background: transparent !important;
        }

        ${hd1920LayoutOverrides}
    </style>
</head>
<body>
${slides}
</body>
</html>`;
}

export async function generatePdf(input: PdfInput): Promise<Buffer> {
    const template = resolvePdfTemplate(input.templateId, input.customTemplate);
    const pageSpec = resolvePageSpec(input.previewResolution);
    const imageCache = new Map<string, string>();
    const html = generateHtml(input, template, pageSpec, imageCache);
    console.log(`[PDF Generator] HTML String Length: ${(html.length / 1024 / 1024).toFixed(2)} MB`);

    const browser = await launchServerBrowser("slide/pdf generation");

    try {
        const page = await browser.newPage();
        await page.setViewport({
            width: pageSpec.viewportWidth,
            height: pageSpec.viewportHeight,
            deviceScaleFactor: 1,
        });
        // Write HTML to a temp file so Puppeteer loads it via file:// URL.
        // This bypasses the Chrome DevTools Protocol (CDP) 100 MB string limit
        // that causes a TargetCloseError when setContent() is called with huge payloads.
        const tmpFile = path.join(os.tmpdir(), `nexora-pdf-${Date.now()}-${Math.random().toString(36).slice(2)}.html`);
        try {
            await fsp.writeFile(tmpFile, html, "utf8");
            await page.goto(`file://${tmpFile}`, { waitUntil: "domcontentloaded", timeout: 120000 });
        } finally {
            // Best-effort cleanup (non-blocking)
            fsp.unlink(tmpFile).catch(() => { });
        }
        await page.emulateMediaType("screen");
        await page.evaluateHandle("document.fonts.ready");

        const pdf = await page.pdf({
            width: pageSpec.pdfWidth,
            height: pageSpec.pdfHeight,
            printBackground: true,
            preferCSSPageSize: true,
            margin: {
                top: "0mm",
                right: "0mm",
                bottom: "0mm",
                left: "0mm",
            },
            timeout: 120000,
        });

        return Buffer.from(pdf);
    } finally {
        await browser.close();
    }
}

export const TEMPLATES = PDF_TEMPLATES;
export type { PdfInput };
