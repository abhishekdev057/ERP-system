import puppeteer from "puppeteer";
import path from "path";
import fs from "fs";

// Templates Configuration
type TemplateConfig = {
    id: string;
    name: string;
    background: string;
    headerBg: string;
    accentColor: string;
    hindiColor: string;
    englishColor: string;
    numColor: string;
    watermarkOpacity: number;
    fontStyle: {
        hindiSize: number;
        englishSize: number;
        numSize: number;
    };
};

const TEMPLATES: Record<string, TemplateConfig> = {
    professional: {
        id: "professional",
        name: "Professional (Default)",
        background: "#0E1932",
        headerBg: "#081226",
        accentColor: "#F9C74F",
        hindiColor: "#F9C74F",
        englishColor: "#22D3EE",
        numColor: "#F9C74F",
        watermarkOpacity: 0.1,
        fontStyle: { hindiSize: 24, englishSize: 20, numSize: 26 }
    },
    classic: {
        id: "classic",
        name: "Classic Professional",
        background: "#0E1932",
        headerBg: "#081226",
        accentColor: "#F9C74F",
        hindiColor: "#F9C74F",
        englishColor: "#22D3EE",
        numColor: "#F9C74F",
        watermarkOpacity: 0.1,
        fontStyle: { hindiSize: 24, englishSize: 20, numSize: 26 }
    },
    minimal: {
        id: "minimal",
        name: "Modern Minimal",
        background: "#FFFFFF",
        headerBg: "#F3F4F6",
        accentColor: "#3B82F6",
        hindiColor: "#111827",
        englishColor: "#4B5563",
        numColor: "#3B82F6",
        watermarkOpacity: 0.05,
        fontStyle: { hindiSize: 20, englishSize: 16, numSize: 22 }
    },
    academic: {
        id: "academic",
        name: "Classic Academic",
        background: "#FDFBF7",
        headerBg: "#1F2937",
        accentColor: "#9CA3AF",
        hindiColor: "#1F2937",
        englishColor: "#4B5563",
        numColor: "#000000",
        watermarkOpacity: 0.07,
        fontStyle: { hindiSize: 19, englishSize: 15, numSize: 20 }
    },
    sleek: {
        id: "sleek",
        name: "Sleek Dark",
        background: "#1A1A2E",
        headerBg: "#16213E",
        accentColor: "#0F3460",
        hindiColor: "#E94560",
        englishColor: "#EAEAEA",
        numColor: "#E94560",
        watermarkOpacity: 0.08,
        fontStyle: { hindiSize: 21, englishSize: 17, numSize: 23 }
    },
    agriculture: {
        id: "agriculture",
        name: "Agriculture Green",
        background: "#F0F4EF",
        headerBg: "#2D6A4F",
        accentColor: "#40916C",
        hindiColor: "#1B4332",
        englishColor: "#2D6A4F",
        numColor: "#1B4332",
        watermarkOpacity: 0.06,
        fontStyle: { hindiSize: 19, englishSize: 15, numSize: 21 }
    }
};

type Question = {
    questionHindi: string;
    questionEnglish: string;
    options: { hindi: string; english: string }[];
};

type PdfInput = {
    title: string;
    date: string;
    instituteName: string;
    questions: Question[];
    templateId?: string;
};

function getLogoPath(): string {
    return path.join(process.cwd(), "public", "nacc-logo.png");
}

function getBackgroundPath(): string {
    return path.join(process.cwd(), "public", "background.png");
}

function getFontPath(): string {
    return path.join(process.cwd(), "public", "fonts", "NotoSansDevanagari-Regular.ttf");
}

