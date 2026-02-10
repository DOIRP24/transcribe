const DIRECTUS_URL = process.env.DIRECTUS_URL?.replace(/\/$/, "") || "";
const DIRECTUS_TOKEN = process.env.DIRECTUS_TOKEN || "";

export type TranscriptionTask = {
  id: string;
  file_name: string;
  file_path?: string;
  mime_type?: string;
  status: "processing" | "completed" | "failed";
  language?: string;
  speakers_count?: number;
  duration?: string;
  result?: {
    segments: Array<{
      start: string;
      end: string;
      speaker?: string;
      text: string;
    }>;
    summary?: string;
    detected_language?: string;
    speakers_count?: number;
  };
  error_message?: string;
  processed_at?: number; // секунды обработки
  progress?: number; // 0-100
  status_message?: string;
  date_created?: string;
};

export async function directusRequest<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const url = `${DIRECTUS_URL}${path.startsWith("/") ? path : `/${path}`}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${DIRECTUS_TOKEN}`,
      "Content-Type": "application/json",
      ...options.headers,
    },
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Directus: ${res.status} ${err}`);
  }
  return res.json();
}

export async function createTask(
  data: Partial<TranscriptionTask>
): Promise<{ data: TranscriptionTask }> {
  return directusRequest("/items/transcription_tasks", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export async function getTask(id: string): Promise<{ data: TranscriptionTask }> {
  return directusRequest(`/items/transcription_tasks/${id}?fields=*`);
}

export async function updateTask(
  id: string,
  data: Partial<TranscriptionTask>
): Promise<{ data: TranscriptionTask }> {
  return directusRequest(`/items/transcription_tasks/${id}`, {
    method: "PATCH",
    body: JSON.stringify(data),
  });
}

export async function getTasks(): Promise<{ data: TranscriptionTask[] }> {
  return directusRequest(
    "/items/transcription_tasks?sort=-date_created&fields=*"
  );
}

export async function deleteTask(id: string): Promise<void> {
  await directusRequest(`/items/transcription_tasks/${id}`, {
    method: "DELETE",
  });
}
