import type { MatchColumns, Question, QuestionOption } from "@/types/pdf";

export type SlideVisualizationQuestionSnapshot = {
    kind?: "question";
    clientId?: string;
    number: string;
    questionHindi: string;
    questionEnglish: string;
    options: QuestionOption[];
    questionType?: string;
    matchColumns?: MatchColumns;
    sourceImagePath?: string;
    sourceImageName?: string;
    diagramImagePath?: string;
    autoDiagramImagePath?: string;
};

type SvgRenderableOption = {
    label: string;
    lines: string[];
};

export type SlideVisualizationDirection = {
    layoutName: string;
    styleSummary: string;
    visualCue: string;
    heroHint: string;
    optionHint: string;
    decorativeHint: string;
};

function cleanInlineText(value: string | undefined | null) {
    return String(value || "")
        .replace(/\s+/g, " ")
        .trim();
}

function clampText(value: string, maxLength: number) {
    if (value.length <= maxLength) return value;
    return `${value.slice(0, Math.max(0, maxLength - 1)).trim()}…`;
}

function hashText(input: string) {
    let hash = 0;
    for (let index = 0; index < input.length; index += 1) {
        hash = (hash << 5) - hash + input.charCodeAt(index);
        hash |= 0;
    }
    return Math.abs(hash).toString(36);
}

function buildOptionDisplayLabel(index: number) {
    return `(${String.fromCharCode(97 + index)})`;
}

function getLocalizedTextPair(hindi: string | undefined | null, english: string | undefined | null) {
    const hindiText = cleanInlineText(hindi);
    const englishText = cleanInlineText(english);

    if (hindiText && englishText) {
        return `${hindiText} / ${englishText}`;
    }

    return hindiText || englishText;
}

function getLocalizedTextLines(hindi: string | undefined | null, english: string | undefined | null) {
    const hindiText = cleanInlineText(hindi);
    const englishText = cleanInlineText(english);

    if (hindiText && englishText && hindiText !== englishText) {
        return [hindiText, englishText];
    }

    return [hindiText || englishText].filter(Boolean);
}

function getQuestionCorpus(snapshot: SlideVisualizationQuestionSnapshot) {
    return [
        snapshot.questionHindi,
        snapshot.questionEnglish,
        ...(snapshot.options || []).flatMap((option) => [option.hindi, option.english]),
        ...(snapshot.matchColumns?.left || []).flatMap((entry) => [entry.hindi, entry.english]),
        ...(snapshot.matchColumns?.right || []).flatMap((entry) => [entry.hindi, entry.english]),
    ]
        .map((value) => cleanInlineText(value))
        .filter(Boolean)
        .join(" ");
}