function generateHtml(input: PdfInput, config: TemplateConfig): string {
    const fontPath = getFontPath();
    const logoPath = getLogoPath();
    const backgroundPath = getBackgroundPath();

    // Convert font to base64 for embedding
    let fontBase64 = "";
    try {
        const fontBuffer = fs.readFileSync(fontPath);
        fontBase64 = fontBuffer.toString("base64");
    } catch (e) {
        console.warn("Font file not found, using fallback");
    }

    // Convert logo to base64
    let logoBase64 = "";
    try {
        const logoBuffer = fs.readFileSync(logoPath);
        logoBase64 = `data:image/png;base64,${logoBuffer.toString("base64")}`;
    } catch (e) {
        console.warn("Logo not found");
    }

    // Convert background to base64
    let backgroundBase64 = "";
    try {
        if (fs.existsSync(backgroundPath)) {
            const bgBuffer = fs.readFileSync(backgroundPath);
            backgroundBase64 = `data:image/png;base64,${bgBuffer.toString("base64")}`;
        }
    } catch (e) {
        console.warn("Background not found");
    }

    const isDark = config.id === "professional" || config.id === "sleek";
    const textColor = config.id === "minimal" || config.id === "agriculture" ? config.hindiColor : "white";

    return `<!DOCTYPE html>
<html lang="hi">
<head>
    <meta charset="UTF-8">
    <style>
        @font-face {
            font-family: 'NotoSansHindi';
            src: url(data:font/truetype;charset=utf-8;base64,${fontBase64}) format('truetype');
            font-weight: normal;
            font-style: normal;
        }

        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }

        body {
            font-family: 'NotoSansHindi', 'Noto Sans Devanagari', sans-serif;
            -webkit-font-smoothing: antialiased;
            -moz-osx-font-smoothing: grayscale;
        }

        .page {
            width: 297mm;
            height: 210mm;
            position: relative;
            page-break-after: always;
            ${backgroundBase64 && config.id === "professional"
            ? `background-image: url("${backgroundBase64}"); background-size: cover; background-position: center;`
            : `background: ${config.background};`}
            overflow: hidden;
        }

        ${isDark ? `
        .page::before {
            content: '';
            position: absolute;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background-image: 
                radial-gradient(circle, ${config.accentColor}11 1px, transparent 1px),
                radial-gradient(circle, ${config.accentColor}08 1px, transparent 1px);
            background-size: 50px 50px, 80px 80px;
            background-position: 0 0, 40px 40px;
            opacity: 0.4;
            pointer-events: none;
        }` : ''}

        .header {
            background: ${config.headerBg};
            padding: 15px 35px;
            display: flex;
            justify-content: space-between;
            align-items: center;
            border-bottom: 2px solid ${config.accentColor};
            position: relative;
            z-index: 10;
        }

        .header h1 {
            font-family: 'Helvetica', 'Arial', sans-serif;
            font-weight: bold;
            font-size: 20px;
            color: ${textColor};
            letter-spacing: 0.5px;
        }

        .header img {
            height: 40px;
        }

        .watermark {
            position: absolute;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            opacity: ${config.watermarkOpacity};
            pointer-events: none;
            z-index: 1;
        }

        .watermark img {
            width: 350px;
            height: auto;
        }

        .content {
            position: relative;
            z-index: 2;
            padding: 40px 50px 40px 550px;
            width: 100%;
        }

        .question-number {
            font-family: 'Helvetica', 'Arial', sans-serif;
            font-size: ${config.fontStyle.numSize}px;
            font-weight: bold;
            color: ${config.numColor};
            margin-bottom: 8px;
        }

        .question-hindi {
            font-family: 'NotoSansHindi', 'Noto Sans Devanagari', sans-serif;
            font-size: ${config.fontStyle.hindiSize}px;
            color: ${config.hindiColor};
            line-height: 1.4;
            margin-bottom: 4px;
            font-feature-settings: "liga" 1, "calt" 1, "rlig" 1, "dlig" 1, "akhn" 1, "cjct" 1;
            text-rendering: optimizeLegibility;
        }

        .question-english {
            font-family: 'Helvetica', 'Arial', sans-serif;
            font-size: ${config.fontStyle.englishSize}px;
            color: ${config.englishColor};
            line-height: 1.35;
            margin-bottom: 30px;
        }

        .options {
            margin-left: 0;
            display: flex;
            flex-direction: column;
            gap: 10px;
        }

        .option {
            display: flex;
            gap: 15px;
            align-items: flex-start;
        }

        .option-label {
            font-family: 'Helvetica', 'Arial', sans-serif;
            font-size: ${config.fontStyle.numSize - 4}px;
            font-weight: bold;
            color: ${config.numColor};
            flex-shrink: 0;
            min-width: 30px;
        }

        .option-text {
            flex: 1;
        }

        .option-hindi {
            font-family: 'NotoSansHindi', 'Noto Sans Devanagari', sans-serif;
            font-size: ${config.fontStyle.hindiSize - 2}px;
            color: ${config.hindiColor};
            line-height: 1.35;
            margin-bottom: 2px;
            font-feature-settings: "liga" 1, "calt" 1, "rlig" 1, "dlig" 1, "akhn" 1, "cjct" 1;
            text-rendering: optimizeLegibility;
        }

        .option-english {
            font-family: 'Helvetica', 'Arial', sans-serif;
            font-size: ${config.fontStyle.englishSize - 2}px;
            color: ${config.englishColor};
            line-height: 1.3;
        }

        @media print {
            .page {
                page-break-after: always;
            }
        }
    </style>
</head>
<body>
${input.questions.map((q, idx) => `
    <div class="page">
        <div class="header">
            <h1>NACC AGRICULTURE INSTITUTE</h1>
            ${logoBase64 ? `<img src="${logoBase64}" alt="Logo" />` : ''}
        </div>

        ${logoBase64 ? `
        <div class="watermark">
            <img src="${logoBase64}" alt="Watermark" />
        </div>` : ''}

        <div class="content">
            <div class="question-hindi"><span class="question-number">${idx + 1}.</span> ${q.questionHindi}</div>
            <div class="question-english">${q.questionEnglish}</div>

            <div class="options">
                ${q.options.map((opt, optIdx) => `
                <div class="option">
                    <div class="option-label">(${optIdx + 1})</div>
                    <div class="option-text">
                        <div class="option-hindi">${opt.hindi}</div>
                        <div class="option-english">${opt.english}</div>
                    </div>
                </div>
                `).join('')}
            </div>
        </div>
    </div>
`).join('')}
</body>
</html>`;
}

export async function generatePdf(input: PdfInput): Promise<Buffer> {
    const config = TEMPLATES[input.templateId || "professional"] || TEMPLATES.professional;
    const html = generateHtml(input, config);

    const browser = await puppeteer.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    try {
        const page = await browser.newPage();
        await page.setContent(html, { waitUntil: 'networkidle0' });

        const pdfBuffer = await page.pdf({
            format: 'A4',
            landscape: true,
            printBackground: true,
            preferCSSPageSize: true
        });

        await browser.close();
        return Buffer.from(pdfBuffer);
    } catch (error) {
        await browser.close();
        throw error;
    }
}

export { TEMPLATES };
export type { PdfInput, Question, TemplateConfig };
