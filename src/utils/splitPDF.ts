import * as fs from "fs/promises";
import { PDFDocument } from "pdf-lib";
import * as path from "path";
import * as os from "os";

export async function splitPDF(filePath: string, fileName: string, context: any) {
  try {
    context.log(`Starting to split PDF: ${fileName}`);
    const pdfBytes = await fs.readFile(filePath);
    
    // ตรวจสอบ PDF header
    if (pdfBytes.length < 5 || pdfBytes.toString('ascii', 0, 5) !== '%PDF-') {
      throw new Error("Invalid PDF format: No PDF header found");
    }
    
    // ใช้ options เพื่อลดความเข้มงวดในการตรวจสอบ
    const pdfDoc = await PDFDocument.load(pdfBytes, { 
      ignoreEncryption: true,
      throwOnInvalidObject: false,
      updateMetadata: false
    });
    
    const numPages = pdfDoc.getPages().length;
    context.log(`PDF has ${numPages} pages`);
    
    const outputFolder = path.join(os.tmpdir(), path.parse(fileName).name);
    await fs.mkdir(outputFolder, { recursive: true });

    const pages = [];
    for (let i = 0; i < numPages; i++) {
      context.log(`Processing page ${i + 1} of ${numPages}`);
      
      try {
        const newDoc = await PDFDocument.create();
        const [copiedPage] = await newDoc.copyPages(pdfDoc, [i]);
        newDoc.addPage(copiedPage);

        const outputBytes = await newDoc.save();
        const newFileName = `page-${i + 1}_${fileName}`;
        pages.push({ fileName: newFileName, data: outputBytes });
        context.log(`Generated: ${newFileName}`);
      } catch (pageError) {
        context.error(`Error processing page ${i + 1}: ${pageError instanceof Error ? pageError.message : String(pageError)}`);
        // ข้ามหน้าที่มีปัญหาและดำเนินการต่อ
        continue;
      }
    }

    // ล้างไฟล์ชั่วคราว
    try {
      await fs.rm(outputFolder, { recursive: true, force: true });
      context.log(`Temporary folder cleaned: ${outputFolder}`);
    } catch (cleanupError) {
      context.log(`Warning: Could not clean temporary folder: ${cleanupError instanceof Error ? cleanupError.message : String(cleanupError)}`);
    }

    if (pages.length === 0) {
      throw new Error("Could not extract any pages from the PDF");
    }

    return pages;
  } catch (error) {
    context.error(`Error splitting PDF: ${error instanceof Error ? error.message : String(error)}`);
    throw error;
  }
}