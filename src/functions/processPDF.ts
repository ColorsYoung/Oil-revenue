import { app, InvocationContext } from "@azure/functions";
import * as dotenv from "dotenv";
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import { splitPDF } from "../utils/splitPDF";
import { uploadToBlob, deleteFromBlob } from "../utils/storage";

dotenv.config();

export async function processPDFHandler(blob: unknown, context: InvocationContext): Promise<void> {
    try {
        context.log("🚀 Function triggered!");

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

        context.log(`📂 Processing file: ${fileName}`);

        // ตรวจสอบว่าเป็นไฟล์ PDF ที่ถูกต้องหรือไม่
        if (fileData.length < 5 || fileData.toString('ascii', 0, 5) !== '%PDF-') {
            context.error(`File is not a valid PDF: ${fileName}`);

            try {
                // ย้ายไฟล์ไปยัง container สำหรับไฟล์ที่ไม่ถูกต้อง
                await uploadToBlob("invalid-files", fileName, fileData);
                context.log(`Moved invalid file to invalid-files container: ${fileName}`);
            } catch (uploadError) {
                context.error(`Failed to move invalid file: ${uploadError instanceof Error ? uploadError.message : String(uploadError)}`);
            }

            return;
        }

        try {
            // สำรองไฟล์ต้นฉบับไปยัง container "backup"
            await uploadToBlob("backup", fileName, fileData);
            context.log(`Backed up original file to backup container: ${fileName}`);
        } catch (backupError) {
            context.error(`Failed to backup original file: ${backupError instanceof Error ? backupError.message : String(backupError)}`);
            // ดำเนินการต่อแม้การสำรองจะล้มเหลว
        }

        // ดำเนินการต่อเมื่อเป็น PDF ที่ถูกต้องเท่านั้น
        const tmpdir = os.tmpdir();
        const filePath = path.join(tmpdir, fileName);

        try {
            await fs.writeFile(filePath, fileData);
        } catch (writeError) {
            context.error(`Error writing file to temp directory: ${writeError instanceof Error ? writeError.message : String(writeError)}`);
            return;
        }

        try {
            // แยกหน้า PDF และอัปโหลดไปที่ splitted container
            const pages = await splitPDF(filePath, fileName, context);
            context.log(`Successfully split PDF into ${pages.length} pages`);

            for (const page of pages) {
                await uploadToBlob("splitted", page.fileName, Buffer.from(page.data));
                context.log(`Uploaded: ${page.fileName}`);
            }

            // ลบไฟล์ต้นฉบับออกจาก container "input" หลังประมวลผลเสร็จ
            try {
                const deleted = await deleteFromBlob("input", fileName);
                if (deleted) {
                    context.log(`Deleted original file from input container: ${fileName}`);
                } else {
                    context.log(`Original file ${fileName} not found in input container`);
                }
            } catch (deleteError) {
                context.error(`Failed to delete original file: ${deleteError instanceof Error ? deleteError.message : String(deleteError)}`);
            }
        } catch (processingError) {
            context.error(`Error processing PDF: ${processingError instanceof Error ? processingError.message : String(processingError)}`);
        } finally {
            // ล้างไฟล์ชั่วคราวไม่ว่าจะสำเร็จหรือไม่
            try {
                await fs.unlink(filePath);
                context.log(`Removed temporary file: ${filePath}`);
            } catch (cleanupError) {
                context.log(`Warning: Could not remove temporary file: ${cleanupError instanceof Error ? cleanupError.message : String(cleanupError)}`);
            }
        }

        context.log(`✅ Processing completed for: ${fileName}`);
    } catch (error) {
        context.error(`❌ Error processing file: ${error instanceof Error ? error.message : String(error)}`);
    }
}

// ลงทะเบียนฟังก์ชันด้วย programming model ใหม่
app.storageBlob("processPDF", {
    path: "input/{name}",
    connection: "AzureWebJobsStorage",
    handler: processPDFHandler
});