export function getSlideVisualizationDirection(
    snapshot: SlideVisualizationQuestionSnapshot
): SlideVisualizationDirection {
    const corpus = getQuestionCorpus(snapshot).toLowerCase();

    if (snapshot.matchColumns?.left?.length || snapshot.matchColumns?.right?.length) {
        return {
            layoutName: "Comparison infographic",
            styleSummary: "Two structured info columns with clear anchors, connecting rhythm, and academic infographic styling.",
            visualCue: "Use linked column panels, badges, arrows, and a comparison spine so the slide feels visual, not like raw text.",
            heroHint: "Keep a compact center motif or icon system between columns instead of leaving empty space.",
            optionHint: "Render each column in styled cards with bold headers and evenly spaced rows.",
            decorativeHint: "Use a bright premium exam-prep palette, soft gradients, and subtle scholarly motifs.",
        };
    }

    if (/(pyramid|पिरामिड|food chain|chain|शृंखला|श्रृंखला|cycle|चक्र|flow|क्रम|diagram|स्तर)/i.test(corpus)) {
        return {
            layoutName: "Diagram-led explainer",
            styleSummary: "A concept slide with a large central diagram, arrows, callouts, and strong educational hierarchy.",
            visualCue: "Build the visual around a pyramid, cycle, or stacked diagram that explains the concept at a glance.",
            heroHint: "Dedicate major space to the concept diagram and let the text wrap around or beside it elegantly.",
            optionHint: "Keep options in premium answer chips or cards with even spacing and clear contrast.",
            decorativeHint: "Use colorful layered infographic blocks, subtle motion-like arrows, and textbook-style polish.",
        };
    }

    if (/(नस्ल|breed|cow|cattle|buffalo|animal|plant|species|variety|पहचान|identify|कौनसा|कौन सी)/i.test(corpus)) {
        return {
            layoutName: "Hero illustration card",
            styleSummary: "A polished coaching slide with one large subject illustration and fact-led text panels.",
            visualCue: "Use a prominent hero illustration related to the subject, then place question/options in elegant rounded cards.",
            heroHint: "The subject illustration should feel intentional and premium, not clipart or a blank placeholder.",
            optionHint: "Options should appear as balanced, tappable-looking choice pills/cards with bold labels.",
            decorativeHint: "Use airy educational backgrounds, botanical/academic motifs, and a clean premium coaching aesthetic.",
        };
    }

    if (/(गलत|सही|incorrect|wrong|not true|statement|कथन|assertion|reason)/i.test(corpus)) {
        return {
            layoutName: "Statement spotlight",
            styleSummary: "A high-contrast statement card with emphasis bars, semantic markers, and clean option groupings.",
            visualCue: "Visually spotlight the statement/question in a strong focal card with side accents or mini icons.",
            heroHint: "Use structured panels and semantic emphasis instead of leaving large blank zones.",
            optionHint: "Keep answers in a consistent answer-grid with strong visual rhythm.",
            decorativeHint: "Use refined modern exam-prep styling with subtle diagram lines and premium color coding.",
        };
    }

    return {
        layoutName: "Infographic question card",
        styleSummary: "A bright, visually rich educational slide with a supporting illustration area and polished option layout.",
        visualCue: "Combine one support visual or icon cluster with a bold question block and premium option chips.",
        heroHint: "Reserve 30 to 40 percent of the slide for a purposeful visual element instead of a plain text wall.",
        optionHint: "Options should sit in designed cards or chips, not as a bare text list.",
        decorativeHint: "Use subtle scholarly graphics, gradients, and coaching-institute polish on a clean bright canvas.",
    };
}

export function getSlideVisualizationQuestionKey(question: Partial<Question>, index: number) {
    const clientId = cleanInlineText(question.clientId);
    if (clientId) {
        return `client:${clientId}`;
    }

    const source = [
        cleanInlineText(question.number),
        cleanInlineText(question.questionHindi),
        cleanInlineText(question.questionEnglish),
        Array.isArray(question.options)
            ? question.options
                  .map((option) => `${cleanInlineText(option.hindi)}|${cleanInlineText(option.english)}`)
                  .join("||")
            : "",
    ].join("::");

    return `index:${index}:${hashText(source)}`;
}

export function buildSlideVisualizationQuestionSnapshot(question: Question): SlideVisualizationQuestionSnapshot {
    return {
        kind: "question",
        clientId: cleanInlineText(question.clientId) || undefined,
        number: cleanInlineText(question.number),
        questionHindi: cleanInlineText(question.questionHindi),
        questionEnglish: cleanInlineText(question.questionEnglish),
        options: Array.isArray(question.options)
            ? question.options.map((option) => ({
                  hindi: cleanInlineText(option.hindi),
                  english: cleanInlineText(option.english),
              }))
            : [],
        questionType: cleanInlineText(question.questionType) || undefined,
        matchColumns: question.matchColumns,
        sourceImagePath: cleanInlineText(question.sourceImagePath) || undefined,
        sourceImageName: cleanInlineText(question.sourceImageName) || undefined,
        diagramImagePath: cleanInlineText(question.diagramImagePath) || undefined,
        autoDiagramImagePath: cleanInlineText(question.autoDiagramImagePath) || undefined,
    };
}

export function getSlideVisualizationQuestionPreview(
    question: Pick<Question, "questionHindi" | "questionEnglish">,
    maxLength = 120
) {
    const preview = getLocalizedTextPair(question.questionHindi, question.questionEnglish);
    return clampText(preview, maxLength);
}

