"use client";

import { ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import { useRouter, useSearchParams } from "next/navigation";
import toast from "react-hot-toast";
import {
    ArrowLeft,
    ChevronDown,
    ChevronLeft,
    ChevronRight,
    ChevronUp,
    Circle,
    Diamond,
    Download,
    Eraser,
    Eye,
    EyeOff,
    FileText,
    Highlighter,
    ImageDown,
    Layers,
    Maximize2,
    Minimize2,
    Minus,
    MousePointer2,
    MoveRight,
    Palette,
    PanelLeftClose,
    PanelLeftOpen,
    PenTool,
    Plus,
    Redo2,
    Save,
    Scissors,
    Settings2,
    Square,
    Trash2,
    Triangle,
    Type,
    Undo2,
    Upload,
    Copy,
    ClipboardPaste,
    X,
    Menu,
} from "lucide-react";
import Modal from "@/components/ui/Modal";
import { PDF_TEMPLATE_IDS, PdfTemplateId, resolvePdfTemplate } from "@/lib/pdf-templates";
import getStroke from "perfect-freehand";

function getSvgPathFromStroke(stroke: number[][]) {
    if (!stroke.length) return "";
    const d = stroke.reduce(
        (acc, [x0, y0], i, arr) => {
            const [x1, y1] = arr[(i + 1) % arr.length];
            acc.push(x0, y0, (x0 + x1) / 2, (y0 + y1) / 2);
            return acc;
        },
        ["M", ...stroke[0], "Q"]
    );
    d.push("Z");
    return d.join(" ");
}

type WhiteboardTool =
    | "select"
    | "pen"
    | "highlighter"
    | "eraser"
    | "text"
    | "line"
    | "arrow"
    | "rectangle"
    | "ellipse"
    | "triangle"
    | "diamond";
type StrokeTool = "pen" | "highlighter" | "eraser";
type ShapeTool = "line" | "arrow" | "rectangle" | "ellipse" | "triangle" | "diamond";
type StudioTab = "tools" | "style" | "input" | "output" | "view";
type DockPopup = "pen" | "highlighter" | "text" | "shapes" | "clean" | "settings" | "addSlide" | "eraser" | null;
type ImportMode = "replace" | "merge";

type StrokePoint = {
    x: number;
    y: number;
    pressure: number;
};

type Stroke = {
    id: string;
    tool: StrokeTool;
    color: string;
    size: number;
    opacity: number;
    points: StrokePoint[];
};

type TextAnnotation = {
    id: string;
    x: number;
    y: number;
    color: string;
    text: string;
    fontFamily: string;
    fontSize: number;
};

type ShapeAnnotation = {
    id: string;
    tool: ShapeTool;
    x1: number;
    y1: number;
    x2: number;
    y2: number;
    strokeColor: string;
    strokeWidth: number;
    filled: boolean;
    fillColor: string;
    fillOpacity: number;
};

type PageAnnotation = {
    strokes: Stroke[];
    texts: TextAnnotation[];
    shapes: ShapeAnnotation[];
};

type AnnotationMap = Record<string, PageAnnotation>;

type ModalConfig = {
    isOpen: boolean;
    title: string;
    message: string;
    confirmText?: string;
    cancelText?: string;
    type: "danger" | "warning" | "info" | "success";
    onConfirm?: () => void | Promise<void>;
};

type TextComposerState = {
    isOpen: boolean;
    x: number;
    y: number;
    value: string;
};

type FontChoice = {
    label: string;
    value: string;
};

type ToolItem = {
    id: WhiteboardTool;
    label: string;
    icon: ReactNode;
    showInDock?: boolean;
};

type WhiteboardDocumentListItem = {
    id: string;
    title: string;
    createdAt: string;
    subject?: string;
};

type PersistSnapshotOptions = {
    announce?: boolean;
    markTimestamp?: boolean;
};
export function hexToRgba(hex: string, alpha: number): string {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export function getThemeGradient(template: any) {
    if (!template) return "";
    const p = template.palette;
    return `
        radial-gradient(circle at 12% 0%, ${p.accentSoft}, transparent 35%),
        radial-gradient(circle at 90% 100%, ${p.accentSoft}, transparent 30%),
        linear-gradient(180deg, ${p.pageBgAlt}, ${p.pageBg})
    `.trim();
}

type SelectionEntry = { type: "shape"; id: string } | { type: "text"; id: string };
type SelectionTarget = SelectionEntry | null;

type MarqueeRect = {
    start: StrokePoint;
    end: StrokePoint;
};

type ResizeHandle = "nw" | "ne" | "sw" | "se" | "start" | "end";

type ShapeBounds = {
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
};

type ShapeHandlePoint = {
    handle: ResizeHandle;
    x: number;
    y: number;
};

type ResolvedSelection = SelectionEntry & {
    bounds: ShapeBounds;
};

type SelectionClipboardPayload = {
    shapes: ShapeAnnotation[];
    texts: TextAnnotation[];
};

type WhiteboardSnapshot = {
    version: number;
    documentId?: string;
    pageNumber: number;
    numPages?: number;
    pdfPageMapping?: Record<number, number | null>;
    annotations: AnnotationMap;
    blankSlideIds?: string[];
    hiddenPdfPages?: number[];
    title?: string;
    lastSavedDate?: string;
    settings?: {
        tool?: WhiteboardTool;
        inkColor?: string;
        strokeSize?: number;
        eraserSize?: number;
        highlighterOpacity?: number;
        fontFamily?: string;
        fontSize?: number;
        shapeFillColor?: string;
        shapeFilled?: boolean;
        shapeFillOpacity?: number;
        canvasTheme?: PdfTemplateId;
        customBgColor?: string | null;
        showGrid?: boolean;
        showPdfLayer?: boolean;
        zoomPercent?: number;
        showPageStrip?: boolean;
        showDock?: boolean;
        showStudioMenu?: boolean;
        activeStudioTab?: StudioTab;
        activePopup?: DockPopup;
        focusMode?: boolean;
    };
};

type PdfDocumentProxyLike = {
    numPages: number;
    getPage: (pageNumber: number) => Promise<any>;
    destroy?: () => Promise<void> | void;
};

type InteractionState =
    | { kind: "stroke"; id: string; pointerId: number }
    | { kind: "shape"; id: string; pointerId: number }
    | {
        kind: "move-shape";
        id: string;
        pointerId: number;
        startPoint: StrokePoint;
        originShape: ShapeAnnotation;
        mutated: boolean;
    }
    | {
        kind: "resize-shape";
        id: string;
        pointerId: number;
        startPoint: StrokePoint;
        originShape: ShapeAnnotation;
        handle: ResizeHandle;
        mutated: boolean;
    }
    | {
        kind: "move-text";
        id: string;
        pointerId: number;
        startPoint: StrokePoint;
        originText: TextAnnotation;
        mutated: boolean;
    }
    | {
        kind: "marquee";
        pointerId: number;
        startPoint: StrokePoint;
        additive: boolean;
    }
    | null;

type ViewportTransform = {
    x: number;
    y: number;
    scale: number;
};

type TouchPointerPoint = {
    x: number;
    y: number;
};

type ViewportGestureState =
    | {
        kind: "pan";
        pointerId: number;
        startX: number;
        startY: number;
        originX: number;
        originY: number;
    }
    | {
        kind: "pinch";
        startDistance: number;
        startCenterX: number;
        startCenterY: number;
        originX: number;
        originY: number;
        originScale: number;
    }
    | null;

const STROKE_TOOLS: StrokeTool[] = ["pen", "highlighter", "eraser"];
const SHAPE_TOOLS: ShapeTool[] = [
    "line",
    "arrow",
    "rectangle",
    "ellipse",
    "triangle",
    "diamond",
];
const MAX_HISTORY_STEPS = 120;

const FONT_CHOICES: FontChoice[] = [
    {
        label: "Noto Devanagari",
        value: '"Noto Sans Devanagari", "Nirmala UI", "Segoe UI", sans-serif',
    },
    {
        label: "Segoe UI",
        value: '"Segoe UI", "Helvetica Neue", Arial, sans-serif',
    },
    {
        label: "Kalam Style",
        value: '"Kalam", "Comic Sans MS", "Bradley Hand", cursive',
    },
    {
        label: "Caveat Style",
        value: '"Caveat", "Segoe Print", "Bradley Hand", cursive',
    },
    {
        label: "JetBrains Mono",
        value: '"JetBrains Mono", "Consolas", monospace',
    },
];

const COLOR_SWATCHES = [
    "#ffffff", // Premium White
    "#FDE047", // Vibrant Yellow
    "#EF4444", // Modern Red
    "#10B981", // Emerald Green
    "#3B82F6", // Royal Blue
    "#8B5CF6", // Vivid Purple
    "#EC4899", // Hot Pink
    "#000000", // Stark Black
];

const STROKE_SIZE_PRESETS = [2, 4, 6, 10, 16];
const ERASER_SIZE_PRESETS = [10, 20, 30, 50, 80];
const FONT_SIZE_PRESETS = [16, 24, 32, 48, 64, 80];

const STUDIO_TABS: Array<{ id: StudioTab; label: string; icon: ReactNode }> = [
    { id: "tools", label: "Tools", icon: <PenTool className="h-4 w-4" /> },
    { id: "style", label: "Style", icon: <Palette className="h-4 w-4" /> },
    { id: "input", label: "Input", icon: <Upload className="h-4 w-4" /> },
    { id: "output", label: "Output", icon: <Download className="h-4 w-4" /> },
    { id: "view", label: "View", icon: <Settings2 className="h-4 w-4" /> },
];

const TOOL_ITEMS: ToolItem[] = [
    {
        id: "select",
        label: "Select",
        icon: <MousePointer2 className="h-4 w-4" />,
        showInDock: true,
    },
    { id: "pen", label: "Pen", icon: <PenTool className="h-4 w-4" />, showInDock: true },
    {
        id: "highlighter",
        label: "Highlighter",
        icon: <Highlighter className="h-4 w-4" />,
        showInDock: true,
    },
    { id: "eraser", label: "Eraser", icon: <Eraser className="h-4 w-4" />, showInDock: true },
    { id: "text", label: "Text", icon: <Type className="h-4 w-4" />, showInDock: true },
    { id: "line", label: "Line", icon: <Minus className="h-4 w-4" />, showInDock: true },
    { id: "arrow", label: "Arrow", icon: <MoveRight className="h-4 w-4" />, showInDock: true },
    {
        id: "rectangle",
        label: "Rectangle",
        icon: <Square className="h-4 w-4" />,
        showInDock: true,
    },
    { id: "ellipse", label: "Ellipse", icon: <Circle className="h-4 w-4" /> },
    { id: "triangle", label: "Triangle", icon: <Triangle className="h-4 w-4" /> },
    { id: "diamond", label: "Diamond", icon: <Diamond className="h-4 w-4" /> },
];

const TOOL_SHORTCUTS: Record<string, WhiteboardTool> = {
    v: "select",
    p: "pen",
    h: "highlighter",
    e: "eraser",
    t: "text",
    l: "line",
    a: "arrow",
    r: "rectangle",
    o: "ellipse",
    g: "triangle",
    d: "diamond",
};

function emptyPageAnnotation(): PageAnnotation {
    return { strokes: [], texts: [], shapes: [] };
}

function clamp(value: number, min: number, max: number) {
    return Math.min(Math.max(value, min), max);
}

function distanceBetweenPoints(a: TouchPointerPoint, b: TouchPointerPoint) {
    return Math.hypot(b.x - a.x, b.y - a.y);
}

function midpointBetweenPoints(a: TouchPointerPoint, b: TouchPointerPoint) {
    return {
        x: (a.x + b.x) / 2,
        y: (a.y + b.y) / 2,
    };
}

function deepClone<T>(value: T): T {
    return JSON.parse(JSON.stringify(value)) as T;
}

function isStrokeTool(tool: WhiteboardTool): tool is StrokeTool {
    return STROKE_TOOLS.includes(tool as StrokeTool);
}

function isShapeTool(tool: WhiteboardTool): tool is ShapeTool {
    return SHAPE_TOOLS.includes(tool as ShapeTool);
}

function hasPageContent(annotation: PageAnnotation | undefined) {
    return Boolean(
        annotation &&
        (annotation.strokes.length > 0 ||
            annotation.texts.length > 0 ||
            annotation.shapes.length > 0)
    );
}

function getShapeBounds(shape: ShapeAnnotation): ShapeBounds {
    return {
        minX: Math.min(shape.x1, shape.x2),
        minY: Math.min(shape.y1, shape.y2),
        maxX: Math.max(shape.x1, shape.x2),
        maxY: Math.max(shape.y1, shape.y2),
    };
}

function inflateBounds(bounds: ShapeBounds, paddingX: number, paddingY: number): ShapeBounds {
    return {
        minX: bounds.minX - paddingX,
        minY: bounds.minY - paddingY,
        maxX: bounds.maxX + paddingX,
        maxY: bounds.maxY + paddingY,
    };
}

function pointInBounds(point: StrokePoint, bounds: ShapeBounds): boolean {
    return (
        point.x >= bounds.minX &&
        point.x <= bounds.maxX &&
        point.y >= bounds.minY &&
        point.y <= bounds.maxY
    );
}

function boundsIntersect(a: ShapeBounds, b: ShapeBounds): boolean {
    return (
        a.minX <= b.maxX &&
        a.maxX >= b.minX &&
        a.minY <= b.maxY &&
        a.maxY >= b.minY
    );
}

function selectionKey(target: SelectionEntry): string {
    return `${target.type}:${target.id}`;
}

function isSameSelection(a: SelectionEntry, b: SelectionEntry): boolean {
    return a.type === b.type && a.id === b.id;
}

function dedupeSelections(targets: SelectionEntry[]): SelectionEntry[] {
    const seen = new Set<string>();
    const next: SelectionEntry[] = [];
    targets.forEach((target) => {
        const key = selectionKey(target);
        if (seen.has(key)) return;
        seen.add(key);
        next.push(target);
    });
    return next;
}

function distancePointToSegmentPx(
    px: number,
    py: number,
    x1: number,
    y1: number,
    x2: number,
    y2: number
) {
    const dx = x2 - x1;
    const dy = y2 - y1;
    if (dx === 0 && dy === 0) {
        return Math.hypot(px - x1, py - y1);
    }
    const t = clamp(((px - x1) * dx + (py - y1) * dy) / (dx * dx + dy * dy), 0, 1);
    const projX = x1 + t * dx;
    const projY = y1 + t * dy;
    return Math.hypot(px - projX, py - projY);
}

function getTextBounds(
    annotation: TextAnnotation,
    renderWidth: number,
    renderHeight: number
): ShapeBounds {
    const lines = annotation.text.split("\n");
    const longestLineLength = Math.max(...lines.map((line) => line.length), 1);
    const widthPx = Math.max(28, longestLineLength * annotation.fontSize * 0.56);
    const heightPx = Math.max(annotation.fontSize * 1.28, lines.length * annotation.fontSize * 1.28);
    const width = widthPx / Math.max(1, renderWidth);
    const height = heightPx / Math.max(1, renderHeight);

    return {
        minX: annotation.x,
        minY: annotation.y,
        maxX: annotation.x + width,
        maxY: annotation.y + height,
    };
}

function hitTestShape(
    shape: ShapeAnnotation,
    point: StrokePoint,
    renderWidth: number,
    renderHeight: number
): boolean {
    const thresholdPx = Math.max(9, shape.strokeWidth * 2.2);
    const pointPxX = point.x * renderWidth;
    const pointPxY = point.y * renderHeight;

    if (shape.tool === "line" || shape.tool === "arrow") {
        const distance = distancePointToSegmentPx(
            pointPxX,
            pointPxY,
            shape.x1 * renderWidth,
            shape.y1 * renderHeight,
            shape.x2 * renderWidth,
            shape.y2 * renderHeight
        );
        return distance <= thresholdPx;
    }

    const bounds = getShapeBounds(shape);
    const expanded = inflateBounds(
        bounds,
        thresholdPx / Math.max(1, renderWidth),
        thresholdPx / Math.max(1, renderHeight)
    );
    return pointInBounds(point, expanded);
}

function hitTestText(
    text: TextAnnotation,
    point: StrokePoint,
    renderWidth: number,
    renderHeight: number
): boolean {
    const bounds = getTextBounds(text, renderWidth, renderHeight);
    const expanded = inflateBounds(
        bounds,
        8 / Math.max(1, renderWidth),
        8 / Math.max(1, renderHeight)
    );
    return pointInBounds(point, expanded);
}

function getShapeHandlePoints(shape: ShapeAnnotation): ShapeHandlePoint[] {
    if (shape.tool === "line" || shape.tool === "arrow") {
        return [
            { handle: "start", x: shape.x1, y: shape.y1 },
            { handle: "end", x: shape.x2, y: shape.y2 },
        ];
    }

    const bounds = getShapeBounds(shape);
    return [
        { handle: "nw", x: bounds.minX, y: bounds.minY },
        { handle: "ne", x: bounds.maxX, y: bounds.minY },
        { handle: "sw", x: bounds.minX, y: bounds.maxY },
        { handle: "se", x: bounds.maxX, y: bounds.maxY },
    ];
}

function getHandleHit(
    shape: ShapeAnnotation,
    point: StrokePoint,
    renderWidth: number,
    renderHeight: number
): ResizeHandle | null {
    const thresholdPx = 11;
    const handles = getShapeHandlePoints(shape);
    for (const handle of handles) {
        const distance = Math.hypot(
            (point.x - handle.x) * renderWidth,
            (point.y - handle.y) * renderHeight
        );
        if (distance <= thresholdPx) {
            return handle.handle;
        }
    }
    return null;
}

function resizeShapeFromHandle(
    origin: ShapeAnnotation,
    handle: ResizeHandle,
    point: StrokePoint
): ShapeAnnotation {
    if ((origin.tool === "line" || origin.tool === "arrow") && (handle === "start" || handle === "end")) {
        if (handle === "start") {
            return {
                ...origin,
                x1: point.x,
                y1: point.y,
            };
        }
        return {
            ...origin,
            x2: point.x,
            y2: point.y,
        };
    }

    const base = getShapeBounds(origin);
    let minX = base.minX;
    let minY = base.minY;
    let maxX = base.maxX;
    let maxY = base.maxY;

    if (handle === "nw") {
        minX = point.x;
        minY = point.y;
    } else if (handle === "ne") {
        maxX = point.x;
        minY = point.y;
    } else if (handle === "sw") {
        minX = point.x;
        maxY = point.y;
    } else if (handle === "se") {
        maxX = point.x;
        maxY = point.y;
    }

    const minSize = 0.003;
    if (maxX - minX < minSize) {
        if (handle === "nw" || handle === "sw") {
            minX = maxX - minSize;
        } else {
            maxX = minX + minSize;
        }
    }
    if (maxY - minY < minSize) {
        if (handle === "nw" || handle === "ne") {
            minY = maxY - minSize;
        } else {
            maxY = minY + minSize;
        }
    }

    return {
        ...origin,
        x1: minX,
        y1: minY,
        x2: maxX,
        y2: maxY,
    };
}

function mergeAnnotations(base: AnnotationMap, incoming: AnnotationMap): AnnotationMap {
    const next: AnnotationMap = deepClone(base);
    Object.entries(incoming).forEach(([pageKey, payload]) => {
        const current = next[pageKey] || emptyPageAnnotation();
        next[pageKey] = {
            strokes: [...current.strokes, ...(payload.strokes || [])],
            texts: [...current.texts, ...(payload.texts || [])],
            shapes: [...current.shapes, ...(payload.shapes || [])],
        };
    });
    return next;
}

function normalizeSnapshot(raw: unknown): WhiteboardSnapshot | null {
    if (!raw || typeof raw !== "object") return null;
    const source = raw as Record<string, unknown>;
    const annotations =
        source.annotations && typeof source.annotations === "object"
            ? (source.annotations as AnnotationMap)
            : null;
    if (!annotations) return null;
    const pageNumber = Number.parseInt(String(source.pageNumber ?? "1"), 10);
    return {
        version: Number.parseInt(String(source.version ?? "1"), 10) || 1,
        documentId:
            typeof source.documentId === "string" && source.documentId.trim()
                ? source.documentId
                : undefined,
        pageNumber: Number.isFinite(pageNumber) ? Math.max(1, pageNumber) : 1,
        numPages: typeof source.numPages === "number" ? source.numPages : undefined,
        pdfPageMapping: typeof source.pdfPageMapping === "object" ? (source.pdfPageMapping as Record<number, number | null>) : undefined,
        blankSlideIds: Array.isArray(source.blankSlideIds) ? source.blankSlideIds : undefined,
        hiddenPdfPages: Array.isArray(source.hiddenPdfPages) ? source.hiddenPdfPages : undefined,
        annotations,
        title: typeof source.title === "string" ? source.title : undefined,
        lastSavedDate: typeof source.lastSavedDate === "string" ? source.lastSavedDate : undefined,
        settings:
            source.settings && typeof source.settings === "object"
                ? (source.settings as WhiteboardSnapshot["settings"])
                : undefined,
    };
}

function drawArrowHead(
    ctx: CanvasRenderingContext2D,
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    size: number
) {
    const angle = Math.atan2(y2 - y1, x2 - x1);
    const wing = Math.max(6, size * 1.7);
    const leftX = x2 - wing * Math.cos(angle - Math.PI / 6);
    const leftY = y2 - wing * Math.sin(angle - Math.PI / 6);
    const rightX = x2 - wing * Math.cos(angle + Math.PI / 6);
    const rightY = y2 - wing * Math.sin(angle + Math.PI / 6);

    ctx.beginPath();
    ctx.moveTo(x2, y2);
    ctx.lineTo(leftX, leftY);
    ctx.moveTo(x2, y2);
    ctx.lineTo(rightX, rightY);
    ctx.stroke();
}

function drawGrid(ctx: CanvasRenderingContext2D, width: number, height: number) {
    ctx.save();
    ctx.strokeStyle = "rgba(100,116,139,0.22)";
    ctx.lineWidth = 1;

    const step = 28;
    for (let x = step; x < width; x += step) {
        ctx.beginPath();
        ctx.moveTo(x + 0.5, 0);
        ctx.lineTo(x + 0.5, height);
        ctx.stroke();
    }

    for (let y = step; y < height; y += step) {
        ctx.beginPath();
        ctx.moveTo(0, y + 0.5);
        ctx.lineTo(width, y + 0.5);
        ctx.stroke();
    }
    ctx.restore();
}

function createAnnotationId() {
    return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

async function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
    return new Promise((resolve, reject) => {
        canvas.toBlob((blob) => {
            if (!blob) {
                reject(new Error("Could not encode canvas image"));
                return;
            }
            resolve(blob);
        }, "image/png");
    });
}

function downloadBlob(blob: Blob, fileName: string) {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = fileName;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
}

// Memory caching for 512MB RAM optimization devices
const MAX_CACHED_DOCS = 1;

interface CachedDocument {
    pdfData: Uint8Array;
    pdfUrl: string;
    pdfTitle: string;
    docProxy: any | null;
    numPages: number;
    pdfPageMapping: Record<number, number | null>;
    timestamp: number;
}
const documentCache: Record<string, CachedDocument> = {};

function enforceCacheLimits() {
    const keys = Object.keys(documentCache);
    if (keys.length <= MAX_CACHED_DOCS) return;

    // Sort by oldest first
    keys.sort((a, b) => documentCache[a].timestamp - documentCache[b].timestamp);

    // Remove oldest entries until we are within limits
    const toRemove = keys.slice(0, keys.length - MAX_CACHED_DOCS);
    for (const key of toRemove) {
        const doc = documentCache[key];
        try {
            if (doc.docProxy) {
                doc.docProxy.destroy();
            }
            URL.revokeObjectURL(doc.pdfUrl);
        } catch (e) {
            console.error("Error destroying cached doc proxy:", e);
        }
        delete documentCache[key];
    }
}

export default function WhiteboardWorkspace() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const documentId = searchParams.get("documentId");
    const titleParam = searchParams.get("title");
    const initialTitle = titleParam?.trim() || "PDF Whiteboard";

    const [pdfUrl, setPdfUrl] = useState<string | null>(null);
    const [pdfTitle, setPdfTitle] = useState(initialTitle);
    const [isLoadingPdf, setIsLoadingPdf] = useState(true);
    const [loadError, setLoadError] = useState("");
    const [pdfData, setPdfData] = useState<Uint8Array | null>(null);

    const [numPages, setNumPages] = useState(0);
    const [pageNumber, setPageNumber] = useState(1);
    const [pageInput, setPageInput] = useState("1");
    const [pageRatio, setPageRatio] = useState(1.4142);

    const [tool, setTool] = useState<WhiteboardTool>("pen");
    const [inkColor, setInkColor] = useState("#facc15");
    const [strokeSize, setStrokeSize] = useState(4);
    const [eraserSize, setEraserSize] = useState(20);
    const [highlighterOpacity, setHighlighterOpacity] = useState(0.28);
    const [fontFamily, setFontFamily] = useState(FONT_CHOICES[0].value);
    const [fontSize, setFontSize] = useState(30);
    const [shapeFilled, setShapeFilled] = useState(false);
    const [shapeFillColor, setShapeFillColor] = useState("#38bdf8");
    const [shapeFillOpacity, setShapeFillOpacity] = useState(0.22);

    const [showDock, setShowDock] = useState(true);
    const [activePopup, setActivePopup] = useState<DockPopup>(null);
    const [showPagesPanel, setShowPagesPanel] = useState(false);
    const [showMenuPanel, setShowMenuPanel] = useState(false);
    const [recentDocs, setRecentDocs] = useState<WhiteboardDocumentListItem[]>([]);
    const [isLoadingRecent, setIsLoadingRecent] = useState(false);
    const [canvasTheme, setCanvasTheme] = useState<PdfTemplateId>("professional");
    const [customBgColor, setCustomBgColor] = useState<string | null>(null);
    const [showPageStrip, setShowPageStrip] = useState(true);
    const [hiddenPdfPages, setHiddenPdfPages] = useState<number[]>([]);
    const [blankSlideIds, setBlankSlideIds] = useState<string[]>([]);
    const [showStudioMenu, setShowStudioMenu] = useState(true);
    const [isFocusMode, setIsFocusMode] = useState(false);
    const [activeStudioTab, setActiveStudioTab] = useState<StudioTab>("tools");
    const [isFullscreen, setIsFullscreen] = useState(false);
    const [showGrid, setShowGrid] = useState(false);
    const [showPdfLayer, setShowPdfLayer] = useState(true);
    const [zoomPercent, setZoomPercent] = useState(100);
    const [importMode, setImportMode] = useState<ImportMode>("replace");
    const [selectedElement, setSelectedElement] = useState<SelectionTarget>(null);
    const [selectedElements, setSelectedElements] = useState<SelectionEntry[]>([]);
    const [marqueeRect, setMarqueeRect] = useState<MarqueeRect | null>(null);

    const [annotations, setAnnotations] = useState<AnnotationMap>({});
    const annotationsRef = useRef<AnnotationMap>({});
    const [undoStack, setUndoStack] = useState<AnnotationMap[]>([]);
    const [redoStack, setRedoStack] = useState<AnnotationMap[]>([]);
    const [thumbnailMap, setThumbnailMap] = useState<Record<number, string>>({});
    const [isGeneratingThumbnails, setIsGeneratingThumbnails] = useState(false);
    const [pdfDocumentProxy, setPdfDocumentProxy] = useState<PdfDocumentProxyLike | null>(null);
    const [pdfPageMapping, setPdfPageMapping] = useState<Record<number, number | null>>({});

    const [textComposer, setTextComposer] = useState<TextComposerState>({
        isOpen: false,
        x: 0.4,
        y: 0.4,
        value: "",
    });

    const [isStorageReady, setIsStorageReady] = useState(false);
    const [lastSavedAt, setLastSavedAt] = useState("");
    const [isRenderingPage, setIsRenderingPage] = useState(false);

    const [modalConfig, setModalConfig] = useState<ModalConfig>({
        isOpen: false,
        title: "",
        message: "",
        type: "info",
    });

    const stageHostRef = useRef<HTMLDivElement>(null);
    const stageFrameRef = useRef<HTMLDivElement>(null);
    const dockRef = useRef<HTMLDivElement>(null);
    const workspaceRef = useRef<HTMLDivElement>(null);
    const pdfCanvasRef = useRef<HTMLCanvasElement>(null);
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const liveCanvasRef = useRef<HTMLCanvasElement>(null);
    const importInputRef = useRef<HTMLInputElement>(null);
    const pdfInputRef = useRef<HTMLInputElement>(null);
    const interactionRef = useRef<InteractionState>(null);
    const viewportGestureRef = useRef<ViewportGestureState>(null);
    const touchPointsRef = useRef<Map<number, TouchPointerPoint>>(new Map());
    const liveStrokeRef = useRef<Stroke | null>(null);
    const liveStrokeBBoxRef = useRef<{ minX: number; minY: number; maxX: number; maxY: number } | null>(null);
    const thumbnailJobRef = useRef(0);
    const selectionClipboardRef = useRef<SelectionClipboardPayload | null>(null);
    const pasteOffsetRef = useRef(0);
    const hydratedSnapshotRef = useRef<WhiteboardSnapshot | null>(null);
    const focusLayoutRef = useRef<{
        showPageStrip: boolean;
        showStudioMenu: boolean;
    } | null>(null);

    const [stageWidth, setStageWidth] = useState(880);
    const [dockHeight, setDockHeight] = useState(0);
    const [isMobileViewport, setIsMobileViewport] = useState(false);
    const isImmersiveMode = isFocusMode || isFullscreen;
    const [viewportTransform, setViewportTransform] = useState<ViewportTransform>({
        x: 0,
        y: 0,
        scale: 1,
    });
    const viewportTransformRef = useRef<ViewportTransform>(viewportTransform);
    const renderScale = isImmersiveMode ? 1 : zoomPercent / 100;
    const minimumRenderWidth = isImmersiveMode ? 220 : 320;
    const minimumRenderHeight = isImmersiveMode ? 220 : 320;
    const renderWidth = Math.max(minimumRenderWidth, Math.round(stageWidth * renderScale));
    const renderHeight = Math.max(minimumRenderHeight, Math.round(renderWidth * pageRatio));

    const storageKey = useMemo(
        () => `whiteboard:${documentId?.trim() || "ad-hoc"}`,
        [documentId]
    );

    const buildSnapshot = useCallback(
        (markTimestamp = false): WhiteboardSnapshot => ({
            version: 2,
            documentId: documentId || undefined,
            pageNumber,
            numPages,
            pdfPageMapping,
            blankSlideIds,
            hiddenPdfPages,
            annotations: annotationsRef.current,
            title: pdfTitle || "Blank Canvas Board",
            lastSavedDate: markTimestamp ? new Date().toISOString() : undefined,
            settings: {
                tool,
                inkColor,
                strokeSize,
                eraserSize,
                highlighterOpacity,
                fontFamily,
                fontSize,
                shapeFillColor,
                shapeFilled,
                shapeFillOpacity,
                canvasTheme,
                customBgColor,
                showGrid,
                showPdfLayer,
                zoomPercent,
                showPageStrip,
                showDock,
                showStudioMenu,
                activeStudioTab,
                focusMode: isFocusMode,
            },
        }),
        [
            activeStudioTab,
            annotationsRef,
            blankSlideIds,
            canvasTheme,
            customBgColor,
            documentId,
            eraserSize,
            fontFamily,
            fontSize,
            hiddenPdfPages,
            highlighterOpacity,
            inkColor,
            isFocusMode,
            numPages,
            pageNumber,
            pdfPageMapping,
            pdfTitle,
            shapeFillColor,
            shapeFillOpacity,
            shapeFilled,
            showDock,
            showGrid,
            showPageStrip,
            showPdfLayer,
            showStudioMenu,
            strokeSize,
            tool,
            zoomPercent,
        ]
    );

    const persistSnapshot = useCallback(
        (options?: PersistSnapshotOptions) => {
            if (typeof window === "undefined") return false;

            try {
                const snapshot = buildSnapshot(options?.markTimestamp !== false);
                window.localStorage.setItem(storageKey, JSON.stringify(snapshot));

                if (options?.markTimestamp !== false) {
                    setLastSavedAt(
                        new Date().toLocaleTimeString("en-GB", {
                            hour: "2-digit",
                            minute: "2-digit",
                            second: "2-digit",
                        })
                    );
                }

                if (options?.announce) {
                    toast.success("Whiteboard saved");
                }
                return true;
            } catch (error) {
                console.error("Failed to persist whiteboard state:", error);
                if (options?.announce) {
                    toast.error("Failed to save whiteboard state");
                }
                return false;
            }
        },
        [buildSnapshot, storageKey]
    );

    const persistAndNavigate = useCallback(
        (href: string) => {
            persistSnapshot({ announce: false, markTimestamp: true });
            router.push(href);
        },
        [persistSnapshot, router]
    );

    useEffect(() => {
        const syncViewport = () => {
            setIsMobileViewport(window.innerWidth < 768);
        };

        syncViewport();
        window.addEventListener("resize", syncViewport);
        return () => window.removeEventListener("resize", syncViewport);
    }, []);

    const clampViewportTransform = useCallback(
        (next: ViewportTransform): ViewportTransform => {
            const scale = clamp(next.scale, 0.2, 5.0);

            return {
                x: next.x,
                y: next.y,
                scale,
            };
        },
        []
    );

    const updateViewportTransform = useCallback(
        (
            next:
                | ViewportTransform
                | ((prev: ViewportTransform) => ViewportTransform)
        ) => {
            setViewportTransform((prev) => {
                const resolved = typeof next === "function" ? next(prev) : next;
                return clampViewportTransform(resolved);
            });
        },
        [clampViewportTransform]
    );

    const getActiveTouchPair = useCallback((): [TouchPointerPoint, TouchPointerPoint] | null => {
        const points = Array.from(touchPointsRef.current.values());
        if (points.length < 2) return null;
        return [points[0], points[1]];
    }, []);

    const beginPinchGesture = useCallback(() => {
        const pair = getActiveTouchPair();
        if (!pair) return;
        const [first, second] = pair;
        const distance = distanceBetweenPoints(first, second);
        if (!Number.isFinite(distance) || distance < 8) return;
        const center = midpointBetweenPoints(first, second);
        const current = viewportTransformRef.current;
        viewportGestureRef.current = {
            kind: "pinch",
            startDistance: distance,
            startCenterX: center.x,
            startCenterY: center.y,
            originX: current.x,
            originY: current.y,
            originScale: current.scale,
        };
    }, [getActiveTouchPair]);

    useEffect(() => {
        annotationsRef.current = annotations;
    }, [annotations]);

    useEffect(() => {
        viewportTransformRef.current = viewportTransform;
    }, [viewportTransform]);

    useEffect(() => {
        setPageInput(String(pageNumber));
        setTextComposer((prev) => ({ ...prev, isOpen: false, value: "" }));
        setSelectedElement(null);
        setSelectedElements([]);
        setMarqueeRect(null);
    }, [pageNumber]);

    useEffect(() => {
        if (isImmersiveMode && zoomPercent !== 100) {
            setZoomPercent(100);
        }
    }, [isImmersiveMode, zoomPercent]);

    useEffect(() => {
        updateViewportTransform((prev) => ({ ...prev }));
    }, [isImmersiveMode, updateViewportTransform]);

    useEffect(() => {
        updateViewportTransform((prev) => ({ ...prev }));
    }, [renderWidth, renderHeight, updateViewportTransform]);

    useEffect(() => {
        touchPointsRef.current.clear();
        viewportGestureRef.current = null;
    }, [isImmersiveMode, tool, pageNumber]);

    useEffect(() => {
        if (typeof document === "undefined") return;
        const html = document.documentElement;
        const body = document.body;
        const previousHtmlOverflow = html.style.overflow;
        const previousBodyOverflow = body.style.overflow;
        const previousHtmlOverscroll = html.style.overscrollBehavior;
        const previousBodyOverscroll = body.style.overscrollBehavior;

        html.style.overflow = "hidden";
        body.style.overflow = "hidden";
        html.style.overscrollBehavior = "none";
        body.style.overscrollBehavior = "none";

        return () => {
            html.style.overflow = previousHtmlOverflow;
            body.style.overflow = previousBodyOverflow;
            html.style.overscrollBehavior = previousHtmlOverscroll;
            body.style.overscrollBehavior = previousBodyOverscroll;
        };
    }, []);

    useEffect(() => {
        if (!showDock) {
            setDockHeight(0);
            return;
        }
        const dock = dockRef.current;
        if (!dock) return;

        const measure = () => {
            const height = Math.ceil(dock.getBoundingClientRect().height);
            setDockHeight((prev) => (prev === height ? prev : height));
        };

        measure();
        const observer = new ResizeObserver(measure);
        observer.observe(dock);
        return () => observer.disconnect();
    }, [showDock, isImmersiveMode]);

    useEffect(() => {
        const pageData = annotations[String(pageNumber)];
        if (!pageData) {
            setSelectedElement((prev) => (prev === null ? prev : null));
            setSelectedElements((prev) => (prev.length === 0 ? prev : []));
            return;
        }

        const existsInPage = (target: SelectionEntry) =>
            target.type === "shape"
                ? pageData.shapes.some((shape) => shape.id === target.id)
                : pageData.texts.some((text) => text.id === target.id);
        const sanitized = selectedElements.filter(existsInPage);
        const normalized = dedupeSelections(sanitized);
        setSelectedElements((prev) => {
            if (prev.length === normalized.length) {
                const unchanged = prev.every((entry, index) =>
                    isSameSelection(entry, normalized[index]!)
                );
                if (unchanged) return prev;
            }
            return normalized;
        });

        setSelectedElement((prev) => {
            if (prev && existsInPage(prev)) return prev;
            return normalized[0] || null;
        });
    }, [annotations, pageNumber, selectedElements]);

    // Removed isolated setIsRenderingPage(true) effect which conflicts with renderPage logic

    useEffect(() => {
        if (!showMenuPanel) return;

        let cancelled = false;
        setIsLoadingRecent(true);

        const loadDocuments = async () => {
            try {
                const response = await fetch("/api/documents?minimal=true&limit=16", {
                    cache: "no-store",
                });
                const data = await response.json().catch(() => ({}));
                if (!response.ok) {
                    throw new Error(data.error || "Failed to load your documents");
                }

                if (cancelled) return;
                const docs = Array.isArray(data.documents) ? data.documents : [];
                setRecentDocs(
                    docs.map((doc: any) => ({
                        id: String(doc.id || ""),
                        title: String(doc.title || "Untitled Document"),
                        createdAt: String(doc.createdAt || new Date().toISOString()),
                        subject: doc.subject ? String(doc.subject) : undefined,
                    })).filter((doc: WhiteboardDocumentListItem) => Boolean(doc.id))
                );
            } catch (error) {
                console.error("Failed to load whiteboard documents:", error);
                if (!cancelled) {
                    setRecentDocs([]);
                }
            } finally {
                if (!cancelled) {
                    setIsLoadingRecent(false);
                }
            }
        };

        void loadDocuments();

        return () => {
            cancelled = true;
        };
    }, [showMenuPanel]);

    useEffect(() => {
        const checkAutoNavigation = () => {
            setIsFullscreen(Boolean(document.fullscreenElement));
        };
        document.addEventListener("fullscreenchange", checkAutoNavigation);
        return () => document.removeEventListener("fullscreenchange", checkAutoNavigation);
    }, []);

    useEffect(() => {
        if (!stageHostRef.current) return;

        const resize = () => {
            if (!stageHostRef.current) return;
            const rect = stageHostRef.current.getBoundingClientRect();
            const immersiveMode = isFocusMode || isFullscreen;

            // padding horizontally: p-4 (16px*2) on mobile, p-6 (24px*2) on md
            const horizontalPadding = immersiveMode ? 8 : (rect.width >= 768 ? 48 : 32);
            const availableWidth = Math.max(240, Math.floor(rect.width - horizontalPadding));

            let nextWidth = availableWidth;

            // Fit by height so the PDF doesn't scroll offscreen or fall behind docks
            // non-immersive pb-28 is 112px bottom padding + p-4/p-6 top padding (16 or 24)
            const topPadding = immersiveMode ? 10 : (rect.width >= 768 ? 24 : 16);
            const bottomDockGap = showDock ? (immersiveMode ? dockHeight + 20 : 112) : 10;
            const verticalPadding = Math.max(10, topPadding + bottomDockGap + 6);

            const availableHeight = Math.max(220, Math.floor(rect.height - verticalPadding));

            const widthByHeight = Math.floor(
                availableHeight / Math.max(0.45, pageRatio)
            );

            if (Number.isFinite(widthByHeight) && widthByHeight > 0) {
                // Constrain width so the element fits exactly within the viewable height 
                nextWidth = Math.min(nextWidth, widthByHeight);
            }

            setStageWidth(nextWidth);
        };

        resize();
        const observer = new ResizeObserver(resize);
        observer.observe(stageHostRef.current);
        return () => observer.disconnect();
    }, [dockHeight, isFocusMode, isFullscreen, pageRatio, showDock]);

    useEffect(() => {
        if (!documentId) {
            setIsLoadingPdf(false);
            setLoadError("");
            setPdfData(null);
            setPdfDocumentProxy(null);
            setNumPages(1); // Default to 1 blank page
            setThumbnailMap({});
            return;
        }

        const controller = new AbortController();
        let cancelled = false;

        const loadPdf = async () => {
            setIsLoadingPdf(true);
            setLoadError("");

            // Check cache first
            if (documentCache[documentId]) {
                const cached = documentCache[documentId];
                const hydratedSnapshot = hydratedSnapshotRef.current;
                cached.timestamp = Date.now(); // update access time
                setPdfUrl(cached.pdfUrl);
                setPdfData(cached.pdfData);
                setPdfTitle(cached.pdfTitle);

                if (cached.docProxy) {
                    setPdfDocumentProxy(cached.docProxy);
                    if (
                        hydratedSnapshot?.documentId === documentId &&
                        hydratedSnapshot.pdfPageMapping
                    ) {
                        setNumPages(
                            Math.max(hydratedSnapshot.numPages || 0, cached.numPages || 0)
                        );
                        setPdfPageMapping(hydratedSnapshot.pdfPageMapping);
                    } else {
                        setNumPages(cached.numPages);
                        setPdfPageMapping(cached.pdfPageMapping);
                    }
                }
                setIsLoadingPdf(false);
                return;
            }

            try {
                const requestUrl = `/api/documents/${encodeURIComponent(documentId)}`;
                const retryDelaysMs = [0, 350, 900];
                let pdfResponse: Response | null = null;
                let lastError: Error | null = null;

                for (const delayMs of retryDelaysMs) {
                    if (delayMs > 0) {
                        await new Promise((resolve) => window.setTimeout(resolve, delayMs));
                    }
                    try {
                        pdfResponse = await fetch(requestUrl, {
                            method: "POST",
                            signal: controller.signal,
                        });
                        if (pdfResponse.ok) break;
                        lastError = new Error(
                            `Could not load PDF for whiteboard (HTTP ${pdfResponse.status}).`
                        );
                    } catch (error: any) {
                        if (error?.name === "AbortError") throw error;
                        lastError =
                            error instanceof Error
                                ? error
                                : new Error("Could not load PDF for whiteboard.");
                    }
                }

                if (!pdfResponse || !pdfResponse.ok) {
                    throw lastError || new Error("Could not load PDF for whiteboard.");
                }

                const blob = await pdfResponse.blob();
                const bytes = new Uint8Array(await blob.arrayBuffer());
                const objectUrl = URL.createObjectURL(blob);
                if (cancelled) {
                    URL.revokeObjectURL(objectUrl);
                    return;
                }

                setPdfUrl((prev) => {
                    if (prev && !Object.values(documentCache).some(doc => doc.pdfUrl === prev)) {
                        URL.revokeObjectURL(prev);
                    }
                    return objectUrl;
                });
                setPdfData(bytes);
                setPdfDocumentProxy(null); // will be populated in the other effect
                setPdfPageMapping({});
                setNumPages(0);
                setThumbnailMap({});

                // Add partially to cache; full caching happens when docProxy is loaded
                documentCache[documentId] = {
                    pdfData: bytes,
                    pdfUrl: objectUrl,
                    pdfTitle: pdfTitle || "PDF Whiteboard",
                    docProxy: null,
                    numPages: 0,
                    pdfPageMapping: {},
                    timestamp: Date.now()
                };
                enforceCacheLimits();

                setIsLoadingPdf(false);

                fetch(`/api/documents/${encodeURIComponent(documentId)}`, {
                    signal: controller.signal,
                })
                    .then((response) => (response.ok ? response.json() : null))
                    .then((info) => {
                        if (cancelled || !info) return;
                        const title = String(info?.document?.title || "").trim();
                        if (title) {
                            setPdfTitle(title);
                            if (documentCache[documentId]) {
                                documentCache[documentId].pdfTitle = title;
                            }
                        }
                    })
                    .catch(() => {
                        // Metadata load is optional; keep PDF rendering path unaffected.
                    });
            } catch (error: any) {
                if (error?.name === "AbortError") return;
                console.error("Whiteboard PDF load failed:", error);
                setLoadError(error.message || "Failed to open whiteboard PDF.");
                setPdfData(null);
                setPdfDocumentProxy(null);
                setPdfPageMapping({});
                setNumPages(0);
                setIsLoadingPdf(false);
            }
        };

        loadPdf();

        return () => {
            cancelled = true;
            controller.abort();
        };
    }, [documentId]);

    useEffect(() => {
        return () => {
            if (pdfUrl && !Object.values(documentCache).some(doc => doc.pdfUrl === pdfUrl)) {
                URL.revokeObjectURL(pdfUrl);
            }
        };
    }, [pdfUrl]);

    useEffect(() => {
        if (!pdfData || pdfData.length === 0) {
            setPdfDocumentProxy(null);
            if (!documentId) {
                setNumPages(1);
                setPageNumber(1);
            } else {
                setNumPages(0);
            }
            return;
        }

        // If doc is already in cache and we hit this effect, we don't need to re-parse
        if (documentId && documentCache[documentId] && documentCache[documentId].docProxy) {
            return;
        }

        let cancelled = false;
        let loadingTask: any = null;
        let docProxy: PdfDocumentProxyLike | null = null;

        const loadDocument = async () => {
            try {
                setIsRenderingPage(true);
                const pdfRuntimeUrl = "/pdfjs/pdf.mjs";
                const pdfjsLib: any = await import(/* webpackIgnore: true */ pdfRuntimeUrl);
                pdfjsLib.GlobalWorkerOptions.workerSrc = "/pdfjs/pdf.worker.min.mjs";

                loadingTask = pdfjsLib.getDocument({
                    data: pdfData.slice(0),
                    cMapUrl: "https://unpkg.com/pdfjs-dist@5.4.624/cmaps/",
                    cMapPacked: true,
                    standardFontDataUrl: "https://unpkg.com/pdfjs-dist@5.4.624/standard_fonts/"
                });
                docProxy = await loadingTask.promise;
                if (cancelled) return;

                setPdfDocumentProxy(docProxy);
                const total = Number(docProxy?.numPages) || 0;
                const hydratedSnapshot = hydratedSnapshotRef.current;
                const restoredMap =
                    hydratedSnapshot?.documentId === documentId &&
                    hydratedSnapshot.pdfPageMapping &&
                    Object.keys(hydratedSnapshot.pdfPageMapping).length > 0
                        ? hydratedSnapshot.pdfPageMapping
                        : null;
                const restoredTotal =
                    hydratedSnapshot?.documentId === documentId
                        ? Math.max(hydratedSnapshot.numPages || 0, total)
                        : total;

                const pageMap: Record<number, number | null> = {};
                for (let i = 1; i <= restoredTotal; i += 1) {
                    const restoredValue = restoredMap?.[i];
                    if (restoredValue === null) {
                        pageMap[i] = null;
                    } else if (
                        typeof restoredValue === "number" &&
                        restoredValue >= 1 &&
                        restoredValue <= total
                    ) {
                        pageMap[i] = restoredValue;
                    } else {
                        pageMap[i] = i <= total ? i : null;
                    }
                }

                setNumPages(restoredTotal);
                setPdfPageMapping(pageMap);

                // Update cache with parsed docProxy
                if (documentId && documentCache[documentId]) {
                    documentCache[documentId].docProxy = docProxy;
                    documentCache[documentId].numPages = restoredTotal;
                    documentCache[documentId].pdfPageMapping = pageMap;
                }

                if (restoredTotal > 0) {
                    setPageNumber((prev) => clamp(prev, 1, restoredTotal));
                    setPageInput((prev) => {
                        const parsed = Number.parseInt(prev, 10);
                        if (Number.isFinite(parsed)) {
                            return String(clamp(parsed, 1, restoredTotal));
                        }
                        return "1";
                    });
                } else {
                    setPageNumber(1);
                    setPageInput("1");
                }
            } catch (error: any) {
                if (cancelled) return;
                console.error("Whiteboard document load failed:", error);
                const message = String(error?.message || "PDF document could not be loaded.");
                setLoadError(
                    /Object\.defineProperty called on non-object/i.test(message)
                        ? "PDF renderer crashed during initialization. Please refresh once; the new renderer path should recover."
                        : message
                );
                setPdfDocumentProxy(null);
                setNumPages(0);
            } finally {
                if (!cancelled) {
                    setIsRenderingPage(false);
                }
            }
        };

        loadDocument();

        return () => {
            cancelled = true;
            try {
                loadingTask?.destroy?.();
            } catch {
                // noop
            }
            // Intentionally not destroying docProxy here to support aggressive caching
            // docProxy is only destroyed in enforceCacheLimits
        };
    }, [pdfData, documentId]);

    useEffect(() => {
        const canvas = pdfCanvasRef.current;
        if (!canvas || numPages <= 0) return;

        let cancelled = false;
        let renderTask: any = null;

        const renderPage = async () => {
            try {
                setIsRenderingPage(true);

                const mappedVal = pdfPageMapping[pageNumber];
                const pdfPageToLoad = mappedVal !== undefined
                    ? mappedVal
                    : (pdfDocumentProxy && pageNumber <= pdfDocumentProxy.numPages ? pageNumber : null);

                // If there's no PDF page to load for this slide index (e.g., inserted blank slide)
                if (!pdfPageToLoad || !pdfDocumentProxy) {
                    canvas.width = renderWidth;
                    canvas.height = renderHeight;
                    canvas.style.width = `${renderWidth}px`;
                    canvas.style.height = `${renderHeight}px`;
                    const context = canvas.getContext("2d");
                    if (context) {
                        try {
                            const bg = customBgColor || resolvePdfTemplate(canvasTheme).palette.pageBg;
                            context.fillStyle = bg;
                        } catch (e) {
                            context.fillStyle = customBgColor || "#ffffff";
                        }
                        context.fillRect(0, 0, renderWidth, renderHeight);
                    }
                    return;
                }

                const pdfPage = await pdfDocumentProxy.getPage(pdfPageToLoad);
                if (cancelled) return;

                const baseViewport = pdfPage.getViewport({ scale: 1 });
                const width = Math.max(1, Number(baseViewport.width) || renderWidth);
                const height = Math.max(1, Number(baseViewport.height) || renderHeight);
                setPageRatio(height / width);

                const scale = renderWidth / width;
                const viewport = pdfPage.getViewport({ scale });

                // Low memory dynamic DPR calculation
                let dpr = typeof window === "undefined" ? 1 : window.devicePixelRatio || 1;
                // For low ram targets (e.g., 512MB RAM), rendering large 4K canvases can exhaust memory.
                // We cap the canvas megapixels to around 5-6 million max (approx ~2.5k x 2.5k) to avoid crashes.
                const estimatedPixels = viewport.width * dpr * viewport.height * dpr;
                const MAX_SAFE_PIXELS = 5000000;

                if (estimatedPixels > MAX_SAFE_PIXELS) {
                    // Start scaling down DPR so we fit within max safe pixels
                    dpr = Math.max(1, Math.sqrt(MAX_SAFE_PIXELS / (viewport.width * viewport.height)));
                }

                canvas.width = Math.max(1, Math.floor(viewport.width * dpr));
                canvas.height = Math.max(1, Math.floor(viewport.height * dpr));
                canvas.style.width = `${Math.max(1, viewport.width)}px`;
                canvas.style.height = `${Math.max(1, viewport.height)}px`;

                const context = canvas.getContext("2d");
                if (!context) throw new Error("Canvas context is not available");

                context.setTransform(dpr, 0, 0, dpr, 0, 0);
                try {
                    const bg = customBgColor || resolvePdfTemplate(canvasTheme).palette.pageBg;
                    context.fillStyle = bg;
                } catch (e) {
                    context.fillStyle = customBgColor || "#ffffff";
                }
                context.fillRect(0, 0, viewport.width, viewport.height);

                renderTask = pdfPage.render({
                    canvasContext: context,
                    viewport,
                });

                await renderTask.promise;
            } catch (error: any) {
                if (cancelled) return;
                console.error("Whiteboard page render failed:", error);
                toast.error(error?.message || "Failed to render this page");
            } finally {
                if (!cancelled) {
                    setIsRenderingPage(false);
                }
            }
        };

        renderPage();

        return () => {
            cancelled = true;
            try {
                renderTask?.cancel?.();
            } catch {
                // noop
            }
        };
    }, [numPages, pageNumber, pdfDocumentProxy, renderHeight, renderWidth]);

    useEffect(() => {
        if (!pdfDocumentProxy || numPages <= 0) {
            setIsGeneratingThumbnails(false);
            return;
        }

        const jobId = Date.now();
        thumbnailJobRef.current = jobId;
        let cancelled = false;

        setIsGeneratingThumbnails(true);
        setThumbnailMap({});

        const generate = async () => {
            for (let page = 1; page <= numPages; page += 1) {
                if (cancelled || thumbnailJobRef.current !== jobId) return;
                try {
                    const mappedVal = pdfPageMapping[page];
                    const pdfPageToLoad = mappedVal !== undefined
                        ? mappedVal
                        : (page <= (pdfDocumentProxy?.numPages || 0) ? page : null);

                    if (pdfPageToLoad === null) continue;

                    const pdfPage = await pdfDocumentProxy.getPage(pdfPageToLoad);
                    const baseViewport = pdfPage.getViewport({ scale: 1 });
                    const scale = 130 / Math.max(1, baseViewport.width);
                    const viewport = pdfPage.getViewport({ scale });
                    const canvas = document.createElement("canvas");
                    canvas.width = Math.max(1, Math.floor(viewport.width));
                    canvas.height = Math.max(1, Math.floor(viewport.height));
                    const context = canvas.getContext("2d");
                    if (!context) continue;

                    await pdfPage.render({
                        canvasContext: context,
                        viewport,
                    }).promise;

                    const dataUrl = canvas.toDataURL("image/jpeg", 0.82);
                    if (cancelled || thumbnailJobRef.current !== jobId) return;
                    setThumbnailMap((prev) => ({ ...prev, [page]: dataUrl }));
                } catch (error) {
                    console.error(`Failed to render thumbnail for page ${page}:`, error);
                }
            }
            if (!cancelled && thumbnailJobRef.current === jobId) {
                setIsGeneratingThumbnails(false);
            }
        };

        generate();

        return () => {
            cancelled = true;
        };
    }, [numPages, pdfDocumentProxy]);

    // Generate thumbnails for strokes/annotations dynamically
    useEffect(() => {
        const timer = setTimeout(() => {
            if (!canvasRef.current) return;
            try {
                const PADDING = 1500;
                const dpr = typeof window === "undefined" ? 1 : window.devicePixelRatio || 1;
                const thumbCanvas = document.createElement("canvas");
                thumbCanvas.width = 320;
                thumbCanvas.height = 180;
                const ctx = thumbCanvas.getContext("2d");
                if (!ctx) return;

                // Draw background
                try {
                    ctx.fillStyle = customBgColor || resolvePdfTemplate(canvasTheme).palette.pageBg;
                } catch (e) {
                    ctx.fillStyle = customBgColor || "#ffffff";
                }
                ctx.fillRect(0, 0, 320, 180);

                const scale = Math.min(320 / renderWidth, 180 / renderHeight);
                const dx = (320 - renderWidth * scale) / 2;
                const dy = (180 - renderHeight * scale) / 2;

                if (pdfCanvasRef.current && pdfPageMapping[pageNumber]) {
                    ctx.drawImage(pdfCanvasRef.current, dx, dy, renderWidth * scale, renderHeight * scale);
                }

                if (canvasRef.current) {
                    ctx.drawImage(
                        canvasRef.current,
                        PADDING * dpr, PADDING * dpr, renderWidth * dpr, renderHeight * dpr,
                        dx, dy, renderWidth * scale, renderHeight * scale
                    );
                }

                const dataUrl = thumbCanvas.toDataURL("image/jpeg", 0.5);
                setThumbnailMap(prev => ({ ...prev, [pageNumber]: dataUrl }));
            } catch (error) {
                console.error("Failed to generate dynamic thumbnail:", error);
            }
        }, 1000); // 1 second debounce

        return () => clearTimeout(timer);
    }, [annotations, pageNumber, renderWidth, renderHeight, canvasTheme, customBgColor, pdfPageMapping]);

    useEffect(() => {
        setIsStorageReady(false);
        setAnnotations({});
        setUndoStack([]);
        setRedoStack([]);
        setLastSavedAt("");
        hydratedSnapshotRef.current = null;

        if (typeof window === "undefined") {
            setIsStorageReady(true);
            return;
        }

        try {
            const raw = window.localStorage.getItem(storageKey);
            if (!raw) {
                setIsStorageReady(true);
                return;
            }

            const parsed = normalizeSnapshot(JSON.parse(raw));
            if (!parsed) {
                setIsStorageReady(true);
                return;
            }

            hydratedSnapshotRef.current = parsed;
            setAnnotations(parsed.annotations || {});
            setPageNumber(parsed.pageNumber || 1);
            if (parsed.title) {
                setPdfTitle(parsed.title);
            }
            if (parsed.lastSavedDate) {
                const parsedSavedDate = new Date(parsed.lastSavedDate);
                if (!Number.isNaN(parsedSavedDate.getTime())) {
                    setLastSavedAt(
                        parsedSavedDate.toLocaleTimeString("en-GB", {
                            hour: "2-digit",
                            minute: "2-digit",
                            second: "2-digit",
                        })
                    );
                }
            }

            if (typeof parsed.numPages === "number" && parsed.numPages > 0) {
                setNumPages(parsed.numPages);
            }
            if (parsed.pdfPageMapping) {
                setPdfPageMapping(parsed.pdfPageMapping);
            }
            if (parsed.blankSlideIds) {
                setBlankSlideIds(parsed.blankSlideIds);
            }
            if (parsed.hiddenPdfPages) {
                setHiddenPdfPages(parsed.hiddenPdfPages);
            }

            const settings = parsed.settings;
            if (settings) {
                if (settings.tool) setTool(settings.tool);
                if (typeof settings.inkColor === "string") setInkColor(settings.inkColor);
                if (typeof settings.strokeSize === "number")
                    setStrokeSize(clamp(settings.strokeSize, 1, 24));
                if (typeof settings.eraserSize === "number")
                    setEraserSize(clamp(settings.eraserSize, 6, 120));
                if (typeof settings.highlighterOpacity === "number")
                    setHighlighterOpacity(clamp(settings.highlighterOpacity, 0.1, 0.8));
                if (typeof settings.fontFamily === "string") setFontFamily(settings.fontFamily);
                if (typeof settings.fontSize === "number")
                    setFontSize(clamp(settings.fontSize, 14, 72));
                if (typeof settings.shapeFillColor === "string")
                    setShapeFillColor(settings.shapeFillColor);
                if (typeof settings.shapeFilled === "boolean")
                    setShapeFilled(settings.shapeFilled);
                if (typeof settings.shapeFillOpacity === "number")
                    setShapeFillOpacity(clamp(settings.shapeFillOpacity, 0, 1));
                if (settings.canvasTheme && PDF_TEMPLATE_IDS.includes(settings.canvasTheme)) {
                    setCanvasTheme(settings.canvasTheme);
                }
                if (typeof settings.customBgColor === "string" || settings.customBgColor === null) {
                    setCustomBgColor(settings.customBgColor ?? null);
                }
                if (typeof settings.showGrid === "boolean") setShowGrid(settings.showGrid);
                if (typeof settings.showPdfLayer === "boolean")
                    setShowPdfLayer(settings.showPdfLayer);
                if (typeof settings.zoomPercent === "number")
                    setZoomPercent(clamp(settings.zoomPercent, 50, 180));
                if (typeof settings.showPageStrip === "boolean")
                    setShowPageStrip(settings.showPageStrip);
                if (typeof settings.showDock === "boolean") setShowDock(settings.showDock);
                if (typeof settings.showStudioMenu === "boolean")
                    setShowStudioMenu(settings.showStudioMenu);
                if (settings.activeStudioTab) setActiveStudioTab(settings.activeStudioTab);
                if (typeof settings.focusMode === "boolean") setIsFocusMode(settings.focusMode);
            }
        } catch (error) {
            console.error("Failed to load whiteboard state:", error);
        } finally {
            setIsStorageReady(true);
        }
    }, [storageKey]);

    useEffect(() => {
        if (!isStorageReady || typeof window === "undefined") return;

        const timer = window.setTimeout(() => {
            persistSnapshot({ announce: false, markTimestamp: true });
        }, 220);

        return () => window.clearTimeout(timer);
    }, [
        activeStudioTab,
        annotations,
        blankSlideIds,
        canvasTheme,
        customBgColor,
        documentId,
        eraserSize,
        fontFamily,
        fontSize,
        hiddenPdfPages,
        highlighterOpacity,
        inkColor,
        isStorageReady,
        numPages,
        pageNumber,
        pdfPageMapping,
        pdfTitle,
        persistSnapshot,
        shapeFillColor,
        shapeFillOpacity,
        shapeFilled,
        showDock,
        isFocusMode,
        showGrid,
        showPageStrip,
        showPdfLayer,
        showStudioMenu,
        strokeSize,
        zoomPercent,
    ]);

    useEffect(() => {
        if (!isStorageReady || typeof window === "undefined") return;

        const persistBeforeLeave = () => {
            persistSnapshot({ announce: false, markTimestamp: true });
        };

        window.addEventListener("beforeunload", persistBeforeLeave);
        window.addEventListener("pagehide", persistBeforeLeave);

        return () => {
            window.removeEventListener("beforeunload", persistBeforeLeave);
            window.removeEventListener("pagehide", persistBeforeLeave);
        };
    }, [isStorageReady, persistSnapshot]);

    useEffect(() => {
        const handleNativeWheel = (e: WheelEvent) => {
            if (e.ctrlKey || e.metaKey) {
                e.preventDefault();
            }
        };
        const handleNativeTouch = (e: TouchEvent) => {
            if (e.touches.length > 1) {
                e.preventDefault();
            }
        };

        document.addEventListener("wheel", handleNativeWheel, { passive: false });
        document.addEventListener("touchmove", handleNativeTouch, { passive: false });

        return () => {
            document.removeEventListener("wheel", handleNativeWheel);
            document.removeEventListener("touchmove", handleNativeTouch);
        };
    }, []);

    const pushUndoSnapshot = useCallback(() => {
        setUndoStack((prev) =>
            [...prev, deepClone(annotationsRef.current)].slice(-MAX_HISTORY_STEPS)
        );
        setRedoStack([]);
    }, []);

    const redrawCanvas = useCallback(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;

        const PADDING = 1500;
        const bufferWidth = renderWidth + PADDING * 2;
        const bufferHeight = renderHeight + PADDING * 2;

        let dpr = typeof window === "undefined" ? 1 : window.devicePixelRatio || 1;
        // Memory safety: iOS max canvas is ~16.7M, we limit to 25M.
        const SAFE_AREA = 25000000;
        if (bufferWidth * bufferHeight * dpr * dpr > SAFE_AREA) {
            dpr = Math.sqrt(SAFE_AREA / (bufferWidth * bufferHeight));
        }

        canvas.width = Math.max(1, Math.floor(bufferWidth * dpr));
        canvas.height = Math.max(1, Math.floor(bufferHeight * dpr));
        canvas.style.width = `${bufferWidth}px`;
        canvas.style.height = `${bufferHeight}px`;

        const ctx = canvas.getContext("2d");
        if (!ctx) return;

        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, bufferWidth, bufferHeight);

        ctx.translate(PADDING, PADDING);

        if (showGrid) {
            drawGrid(ctx, renderWidth, renderHeight);
        }

        const pageData = annotations[String(pageNumber)] || emptyPageAnnotation();

        pageData.shapes.forEach((shape) => {
            const x1 = shape.x1 * renderWidth;
            const y1 = shape.y1 * renderHeight;
            const x2 = shape.x2 * renderWidth;
            const y2 = shape.y2 * renderHeight;
            const minX = Math.min(x1, x2);
            const minY = Math.min(y1, y2);
            const width = Math.abs(x2 - x1);
            const height = Math.abs(y2 - y1);

            ctx.save();
            ctx.lineCap = "round";
            ctx.lineJoin = "round";
            ctx.strokeStyle = shape.strokeColor;
            ctx.lineWidth = Math.max(1.6, shape.strokeWidth);
            ctx.globalAlpha = 1;

            switch (shape.tool) {
                case "line":
                    ctx.beginPath();
                    ctx.moveTo(x1, y1);
                    ctx.lineTo(x2, y2);
                    ctx.stroke();
                    break;
                case "arrow":
                    ctx.beginPath();
                    ctx.moveTo(x1, y1);
                    ctx.lineTo(x2, y2);
                    ctx.stroke();
                    drawArrowHead(ctx, x1, y1, x2, y2, shape.strokeWidth);
                    break;
                case "rectangle":
                    if (shape.filled && width > 0 && height > 0) {
                        ctx.save();
                        ctx.globalAlpha = clamp(shape.fillOpacity, 0, 1);
                        ctx.fillStyle = shape.fillColor;
                        ctx.fillRect(minX, minY, width, height);
                        ctx.restore();
                    }
                    ctx.strokeRect(minX, minY, width, height);
                    break;
                case "ellipse":
                    ctx.beginPath();
                    ctx.ellipse(
                        minX + width / 2,
                        minY + height / 2,
                        Math.max(1, width / 2),
                        Math.max(1, height / 2),
                        0,
                        0,
                        Math.PI * 2
                    );
                    if (shape.filled && width > 0 && height > 0) {
                        ctx.save();
                        ctx.globalAlpha = clamp(shape.fillOpacity, 0, 1);
                        ctx.fillStyle = shape.fillColor;
                        ctx.fill();
                        ctx.restore();
                    }
                    ctx.stroke();
                    break;
                case "triangle": {
                    const topX = minX + width / 2;
                    const topY = minY;
                    const leftX = minX;
                    const leftY = minY + height;
                    const rightX = minX + width;
                    const rightY = minY + height;
                    ctx.beginPath();
                    ctx.moveTo(topX, topY);
                    ctx.lineTo(leftX, leftY);
                    ctx.lineTo(rightX, rightY);
                    ctx.closePath();
                    if (shape.filled && width > 0 && height > 0) {
                        ctx.save();
                        ctx.globalAlpha = clamp(shape.fillOpacity, 0, 1);
                        ctx.fillStyle = shape.fillColor;
                        ctx.fill();
                        ctx.restore();
                    }
                    ctx.stroke();
                    break;
                }
                case "diamond": {
                    const centerX = minX + width / 2;
                    const centerY = minY + height / 2;
                    ctx.beginPath();
                    ctx.moveTo(centerX, minY);
                    ctx.lineTo(minX + width, centerY);
                    ctx.lineTo(centerX, minY + height);
                    ctx.lineTo(minX, centerY);
                    ctx.closePath();
                    if (shape.filled && width > 0 && height > 0) {
                        ctx.save();
                        ctx.globalAlpha = clamp(shape.fillOpacity, 0, 1);
                        ctx.fillStyle = shape.fillColor;
                        ctx.fill();
                        ctx.restore();
                    }
                    ctx.stroke();
                    break;
                }
            }
            ctx.restore();
        });

        pageData.strokes.forEach((stroke) => {
            if (stroke.points.length === 0) return;

            const rawPoints = stroke.points.map((p) => [
                p.x * renderWidth,
                p.y * renderHeight,
            ] as [number, number]);

            const strokeData = getStroke(rawPoints, {
                size: stroke.tool === "eraser"
                    ? Math.max(12, stroke.size * 5)
                    : stroke.tool === "highlighter"
                        ? Math.max(16, stroke.size * 8)
                        : Math.max(4, stroke.size * 2), // Slightly thicker base for pen
                thinning: stroke.tool === "highlighter" || stroke.tool === "eraser" ? 0 : 0.75, // Strong calligraphy taper
                smoothing: 0.75, // Liquid smooth ink feel
                streamline: 0.65, // Predictive following
                simulatePressure: stroke.tool !== "highlighter" && stroke.tool !== "eraser",
            });

            const pathData = getSvgPathFromStroke(strokeData);
            const p2d = new Path2D(pathData);

            ctx.save();
            ctx.fillStyle = stroke.tool === "eraser" ? "rgba(0,0,0,1)" : stroke.color;

            if (stroke.tool === "eraser") {
                ctx.globalCompositeOperation = "destination-out";
                ctx.globalAlpha = 1;
            } else if (stroke.tool === "highlighter") {
                ctx.globalCompositeOperation = "multiply";
                ctx.globalAlpha = clamp(stroke.opacity, 0.1, 0.8);
            } else {
                ctx.globalCompositeOperation = "source-over";
                ctx.globalAlpha = 1;
            }

            ctx.fill(p2d);
            ctx.restore();
        });

        pageData.texts.forEach((item) => {
            const px = item.x * renderWidth;
            const py = item.y * renderHeight;
            const lines = item.text.split("\n");

            ctx.save();
            ctx.globalCompositeOperation = "source-over";
            ctx.fillStyle = item.color;
            ctx.font = `700 ${item.fontSize}px ${item.fontFamily}`;
            ctx.textBaseline = "top";
            const lineHeight = item.fontSize * 1.28;
            lines.forEach((line, lineIndex) => {
                ctx.fillText(line, px, py + lineIndex * lineHeight);
            });
            ctx.restore();
        });

        const selectedSet = new Set(selectedElements.map(selectionKey));
        if (selectedSet.size > 0) {
            pageData.shapes.forEach((shape) => {
                if (!selectedSet.has(`shape:${shape.id}`)) return;

                const bounds = getShapeBounds(shape);
                const minX = bounds.minX * renderWidth;
                const minY = bounds.minY * renderHeight;
                const width = Math.max(1, (bounds.maxX - bounds.minX) * renderWidth);
                const height = Math.max(1, (bounds.maxY - bounds.minY) * renderHeight);

                ctx.save();
                ctx.strokeStyle = "#22d3ee";
                ctx.lineWidth = 1.6;
                ctx.setLineDash([6, 4]);
                if (shape.tool === "line" || shape.tool === "arrow") {
                    ctx.beginPath();
                    ctx.moveTo(shape.x1 * renderWidth, shape.y1 * renderHeight);
                    ctx.lineTo(shape.x2 * renderWidth, shape.y2 * renderHeight);
                    ctx.stroke();
                } else {
                    ctx.strokeRect(minX, minY, width, height);
                }
                ctx.restore();
            });

            pageData.texts.forEach((text) => {
                if (!selectedSet.has(`text:${text.id}`)) return;
                const bounds = getTextBounds(text, renderWidth, renderHeight);
                const minX = bounds.minX * renderWidth;
                const minY = bounds.minY * renderHeight;
                const width = Math.max(1, (bounds.maxX - bounds.minX) * renderWidth);
                const height = Math.max(1, (bounds.maxY - bounds.minY) * renderHeight);

                ctx.save();
                ctx.strokeStyle = "#22d3ee";
                ctx.lineWidth = 1.6;
                ctx.setLineDash([6, 4]);
                ctx.strokeRect(minX, minY, width, height);
                ctx.restore();
            });
        }

        if (selectedElement?.type === "shape") {
            const activeShape = pageData.shapes.find((shape) => shape.id === selectedElement.id);
            if (activeShape) {
                ctx.save();
                const handles = getShapeHandlePoints(activeShape);
                handles.forEach((handle) => {
                    const px = handle.x * renderWidth;
                    const py = handle.y * renderHeight;
                    ctx.beginPath();
                    ctx.fillStyle = "#f8fafc";
                    ctx.strokeStyle = "#0ea5e9";
                    ctx.lineWidth = 1.8;
                    ctx.arc(px, py, 5.5, 0, Math.PI * 2);
                    ctx.fill();
                    ctx.stroke();
                });
                ctx.restore();
            }
        } else if (selectedElement?.type === "text") {
            const activeText = pageData.texts.find((text) => text.id === selectedElement.id);
            if (activeText) {
                const bounds = getTextBounds(activeText, renderWidth, renderHeight);
                const minX = bounds.minX * renderWidth;
                const minY = bounds.minY * renderHeight;
                ctx.save();
                ctx.beginPath();
                ctx.fillStyle = "#f8fafc";
                ctx.strokeStyle = "#0ea5e9";
                ctx.lineWidth = 1.8;
                ctx.arc(minX, minY, 5.5, 0, Math.PI * 2);
                ctx.fill();
                ctx.stroke();
                ctx.restore();
            }
        }

        if (marqueeRect) {
            const x = Math.min(marqueeRect.start.x, marqueeRect.end.x) * renderWidth;
            const y = Math.min(marqueeRect.start.y, marqueeRect.end.y) * renderHeight;
            const width = Math.abs(marqueeRect.start.x - marqueeRect.end.x) * renderWidth;
            const height = Math.abs(marqueeRect.start.y - marqueeRect.end.y) * renderHeight;
            if (width > 1 && height > 1) {
                ctx.save();
                ctx.strokeStyle = "rgba(14,165,233,0.95)";
                ctx.fillStyle = "rgba(14,165,233,0.15)";
                ctx.lineWidth = 1.4;
                ctx.setLineDash([5, 4]);
                ctx.fillRect(x, y, width, height);
                ctx.strokeRect(x, y, width, height);
                ctx.restore();
            }
        }
    }, [annotations, marqueeRect, pageNumber, renderHeight, renderWidth, selectedElement, selectedElements, showGrid]);

    useEffect(() => {
        redrawCanvas();
    }, [redrawCanvas]);

    const clearSelection = useCallback(() => {
        setSelectedElement(null);
        setSelectedElements([]);
    }, []);

    const setSingleSelection = useCallback((target: SelectionEntry | null) => {
        setSelectedElement(target);
        setSelectedElements(target ? [target] : []);
    }, []);

    const setSelectionWithActive = useCallback(
        (targets: SelectionEntry[], active?: SelectionTarget) => {
            const deduped = dedupeSelections(targets);
            setSelectedElements(deduped);
            if (active !== undefined) {
                setSelectedElement(active);
                return;
            }
            setSelectedElement(deduped[0] || null);
        },
        []
    );

    const toNormalizedPoint = (
        event: React.PointerEvent<HTMLCanvasElement> | PointerEvent
    ): StrokePoint | null => {
        const canvas = canvasRef.current;
        if (!canvas) return null;

        const rect = canvas.getBoundingClientRect();
        const localX = event.clientX - rect.left;
        const localY = event.clientY - rect.top;

        const PADDING = 1500;
        const logicalBufferWidth = renderWidth + PADDING * 2;
        const logicalBufferHeight = renderHeight + PADDING * 2;

        const percentageX = localX / rect.width;
        const percentageY = localY / rect.height;

        const logicalX = percentageX * logicalBufferWidth;
        const logicalY = percentageY * logicalBufferHeight;

        let pressure = 0.5;
        if ('pressure' in event && event.pressure !== undefined && event.pressure !== 0) {
            pressure = event.pressure;
        }

        return {
            x: (logicalX - PADDING) / renderWidth,
            y: (logicalY - PADDING) / renderHeight,
            pressure: pressure,
        };
    };

    const handlePointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
        if (activePopup) setActivePopup(null);
        if (showPagesPanel) setShowPagesPanel(false);
        if (showMenuPanel) setShowMenuPanel(false);

        if (tool === "select" && event.pointerType === "touch") {
            setTextComposer((prev) => ({ ...prev, isOpen: false, value: "" }));
            setMarqueeRect(null);

            touchPointsRef.current.set(event.pointerId, {
                x: event.clientX,
                y: event.clientY,
            });
            event.currentTarget.setPointerCapture(event.pointerId);

            if (touchPointsRef.current.size >= 2) {
                beginPinchGesture();
            } else {
                const current = viewportTransformRef.current;
                viewportGestureRef.current = {
                    kind: "pan",
                    pointerId: event.pointerId,
                    startX: event.clientX,
                    startY: event.clientY,
                    originX: current.x,
                    originY: current.y,
                };
            }
            return;
        }

        const point = toNormalizedPoint(event);
        if (!point) return;
        const pageKey = String(pageNumber);
        const pageData = annotationsRef.current[pageKey] || emptyPageAnnotation();

        if (tool === "select") {
            setTextComposer((prev) => ({ ...prev, isOpen: false, value: "" }));
            setMarqueeRect(null);

            if (!event.shiftKey && selectedElement?.type === "shape") {
                const currentShape = pageData.shapes.find(
                    (shape) => shape.id === selectedElement.id
                );
                if (currentShape) {
                    const handle = getHandleHit(currentShape, point, renderWidth, renderHeight);
                    if (handle) {
                        event.currentTarget.setPointerCapture(event.pointerId);
                        interactionRef.current = {
                            kind: "resize-shape",
                            id: currentShape.id,
                            pointerId: event.pointerId,
                            startPoint: point,
                            originShape: deepClone(currentShape),
                            handle,
                            mutated: false,
                        };
                        return;
                    }
                }
            }

            const hitText = [...pageData.texts]
                .reverse()
                .find((text) => hitTestText(text, point, renderWidth, renderHeight));
            const hitShape = [...pageData.shapes]
                .reverse()
                .find((shape) => hitTestShape(shape, point, renderWidth, renderHeight));

            const hitTarget: SelectionEntry | null = hitText
                ? { type: "text", id: hitText.id }
                : hitShape
                    ? { type: "shape", id: hitShape.id }
                    : null;

            if (hitTarget) {
                if (event.shiftKey) {
                    const exists = selectedElements.some((entry) =>
                        isSameSelection(entry, hitTarget)
                    );
                    const nextSelection = exists
                        ? selectedElements.filter((entry) => !isSameSelection(entry, hitTarget))
                        : dedupeSelections([...selectedElements, hitTarget]);
                    setSelectionWithActive(
                        nextSelection,
                        exists ? nextSelection[0] || null : hitTarget
                    );
                    return;
                }

                setSingleSelection(hitTarget);
                event.currentTarget.setPointerCapture(event.pointerId);
                if (hitTarget.type === "text" && hitText) {
                    interactionRef.current = {
                        kind: "move-text",
                        id: hitText.id,
                        pointerId: event.pointerId,
                        startPoint: point,
                        originText: deepClone(hitText),
                        mutated: false,
                    };
                    return;
                }
                if (hitTarget.type === "shape" && hitShape) {
                    interactionRef.current = {
                        kind: "move-shape",
                        id: hitShape.id,
                        pointerId: event.pointerId,
                        startPoint: point,
                        originShape: deepClone(hitShape),
                        mutated: false,
                    };
                    return;
                }
            }

            if (!event.shiftKey) {
                clearSelection();
            }
            if (!event.shiftKey) {
                event.currentTarget.setPointerCapture(event.pointerId);
                const current = viewportTransformRef.current;
                viewportGestureRef.current = {
                    kind: "pan",
                    pointerId: event.pointerId,
                    startX: event.clientX,
                    startY: event.clientY,
                    originX: current.x,
                    originY: current.y,
                };
                return;
            }

            event.currentTarget.setPointerCapture(event.pointerId);
            interactionRef.current = {
                kind: "marquee",
                pointerId: event.pointerId,
                startPoint: point,
                additive: event.shiftKey,
            };
            setMarqueeRect({ start: point, end: point });
            return;
        }

        if (tool === "text") {
            clearSelection();
            setMarqueeRect(null);
            setTextComposer({
                isOpen: true,
                x: point.x,
                y: point.y,
                value: "",
            });
            return;
        }

        clearSelection();
        setMarqueeRect(null);
        pushUndoSnapshot();

        const id = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
        event.currentTarget.setPointerCapture(event.pointerId);

        if (isStrokeTool(tool)) {
            const stroke: Stroke = {
                id,
                tool,
                color: tool === "eraser" ? "#ffffff" : inkColor,
                size: tool === "eraser" ? eraserSize : strokeSize,
                opacity: tool === "highlighter" ? highlighterOpacity : 1,
                points: [point],
            };
            interactionRef.current = { kind: "stroke", id, pointerId: event.pointerId };
            liveStrokeRef.current = stroke;
            liveStrokeBBoxRef.current = null;

            // Draw immediate first dab
            const liveCanvas = liveCanvasRef.current;
            const ctx = liveCanvas?.getContext("2d");
            if (ctx && liveCanvas) {
                drawLiveStroke(ctx);
            }
            return;
        }

        if (isShapeTool(tool)) {
            const shape: ShapeAnnotation = {
                id,
                tool,
                x1: point.x,
                y1: point.y,
                x2: point.x,
                y2: point.y,
                strokeColor: inkColor,
                strokeWidth: strokeSize,
                filled: shapeFilled,
                fillColor: shapeFillColor,
                fillOpacity: shapeFillOpacity,
            };
            interactionRef.current = { kind: "shape", id, pointerId: event.pointerId };

            setAnnotations((prev) => {
                const current = prev[pageKey] ? deepClone(prev[pageKey]) : emptyPageAnnotation();
                current.shapes.push(shape);
                return { ...prev, [pageKey]: current };
            });
            setSingleSelection({ type: "shape", id });
        }
    };

    const drawLiveStroke = useCallback((ctx: CanvasRenderingContext2D) => {
        const stroke = liveStrokeRef.current;
        if (!stroke) return;

        const PADDING = 1500;
        let dpr = typeof window === "undefined" ? 1 : window.devicePixelRatio || 1;
        const SAFE_AREA = 25000000;
        const bufferW = renderWidth + PADDING * 2;
        const bufferH = renderHeight + PADDING * 2;
        if (bufferW * bufferH * dpr * dpr > SAFE_AREA) {
            dpr = Math.sqrt(SAFE_AREA / (bufferW * bufferH));
        }

        ctx.save();
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

        const margin = Math.max(100, stroke.size * 10);
        let minX = Infinity;
        let minY = Infinity;
        let maxX = -Infinity;
        let maxY = -Infinity;

        for (const p of stroke.points) {
            const px = p.x * renderWidth + PADDING;
            const py = p.y * renderHeight + PADDING;
            if (px < minX) minX = px;
            if (py < minY) minY = py;
            if (px > maxX) maxX = px;
            if (py > maxY) maxY = py;
        }

        const currentBBox = {
            minX: minX - margin,
            minY: minY - margin,
            maxX: maxX + margin,
            maxY: maxY + margin
        };

        const lastBBox = liveStrokeBBoxRef.current;
        if (lastBBox) {
            const cx = Math.min(currentBBox.minX, lastBBox.minX);
            const cy = Math.min(currentBBox.minY, lastBBox.minY);
            const cw = Math.max(currentBBox.maxX, lastBBox.maxX) - cx;
            const ch = Math.max(currentBBox.maxY, lastBBox.maxY) - cy;
            ctx.clearRect(cx, cy, cw, ch);
        } else {
            ctx.clearRect(0, 0, bufferW, bufferH);
        }
        liveStrokeBBoxRef.current = currentBBox;

        ctx.translate(PADDING, PADDING);

        ctx.fillStyle = stroke.tool === "eraser" ? "rgba(0,0,0,1)" : stroke.color;

        if (stroke.tool === "eraser") {
            ctx.globalCompositeOperation = "destination-out";
            ctx.globalAlpha = 1;
        } else if (stroke.tool === "highlighter") {
            ctx.globalCompositeOperation = "multiply";
            ctx.globalAlpha = clamp(stroke.opacity, 0.1, 0.8);
        } else {
            ctx.globalCompositeOperation = "source-over";
            ctx.globalAlpha = 1;
        }

        const rawPoints = stroke.points.map((p) => [p.x * renderWidth, p.y * renderHeight]);
        const strokeData = getStroke(rawPoints, {
            size: stroke.tool === "eraser"
                ? Math.max(12, stroke.size * 5)
                : stroke.tool === "highlighter"
                    ? Math.max(16, stroke.size * 8)
                    : Math.max(4, stroke.size * 2),
            thinning: stroke.tool === "highlighter" || stroke.tool === "eraser" ? 0 : 0.75,
            smoothing: 0.75,
            streamline: 0.65,
            simulatePressure: stroke.tool !== "highlighter" && stroke.tool !== "eraser",
        });

        const pathData = getSvgPathFromStroke(strokeData);
        ctx.fill(new Path2D(pathData));

        if (stroke.tool === "eraser") {
            ctx.globalCompositeOperation = "source-over";
        }
        ctx.restore();
    }, [renderWidth, renderHeight]);

    const handlePointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
        if (
            tool === "select" &&
            event.pointerType === "touch" &&
            touchPointsRef.current.has(event.pointerId)
        ) {
            touchPointsRef.current.set(event.pointerId, {
                x: event.clientX,
                y: event.clientY,
            });

            if (touchPointsRef.current.size >= 2) {
                if (viewportGestureRef.current?.kind !== "pinch") {
                    beginPinchGesture();
                }
                const pair = getActiveTouchPair();
                const gesture = viewportGestureRef.current;
                if (pair && gesture?.kind === "pinch") {
                    const [first, second] = pair;
                    const distance = distanceBetweenPoints(first, second);
                    if (distance >= 6) {
                        const center = midpointBetweenPoints(first, second);
                        const scaleFactor = distance / Math.max(1, gesture.startDistance);
                        updateViewportTransform({
                            x: gesture.originX + (center.x - gesture.startCenterX),
                            y: gesture.originY + (center.y - gesture.startCenterY),
                            scale: gesture.originScale * scaleFactor,
                        });
                    }
                }
                return;
            }

            const gesture = viewportGestureRef.current;
            if (gesture?.kind === "pan" && gesture.pointerId === event.pointerId) {
                updateViewportTransform((prev) => ({
                    x: gesture.originX + (event.clientX - gesture.startX),
                    y: gesture.originY + (event.clientY - gesture.startY),
                    scale: prev.scale,
                }));
            }
            return;
        }

        const viewportGesture = viewportGestureRef.current;
        if (
            tool === "select" &&
            event.pointerType !== "touch" &&
            viewportGesture?.kind === "pan" &&
            viewportGesture.pointerId === event.pointerId
        ) {
            updateViewportTransform((prev) => ({
                x: viewportGesture.originX + (event.clientX - viewportGesture.startX),
                y: viewportGesture.originY + (event.clientY - viewportGesture.startY),
                scale: prev.scale,
            }));
            return;
        }

        const interaction = interactionRef.current;
        if (!interaction || interaction.pointerId !== event.pointerId) return;

        const point = toNormalizedPoint(event);
        if (!point) return;

        if (interaction.kind === "marquee") {
            setMarqueeRect({ start: interaction.startPoint, end: point });
            return;
        }

        if (interaction.kind === "stroke") {
            if (liveStrokeRef.current) {
                const p = toNormalizedPoint(event);
                if (p) liveStrokeRef.current.points.push(p);

                const liveCanvas = liveCanvasRef.current;
                const ctx = liveCanvas?.getContext("2d");
                if (ctx && liveCanvas) {
                    drawLiveStroke(ctx);
                }
            }
            return;
        }

        setAnnotations((prev) => {
            const pageKey = String(pageNumber);
            const current = prev[pageKey];
            if (!current) return prev;

            if (interaction.kind === "shape") {
                const shapeIndex = current.shapes.findIndex((shape) => shape.id === interaction.id);
                if (shapeIndex === -1) return prev;

                const nextShapes = [...current.shapes];
                nextShapes[shapeIndex] = {
                    ...nextShapes[shapeIndex],
                    x2: point.x,
                    y2: point.y,
                };

                return { ...prev, [pageKey]: { ...current, shapes: nextShapes } };
            }

            if (interaction.kind === "move-shape") {
                if (!interaction.mutated) {
                    pushUndoSnapshot();
                    interaction.mutated = true;
                }

                const shapeIndex = current.shapes.findIndex((shape) => shape.id === interaction.id);
                if (shapeIndex === -1) return prev;

                const base = getShapeBounds(interaction.originShape);
                const deltaXRaw = point.x - interaction.startPoint.x;
                const deltaYRaw = point.y - interaction.startPoint.y;
                const deltaX = deltaXRaw;
                const deltaY = deltaYRaw;

                const nextShape: ShapeAnnotation = {
                    ...interaction.originShape,
                    x1: interaction.originShape.x1 + deltaX,
                    y1: interaction.originShape.y1 + deltaY,
                    x2: interaction.originShape.x2 + deltaX,
                    y2: interaction.originShape.y2 + deltaY,
                };

                const nextShapes = [...current.shapes];
                nextShapes[shapeIndex] = nextShape;
                return { ...prev, [pageKey]: { ...current, shapes: nextShapes } };
            }

            if (interaction.kind === "resize-shape") {
                if (!interaction.mutated) {
                    pushUndoSnapshot();
                    interaction.mutated = true;
                }

                const shapeIndex = current.shapes.findIndex((shape) => shape.id === interaction.id);
                if (shapeIndex === -1) return prev;

                const nextShape = resizeShapeFromHandle(
                    interaction.originShape,
                    interaction.handle,
                    point
                );
                const nextShapes = [...current.shapes];
                nextShapes[shapeIndex] = nextShape;
                return { ...prev, [pageKey]: { ...current, shapes: nextShapes } };
            }

            if (interaction.kind === "move-text") {
                if (!interaction.mutated) {
                    pushUndoSnapshot();
                    interaction.mutated = true;
                }

                const textIndex = current.texts.findIndex((text) => text.id === interaction.id);
                if (textIndex === -1) return prev;

                const textBounds = getTextBounds(interaction.originText, renderWidth, renderHeight);
                const deltaXRaw = point.x - interaction.startPoint.x;
                const deltaYRaw = point.y - interaction.startPoint.y;
                const deltaX = deltaXRaw;
                const deltaY = deltaYRaw;

                const nextText: TextAnnotation = {
                    ...interaction.originText,
                    x: interaction.originText.x + deltaX,
                    y: interaction.originText.y + deltaY,
                };

                const nextTexts = [...current.texts];
                nextTexts[textIndex] = nextText;
                return { ...prev, [pageKey]: { ...current, texts: nextTexts } };
            }
            return prev;
        });
    };

    const finishPointerInteraction = (event: React.PointerEvent<HTMLCanvasElement>) => {
        if (
            tool === "select" &&
            event.pointerType === "touch" &&
            touchPointsRef.current.has(event.pointerId)
        ) {
            try {
                event.currentTarget.releasePointerCapture(event.pointerId);
            } catch {
                // ignore stale release errors
            }

            touchPointsRef.current.delete(event.pointerId);
            const remaining = Array.from(touchPointsRef.current.entries());

            if (remaining.length >= 2) {
                beginPinchGesture();
            } else if (remaining.length === 1) {
                const [pointerId, point] = remaining[0];
                const current = viewportTransformRef.current;
                viewportGestureRef.current = {
                    kind: "pan",
                    pointerId,
                    startX: point.x,
                    startY: point.y,
                    originX: current.x,
                    originY: current.y,
                };
            } else {
                viewportGestureRef.current = null;
            }
            return;
        }

        const viewportGesture = viewportGestureRef.current;
        if (
            tool === "select" &&
            event.pointerType !== "touch" &&
            viewportGesture?.kind === "pan" &&
            viewportGesture.pointerId === event.pointerId
        ) {
            try {
                event.currentTarget.releasePointerCapture(event.pointerId);
            } catch {
                // ignore stale release errors
            }
            viewportGestureRef.current = null;
            return;
        }

        const interaction = interactionRef.current;
        if (!interaction || interaction.pointerId !== event.pointerId) return;

        try {
            event.currentTarget.releasePointerCapture(event.pointerId);
        } catch {
            // ignore stale release errors
        }

        if (interaction.kind === "stroke" && liveStrokeRef.current) {
            const commitedStroke = { ...liveStrokeRef.current };
            liveStrokeRef.current = null;
            liveStrokeBBoxRef.current = null;

            const liveCanvas = liveCanvasRef.current;
            if (liveCanvas) {
                const ctx = liveCanvas.getContext('2d');
                ctx?.clearRect(0, 0, liveCanvas.width, liveCanvas.height);
            }

            setAnnotations((prev) => {
                const pageKey = String(pageNumber);
                const current = prev[pageKey] ? deepClone(prev[pageKey]) : emptyPageAnnotation();
                // Filter out any partial strokes with same ID if they accidentally leaked, then push commit
                current.strokes = current.strokes.filter(s => s.id !== commitedStroke.id);
                current.strokes.push(commitedStroke);
                return { ...prev, [pageKey]: current };
            });
        }

        if (interaction.kind === "marquee") {
            const start = interaction.startPoint;
            const end = marqueeRect?.end || interaction.startPoint;
            const selectionBounds: ShapeBounds = {
                minX: Math.min(start.x, end.x),
                minY: Math.min(start.y, end.y),
                maxX: Math.max(start.x, end.x),
                maxY: Math.max(start.y, end.y),
            };

            const width = selectionBounds.maxX - selectionBounds.minX;
            const height = selectionBounds.maxY - selectionBounds.minY;
            const tinySelection = width < 0.004 && height < 0.004;

            const pageKey = String(pageNumber);
            const pageData = annotationsRef.current[pageKey] || emptyPageAnnotation();
            const hits: SelectionEntry[] = [];

            if (!tinySelection) {
                pageData.shapes.forEach((shape) => {
                    if (boundsIntersect(getShapeBounds(shape), selectionBounds)) {
                        hits.push({ type: "shape", id: shape.id });
                    }
                });
                pageData.texts.forEach((text) => {
                    if (
                        boundsIntersect(
                            getTextBounds(text, renderWidth, renderHeight),
                            selectionBounds
                        )
                    ) {
                        hits.push({ type: "text", id: text.id });
                    }
                });
            }

            const nextSelection = interaction.additive
                ? dedupeSelections([...selectedElements, ...hits])
                : tinySelection
                    ? []
                    : dedupeSelections(hits);

            setSelectionWithActive(nextSelection, nextSelection[0] || null);
            setMarqueeRect(null);
        }

        interactionRef.current = null;
    };

    const handleViewportWheel = useCallback((event: WheelEvent) => {
        if (!stageHostRef.current) return;

        if (event.ctrlKey || event.metaKey) {
            event.preventDefault(); // Stop entire browser UI from zooming
            const rect = stageHostRef.current.getBoundingClientRect();
            const localX = event.clientX - rect.left - rect.width / 2;
            const localY = event.clientY - rect.top - rect.height / 2;
            const zoomFactor = Math.exp(-event.deltaY * 0.0022);

            updateViewportTransform((prev) => {
                const nextScale = clamp(prev.scale * zoomFactor, 0.2, 5.0);
                const ratio = nextScale / Math.max(0.01, prev.scale);
                return {
                    x: prev.x - localX * (ratio - 1),
                    y: prev.y - localY * (ratio - 1),
                    scale: nextScale,
                };
            });
            return;
        }

        updateViewportTransform((prev) => ({
            x: prev.x - event.deltaX,
            y: prev.y - event.deltaY,
            scale: prev.scale,
        }));
    }, [updateViewportTransform]);

    useEffect(() => {
        const stage = stageHostRef.current;
        if (!stage) return;
        stage.addEventListener("wheel", handleViewportWheel, { passive: false });
        return () => stage.removeEventListener("wheel", handleViewportWheel);
    }, [handleViewportWheel]);

    const requestConfirmation = (
        title: string,
        message: string,
        onConfirm: () => void | Promise<void>,
        type: ModalConfig["type"] = "warning",
        confirmText = "Confirm"
    ) => {
        setModalConfig({
            isOpen: true,
            title,
            message,
            type,
            onConfirm,
            confirmText,
            cancelText: "Cancel",
        });
    };

    const saveNow = useCallback(
        (options?: PersistSnapshotOptions) => {
            persistSnapshot({
                announce: options?.announce ?? true,
                markTimestamp: options?.markTimestamp ?? true,
            });
        },
        [persistSnapshot]
    );

    const commitText = () => {
        const text = textComposer.value.trim();
        if (!text) {
            setTextComposer((prev) => ({ ...prev, isOpen: false, value: "" }));
            return;
        }

        pushUndoSnapshot();

        const annotation: TextAnnotation = {
            id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            x: textComposer.x,
            y: textComposer.y,
            color: inkColor,
            text,
            fontFamily,
            fontSize,
        };

        setAnnotations((prev) => {
            const pageKey = String(pageNumber);
            const current = prev[pageKey] ? deepClone(prev[pageKey]) : emptyPageAnnotation();
            current.texts.push(annotation);
            return { ...prev, [pageKey]: current };
        });
        setSingleSelection({ type: "text", id: annotation.id });

        setTextComposer((prev) => ({ ...prev, isOpen: false, value: "" }));
        toast.success("Text annotation added");
    };

    const toggleFullscreen = async () => {
        try {
            if (!document.fullscreenElement) {
                if (workspaceRef.current) {
                    await workspaceRef.current.requestFullscreen();
                } else {
                    await document.documentElement.requestFullscreen();
                }
            } else {
                await document.exitFullscreen();
            }
        } catch (error) {
            console.error("Fullscreen toggle failed:", error);
            toast.error("Fullscreen action failed");
        }
    };

    const toggleFocusMode = useCallback(() => {
        setIsFocusMode((prev) => {
            const next = !prev;
            if (next) {
                focusLayoutRef.current = {
                    showPageStrip,
                    showStudioMenu,
                };
                setShowPageStrip(false);
                setShowStudioMenu(false);
                setShowDock(true);
            } else if (focusLayoutRef.current) {
                setShowPageStrip(focusLayoutRef.current.showPageStrip);
                setShowStudioMenu(focusLayoutRef.current.showStudioMenu);
            }
            return next;
        });
    }, [showPageStrip, showStudioMenu]);

    const changePage = (value: number, direction: 'next' | 'prev' | 'exact' = 'exact') => {
        if (numPages === 0) return;

        let nextPage = clamp(value, 1, numPages);

        if (direction !== 'exact') {
            while (hiddenPdfPages.includes(nextPage)) {
                if (direction === 'next') {
                    if (nextPage >= numPages) break;
                    nextPage++;
                } else {
                    if (nextPage <= 1) break;
                    nextPage--;
                }
            }

            // Revert if boundary is also hidden (edge case)
            if (hiddenPdfPages.includes(nextPage)) {
                nextPage = clamp(value, 1, numPages);
            }
        }

        setPageNumber(nextPage);
        setPageInput(String(nextPage));
    };

    const goToPageFromInput = () => {
        const parsed = Number.parseInt(pageInput, 10);
        if (!Number.isFinite(parsed)) {
            setPageInput(String(pageNumber));
            return;
        }
        changePage(parsed);
    };

    const clearCurrentPage = () => {
        const pageKey = String(pageNumber);
        if (!hasPageContent(annotationsRef.current[pageKey])) {
            toast.error("No annotations on this page");
            return;
        }

        requestConfirmation(
            "Clear current page",
            `This will remove all annotations from page ${pageNumber}.`,
            () => {
                pushUndoSnapshot();
                setAnnotations((prev) => {
                    if (!prev[pageKey]) return prev;
                    const next = { ...prev };
                    delete next[pageKey];
                    return next;
                });
                setSelectionWithActive([]);
                setMarqueeRect(null);
                toast.success(`Cleared annotations on page ${pageNumber}`);
            },
            "danger",
            "Clear Page"
        );
    };

    const clearAllPages = () => {
        if (Object.keys(annotationsRef.current).length === 0) {
            toast.error("No annotations to clear");
            return;
        }

        requestConfirmation(
            "Clear all pages",
            "This will remove every whiteboard annotation from all pages.",
            () => {
                pushUndoSnapshot();
                setAnnotations({});
                setSelectionWithActive([]);
                setMarqueeRect(null);
                toast.success("Cleared all annotations");
            },
            "danger",
            "Clear All"
        );
    };

    const undo = () => {
        setUndoStack((prev) => {
            if (prev.length === 0) {
                toast.error("Nothing to undo");
                return prev;
            }
            const next = [...prev];
            const snapshot = next.pop()!;
            setRedoStack((redoPrev) =>
                [...redoPrev, deepClone(annotationsRef.current)].slice(-MAX_HISTORY_STEPS)
            );
            setAnnotations(snapshot);
            return next;
        });
    };

    const redo = () => {
        setRedoStack((prev) => {
            if (prev.length === 0) {
                toast.error("Nothing to redo");
                return prev;
            }
            const next = [...prev];
            const snapshot = next.pop()!;
            setUndoStack((undoPrev) =>
                [...undoPrev, deepClone(annotationsRef.current)].slice(-MAX_HISTORY_STEPS)
            );
            setAnnotations(snapshot);
            return next;
        });
    };

    const deleteSelectedEntries = useCallback((options?: { announce?: boolean }) => {
        const announce = options?.announce !== false;
        if (selectedElements.length === 0) {
            if (announce) toast.error("No selected elements to delete");
            return false;
        }

        const pageKey = String(pageNumber);
        const pageData = annotationsRef.current[pageKey];
        if (!pageData) return false;

        const shapeIds = new Set(
            selectedElements
                .filter((entry): entry is { type: "shape"; id: string } => entry.type === "shape")
                .map((entry) => entry.id)
        );
        const textIds = new Set(
            selectedElements
                .filter((entry): entry is { type: "text"; id: string } => entry.type === "text")
                .map((entry) => entry.id)
        );
        if (shapeIds.size === 0 && textIds.size === 0) {
            if (announce) toast.error("No selected elements to delete");
            return false;
        }

        pushUndoSnapshot();
        setAnnotations((prev) => {
            const current = prev[pageKey];
            if (!current) return prev;
            const nextPage = deepClone(current);
            if (shapeIds.size > 0) {
                nextPage.shapes = nextPage.shapes.filter((shape) => !shapeIds.has(shape.id));
            }
            if (textIds.size > 0) {
                nextPage.texts = nextPage.texts.filter((text) => !textIds.has(text.id));
            }
            return { ...prev, [pageKey]: nextPage };
        });
        setSelectionWithActive([]);
        if (announce) toast.success("Selected elements deleted");
        return true;
    }, [pageNumber, pushUndoSnapshot, selectedElements, setSelectionWithActive]);

    const clearCurrentPageAnnotations = useCallback(() => {
        setAnnotations((prev) => {
            const pageKey = String(pageNumber);
            return {
                ...prev,
                [pageKey]: emptyPageAnnotation()
            };
        });
        setSelectedElements([]);
        setSelectedElement(null);
        toast.success("Page drawings cleared");
        setActivePopup(null);
    }, [pageNumber]);

    const clearAllPagesAnnotations = useCallback(() => {
        setAnnotations({});
        setSelectedElements([]);
        setSelectedElement(null);
        toast.success("Cleared drawings on all pages!");
        setActivePopup(null);
    }, []);

    const hidePdfBackgroundForCurrentPage = useCallback(() => {
        setHiddenPdfPages((prev) => {
            if (prev.includes(pageNumber)) return prev;
            return [...prev, pageNumber];
        });
        toast.success("PDF background hidden");
        setActivePopup(null);
    }, [pageNumber]);

    const removeCurrentSlide = useCallback(() => {
        const originalPdfPages = pdfDocumentProxy?.numPages || 0;
        if (pageNumber <= originalPdfPages) {
            toast.error("Cannot remove original PDF slides. Use 'Clean > Remove PDF Page' instead.");
            return;
        }

        setNumPages((prev) => prev - 1);

        setAnnotations((prev) => {
            const next = { ...prev };
            for (let i = pageNumber; i < numPages; i++) {
                if (next[String(i + 1)]) {
                    next[String(i)] = next[String(i + 1)];
                } else {
                    delete next[String(i)];
                }
            }
            delete next[String(numPages)];
            return next;
        });

        setHiddenPdfPages((prev) => {
            const next = prev.filter(p => p !== pageNumber)
                .map(p => p > pageNumber ? p - 1 : p);
            return Array.from(new Set(next));
        });

        if (pageNumber === numPages) {
            setPageNumber(Math.max(1, pageNumber - 1));
        }

        toast.success("Slide removed");
        setActivePopup(null);
    }, [pageNumber, numPages, pdfDocumentProxy]);

    const insertBlankSlide = useCallback((position: 'prev' | 'next' | 'last') => {
        const id = `blank-${Date.now()}`;
        setBlankSlideIds((prev) => [...prev, id]);

        const insertIndex = position === 'last'
            ? numPages + 1
            : position === 'prev'
                ? Math.max(1, pageNumber - 1)
                : pageNumber + 1;

        setNumPages((prev) => prev + 1);

        setPdfPageMapping(prev => {
            const next: Record<number, number | null> = {};
            for (let i = 1; i <= numPages; i++) {
                const existingVal = prev[i];
                const pdfVal = existingVal !== undefined ? existingVal : (i <= (pdfDocumentProxy?.numPages || 0) ? i : null);

                if (i >= insertIndex) {
                    next[i + 1] = pdfVal;
                } else {
                    next[i] = pdfVal;
                }
            }
            next[insertIndex] = null;
            return next;
        });

        setHiddenPdfPages(prev => prev.map(p => p >= insertIndex ? p + 1 : p));

        setAnnotations(prev => {
            const next: AnnotationMap = {};
            for (const [k, pagesData] of Object.entries(prev)) {
                const keyNum = parseInt(k, 10);
                if (keyNum >= insertIndex) {
                    next[String(keyNum + 1)] = pagesData;
                } else {
                    next[k] = pagesData;
                }
            }
            return next;
        });

        setPageNumber(insertIndex);
        setPageInput(String(insertIndex));
        setActivePopup(null);
        toast.success("Blank slide added");
    }, [numPages, pageNumber]);

    const buildCompositePageCanvas = useCallback(() => {
        const overlayCanvas = canvasRef.current;
        const pdfCanvas = pdfCanvasRef.current;

        if (!overlayCanvas && !pdfCanvas) return null;

        const PADDING = 1500;
        const width = renderWidth;
        const height = renderHeight;
        const output = document.createElement("canvas");
        output.width = width;
        output.height = height;

        const context = output.getContext("2d");
        if (!context) return null;

        try {
            if (customBgColor) {
                context.fillStyle = customBgColor;
                context.fillRect(0, 0, width, height);
            } else {
                const template = resolvePdfTemplate(canvasTheme);
                const gradient = context.createLinearGradient(0, 0, 0, height);
                gradient.addColorStop(0, template.palette.pageBgAlt);
                gradient.addColorStop(1, template.palette.pageBg);
                context.fillStyle = gradient;
                context.fillRect(0, 0, width, height);
                // Note: accurate radial soft accents are hard to perfectly port to 2D canvas dynamically here, 
                // but the linear base captures the primary theme feel for flat exports.
            }
        } catch (e) {
            context.fillStyle = customBgColor || "#ffffff";
            context.fillRect(0, 0, width, height);
        }

        if (pdfCanvas) {
            context.drawImage(pdfCanvas, 0, 0, width, height);
        }
        if (overlayCanvas) {
            // overlayCanvas is physically larger by PADDING, extracting just the PDF region
            context.drawImage(
                overlayCanvas,
                (PADDING * overlayCanvas.width) / (renderWidth + PADDING * 2),
                (PADDING * overlayCanvas.height) / (renderHeight + PADDING * 2),
                (renderWidth * overlayCanvas.width) / (renderWidth + PADDING * 2),
                (renderHeight * overlayCanvas.height) / (renderHeight + PADDING * 2),
                0,
                0,
                width,
                height
            );
        }

        return output;
    }, []);

    const exportCurrentPagePng = async () => {
        try {
            const composite = buildCompositePageCanvas();
            if (!composite) {
                toast.error("No rendered page to export");
                return;
            }
            const blob = await canvasToBlob(composite);
            const name = `${(pdfTitle || "whiteboard").replace(/\s+/g, "-")}-page-${pageNumber}.png`;
            downloadBlob(blob, name);
            toast.success("Exported current page PNG");
        } catch (error) {
            console.error("Export PNG failed:", error);
            toast.error("Failed to export PNG");
        }
    };

    const copyCurrentPagePng = async () => {
        try {
            const composite = buildCompositePageCanvas();
            if (!composite) {
                toast.error("No rendered page to copy");
                return;
            }
            if (!navigator.clipboard || typeof (window as any).ClipboardItem === "undefined") {
                toast.error("Clipboard image API not supported in this browser");
                return;
            }

            const blob = await canvasToBlob(composite);
            const item = new (window as any).ClipboardItem({ [blob.type]: blob });
            await navigator.clipboard.write([item]);
            toast.success("Copied page image to clipboard");
        } catch (error) {
            console.error("Copy image failed:", error);
            toast.error("Failed to copy image");
        }
    };

    const exportWhiteboardJson = () => {
        try {
            const snapshot = buildSnapshot(true);
            const blob = new Blob([JSON.stringify(snapshot, null, 2)], {
                type: "application/json",
            });
            const name = `${(pdfTitle || "whiteboard").replace(/\s+/g, "-")}-annotations.json`;
            downloadBlob(blob, name);
            toast.success("Exported whiteboard JSON");
        } catch (error) {
            console.error("Export JSON failed:", error);
            toast.error("Failed to export JSON");
        }
    };

    const applyImportedSnapshot = (snapshot: WhiteboardSnapshot) => {
        pushUndoSnapshot();

        setAnnotations((prev) =>
            importMode === "merge"
                ? mergeAnnotations(prev, snapshot.annotations || {})
                : snapshot.annotations || {}
        );

        if (importMode === "replace") {
            setPageNumber(snapshot.pageNumber || 1);
            if (typeof snapshot.numPages === "number" && snapshot.numPages > 0) {
                setNumPages(snapshot.numPages);
            }
            if (snapshot.pdfPageMapping) {
                setPdfPageMapping(snapshot.pdfPageMapping);
            }
            if (snapshot.blankSlideIds) {
                setBlankSlideIds(snapshot.blankSlideIds);
            }
            if (snapshot.hiddenPdfPages) {
                setHiddenPdfPages(snapshot.hiddenPdfPages);
            }
            if (snapshot.title) {
                setPdfTitle(snapshot.title);
            }
        }

        if (snapshot.settings) {
            const settings = snapshot.settings;
            if (settings.tool) setTool(settings.tool);
            if (typeof settings.inkColor === "string") setInkColor(settings.inkColor);
            if (typeof settings.strokeSize === "number")
                setStrokeSize(clamp(settings.strokeSize, 1, 24));
            if (typeof settings.eraserSize === "number")
                setEraserSize(clamp(settings.eraserSize, 6, 120));
            if (typeof settings.highlighterOpacity === "number")
                setHighlighterOpacity(clamp(settings.highlighterOpacity, 0.1, 0.8));
            if (typeof settings.fontFamily === "string") setFontFamily(settings.fontFamily);
            if (typeof settings.fontSize === "number")
                setFontSize(clamp(settings.fontSize, 14, 72));
            if (typeof settings.shapeFillColor === "string")
                setShapeFillColor(settings.shapeFillColor);
            if (typeof settings.shapeFilled === "boolean")
                setShapeFilled(settings.shapeFilled);
            if (typeof settings.shapeFillOpacity === "number")
                setShapeFillOpacity(clamp(settings.shapeFillOpacity, 0, 1));
            if (settings.canvasTheme && PDF_TEMPLATE_IDS.includes(settings.canvasTheme)) {
                setCanvasTheme(settings.canvasTheme);
            }
            if (typeof settings.customBgColor === "string" || settings.customBgColor === null) {
                setCustomBgColor(settings.customBgColor ?? null);
            }
            if (typeof settings.showGrid === "boolean") setShowGrid(settings.showGrid);
            if (typeof settings.showPdfLayer === "boolean")
                setShowPdfLayer(settings.showPdfLayer);
            if (typeof settings.zoomPercent === "number")
                setZoomPercent(clamp(settings.zoomPercent, 50, 180));
            if (typeof settings.showPageStrip === "boolean")
                setShowPageStrip(settings.showPageStrip);
            if (typeof settings.showDock === "boolean") setShowDock(settings.showDock);
            if (typeof settings.showStudioMenu === "boolean")
                setShowStudioMenu(settings.showStudioMenu);
            if (settings.activeStudioTab) setActiveStudioTab(settings.activeStudioTab);
            if (typeof settings.focusMode === "boolean") setIsFocusMode(settings.focusMode);
        }

        toast.success(
            importMode === "merge"
                ? "Annotations merged from JSON"
                : "Whiteboard imported from JSON"
        );
    };

    const handleImportFileChange = async (
        event: React.ChangeEvent<HTMLInputElement>
    ) => {
        const file = event.target.files?.[0];
        event.target.value = "";
        if (!file) return;

        try {
            const text = await file.text();
            const parsed = normalizeSnapshot(JSON.parse(text));
            if (!parsed) {
                throw new Error("Invalid whiteboard JSON payload");
            }
            applyImportedSnapshot(parsed);
        } catch (error: any) {
            console.error("Import whiteboard file failed:", error);
            toast.error(error.message || "Failed to import JSON");
        }
    };

    const handleImportPdfChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        event.target.value = "";
        if (!file) return;

        const uploadPromise = async () => {
            const formData = new FormData();
            formData.append('file', file);

            const response = await fetch('/api/documents', {
                method: 'POST',
                body: formData,
            });

            if (!response.ok) throw new Error("Upload failed");

            const data = await response.json();
            if (data.id) {
                saveNow({ announce: false, markTimestamp: true });
                router.push(`/whiteboard?documentId=${data.id}&title=${encodeURIComponent(file.name)}`);
            }
        };

        toast.promise(uploadPromise(), {
            loading: 'Uploading PDF to a new whiteboard...',
            success: 'PDF Uploaded!',
            error: 'Failed to upload PDF',
        });
        setShowMenuPanel(false);
    };

    const importFromClipboardJson = async () => {
        try {
            if (!navigator.clipboard?.readText) {
                toast.error("Clipboard read is not available in this browser");
                return;
            }
            const text = await navigator.clipboard.readText();
            const parsed = normalizeSnapshot(JSON.parse(text));
            if (!parsed) {
                throw new Error("Clipboard text is not a valid whiteboard JSON");
            }
            applyImportedSnapshot(parsed);
        } catch (error: any) {
            console.error("Import from clipboard failed:", error);
            toast.error(error.message || "Failed to import from clipboard");
        }
    };

    const insertClipboardText = async () => {
        try {
            if (!navigator.clipboard?.readText) {
                toast.error("Clipboard read is not available in this browser");
                return;
            }
            const text = (await navigator.clipboard.readText()).trim();
            if (!text) {
                toast.error("Clipboard has no text");
                return;
            }

            pushUndoSnapshot();
            const annotation: TextAnnotation = {
                id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
                x: 0.28,
                y: 0.24,
                color: inkColor,
                text,
                fontFamily,
                fontSize,
            };
            setAnnotations((prev) => {
                const pageKey = String(pageNumber);
                const current = prev[pageKey] ? deepClone(prev[pageKey]) : emptyPageAnnotation();
                current.texts.push(annotation);
                return { ...prev, [pageKey]: current };
            });
            toast.success("Inserted clipboard text as annotation");
        } catch (error: any) {
            console.error("Insert clipboard text failed:", error);
            toast.error(error.message || "Could not read clipboard text");
        }
    };

    const hasDocument = Boolean(documentId);
    const isPageStripVisible = showPageStrip && !isImmersiveMode;
    const totalPagesCount = useMemo(() => {
        return Math.max(numPages, Object.keys(pdfPageMapping).length);
    }, [numPages, pdfPageMapping]);

    const pageNumbers = useMemo(
        () => Array.from({ length: totalPagesCount }, (_, index) => index + 1),
        [totalPagesCount]
    );
    const currentPageData = annotations[String(pageNumber)] || emptyPageAnnotation();
    const annotatedPages = useMemo(
        () =>
            Object.values(annotations).filter((page) => hasPageContent(page)).length,
        [annotations]
    );
    const resolvedSelection = useMemo<ResolvedSelection[]>(() => {
        const seen = new Set<string>();
        const resolved: ResolvedSelection[] = [];
        selectedElements.forEach((entry) => {
            const key = selectionKey(entry);
            if (seen.has(key)) return;
            seen.add(key);
            if (entry.type === "shape") {
                const shape = currentPageData.shapes.find((item) => item.id === entry.id);
                if (!shape) return;
                resolved.push({ ...entry, bounds: getShapeBounds(shape) });
                return;
            }
            const text = currentPageData.texts.find((item) => item.id === entry.id);
            if (!text) return;
            resolved.push({
                ...entry,
                bounds: getTextBounds(text, renderWidth, renderHeight),
            });
        });
        return resolved;
    }, [currentPageData.shapes, currentPageData.texts, renderHeight, renderWidth, selectedElements]);
    const selectionCount = resolvedSelection.length;

    const totalElementsOnCurrentPage =
        currentPageData.strokes.length +
        currentPageData.shapes.length +
        currentPageData.texts.length;

    const applySelectionOffsets = useCallback(
        (
            offsetByKey: Record<string, { dx: number; dy: number }>,
            options?: { successMessage?: string; announce?: boolean }
        ) => {
            const entries = Object.keys(offsetByKey);
            if (entries.length === 0) return;

            const pageKey = String(pageNumber);
            pushUndoSnapshot();
            setAnnotations((prev) => {
                const current = prev[pageKey];
                if (!current) return prev;
                const nextPage = deepClone(current);

                nextPage.shapes = nextPage.shapes.map((shape) => {
                    const offset = offsetByKey[`shape:${shape.id}`];
                    if (!offset) return shape;
                    const bounds = getShapeBounds(shape);
                    const dx = clamp(offset.dx, -bounds.minX, 1 - bounds.maxX);
                    const dy = clamp(offset.dy, -bounds.minY, 1 - bounds.maxY);
                    return {
                        ...shape,
                        x1: clamp(shape.x1 + dx, 0, 1),
                        y1: clamp(shape.y1 + dy, 0, 1),
                        x2: clamp(shape.x2 + dx, 0, 1),
                        y2: clamp(shape.y2 + dy, 0, 1),
                    };
                });

                nextPage.texts = nextPage.texts.map((text) => {
                    const offset = offsetByKey[`text:${text.id}`];
                    if (!offset) return text;
                    const bounds = getTextBounds(text, renderWidth, renderHeight);
                    const dx = clamp(offset.dx, -bounds.minX, 1 - bounds.maxX);
                    const dy = clamp(offset.dy, -bounds.minY, 1 - bounds.maxY);
                    return {
                        ...text,
                        x: clamp(text.x + dx, 0, 1),
                        y: clamp(text.y + dy, 0, 1),
                    };
                });

                return { ...prev, [pageKey]: nextPage };
            });
            if (options?.announce !== false && options?.successMessage) {
                toast.success(options.successMessage);
            }
        },
        [pageNumber, pushUndoSnapshot, renderHeight, renderWidth]
    );

    const buildSelectionClipboardPayload = useCallback((): SelectionClipboardPayload | null => {
        if (selectedElements.length === 0) return null;
        const shapeIds = new Set(
            selectedElements
                .filter((entry): entry is { type: "shape"; id: string } => entry.type === "shape")
                .map((entry) => entry.id)
        );
        const textIds = new Set(
            selectedElements
                .filter((entry): entry is { type: "text"; id: string } => entry.type === "text")
                .map((entry) => entry.id)
        );
        const shapes = currentPageData.shapes
            .filter((shape) => shapeIds.has(shape.id))
            .map((shape) => deepClone(shape));
        const texts = currentPageData.texts
            .filter((text) => textIds.has(text.id))
            .map((text) => deepClone(text));
        if (shapes.length === 0 && texts.length === 0) return null;
        return { shapes, texts };
    }, [currentPageData.shapes, currentPageData.texts, selectedElements]);

    const copySelectedEntries = useCallback(
        (announce = true) => {
            const payload = buildSelectionClipboardPayload();
            if (!payload) {
                if (announce) toast.error("No selected elements to copy");
                return false;
            }
            selectionClipboardRef.current = payload;
            pasteOffsetRef.current = 0;
            if (announce) {
                const total = payload.shapes.length + payload.texts.length;
                toast.success(`Copied ${total} selected item${total > 1 ? "s" : ""}`);
            }
            return true;
        },
        [buildSelectionClipboardPayload]
    );

    const pasteSelectionClipboard = useCallback(
        (announce = true) => {
            const payload = selectionClipboardRef.current;
            if (!payload || (payload.shapes.length === 0 && payload.texts.length === 0)) {
                if (announce) toast.error("Clipboard has no whiteboard selection");
                return false;
            }

            const pageKey = String(pageNumber);
            pasteOffsetRef.current += 1;
            const delta = Math.min(0.08, 0.016 * pasteOffsetRef.current);

            const pastedShapes = payload.shapes.map((shape) => ({
                ...deepClone(shape),
                id: createAnnotationId(),
                x1: clamp(shape.x1 + delta, 0, 1),
                y1: clamp(shape.y1 + delta, 0, 1),
                x2: clamp(shape.x2 + delta, 0, 1),
                y2: clamp(shape.y2 + delta, 0, 1),
            }));

            const pastedTexts = payload.texts.map((text) => ({
                ...deepClone(text),
                id: createAnnotationId(),
                x: clamp(text.x + delta, 0, 1),
                y: clamp(text.y + delta, 0, 1),
            }));

            pushUndoSnapshot();
            setAnnotations((prev) => {
                const current = prev[pageKey] ? deepClone(prev[pageKey]) : emptyPageAnnotation();
                current.shapes.push(...pastedShapes);
                current.texts.push(...pastedTexts);
                return { ...prev, [pageKey]: current };
            });

            const pastedSelection: SelectionEntry[] = [
                ...pastedShapes.map((shape) => ({ type: "shape", id: shape.id }) as SelectionEntry),
                ...pastedTexts.map((text) => ({ type: "text", id: text.id }) as SelectionEntry),
            ];
            setSelectionWithActive(pastedSelection, pastedSelection[0] || null);

            if (announce) {
                const total = pastedSelection.length;
                toast.success(`Pasted ${total} item${total > 1 ? "s" : ""}`);
            }
            return true;
        },
        [pageNumber, pushUndoSnapshot, setSelectionWithActive]
    );

    const duplicateSelectedEntries = useCallback(() => {
        const payload = buildSelectionClipboardPayload();
        if (!payload) {
            toast.error("No selected elements to duplicate");
            return false;
        }
        selectionClipboardRef.current = payload;
        const duplicated = pasteSelectionClipboard(false);
        if (!duplicated) return false;
        toast.success("Selection duplicated");
        return true;
    }, [buildSelectionClipboardPayload, pasteSelectionClipboard]);

    const cutSelectedEntries = useCallback(() => {
        const copied = copySelectedEntries(false);
        if (!copied) {
            toast.error("No selected elements to cut");
            return false;
        }
        const deleted = deleteSelectedEntries({ announce: false });
        if (!deleted) {
            toast.error("Selection could not be cut");
            return false;
        }
        toast.success("Selection cut to clipboard");
        return true;
    }, [copySelectedEntries, deleteSelectedEntries]);

    const nudgeSelectedEntries = useCallback(
        (dx: number, dy: number) => {
            if (selectionCount === 0) return false;
            const offsetByKey: Record<string, { dx: number; dy: number }> = {};
            selectedElements.forEach((entry) => {
                offsetByKey[selectionKey(entry)] = { dx, dy };
            });
            applySelectionOffsets(offsetByKey, { announce: false });
            return true;
        },
        [applySelectionOffsets, selectionCount, selectedElements]
    );

    useEffect(() => {
        const handleKeyDown = (event: KeyboardEvent) => {
            const target = event.target as HTMLElement | null;
            const isTypingTarget =
                target &&
                (target.tagName === "INPUT" ||
                    target.tagName === "TEXTAREA" ||
                    target.isContentEditable);

            const key = event.key.toLowerCase();
            const withCommand = event.metaKey || event.ctrlKey;

            if (withCommand && key === "s") {
                event.preventDefault();
                saveNow();
                return;
            }

            if (withCommand && key === "z") {
                event.preventDefault();
                if (event.shiftKey) {
                    redo();
                } else {
                    undo();
                }
                return;
            }

            if (!isImmersiveMode && withCommand && key === "0") {
                event.preventDefault();
                setZoomPercent(100);
                return;
            }

            if (!isImmersiveMode && withCommand && (key === "=" || key === "+")) {
                event.preventDefault();
                setZoomPercent((prev) => clamp(prev + 10, 50, 180));
                return;
            }

            if (!isImmersiveMode && withCommand && key === "-") {
                event.preventDefault();
                setZoomPercent((prev) => clamp(prev - 10, 50, 180));
                return;
            }

            if (isTypingTarget) return;

            if (withCommand && key === "c") {
                if (selectionCount > 0) {
                    event.preventDefault();
                    copySelectedEntries();
                }
                return;
            }

            if (withCommand && key === "x") {
                if (selectionCount > 0) {
                    event.preventDefault();
                    cutSelectedEntries();
                }
                return;
            }

            if (withCommand && key === "v") {
                event.preventDefault();
                pasteSelectionClipboard();
                return;
            }

            if (withCommand && key === "d") {
                if (selectionCount > 0) {
                    event.preventDefault();
                    duplicateSelectedEntries();
                }
                return;
            }

            if (event.key === "Escape") {
                setMarqueeRect(null);
                setSelectionWithActive([]);
                return;
            }

            if (event.key === "Delete" || event.key === "Backspace") {
                event.preventDefault();
                deleteSelectedEntries();
                return;
            }

            if (
                event.key === "ArrowLeft" ||
                event.key === "ArrowRight" ||
                event.key === "ArrowUp" ||
                event.key === "ArrowDown"
            ) {
                if (selectionCount === 0) return;
                event.preventDefault();
                const step = event.shiftKey ? 0.012 : event.altKey ? 0.02 : 0.004;
                if (event.key === "ArrowLeft") nudgeSelectedEntries(-step, 0);
                if (event.key === "ArrowRight") nudgeSelectedEntries(step, 0);
                if (event.key === "ArrowUp") nudgeSelectedEntries(0, -step);
                if (event.key === "ArrowDown") nudgeSelectedEntries(0, step);
                return;
            }

            if (key === "[") {
                event.preventDefault();
                setStrokeSize((prev) => clamp(prev - 1, 1, 24));
                return;
            }

            if (key === "]") {
                event.preventDefault();
                setStrokeSize((prev) => clamp(prev + 1, 1, 24));
                return;
            }

            const shortcutTool = TOOL_SHORTCUTS[key];
            if (shortcutTool) {
                event.preventDefault();
                setTool(shortcutTool);
            }
        };

        window.addEventListener("keydown", handleKeyDown);
        return () => window.removeEventListener("keydown", handleKeyDown);
    }, [
        copySelectedEntries,
        cutSelectedEntries,
        deleteSelectedEntries,
        duplicateSelectedEntries,
        nudgeSelectedEntries,
        pasteSelectionClipboard,
        redo,
        saveNow,
        selectionCount,
        setSelectionWithActive,
        isImmersiveMode,
        undo,
    ]);

    const alignSelected = useCallback(
        (mode: "left" | "center-x" | "right" | "top" | "center-y" | "bottom") => {
            if (selectionCount < 2) {
                toast.error("Select at least 2 elements to align");
                return;
            }

            const groupBounds = resolvedSelection.reduce(
                (acc, entry) => ({
                    minX: Math.min(acc.minX, entry.bounds.minX),
                    minY: Math.min(acc.minY, entry.bounds.minY),
                    maxX: Math.max(acc.maxX, entry.bounds.maxX),
                    maxY: Math.max(acc.maxY, entry.bounds.maxY),
                }),
                {
                    minX: Number.POSITIVE_INFINITY,
                    minY: Number.POSITIVE_INFINITY,
                    maxX: Number.NEGATIVE_INFINITY,
                    maxY: Number.NEGATIVE_INFINITY,
                }
            );
            const centerX = (groupBounds.minX + groupBounds.maxX) / 2;
            const centerY = (groupBounds.minY + groupBounds.maxY) / 2;

            const offsets: Record<string, { dx: number; dy: number }> = {};
            resolvedSelection.forEach((entry) => {
                const key = selectionKey(entry);
                const itemCenterX = (entry.bounds.minX + entry.bounds.maxX) / 2;
                const itemCenterY = (entry.bounds.minY + entry.bounds.maxY) / 2;
                let dx = 0;
                let dy = 0;

                if (mode === "left") dx = groupBounds.minX - entry.bounds.minX;
                if (mode === "center-x") dx = centerX - itemCenterX;
                if (mode === "right") dx = groupBounds.maxX - entry.bounds.maxX;
                if (mode === "top") dy = groupBounds.minY - entry.bounds.minY;
                if (mode === "center-y") dy = centerY - itemCenterY;
                if (mode === "bottom") dy = groupBounds.maxY - entry.bounds.maxY;
                offsets[key] = { dx, dy };
            });

            applySelectionOffsets(offsets, { successMessage: "Selection aligned" });
        },
        [applySelectionOffsets, resolvedSelection, selectionCount]
    );

    const distributeSelected = useCallback(
        (axis: "horizontal" | "vertical") => {
            if (selectionCount < 3) {
                toast.error("Select at least 3 elements to distribute");
                return;
            }

            const sorted = [...resolvedSelection].sort((a, b) => {
                const centerA =
                    axis === "horizontal"
                        ? (a.bounds.minX + a.bounds.maxX) / 2
                        : (a.bounds.minY + a.bounds.maxY) / 2;
                const centerB =
                    axis === "horizontal"
                        ? (b.bounds.minX + b.bounds.maxX) / 2
                        : (b.bounds.minY + b.bounds.maxY) / 2;
                return centerA - centerB;
            });

            const firstCenter =
                axis === "horizontal"
                    ? (sorted[0].bounds.minX + sorted[0].bounds.maxX) / 2
                    : (sorted[0].bounds.minY + sorted[0].bounds.maxY) / 2;
            const lastCenter =
                axis === "horizontal"
                    ? (sorted[sorted.length - 1].bounds.minX + sorted[sorted.length - 1].bounds.maxX) / 2
                    : (sorted[sorted.length - 1].bounds.minY + sorted[sorted.length - 1].bounds.maxY) / 2;
            const gap = (lastCenter - firstCenter) / (sorted.length - 1);

            const offsets: Record<string, { dx: number; dy: number }> = {};
            sorted.forEach((entry, index) => {
                if (index === 0 || index === sorted.length - 1) {
                    offsets[selectionKey(entry)] = { dx: 0, dy: 0 };
                    return;
                }

                const currentCenter =
                    axis === "horizontal"
                        ? (entry.bounds.minX + entry.bounds.maxX) / 2
                        : (entry.bounds.minY + entry.bounds.maxY) / 2;
                const targetCenter = firstCenter + gap * index;
                const delta = targetCenter - currentCenter;
                offsets[selectionKey(entry)] =
                    axis === "horizontal" ? { dx: delta, dy: 0 } : { dx: 0, dy: delta };
            });

            applySelectionOffsets(offsets, { successMessage: "Selection distributed" });
        },
        [applySelectionOffsets, resolvedSelection, selectionCount]
    );

    return (
        <div ref={workspaceRef} className="fixed inset-0 z-[82] bg-slate-950 text-slate-100 flex flex-col overflow-hidden">
            <input
                ref={importInputRef}
                type="file"
                accept=".json,application/json"
                className="hidden"
                onChange={handleImportFileChange}
            />
            <input
                ref={pdfInputRef}
                type="file"
                accept="application/pdf"
                className="hidden"
                onChange={handleImportPdfChange}
            />

            {!isImmersiveMode && (
                <header className={`border-b border-slate-800/80 bg-[radial-gradient(circle_at_top_left,rgba(37,99,235,0.16),transparent_28%),linear-gradient(180deg,rgba(2,6,23,0.96),rgba(15,23,42,0.94))] backdrop-blur px-4 flex gap-3 ${isMobileViewport ? "min-h-[4.8rem] flex-wrap items-start justify-between py-3" : "h-[4.5rem] items-center justify-between"}`}>
                    <div className="flex items-center gap-3 min-w-0">
                        <button
                            onClick={() => persistAndNavigate("/content-studio")}
                            className="btn btn-ghost text-xs"
                        >
                            <ArrowLeft className="h-4 w-4" />
                            Back
                        </button>
                        <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                                <p className="text-sm font-semibold truncate text-white">{pdfTitle}</p>
                                <span className="rounded-full border border-blue-500/30 bg-blue-500/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-blue-200">
                                    {documentId ? "Saved Doc" : "Ad-Hoc"}
                                </span>
                            </div>
                            <p className="text-[11px] text-slate-400 mt-1">
                                {numPages || 0} page(s) · autosave active{lastSavedAt ? ` · saved ${lastSavedAt}` : ""}
                            </p>
                        </div>
                    </div>

                    <div className="flex items-center gap-2">
                        <button onClick={() => saveNow()} className="btn btn-secondary text-xs">
                            <Save className="h-4 w-4" />
                            Save
                        </button>
                        <button onClick={toggleFullscreen} className="btn btn-secondary text-xs">
                            {isFullscreen ? (
                                <Minimize2 className="h-4 w-4" />
                            ) : (
                                <Maximize2 className="h-4 w-4" />
                            )}
                            {isFullscreen ? "Exit Fullscreen" : "Fullscreen"}
                        </button>
                    </div>
                </header>
            )}

            <div className="relative flex flex-1 min-h-0 overflow-hidden">

                <section className="flex-1 min-w-0 flex flex-col overflow-hidden">

                    <div
                        ref={stageHostRef}
                        className={`flex-1 min-h-0 ${isImmersiveMode
                            ? "overflow-hidden p-0"
                            : "overflow-auto p-4 md:p-6 pb-28"
                            }`}
                        style={{
                            background: customBgColor
                                ? customBgColor
                                : getThemeGradient(resolvePdfTemplate(canvasTheme)),
                            touchAction: "none",
                            ...(isImmersiveMode
                                ? {
                                    paddingBottom: showDock
                                        ? `${Math.max(64, dockHeight + 16)}px`
                                        : "6px",
                                }
                                : {})
                        }}
                    >
                        <div
                            ref={stageFrameRef}
                            className={`relative mx-auto overflow-visible shadow-none border-0`}
                            style={{
                                width: renderWidth,
                                height: renderHeight,
                                background: "transparent",
                                transform: `translate3d(${viewportTransform.x}px, ${viewportTransform.y}px, 0) scale(${viewportTransform.scale})`,
                                transformOrigin: "center center",
                                willChange: "transform",
                            }}
                        >
                            {isLoadingPdf ? (
                                <div className="h-full w-full flex items-center justify-center bg-slate-100 text-slate-500 text-sm">
                                    Loading PDF whiteboard...
                                </div>
                            ) : loadError ? (
                                <div className="h-full w-full flex flex-col items-center justify-center gap-3 bg-slate-100 text-slate-700 px-6 text-center">
                                    <p className="font-semibold">Failed to load PDF</p>
                                    <p className="text-xs text-slate-500">{loadError}</p>
                                </div>
                            ) : pdfData && pdfPageMapping[pageNumber] !== null ? (
                                <canvas
                                    ref={pdfCanvasRef}
                                    className="absolute inset-0"
                                    style={{ opacity: showPdfLayer && !hiddenPdfPages.includes(pageNumber) ? 1 : 0 }}
                                />
                            ) : null}

                            <canvas
                                ref={canvasRef}
                                className="absolute pointer-events-auto"
                                style={{
                                    width: renderWidth + 1500 * 2,
                                    height: renderHeight + 1500 * 2,
                                    left: -1500,
                                    top: -1500,
                                    cursor:
                                        tool === "text"
                                            ? "text"
                                            : tool === "select"
                                                ? isImmersiveMode
                                                    ? "grab"
                                                    : "default"
                                                : "crosshair",
                                    touchAction: "none",
                                }}
                                onPointerDown={handlePointerDown}
                                onPointerMove={handlePointerMove}
                                onPointerUp={finishPointerInteraction}
                                onPointerCancel={finishPointerInteraction}
                                onPointerLeave={finishPointerInteraction}
                            />

                            <canvas
                                ref={liveCanvasRef}
                                className="absolute pointer-events-none"
                                width={(renderWidth + 1500 * 2) * Math.min(typeof window === "undefined" ? 1 : window.devicePixelRatio || 1, Math.sqrt(25000000 / ((renderWidth + 1500 * 2) * (renderHeight + 1500 * 2))))}
                                height={(renderHeight + 1500 * 2) * Math.min(typeof window === "undefined" ? 1 : window.devicePixelRatio || 1, Math.sqrt(25000000 / ((renderWidth + 1500 * 2) * (renderHeight + 1500 * 2))))}
                                style={{
                                    width: renderWidth + 1500 * 2,
                                    height: renderHeight + 1500 * 2,
                                    left: -1500,
                                    top: -1500,
                                    touchAction: "none",
                                }}
                            />

                            {textComposer.isOpen && (
                                <textarea
                                    autoFocus
                                    value={textComposer.value}
                                    onChange={(event) =>
                                        setTextComposer((prev) => ({
                                            ...prev,
                                            value: event.target.value,
                                        }))
                                    }
                                    onBlur={() => {
                                        if (textComposer.value.trim() !== "") {
                                            commitText();
                                        } else {
                                            setTextComposer((prev) => ({ ...prev, isOpen: false, value: "" }));
                                        }
                                    }}
                                    onKeyDown={(e) => {
                                        if (e.key === "Escape") {
                                            setTextComposer((prev) => ({ ...prev, isOpen: false, value: "" }));
                                        } else if (e.key === "Enter" && !e.shiftKey) {
                                            e.preventDefault();
                                            if (textComposer.value.trim() !== "") {
                                                commitText();
                                            } else {
                                                setTextComposer((prev) => ({ ...prev, isOpen: false, value: "" }));
                                            }
                                        }
                                    }}
                                    className="absolute z-50 bg-transparent border-2 border-blue-500/50 border-dashed outline-none resize-none m-0 p-1 font-sans shadow-2xl pointer-events-auto"
                                    style={{
                                        left: `${textComposer.x * 100}%`,
                                        top: `${textComposer.y * 100}%`,
                                        color: inkColor,
                                        fontSize: `${Math.max(14, fontSize * (zoomPercent / 100))}px`,
                                        minWidth: '200px',
                                        minHeight: '2em',
                                        lineHeight: 1.2
                                    }}
                                    placeholder="Type..."
                                />
                            )}

                            {isRenderingPage && (
                                <div className="absolute top-3 right-3 rounded-xl border border-blue-500/50 bg-blue-900/40 backdrop-blur text-blue-300 px-2 py-1 text-[11px] font-semibold">
                                    Rendering page...
                                </div>
                            )}
                        </div>
                    </div>
                </section>

            </div>

            {/* Right-Side Pages Panel */}
            {
                showPagesPanel && (
                    <div className={`absolute z-40 bg-slate-900 border border-slate-700 shadow-2xl rounded-2xl flex flex-col overflow-hidden ${isMobileViewport ? "left-2 right-2 top-20 bottom-24" : "right-4 top-24 bottom-24 w-64"}`}>
                        <div className="flex items-center justify-between p-3 border-b border-slate-700">
                            <span className="text-white text-sm font-semibold flex items-center gap-2">
                                <FileText className="w-4 h-4" /> Pages
                            </span>
                            <button onClick={() => setShowPagesPanel(false)} className="text-slate-400 hover:text-white p-1">
                                <X className="h-4 w-4" />
                            </button>
                        </div>
                        <div className="flex-1 overflow-y-auto p-3 flex flex-col gap-3">
                            {Array.from({ length: totalPagesCount }).map((_, i) => {
                                const pNum = i + 1;
                                const isHidden = hiddenPdfPages.includes(pNum);
                                const previewUrl = thumbnailMap[pNum];
                                return (
                                    <div
                                        key={`page-nav-${pNum}`}
                                        className={`group flex flex-col p-2 rounded-xl border transition-all ${pageNumber === pNum ? 'bg-blue-600/10 border-blue-500/50' : 'bg-slate-800/50 border-transparent hover:border-slate-600'} ${isHidden ? 'opacity-50' : 'opacity-100'}`}
                                    >
                                        <div
                                            className={`relative w-full aspect-video bg-slate-950 rounded-lg mb-2 overflow-hidden flex items-center justify-center ${isHidden ? 'cursor-not-allowed' : 'cursor-pointer'}`}
                                            onClick={() => { if (!isHidden) changePage(pNum); }}
                                        >
                                            {previewUrl ? (
                                                <img src={previewUrl} alt={`Slide ${pNum}`} className="w-full h-full object-contain" />
                                            ) : (
                                                <span className="text-xs text-slate-500 font-medium tracking-wide">Blank Slide</span>
                                            )}
                                        </div>
                                        <div className="flex items-center justify-between px-1">
                                            <span
                                                className={`text-xs cursor-pointer ${pageNumber === pNum ? 'text-blue-400 font-semibold' : 'text-slate-300 hover:text-white'}`}
                                                onClick={() => changePage(pNum)}
                                            >
                                                Slide {pNum}
                                            </span>
                                            <button
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    setHiddenPdfPages(prev => {
                                                        const nextHidden = isHidden ? prev.filter(p => p !== pNum) : [...prev, pNum];

                                                        if (!isHidden && pageNumber === pNum) {
                                                            // Auto-navigate away if the current slide was just hidden
                                                            let nextVisible = pNum + 1;
                                                            while (nextVisible <= totalPagesCount && nextHidden.includes(nextVisible)) nextVisible++;

                                                            if (nextVisible <= totalPagesCount) {
                                                                setTimeout(() => changePage(nextVisible, 'next'), 0);
                                                            } else {
                                                                let prevVisible = pNum - 1;
                                                                while (prevVisible >= 1 && nextHidden.includes(prevVisible)) prevVisible--;
                                                                if (prevVisible >= 1) {
                                                                    setTimeout(() => changePage(prevVisible, 'prev'), 0);
                                                                }
                                                            }
                                                        }

                                                        return nextHidden;
                                                    });
                                                }}
                                                className={`p-1 hover:bg-slate-700 rounded transition-colors ${isHidden ? 'text-slate-500' : 'text-slate-400 hover:text-white'}`}
                                                title={isHidden ? "Show Background" : "Hide Background"}
                                            >
                                                {isHidden ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                                            </button>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                )
            }

            {/* Bottom-Left Menu Panel */}
            {
                showMenuPanel && (
                    <div className={`absolute z-40 border border-slate-700/80 bg-slate-900/95 shadow-2xl rounded-[24px] flex flex-col overflow-hidden backdrop-blur-xl ${isMobileViewport ? "left-2 right-2 bottom-24 max-h-[72vh]" : "left-4 bottom-24 w-[320px] max-h-[70vh]"}`}>
                        <div className="flex items-center justify-between p-3 border-b border-slate-700">
                            <span className="text-white text-sm font-semibold flex items-center gap-2">
                                <Menu className="w-4 h-4" /> Workspace Panel
                            </span>
                            <button onClick={() => setShowMenuPanel(false)} className="text-slate-400 hover:text-white p-1">
                                <X className="h-4 w-4" />
                            </button>
                        </div>
                        <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-5">
                            <div className="rounded-2xl border border-slate-700 bg-slate-900/60 p-3">
                                <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Board Status</p>
                                <div className="mt-3 flex items-start justify-between gap-3">
                                    <div>
                                        <p className="text-sm font-semibold text-white truncate">{pdfTitle || "Blank Canvas Board"}</p>
                                        <p className="text-xs text-slate-400 mt-1">
                                            {documentId ? "Linked to your saved document workspace" : "Working on an ad-hoc board"}
                                        </p>
                                    </div>
                                    <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-emerald-300">
                                        Autosave On
                                    </span>
                                </div>
                                <div className="mt-3 flex items-center justify-between text-xs text-slate-400">
                                    <span>Last saved</span>
                                    <span className="font-semibold text-slate-200">{lastSavedAt || "Just started"}</span>
                                </div>
                            </div>

                            <div className="flex flex-col gap-2">
                                <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Board Files</p>
                                <button
                                    onClick={() => { setImportMode("replace"); importInputRef.current?.click(); setShowMenuPanel(false); }}
                                    className="btn p-2.5 rounded-xl bg-blue-600/15 hover:bg-blue-600/25 text-blue-300 border border-blue-500/25 flex items-center justify-center gap-2 transition-colors"
                                >
                                    <FileText className="h-4 w-4" />
                                    Load Board (.json)
                                </button>
                                <button
                                    onClick={() => { setImportMode("merge"); importInputRef.current?.click(); setShowMenuPanel(false); }}
                                    className="btn p-2.5 rounded-xl bg-teal-600/15 hover:bg-teal-600/25 text-teal-300 border border-teal-500/25 flex items-center justify-center gap-2 transition-colors"
                                >
                                    <Plus className="h-4 w-4" />
                                    Append Board (.json)
                                </button>
                                <button
                                    onClick={() => { pdfInputRef.current?.click(); setShowMenuPanel(false); }}
                                    className="btn p-2.5 rounded-xl bg-purple-600/15 hover:bg-purple-600/25 text-purple-300 border border-purple-500/25 flex items-center justify-center gap-2 transition-colors"
                                >
                                    <Upload className="h-4 w-4" />
                                    Open External PDF
                                </button>
                                <button
                                    onClick={() => { saveNow(); setShowMenuPanel(false); }}
                                    className="btn p-2.5 rounded-xl bg-emerald-600/15 hover:bg-emerald-600/25 text-emerald-300 border border-emerald-500/25 flex items-center justify-center gap-2 transition-colors"
                                >
                                    <Save className="h-4 w-4" />
                                    Save Board Now
                                </button>
                            </div>

                            <div className="flex flex-col gap-2">
                                <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Canvas Theme</p>
                                <div className="grid grid-cols-2 gap-2">
                                    {PDF_TEMPLATE_IDS.map(t => (
                                        <button
                                            key={t}
                                            onClick={() => setCanvasTheme(t)}
                                            className={`px-2 py-2 flex items-center justify-center rounded border text-[10px] uppercase font-semibold tracking-wide transition-colors ${canvasTheme === t ? "border-blue-500 bg-blue-600/20 text-blue-400" : "border-slate-700 bg-slate-800 hover:bg-slate-700 text-slate-300"}`}
                                        >
                                            {t}
                                        </button>
                                    ))}
                                </div>
                            </div>

                            <div className="flex flex-col gap-2">
                                <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Custom Background</p>
                                <div className="flex flex-wrap gap-2 items-center">
                                    {COLOR_SWATCHES.slice(0, 8).map((color) => (
                                        <button
                                            key={`menu-bg-${color}`}
                                            type="button"
                                            onClick={() => setCustomBgColor(color)}
                                            className={`h-7 w-7 rounded border ${customBgColor === color ? "border-white ring-2 ring-blue-500" : "border-slate-600 shadow-inner"}`}
                                            style={{ backgroundColor: color }}
                                            title={color}
                                        />
                                    ))}
                                    <button onClick={() => setCustomBgColor(null)} className="h-7 px-3 flex items-center justify-center rounded border border-slate-600 bg-slate-800 hover:bg-slate-700 text-slate-300 text-[10px] font-medium transition-colors">
                                        None
                                    </button>
                                </div>
                            </div>

                            <div className="flex flex-col gap-2 border-t border-slate-800 pt-3">
                                <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500 flex items-center gap-1.5 mb-1">
                                    <FileText className="h-3 w-3" />
                                    My Documents
                                </p>
                                {isLoadingRecent ? (
                                    <div className="text-xs text-slate-400 italic px-1">Loading your documents...</div>
                                ) : recentDocs.length === 0 ? (
                                    <div className="rounded-xl border border-slate-800 bg-slate-900/60 px-3 py-3 text-xs text-slate-500">
                                        No saved workspace documents available yet. You can still open an external PDF from your device.
                                    </div>
                                ) : (
                                    <div className="flex flex-col gap-1 max-h-48 overflow-y-auto pr-1 custom-scrollbar">
                                        {recentDocs.map(doc => (
                                            <button
                                                key={doc.id}
                                                onClick={() => {
                                                    if (doc.id === documentId) {
                                                        setShowMenuPanel(false);
                                                        return;
                                                    }
                                                    setShowMenuPanel(false);
                                                    persistAndNavigate(`/whiteboard?documentId=${doc.id}&title=${encodeURIComponent(doc.title)}`);
                                                }}
                                                className={`flex flex-col p-3 rounded-xl border transition-all text-left ${doc.id === documentId ? 'bg-blue-600/10 border-blue-500/30' : 'bg-slate-800/40 hover:bg-slate-800 border-transparent hover:border-slate-700'}`}
                                            >
                                                <span className={`text-xs font-semibold truncate ${doc.id === documentId ? 'text-blue-400' : 'text-slate-200'}`}>
                                                    {doc.title}
                                                </span>
                                                <span className="text-[10px] text-slate-500 truncate flex justify-between gap-2">
                                                    <span>{new Date(doc.createdAt).toLocaleDateString()}</span>
                                                    {doc.subject && <span className="truncate">{doc.subject}</span>}
                                                    {doc.id === documentId && <span>(Current)</span>}
                                                </span>
                                            </button>
                                        ))}
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                )
            }

            {/* Unified Bottom Dock */}
            <div className={`fixed bottom-3 left-1/2 -translate-x-1/2 z-40 pointer-events-none transition-all duration-500 ease-[cubic-bezier(0.34,1.56,0.64,1)] ${!showDock ? "translate-y-32 opacity-0" : "translate-y-0 opacity-100"} ${isMobileViewport ? "bottom-2" : ""}`}>
                {showDock && (
                    <div
                        ref={dockRef}
                        className={`relative w-fit max-w-[calc(100vw-1rem)] pointer-events-auto ${!showDock ? 'opacity-0' : 'opacity-100'}`}
                    >
                        <div className="flex flex-col gap-2 relative">
                                {/* Popups Area - Centered above dock */}
                                {(activePopup === "pen" || activePopup === "highlighter" || activePopup === "eraser" || activePopup === "text" || activePopup === "shapes" || activePopup === "settings" || activePopup === "clean" || activePopup === "addSlide") && (
                                    <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-3 bg-slate-800 border border-slate-700 rounded-xl p-2 shadow-xl flex gap-3 z-50">

                                        {/* Pen Popup */}
                                        {activePopup === "pen" && (
                                            <div className="flex gap-4 p-2">
                                                <div className="flex flex-col gap-2 justify-center px-2">
                                                    <span className="text-xs uppercase text-slate-400 font-bold tracking-wider">Pen Size</span>
                                                    <div className="flex gap-2">
                                                        {STROKE_SIZE_PRESETS.map((size) => (
                                                            <button
                                                                key={size}
                                                                onClick={() => setStrokeSize(size)}
                                                                className={`w-10 h-10 flex justify-center items-center rounded-lg border transition-all ${strokeSize === size ? "border-blue-500 bg-slate-700 shadow-inner" : "border-slate-600 bg-slate-800 hover:bg-slate-700"}`}
                                                                title={`Size ${size}`}
                                                            >
                                                                <div className="bg-white rounded-full" style={{ width: Math.min(24, size * 1.5), height: Math.min(24, size * 1.5) }} />
                                                            </button>
                                                        ))}
                                                    </div>
                                                </div>
                                                <div className="w-px bg-slate-700" />
                                                <div className="flex flex-col gap-2 justify-center px-2">
                                                    <span className="text-xs uppercase text-slate-400 font-bold tracking-wider">Color</span>
                                                    <div className="flex items-center gap-2">
                                                        {COLOR_SWATCHES.slice(0, 8).map((color) => (
                                                            <button
                                                                key={color}
                                                                type="button"
                                                                onClick={() => { setInkColor(color); setActivePopup(null); }}
                                                                className={`h-10 w-10 rounded-lg border transition-all ${inkColor === color ? "border-white ring-2 ring-blue-500 shadow-md scale-110" : "border-slate-600 hover:scale-105"}`}
                                                                style={{ backgroundColor: color }}
                                                                title={color}
                                                            />
                                                        ))}
                                                    </div>
                                                </div>
                                            </div>
                                        )}

                                        {/* Highlighter Popup */}
                                        {activePopup === "highlighter" && (
                                            <div className="flex gap-4 p-2">
                                                <div className="flex flex-col gap-2 justify-center px-2">
                                                    <span className="text-xs uppercase text-slate-400 font-bold tracking-wider">Highlighter Size</span>
                                                    <div className="flex gap-2">
                                                        {STROKE_SIZE_PRESETS.map((size) => (
                                                            <button
                                                                key={`hl-${size}`}
                                                                onClick={() => setStrokeSize(size)}
                                                                className={`w-10 h-10 flex justify-center items-center rounded-lg border transition-all ${strokeSize === size ? "border-blue-500 bg-slate-700 shadow-inner" : "border-slate-600 bg-slate-800 hover:bg-slate-700"}`}
                                                            >
                                                                <div className="bg-white rounded-full" style={{ width: Math.min(24, size * 1.5), height: Math.min(24, size * 1.5) }} />
                                                            </button>
                                                        ))}
                                                    </div>
                                                </div>
                                                <div className="w-px bg-slate-700" />
                                                <div className="flex flex-col gap-2 justify-center px-2">
                                                    <span className="text-xs uppercase text-slate-400 font-bold tracking-wider">Color</span>
                                                    <div className="flex items-center gap-2">
                                                        {COLOR_SWATCHES.slice(0, 8).map((color) => (
                                                            <button
                                                                key={`hlc-${color}`}
                                                                type="button"
                                                                onClick={() => { setInkColor(color); setActivePopup(null); }}
                                                                className={`h-10 w-10 rounded-lg border transition-all ${inkColor === color ? "border-white ring-2 ring-blue-500 shadow-md scale-110" : "border-slate-600 hover:scale-105"}`}
                                                                style={{ backgroundColor: color }}
                                                            />
                                                        ))}
                                                    </div>
                                                </div>
                                            </div>
                                        )}

                                        {/* Eraser Popup */}
                                        {activePopup === "eraser" && (
                                            <div className="flex gap-4 p-2">
                                                <div className="flex flex-col gap-2 justify-center px-2">
                                                    <span className="text-xs uppercase text-slate-400 font-bold tracking-wider">Eraser Size</span>
                                                    <div className="flex gap-2">
                                                        {ERASER_SIZE_PRESETS.map((size) => (
                                                            <button
                                                                key={`er-${size}`}
                                                                onClick={() => setEraserSize(size)}
                                                                className={`w-12 h-12 flex justify-center items-center rounded-lg border transition-all ${eraserSize === size ? "border-blue-500 bg-slate-700 shadow-inner" : "border-slate-600 bg-slate-800 hover:bg-slate-700"}`}
                                                            >
                                                                <div className="bg-white rounded-full" style={{ width: Math.min(32, size / 2.5), height: Math.min(32, size / 2.5) }} />
                                                            </button>
                                                        ))}
                                                    </div>
                                                </div>
                                            </div>
                                        )}

                                        {/* Text Popup */}
                                        {activePopup === "text" && (
                                            <div className="flex gap-4 p-2">
                                                <div className="flex flex-col gap-2 justify-center px-2">
                                                    <span className="text-xs uppercase text-slate-400 font-bold tracking-wider">Handwriting</span>
                                                    <select
                                                        value={fontFamily}
                                                        onChange={(e) => setFontFamily(e.target.value)}
                                                        className="bg-slate-700 text-white text-sm p-2 rounded-lg border border-slate-600 outline-none focus:border-blue-500 flex-1 min-w-[140px]"
                                                    >
                                                        {FONT_CHOICES.map((font) => (
                                                            <option key={font.label} value={font.value}>{font.label}</option>
                                                        ))}
                                                    </select>
                                                </div>
                                                <div className="w-px bg-slate-700" />
                                                <div className="flex flex-col gap-2 justify-center px-2">
                                                    <span className="text-xs uppercase text-slate-400 font-bold tracking-wider">Font Size</span>
                                                    <div className="flex gap-2">
                                                        {FONT_SIZE_PRESETS.map((size) => (
                                                            <button
                                                                key={`tx-sz-${size}`}
                                                                onClick={() => setFontSize(size)}
                                                                className={`w-10 h-10 flex justify-center items-center rounded-lg border text-sm font-bold transition-all ${fontSize === size ? "border-blue-500 bg-slate-700 text-white shadow-inner" : "border-slate-600 bg-slate-800 hover:bg-slate-700 text-slate-300"}`}
                                                                title={`Size ${size}`}
                                                            >
                                                                {size}
                                                            </button>
                                                        ))}
                                                    </div>
                                                </div>
                                                <div className="w-px bg-slate-700" />
                                                <div className="flex flex-col gap-2 justify-center px-2">
                                                    <span className="text-xs uppercase text-slate-400 font-bold tracking-wider">Color</span>
                                                    <div className="flex items-center gap-2">
                                                        {COLOR_SWATCHES.slice(0, 8).map((color) => (
                                                            <button
                                                                key={`txc-${color}`}
                                                                type="button"
                                                                onClick={() => { setInkColor(color); setActivePopup(null); }}
                                                                className={`h-10 w-10 rounded-lg border transition-all ${inkColor === color ? "border-white ring-2 ring-blue-500 shadow-md scale-110" : "border-slate-600 hover:scale-105"}`}
                                                                style={{ backgroundColor: color }}
                                                                title={color}
                                                            />
                                                        ))}
                                                    </div>
                                                </div>
                                            </div>
                                        )}

                                        {/* Shapes Popup */}
                                        {activePopup === "shapes" && (
                                            <div className="flex gap-4 p-2">
                                                <div className="flex flex-col gap-2 justify-center px-2">
                                                    <span className="text-xs uppercase text-slate-400 font-bold tracking-wider">Shape Type</span>
                                                    <div className="flex gap-2">
                                                        {TOOL_ITEMS.filter(item => ["line", "arrow", "rectangle", "ellipse", "triangle", "diamond"].includes(item.id)).map((item) => (
                                                            <button
                                                                key={item.id}
                                                                onClick={() => setTool(item.id)}
                                                                className={`btn p-2 min-w-[48px] min-h-[48px] text-sm rounded-lg border transition-all ${tool === item.id ? "border-blue-500 bg-slate-700 shadow-inner text-blue-400" : "border-transparent bg-transparent hover:bg-slate-700 text-slate-300"}`}
                                                                title={item.label}
                                                            >
                                                                {item.icon}
                                                            </button>
                                                        ))}
                                                    </div>
                                                </div>
                                                <div className="w-px bg-slate-700" />
                                                <div className="flex flex-col gap-2 justify-center px-2">
                                                    <span className="text-xs uppercase text-slate-400 font-bold tracking-wider">Stroke Size</span>
                                                    <div className="flex gap-2">
                                                        {STROKE_SIZE_PRESETS.map((size) => (
                                                            <button
                                                                key={`shp-sz-${size}`}
                                                                onClick={() => setStrokeSize(size)}
                                                                className={`w-10 h-10 flex justify-center items-center rounded-lg border transition-all ${strokeSize === size ? "border-blue-500 bg-slate-700 shadow-inner" : "border-slate-600 bg-slate-800 hover:bg-slate-700"}`}
                                                            >
                                                                <div className="bg-white rounded-full" style={{ width: Math.min(24, size * 1.5), height: Math.min(24, size * 1.5) }} />
                                                            </button>
                                                        ))}
                                                    </div>
                                                </div>
                                                <div className="w-px bg-slate-700" />
                                                <div className="flex flex-col gap-2 justify-center px-2">
                                                    <span className="text-xs uppercase text-slate-400 font-bold tracking-wider">Stroke Color</span>
                                                    <div className="flex items-center gap-2">
                                                        {COLOR_SWATCHES.slice(0, 6).map((color) => (
                                                            <button
                                                                key={`shc-${color}`}
                                                                type="button"
                                                                onClick={() => { setInkColor(color); setActivePopup(null); }}
                                                                className={`h-10 w-10 rounded-lg border transition-all ${inkColor === color ? "border-white ring-2 ring-blue-500 shadow-md scale-110" : "border-slate-600 hover:scale-105"}`}
                                                                style={{ backgroundColor: color }}
                                                            />
                                                        ))}
                                                    </div>
                                                </div>
                                            </div>
                                        )}

                                        {/* Clean Popup */}
                                        {activePopup === "clean" && (
                                            <div className="flex gap-4 p-2">
                                                <div className="flex flex-col gap-2 justify-center px-2">
                                                    <span className="text-xs uppercase text-slate-400 font-bold tracking-wider">Clear Canvas</span>
                                                    <div className="flex gap-3">
                                                        <button onClick={() => { clearCurrentPageAnnotations(); setActivePopup(null); }} className="btn btn-ghost flex items-center gap-2 p-2 px-4 min-h-[48px] rounded-lg text-sm hover:bg-red-900/40 border border-slate-700 hover:border-red-500/50 text-slate-300 hover:text-red-300 transition-colors">
                                                            <Trash2 className="h-5 w-5" />
                                                            <span>Clear This Page</span>
                                                        </button>
                                                        <button onClick={() => { clearAllPagesAnnotations(); setActivePopup(null); }} className="btn btn-ghost flex items-center gap-2 p-2 px-4 min-h-[48px] rounded-lg text-sm hover:bg-red-900/40 border border-slate-700 hover:border-red-500/50 text-slate-300 hover:text-red-300 transition-colors">
                                                            <Layers className="h-5 w-5" />
                                                            <span>Clear All Pages</span>
                                                        </button>
                                                    </div>
                                                </div>
                                            </div>
                                        )}

                                        {/* Add Slide Popup */}
                                        {activePopup === "addSlide" && (
                                            <div className="flex gap-4 p-2">
                                                <div className="flex flex-col gap-2 justify-center px-2">
                                                    <span className="text-xs uppercase text-slate-400 font-bold tracking-wider">Insert Slide</span>
                                                    <div className="flex gap-3">
                                                        <button onClick={() => insertBlankSlide('prev')} className="btn btn-ghost flex items-center gap-2 p-2 px-4 min-h-[48px] rounded-lg text-sm hover:bg-green-900/40 border border-slate-700 hover:border-green-500/50 text-slate-300 hover:text-green-400 transition-colors">
                                                            <ChevronLeft className="h-5 w-5" />
                                                            <span>Previous</span>
                                                        </button>
                                                        <button onClick={() => insertBlankSlide('next')} className="btn btn-ghost flex items-center gap-2 p-2 px-4 min-h-[48px] rounded-lg text-sm hover:bg-green-900/40 border border-slate-700 hover:border-green-500/50 text-slate-300 hover:text-green-400 transition-colors">
                                                            <ChevronRight className="h-5 w-5" />
                                                            <span>Next</span>
                                                        </button>
                                                        <button onClick={() => insertBlankSlide('last')} className="btn btn-ghost flex items-center gap-2 p-2 px-4 min-h-[48px] rounded-lg text-sm hover:bg-green-900/40 border border-slate-700 hover:border-green-500/50 text-slate-300 hover:text-green-400 transition-colors">
                                                            <MoveRight className="h-5 w-5" />
                                                            <span>At Last</span>
                                                        </button>
                                                    </div>
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                )}



                                {/* Unified Dock Row */}
                                <div className="bg-slate-900/95 backdrop-blur-xl border border-slate-700/80 shadow-2xl rounded-[24px] p-2 flex items-center gap-1.5 w-max max-w-[calc(100vw-1rem)] overflow-x-auto mx-auto whitespace-nowrap">
                                    <button
                                        onClick={() => setShowMenuPanel(prev => !prev)}
                                        className={`btn relative h-12 w-12 rounded-2xl flex items-center justify-center transition-colors ${showMenuPanel ? "bg-blue-600 text-white shadow-lg" : "text-white hover:bg-slate-800"}`}
                                        title="Workspace Panel"
                                    >
                                        <Menu className="h-5 w-5" />
                                        <span className="absolute bottom-1 right-1 text-[10px] text-slate-300">{showMenuPanel ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}</span>
                                    </button>

                                    <div className="w-px h-8 bg-slate-700 mx-1" />

                                    <button onClick={() => { setTool("select"); setActivePopup(null); }} className={`btn h-12 w-12 rounded-2xl flex items-center justify-center transition-colors ${tool === "select" ? "bg-blue-600 text-white shadow-lg" : "hover:bg-slate-800 text-white"}`} title="Select">
                                        <MousePointer2 className="h-5 w-5" />
                                    </button>
                                    <button onClick={() => { if (!["pen", "highlighter"].includes(tool)) setTool("pen"); setActivePopup(activePopup === "pen" || activePopup === "highlighter" ? null : "pen"); }} className={`btn relative h-12 w-12 rounded-2xl flex items-center justify-center transition-colors ${["pen", "highlighter"].includes(tool) ? "bg-blue-600 text-white shadow-lg" : "hover:bg-slate-800 text-white"}`} title="Draw Tools">
                                        <PenTool className="h-5 w-5" />
                                        <span className="absolute bottom-1 right-1 text-[10px] text-slate-300">{activePopup === "pen" || activePopup === "highlighter" ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}</span>
                                    </button>
                                    <button onClick={() => { setTool("text"); setActivePopup(activePopup === "text" ? null : "text"); }} className={`btn relative h-12 w-12 rounded-2xl flex items-center justify-center transition-colors ${tool === "text" ? "bg-blue-600 text-white shadow-lg" : "hover:bg-slate-800 text-white"}`} title="Text Tools">
                                        <Type className="h-5 w-5" />
                                        <span className="absolute bottom-1 right-1 text-[10px] text-slate-300">{activePopup === "text" ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}</span>
                                    </button>
                                    <button onClick={() => { if (!["rectangle", "ellipse", "triangle", "diamond", "line", "arrow"].includes(tool)) setTool("rectangle"); setActivePopup(activePopup === "shapes" ? null : "shapes"); }} className={`btn relative h-12 w-12 rounded-2xl flex items-center justify-center transition-colors ${["rectangle", "ellipse", "triangle", "diamond", "line", "arrow"].includes(tool) ? "bg-blue-600 text-white shadow-lg" : "hover:bg-slate-800 text-white"}`} title="Shapes">
                                        <Square className="h-5 w-5" />
                                        <span className="absolute bottom-1 right-1 text-[10px] text-slate-300">{activePopup === "shapes" ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}</span>
                                    </button>
                                    <button onClick={() => { setTool("eraser"); setActivePopup(activePopup === "eraser" ? null : "eraser"); }} className={`btn relative h-12 w-12 rounded-2xl flex items-center justify-center transition-colors ${tool === "eraser" ? "bg-blue-600 text-white shadow-lg" : "hover:bg-slate-800 text-white"}`} title="Eraser">
                                        <Eraser className="h-5 w-5" />
                                        <span className="absolute bottom-1 right-1 text-[10px] text-slate-300">{activePopup === "eraser" ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}</span>
                                    </button>

                                    <div className="w-px h-8 bg-slate-700 mx-1" />

                                    {(() => {
                                        const page = annotations[pageNumber];
                                        const hasItems = Boolean(page && (page.strokes.length || page.texts.length || page.shapes.length));
                                        const canClean = hasItems || numPages >= 2;
                                        return (
                                            <button
                                                onClick={() => canClean && setActivePopup(activePopup === "clean" ? null : "clean")}
                                                disabled={!canClean}
                                                className={`btn relative h-12 w-12 rounded-2xl flex items-center justify-center transition-colors ${!canClean ? "opacity-30 cursor-not-allowed text-slate-500" : activePopup === "clean" ? "bg-blue-600 text-white shadow-lg" : "hover:bg-slate-800 text-white"}`}
                                                title="Clean Tools"
                                            >
                                                <Trash2 className="h-5 w-5" />
                                                <span className="absolute bottom-1 right-1 text-[10px] text-slate-300">{activePopup === "clean" ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}</span>
                                            </button>
                                        );
                                    })()}
                                    <button onClick={() => setActivePopup(activePopup === "addSlide" ? null : "addSlide")} className={`btn relative h-12 w-12 rounded-2xl flex items-center justify-center transition-colors ${activePopup === "addSlide" ? "bg-blue-600 text-white shadow-lg" : "hover:bg-slate-800 text-white"}`} title="Slide Tools">
                                        <Plus className="h-5 w-5" />
                                        <span className="absolute bottom-1 right-1 text-[10px] text-slate-300">{activePopup === "addSlide" ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}</span>
                                    </button>

                                    <div className="w-px h-8 bg-slate-700 mx-1" />

                                    <button onClick={undo} className={`btn h-12 w-12 rounded-2xl flex items-center justify-center transition-colors ${undoStack.length === 0 ? "opacity-30 cursor-not-allowed text-slate-500" : "hover:bg-slate-800 text-white"}`} disabled={undoStack.length === 0} title="Undo">
                                        <Undo2 className="h-5 w-5" />
                                    </button>
                                    <button onClick={redo} className={`btn h-12 w-12 rounded-2xl flex items-center justify-center transition-colors ${redoStack.length === 0 ? "opacity-30 cursor-not-allowed text-slate-500" : "hover:bg-slate-800 text-white"}`} disabled={redoStack.length === 0} title="Redo">
                                        <Redo2 className="h-5 w-5" />
                                    </button>
                                    <button onClick={() => setShowPagesPanel(prev => !prev)} className={`btn h-12 w-12 rounded-2xl flex items-center justify-center transition-colors ${showPagesPanel ? 'bg-blue-600 text-white shadow-lg' : 'hover:bg-slate-800 text-white'}`} title={showPagesPanel ? "Hide Pages" : "Show Pages"}>
                                        <Layers className="h-5 w-5" />
                                    </button>
                                    <button
                                        onClick={() => changePage(pageNumber - 1, 'prev')}
                                        disabled={pageNumber <= 1}
                                        className={`btn h-12 w-12 rounded-2xl flex items-center justify-center transition-colors ${pageNumber <= 1 ? "opacity-30 cursor-not-allowed text-slate-500" : "hover:bg-slate-800 text-white"}`}
                                        title="Previous Slide"
                                    >
                                        <ChevronLeft className="h-5 w-5" />
                                    </button>
                                    <button
                                        onClick={() => changePage(pageNumber + 1, 'next')}
                                        disabled={pageNumber >= (numPages || 1)}
                                        className={`btn h-12 w-12 rounded-2xl flex items-center justify-center transition-colors ${pageNumber >= (numPages || 1) ? "opacity-30 cursor-not-allowed text-slate-500" : "hover:bg-slate-800 text-white"}`}
                                        title="Next Slide"
                                    >
                                        <ChevronRight className="h-5 w-5" />
                                    </button>
                                    <div className="px-2 text-center">
                                        <div className="text-[11px] font-bold text-white leading-none">{pageNumber}/{numPages || 0}</div>
                                        <div className="text-[9px] uppercase tracking-wider text-slate-500 mt-1">Pages</div>
                                    </div>

                                    <div className="w-px h-8 bg-slate-700 mx-1" />

                                    <button onClick={() => saveNow()} className="btn h-12 w-12 rounded-2xl flex items-center justify-center transition-colors hover:bg-slate-800 text-emerald-300" title="Save Board">
                                        <Save className="h-5 w-5" />
                                    </button>
                                    <button onClick={toggleFullscreen} className="btn h-12 w-12 rounded-2xl flex items-center justify-center transition-colors hover:bg-slate-800 text-white" title={isFullscreen ? "Exit Fullscreen" : "Fullscreen"}>
                                        {isFullscreen ? <Minimize2 className="h-5 w-5" /> : <Maximize2 className="h-5 w-5" />}
                                    </button>
                                    <button onClick={() => setShowDock(false)} className="btn h-12 w-12 rounded-2xl flex items-center justify-center transition-colors hover:bg-slate-800 text-yellow-300" title="Hide Dock">
                                        <Minus className="h-5 w-5" />
                                    </button>
                                    <button onClick={() => { if (isImmersiveMode) { if (isFocusMode) toggleFocusMode(); if (isFullscreen) toggleFullscreen(); } else { persistAndNavigate('/content-studio'); } }} className="btn h-12 w-12 rounded-2xl flex items-center justify-center transition-colors hover:bg-slate-800 text-rose-300" title={isImmersiveMode ? "Exit Fullscreen" : "Close Whiteboard"}>
                                        <X className="h-5 w-5" />
                                    </button>
                                </div>
                            </div>
                    </div>
                )}
            </div>

            {
                !showDock && (
                    <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-40 pointer-events-auto animate-in fade-in slide-in-from-bottom-8 duration-500">
                        <button
                            onClick={() => setShowDock(true)}
                            className="btn btn-primary h-12 px-6 rounded-full flex items-center justify-center gap-2 shadow-2xl hover:scale-105 hover:-translate-y-1 transition-all border border-blue-500/30 font-bold"
                            title="Show Dock"
                        >
                            <Menu className="h-5 w-5" />
                            <span className="text-sm tracking-wide">Show Toolbar</span>
                        </button>
                    </div>
                )
            }

            <Modal
                isOpen={modalConfig.isOpen}
                onClose={() => setModalConfig((prev) => ({ ...prev, isOpen: false }))}
                onConfirm={modalConfig.onConfirm}
                title={modalConfig.title}
                message={modalConfig.message}
                type={modalConfig.type}
                confirmText={modalConfig.confirmText}
                cancelText={modalConfig.cancelText}
                theme="dark"
            />
        </div >
    );
}
