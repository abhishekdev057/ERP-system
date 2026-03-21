import puppeteer from "puppeteer";
import { PdfData, Question } from "@/types/pdf";
import { getQuestionAnswerText, isQuestionMeaningful } from "@/lib/question-utils";

// ─── CSS (no external font imports - uses system fonts only for reliability) ──
const CSS = `
* { box-sizing: border-box; margin: 0; padding: 0; }

body {
    font-family: 'Times New Roman', Georgia, serif;
    font-size: 11pt;
    color: #111;
    background: #fff;
    line-height: 1.4;
}

/* ── Page layout ── */
.page-wrapper {
    width: 100%;
    max-width: 820px;
    margin: 0 auto;
    padding: 20px 32px 20px 32px;
}

/* ── Header ── */
.exam-header {
    text-align: center;
    margin-bottom: 14px;
    padding-bottom: 8px;
    border-bottom: 2.5px solid #222;
}
.exam-institute {
    font-size: 20pt;
    font-weight: bold;
    letter-spacing: 0.5px;
    margin-bottom: 4px;
}
.exam-title {
    font-size: 14pt;
    font-weight: bold;
    margin-bottom: 3px;
}
.exam-meta {
    font-size: 9.5pt;
    color: #555;
}

/* ── Section heading ── */
.section-heading {
    font-size: 11pt;
    font-weight: bold;
    font-style: italic;
    background: #eeeeee;
    padding: 4px 10px;
    margin: 14px 0 6px 0;
    border-left: 4px solid #444;
}

/* ── Question block ── */
.question-block {
    margin-bottom: 10px;
}
.question-stem {
    font-size: 11pt;
    line-height: 1.45;
    margin-bottom: 3px;
}
.q-num {
    font-weight: bold;
}
.q-text {
    font-style: italic;
}

/* ── MCQ options: 2 per row for long options, 4 per row for short ── */
.options-grid {
    display: table;
    width: 100%;
    margin-left: 14px;
    margin-bottom: 2px;
    font-size: 10.5pt;
}
.opt-row {
    display: table-row;
}
.opt-cell {
    display: table-cell;
    padding: 1px 4px 1px 0;
    width: 50%;
}
.opt-cell.full-width {
    width: 100%;
    display: block;
}
.opt-label {
    font-weight: bold;
}

/* ── Match the column table ── */
.match-table {
    width: 90%;
    margin: 4px 0 6px 14px;
    border-collapse: collapse;
    font-size: 10.5pt;
}
.match-table th {
    background: #e8eaf6;
    font-weight: bold;
    border: 1px solid #999;
    padding: 3px 8px;
    text-align: left;
    width: 50%;
}
.match-table td {
    border: 1px solid #ccc;
    padding: 3px 8px;
    vertical-align: top;
    width: 50%;
}

/* ── Assertion blocks ── */
.assertion-block {
    margin: 2px 0 3px 14px;
    font-size: 10.5pt;
}
.assertion-label {
    font-weight: bold;
    text-decoration: underline;
}

/* ── Blank / answer lines ── */
.blank-line {
    margin: 2px 0 6px 14px;
    font-size: 10.5pt;
    color: #555;
}

/* ── Inline answer ── */
.inline-answer {
    font-size: 9.5pt;
    color: #1a6e1a;
    margin-left: 14px;
    margin-top: 1px;
    margin-bottom: 6px;
}
.ans-label {
    font-weight: bold;
}

@page { size: A4; margin: 15mm 18mm; }
`;

// ─── HTML helpers ──────────────────────────────────────────────────────────────

function esc(str: string | undefined | null): string {
    if (!str) return "";
    return str
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}

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

function uniqueBilingual(english: string | undefined | null, hindi: string | undefined | null, order: "english-first" | "hindi-first"): string[] {
    const primary = order === "english-first" ? collapseWhitespace(english) : collapseWhitespace(hindi);
    const secondary = order === "english-first" ? collapseWhitespace(hindi) : collapseWhitespace(english);
    if (!primary && !secondary) return [];
    if (!secondary) return primary ? [primary] : [];
    if (!primary) return [secondary];
    if (isEquivalentText(primary, secondary)) return [primary];
    return [primary, secondary];
}

function isExamExportableQuestion(question: Question): boolean {
    return isQuestionMeaningful(question);
}

