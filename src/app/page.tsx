"use client";

import { useState, useCallback, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Upload, Copy, Check, FileAudio, X, Loader2 } from "lucide-react";

type Status = "idle" | "uploading" | "processing" | "done" | "error";

const ALLOWED_EXTENSIONS = [".mp3", ".wav", ".m4a", ".ogg", ".webm"];
const MAX_SIZE = 20 * 1024 * 1024;

export default function Home() {
  const [file, setFile] = useState<File | null>(null);
  const [status, setStatus] = useState<Status>("idle");
  const [progress, setProgress] = useState(0);
  const [transcription, setTranscription] = useState("");
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const validateFile = (f: File): string | null => {
    const ext = "." + (f.name.split(".").pop()?.toLowerCase() || "");
    if (!ALLOWED_EXTENSIONS.includes(ext)) {
      return `Unsupported format. Allowed: ${ALLOWED_EXTENSIONS.join(", ")}`;
    }
    if (f.size > MAX_SIZE) {
      return "File size exceeds 20MB limit";
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
    setTranscription("");
    setStatus("idle");
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

    setStatus("uploading");
    setProgress(10);
    setError("");
    setTranscription("");

    try {
      const formData = new FormData();
      formData.append("audio", file);

      // Simulate progress while waiting for the API
      const progressInterval = setInterval(() => {
        setProgress((p) => {
          if (p >= 90) {
            clearInterval(progressInterval);
            return 90;
          }
          return p + 2;
        });
      }, 800);

      // Switch to "processing" after a short delay
      setTimeout(() => setStatus("processing"), 3000);

      const res = await fetch("/api/upload", {
        method: "POST",
        body: formData,
      });

      clearInterval(progressInterval);

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "Upload failed");
      }

      setProgress(100);
      setTranscription(data.transcription);
      setStatus("done");
    } catch (err: unknown) {
      setStatus("error");
      setProgress(0);
      setError(err instanceof Error ? err.message : "Something went wrong");
    }
  };

  const copyToClipboard = async () => {
    await navigator.clipboard.writeText(transcription);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const reset = () => {
    setFile(null);
    setStatus("idle");
    setProgress(0);
    setTranscription("");
    setError("");
    if (inputRef.current) inputRef.current.value = "";
  };

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return bytes + " B";
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
    return (bytes / (1024 * 1024)).toFixed(1) + " MB";
  };

  const isProcessing = status === "uploading" || status === "processing";

  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-50 p-4 dark:bg-zinc-950">
      <div className="w-full max-w-2xl space-y-6">
        <div className="text-center">
          <h1 className="text-3xl font-bold tracking-tight">Audio Transcriber</h1>
          <p className="mt-2 text-muted-foreground">
            Upload an audio file and get a transcription powered by Gemini AI
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Upload Audio</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Drop zone */}
            <div
              onDrop={onDrop}
              onDragOver={onDragOver}
              onDragLeave={onDragLeave}
              onClick={() => !isProcessing && inputRef.current?.click()}
              className={`relative flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed p-8 transition-colors ${
                dragOver
                  ? "border-primary bg-primary/5"
                  : "border-muted-foreground/25 hover:border-muted-foreground/50"
              } ${isProcessing ? "pointer-events-none opacity-60" : ""}`}
            >
              <input
                ref={inputRef}
                type="file"
                accept=".mp3,.wav,.m4a,.ogg,.webm"
                onChange={onFileChange}
                className="hidden"
                disabled={isProcessing}
              />
              <Upload className="mb-3 h-10 w-10 text-muted-foreground" />
              <p className="text-sm font-medium">
                Drag & drop your audio file here
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                MP3, WAV, M4A, OGG, WebM (max 20MB)
              </p>
            </div>

            {/* Selected file */}
            {file && (
              <div className="flex items-center gap-3 rounded-lg bg-muted/50 p-3">
                <FileAudio className="h-5 w-5 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{file.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {formatSize(file.size)}
                  </p>
                </div>
                {!isProcessing && (
                  <button onClick={(e) => { e.stopPropagation(); reset(); }} className="text-muted-foreground hover:text-foreground">
                    <X className="h-4 w-4" />
                  </button>
                )}
              </div>
            )}

            {/* Progress */}
            {isProcessing && (
              <div className="space-y-2">
                <Progress value={progress} />
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  {status === "uploading"
                    ? "Uploading and processing..."
                    : "Generating transcription..."}
                </div>
              </div>
            )}

            {/* Error */}
            {error && (
              <div className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive">
                {error}
              </div>
            )}

            {/* Actions */}
            <div className="flex gap-3">
              <Button
                onClick={upload}
                disabled={!file || isProcessing}
                className="flex-1"
              >
                {isProcessing ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Processing...
                  </>
                ) : (
                  <>
                    <Upload className="h-4 w-4" />
                    Transcribe
                  </>
                )}
              </Button>
              {(status === "done" || status === "error") && (
                <Button variant="outline" onClick={reset}>
                  Reset
                </Button>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Transcription result */}
        {transcription && (
          <Card>
            <CardHeader className="flex-row items-center justify-between">
              <CardTitle className="text-lg">Transcription</CardTitle>
              <Button
                variant="outline"
                size="sm"
                onClick={copyToClipboard}
              >
                {copied ? (
                  <>
                    <Check className="h-4 w-4" />
                    Copied
                  </>
                ) : (
                  <>
                    <Copy className="h-4 w-4" />
                    Copy
                  </>
                )}
              </Button>
            </CardHeader>
            <CardContent>
              <div className="max-h-[500px] overflow-y-auto rounded-lg bg-muted/50 p-4">
                <pre className="whitespace-pre-wrap text-sm leading-relaxed">
                  {transcription}
                </pre>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
