"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Upload, FileAudio, X, Loader2, LogIn, Download, ArrowLeft } from "lucide-react";
import { normalizeSegments } from "@/lib/export";

const ALLOWED_EXTENSIONS = [".mp3", ".wav", ".m4a", ".ogg", ".webm"];
const MAX_SIZE = 20 * 1024 * 1024;
const POLL_INTERVAL_MS = 3000;

type TaskStatus = "processing" | "completed" | "failed";

type Task = {
  id: string | number;
  file_name: string;
  status: TaskStatus;
  language?: string;
  speakers_count?: number;
  processed_at?: number;
  progress?: number;
  status_message?: string;
  result?: {
    segments?: Array<{ start: string; end: string; speaker?: string; text: string }>;
    summary?: string;
    _truncated?: boolean;
  };
  error_message?: string;
};

function formatDuration(sec: number | undefined): string {
  if (sec == null) return "—";
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  return [h, m, s].map((n) => String(n).padStart(2, "0")).join(":");
}

function buildSpeakerLabels(segments: { speaker?: string }[]): (index: number) => string {
  const map = new Map<string, number>();
  let next = 1;
  segments.forEach((seg) => {
    const key = seg.speaker || "";
    if (key && !map.has(key)) {
      map.set(key, next++);
    }
  });
  return (index: number) => {
    const seg = segments[index];
    const key = seg?.speaker;
    if (key && map.has(key)) return `Спикер ${map.get(key)}`;
    return `Спикер ${index + 1}`;
  };
}