export function getSlideVisualizationOptionLines(
    question: Pick<Question, "options" | "matchColumns">
) {
    if (question.matchColumns?.left?.length || question.matchColumns?.right?.length) {
        const leftLines = (question.matchColumns?.left || []).map((entry, index) => {
            const text = getLocalizedTextPair(entry.hindi, entry.english);
            return `${romanIndex(index)} ${text}`;
        });
        const rightLines = (question.matchColumns?.right || []).map((entry, index) => {
            const text = getLocalizedTextPair(entry.hindi, entry.english);
            return `${index + 1}. ${text}`;
        });

        return {
            type: "match" as const,
            leftLines,
            rightLines,
        };
    }

    const optionLines = Array.isArray(question.options)
        ? question.options
              .map((option, index) => {
                  const text = getLocalizedTextPair(option.hindi, option.english);
                  if (!text) return "";
                  return `${buildOptionDisplayLabel(index)} ${text}`;
              })
              .filter(Boolean)
        : [];

    return {
        type: "options" as const,
        optionLines,
    };
}

function romanIndex(index: number) {
    const values = ["(i)", "(ii)", "(iii)", "(iv)", "(v)", "(vi)"];
    return values[index] || `(${index + 1})`;
}

export function buildSlidesVisualizationPrompt(input: {
    question: SlideVisualizationQuestionSnapshot;
    documentTitle: string;
    subject?: string;
    instituteName?: string | null;
    instituteFooterLine?: string | null;
}) {
    const direction = getSlideVisualizationDirection(input.question);
    const questionLines = getLocalizedTextLines(input.question.questionHindi, input.question.questionEnglish);
    const optionBlock = getSlideVisualizationOptionLines(input.question);
    const exactTextBlock =
        optionBlock.type === "match"
            ? [
                  ...questionLines.map((line) => `QUESTION: ${line}`),
                  "COLUMN I:",
                  ...optionBlock.leftLines.map((line) => line),
                  "COLUMN II:",
                  ...optionBlock.rightLines.map((line) => line),
              ]
            : [
                  ...questionLines.map((line) => `QUESTION: ${line}`),
                  "OPTIONS:",
                  ...optionBlock.optionLines,
              ];

    return [
        "Iss question ke visualization ka ek stunning premium educational slide image bana do.",
        "Output ek direct 16:9 landscape slide image hona chahiye, roughly 1600x900 style canvas feel ke saath.",
        "Koi code, SVG markup, plain worksheet, document snapshot, ya raw text sheet mat banana.",
        "Question aur options EXACTLY niche diye gaye text ke hisaab se hi image ke andar render hone chahiye.",
        "Text ko translate, paraphrase, shorten, auto-correct, simplify, reorder, ya drop mat karo.",
        "Question aur options readable, high-contrast, professionally aligned, beautifully spaced, and presentation-ready hone chahiye.",
        "Slide ke top-left me institute logo rakho aur uske bilkul right side me institute name likho.",
        input.instituteFooterLine
            ? `Slide ke footer me EXACT yehi short intro line har slide par same rakho: ${input.instituteFooterLine}`
            : "",
        "Output ko visually rich infographic slide jaisa banana, not a plain document photograph.",
        "At least one strong visual idea hona chahiye: hero illustration, concept diagram, infographic blocks, arrows, icons, subject-led scene, callout bands, or visual chips.",
        "Options ko styled answer cards, choice pills, comparison chips, or elegant panels me dikhao; raw bare text list mat chhodo.",
        "Answer, solution, answer hint, correctness tick, watermark slogans, random taglines, extra facts, extra labels, ya invented content mat add karo.",
        "Institute branding subtle rakho, but question content ko dominate mat karne do.",
        "Agar Hindi aur English dono diye gaye hain to stacked bilingual style allowed hai. Agar same text duplicate hai to ek hi readable line kaafi hai.",
        "Design tone: premium exam-prep slide, polished, modern, infographic-rich, and clearly teachable.",
        `Preferred layout: ${direction.layoutName}.`,
        `Style target: ${direction.styleSummary}`,
        `Visual cue: ${direction.visualCue}`,
        `Hero treatment: ${direction.heroHint}`,
        `Option treatment: ${direction.optionHint}`,
        `Decorative system: ${direction.decorativeHint}`,
        input.instituteName ? `Institute: ${input.instituteName}` : "",
        input.subject ? `Subject: ${input.subject}` : "",
        input.documentTitle ? `Question set: ${input.documentTitle}` : "",
        "EXACT TEXT TO RENDER IN THE IMAGE:",
        ...exactTextBlock,
    ]
        .filter(Boolean)
        .join("\n");
}