/** Question stem: bold number + italic text */
function stemHtml(qNum: number, hindi: string, english: string): string {
    const parts = uniqueBilingual(english, hindi, "hindi-first").map(esc);
    const text = parts.join(" / ");
    return `<div class="question-stem"><span class="q-num">${qNum}.</span> <span class="q-text">${text}</span></div>`;
}

/**
 * MCQ options using display:table for reliable layout.
 * 2 options per row (each 50%), wraps naturally.
 */
function optionsHtml(options: Question["options"]): string {
    const filteredOptions = (options || []).filter((option) =>
        uniqueBilingual(option?.english, option?.hindi, "hindi-first").length > 0
    );
    if (filteredOptions.length === 0) return "";
    const labels = ["A", "B", "C", "D", "E", "F", "G", "H"];

    // Pair up options into rows of 2
    let rows = "";
    for (let i = 0; i < filteredOptions.length; i += 2) {
        const a = filteredOptions[i];
        const b = filteredOptions[i + 1];
        const aText = uniqueBilingual(a?.english, a?.hindi, "hindi-first").map(esc).join(" / ");
        const bText = b ? uniqueBilingual(b.english, b.hindi, "hindi-first").map(esc).join(" / ") : null;

        if (bText) {
            rows += `<div class="opt-row">
                <div class="opt-cell"><span class="opt-label">${labels[i]})</span> ${aText}</div>
                <div class="opt-cell"><span class="opt-label">${labels[i + 1]})</span> ${bText}</div>
            </div>`;
        } else {
            rows += `<div class="opt-row">
                <div class="opt-cell full-width"><span class="opt-label">${labels[i]})</span> ${aText}</div>
            </div>`;
        }
    }
    return `<div class="options-grid">${rows}</div>`;
}

function matchTableHtml(left: any[], right: any[]): string {
    const maxRows = Math.max(left.length, right.length);
    const colLabels = "ABCDEFGHIJ";
    let rows = "";
    for (let i = 0; i < maxRows; i++) {
        const lText = left[i] ? uniqueBilingual(left[i].english, left[i].hindi, "hindi-first").map(esc).join(" / ") : "";
        const rText = right[i] ? uniqueBilingual(right[i].english, right[i].hindi, "hindi-first").map(esc).join(" / ") : "";
        rows += `<tr>
            <td><strong>${colLabels[i]}.</strong> ${lText || "&nbsp;"}</td>
            <td><strong>${i + 1}.</strong> ${rText || "&nbsp;"}</td>
        </tr>`;
    }
    return `<table class="match-table">
        <thead><tr><th>Column A</th><th>Column B</th></tr></thead>
        <tbody>${rows}</tbody>
    </table>`;
}

function assertionHtml(options: Question["options"]): string {
    const labels = ["Statement (I)", "Statement (II)", "Statement (III)", "Statement (IV)"];
    // Show first 2 as assertion/reason statements
    const stmts = (options || []).slice(0, 2).map((opt, i) => {
        const text = uniqueBilingual(opt.english, opt.hindi, "hindi-first").map(esc).join(" / ");
        return `<div class="assertion-block"><span class="assertion-label">${labels[i]}:</span> ${text || "&nbsp;"}</div>`;
    }).join("");
    // Remaining options are MCQ choices (code options)
    const choices = (options || []).slice(2);
    return stmts + (choices.length > 0 ? optionsHtml(choices) : "");
}

function answerHtml(ans: string, sol: string): string {
    if (!ans && !sol) return "";
    let html = `<div class="inline-answer"><span class="ans-label">✓ Ans:</span> ${esc(ans)}`;
    if (sol) {
        html += ` <span style="color:#888">|</span> <span class="ans-label">Sol:</span> ${esc(sol)}`;
    }
    return html + `</div>`;
}

function getQuestionSolutionText(question: Question): string {
    const bilingual = uniqueBilingual(question.solutionEnglish, question.solutionHindi, "hindi-first");
    if (bilingual.length > 0) {
        return bilingual.join(" / ");
    }
    return collapseWhitespace(question.solution);
}

// ─── Main HTML generator ──────────────────────────────────────────────────────

