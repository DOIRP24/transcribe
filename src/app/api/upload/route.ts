import { NextRequest, NextResponse } from "next/server";
import { writeFile, mkdir } from "fs/promises";
import { join } from "path";
import { existsSync } from "fs";
import { createTask } from "@/lib/directus";
import { runGeminiTranscription } from "@/lib/transcribe";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

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

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

export async function POST(request: NextRequest) {
  const directusUrl = process.env.DIRECTUS_URL;
  const directusToken = process.env.DIRECTUS_TOKEN;
  if (!directusUrl?.trim() || !directusToken?.trim()) {
    return jsonError("Сервис не настроен: не заданы DIRECTUS_URL или DIRECTUS_TOKEN", 503);
  }
  try {
    const formData = await request.formData();
    const file = formData.get("audio") as File | null;

    if (!file) {
      return jsonError("No audio file provided", 400);
    }

    if (file.size > MAX_FILE_SIZE) {
      return jsonError("File size exceeds 20MB limit", 400);
    }

    const ext = "." + (file.name.split(".").pop()?.toLowerCase() || "");
    if (!ALLOWED_EXTENSIONS.includes(ext)) {
      return jsonError(`Unsupported format. Allowed: ${ALLOWED_EXTENSIONS.join(", ")}`, 400);
    }

    const tempDir = join(process.cwd(), "temp_uploads");
    if (!existsSync(tempDir)) {
      await mkdir(tempDir, { recursive: true });
    }

    const uniqueName = `${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`;
    const tempFilePath = join(tempDir, uniqueName);
    const buffer = Buffer.from(await file.arrayBuffer());
    await writeFile(tempFilePath, buffer);

    const mimeType = getMimeType(file.name);

    const { data: task } = await createTask({
      file_name: file.name,
      file_path: tempFilePath,
      mime_type: mimeType,
      status: "processing",
    });

    runGeminiTranscription(task.id, tempFilePath, file.name, mimeType).catch((e) =>
      console.error("Background transcription error:", e)
    );

    return NextResponse.json({ task_id: task.id });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("Upload error:", error);
    return jsonError(message || "Unknown error", 500);
  }
}