export function buildSlidesVisualizationRetryPrompt(input: {
    question: SlideVisualizationQuestionSnapshot;
    documentTitle: string;
    subject?: string;
    instituteName?: string | null;
    instituteFooterLine?: string | null;
}) {
    return [
        buildSlidesVisualizationPrompt(input),
        "",
        "IMPORTANT RETRY NOTE:",
        "Previous attempt too plain, document-like, or not visually rich enough.",
        "This retry MUST look like a polished educational infographic slide image with obvious composition, visual storytelling, and stronger design.",
        "Use larger visual hierarchy, richer cards, a clearer hero area, and more shaped infographic elements.",
        "Do not return a plain sheet-like layout or a weak text dump.",
    ].join("\n");
}

export function resolveQuestionTextLayout(snapshot: SlideVisualizationQuestionSnapshot) {
    const primaryQuestion = getLocalizedTextPair(snapshot.questionHindi, snapshot.questionEnglish);
    const optionBlock = getSlideVisualizationOptionLines(snapshot);

    return {
        primaryQuestion,
        optionBlock,
    };
}

export function extractSvgMarkup(raw: string) {
    const text = String(raw || "").trim();
    const svgMatch = text.match(/<svg[\s\S]*<\/svg>/i);
    return svgMatch ? svgMatch[0].trim() : "";
}

function escapeXml(value: string) {
    return String(value)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&apos;");
}

function wrapText(text: string, maxChars: number) {
    const normalized = cleanInlineText(text);
    if (!normalized) return [];
    const words = normalized.split(" ");
    const lines: string[] = [];
    let current = "";

    for (const word of words) {
        if (!current) {
            current = word;
            continue;
        }
        const next = `${current} ${word}`;
        if (next.length <= maxChars) {
            current = next;
        } else {
            lines.push(current);
            current = word;
        }
    }
    if (current) lines.push(current);
    return lines;
}

function renderSvgTextLines(lines: string[], x: number, startY: number, fontSize: number, lineHeight: number, fill: string, fontWeight = 700) {
    let y = startY;
    return lines
        .map((line) => {
            const block = `<text x="${x}" y="${y}" fill="${fill}" font-family="Noto Sans Devanagari, Noto Sans, Arial, sans-serif" font-size="${fontSize}" font-weight="${fontWeight}">${escapeXml(line)}</text>`;
            y += lineHeight;
            return block;
        })
        .join("");
}

function buildRenderableOptions(snapshot: SlideVisualizationQuestionSnapshot): SvgRenderableOption[] {
    if (snapshot.matchColumns?.left?.length || snapshot.matchColumns?.right?.length) {
        return [];
    }
    return (snapshot.options || [])
        .map((option, index) => {
            const lines = getLocalizedTextLines(option.hindi, option.english);
            if (!lines.length) return null;
            return {
                label: buildOptionDisplayLabel(index),
                lines,
            } satisfies SvgRenderableOption;
        })
        .filter(Boolean) as SvgRenderableOption[];
}

