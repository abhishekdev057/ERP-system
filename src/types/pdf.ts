export interface QuestionOption {
    hindi: string;
    english: string;
}

export interface Question {
    number: string;
    questionHindi: string;
    questionEnglish: string;
    options: QuestionOption[];
}

export interface PdfData {
    title: string;
    date: string;
    subject?: string;
    instituteName: string;
    questions: Question[];
    templateId?: string;
}

export interface PdfInput {
    title: string;
    date: string;
    subject?: string;
    instituteName: string;
    questions: Question[];
    templateId?: string;
}