export default function Home() {
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const [currentTask, setCurrentTask] = useState<Task | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const fetchTask = useCallback(async (id: string | number) => {
    try {
      const res = await fetch(`/api/tasks/${id}`);
      if (!res.ok) return;
      const text = await res.text();
      let data: Task;
      try {
        data = JSON.parse(text) as Task;
      } catch {
        setError("Ответ сервера повреждён (невалидный JSON). Попробуйте обновить страницу.");
        return;
      }
      setError("");
      setCurrentTask(data);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (/fetch failed|failed to fetch|networkerror|network error/i.test(msg)) {
        setError("Нет связи с сервером. Проверьте, что приложение запущено (npm run dev) и интернет доступен.");
      }
    }
  }, []);

  useEffect(() => {
    if (!currentTask || currentTask.status !== "processing") return;
    const t = setInterval(() => fetchTask(currentTask.id), POLL_INTERVAL_MS);
    return () => clearInterval(t);
  }, [currentTask?.id, currentTask?.status, fetchTask]);

  const validateFile = (f: File): string | null => {
    const ext = "." + (f.name.split(".").pop()?.toLowerCase() || "");
    if (!ALLOWED_EXTENSIONS.includes(ext)) {
      return `Неподдерживаемый формат. Допустимы: ${ALLOWED_EXTENSIONS.join(", ")}`;
    }
    if (f.size > MAX_SIZE) {
      return "Размер файла превышает 20 МБ";
    }
    return null;
  };

  const handleFile = (f: File) => {
    const err = validateFile(f);
    if (err) {
      setError(err);
      return;
    }
    setFile(f);
    setError("");
  };

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const f = e.dataTransfer.files[0];
    if (f) handleFile(f);
  }, []);

  const onDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(true);
  }, []);

  const onDragLeave = useCallback(() => setDragOver(false), []);

  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) handleFile(f);
  };

  const upload = async () => {
    if (!file) return;
    setUploading(true);
    setError("");
    try {
      const formData = new FormData();
      formData.append("audio", file);
      const res = await fetch("/api/upload", { method: "POST", body: formData });
      const text = await res.text();
      let data: { task_id?: string; error?: string };
      try {
        data = text ? (JSON.parse(text) as { task_id?: string; error?: string }) : {};
      } catch {
        data = { error: res.ok ? "Неверный ответ сервера" : text || "Ошибка загрузки" };
      }
      if (!res.ok) throw new Error(data.error || "Ошибка загрузки");
      setCurrentTask({
        id: data.task_id!,
        file_name: file.name,
        status: "processing",
      });
      setFile(null);
      if (inputRef.current) inputRef.current.value = "";
      await fetchTask(data.task_id!);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (/fetch failed|failed to fetch|networkerror|network error/i.test(msg)) {
        setError("Нет связи с сервером. Запустите приложение (npm run dev) и проверьте интернет.");
      } else {
        setError(msg || "Произошла ошибка");
      }
    } finally {
      setUploading(false);
    }
  };

  const reset = () => {
    setFile(null);
    setError("");
    if (inputRef.current) inputRef.current.value = "";
  };

  const backToUpload = () => {
    setCurrentTask(null);
    reset();
  };

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return bytes + " B";
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
    return (bytes / (1024 * 1024)).toFixed(1) + " MB";
  };

  const downloadUrl = (id: string | number, format: string) =>
    `/api/tasks/${id}/download?format=${format}`;

  const showUpload = !currentTask;
  const segments =
    currentTask?.status === "completed" && currentTask.result?.segments?.length
      ? normalizeSegments(currentTask.result.segments)
      : [];

  return (
    <div className="min-h-screen bg-zinc-100 dark:bg-zinc-950">
      <header className="sticky top-0 z-50 mx-4 mt-4 rounded-2xl border border-zinc-200/80 bg-white/90 shadow-sm backdrop-blur-sm dark:border-zinc-800 dark:bg-zinc-900/90">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-6 py-4">
          <a href="/" className="flex items-center gap-3">
            <div className="grid h-9 w-9 grid-cols-2 gap-0.5">
              {[0, 1, 2, 3].map((i) => (
                <div
                  key={i}
                  className="rounded-sm bg-violet-500"
                  style={{ opacity: 0.6 + (i % 4) * 0.1 }}
                />
              ))}
            </div>
            <span className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
              Стенограф
            </span>
          </a>
          <nav className="hidden items-center gap-1 sm:flex">
            {["Регистрация", "Тарифы", "Контакты", "API", "Конфиденциальность"].map(
              (item) => (
                <a
                  key={item}
                  href="#"
                  className="rounded-lg px-3 py-2 text-sm text-zinc-600 transition-colors hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
                >
                  {item}
                </a>
              )
            )}
          </nav>
          <Button
            className="gap-2 bg-violet-600 hover:bg-violet-700 dark:bg-violet-600 dark:hover:bg-violet-500"
            size="sm"
          >
            <LogIn className="h-4 w-4" />
            Вход
          </Button>
        </div>
      </header>

      <div className="mx-auto max-w-6xl px-4 pb-12 pt-8">
        <div className="space-y-6 text-center">
          <h1 className="text-2xl font-bold tracking-tight text-zinc-900 sm:text-3xl dark:text-zinc-100">
            Профессиональная{" "}
            <span className="bg-gradient-to-r from-violet-600 via-purple-500 to-indigo-600 bg-clip-text text-transparent">
              транскрибация
            </span>
            <span className="block">и саммари встреч</span>
          </h1>
        </div>

        <div className="mt-12 space-y-6">
          {showUpload && (
            <Card className="border-0 bg-white shadow-md dark:bg-zinc-900">
              <CardHeader>
                <CardTitle className="text-lg">Загрузить аудио</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div
                  onDrop={onDrop}
                  onDragOver={onDragOver}
                  onDragLeave={onDragLeave}
                  onClick={() => !uploading && inputRef.current?.click()}
                  className={`relative flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed p-8 transition-colors ${
                    dragOver
                      ? "border-violet-400 bg-violet-50 dark:bg-violet-950/30"
                      : "border-zinc-200 hover:border-zinc-300 dark:border-zinc-700"
                  } ${uploading ? "pointer-events-none opacity-60" : ""}`}
                >
                  <input
                    ref={inputRef}
                    type="file"
                    accept=".mp3,.wav,.m4a,.ogg,.webm"
                    onChange={onFileChange}
                    className="hidden"
                    disabled={uploading}
                  />
                  <Upload className="mb-3 h-10 w-10 text-zinc-500" />
                  <p className="text-sm font-medium">
                    Перетащить / Загрузить аудио или видео файл
                  </p>
                  <p className="mt-1 text-xs text-zinc-500">
                    MP3, WAV, M4A, OGG, WebM (до 20 МБ)
                  </p>
                </div>

                {file && (
                  <div className="flex items-center gap-3 rounded-lg bg-zinc-100 dark:bg-zinc-800 p-3">
                    <FileAudio className="h-5 w-5 shrink-0 text-zinc-500" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{file.name}</p>
                      <p className="text-xs text-zinc-500">{formatSize(file.size)}</p>
                    </div>
                    {!uploading && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          reset();
                        }}
                        className="text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    )}
                  </div>
                )}

                {error && (
                  <div className="rounded-lg bg-red-50 dark:bg-red-950/30 p-3 text-sm text-red-600 dark:text-red-400">
                    {error}
                  </div>
                )}

                <Button
                  onClick={upload}
                  disabled={!file || uploading}
                  className="w-full bg-violet-600 hover:bg-violet-700 sm:w-auto sm:min-w-[180px]"
                >
                  {uploading ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Отправка...
                    </>
                  ) : (
                    <>
                      <Upload className="h-4 w-4" />
                      Распознать
                    </>
                  )}
                </Button>
              </CardContent>
            </Card>
          )}

          {currentTask?.status === "processing" && (
            <Card className="border-0 bg-white shadow-md dark:bg-zinc-900">
              <CardContent className="flex flex-col items-center justify-center py-16">
                <Loader2 className="h-12 w-12 animate-spin text-violet-600" />
                <p className="mt-4 text-lg font-medium text-zinc-700 dark:text-zinc-300">
                  {currentTask.error_message || currentTask.status_message || "Идёт распознавание…"}
                </p>
                <div className="mt-4 w-72 mx-auto">
                  <div className="h-2 w-full overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-700">
                    <div className="h-full w-2/5 min-w-[100px] rounded-full bg-violet-500 animate-pulse" />
                  </div>
                  <p className="mt-2 text-center text-xs text-zinc-500">
                    Файл: {currentTask.file_name}
                  </p>
                </div>
              </CardContent>
            </Card>
          )}

          {currentTask?.status === "failed" && (
            <Card className="border-0 bg-white shadow-md dark:bg-zinc-900">
              <CardContent className="py-8">
                <p className="text-red-600 dark:text-red-400">
                  {currentTask.error_message || "Произошла ошибка"}
                </p>
                <Button variant="outline" className="mt-4" onClick={backToUpload}>
                  <ArrowLeft className="h-4 w-4" />
                  Распознать другой файл
                </Button>
              </CardContent>
            </Card>
          )}

          {currentTask?.status === "completed" && segments.length > 0 && (
            <div className="grid gap-6 lg:grid-cols-[1fr_240px]">
              <Card className="border-0 bg-white shadow-md dark:bg-zinc-900">
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <div>
                    <CardTitle className="text-xl">
                      Транскрипция по спикерам (с таймкодами)
                    </CardTitle>
                    <p className="mt-1 text-sm font-normal text-zinc-500">
                      {currentTask.file_name}
                    </p>
                  </div>
                  <Button variant="outline" size="sm" onClick={backToUpload}>
                    <ArrowLeft className="h-4 w-4" />
                    Распознать другой файл
                  </Button>
                </CardHeader>
                <CardContent>
                  <div className="rounded-lg border border-zinc-100 bg-zinc-50/50 dark:border-zinc-800 dark:bg-zinc-900/50">
                    <div className="max-h-[min(60vh,420px)] overflow-y-auto overscroll-contain px-4 py-4 pr-3 sm:px-6 sm:pr-4">
                      <div className="space-y-4">
                        {(() => {
                          const getLabel = buildSpeakerLabels(segments);
                          return segments.map((seg, i) => (
                            <div key={i} className="space-y-1">
                              <p className="text-xs font-medium text-zinc-500">
                                [{seg.start} — {seg.end}]
                              </p>
                              <p className="text-[15px] leading-relaxed">
                                <span className="font-semibold text-violet-700 dark:text-violet-400">
                                  {getLabel(i)}:
                                </span>{" "}
                                {seg.text}
                              </p>
                            </div>
                          ));
                        })()}
                      </div>
                    </div>
                    {segments.length > 8 && (
                      <p className="border-t border-zinc-200/80 px-4 py-2 text-center text-xs text-zinc-500 dark:border-zinc-700 dark:text-zinc-400">
                        Листайте вверх/вниз — сегментов: {segments.length}
                      </p>
                    )}
                  </div>
                </CardContent>
              </Card>

              <Card className="h-fit border-0 bg-white shadow-md dark:bg-zinc-900">
                <CardHeader>
                  <CardTitle className="text-base">Скачать</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  <a
                    href={downloadUrl(currentTask.id, "srt")}
                    download
                    className="flex w-full items-center gap-2 rounded-lg border border-zinc-200 px-3 py-2 text-sm hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
                  >
                    <Download className="h-4 w-4" />
                    Скачать SRT (субтитры)
                  </a>
                  <a
                    href={downloadUrl(currentTask.id, "docx")}
                    download
                    className="flex w-full items-center gap-2 rounded-lg border border-zinc-200 px-3 py-2 text-sm hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
                  >
                    <Download className="h-4 w-4" />
                    Скачать DOCX (с таймкодами)
                  </a>
                  <a
                    href={downloadUrl(currentTask.id, "docx_plain")}
                    download
                    className="flex w-full items-center gap-2 rounded-lg border border-zinc-200 px-3 py-2 text-sm hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
                  >
                    <Download className="h-4 w-4" />
                    Скачать DOCX (без таймкодов)
                  </a>
                </CardContent>
              </Card>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
