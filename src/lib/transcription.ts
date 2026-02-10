import { GoogleGenAI } from "@google/genai";
import { writeFile, unlink, mkdir } from "fs/promises";
import { join } from "path";
import { existsSync } from "fs";
import { prisma } from "./db";

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

export type TranscriptionSegment = {
  start: number; // seconds
  end: number;
  speaker?: string;
  text: string;
};

export type TranscriptionResult = {
  segments: TranscriptionSegment[];
  summary?: string;
  language?: string;
  speakersCount?: number;
};

export async function runTranscription(taskId: string) {
  const startTime = Date.now();
  const task = await prisma.transcriptionTask.findUnique({ where: { id: taskId } });
  if (!task || task.status !== "processing" || !task.filePath) return;

  let tempFilePath: string | null = task.filePath;
  let geminiFileName: string | null = null;
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    await prisma.transcriptionTask.update({
      where: { id: taskId },
      data: { status: "failed", errorMessage: "GEMINI_API_KEY not configured" },
    });
    return;
  }

  const ai = new GoogleGenAI({ apiKey });

  try {
    const ext = task.fileName.toLowerCase().split(".").pop() || "";
    const mimeType = getMimeType(task.fileName);

    const uploadResult = await ai.files.upload({
      file: tempFilePath,
      config: { mimeType, displayName: task.fileName },
    });
    geminiFileName = uploadResult.name!;

    let currentFile = await ai.files.get({ name: geminiFileName });
    let attempts = 0;
    while (currentFile.state === "PROCESSING" && attempts < 60) {
      await new Promise((r) => setTimeout(r, 2000));
      currentFile = await ai.files.get({ name: geminiFileName });
      attempts++;
    }

    if (currentFile.state === "FAILED") {
      throw new Error("File processing failed in Gemini API");
    }
    if (currentFile.state !== "ACTIVE") {
      throw new Error("File processing timed out");
    }

    const prompt = `Transcribe this audio precisely. Return a valid JSON object (no markdown) with:
{
  "segments": [
    { "start": <seconds>, "end": <seconds>, "speaker": "Speaker A", "text": "..." }
  ],
  "summary": "Brief summary in the audio language",
  "language": "detected language code",
  "speakersCount": <number>
}
Include timestamps for each sentence. Use seconds as numbers.`;

    const result = await ai.models.generateContent({
      model: "models/gemini-2.0-flash",
      contents: [
        {
          role: "user",
          parts: [
            {
              fileData: {
                fileUri: uploadResult.uri!,
                mimeType: uploadResult.mimeType!,
              },
            },
            { text: prompt },
          ],
        },
      ],
    });

    const text = result.text;
    let parsed: TranscriptionResult;
    try {
      const jsonMatch = text?.match(/\{[\s\S]*\}/);
      parsed = JSON.parse(jsonMatch?.[0] ?? "{}") as TranscriptionResult;
    } catch {
      parsed = {
        segments: [{ start: 0, end: 0, text: text ?? "" }],
        summary: "",
      };
    }

    const processedSeconds = Math.round((Date.now() - startTime) / 1000);

    await prisma.transcriptionTask.update({
      where: { id: taskId },
      data: {
        status: "completed",
        result: parsed as unknown as Record<string, unknown>,
        language: parsed.language ?? undefined,
        speakersCount: parsed.speakersCount ?? undefined,
        processedAt: new Date(processedSeconds * 1000),
        filePath: null,
      },
    });

    try {
      await ai.files.delete({ name: geminiFileName });
    } catch {}
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    await prisma.transcriptionTask.update({
      where: { id: taskId },
      data: { status: "failed", errorMessage: msg, filePath: null },
    });
  } finally {
    if (tempFilePath && existsSync(tempFilePath)) {
      try {
        await unlink(tempFilePath);
      } catch {}
    }
  }
}