function buildFallbackHeroGraphic(direction: SlideVisualizationDirection) {
    if (direction.layoutName === "Diagram-led explainer") {
        return `
        <g transform="translate(1025 190)">
            <polygon points="160,0 300,120 20,120" fill="url(#accentA)" opacity="0.98"/>
            <polygon points="160,132 320,260 0,260" fill="url(#accentB)" opacity="0.96"/>
            <polygon points="160,272 280,390 40,390" fill="url(#accentC)" opacity="0.94"/>
            <line x1="48" y1="418" x2="280" y2="28" stroke="#334155" stroke-width="14" stroke-linecap="round"/>
            <polygon points="260,32 318,0 300,62" fill="#334155"/>
        </g>`;
    }

    if (direction.layoutName === "Hero illustration card") {
        return `
        <g transform="translate(1010 170)">
            <ellipse cx="220" cy="210" rx="240" ry="220" fill="rgba(16,185,129,0.14)"/>
            <ellipse cx="220" cy="230" rx="180" ry="170" fill="rgba(14,165,233,0.12)"/>
            <rect x="70" y="60" width="300" height="320" rx="42" fill="rgba(255,255,255,0.18)" stroke="rgba(15,23,42,0.12)"/>
            <circle cx="220" cy="155" r="74" fill="rgba(255,255,255,0.92)"/>
            <circle cx="220" cy="145" r="44" fill="rgba(251,191,36,0.58)"/>
            <rect x="156" y="214" width="128" height="94" rx="34" fill="rgba(255,255,255,0.92)"/>
            <rect x="116" y="322" width="208" height="26" rx="13" fill="rgba(255,255,255,0.82)"/>
        </g>`;
    }

    if (direction.layoutName === "Statement spotlight") {
        return `
        <g transform="translate(1010 180)">
            <rect x="0" y="0" width="420" height="310" rx="40" fill="rgba(255,255,255,0.18)" stroke="rgba(15,23,42,0.12)"/>
            <rect x="34" y="42" width="352" height="64" rx="24" fill="rgba(59,130,246,0.16)"/>
            <rect x="34" y="130" width="300" height="26" rx="13" fill="rgba(15,23,42,0.14)"/>
            <rect x="34" y="176" width="250" height="26" rx="13" fill="rgba(15,23,42,0.10)"/>
            <circle cx="365" cy="228" r="32" fill="#22c55e"/>
            <path d="M350 229l11 11 21-27" fill="none" stroke="#fff" stroke-width="10" stroke-linecap="round" stroke-linejoin="round"/>
        </g>`;
    }

    return `
    <g transform="translate(1010 170)">
        <rect x="0" y="0" width="430" height="320" rx="44" fill="rgba(255,255,255,0.16)" stroke="rgba(15,23,42,0.10)"/>
        <circle cx="318" cy="90" r="80" fill="rgba(59,130,246,0.18)"/>
        <circle cx="120" cy="246" r="94" fill="rgba(16,185,129,0.16)"/>
        <rect x="70" y="58" width="168" height="116" rx="30" fill="rgba(255,255,255,0.92)"/>
        <rect x="94" y="86" width="120" height="18" rx="9" fill="rgba(59,130,246,0.62)"/>
        <rect x="94" y="118" width="92" height="18" rx="9" fill="rgba(16,185,129,0.56)"/>
        <rect x="250" y="186" width="120" height="92" rx="28" fill="rgba(255,255,255,0.92)"/>
        <circle cx="310" cy="231" r="28" fill="rgba(251,191,36,0.54)"/>
    </g>`;
}

