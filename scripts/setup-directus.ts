/**
 * Скрипт создания коллекции transcription_tasks в Directus.
 * Запуск: bun run scripts/setup-directus.ts
 */

const DIRECTUS_URL = process.env.DIRECTUS_URL?.replace(/\/$/, "") || "https://apidoirp.ru";
const DIRECTUS_TOKEN = process.env.DIRECTUS_TOKEN || "koyjHehmNTcFKOMInydmXghgIiWIULrK";

async function request(path: string, options: RequestInit = {}) {
  const url = `${DIRECTUS_URL}${path.startsWith("/") ? path : `/${path}`}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${DIRECTUS_TOKEN}`,
      "Content-Type": "application/json",
      ...(options.headers as Record<string, string>),
    },
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Directus ${res.status}: ${text}`);
  }
  return text ? JSON.parse(text) : null;
}

async function main() {
  console.log("Создание коллекции transcription_tasks в Directus...");

  // 1. Создать коллекцию с полями
  const collection = {
    collection: "transcription_tasks",
    meta: {
      icon: "record_voice_over",
      note: "Задачи транскрибации аудио",
    },
    schema: {},
    fields: [
      { field: "file_name", type: "string", meta: { interface: "input", required: true }, schema: { is_nullable: false } },
      { field: "file_path", type: "string", meta: { interface: "input" }, schema: { is_nullable: true } },
      { field: "mime_type", type: "string", meta: { interface: "input" }, schema: { is_nullable: true } },
      { field: "status", type: "string", meta: { interface: "input" }, schema: { default_value: "processing", is_nullable: false } },
      { field: "language", type: "string", meta: { interface: "input" }, schema: { is_nullable: true } },
      { field: "speakers_count", type: "integer", meta: { interface: "input" }, schema: { is_nullable: true } },
      { field: "duration", type: "string", meta: { interface: "input" }, schema: { is_nullable: true } },
      { field: "result", type: "json", meta: { interface: "input-code", options: { language: "json" } }, schema: { is_nullable: true } },
      { field: "error_message", type: "text", meta: { interface: "input-multiline" }, schema: { is_nullable: true } },
      { field: "processed_at", type: "integer", meta: { interface: "input" }, schema: { is_nullable: true } },
      { field: "progress", type: "integer", meta: { interface: "progress" }, schema: { default_value: 0, is_nullable: true } },
      { field: "status_message", type: "string", meta: { interface: "input" }, schema: { is_nullable: true } },
      { field: "date_created", type: "timestamp", meta: { interface: "datetime" }, schema: { default_value: "$now", is_nullable: true } },
    ],
  };

  try {
    const result = await request("/collections", {
      method: "POST",
      body: JSON.stringify(collection),
    });
    console.log("✓ Коллекция создана:", result);
  } catch (e) {
    if (String(e).includes("already exists") || String(e).includes("409") || String(e).includes("duplicate")) {
      console.log("Коллекция transcription_tasks уже существует.");
    } else {
      throw e;
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
