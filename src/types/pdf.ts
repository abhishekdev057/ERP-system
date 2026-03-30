import type { CustomPdfTemplateConfig, PdfTemplateId } from "@/lib/pdf-templates";

export interface QuestionOption {
    hindi: string;
    english: string;
}

export type OptionDisplayOrder = "hindi-first" | "english-first";
export type PreviewResolution = "default" | "1920x1080";
export type QuestionType =
    | "MCQ"
    | "FIB"
    | "MATCH_COLUMN"
    | "TRUE_FALSE"
    | "ASSERTION_REASON"
    | "NUMERICAL"
    | "SHORT_ANSWER"
    | "LONG_ANSWER"
    | "UNKNOWN";

export interface MatchColumnEntry {
    english: string;
    hindi: string;
}

export interface MatchColumns {
    left: MatchColumnEntry[];
    right: MatchColumnEntry[];
}

export interface ImageBounds {
    x: number;
    y: number;
    width: number;
    height: number;
}

export interface Question {
    clientId?: string;
    number: string;
    questionHindi: string;
    questionEnglish: string;
    options: QuestionOption[];
    answer?: string;
    solution?: string;
    solutionHindi?: string;
    solutionEnglish?: string;
    correctAnswer?: string;
    correctOption?: string;
    answerKey?: string;
    sourceImagePath?: string;
    sourceImageName?: string;
    diagramImagePath?: string;
    autoDiagramImagePath?: string;
    diagramDetected?: boolean;
    diagramBounds?: ImageBounds;
    questionBounds?: ImageBounds;
    questionType?: QuestionType;
    matchColumns?: MatchColumns;
    blankCount?: number;
    diagramCaptionHindi?: string;
    diagramCaptionEnglish?: string;
    extractionConfidence?: number;
}

export interface PdfData {
    title: string;
    date: string;
    subject?: string;
    instituteName: string;
    questions: Question[];
    templateId?: PdfTemplateId | string;
    customTemplate?: CustomPdfTemplateConfig;
    optionDisplayOrder?: OptionDisplayOrder;
    previewResolution?: PreviewResolution;
    includeAnswers?: boolean;
    sourceImages?: Array<{
        imagePath: string;
        imageName: string;
        originalImagePath?: string;
        questionCount: number;
        processed?: boolean;
        failed?: boolean;
        extractionError?: string;
        diagramCount?: number;
        extractionMode?: "original" | "enhanced";
        averageConfidence?: number;
        qualityIssues?: string[];
    }>;
}

export interface PdfInput {
    title: string;
    date: string;
    subject?: string;
    instituteName: string;
    questions: Question[];
    templateId?: PdfTemplateId | string;
    customTemplate?: CustomPdfTemplateConfig;
    optionDisplayOrder?: OptionDisplayOrder;
    previewResolution?: PreviewResolution;
    includeAnswers?: boolean;
    sourceImages?: Array<{
        imagePath: string;
        imageName: string;
        originalImagePath?: string;
        questionCount: number;
        processed?: boolean;
        failed?: boolean;
        extractionError?: string;
        diagramCount?: number;
        extractionMode?: "original" | "enhanced";
        averageConfidence?: number;
        qualityIssues?: string[];
    }>;
}
