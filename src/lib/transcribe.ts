import { GoogleGenAI, Type } from "@google/genai";
import { jsonrepair } from "jsonrepair";
import { unlink } from "fs/promises";
import { updateTask } from "./directus";
import {
  getAudioDuration,
  splitAudioIntoChunks,
  addOffsetToTimestamp,
  CHUNK_DURATION_SEC,
} from "./audio-chunks";

/** Схема ответа (Structured Output) — модель возвращает валидный JSON по этой структуре */
const TRANSCRIPTION_RESPONSE_SCHEMA = {
  type: Type.OBJECT,
  description: "Результат транскрибации с сегментами и саммари",
  properties: {
    segments: {
      type: Type.ARRAY,
      description: "Сегменты с таймкодами и спикерами",
      items: {
        type: Type.OBJECT,
        properties: {
          start: { type: Type.STRING, description: "Начало фразы (HH:MM:SS)" },
          end: { type: Type.STRING, description: "Конец фразы (HH:MM:SS)" },
          speaker: { type: Type.STRING, description: "Спикер (Speaker A, B…)" },
          text: { type: Type.STRING, description: "Текст фразы" },
        },
        required: ["start", "end", "speaker", "text"],
      },
    },
    summary: { type: Type.STRING, description: "Краткое содержание на языке аудио" },
    detected_language: { type: Type.STRING, description: "Код языка (ru, en…)" },
    speakers_count: { type: Type.NUMBER, description: "Количество спикеров" },
  },
  required: ["segments", "summary", "detected_language", "speakers_count"],
} as const;

const PROMPT =
  "Твоя задача — профессиональная транскрибация аудио с разделением по спикерам (Speaker A, Speaker B, Speaker C и т.д.). \n" +
  "ОБЯЗАТЕЛЬНО: \n" +
  "1. Определяй смену голоса и меняй метку спикера. \n" +
  "2. Не объединяй разных людей в одного спикера. \n" +
  "3. Формат времени строго HH:MM:SS. \n" +
  "4. Для каждой фразы укажи start, end, speaker, text.";

export type Segment = {
  start: string;
  end: string;
  speaker?: string;
  text: string;
};

export type TranscriptionResult = {
  segments: Segment[];
  summary?: string;
  detected_language?: string;
  speakers_count?: number;
};

function parseGeminiJson(rawText: string): TranscriptionResult | null {
  if (!rawText?.trim()) return null;
  try {
    return JSON.parse(rawText) as TranscriptionResult;
  } catch {
    try {
      const repaired = jsonrepair(rawText);
      return JSON.parse(repaired) as TranscriptionResult;
    } catch {
      return null;
    }
  }
}

/**
 * Транскрибирует один файл/чанк через Gemini. Удаляет файл из Gemini и локальный файл после вызова.
 * С поддержкой ретраев.
 */
async function runSingleChunk(
  ai: InstanceType<typeof GoogleGenAI>,
  filePath: string,
  displayName: string,
  mimeType: string,
  retries = 2
): Promise<TranscriptionResult | null> {
  let geminiFileName: string | null = null;
  
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      // 1. Загрузка (каждый раз новая, если упало на этапе генерации)
      const uploadResult = await ai.files.upload({
        file: filePath,
        config: { mimeType, displayName },
      });
      geminiFileName = uploadResult.name!;

      // 2. Ожидание обработки
      let currentFile = await ai.files.get({ name: geminiFileName });
      let waitAttempts = 0;
      while (currentFile.state === "PROCESSING" && waitAttempts < 60) {
        await new Promise((r) => setTimeout(r, 2000));
        currentFile = await ai.files.get({ name: geminiFileName });
        waitAttempts++;
      }

      if (currentFile.state !== "ACTIVE") {
        throw new Error(`File state: ${currentFile.state}`);
      }

      // 3. Генерация
      const result = await ai.models.generateContent({
        model: "models/gemini-2.0-flash",
        config: {
          responseMimeType: "application/json",
          responseSchema: TRANSCRIPTION_RESPONSE_SCHEMA,
        },
        contents: [
          {
            role: "user",
            parts: [
              { fileData: { fileUri: uploadResult.uri!, mimeType: uploadResult.mimeType! } },
              { text: PROMPT },
            ],
          },
        ],
      });

      const rawText = result.text?.trim() ?? "";
      const parsed = parseGeminiJson(rawText);
      
      // Удаляем из Gemini сразу после получения текста
      try { await ai.files.delete({ name: geminiFileName }); } catch {}
      geminiFileName = null;

      if (parsed?.segments?.length) {
        try { await unlink(filePath); } catch {}
        return parsed;
      }
      
      throw new Error("Empty or invalid segments in response");

    } catch (err) {
      console.error(`Attempt ${attempt + 1} failed for ${displayName}:`, err);
      if (geminiFileName) {
        try { await ai.files.delete({ name: geminiFileName }); } catch {}
      }
      if (attempt === retries) {
        try { await unlink(filePath); } catch {}
        return null;
      }
      // Экспоненциальная задержка перед ретраем
      await new Promise(r => setTimeout(r, Math.pow(2, attempt) * 2000));
    }
  }
  
  return null;
}

