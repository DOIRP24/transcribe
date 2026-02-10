/**
 * Нарезка аудио на чанки для длинных файлов (обход лимита выходных токенов Gemini).
 * Требует: npm install fluent-ffmpeg и установленный ffmpeg/ffprobe в системе.
 */
import { unlink } from "fs/promises";
import path from "path";

const CHUNK_DURATION_SEC = 600; // 10 минут — безопасный размер под лимит токенов

export type AudioMetadata = { durationSec: number };

function getFfmpeg(): typeof import("fluent-ffmpeg") | null {
  try {
    return require("fluent-ffmpeg") as typeof import("fluent-ffmpeg");
  } catch {
    return null;
  }
}

/** Длительность аудио в секундах. Если ffprobe недоступен — null. */
export async function getAudioDuration(filePath: string): Promise<number | null> {
  const ffmpeg = getFfmpeg();
  if (!ffmpeg) return null;
  return new Promise((resolve) => {
    ffmpeg.ffprobe(filePath, (err, metadata) => {
      if (err) {
        console.warn("ffprobe error:", err.message);
        resolve(null);
        return;
      }
      const dur = metadata?.format?.duration;
      resolve(typeof dur === "number" && dur > 0 ? dur : null);
    });
  });
}

/** Сдвиг таймкода HH:MM:SS на offsetSec секунд. */
export function addOffsetToTimestamp(timeStr: string, offsetSec: number): string {
  const parts = timeStr.trim().split(":").map(Number);
  const [h = 0, m = 0, s = 0] = parts;
  const totalSeconds = h * 3600 + m * 60 + s + offsetSec;
  const newH = Math.floor(totalSeconds / 3600);
  const newM = Math.floor((totalSeconds % 3600) / 60);
  const newS = Math.floor(totalSeconds % 60);
  return [newH, newM, newS].map((n) => String(n).padStart(2, "0")).join(":");
}

/**
 * Нарезает аудио на чанки по CHUNK_DURATION_SEC.
 * Возвращает пути к временным файлам чанков. Исходный файл не удаляется.
 * Если длительность получить не удалось или файл короче одного чанка — возвращает [originalPath].
 */
export async function splitAudioIntoChunks(originalPath: string): Promise<string[]> {
  const ffmpeg = getFfmpeg();
  if (!ffmpeg) return [originalPath];

  const duration = await getAudioDuration(originalPath);
  if (duration == null || duration <= CHUNK_DURATION_SEC) return [originalPath];

  const dir = path.dirname(originalPath);
  const ext = path.extname(originalPath);
  const base = path.basename(originalPath, ext);
  const chunkPaths: string[] = [];
  const chunkCount = Math.ceil(duration / CHUNK_DURATION_SEC);

  for (let i = 0; i < chunkCount; i++) {
    const startSec = i * CHUNK_DURATION_SEC;
    const durationSec = Math.min(CHUNK_DURATION_SEC, duration - startSec);
    const chunkPath = path.join(dir, `${base}_chunk_${i}${ext}`);
    chunkPaths.push(chunkPath);

    await new Promise<void>((resolve, reject) => {
      ffmpeg(originalPath)
        .setStartTime(startSec)
        .setDuration(durationSec)
        .output(chunkPath)
        .on("end", () => resolve())
        .on("error", (err: Error) => reject(err))
        .run();
    });
  }

  return chunkPaths;
}

/** Удаляет временные чанки (не трогает originalPath). */
export async function deleteChunkFiles(chunkPaths: string[], originalPath: string): Promise<void> {
  for (const p of chunkPaths) {
    if (p === originalPath) continue;
    try {
      await unlink(p);
    } catch (e) {
      console.warn("Error deleting chunk file:", p, e);
    }
  }
}

export { CHUNK_DURATION_SEC };
