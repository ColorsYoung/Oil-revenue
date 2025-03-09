import { app, InvocationContext } from "@azure/functions";
import * as dotenv from "dotenv";
import {
    DocumentAnalysisClient,
    AzureKeyCredential
} from "@azure/ai-form-recognizer";
import { BlobServiceClient } from "@azure/storage-blob";
import { CosmosClient } from "@azure/cosmos";

dotenv.config();

// Mapping สำหรับโมเดลต่างๆ
const MODEL_MAPPING = {
    'oil-01-29-page-1-model-preview': {
        type: 'page-1-01-29',
        description: 'First page of January 29 document',
        pageNumber: 1
    },
    'oil-01-29-page-1': {
        type: 'page-1-01-29-full',
        description: 'Full first page of January 29 document',
        pageNumber: 1
    },
    'oil-03-07-page-1-model-preview': {
        type: 'page-1-03-07',
        description: 'First page of March 07 document',
        pageNumber: 1
    },
    'oil-03-07-page-1': {
        type: 'page-1-03-07-full',
        description: 'Full first page of March 07 document',
        pageNumber: 1
    },
    'oil-03-07-page-2-model-preview': {
        type: 'page-2-03-07',
        description: 'Second page of March 07 document',
        pageNumber: 2
    },
    'oil-03-07-page-2': {
        type: 'page-2-03-07-full',
        description: 'Full second page of March 07 document',
        pageNumber: 2
    }
};

