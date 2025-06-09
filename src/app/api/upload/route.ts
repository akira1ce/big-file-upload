import { NextRequest, NextResponse } from 'next/server';

import { promises as fs } from 'fs';
import path from 'path';
import SparkMD5 from 'spark-md5';

// File storage directory
const UPLOAD_DIR = path.resolve(process.cwd(), 'files');
const CHUNK_DIR = path.resolve(UPLOAD_DIR, 'chunks');
const COMPLETE_DIR = path.resolve(UPLOAD_DIR, 'complete');

// Ensure directories exist
async function ensureDirectories() {
  await fs.mkdir(UPLOAD_DIR, { recursive: true });
  await fs.mkdir(CHUNK_DIR, { recursive: true });
  await fs.mkdir(COMPLETE_DIR, { recursive: true });
}

// Calculate MD5 hash of a file using SparkMD5
async function calculateMD5(filePath: string): Promise<string> {
  const fileBuffer = await fs.readFile(filePath);
  const spark = new SparkMD5.ArrayBuffer();
  spark.append(fileBuffer as unknown as ArrayBuffer);
  return spark.end();
}

// Check if file already exists by hash
async function checkFileExists(hash: string): Promise<string | null> {
  try {
    const hashFilePath = path.join(UPLOAD_DIR, 'hashes.json');
    let hashMap: Record<string, string> = {};

    try {
      const hashData = await fs.readFile(hashFilePath, 'utf-8');
      hashMap = JSON.parse(hashData);
    } catch (error) {
      // File doesn't exist yet, will be created later
    }

    return hashMap[hash] || null;
  } catch (error) {
    console.error('Error checking file existence:', error);
    return null;
  }
}

// Save file hash mapping
async function saveFileHash(hash: string, filename: string) {
  const hashFilePath = path.join(UPLOAD_DIR, 'hashes.json');
  let hashMap: Record<string, string> = {};

  try {
    const hashData = await fs.readFile(hashFilePath, 'utf-8');
    hashMap = JSON.parse(hashData);
  } catch (error) {
    // File doesn't exist yet
  }

  hashMap[hash] = filename;
  await fs.writeFile(hashFilePath, JSON.stringify(hashMap, null, 2));
}

// Verify chunk upload
export async function GET(request: NextRequest) {
  console.log('request :>> ', request);
  try {
    await ensureDirectories();

    const { searchParams } = new URL(request.url);
    const fileHash = searchParams.get('hash');
    const filename = searchParams.get('filename');
    const chunkIndex = searchParams.get('chunkIndex');

    if (!fileHash || !filename) {
      return NextResponse.json({ error: 'Missing required parameters' }, { status: 400 });
    }

    // Check if file already exists (for fast upload)
    if (!chunkIndex) {
      const existingFile = await checkFileExists(fileHash);
      if (existingFile) {
        return NextResponse.json({
          exists: true,
          url: `/files/complete/${path.basename(existingFile)}`,
        });
      }

      // Return list of existing chunks for this file
      const chunkDir = path.join(CHUNK_DIR, fileHash);
      try {
        const files = await fs.readdir(chunkDir);
        const uploadedChunks = files.map((file) => parseInt(file.split('.')[0]));
        return NextResponse.json({
          exists: false,
          uploadedChunks,
        });
      } catch (error) {
        // Directory doesn't exist yet, no chunks uploaded
        return NextResponse.json({
          exists: false,
          uploadedChunks: [],
        });
      }
    }

    // Check if specific chunk exists
    const chunkDir = path.join(CHUNK_DIR, fileHash);
    try {
      await fs.access(path.join(chunkDir, `${chunkIndex}.chunk`));
      return NextResponse.json({ exists: true });
    } catch (error) {
      return NextResponse.json({ exists: false });
    }
  } catch (error) {
    console.error('Error processing request:', error);
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
}

// Handle file upload
export async function POST(request: NextRequest) {
  try {
    await ensureDirectories();

    const formData = await request.formData();
    const file = formData.get('file') as File;
    const fileHash = formData.get('hash') as string;
    const filename = formData.get('filename') as string;
    const chunkIndex = parseInt(formData.get('chunkIndex') as string);
    const chunks = parseInt(formData.get('chunks') as string);

    if (!file || !fileHash || !filename || isNaN(chunkIndex) || isNaN(chunks)) {
      return NextResponse.json({ error: 'Missing required parameters' }, { status: 400 });
    }

    // Create directory for chunks if it doesn't exist
    const chunkDir = path.join(CHUNK_DIR, fileHash);
    await fs.mkdir(chunkDir, { recursive: true });

    // Save this chunk
    const chunkPath = path.join(chunkDir, `${chunkIndex}.chunk`);
    const buffer = Buffer.from(await file.arrayBuffer());
    await fs.writeFile(chunkPath, buffer);

    // Check if all chunks are uploaded
    const files = await fs.readdir(chunkDir);

    if (files.length === chunks) {
      // All chunks uploaded, merge them
      const finalPath = path.join(COMPLETE_DIR, filename);
      const writeStream = await fs.open(finalPath, 'w');

      // Merge chunks in order
      for (let i = 0; i < chunks; i++) {
        const chunkContent = await fs.readFile(path.join(chunkDir, `${i}.chunk`));
        await writeStream.write(chunkContent);
      }

      await writeStream.close();

      // Calculate hash of the complete file and verify using SparkMD5
      const fileActualHash = await calculateMD5(finalPath);

      if (fileActualHash !== fileHash) {
        // Hash mismatch, delete the file
        await fs.unlink(finalPath);
        return NextResponse.json(
          {
            error: 'File hash mismatch, upload failed',
          },
          { status: 400 },
        );
      }

      // Save hash mapping for future fast uploads
      await saveFileHash(fileHash, filename);

      // Clean up chunks
      for (const file of files) {
        await fs.unlink(path.join(chunkDir, file));
      }
      await fs.rmdir(chunkDir);

      return NextResponse.json({
        success: true,
        url: `/files/complete/${filename}`,
        message: 'File uploaded successfully',
      });
    }

    return NextResponse.json({
      success: true,
      message: `Chunk ${chunkIndex + 1}/${chunks} uploaded successfully`,
    });
  } catch (error) {
    console.error('Error processing upload:', error);
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
}
