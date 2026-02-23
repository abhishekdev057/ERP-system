import fs from "fs";
import path from "path";
import puppeteer from "puppeteer";
import { PDF_TEMPLATES, PdfTemplateConfig, resolvePdfTemplate } from "@/lib/pdf-templates";
import { PdfInput, Question } from "@/types/pdf";

export type TemplateConfig = PdfTemplateConfig;

type EmbeddedAssets = {
    fontBase64: string;
    logoDataUri: string;
    backgroundDataUri: string;
};

const EMPTY_ASSETS: EmbeddedAssets = {
    fontBase64: "",
    logoDataUri: "",
    backgroundDataUri: "",
};

let cachedAssets: EmbeddedAssets | null = null;

function getFileBase64(filePath: string): string {
    if (!fs.existsSync(filePath)) return "";
    return fs.readFileSync(filePath).toString("base64");
}

function loadEmbeddedAssets(): EmbeddedAssets {
    if (cachedAssets) return cachedAssets;

    const fontPath = path.join(process.cwd(), "public", "fonts", "NotoSansDevanagari-Regular.ttf");
    const logoPath = path.join(process.cwd(), "public", "nacc-logo.png");
    const backgroundPath = path.join(process.cwd(), "public", "background.png");

    const fontBase64 = getFileBase64(fontPath);
    const logoBase64 = getFileBase64(logoPath);
    const backgroundBase64 = getFileBase64(backgroundPath);

    cachedAssets = {
        fontBase64,
        logoDataUri: logoBase64 ? `data:image/png;base64,${logoBase64}` : "",
        backgroundDataUri: backgroundBase64 ? `data:image/png;base64,${backgroundBase64}` : "",
    };

    return cachedAssets;
}

