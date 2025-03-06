import { BlobServiceClient } from "@azure/storage-blob";
import * as dotenv from "dotenv";

dotenv.config();

const connectionString = process.env.AZURE_STORAGE_CONNECTION_STRING;
if (!connectionString) {
  throw new Error("AZURE_STORAGE_CONNECTION_STRING is not defined");
}

const blobServiceClient = BlobServiceClient.fromConnectionString(connectionString);

export async function uploadToBlob(containerName: string, fileName: string, fileBuffer: Buffer) {
  try {
    // ตรวจสอบว่า container มีอยู่หรือไม่
    const containerClient = blobServiceClient.getContainerClient(containerName);
    
    // สร้าง container ถ้าไม่มีอยู่
    await ensureContainerExists(containerName);
    
    const blockBlobClient = containerClient.getBlockBlobClient(fileName);
    console.log(`Uploading blob: ${fileName} to container: ${containerName}`);
    
    const uploadOptions = {
      blobHTTPHeaders: {
        blobContentType: fileName.toLowerCase().endsWith('.pdf') ? 'application/pdf' : 'application/octet-stream'
      }
    };
    
    const result = await blockBlobClient.uploadData(fileBuffer, uploadOptions);
    console.log(`Upload of ${fileName} completed. ETag: ${result.etag}`);
    
    return result;
  } catch (error) {
    console.error(`Error uploading ${fileName} to blob storage:`, error);
    throw error;
  }
}

// เพิ่มฟังก์ชันลบไฟล์จาก blob storage
export async function deleteFromBlob(containerName: string, fileName: string) {
  try {
    const containerClient = blobServiceClient.getContainerClient(containerName);
    const blockBlobClient = containerClient.getBlockBlobClient(fileName);
    
    console.log(`Deleting blob: ${fileName} from container: ${containerName}`);
    
    // ตรวจสอบว่าไฟล์มีอยู่หรือไม่ก่อนลบ
    const exists = await blockBlobClient.exists();
    if (exists) {
      await blockBlobClient.delete();
      console.log(`Deletion of ${fileName} completed successfully`);
      return true;
    } else {
      console.log(`File ${fileName} not found in container ${containerName}`);
      return false;
    }
  } catch (error) {
    console.error(`Error deleting ${fileName} from blob storage:`, error);
    throw error;
  }
}

// เพิ่มฟังก์ชันเพื่อตรวจสอบการมีอยู่ของ container ก่อนการใช้งาน
export async function ensureContainerExists(containerName: string) {
  try {
    const containerClient = blobServiceClient.getContainerClient(containerName);
    const exists = await containerClient.exists();
    
    if (!exists) {
      console.log(`Creating container: ${containerName}`);
      // เปลี่ยนวิธีการตรวจสอบผลลัพธ์การสร้าง container
      try {
        await containerClient.create();
        console.log(`Container ${containerName} created successfully`);
      } catch (error) {
        console.error(`Failed to create container ${containerName}:`, error);
        throw error;
      }
    }
    
    return containerClient;
  } catch (error) {
    console.error(`Error ensuring container exists: ${containerName}`, error);
    throw error;
  }
}

// เพิ่มฟังก์ชันสำหรับตรวจสอบไฟล์ PDF
export async function isPDFValid(fileBuffer: Buffer): Promise<boolean> {
  // ตรวจสอบว่ามี PDF header หรือไม่
  if (fileBuffer.length < 5) {
    return false;
  }
  
  const header = fileBuffer.toString('ascii', 0, 5);
  return header === '%PDF-';
}