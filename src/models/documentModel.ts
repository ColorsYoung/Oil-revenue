export interface DocumentMetadata {
    id?: string;
    sourceFileName: string;
    processedAt: Date;
    documentType: string;
    modelName?: string;
    modelDescription?: string;
    classifierUsed?: string;
    containerSource: string;
    status?: 'pending' | 'classified' | 'ocr-completed' | 'error';
    pageNumber?: number;
}

export interface ExtractedField {
    name: string;
    value: string | number | boolean | null;
    confidence?: number;
}

export interface ClassificationResult {
    documentType: string;
    confidence?: number;
    fields?: Record<string, any>;
}

export interface OCRResult {
    extractedText?: string;
    pages?: Array<{
        pageNumber: number;
        text: string;
    }>;
    rawResult?: any;
}

export interface DocumentData {
    metadata: DocumentMetadata;
    classification?: ClassificationResult;
    ocrResult?: OCRResult;
    extractedFields?: ExtractedField[];
    rawData?: any;
}

export interface ProcessingError {
    id?: string;
    documentId: string;
    errorMessage: string;
    errorType: string;
    stage: 'classification' | 'ocr' | 'preprocessing';
    timestamp: Date;
}