function escapeHtml(value: string): string {
    return value
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/\"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

function multilineHtml(value: string): string {
    return escapeHtml(value).replace(/\n/g, "<br />");
}

function normalizeSlideDensity(question: Question): "normal" | "dense" | "compact" {
    const questionSize = question.questionHindi.length + question.questionEnglish.length;
    const optionsSize = question.options.reduce(
        (acc, option) => acc + option.hindi.length + option.english.length,
        0
    );

    const total = questionSize + optionsSize;
    if (total > 900 || question.options.length >= 7) return "compact";
    if (total > 540 || question.options.length >= 5) return "dense";
    return "normal";
}

function renderOption(option: Question["options"][number], index: number): string {
    return `
        <article class="option-card">
            <div class="option-head">Option ${index + 1}</div>
            <div class="option-hindi">${multilineHtml(option.hindi)}</div>
            <div class="option-english">${multilineHtml(option.english)}</div>
        </article>
    `;
}

function renderSlide(
    question: Question,
    index: number,
    totalSlides: number,
    payload: PdfInput,
    template: PdfTemplateConfig,
    assets: EmbeddedAssets
): string {
    const density = normalizeSlideDensity(question);

    return `
    <section class="sheet density-${density}">
        ${assets.backgroundDataUri ? `<img class="sheet-bg" src="${assets.backgroundDataUri}" alt="" />` : ""}

        <header class="sheet-header">
            <div>
                <div class="institute">${escapeHtml(payload.instituteName)}</div>
                <div class="meta-line">${escapeHtml(payload.title)} • ${escapeHtml(payload.date)}</div>
            </div>
            ${assets.logoDataUri ? `<img class="logo" src="${assets.logoDataUri}" alt="NACC logo" />` : ""}
        </header>

        <main class="sheet-body">
            <section class="question-panel">
                <div class="question-index">Question ${escapeHtml(question.number || String(index + 1))}</div>
                <h2 class="question-hindi">${multilineHtml(question.questionHindi)}</h2>
                <p class="question-english">${multilineHtml(question.questionEnglish)}</p>
            </section>

            <aside class="options-panel">
                ${question.options.map(renderOption).join("")}
            </aside>
        </main>

        <footer class="sheet-footer">
            <span>${escapeHtml(payload.subject || payload.title)}</span>
            <span>Slide ${index + 1}/${totalSlides}</span>
        </footer>

        ${assets.logoDataUri ? `<img class="watermark" src="${assets.logoDataUri}" alt="" />` : ""}
    </section>
    `;
}

function generateHtml(payload: PdfInput, template: PdfTemplateConfig): string {
    const assets = loadEmbeddedAssets();
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

    const slides = payload.questions
        .map((question, index) =>
            renderSlide(question, index, payload.questions.length, payload, template, assets)
        )
        .join("\n");

    return `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <style>
        ${fontFace}

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
            size: A4 landscape;
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

        .sheet {
            width: 297mm;
            height: 210mm;
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
            font-size: 6.3mm;
            line-height: 1.1;
            font-weight: 700;
            letter-spacing: 0.02em;
            color: var(--title);
            max-width: 190mm;
        }

        .meta-line {
            margin-top: 1.6mm;
            font-size: 3.3mm;
            color: var(--footer);
            line-height: 1.2;
        }

        .logo {
            height: 13mm;
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
            padding: 6.3mm;
            display: flex;
            flex-direction: column;
            min-height: 0;
            overflow: hidden;
        }

        .question-index {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            width: fit-content;
            padding: 1.3mm 3.1mm;
            border-radius: 999px;
            border: 0.3mm solid var(--option-border);
            background: rgba(255,255,255,0.08);
            color: var(--option-label);
            font-size: 3.1mm;
            font-weight: 700;
            letter-spacing: 0.02em;
        }

        .question-hindi {
            margin-top: 4.2mm;
            font-size: 8mm;
            line-height: 1.28;
            color: var(--hindi);
            font-weight: 700;
            word-break: break-word;
        }

        .question-english {
            margin-top: 3mm;
            font-family: "Segoe UI", "Helvetica Neue", Arial, sans-serif;
            font-size: 5.2mm;
            line-height: 1.34;
            color: var(--english);
            word-break: break-word;
        }

        .options-panel {
            padding: 5mm;
            display: grid;
            align-content: start;
            gap: 2.5mm;
            min-height: 0;
            overflow: hidden;
        }

        .option-card {
            border: 0.28mm solid var(--option-border);
            border-radius: 3.2mm;
            background: var(--option-bg);
            padding: 2.4mm 2.9mm;
            min-height: 0;
        }

        .option-head {
            font-family: "Segoe UI", "Helvetica Neue", Arial, sans-serif;
            font-size: 2.8mm;
            letter-spacing: 0.05em;
            text-transform: uppercase;
            color: var(--option-label);
            margin-bottom: 1.2mm;
            font-weight: 700;
        }

        .option-hindi {
            font-size: 4.7mm;
            line-height: 1.25;
            color: var(--hindi);
            word-break: break-word;
        }

        .option-english {
            margin-top: 1.2mm;
            font-family: "Segoe UI", "Helvetica Neue", Arial, sans-serif;
            font-size: 3.7mm;
            line-height: 1.23;
            color: var(--english);
            word-break: break-word;
        }

        .sheet-footer {
            height: 11mm;
            padding: 0 10mm 5mm;
            display: flex;
            align-items: flex-end;
            justify-content: space-between;
            font-size: 3.1mm;
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
            font-size: 7mm;
            line-height: 1.24;
        }

        .density-dense .question-english {
            font-size: 4.7mm;
            line-height: 1.28;
        }

        .density-dense .option-hindi {
            font-size: 4.3mm;
        }

        .density-dense .option-english {
            font-size: 3.45mm;
        }

        .density-compact .question-hindi {
            font-size: 6.2mm;
            line-height: 1.2;
        }

        .density-compact .question-english {
            font-size: 4.25mm;
            line-height: 1.24;
        }

        .density-compact .option-hindi {
            font-size: 3.95mm;
            line-height: 1.2;
        }

        .density-compact .option-english {
            font-size: 3.25mm;
            line-height: 1.18;
        }

        .density-compact .options-panel {
            gap: 2mm;
        }

        .density-compact .option-card {
            padding: 2mm 2.5mm;
        }
    </style>
</head>
<body>
${slides}
</body>
</html>`;
}

export async function generatePdf(input: PdfInput): Promise<Buffer> {
    const template = resolvePdfTemplate(input.templateId);
    const html = generateHtml(input, template);

    const browser = await puppeteer.launch({
        headless: true,
        args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });

    try {
        const page = await browser.newPage();
        await page.setViewport({ width: 1600, height: 900, deviceScaleFactor: 1 });
        await page.setContent(html, { waitUntil: ["domcontentloaded", "networkidle0"] });
        await page.emulateMediaType("screen");
        await page.evaluateHandle("document.fonts.ready");

        const pdf = await page.pdf({
            width: "297mm",
            height: "210mm",
            printBackground: true,
            preferCSSPageSize: true,
            margin: {
                top: "0mm",
                right: "0mm",
                bottom: "0mm",
                left: "0mm",
            },
        });

        return Buffer.from(pdf);
    } finally {
        await browser.close();
    }
}

export const TEMPLATES = PDF_TEMPLATES;
export type { PdfInput };
