export interface QuestionOption {
    hindi: string;
    english: string;
}

export type OptionDisplayOrder = "hindi-first" | "english-first";

export interface ImageBounds {
    x: number;
    y: number;
    width: number;
    height: number;
}

export interface Question {
    number: string;
    questionHindi: string;
    questionEnglish: string;
    options: QuestionOption[];
    sourceImagePath?: string;
    sourceImageName?: string;
    diagramImagePath?: string;
    autoDiagramImagePath?: string;
    diagramBounds?: ImageBounds;
    questionBounds?: ImageBounds;
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
    templateId?: string;
    optionDisplayOrder?: OptionDisplayOrder;
    sourceImages?: Array<{
        imagePath: string;
        imageName: string;
        questionCount: number;
    }>;
}

export interface PdfInput {
    title: string;
    date: string;
    subject?: string;
    instituteName: string;
    questions: Question[];
    templateId?: string;
    optionDisplayOrder?: OptionDisplayOrder;
    sourceImages?: Array<{
        imagePath: string;
        imageName: string;
        questionCount: number;
    }>;
}
