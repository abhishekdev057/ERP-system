"use client";

import { ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import { useRouter, useSearchParams } from "next/navigation";
import toast from "react-hot-toast";
import {
    ArrowLeft,
    ChevronLeft,
    ChevronRight,
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
} from "lucide-react";
import Modal from "@/components/ui/Modal";

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
    annotations: AnnotationMap;
    settings?: {
        tool?: WhiteboardTool;
        inkColor?: string;
        strokeSize?: number;
        highlighterOpacity?: number;
        fontFamily?: string;
        fontSize?: number;
        shapeFillColor?: string;
        shapeFilled?: boolean;
        shapeFillOpacity?: number;
        showGrid?: boolean;
        showPdfLayer?: boolean;
        zoomPercent?: number;
        showPageStrip?: boolean;
        showDock?: boolean;
        showStudioMenu?: boolean;
        activeStudioTab?: StudioTab;
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
    "#f8fafc",
    "#facc15",
    "#f97316",
    "#ef4444",
    "#38bdf8",
    "#22c55e",
    "#a78bfa",
    "#f472b6",
    "#0f172a",
];

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
                x1: clamp(point.x, 0, 1),
                y1: clamp(point.y, 0, 1),
            };
        }
        return {
            ...origin,
            x2: clamp(point.x, 0, 1),
            y2: clamp(point.y, 0, 1),
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

    minX = clamp(minX, 0, 1);
    minY = clamp(minY, 0, 1);
    maxX = clamp(maxX, 0, 1);
    maxY = clamp(maxY, 0, 1);

    const minSize = 0.003;
    if (maxX - minX < minSize) {
        if (handle === "nw" || handle === "sw") {
            minX = clamp(maxX - minSize, 0, 1);
        } else {
            maxX = clamp(minX + minSize, 0, 1);
        }
    }
    if (maxY - minY < minSize) {
        if (handle === "nw" || handle === "ne") {
            minY = clamp(maxY - minSize, 0, 1);
        } else {
            maxY = clamp(minY + minSize, 0, 1);
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
        annotations,
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
    const [highlighterOpacity, setHighlighterOpacity] = useState(0.28);
    const [fontFamily, setFontFamily] = useState(FONT_CHOICES[0].value);
    const [fontSize, setFontSize] = useState(30);
    const [shapeFilled, setShapeFilled] = useState(false);
    const [shapeFillColor, setShapeFillColor] = useState("#38bdf8");
    const [shapeFillOpacity, setShapeFillOpacity] = useState(0.22);

    const [showDock, setShowDock] = useState(true);
    const [showPageStrip, setShowPageStrip] = useState(true);
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
    const pdfCanvasRef = useRef<HTMLCanvasElement>(null);
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const importInputRef = useRef<HTMLInputElement>(null);
    const interactionRef = useRef<InteractionState>(null);
    const thumbnailJobRef = useRef(0);
    const selectionClipboardRef = useRef<SelectionClipboardPayload | null>(null);
    const pasteOffsetRef = useRef(0);
    const focusLayoutRef = useRef<{
        showPageStrip: boolean;
        showStudioMenu: boolean;
    } | null>(null);

    const [stageWidth, setStageWidth] = useState(880);
    const renderScale = zoomPercent / 100;
    const renderWidth = Math.max(320, Math.round(stageWidth * renderScale));
    const renderHeight = Math.max(320, Math.round(renderWidth * pageRatio));

    const storageKey = useMemo(
        () => `whiteboard:${documentId?.trim() || "ad-hoc"}`,
        [documentId]
    );

    useEffect(() => {
        annotationsRef.current = annotations;
    }, [annotations]);

    useEffect(() => {
        setPageInput(String(pageNumber));
        setTextComposer((prev) => ({ ...prev, isOpen: false, value: "" }));
        setSelectedElement(null);
        setSelectedElements([]);
        setMarqueeRect(null);
    }, [pageNumber]);

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

    useEffect(() => {
        setIsRenderingPage(true);
    }, [pageNumber, renderWidth]);

    useEffect(() => {
        const onFullscreenChange = () => {
            setIsFullscreen(Boolean(document.fullscreenElement));
        };
        document.addEventListener("fullscreenchange", onFullscreenChange);
        return () => document.removeEventListener("fullscreenchange", onFullscreenChange);
    }, []);

    useEffect(() => {
        if (!stageHostRef.current) return;

        const resize = () => {
            if (!stageHostRef.current) return;
            const rect = stageHostRef.current.getBoundingClientRect();
            const nextWidth = clamp(Math.floor(rect.width - 24), 320, 1360);
            setStageWidth(nextWidth);
        };

        resize();
        const observer = new ResizeObserver(resize);
        observer.observe(stageHostRef.current);
        return () => observer.disconnect();
    }, []);

    useEffect(() => {
        if (!documentId) {
            setIsLoadingPdf(false);
            setLoadError("No document selected for whiteboard.");
            setPdfData(null);
            setPdfDocumentProxy(null);
            setNumPages(0);
            setThumbnailMap({});
            return;
        }

        const controller = new AbortController();
        let cancelled = false;

        const loadPdf = async () => {
            setIsLoadingPdf(true);
            setLoadError("");
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
                    if (prev) URL.revokeObjectURL(prev);
                    return objectUrl;
                });
                setPdfData(bytes);
                setPdfDocumentProxy(null);
                setNumPages(0);
                setThumbnailMap({});
                setIsLoadingPdf(false);

                fetch(`/api/documents/${encodeURIComponent(documentId)}`, {
                    signal: controller.signal,
                })
                    .then((response) => (response.ok ? response.json() : null))
                    .then((info) => {
                        if (cancelled || !info) return;
                        const title = String(info?.document?.title || "").trim();
                        if (title) setPdfTitle(title);
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
            if (pdfUrl) URL.revokeObjectURL(pdfUrl);
        };
    }, [pdfUrl]);

    useEffect(() => {
        if (!pdfData || pdfData.length === 0) {
            setPdfDocumentProxy(null);
            setNumPages(0);
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

                loadingTask = pdfjsLib.getDocument({ data: pdfData });
                docProxy = await loadingTask.promise;
                if (cancelled) return;

                setPdfDocumentProxy(docProxy);
                const total = Number(docProxy?.numPages) || 0;
                setNumPages(total);
                if (total > 0) {
                    setPageNumber((prev) => clamp(prev, 1, total));
                    setPageInput((prev) => {
                        const parsed = Number.parseInt(prev, 10);
                        if (Number.isFinite(parsed)) {
                            return String(clamp(parsed, 1, total));
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
            try {
                docProxy?.destroy?.();
            } catch {
                // noop
            }
        };
    }, [pdfData]);

    useEffect(() => {
        const canvas = pdfCanvasRef.current;
        if (!canvas || !pdfDocumentProxy || numPages <= 0) return;

        let cancelled = false;
        let renderTask: any = null;

        const renderPage = async () => {
            try {
                setIsRenderingPage(true);
                const pdfPage = await pdfDocumentProxy.getPage(pageNumber);
                if (cancelled) return;

                const baseViewport = pdfPage.getViewport({ scale: 1 });
                const width = Math.max(1, Number(baseViewport.width) || renderWidth);
                const height = Math.max(1, Number(baseViewport.height) || renderHeight);
                setPageRatio(height / width);

                const scale = renderWidth / width;
                const viewport = pdfPage.getViewport({ scale });
                const dpr = typeof window === "undefined" ? 1 : window.devicePixelRatio || 1;

                canvas.width = Math.max(1, Math.floor(viewport.width * dpr));
                canvas.height = Math.max(1, Math.floor(viewport.height * dpr));
                canvas.style.width = `${Math.max(1, viewport.width)}px`;
                canvas.style.height = `${Math.max(1, viewport.height)}px`;

                const context = canvas.getContext("2d");
                if (!context) throw new Error("Canvas context is not available");

                context.setTransform(dpr, 0, 0, dpr, 0, 0);
                context.fillStyle = "#ffffff";
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
                    const pdfPage = await pdfDocumentProxy.getPage(page);
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

    useEffect(() => {
        setIsStorageReady(false);
        setAnnotations({});
        setUndoStack([]);
        setRedoStack([]);
        setLastSavedAt("");

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

            setAnnotations(parsed.annotations || {});
            setPageNumber(parsed.pageNumber || 1);

            const settings = parsed.settings;
            if (settings) {
                if (settings.tool) setTool(settings.tool);
                if (typeof settings.inkColor === "string") setInkColor(settings.inkColor);
                if (typeof settings.strokeSize === "number")
                    setStrokeSize(clamp(settings.strokeSize, 1, 24));
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
            try {
                const snapshot: WhiteboardSnapshot = {
                    version: 2,
                    documentId: documentId || undefined,
                    pageNumber,
                    annotations,
                    settings: {
                        tool,
                        inkColor,
                        strokeSize,
                        highlighterOpacity,
                        fontFamily,
                        fontSize,
                        shapeFillColor,
                        shapeFilled,
                        shapeFillOpacity,
                        showGrid,
                        showPdfLayer,
                        zoomPercent,
                        showPageStrip,
                        showDock,
                        showStudioMenu,
                        activeStudioTab,
                        focusMode: isFocusMode,
                    },
                };

                window.localStorage.setItem(storageKey, JSON.stringify(snapshot));
                setLastSavedAt(
                    new Date().toLocaleTimeString("en-GB", {
                        hour: "2-digit",
                        minute: "2-digit",
                        second: "2-digit",
                    })
                );
            } catch (error) {
                console.error("Failed to persist whiteboard state:", error);
            }
        }, 220);

        return () => window.clearTimeout(timer);
    }, [
        activeStudioTab,
        annotations,
        documentId,
        fontFamily,
        fontSize,
        highlighterOpacity,
        inkColor,
        isStorageReady,
        pageNumber,
        shapeFillColor,
        shapeFillOpacity,
        shapeFilled,
        showDock,
        isFocusMode,
        showGrid,
        showPageStrip,
        showPdfLayer,
        showStudioMenu,
        storageKey,
        strokeSize,
        tool,
        zoomPercent,
    ]);

    const pushUndoSnapshot = useCallback(() => {
        setUndoStack((prev) =>
            [...prev, deepClone(annotationsRef.current)].slice(-MAX_HISTORY_STEPS)
        );
        setRedoStack([]);
    }, []);

    const redrawCanvas = useCallback(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;

        const dpr = typeof window === "undefined" ? 1 : window.devicePixelRatio || 1;
        canvas.width = Math.max(1, Math.floor(renderWidth * dpr));
        canvas.height = Math.max(1, Math.floor(renderHeight * dpr));
        canvas.style.width = `${renderWidth}px`;
        canvas.style.height = `${renderHeight}px`;

        const ctx = canvas.getContext("2d");
        if (!ctx) return;

        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, renderWidth, renderHeight);

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

            const points = stroke.points.map((point) => ({
                x: point.x * renderWidth,
                y: point.y * renderHeight,
            }));

            ctx.save();
            ctx.lineCap = "round";
            ctx.lineJoin = "round";

            if (stroke.tool === "eraser") {
                ctx.globalCompositeOperation = "destination-out";
                ctx.strokeStyle = "rgba(0,0,0,1)";
                ctx.lineWidth = Math.max(4, stroke.size * 2.4);
                ctx.globalAlpha = 1;
            } else if (stroke.tool === "highlighter") {
                ctx.globalCompositeOperation = "multiply";
                ctx.strokeStyle = stroke.color;
                ctx.lineWidth = Math.max(2, stroke.size * 1.75);
                ctx.globalAlpha = clamp(stroke.opacity, 0.1, 0.8);
            } else {
                ctx.globalCompositeOperation = "source-over";
                ctx.strokeStyle = stroke.color;
                ctx.lineWidth = Math.max(1.6, stroke.size);
                ctx.globalAlpha = 1;
            }

            if (points.length === 1) {
                const radius = Math.max(1.5, ctx.lineWidth * 0.5);
                ctx.beginPath();
                ctx.arc(points[0].x, points[0].y, radius, 0, Math.PI * 2);
                ctx.fillStyle = stroke.tool === "eraser" ? "rgba(0,0,0,1)" : stroke.color;
                ctx.fill();
                ctx.restore();
                return;
            }

            ctx.beginPath();
            ctx.moveTo(points[0].x, points[0].y);
            for (let index = 1; index < points.length; index += 1) {
                const previous = points[index - 1];
                const current = points[index];
                const midX = (previous.x + current.x) / 2;
                const midY = (previous.y + current.y) / 2;
                ctx.quadraticCurveTo(previous.x, previous.y, midX, midY);
            }
            const tail = points[points.length - 1];
            ctx.lineTo(tail.x, tail.y);
            ctx.stroke();
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
        event: React.PointerEvent<HTMLCanvasElement>
    ): StrokePoint | null => {
        const canvas = canvasRef.current;
        if (!canvas) return null;

        const rect = canvas.getBoundingClientRect();
        const localX = event.clientX - rect.left;
        const localY = event.clientY - rect.top;
        if (localX < 0 || localY < 0 || localX > rect.width || localY > rect.height) {
            return null;
        }

        return {
            x: clamp(localX / rect.width, 0, 1),
            y: clamp(localY / rect.height, 0, 1),
            pressure: event.pressure || 0.5,
        };
    };

    const handlePointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
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
                color: inkColor,
                size: strokeSize,
                opacity: tool === "highlighter" ? highlighterOpacity : 1,
                points: [point],
            };
            interactionRef.current = { kind: "stroke", id, pointerId: event.pointerId };

            setAnnotations((prev) => {
                const current = prev[pageKey] ? deepClone(prev[pageKey]) : emptyPageAnnotation();
                current.strokes.push(stroke);
                return { ...prev, [pageKey]: current };
            });
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

    const handlePointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
        const interaction = interactionRef.current;
        if (!interaction || interaction.pointerId !== event.pointerId) return;

        const point = toNormalizedPoint(event);
        if (!point) return;

        if (interaction.kind === "marquee") {
            setMarqueeRect({ start: interaction.startPoint, end: point });
            return;
        }

        setAnnotations((prev) => {
            const pageKey = String(pageNumber);
            const current = prev[pageKey];
            if (!current) return prev;

            if (interaction.kind === "stroke") {
                const index = current.strokes.findIndex((stroke) => stroke.id === interaction.id);
                if (index === -1) return prev;

                const nextStrokes = [...current.strokes];
                const target = nextStrokes[index];
                nextStrokes[index] = {
                    ...target,
                    points: [...target.points, point],
                };
                return { ...prev, [pageKey]: { ...current, strokes: nextStrokes } };
            }

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
                const deltaX = clamp(deltaXRaw, -base.minX, 1 - base.maxX);
                const deltaY = clamp(deltaYRaw, -base.minY, 1 - base.maxY);

                const nextShape: ShapeAnnotation = {
                    ...interaction.originShape,
                    x1: clamp(interaction.originShape.x1 + deltaX, 0, 1),
                    y1: clamp(interaction.originShape.y1 + deltaY, 0, 1),
                    x2: clamp(interaction.originShape.x2 + deltaX, 0, 1),
                    y2: clamp(interaction.originShape.y2 + deltaY, 0, 1),
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
                const deltaX = clamp(deltaXRaw, -textBounds.minX, 1 - textBounds.maxX);
                const deltaY = clamp(deltaYRaw, -textBounds.minY, 1 - textBounds.maxY);

                const nextText: TextAnnotation = {
                    ...interaction.originText,
                    x: clamp(interaction.originText.x + deltaX, 0, 1),
                    y: clamp(interaction.originText.y + deltaY, 0, 1),
                };

                const nextTexts = [...current.texts];
                nextTexts[textIndex] = nextText;
                return { ...prev, [pageKey]: { ...current, texts: nextTexts } };
            }
            return prev;
        });
    };

    const finishPointerInteraction = (event: React.PointerEvent<HTMLCanvasElement>) => {
        const interaction = interactionRef.current;
        if (!interaction || interaction.pointerId !== event.pointerId) return;

        try {
            event.currentTarget.releasePointerCapture(event.pointerId);
        } catch {
            // ignore stale release errors
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

    const saveNow = () => {
        if (typeof window === "undefined") return;
        try {
            const snapshot: WhiteboardSnapshot = {
                version: 2,
                documentId: documentId || undefined,
                pageNumber,
                annotations: annotationsRef.current,
            };
            window.localStorage.setItem(storageKey, JSON.stringify(snapshot));
            setLastSavedAt(
                new Date().toLocaleTimeString("en-GB", {
                    hour: "2-digit",
                    minute: "2-digit",
                    second: "2-digit",
                })
            );
            toast.success("Whiteboard saved");
        } catch (error) {
            console.error("Manual save failed:", error);
            toast.error("Failed to save whiteboard state");
        }
    };

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
                await document.documentElement.requestFullscreen();
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

    const changePage = (value: number) => {
        if (numPages === 0) return;
        const nextPage = clamp(value, 1, numPages);
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

    const buildCompositePageCanvas = useCallback(() => {
        const overlayCanvas = canvasRef.current;
        const pdfCanvas = pdfCanvasRef.current;

        if (!overlayCanvas && !pdfCanvas) return null;

        const width = overlayCanvas?.width || pdfCanvas?.width || 1;
        const height = overlayCanvas?.height || pdfCanvas?.height || 1;
        const output = document.createElement("canvas");
        output.width = width;
        output.height = height;

        const context = output.getContext("2d");
        if (!context) return null;

        context.fillStyle = "#ffffff";
        context.fillRect(0, 0, width, height);
        if (pdfCanvas) {
            context.drawImage(pdfCanvas, 0, 0, width, height);
        }
        if (overlayCanvas) {
            context.drawImage(overlayCanvas, 0, 0, width, height);
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
            const snapshot: WhiteboardSnapshot = {
                version: 2,
                documentId: documentId || undefined,
                pageNumber,
                annotations: annotationsRef.current,
                settings: {
                    tool,
                    inkColor,
                    strokeSize,
                    highlighterOpacity,
                    fontFamily,
                    fontSize,
                    shapeFillColor,
                    shapeFilled,
                    shapeFillOpacity,
                    showGrid,
                    showPdfLayer,
                    zoomPercent,
                    showPageStrip,
                    showDock,
                    showStudioMenu,
                    activeStudioTab,
                    focusMode: isFocusMode,
                },
            };
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
        }

        if (snapshot.settings) {
            const settings = snapshot.settings;
            if (settings.tool) setTool(settings.tool);
            if (typeof settings.inkColor === "string") setInkColor(settings.inkColor);
            if (typeof settings.strokeSize === "number")
                setStrokeSize(clamp(settings.strokeSize, 1, 24));
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
    const isPageStripVisible = showPageStrip && !isFocusMode;
    const isStudioAsideVisible = showStudioMenu && !isFocusMode;
    const isDockStudioVisible = showStudioMenu && isFocusMode && showDock;
    const pageNumbers = useMemo(
        () => Array.from({ length: numPages }, (_, index) => index + 1),
        [numPages]
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

            if (withCommand && key === "0") {
                event.preventDefault();
                setZoomPercent(100);
                return;
            }

            if (withCommand && (key === "=" || key === "+")) {
                event.preventDefault();
                setZoomPercent((prev) => clamp(prev + 10, 50, 180));
                return;
            }

            if (withCommand && key === "-") {
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

    if (!hasDocument) {
        return (
            <div className="fixed inset-0 z-[82] bg-slate-950 flex items-center justify-center p-6">
                <div className="surface p-6 max-w-md w-full text-center">
                    <h2 className="text-xl font-bold text-slate-900">
                        Whiteboard needs a document
                    </h2>
                    <p className="text-sm text-slate-600 mt-2">
                        Open Whiteboard from History actions to load a saved PDF file.
                    </p>
                    <button
                        onClick={() => router.push("/history")}
                        className="btn btn-primary mt-4"
                    >
                        Back to History
                    </button>
                </div>
            </div>
        );
    }

    return (
        <div className="fixed inset-0 z-[82] bg-slate-950 text-slate-100 flex flex-col">
            <input
                ref={importInputRef}
                type="file"
                accept=".json,application/json"
                className="hidden"
                onChange={handleImportFileChange}
            />

            <header className="h-16 border-b border-slate-800 bg-slate-950/95 backdrop-blur px-4 flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 min-w-0">
                    <button
                        onClick={() => router.push("/history")}
                        className="btn btn-ghost text-xs"
                    >
                        <ArrowLeft className="h-4 w-4" />
                        Back
                    </button>
                    <div className="min-w-0">
                        <p className="text-sm font-semibold truncate">{pdfTitle}</p>
                        <p className="text-[11px] text-slate-400 truncate">
                            Whiteboard Studio
                            {lastSavedAt ? ` • Auto-saved ${lastSavedAt}` : ""}
                            {` • Annotated pages ${annotatedPages}/${numPages || 0}`}
                        </p>
                    </div>
                </div>

                <div className="flex items-center gap-2">
                    <button
                        onClick={() => setShowPageStrip((prev) => !prev)}
                        className="btn btn-ghost text-xs"
                        title={showPageStrip ? "Hide page strip" : "Show page strip"}
                    >
                        {showPageStrip ? (
                            <PanelLeftClose className="h-4 w-4" />
                        ) : (
                            <PanelLeftOpen className="h-4 w-4" />
                        )}
                        {showPageStrip ? "Hide Pages" : "Show Pages"}
                    </button>
                    <button
                        onClick={() => setShowStudioMenu((prev) => !prev)}
                        className="btn btn-secondary text-xs"
                    >
                        <Settings2 className="h-4 w-4" />
                        {showStudioMenu ? "Hide Studio" : "Show Studio"}
                    </button>
                    <button onClick={saveNow} className="btn btn-secondary text-xs">
                        <Save className="h-4 w-4" />
                        Save
                    </button>
                    <button onClick={toggleFocusMode} className="btn btn-secondary text-xs">
                        {isFocusMode ? (
                            <Minimize2 className="h-4 w-4" />
                        ) : (
                            <Maximize2 className="h-4 w-4" />
                        )}
                        {isFocusMode ? "Exit Board View" : "Board Full View"}
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

            <div className="relative flex flex-1 min-h-0">
                {isPageStripVisible && (
                    <aside className="w-60 border-r border-slate-800 bg-slate-900/70 p-3 overflow-auto">
                        <p className="text-xs font-semibold uppercase tracking-wide text-slate-400 mb-2">
                            Page Navigator ({numPages || 0})
                        </p>
                        <div className="space-y-2 mb-3">
                            {pageNumbers.map((page) => {
                                const pageData = annotations[String(page)];
                                const annotated = hasPageContent(pageData);
                                return (
                                    <button
                                        key={page}
                                        type="button"
                                        onClick={() => changePage(page)}
                                        className={`w-full rounded-xl border px-2 py-2 text-xs font-semibold relative ${
                                            page === pageNumber
                                                ? "border-blue-400 bg-blue-950/45 text-white"
                                                : "border-slate-700 bg-slate-800 text-slate-200 hover:bg-slate-700"
                                        }`}
                                    >
                                        <div className="flex items-center gap-2">
                                            <div className="w-[74px] h-[98px] rounded-md border border-slate-600 bg-slate-900 overflow-hidden flex items-center justify-center shrink-0 relative">
                                                {thumbnailMap[page] ? (
                                                    <Image
                                                        src={thumbnailMap[page]}
                                                        alt={`Page ${page}`}
                                                        fill
                                                        unoptimized
                                                        sizes="74px"
                                                        className="w-full h-full object-cover"
                                                    />
                                                ) : (
                                                    <div className="w-full h-full bg-slate-800 animate-pulse" />
                                                )}
                                            </div>
                                            <div className="text-left">
                                                <p className="text-sm font-semibold">Page {page}</p>
                                                <p className="text-[11px] text-slate-300">
                                                    {annotated
                                                        ? "Annotated"
                                                        : isGeneratingThumbnails
                                                          ? "Rendering thumb..."
                                                          : "No annotations"}
                                                </p>
                                            </div>
                                        </div>
                                        {annotated && (
                                            <span className="absolute top-1 right-1 h-2.5 w-2.5 rounded-full bg-emerald-400 border border-slate-900" />
                                        )}
                                    </button>
                                );
                            })}
                        </div>
                        <p className="text-[11px] text-slate-400 leading-relaxed">
                            Thumbnail strip supports direct page jump. Green dots indicate pages with annotations.
                        </p>
                    </aside>
                )}

                <section className="flex-1 min-w-0 flex flex-col">
                    {!isFocusMode && (
                        <div className="h-14 border-b border-slate-800 bg-slate-900/55 px-4 flex items-center justify-between gap-3">
                            <div className="flex items-center gap-2">
                                <button
                                    onClick={() => changePage(pageNumber - 1)}
                                    className="btn btn-ghost text-xs"
                                    disabled={pageNumber <= 1}
                                >
                                    <ChevronLeft className="h-4 w-4" />
                                    Prev
                                </button>
                                <button
                                    onClick={() => changePage(pageNumber + 1)}
                                    className="btn btn-ghost text-xs"
                                    disabled={numPages === 0 || pageNumber >= numPages}
                                >
                                    Next
                                    <ChevronRight className="h-4 w-4" />
                                </button>
                            </div>

                            <div className="flex items-center gap-2 text-xs">
                                <span className="text-slate-400">Page</span>
                                <input
                                    value={pageInput}
                                    onChange={(event) => setPageInput(event.target.value)}
                                    onKeyDown={(event) => {
                                        if (event.key === "Enter") goToPageFromInput();
                                    }}
                                    className="w-16 h-9 rounded-lg border border-slate-700 bg-slate-800 text-center text-sm font-semibold text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
                                />
                                <button
                                    onClick={goToPageFromInput}
                                    className="btn btn-secondary text-xs"
                                >
                                    Go
                                </button>
                                <span className="text-slate-300">/ {numPages || 0}</span>
                            </div>
                        </div>
                    )}

                    <div
                        ref={stageHostRef}
                        className={`flex-1 min-h-0 overflow-auto ${
                            isFocusMode ? "p-2 md:p-3 pb-28" : "p-4 md:p-6 pb-28"
                        }`}
                    >
                        <div
                            ref={stageFrameRef}
                            className="relative mx-auto rounded-[20px] border border-slate-700 bg-white shadow-[0_22px_54px_-24px_rgba(15,23,42,0.95)] overflow-hidden"
                            style={{ width: renderWidth, height: renderHeight }}
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
                            ) : pdfData ? (
                                <canvas
                                    ref={pdfCanvasRef}
                                    className="absolute inset-0"
                                    style={{ opacity: showPdfLayer ? 1 : 0.08 }}
                                />
                            ) : null}

                            <canvas
                                ref={canvasRef}
                                className="absolute inset-0"
                                style={{
                                    cursor:
                                        tool === "text"
                                            ? "text"
                                            : tool === "select"
                                              ? "default"
                                              : "crosshair",
                                    touchAction: "none",
                                }}
                                onPointerDown={handlePointerDown}
                                onPointerMove={handlePointerMove}
                                onPointerUp={finishPointerInteraction}
                                onPointerCancel={finishPointerInteraction}
                                onPointerLeave={finishPointerInteraction}
                            />

                            {textComposer.isOpen && (
                                <div
                                    className="absolute z-20 w-[300px] rounded-2xl border border-slate-700 bg-slate-900/95 backdrop-blur p-3 shadow-2xl"
                                    style={{
                                        left: `${clamp(textComposer.x * 100, 2, 77)}%`,
                                        top: `${clamp(textComposer.y * 100, 2, 80)}%`,
                                    }}
                                >
                                    <p className="text-xs font-semibold text-slate-300 mb-2">
                                        Text Annotation
                                    </p>
                                    <textarea
                                        value={textComposer.value}
                                        onChange={(event) =>
                                            setTextComposer((prev) => ({
                                                ...prev,
                                                value: event.target.value,
                                            }))
                                        }
                                        className="w-full min-h-[108px] rounded-xl border border-slate-700 bg-slate-950 text-slate-100 text-sm p-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                                        placeholder="Type note..."
                                    />
                                    <div className="mt-2 flex justify-end gap-2">
                                        <button
                                            className="btn btn-ghost text-xs"
                                            onClick={() =>
                                                setTextComposer((prev) => ({
                                                    ...prev,
                                                    isOpen: false,
                                                    value: "",
                                                }))
                                            }
                                        >
                                            Cancel
                                        </button>
                                        <button
                                            className="btn btn-primary text-xs"
                                            onClick={commitText}
                                        >
                                            Insert
                                        </button>
                                    </div>
                                </div>
                            )}

                            <div className="absolute top-3 left-3 flex flex-wrap gap-2">
                                <span className="status-badge border-slate-300 bg-white/90 text-slate-700">
                                    Tool: {tool.toUpperCase()}
                                </span>
                                <span className="status-badge border-slate-300 bg-white/90 text-slate-700">
                                    Elements: {totalElementsOnCurrentPage}
                                </span>
                                {showGrid && (
                                    <span className="status-badge border-slate-300 bg-white/90 text-slate-700">
                                        Grid On
                                    </span>
                                )}
                                {selectionCount > 0 && (
                                    <span className="status-badge border-slate-300 bg-white/90 text-slate-700">
                                        Selected: {selectionCount}
                                    </span>
                                )}
                            </div>

                            {isRenderingPage && (
                                <div className="absolute top-3 right-3 rounded-xl border border-blue-300 bg-blue-50 text-blue-800 px-2 py-1 text-[11px] font-semibold">
                                    Rendering page...
                                </div>
                            )}
                        </div>
                    </div>
                </section>

                {(isStudioAsideVisible || isDockStudioVisible) && (
                    <aside
                        className={
                            isFocusMode
                                ? "absolute left-3 right-3 bottom-20 z-30 max-h-[46vh] rounded-2xl border border-slate-700 bg-slate-900/95 backdrop-blur flex flex-col overflow-hidden shadow-2xl"
                                : "w-[340px] border-l border-slate-800 bg-slate-900/70 flex flex-col min-h-0"
                        }
                    >
                        <div className="p-3 border-b border-slate-800">
                            <p className="text-xs font-semibold uppercase tracking-wide text-slate-400 mb-2">
                                Studio Controls
                            </p>
                            <div className="grid grid-cols-5 gap-1">
                                {STUDIO_TABS.map((tab) => (
                                    <button
                                        key={tab.id}
                                        onClick={() => setActiveStudioTab(tab.id)}
                                        className={`h-10 rounded-lg text-[11px] font-semibold flex flex-col items-center justify-center gap-0.5 ${
                                            activeStudioTab === tab.id
                                                ? "bg-blue-600 text-white"
                                                : "bg-slate-800 text-slate-300 hover:bg-slate-700"
                                        }`}
                                    >
                                        {tab.icon}
                                        <span>{tab.label}</span>
                                    </button>
                                ))}
                            </div>
                        </div>

                        <div className="flex-1 min-h-0 overflow-auto p-3 space-y-3">
                            {activeStudioTab === "tools" && (
                                <>
                                    <div className="surface-subtle p-3">
                                        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-2">
                                            Drawing Tools
                                        </p>
                                        <div className="grid grid-cols-2 gap-2">
                                            {TOOL_ITEMS.map((item) => (
                                                <button
                                                    key={item.id}
                                                    onClick={() => setTool(item.id)}
                                                    className={`btn text-xs ${
                                                        tool === item.id
                                                            ? "btn-primary"
                                                            : "btn-secondary"
                                                    }`}
                                                >
                                                    {item.icon}
                                                    {item.label}
                                                </button>
                                            ))}
                                        </div>
                                    </div>

                                    <div className="surface-subtle p-3">
                                        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-2">
                                            Edit Actions
                                        </p>
                                        <div className="grid grid-cols-2 gap-2">
                                            <button
                                                onClick={undo}
                                                className="btn btn-secondary text-xs"
                                                disabled={undoStack.length === 0}
                                            >
                                                <Undo2 className="h-4 w-4" />
                                                Undo
                                            </button>
                                            <button
                                                onClick={redo}
                                                className="btn btn-secondary text-xs"
                                                disabled={redoStack.length === 0}
                                            >
                                                <Redo2 className="h-4 w-4" />
                                                Redo
                                            </button>
                                            <button
                                                onClick={clearCurrentPage}
                                                className="btn btn-secondary text-xs"
                                            >
                                                <Trash2 className="h-4 w-4" />
                                                Clear Page
                                            </button>
                                            <button
                                                onClick={clearAllPages}
                                                className="btn btn-danger text-xs"
                                            >
                                                <Trash2 className="h-4 w-4" />
                                                Clear All
                                            </button>
                                            <button
                                                onClick={() => deleteSelectedEntries()}
                                                className="btn btn-secondary text-xs col-span-2"
                                                disabled={selectionCount === 0}
                                            >
                                                <Trash2 className="h-4 w-4" />
                                                Delete Selected
                                            </button>
                                            <button
                                                onClick={() => copySelectedEntries()}
                                                className="btn btn-secondary text-xs"
                                                disabled={selectionCount === 0}
                                            >
                                                <Copy className="h-4 w-4" />
                                                Copy
                                            </button>
                                            <button
                                                onClick={cutSelectedEntries}
                                                className="btn btn-secondary text-xs"
                                                disabled={selectionCount === 0}
                                            >
                                                <Scissors className="h-4 w-4" />
                                                Cut
                                            </button>
                                            <button
                                                onClick={() => pasteSelectionClipboard()}
                                                className="btn btn-secondary text-xs"
                                            >
                                                <ClipboardPaste className="h-4 w-4" />
                                                Paste
                                            </button>
                                            <button
                                                onClick={duplicateSelectedEntries}
                                                className="btn btn-secondary text-xs"
                                                disabled={selectionCount === 0}
                                            >
                                                <Copy className="h-4 w-4" />
                                                Duplicate
                                            </button>
                                        </div>
                                    </div>

                                    <div className="surface-subtle p-3">
                                        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-2">
                                            Multi Select Layout
                                        </p>
                                        <p className="text-[11px] text-slate-500 mb-2">
                                            Shift+Click or drag select box to select multiple elements.
                                        </p>
                                        <div className="grid grid-cols-3 gap-2">
                                            <button
                                                onClick={() => alignSelected("left")}
                                                className="btn btn-secondary text-xs"
                                                disabled={selectionCount < 2}
                                            >
                                                Left
                                            </button>
                                            <button
                                                onClick={() => alignSelected("center-x")}
                                                className="btn btn-secondary text-xs"
                                                disabled={selectionCount < 2}
                                            >
                                                Center
                                            </button>
                                            <button
                                                onClick={() => alignSelected("right")}
                                                className="btn btn-secondary text-xs"
                                                disabled={selectionCount < 2}
                                            >
                                                Right
                                            </button>
                                            <button
                                                onClick={() => alignSelected("top")}
                                                className="btn btn-secondary text-xs"
                                                disabled={selectionCount < 2}
                                            >
                                                Top
                                            </button>
                                            <button
                                                onClick={() => alignSelected("center-y")}
                                                className="btn btn-secondary text-xs"
                                                disabled={selectionCount < 2}
                                            >
                                                Middle
                                            </button>
                                            <button
                                                onClick={() => alignSelected("bottom")}
                                                className="btn btn-secondary text-xs"
                                                disabled={selectionCount < 2}
                                            >
                                                Bottom
                                            </button>
                                            <button
                                                onClick={() => distributeSelected("horizontal")}
                                                className="btn btn-secondary text-xs col-span-3"
                                                disabled={selectionCount < 3}
                                            >
                                                Distribute Horizontal
                                            </button>
                                            <button
                                                onClick={() => distributeSelected("vertical")}
                                                className="btn btn-secondary text-xs col-span-3"
                                                disabled={selectionCount < 3}
                                            >
                                                Distribute Vertical
                                            </button>
                                        </div>
                                    </div>

                                    <div className="surface-subtle p-3">
                                        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-2">
                                            Layer Stats
                                        </p>
                                        <div className="grid grid-cols-3 gap-2 text-xs">
                                            <div className="rounded-lg border border-slate-200 bg-white px-2 py-2">
                                                <p className="text-slate-500">Strokes</p>
                                                <p className="font-bold text-slate-900">
                                                    {currentPageData.strokes.length}
                                                </p>
                                            </div>
                                            <div className="rounded-lg border border-slate-200 bg-white px-2 py-2">
                                                <p className="text-slate-500">Shapes</p>
                                                <p className="font-bold text-slate-900">
                                                    {currentPageData.shapes.length}
                                                </p>
                                            </div>
                                            <div className="rounded-lg border border-slate-200 bg-white px-2 py-2">
                                                <p className="text-slate-500">Texts</p>
                                                <p className="font-bold text-slate-900">
                                                    {currentPageData.texts.length}
                                                </p>
                                            </div>
                                        </div>
                                    </div>
                                </>
                            )}

                            {activeStudioTab === "style" && (
                                <>
                                    <div className="surface-subtle p-3">
                                        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-2">
                                            Ink and Stroke
                                        </p>
                                        <div className="flex items-center gap-1 mb-2 flex-wrap">
                                            {COLOR_SWATCHES.map((color) => (
                                                <button
                                                    key={color}
                                                    type="button"
                                                    title={color}
                                                    onClick={() => setInkColor(color)}
                                                    className={`h-7 w-7 rounded-md border ${
                                                        inkColor === color
                                                            ? "border-slate-900 ring-2 ring-blue-500"
                                                            : "border-slate-300"
                                                    }`}
                                                    style={{ backgroundColor: color }}
                                                />
                                            ))}
                                            <input
                                                type="color"
                                                value={inkColor}
                                                onChange={(event) =>
                                                    setInkColor(event.target.value)
                                                }
                                                className="h-7 w-11 rounded border border-slate-300 bg-transparent p-0"
                                            />
                                        </div>
                                        <label className="text-xs text-slate-600">
                                            Stroke Size: {strokeSize}
                                        </label>
                                        <input
                                            type="range"
                                            min={1}
                                            max={24}
                                            value={strokeSize}
                                            onChange={(event) =>
                                                setStrokeSize(
                                                    Number.parseInt(event.target.value, 10)
                                                )
                                            }
                                            className="w-full"
                                        />
                                        <label className="text-xs text-slate-600">
                                            Highlighter Opacity: {Math.round(highlighterOpacity * 100)}%
                                        </label>
                                        <input
                                            type="range"
                                            min={10}
                                            max={80}
                                            value={Math.round(highlighterOpacity * 100)}
                                            onChange={(event) =>
                                                setHighlighterOpacity(
                                                    Number.parseInt(event.target.value, 10) / 100
                                                )
                                            }
                                            className="w-full"
                                        />
                                    </div>

                                    <div className="surface-subtle p-3">
                                        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-2">
                                            Shape Style
                                        </p>
                                        <label className="inline-flex items-center gap-2 text-xs text-slate-700 mb-2">
                                            <input
                                                type="checkbox"
                                                checked={shapeFilled}
                                                onChange={(event) =>
                                                    setShapeFilled(event.target.checked)
                                                }
                                            />
                                            Fill shapes
                                        </label>
                                        <div className="flex items-center gap-2 mb-2">
                                            <span className="text-xs text-slate-600">Fill Color</span>
                                            <input
                                                type="color"
                                                value={shapeFillColor}
                                                onChange={(event) =>
                                                    setShapeFillColor(event.target.value)
                                                }
                                                className="h-8 w-12 rounded border border-slate-300 bg-transparent p-0"
                                            />
                                        </div>
                                        <label className="text-xs text-slate-600">
                                            Fill Opacity: {Math.round(shapeFillOpacity * 100)}%
                                        </label>
                                        <input
                                            type="range"
                                            min={0}
                                            max={100}
                                            value={Math.round(shapeFillOpacity * 100)}
                                            onChange={(event) =>
                                                setShapeFillOpacity(
                                                    Number.parseInt(event.target.value, 10) / 100
                                                )
                                            }
                                            className="w-full"
                                        />
                                    </div>

                                    <div className="surface-subtle p-3">
                                        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-2">
                                            Text Style
                                        </p>
                                        <label className="text-xs text-slate-600 block mb-1">Font Family</label>
                                        <select
                                            value={fontFamily}
                                            onChange={(event) => setFontFamily(event.target.value)}
                                            className="select text-xs"
                                        >
                                            {FONT_CHOICES.map((font) => (
                                                <option key={font.value} value={font.value}>
                                                    {font.label}
                                                </option>
                                            ))}
                                        </select>
                                        <label className="text-xs text-slate-600 mt-2 block">
                                            Font Size: {fontSize}
                                        </label>
                                        <input
                                            type="range"
                                            min={14}
                                            max={72}
                                            value={fontSize}
                                            onChange={(event) =>
                                                setFontSize(
                                                    Number.parseInt(event.target.value, 10)
                                                )
                                            }
                                            className="w-full"
                                        />
                                    </div>
                                </>
                            )}

                            {activeStudioTab === "input" && (
                                <>
                                    <div className="surface-subtle p-3">
                                        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-2">
                                            Whiteboard Import
                                        </p>
                                        <div className="flex items-center gap-3 mb-3 text-xs">
                                            <label className="inline-flex items-center gap-1 text-slate-700">
                                                <input
                                                    type="radio"
                                                    checked={importMode === "replace"}
                                                    onChange={() => setImportMode("replace")}
                                                />
                                                Replace
                                            </label>
                                            <label className="inline-flex items-center gap-1 text-slate-700">
                                                <input
                                                    type="radio"
                                                    checked={importMode === "merge"}
                                                    onChange={() => setImportMode("merge")}
                                                />
                                                Merge
                                            </label>
                                        </div>
                                        <div className="grid grid-cols-1 gap-2">
                                            <button
                                                onClick={() => importInputRef.current?.click()}
                                                className="btn btn-secondary text-xs"
                                            >
                                                <Upload className="h-4 w-4" />
                                                Import JSON File
                                            </button>
                                            <button
                                                onClick={importFromClipboardJson}
                                                className="btn btn-secondary text-xs"
                                            >
                                                <FileText className="h-4 w-4" />
                                                Import JSON from Clipboard
                                            </button>
                                        </div>
                                    </div>

                                    <div className="surface-subtle p-3">
                                        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-2">
                                            Text Input
                                        </p>
                                        <button
                                            onClick={insertClipboardText}
                                            className="btn btn-secondary text-xs w-full"
                                        >
                                            <Type className="h-4 w-4" />
                                            Insert Clipboard Text
                                        </button>
                                        <p className="text-[11px] text-slate-500 mt-2">
                                            Pasted text is inserted as editable annotation on the current page.
                                        </p>
                                    </div>
                                </>
                            )}

                            {activeStudioTab === "output" && (
                                <>
                                    <div className="surface-subtle p-3">
                                        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-2">
                                            Whiteboard Output
                                        </p>
                                        <div className="grid grid-cols-1 gap-2">
                                            <button
                                                onClick={saveNow}
                                                className="btn btn-secondary text-xs"
                                            >
                                                <Save className="h-4 w-4" />
                                                Save Now
                                            </button>
                                            <button
                                                onClick={exportWhiteboardJson}
                                                className="btn btn-secondary text-xs"
                                            >
                                                <Download className="h-4 w-4" />
                                                Export Board JSON
                                            </button>
                                            <button
                                                onClick={exportCurrentPagePng}
                                                className="btn btn-secondary text-xs"
                                            >
                                                <ImageDown className="h-4 w-4" />
                                                Export Current Page PNG
                                            </button>
                                            <button
                                                onClick={copyCurrentPagePng}
                                                className="btn btn-secondary text-xs"
                                            >
                                                <Layers className="h-4 w-4" />
                                                Copy Page Image
                                            </button>
                                        </div>
                                    </div>

                                    <div className="surface-subtle p-3 text-xs text-slate-600">
                                        <p className="font-semibold text-slate-700 mb-1">
                                            Output Summary
                                        </p>
                                        <p>Total annotated pages: {annotatedPages}</p>
                                        <p>Current page elements: {totalElementsOnCurrentPage}</p>
                                        <p>Total undo snapshots: {undoStack.length}</p>
                                    </div>
                                </>
                            )}

                            {activeStudioTab === "view" && (
                                <>
                                    <div className="surface-subtle p-3">
                                        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-2">
                                            Display Controls
                                        </p>
                                        <div className="grid grid-cols-2 gap-2 mb-2">
                                            <button
                                                onClick={() => setShowPdfLayer((prev) => !prev)}
                                                className="btn btn-secondary text-xs"
                                            >
                                                {showPdfLayer ? (
                                                    <Eye className="h-4 w-4" />
                                                ) : (
                                                    <EyeOff className="h-4 w-4" />
                                                )}
                                                {showPdfLayer ? "Hide PDF" : "Show PDF"}
                                            </button>
                                            <button
                                                onClick={() => setShowGrid((prev) => !prev)}
                                                className="btn btn-secondary text-xs"
                                            >
                                                <Layers className="h-4 w-4" />
                                                {showGrid ? "Hide Grid" : "Show Grid"}
                                            </button>
                                            <button
                                                onClick={() => setShowPageStrip((prev) => !prev)}
                                                className="btn btn-secondary text-xs"
                                            >
                                                {showPageStrip ? (
                                                    <PanelLeftClose className="h-4 w-4" />
                                                ) : (
                                                    <PanelLeftOpen className="h-4 w-4" />
                                                )}
                                                {showPageStrip ? "Hide Pages" : "Show Pages"}
                                            </button>
                                            <button
                                                onClick={() => setShowDock((prev) => !prev)}
                                                className="btn btn-secondary text-xs"
                                            >
                                                {showDock ? "Hide Dock" : "Show Dock"}
                                            </button>
                                        </div>

                                        <label className="text-xs text-slate-600">
                                            Zoom: {zoomPercent}%
                                        </label>
                                        <input
                                            type="range"
                                            min={50}
                                            max={180}
                                            value={zoomPercent}
                                            onChange={(event) =>
                                                setZoomPercent(
                                                    Number.parseInt(event.target.value, 10)
                                                )
                                            }
                                            className="w-full"
                                        />
                                        <div className="flex justify-end mt-2">
                                            <button
                                                onClick={() => setZoomPercent(100)}
                                                className="btn btn-ghost text-xs"
                                            >
                                                Reset Zoom
                                            </button>
                                        </div>
                                    </div>

                                    <div className="surface-subtle p-3 text-xs text-slate-600">
                                        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-2">
                                            Keyboard Shortcuts
                                        </p>
                                        <p>`V/P/H/E/T` for Select, Pen, Highlighter, Eraser, Text.</p>
                                        <p>`L/A/R/O/G/D` for Line, Arrow, Rectangle, Ellipse, Triangle, Diamond.</p>
                                        <p>`Shift + Click` add/remove element in multi-selection.</p>
                                        <p>`Select tool + Drag` creates lasso box selection.</p>
                                        <p>`[` and `]` to change brush size.</p>
                                        <p>`Cmd/Ctrl + C/X/V/D` for copy, cut, paste, duplicate.</p>
                                        <p>`Arrow keys` nudge selected items, `Shift + Arrow` nudges faster.</p>
                                        <p>`Cmd/Ctrl + +/-/0` zoom in, out, reset.</p>
                                        <p>`Delete/Backspace` removes selected shape or text.</p>
                                        <p>`Ctrl/Cmd + S` save, `Ctrl/Cmd + Z` undo, `Ctrl/Cmd + Shift + Z` redo.</p>
                                    </div>
                                </>
                            )}
                        </div>
                    </aside>
                )}
            </div>

            {showDock ? (
                <div className="absolute bottom-3 left-1/2 -translate-x-1/2 z-40 w-[min(1480px,calc(100%-1.5rem))] rounded-2xl border border-slate-700 bg-slate-900/95 backdrop-blur px-3 py-2 shadow-2xl">
                    <div className="flex flex-wrap items-center gap-2">
                        <span className="status-badge border-slate-700 bg-slate-800 text-slate-100">
                            {isFocusMode ? "Focus Dock" : "Quick Dock"}
                        </span>

                        {isFocusMode && (
                            <div className="flex items-center gap-1 rounded-xl border border-slate-700 bg-slate-800/80 px-2 py-1">
                                <button
                                    onClick={() => changePage(pageNumber - 1)}
                                    className="btn btn-ghost text-xs"
                                    disabled={pageNumber <= 1}
                                >
                                    <ChevronLeft className="h-4 w-4" />
                                </button>
                                <button
                                    onClick={() => changePage(pageNumber + 1)}
                                    className="btn btn-ghost text-xs"
                                    disabled={numPages === 0 || pageNumber >= numPages}
                                >
                                    <ChevronRight className="h-4 w-4" />
                                </button>
                                <input
                                    value={pageInput}
                                    onChange={(event) => setPageInput(event.target.value)}
                                    onKeyDown={(event) => {
                                        if (event.key === "Enter") goToPageFromInput();
                                    }}
                                    className="w-14 h-8 rounded-lg border border-slate-700 bg-slate-900 text-center text-xs font-semibold text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
                                />
                                <button onClick={goToPageFromInput} className="btn btn-secondary text-xs">
                                    Go
                                </button>
                                <span className="text-xs text-slate-300 px-1">/ {numPages || 0}</span>
                            </div>
                        )}

                        {TOOL_ITEMS.filter((item) => item.showInDock).map((item) => (
                            <button
                                key={item.id}
                                onClick={() => setTool(item.id)}
                                className={`btn text-xs ${
                                    tool === item.id ? "btn-primary" : "btn-secondary"
                                }`}
                            >
                                {item.icon}
                                {item.label}
                            </button>
                        ))}

                        <button
                            onClick={undo}
                            className="btn btn-secondary text-xs"
                            disabled={undoStack.length === 0}
                        >
                            <Undo2 className="h-4 w-4" />
                            Undo
                        </button>
                        <button
                            onClick={redo}
                            className="btn btn-secondary text-xs"
                            disabled={redoStack.length === 0}
                        >
                            <Redo2 className="h-4 w-4" />
                            Redo
                        </button>
                        <button
                            onClick={() => copySelectedEntries()}
                            className="btn btn-secondary text-xs"
                            disabled={selectionCount === 0}
                        >
                            <Copy className="h-4 w-4" />
                            Copy
                        </button>
                        <button
                            onClick={cutSelectedEntries}
                            className="btn btn-secondary text-xs"
                            disabled={selectionCount === 0}
                        >
                            <Scissors className="h-4 w-4" />
                            Cut
                        </button>
                        <button
                            onClick={() => pasteSelectionClipboard()}
                            className="btn btn-secondary text-xs"
                        >
                            <ClipboardPaste className="h-4 w-4" />
                            Paste
                        </button>
                        <button
                            onClick={duplicateSelectedEntries}
                            className="btn btn-secondary text-xs"
                            disabled={selectionCount === 0}
                        >
                            <Copy className="h-4 w-4" />
                            Duplicate
                        </button>

                        <div className="flex items-center gap-1">
                            {COLOR_SWATCHES.slice(0, 6).map((color) => (
                                <button
                                    key={color}
                                    type="button"
                                    onClick={() => setInkColor(color)}
                                    className={`h-6 w-6 rounded-md border ${
                                        inkColor === color
                                            ? "border-white ring-2 ring-blue-500"
                                            : "border-slate-600"
                                    }`}
                                    style={{ backgroundColor: color }}
                                    title={color}
                                />
                            ))}
                        </div>

                        <label className="text-xs text-slate-300">Size</label>
                        <input
                            type="range"
                            min={1}
                            max={24}
                            value={strokeSize}
                            onChange={(event) =>
                                setStrokeSize(Number.parseInt(event.target.value, 10))
                            }
                            className="w-24"
                        />
                        <button
                            onClick={() => setZoomPercent((prev) => clamp(prev - 10, 50, 180))}
                            className="btn btn-secondary text-xs"
                            title="Zoom out"
                        >
                            <Minus className="h-4 w-4" />
                            Zoom
                        </button>
                        <button
                            onClick={() => setZoomPercent(100)}
                            className="btn btn-secondary text-xs"
                            title="Reset zoom to 100%"
                        >
                            {zoomPercent}%
                        </button>
                        <button
                            onClick={() => setZoomPercent((prev) => clamp(prev + 10, 50, 180))}
                            className="btn btn-secondary text-xs"
                            title="Zoom in"
                        >
                            <Plus className="h-4 w-4" />
                        </button>

                        {isFocusMode &&
                            STUDIO_TABS.map((tab) => (
                                <button
                                    key={tab.id}
                                    onClick={() => {
                                        setActiveStudioTab(tab.id);
                                        setShowStudioMenu(true);
                                    }}
                                    className={`btn text-xs ${
                                        activeStudioTab === tab.id && showStudioMenu
                                            ? "btn-primary"
                                            : "btn-secondary"
                                    }`}
                                >
                                    {tab.label}
                                </button>
                            ))}

                        <button
                            onClick={() => setShowStudioMenu((prev) => !prev)}
                            className="btn btn-secondary text-xs"
                        >
                            <Settings2 className="h-4 w-4" />
                            {showStudioMenu ? "Hide Studio" : "Show Studio"}
                        </button>
                        <button onClick={saveNow} className="btn btn-secondary text-xs">
                            <Save className="h-4 w-4" />
                            Save
                        </button>
                        {isFocusMode && (
                            <button onClick={toggleFocusMode} className="btn btn-ghost text-xs">
                                Exit Board View
                            </button>
                        )}

                        <button
                            onClick={() => setShowDock(false)}
                            className="btn btn-ghost text-xs ml-auto"
                        >
                            Hide Dock
                        </button>
                    </div>
                </div>
            ) : (
                <button
                    onClick={() => setShowDock(true)}
                    className="absolute bottom-3 right-3 z-40 btn btn-primary text-xs"
                >
                    Show Dock
                </button>
            )}

            <Modal
                isOpen={modalConfig.isOpen}
                onClose={() => setModalConfig((prev) => ({ ...prev, isOpen: false }))}
                onConfirm={modalConfig.onConfirm}
                title={modalConfig.title}
                message={modalConfig.message}
                type={modalConfig.type}
                confirmText={modalConfig.confirmText}
                cancelText={modalConfig.cancelText}
            />
        </div>
    );
}
