import type { SlideVisualizationDirection } from "@/lib/slides-visualization";

export type SlideVisualizationContentType = "question" | "topic";

export type TopicSourcePage = {
    pageNumber: number;
    text: string;
    preview?: string;
    questionCount?: number;
    status?: string;
};

export type SlideVisualizationTopicSnapshot = {
    kind?: "topic";
    clientId?: string;
    number: string;
    title: string;
    summary: string;
    bulletPoints: string[];
    noteLines: string[];
    visualHint?: string;
    sourcePageNumbers: number[];
    sourcePageLabel?: string;
    sourceText?: string;
};

function cleanInlineText(value: unknown) {
    return String(value || "")
        .replace(/\s+/g, " ")
        .trim();
}

function cleanMultilineText(value: unknown, maxLength = 8_000) {
    return String(value || "")
        .replace(/\r/g, "\n")
        .replace(/[ \t]+/g, " ")
        .replace(/\n{3,}/g, "\n\n")
        .trim()
        .slice(0, maxLength);
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

function uniqueLines(lines: string[]) {
    return Array.from(
        new Set(
            lines
                .map((line) => cleanInlineText(line))
                .filter(Boolean)
        )
    );
}

function splitSentences(text: string) {
    return uniqueLines(
        cleanMultilineText(text)
            .split(/\n+/)
            .flatMap((line) => line.split(/(?<=[.?!।])\s+|;\s+/))
    );
}

function summarizeSourcePages(pageNumbers: number[]) {
    if (!pageNumbers.length) return "";
    if (pageNumbers.length === 1) return `Page ${pageNumbers[0]}`;
    return `Pages ${pageNumbers[0]}-${pageNumbers[pageNumbers.length - 1]}`;
}

function buildChunkTitle(text: string, pageLabel: string, index: number) {
    const sentences = splitSentences(text);
    const candidate = sentences.find((line) => line.length >= 12 && line.length <= 88);
    if (candidate) return candidate;

    const fallback = cleanInlineText(text.split(/\n+/)[0]);
    if (fallback) return clampText(fallback, 88);

    return `${pageLabel || "Slide"} Topic ${index + 1}`;
}

function buildChunkSummary(text: string, title: string) {
    const sentences = splitSentences(text).filter((line) => line !== title);
    return clampText(sentences[0] || title, 200);
}

function buildChunkBullets(text: string, title: string, summary: string) {
    const segments = splitSentences(text).filter((line) => line !== title && line !== summary);
    const bulletPoints = segments
        .filter((line) => line.length >= 16)
        .slice(0, 5)
        .map((line) => clampText(line, 120));

    if (bulletPoints.length >= 3) return bulletPoints;

    const lineBlocks = uniqueLines(
        cleanMultilineText(text)
            .split(/\n+/)
            .filter((line) => cleanInlineText(line).length >= 16)
    )
        .filter((line) => line !== title && line !== summary)
        .slice(0, 5)
        .map((line) => clampText(line, 120));

    return lineBlocks.length ? lineBlocks : [clampText(summary, 120)];
}

function buildChunkNotes(text: string, title: string, summary: string, bullets: string[]) {
    const reserved = new Set([title, summary, ...bullets]);
    const sentences = splitSentences(text)
        .filter((line) => !reserved.has(line))
        .slice(0, 2)
        .map((line) => clampText(line, 140));

    if (sentences.length) return sentences;
    return bullets.slice(0, 2).map((line) => clampText(line, 140));
}

function splitSourceTextIntoChunks(pages: TopicSourcePage[]) {
    const chunks: Array<{ text: string; pageNumbers: number[] }> = [];
    const maxChars = 820;

    let currentText = "";
    let currentPages: number[] = [];

    const flush = () => {
        const normalized = cleanMultilineText(currentText);
        if (!normalized) return;
        chunks.push({
            text: normalized,
            pageNumbers: Array.from(new Set(currentPages)).sort((left, right) => left - right),
        });
        currentText = "";
        currentPages = [];
    };

    for (const page of pages) {
        const text = cleanMultilineText(page.text, 6_000);
        if (!text) continue;

        const paragraphs = text
            .split(/\n{2,}/)
            .map((paragraph) => cleanMultilineText(paragraph, 1_200))
            .filter(Boolean);

        for (const paragraph of paragraphs) {
            const candidate = currentText ? `${currentText}\n\n${paragraph}` : paragraph;
            if (candidate.length <= maxChars) {
                currentText = candidate;
                currentPages.push(page.pageNumber);
                continue;
            }

            flush();
            currentText = paragraph;
            currentPages.push(page.pageNumber);
        }
    }

    flush();
    return chunks;
}

export function resolveInstituteFooterLine(input: {
    tagline?: string | null;
    description?: string | null;
    audienceSummary?: string | null;
    instituteName?: string | null;
}) {
    const candidates = [
        cleanInlineText(input.tagline),
        cleanInlineText(input.audienceSummary),
        cleanInlineText(input.description),
        `${cleanInlineText(input.instituteName)} building confident academic futures`,
        "Focused learning for confident student futures",
    ].filter(Boolean);

    for (const candidate of candidates) {
        const words = candidate.split(/\s+/).filter(Boolean);
        if (words.length >= 6 && words.length <= 7) {
            return words.join(" ");
        }
        if (words.length > 7) {
            return words.slice(0, 7).join(" ");
        }
    }

    return "Focused learning for confident student futures";
}

export function extractTopicSourcePagesFromDocument(jsonData: unknown): TopicSourcePage[] {
    if (!jsonData || typeof jsonData !== "object" || Array.isArray(jsonData)) return [];

    const payload = jsonData as Record<string, unknown>;
    const rawPages = Array.isArray(payload.topicSourcePages) ? payload.topicSourcePages : [];

    return rawPages
        .map((item): TopicSourcePage | null => {
            if (!item || typeof item !== "object" || Array.isArray(item)) return null;
            const entry = item as Record<string, unknown>;
            const pageNumber = Number.parseInt(String(entry.pageNumber || "0"), 10);
            const text = cleanMultilineText(entry.text, 8_000);
            if (!Number.isFinite(pageNumber) || pageNumber < 1 || !text) return null;

            return {
                pageNumber,
                text,
                preview: cleanInlineText(entry.preview) || undefined,
                questionCount: Number.isFinite(Number(entry.questionCount))
                    ? Math.max(0, Number(entry.questionCount))
                    : undefined,
                status: cleanInlineText(entry.status) || undefined,
            };
        })
        .filter((entry): entry is TopicSourcePage => Boolean(entry))
        .sort((left, right) => left.pageNumber - right.pageNumber);
}

export function buildTopicSlideSnapshot(
    value: unknown,
    index: number
): SlideVisualizationTopicSnapshot | null {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;

    const entry = value as Record<string, unknown>;
    const title = clampText(cleanInlineText(entry.title), 120);
    const summary = clampText(cleanInlineText(entry.summary), 220);
    const bulletPoints = uniqueLines(
        Array.isArray(entry.bulletPoints) ? entry.bulletPoints.map((line) => cleanInlineText(line)) : []
    )
        .map((line) => clampText(line, 120))
        .slice(0, 5);
    const noteLines = uniqueLines(
        Array.isArray(entry.noteLines) ? entry.noteLines.map((line) => cleanInlineText(line)) : []
    )
        .map((line) => clampText(line, 140))
        .slice(0, 3);
    const sourcePageNumbers = Array.isArray(entry.sourcePageNumbers)
        ? entry.sourcePageNumbers
              .map((page) => Number.parseInt(String(page || "0"), 10))
              .filter((page) => Number.isFinite(page) && page > 0)
        : [];

    if (!title && !summary && bulletPoints.length === 0) return null;

    return {
        kind: "topic",
        clientId: cleanInlineText(entry.clientId) || undefined,
        number: cleanInlineText(entry.number) || String(index + 1),
        title: title || summary || `Topic ${index + 1}`,
        summary: summary || bulletPoints[0] || title || `Topic ${index + 1}`,
        bulletPoints,
        noteLines,
        visualHint: clampText(cleanInlineText(entry.visualHint), 180) || undefined,
        sourcePageNumbers,
        sourcePageLabel: cleanInlineText(entry.sourcePageLabel) || summarizeSourcePages(sourcePageNumbers) || undefined,
        sourceText: cleanMultilineText(entry.sourceText, 3_000) || undefined,
    };
}

export function extractTopicSlidesFromDocument(jsonData: unknown): SlideVisualizationTopicSnapshot[] {
    if (!jsonData || typeof jsonData !== "object" || Array.isArray(jsonData)) return [];
    const payload = jsonData as Record<string, unknown>;
    const rawSlides = Array.isArray(payload.topicSlides) ? payload.topicSlides : [];

    return rawSlides
        .map((item, index) => buildTopicSlideSnapshot(item, index))
        .filter((entry): entry is SlideVisualizationTopicSnapshot => Boolean(entry));
}

export function isTopicSnapshot(value: unknown): value is SlideVisualizationTopicSnapshot {
    return Boolean(
        value &&
            typeof value === "object" &&
            !Array.isArray(value) &&
            (String((value as { kind?: unknown }).kind || "") === "topic" ||
                Boolean((value as { title?: unknown }).title) ||
                Array.isArray((value as { bulletPoints?: unknown }).bulletPoints))
    );
}

export function buildTopicSlidesFromSourcePages(
    pages: TopicSourcePage[]
): SlideVisualizationTopicSnapshot[] {
    return splitSourceTextIntoChunks(pages).map((chunk, index) => {
        const pageLabel = summarizeSourcePages(chunk.pageNumbers);
        const title = buildChunkTitle(chunk.text, pageLabel, index);
        const summary = buildChunkSummary(chunk.text, title);
        const bulletPoints = buildChunkBullets(chunk.text, title, summary);
        const noteLines = buildChunkNotes(chunk.text, title, summary, bulletPoints);
        const source = `${title}::${summary}::${bulletPoints.join("||")}::${chunk.text}`;

        return {
            kind: "topic",
            clientId: `topic_${hashText(source)}`,
            number: String(index + 1),
            title,
            summary,
            bulletPoints,
            noteLines,
            visualHint: `Educational infographic for ${title}`,
            sourcePageNumbers: chunk.pageNumbers,
            sourcePageLabel: pageLabel,
            sourceText: chunk.text,
        } satisfies SlideVisualizationTopicSnapshot;
    });
}

export function getTopicSlideKey(topic: SlideVisualizationTopicSnapshot, index: number) {
    const clientId = cleanInlineText(topic.clientId);
    if (clientId) return `topic:${clientId}`;

    return `topic:${index}:${hashText(
        [topic.number, topic.title, topic.summary, topic.bulletPoints.join("||")].join("::")
    )}`;
}

export function getTopicSlidePreview(topic: SlideVisualizationTopicSnapshot, maxLength = 130) {
    return clampText(
        [cleanInlineText(topic.title), cleanInlineText(topic.summary)].filter(Boolean).join(" · "),
        maxLength
    );
}

export function getTopicSlideVisualizationDirection(
    topic: SlideVisualizationTopicSnapshot
): SlideVisualizationDirection {
    const corpus = [
        topic.title,
        topic.summary,
        topic.visualHint,
        ...topic.bulletPoints,
        ...topic.noteLines,
    ]
        .map((line) => cleanInlineText(line).toLowerCase())
        .join(" ");

    if (/(cycle|process|flow|steps|lifecycle|क्रम|प्रक्रिया|चक्र)/i.test(corpus)) {
        return {
            layoutName: "Process explainer",
            styleSummary: "A sequential infographic slide with guided arrows, labeled stages, and concept-first hierarchy.",
            visualCue: "Show the idea as a clear step flow, cycle, or layered path with directional rhythm.",
            heroHint: "Reserve the center for a process diagram and let the text support it around the edges.",
            optionHint: "Turn bullet points into polished concept chips or callout cards.",
            decorativeHint: "Use fresh academic gradients, smart arrows, and premium educational geometry.",
        };
    }

    if (/(compare|difference|vs|types|classification|classify|भेद|प्रकार|तुलना)/i.test(corpus)) {
        return {
            layoutName: "Comparison board",
            styleSummary: "A side-by-side teaching board with structured contrast, badges, and concept separation.",
            visualCue: "Use split panels or columns to help the learner compare the topic quickly.",
            heroHint: "Keep the comparison structure dominant so the slide teaches at a glance.",
            optionHint: "Render notes as aligned contrast cards, labels, or category strips.",
            decorativeHint: "Use bold academic color coding, crisp dividers, and polished institute-slide spacing.",
        };
    }

    return {
        layoutName: "Topic infographic card",
        styleSummary: "A premium teaching slide with a strong title block, concept art, and easy-to-scan note cards.",
        visualCue: "Combine one hero visual with 3 to 5 content cards so the topic feels explained, not dumped as text.",
        heroHint: "Keep a strong center-left illustration or concept board that anchors the topic visually.",
        optionHint: "Turn note lines into elegant learning cards with strong visual rhythm.",
        decorativeHint: "Use bright scholarly gradients, subtle patterns, and polished classroom-presentation styling.",
    };
}

export function resolveTopicTextLayout(topic: SlideVisualizationTopicSnapshot) {
    return {
        title: cleanInlineText(topic.title),
        summary: cleanInlineText(topic.summary),
        bulletPoints: topic.bulletPoints.map((line) => cleanInlineText(line)).filter(Boolean),
        noteLines: topic.noteLines.map((line) => cleanInlineText(line)).filter(Boolean),
        sourcePageLabel: cleanInlineText(topic.sourcePageLabel),
    };
}

export function buildTopicSlidesVisualizationPrompt(input: {
    topic: SlideVisualizationTopicSnapshot;
    documentTitle: string;
    subject?: string;
    instituteName?: string | null;
    instituteFooterLine?: string | null;
}) {
    const direction = getTopicSlideVisualizationDirection(input.topic);
    const sourceLabel = cleanInlineText(input.topic.sourcePageLabel);

    return [
        "Iss topic ke liye ek premium teaching slide image banao.",
        "Output ek direct 16:9 landscape slide image hona chahiye, infographic presentation style me.",
        "Title, summary, bullet points, aur notes EXACTLY niche diye gaye text ke hisaab se hi image ke andar render hone chahiye.",
        "Text ko paraphrase, shorten, translate, reorder, ya invent mat karo.",
        "Slide ke top-left me institute logo rakho aur uske bilkul right side me institute name likho.",
        input.instituteFooterLine
            ? `Slide ke footer me EXACT yehi short intro line har slide par same rakho: ${input.instituteFooterLine}`
            : "",
        "Main content readable, balanced, high-contrast, presentation-ready, aur visually rich hona chahiye.",
        "Plain document page, worksheet, ya raw text dump mat banana.",
        "At least ek strong educational visual element hona chahiye: hero illustration, concept board, flow, labelled diagram, icons, ya infographic blocks.",
        `Preferred layout: ${direction.layoutName}.`,
        `Style target: ${direction.styleSummary}`,
        `Visual cue: ${direction.visualCue}`,
        `Hero treatment: ${direction.heroHint}`,
        `Card treatment: ${direction.optionHint}`,
        `Decorative system: ${direction.decorativeHint}`,
        input.instituteName ? `Institute: ${input.instituteName}` : "",
        input.subject ? `Subject: ${input.subject}` : "",
        input.documentTitle ? `Deck: ${input.documentTitle}` : "",
        sourceLabel ? `Source pages: ${sourceLabel}` : "",
        "EXACT TEXT TO RENDER:",
        `TITLE: ${input.topic.title}`,
        `SUMMARY: ${input.topic.summary}`,
        "POINTS:",
        ...input.topic.bulletPoints.map((line) => `- ${line}`),
        ...(input.topic.noteLines.length ? ["NOTES:", ...input.topic.noteLines.map((line) => `- ${line}`)] : []),
    ]
        .filter(Boolean)
        .join("\n");
}

export function buildTopicSlidesVisualizationRetryPrompt(input: {
    topic: SlideVisualizationTopicSnapshot;
    documentTitle: string;
    subject?: string;
    instituteName?: string | null;
    instituteFooterLine?: string | null;
}) {
    return [
        buildTopicSlidesVisualizationPrompt(input),
        "",
        "IMPORTANT RETRY NOTE:",
        "Previous attempt too plain, document-like, or not visually rich enough.",
        "This retry MUST look like a polished concept-teaching slide with stronger composition, better note cards, and obvious visual storytelling.",
    ].join("\n");
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
    const words = cleanInlineText(text).split(" ").filter(Boolean);
    const lines: string[] = [];
    let current = "";

    for (const word of words) {
        const next = current ? `${current} ${word}` : word;
        if (next.length <= maxChars) {
            current = next;
            continue;
        }
        if (current) lines.push(current);
        current = word;
    }
    if (current) lines.push(current);
    return lines;
}

function renderTextLines(
    lines: string[],
    x: number,
    startY: number,
    fontSize: number,
    lineHeight: number,
    fill: string,
    fontWeight = 700
) {
    let y = startY;
    return lines
        .map((line) => {
            const markup = `<text x="${x}" y="${y}" fill="${fill}" font-family="Noto Sans Devanagari, Noto Sans, Arial, sans-serif" font-size="${fontSize}" font-weight="${fontWeight}">${escapeXml(line)}</text>`;
            y += lineHeight;
            return markup;
        })
        .join("");
}

export function buildFallbackTopicSlideSvg(input: {
    topic: SlideVisualizationTopicSnapshot;
    instituteName?: string | null;
    documentTitle?: string;
    subject?: string;
    logoDataUri?: string | null;
    instituteFooterLine?: string | null;
}) {
    const layout = resolveTopicTextLayout(input.topic);
    const direction = getTopicSlideVisualizationDirection(input.topic);
    const titleLines = wrapText(layout.title, 26);
    const summaryLines = wrapText(layout.summary, 46).slice(0, 3);
    const footerLine = cleanInlineText(input.instituteFooterLine);
    const logoMarkup = input.logoDataUri
        ? `<image href="${input.logoDataUri}" x="54" y="34" width="70" height="70" preserveAspectRatio="xMidYMid meet" />`
        : "";

    const bulletMarkup = layout.bulletPoints
        .slice(0, 5)
        .map((line, index) => {
            const y = 470 + index * 84;
            const wrapped = wrapText(line, 30).slice(0, 3);
            return `
                <g>
                    <rect x="880" y="${y - 40}" width="628" height="${Math.max(68, wrapped.length * 24 + 32)}" rx="24" fill="rgba(255,255,255,0.90)" stroke="rgba(15,23,42,0.10)" />
                    <circle cx="920" cy="${y - 4}" r="18" fill="rgba(14,165,233,0.16)" />
                    <text x="913" y="${y + 3}" fill="#0284c7" font-family="Noto Sans Devanagari, Noto Sans, Arial, sans-serif" font-size="18" font-weight="800">${index + 1}</text>
                    ${renderTextLines(wrapped, 952, y + 4, 18, 22, "#0f172a", 700)}
                </g>
            `;
        })
        .join("");

    return `
<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="900" viewBox="0 0 1600 900">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#fffaf0"/>
      <stop offset="48%" stop-color="#eef6ff"/>
      <stop offset="100%" stop-color="#f0fdf4"/>
    </linearGradient>
    <linearGradient id="panel" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#0ea5e9"/>
      <stop offset="100%" stop-color="#14b8a6"/>
    </linearGradient>
  </defs>

  <rect width="1600" height="900" fill="url(#bg)"/>
  <circle cx="1420" cy="180" r="180" fill="rgba(255,255,255,0.38)"/>
  <circle cx="1320" cy="780" r="220" fill="rgba(255,255,255,0.22)"/>
  <rect x="34" y="24" width="1532" height="86" rx="28" fill="rgba(255,255,255,0.88)" stroke="rgba(15,23,42,0.10)"/>
  ${logoMarkup}
  <text x="136" y="74" fill="#0f172a" font-family="Noto Sans Devanagari, Noto Sans, Arial, sans-serif" font-size="30" font-weight="800">${escapeXml(input.instituteName || "Institute")}</text>
  <text x="136" y="98" fill="#64748b" font-family="Noto Sans Devanagari, Noto Sans, Arial, sans-serif" font-size="14" font-weight="600">${escapeXml([input.documentTitle, input.subject, layout.sourcePageLabel].filter(Boolean).join(" · "))}</text>

  <rect x="56" y="148" width="756" height="646" rx="40" fill="rgba(255,255,255,0.84)" stroke="rgba(15,23,42,0.10)"/>
  <rect x="90" y="184" width="240" height="46" rx="23" fill="url(#panel)"/>
  <text x="126" y="214" fill="#ffffff" font-family="Noto Sans Devanagari, Noto Sans, Arial, sans-serif" font-size="22" font-weight="800">Topic Slide ${escapeXml(input.topic.number)}</text>
  ${renderTextLines(titleLines, 92, 288, 42, 54, "#0f172a", 800)}
  ${renderTextLines(summaryLines, 94, 402, 22, 30, "#475569", 700)}

  <g transform="translate(882 146)">
    <rect x="0" y="0" width="648" height="266" rx="40" fill="rgba(255,255,255,0.18)" stroke="rgba(15,23,42,0.12)"/>
    <circle cx="468" cy="82" r="70" fill="rgba(14,165,233,0.16)"/>
    <circle cx="178" cy="190" r="84" fill="rgba(16,185,129,0.14)"/>
    <rect x="84" y="58" width="206" height="126" rx="28" fill="rgba(255,255,255,0.92)"/>
    <rect x="116" y="88" width="144" height="18" rx="9" fill="rgba(14,165,233,0.60)"/>
    <rect x="116" y="122" width="112" height="18" rx="9" fill="rgba(16,185,129,0.56)"/>
    <text x="86" y="232" fill="#0f172a" font-family="Noto Sans Devanagari, Noto Sans, Arial, sans-serif" font-size="20" font-weight="800">${escapeXml(direction.layoutName)}</text>
    <text x="86" y="258" fill="#475569" font-family="Noto Sans Devanagari, Noto Sans, Arial, sans-serif" font-size="15" font-weight="600">${escapeXml(direction.visualCue)}</text>
  </g>

  ${bulletMarkup}

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