export function buildFallbackQuestionSlideSvg(input: {
    question: SlideVisualizationQuestionSnapshot;
    instituteName?: string | null;
    documentTitle?: string;
    subject?: string;
    logoDataUri?: string | null;
    instituteFooterLine?: string | null;
}) {
    const direction = getSlideVisualizationDirection(input.question);
    const questionLines = wrapText(
        getLocalizedTextPair(input.question.questionHindi, input.question.questionEnglish),
        26
    );
    const optionBlock = getSlideVisualizationOptionLines(input.question);
    const renderableOptions = buildRenderableOptions(input.question);
    const footerLine = cleanInlineText(input.instituteFooterLine);
    const logoMarkup = input.logoDataUri
        ? `<image href="${input.logoDataUri}" x="54" y="34" width="70" height="70" preserveAspectRatio="xMidYMid meet" />`
        : "";

    const optionSvg =
        optionBlock.type === "match"
            ? `
        <rect x="940" y="500" width="258" height="284" rx="30" fill="rgba(255,255,255,0.90)" stroke="rgba(15,23,42,0.10)" />
        <rect x="1218" y="500" width="258" height="284" rx="30" fill="rgba(255,255,255,0.92)" stroke="rgba(15,23,42,0.10)" />
        <text x="972" y="544" fill="#0f172a" font-family="Noto Sans Devanagari, Noto Sans, Arial, sans-serif" font-size="21" font-weight="800">Column I</text>
        <text x="1250" y="544" fill="#0f172a" font-family="Noto Sans Devanagari, Noto Sans, Arial, sans-serif" font-size="21" font-weight="800">Column II</text>
        ${renderSvgTextLines(optionBlock.leftLines.flatMap((line) => wrapText(line, 18)), 972, 586, 16, 26, "#0f172a", 700)}
        ${renderSvgTextLines(optionBlock.rightLines.flatMap((line) => wrapText(line, 18)), 1250, 586, 16, 26, "#0f172a", 700)}
            `
            : renderableOptions
                  .map((option, index) => {
                      const top = 520 + index * 70;
                      const textLines = option.lines.flatMap((line) => wrapText(line, 28));
                      return `
                <g>
                    <rect x="952" y="${top - 34}" width="500" height="${Math.max(64, textLines.length * 22 + 34)}" rx="26" fill="rgba(255,255,255,0.92)" stroke="rgba(15,23,42,0.10)" />
                    <circle cx="994" cy="${top - 3}" r="22" fill="rgba(14,165,233,0.16)"/>
                    <text x="980" y="${top + 5}" fill="#0284c7" font-family="Noto Sans Devanagari, Noto Sans, Arial, sans-serif" font-size="19" font-weight="800">${escapeXml(option.label)}</text>
                    ${renderSvgTextLines(textLines, 1032, top + 2, 18, 22, "#0f172a", 700)}
                </g>
                      `;
                  })
                  .join("");

    return `
<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="900" viewBox="0 0 1600 900">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#f8fffe"/>
      <stop offset="52%" stop-color="#eef6ff"/>
      <stop offset="100%" stop-color="#f6ffef"/>
    </linearGradient>
    <radialGradient id="glowA" cx="0.2" cy="0.15" r="0.8">
      <stop offset="0%" stop-color="#dbeafe"/>
      <stop offset="100%" stop-color="rgba(219,234,254,0)"/>
    </radialGradient>
    <radialGradient id="glowB" cx="0.8" cy="0.85" r="0.6">
      <stop offset="0%" stop-color="#dcfce7"/>
      <stop offset="100%" stop-color="rgba(220,252,231,0)"/>
    </radialGradient>
    <linearGradient id="accentA" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#0ea5e9"/>
      <stop offset="100%" stop-color="#14b8a6"/>
    </linearGradient>
    <linearGradient id="accentB" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#84cc16"/>
      <stop offset="100%" stop-color="#16a34a"/>
    </linearGradient>
    <linearGradient id="accentC" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#f59e0b"/>
      <stop offset="100%" stop-color="#f97316"/>
    </linearGradient>
  </defs>

  <rect width="1600" height="900" fill="url(#bg)"/>
  <rect width="1600" height="900" fill="url(#glowA)"/>
  <rect width="1600" height="900" fill="url(#glowB)"/>
  <circle cx="1480" cy="156" r="176" fill="rgba(255,255,255,0.36)"/>
  <circle cx="1280" cy="760" r="240" fill="rgba(255,255,255,0.22)"/>
  <path d="M62 188 C132 132 222 134 316 188" stroke="#60a5fa" stroke-width="12" stroke-linecap="round" fill="none" opacity="0.35"/>
  <path d="M1248 152 C1346 98 1456 102 1532 162" stroke="#34d399" stroke-width="12" stroke-linecap="round" fill="none" opacity="0.30"/>
  <rect x="44" y="34" width="1512" height="88" rx="30" fill="rgba(255,255,255,0.90)" stroke="rgba(15,23,42,0.10)"/>
  ${logoMarkup}
  <text x="136" y="84" fill="#0f172a" font-family="Noto Sans Devanagari, Noto Sans, Arial, sans-serif" font-size="30" font-weight="800">${escapeXml(input.instituteName || "Nexora Institute")}</text>
  <text x="136" y="110" fill="#64748b" font-family="Noto Sans Devanagari, Noto Sans, Arial, sans-serif" font-size="14" font-weight="600">${escapeXml([input.documentTitle, input.subject].filter(Boolean).join(" · "))}</text>

  <rect x="72" y="164" width="820" height="632" rx="40" fill="rgba(255,255,255,0.84)" stroke="rgba(15,23,42,0.10)"/>
  <rect x="104" y="196" width="206" height="44" rx="22" fill="url(#accentA)" />
  <text x="132" y="224" fill="#ffffff" font-family="Noto Sans Devanagari, Noto Sans, Arial, sans-serif" font-size="22" font-weight="800">Question ${escapeXml(input.question.number || "")}</text>
  <text x="110" y="276" fill="#0f172a" font-family="Noto Sans Devanagari, Noto Sans, Arial, sans-serif" font-size="22" font-weight="700">${escapeXml(direction.layoutName)}</text>
  ${renderSvgTextLines(questionLines, 110, 334, 42, 54, "#111827", 800)}

  <text x="110" y="640" fill="#475569" font-family="Noto Sans Devanagari, Noto Sans, Arial, sans-serif" font-size="17" font-weight="700">${escapeXml(direction.styleSummary)}</text>
  <text x="110" y="676" fill="#64748b" font-family="Noto Sans Devanagari, Noto Sans, Arial, sans-serif" font-size="15" font-weight="600">${escapeXml(direction.visualCue)}</text>

  ${buildFallbackHeroGraphic(direction)}

  ${optionSvg}

  ${
      footerLine
          ? `
  <rect x="44" y="828" width="1512" height="42" rx="21" fill="rgba(15,23,42,0.78)"/>
  <text x="800" y="855" text-anchor="middle" fill="#f8fafc" font-family="Noto Sans Devanagari, Noto Sans, Arial, sans-serif" font-size="16" font-weight="700">${escapeXml(footerLine)}</text>
  `
          : ""
  }
</svg>`.trim();
}