export async function runGeminiTranscription(
  taskId: string,
  tempFilePath: string,
  fileName: string,
  mimeType: string
): Promise<void> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    await updateTask(taskId, { status: "failed", error_message: "GEMINI_API_KEY is not configured" });
    return;
  }

  const startTime = Date.now();
  const ai = new GoogleGenAI({ apiKey });

  try {
    await updateTask(taskId, { error_message: "Анализ аудиофайла..." });
    const durationSec = await getAudioDuration(tempFilePath);
    await updateTask(taskId, { error_message: "Подготовка фрагментов..." });
    const chunkPaths = await splitAudioIntoChunks(tempFilePath);
    
    const totalChunks = chunkPaths.length;
    let completedChunks = 0;
    
    const allSegments: Segment[] = [];
    const summaries: string[] = [];
    let detectedLanguage = "";
    let speakersCount = 0;

    // Параллельная обработка (concurrency = 2 для стабильности)
    const CONCURRENCY = 2;
    const results = new Array(totalChunks);
    
    const processBatch = async (indices: number[]) => {
      await Promise.all(indices.map(async (i) => {
        const offsetSec = i * CHUNK_DURATION_SEC;
        const displayName = totalChunks === 1 ? fileName : `${fileName} (часть ${i + 1} из ${totalChunks})`;
        
        await updateTask(taskId, { 
          error_message: totalChunks === 1 
            ? "Отправка в ИИ..." 
            : `Обработка части ${i + 1} из ${totalChunks}...` 
        });

        const path = chunkPaths[i];
        const chunkResult = await runSingleChunk(ai, path, displayName, mimeType);
        results[i] = chunkResult;
        
        completedChunks++;
        const pct = 15 + Math.round((completedChunks / totalChunks) * 75);
        await updateTask(taskId, { error_message: `Обработка части ${i + 1} из ${totalChunks}... (${pct}%)` });
      }));
    };

    for (let i = 0; i < totalChunks; i += CONCURRENCY) {
      const indices = [];
      for (let j = i; j < i + CONCURRENCY && j < totalChunks; j++) {
        indices.push(j);
      }
      await processBatch(indices);
    }

    await updateTask(taskId, { error_message: "Сборка результата..." });

    // Собираем результаты
    for (let i = 0; i < totalChunks; i++) {
      const res = results[i];
      if (res?.segments?.length) {
        const offsetSec = i * CHUNK_DURATION_SEC;
        const adjusted = res.segments.map((seg: Segment) => ({
          ...seg,
          start: addOffsetToTimestamp(seg.start, offsetSec),
          end: addOffsetToTimestamp(seg.end, offsetSec),
        }));
        allSegments.push(...adjusted);
        if (res.summary) summaries.push(res.summary);
        if (res.detected_language) detectedLanguage = res.detected_language;
        if (res.speakers_count) speakersCount = Math.max(speakersCount, res.speakers_count);
      }
    }

    if (allSegments.length === 0) {
      throw new Error("Не удалось получить сегменты ни из одного фрагмента аудио");
    }

    // Удаляем оригинал, если он не был удален как единственный чанк
    if (totalChunks > 1 || (totalChunks === 1 && chunkPaths[0] !== tempFilePath)) {
      try { await unlink(tempFilePath); } catch {}
    }

    const processedAt = Math.round((Date.now() - startTime) / 1000);
    await updateTask(taskId, {
      status: "completed",
      error_message: undefined,
      result: {
        segments: allSegments,
        summary: summaries.join("\n\n"),
        detected_language: detectedLanguage || undefined,
        speakers_count: speakersCount || 1,
      },
      language: detectedLanguage,
      speakers_count: speakersCount || 1,
      processed_at: processedAt,
    });

  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("Transcription pipeline error:", err);
    await updateTask(taskId, { status: "failed", error_message: message });
    try { await unlink(tempFilePath); } catch {}
  }
}
