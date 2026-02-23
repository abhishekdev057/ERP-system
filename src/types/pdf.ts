export interface QuestionOption {
    hindi: string;
    english: string;
}

export type OptionDisplayOrder = "hindi-first" | "english-first";

export interface Question {
    number: string;
    questionHindi: string;
    questionEnglish: string;
    options: QuestionOption[];
    sourceImagePath?: string;
    sourceImageName?: string;
    diagramImagePath?: string;
    diagramCaptionHindi?: string;
    diagramCaptionEnglish?: string;
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