function normalizeForComparison(value: string) {
    return String(value || "")
        .replace(/&nbsp;/gi, " ")
        .replace(/&amp;/gi, "&")
        .replace(/&lt;/gi, "<")
        .replace(/&gt;/gi, ">")
        .replace(/&#39;|&apos;/gi, "'")
        .replace(/&quot;/gi, '"')
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .toLowerCase();
}

export function svgLooksUsableForQuestion(svgMarkup: string, snapshot: SlideVisualizationQuestionSnapshot) {
    if (!/<svg[\s\S]*<\/svg>/i.test(String(svgMarkup || ""))) {
        return false;
    }

    const normalizedSvg = normalizeForComparison(svgMarkup);

    const mustHave = [
        snapshot.questionHindi,
        snapshot.questionEnglish,
        ...(snapshot.options || []).flatMap((option) => [option.hindi, option.english]),
    ]
        .map((value) => cleanInlineText(value))
        .filter(Boolean)
        .filter((value, index, array) => array.indexOf(value) === index)
        .slice(0, 8);

    if (!mustHave.length) {
        return true;
    }

    return mustHave.every((text) => normalizedSvg.includes(normalizeForComparison(text)));
}

function countMatches(source: string, pattern: RegExp) {
    return (source.match(pattern) || []).length;
}

export function svgLooksPremiumEnough(svgMarkup: string) {
    const source = String(svgMarkup || "");
    const shapeCount = countMatches(source, /<(rect|circle|ellipse|path|polygon|polyline|line|image)\b/gi);
    const groupCount = countMatches(source, /<g\b/gi);
    const gradientCount = countMatches(source, /<(linearGradient|radialGradient)\b/gi);
    const textCount = countMatches(source, /<text\b/gi);

    if (/<image\b/i.test(source)) {
        return textCount >= 4 && (shapeCount >= 5 || groupCount >= 2);
    }

    return textCount >= 5 && (
        (shapeCount >= 10 && gradientCount >= 1) ||
        (shapeCount >= 8 && groupCount >= 4) ||
        (shapeCount >= 12)
    );
}