export async function classifyDocumentHandler(blob: unknown, context: InvocationContext): Promise<void> {
    const fileName = context.triggerMetadata?.name as string;
    
    try {
        // Verbose Logging
        context.log('🔍 Classification Start');
        context.log(`Processing file: ${fileName}`);
        context.log(`Classifier Model: ${process.env.FORM_RECOGNIZER_MODEL_ID}`);

        // Log Environment Details
        context.log(`Environment Details:
            - Endpoint: ${process.env.DOCUMENT_INTELLIGENCE_ENDPOINT}
            - Storage Connection: ${process.env.AZURE_STORAGE_CONNECTION_STRING ? 'Configured' : 'Not Set'}
            - Cosmos Endpoint: ${process.env.COSMOS_ENDPOINT}
        `);

        // Initialize clients with error handling
        const documentClient = new DocumentAnalysisClient(
            process.env.DOCUMENT_INTELLIGENCE_ENDPOINT!,
            new AzureKeyCredential(process.env.DOCUMENT_INTELLIGENCE_KEY!)
        );

        const blobServiceClient = BlobServiceClient.fromConnectionString(
            process.env.AZURE_STORAGE_CONNECTION_STRING!
        );

        // Detailed Blob Retrieval
        const splittedContainerClient = blobServiceClient.getContainerClient("splitted");
        const blobClient = splittedContainerClient.getBlobClient(fileName);

        // Check Blob Existence
        const blobExists = await blobClient.exists();
        if (!blobExists) {
            context.log(`❌ Blob ${fileName} does not exist in splitted container`);
            return;
        }

        // Download Blob with Detailed Logging
        const downloadResponse = await blobClient.download();
        const fileStream = downloadResponse.readableStreamBody;

        if (!fileStream) {
            context.log('❌ Cannot download blob stream');
            throw new Error('Blob download failed');
        }

        // Convert to Buffer with Detailed Logging
        const chunks = [];
        for await (const chunk of fileStream) {
            chunks.push(chunk);
        }
        const fileBuffer = Buffer.concat(chunks);

        context.log(`📊 Blob Details:
            - Size: ${fileBuffer.length} bytes
            - First 50 bytes: ${fileBuffer.slice(0, 50).toString('hex')}
        `);

        // Extensive Error Handling for Document Intelligence
        try {
            // ใช้ classifyDocument แทน analyzeDocument
            const poller = await documentClient.beginClassifyDocument(
                process.env.FORM_RECOGNIZER_MODEL_ID!, 
                fileBuffer
            );

            const result = await poller.pollUntilDone();

            // Log Full Result Structure เพื่อดูโครงสร้างข้อมูลจริง
            context.log('📄 Full Classification Result:', JSON.stringify(result, null, 2));

            // แก้ไขการเข้าถึง properties โดยตรวจสอบโครงสร้างที่ถูกต้อง
            let docType = "unknown";
            let confidence = 0;

            // แปลง result เป็น any เพื่อหลีกเลี่ยง TypeScript error
            const resultAny = result as any;

            // ตรวจสอบโครงสร้างที่เป็นไปได้ของ result
            if (resultAny.documents && resultAny.documents.length > 0) {
                // กรณีมี documents array
                const firstDoc = resultAny.documents[0];
                docType = firstDoc.docType || "unknown";
                confidence = firstDoc.confidence || 0;
                context.log(`Found docType in documents[0]: ${docType}`);
            } else if (resultAny.classification) {
                // กรณีมี classification object
                docType = resultAny.classification.docType || "unknown";
                confidence = resultAny.classification.confidence || 0;
                context.log(`Found docType in classification: ${docType}`);
            } else if (resultAny.docType) {
                // กรณีมี docType โดยตรง
                docType = resultAny.docType;
                confidence = resultAny.confidence || 0;
                context.log(`Found docType directly: ${docType}`);
            } else {
                // ไม่พบ docType ในรูปแบบที่คาดหวัง
                context.log(`⚠️ Could not find docType in result structure, using default: ${docType}`);
                
                // พยายามค้นหาแบบเจาะลึก (recursive)
                const findProperty = (obj: any, propName: string): any => {
                    if (!obj || typeof obj !== 'object') return undefined;
                    
                    if (propName in obj) return obj[propName];
                    
                    for (const key in obj) {
                        const found = findProperty(obj[key], propName);
                        if (found !== undefined) return found;
                    }
                    
                    return undefined;
                };
                
                const foundDocType = findProperty(resultAny, 'docType');
                const foundConfidence = findProperty(resultAny, 'confidence');
                
                if (foundDocType) {
                    docType = foundDocType;
                    context.log(`Found docType in nested structure: ${docType}`);
                }
                
                if (foundConfidence !== undefined) {
                    confidence = foundConfidence;
                    context.log(`Found confidence in nested structure: ${confidence}`);
                }
            }
            
            // สร้าง documentData object
            const documentData = {
                id: `${fileName}-${new Date().getTime()}`,
                fileName: fileName,
                classificationResult: {
                    docType: docType,
                    confidence: confidence,
                    modelId: process.env.FORM_RECOGNIZER_MODEL_ID,
                    classifiedAt: new Date().toISOString(),
                    rawResult: result // เก็บผลลัพธ์ดิบไว้เพื่อการตรวจสอบ
                },
                metadata: {
                    originalSize: fileBuffer.length,
                    processedAt: new Date().toISOString(),
                    source: "splitted-container"
                }
            };
            
            // บันทึกข้อมูลลง Cosmos DB
            try {
                const cosmosClient = new CosmosClient({
                    endpoint: process.env.COSMOS_ENDPOINT!,
                    key: process.env.COSMOS_KEY!
                });
                
                const container = cosmosClient
                    .database(process.env.COSMOS_DATABASE_ID!)
                    .container(process.env.COSMOS_CONTAINER_ID!);
                
                await container.items.create(documentData);
                context.log(`✅ Document data saved to Cosmos DB: ${documentData.id}`);
                
                // ย้ายไฟล์ไปยัง container ตามประเภทเอกสาร
                const destContainerName = `classified-${docType.toLowerCase()}`;
                
                try {
                    // ตรวจสอบว่า container ปลายทางมีอยู่หรือไม่
                    const destContainerClient = blobServiceClient.getContainerClient(destContainerName);
                    const containerExists = await destContainerClient.exists();
                    
                    if (!containerExists) {
                        // สร้าง container ใหม่ถ้ายังไม่มี
                        await destContainerClient.create();
                        context.log(`Created new container: ${destContainerName}`);
                    }
                    
                    // อัปโหลดไฟล์ไปยัง container ปลายทาง
                    const destBlobClient = destContainerClient.getBlockBlobClient(fileName);
                    await destBlobClient.uploadData(fileBuffer);
                    context.log(`Moved file to classified container: ${destContainerName}/${fileName}`);
                    
                    // ลบไฟล์ต้นฉบับออกจาก splitted container
                    await blobClient.delete();
                    context.log(`Deleted original file from splitted container: ${fileName}`);
                    
                } catch (storageError) {
                    context.error(`❌ Error moving file to classified container: ${storageError.message}`);
                }
                
            } catch (cosmosError) {
                context.error(`❌ Error saving to Cosmos DB: ${cosmosError.message}`);
                throw cosmosError;
            }

        } catch (analysisError) {
            // Comprehensive Error Logging
            context.error('❌ Document Intelligence Analysis Error', {
                errorName: analysisError.name,
                errorMessage: analysisError.message,
                errorCode: analysisError.code,
                errorStack: analysisError.stack
            });

            // Additional Error Handling
            if (analysisError.response) {
                context.error('Response Details:', {
                    status: analysisError.response.status,
                    body: analysisError.response.body
                });
            }

            throw analysisError;
        }

    } catch (error) {
        // Global Error Handling
        context.error('🚨 Unexpected Classification Error', {
            fileName,
            errorName: error.name,
            errorMessage: error.message,
            errorStack: error.stack
        });

        // Optional: Log to Cosmos DB or other error tracking
        try {
            const cosmosClient = new CosmosClient({
                endpoint: process.env.COSMOS_ENDPOINT!,
                key: process.env.COSMOS_KEY!
            });

            const errorContainer = cosmosClient
                .database(process.env.COSMOS_DATABASE_ID!)
                .container('processing-errors');

            await errorContainer.items.create({
                documentId: fileName,
                errorDetails: {
                    name: error.name,
                    message: error.message,
                    stack: error.stack
                },
                processedAt: new Date(),
                stage: 'classification'
            });
        } catch (loggingError) {
            context.error('Error logging to Cosmos DB', loggingError);
        }
    }
}

// ลงทะเบียนฟังก์ชันด้วย programming model ใหม่
app.storageBlob("classifyDocument", {
    path: "splitted/{name}",
    connection: "AzureWebJobsStorage",
    handler: classifyDocumentHandler
});