export function generateExamHtml(data: PdfData): string {
    const TYPE_LABELS: Record<string, string> = {
        MCQ: "Multiple Choice Questions",
        TRUE_FALSE: "True / False",
        ASSERTION_REASON: "Assertion & Reason",
        MATCH_COLUMN: "Match the Column",
        FIB: "Fill in the Blanks",
        NUMERICAL: "Numerical Questions",
        SHORT_ANSWER: "Short Answer Questions",
        LONG_ANSWER: "Long Answer Questions",
        UNKNOWN: "Questions",
    };

    const includeAnswers = data.includeAnswers !== false;
    const includeSections = Boolean((data as PdfData & { includeSections?: boolean }).includeSections);
    const questions = (data.questions || []).filter(isExamExportableQuestion);
    let body = "";
    let currentType: string | null = null;
    let globalCounter = 0;

    questions.forEach((q, idx) => {
        globalCounter++;
        const qNum = globalCounter;
        const qType = q.questionType || "UNKNOWN";
        const ans = getQuestionAnswerText(q);
        const sol = getQuestionSolutionText(q);

        // Section heading when type changes
        if (includeSections && qType !== currentType) {
            currentType = qType;
            const label = TYPE_LABELS[qType] || qType;
            body += `<div class="section-heading">${esc(label)}</div>`;
        }

        let inner = "";

        // Question stem
        inner += stemHtml(qNum, q.questionHindi || "", q.questionEnglish || "");

        // Type-specific options/body
        if (qType === "MCQ" || qType === "TRUE_FALSE") {
            inner += optionsHtml(q.options || []);

        } else if (qType === "ASSERTION_REASON") {
            inner += assertionHtml(q.options || []);

        } else if (qType === "MATCH_COLUMN") {
            const left = q.matchColumns?.left || [];
            const right = q.matchColumns?.right || [];
            if (left.length > 0 || right.length > 0) {
                inner += matchTableHtml(left, right);
            }
            // show MCQ options for codes if present
            if ((q.options || []).length > 0) {
                inner += `<div style="margin-left:14px;font-size:10.5pt;margin-top:2px;font-style:italic;">Codes:</div>`;
                inner += optionsHtml(q.options);
            }

        } else if (qType === "FIB") {
            inner += `<div class="blank-line">Ans: _________________________________________</div>`;

        } else if (qType === "NUMERICAL") {
            inner += `<div class="blank-line">Answer: _______________</div>`;

        } else if (qType === "SHORT_ANSWER" || qType === "LONG_ANSWER") {
            const lines = qType === "SHORT_ANSWER" ? 2 : 4;
            const lineHtml = `<div style="border-bottom:1px solid #bbb; height:18px; margin-bottom:4px;"></div>`;
            inner += `<div style="margin:4px 0 6px 14px;">${lineHtml.repeat(lines)}</div>`;
        }

        // Inline answer
        if (includeAnswers) {
            inner += answerHtml(ans, sol);
        }

        body += `<div class="question-block">${inner}</div>`;
    });

    const metaParts = [
        data.subject,
        data.date ? `Date: ${data.date}` : "",
    ].filter(Boolean).map(esc);

    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8" />
    <title>${esc(data.title || "Exam Paper")}</title>
    <style>${CSS}</style>
</head>
<body>
<div class="page-wrapper">
    <div class="exam-header">
        <div class="exam-institute">${esc(data.instituteName || "")}</div>
        <div class="exam-title">${esc(data.title || "")}</div>
        ${metaParts.length > 0 ? `<div class="exam-meta">${metaParts.join(" &nbsp;|&nbsp; ")}</div>` : ""}
    </div>
    ${body || "<p>No questions found.</p>"}
</div>
</body>
</html>`;
}

// ─── PDF renderer ─────────────────────────────────────────────────────────────

export async function generateExamPdf(data: PdfData): Promise<Buffer> {
    const html = generateExamHtml(data);

    const browser = await puppeteer.launch({
        headless: true,
        args: [
            "--no-sandbox",
            "--disable-setuid-sandbox",
            "--disable-dev-shm-usage",
            "--disable-gpu",
        ],
    });

    try {
        const page = await browser.newPage();
        // Use setContent with NO networkidle since we have no external resources
        await page.setContent(html, { waitUntil: "domcontentloaded", timeout: 30000 });

        const pdf = await page.pdf({
            format: "A4",
            printBackground: true,
            margin: { top: "15mm", bottom: "15mm", left: "18mm", right: "18mm" },
            timeout: 60000,
        });

        return Buffer.from(pdf);
    } finally {
        await browser.close();
    }
}
