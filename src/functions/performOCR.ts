import { app, InvocationContext } from "@azure/functions";
import * as dotenv from "dotenv";
import { 
  DocumentAnalysisClient, 
  AzureKeyCredential 
} from "@azure/ai-form-recognizer";
import { BlobServiceClient } from "@azure/storage-blob";
import { CosmosClient } from "@azure/cosmos";

dotenv.config();

export async function performOCRHandler(blob: unknown, context: InvocationContext): Promise<void> {
    try {
        context.log("📝 OCR Process Triggered!");

        // แปลง blob เป็น Buffer
        let fileData: Buffer;
        if (Buffer.isBuffer(blob)) {
            fileData = blob;
        } else if (typeof blob === "string") {
            fileData = Buffer.from(blob, "utf-8");
        } else {
            try {
                fileData = Buffer.from(blob as any);
            } catch (error) {
                context.error(`Cannot convert blob to Buffer: ${error instanceof Error ? error.message : String(error)}`);
                return;
            }
        }

        const fileName = context.triggerMetadata?.name as string;
        if (!fileName) {
            context.error("Trigger metadata is missing the file name.");
            return;
        }

        context.log(`🔤 Performing OCR on document: ${fileName}`);

        // Initialize clients
        const documentClient = new DocumentAnalysisClient(
            process.env.DOCUMENT_INTELLIGENCE_ENDPOINT!,
            new AzureKeyCredential(process.env.DOCUMENT_INTELLIGENCE_KEY!)
        );

        const blobServiceClient = BlobServiceClient.fromConnectionString(
            process.env.AZURE_STORAGE_CONNECTION_STRING!
        );

        const cosmosClient = new CosmosClient({
            endpoint: process.env.COSMOS_ENDPOINT!,
            key: process.env.COSMOS_KEY!
        });

        try {
            // ดึงข้อมูลการจำแนกประเภทจาก Cosmos DB
            const cosmosContainer = cosmosClient
                .database(process.env.COSMOS_DATABASE_ID!)
                .container(process.env.COSMOS_CONTAINER_ID!);

            const { resource: classificationData } = await cosmosContainer
                .item(fileName, fileName)
                .read();

            if (!classificationData) {
                throw new Error(`No classification data found for ${fileName}`);
            }

            // ดึงไฟล์จาก Blob Storage
            const splittedContainerClient = blobServiceClient
                .getContainerClient("splitted");
            const blobClient = splittedContainerClient.getBlobClient(fileName);
            const downloadResponse = await blobClient.download();
            const fileStream = downloadResponse.readableStreamBody;

            if (!fileStream) {
                throw new Error('Cannot download blob');
            }

            // ดำเนินการ OCR ด้วยโมเดลที่เหมาะสม
            const poller = await documentClient.beginAnalyzeDocument(
                classificationData.selectedOcrModel, 
                fileStream
            );

            const result = await poller.pollUntilDone();

            // รวบรวมข้อความที่แยกได้
            const extractedText = result.pages.map(page => 
                page.lines.map(line => line.content).join('\n')
            ).join('\n\n');

            // อัปเดตข้อมูลใน Cosmos DB
            await cosmosContainer.item(fileName, fileName).replace({
                ...classificationData,
                ocrResult: result,
                extractedText,
                status: 'ocr-completed',
                processedAt: new Date()
            });

            context.log(`✅ OCR completed for document: ${fileName}`);

        } catch (processingError) {
            context.error(`❌ Error performing OCR: ${processingError instanceof Error ? processingError.message : String(processingError)}`);
            
            // บันทึก error ลง Cosmos DB
            const errorContainer = cosmosClient
                .database(process.env.COSMOS_DATABASE_ID!)
                .container('processing-errors');

            await errorContainer.items.create({
                documentId: fileName,
                errorMessage: processingError instanceof Error ? processingError.message : String(processingError),
                processedAt: new Date(),
                stage: 'ocr'
            });
        }
    } catch (error) {
        context.error(`❌ Unexpected error in OCR process: ${error instanceof Error ? error.message : String(error)}`);
    }
}

// ลงทะเบียนฟังก์ชันด้วย programming model ใหม่
app.storageBlob("performOCR", {
    path: "classified/{name}",
    connection: "AzureWebJobsStorage",
    handler: performOCRHandler
});