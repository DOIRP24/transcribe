import { NextRequest, NextResponse } from "next/server";
import { GoogleGenAI } from "@google/genai";
import { writeFile, unlink, mkdir } from "fs/promises";
import { join } from "path";
import { existsSync } from "fs";

const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20MB
const ALLOWED_EXTENSIONS = [".mp3", ".wav", ".m4a", ".ogg", ".webm"];

function getMimeType(fileName: string): string {
  const ext = fileName.toLowerCase().split(".").pop();
  const mimeMap: Record<string, string> = {
    mp3: "audio/mpeg",
    wav: "audio/wav",
    m4a: "audio/mp4",
    ogg: "audio/ogg",
    webm: "audio/webm",
  };
  return mimeMap[ext || ""] || "audio/mpeg";
}

export async function POST(request: NextRequest) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "GEMINI_API_KEY is not configured" }, { status: 500 });
  }

  let tempFilePath: string | null = null;
  let geminiFileName: string | null = null;
  const ai = new GoogleGenAI({ apiKey });

  try {
    const formData = await request.formData();
    const file = formData.get("audio") as File | null;

    if (!file) {
      return NextResponse.json({ error: "No audio file provided" }, { status: 400 });
    }

    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json({ error: "File size exceeds 20MB limit" }, { status: 400 });
    }

    const ext = "." + (file.name.split(".").pop()?.toLowerCase() || "");
    if (!ALLOWED_EXTENSIONS.includes(ext)) {
      return NextResponse.json(
        { error: `Unsupported format. Allowed: ${ALLOWED_EXTENSIONS.join(", ")}` },
        { status: 400 }
      );
    }

    // Save to temp directory
    const tempDir = join(process.cwd(), "temp_uploads");
    if (!existsSync(tempDir)) {
      await mkdir(tempDir, { recursive: true });
    }

    const uniqueName = `${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`;
    tempFilePath = join(tempDir, uniqueName);

    const buffer = Buffer.from(await file.arrayBuffer());
    await writeFile(tempFilePath, buffer);

    // Upload to Gemini File API
    const mimeType = getMimeType(file.name);

    const uploadResult = await ai.files.upload({
      file: tempFilePath,
      config: { mimeType, displayName: file.name },
    });

    geminiFileName = uploadResult.name!;

    // Wait for file to be processed
    let currentFile = await ai.files.get({ name: geminiFileName });
    let attempts = 0;
    while (currentFile.state === "PROCESSING" && attempts < 60) {
      await new Promise((resolve) => setTimeout(resolve, 2000));
      currentFile = await ai.files.get({ name: geminiFileName });
      attempts++;
    }

    if (currentFile.state === "FAILED") {
      throw new Error("File processing failed in Gemini API");
    }

    if (currentFile.state !== "ACTIVE") {
      throw new Error("File processing timed out");
    }

    // Generate transcription
    const prompt = `Проведи точную транскрибацию аудио. Раздели спикеров (Speaker A, Speaker B и т.д.). Укажи таймкоды в формате [MM:SS]. В конце сделай Summary встречи на языке аудио.

Формат ответа:
[MM:SS] Speaker X: текст

---
Summary:
(краткое содержание)`;

    const result = await ai.models.generateContent({
      model: "gemini-2.0-flash",
      contents: [
        {
          role: "user",
          parts: [
            { fileData: { fileUri: uploadResult.uri!, mimeType: uploadResult.mimeType! } },
            { text: prompt },
          ],
        },
      ],
    });

    const transcription = result.text;

    // Cleanup: delete from Gemini
    try {
      await ai.files.delete({ name: geminiFileName });
    } catch {
      // Non-critical
    }

    // Cleanup: delete temp file
    try {
      if (tempFilePath) await unlink(tempFilePath);
    } catch {
      // Non-critical
    }

    return NextResponse.json({ transcription });
  } catch (error: unknown) {
    // Cleanup on error
    if (tempFilePath) {
      try { await unlink(tempFilePath); } catch { /* ignore */ }
    }
    if (geminiFileName) {
      try {
        await ai.files.delete({ name: geminiFileName });
      } catch { /* ignore */ }
    }

    const message = error instanceof Error ? error.message : "Unknown error occurred";

    if (message.includes("429") || message.includes("RESOURCE_EXHAUSTED")) {
      return NextResponse.json({ error: "API rate limit exceeded. Please try again later." }, { status: 429 });
    }

    console.error("Transcription error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
