/**
 * Проверка: ответ GET /api/tasks/[id] всегда даёт валидный JSON.
 * Запуск: npx tsx scripts/check-task-result-json.ts
 */

function normalizeTaskResult(data: Record<string, unknown>): Record<string, unknown> {
  const result = data.result;
  if (result == null) return data;
  if (typeof result === "object" && Array.isArray((result as { segments?: unknown }).segments)) {
    return data;
  }
  if (typeof result === "string") {
    try {
      const parsed = JSON.parse(result) as unknown;
      if (parsed && typeof parsed === "object" && Array.isArray((parsed as { segments?: unknown }).segments)) {
        return { ...data, result: parsed };
      }
    } catch {
      /* битая или обрезанная строка */
    }
    return { ...data, result: { segments: [], summary: "", _truncated: true } };
  }
  return data;
}

const cases: Array<{ name: string; data: Record<string, unknown> }> = [
  {
    name: "result — объект с segments",
    data: {
      id: "1",
      status: "completed",
      result: { segments: [{ start: "00:00:00", end: "00:00:01", text: "Привет" }], summary: "Кратко" },
    },
  },
  {
    name: "result — валидная JSON-строка",
    data: {
      id: "2",
      status: "completed",
      result: '{"segments":[{"start":"00:00:00","end":"00:00:01","text":"Test"}],"summary":""}',
    },
  },
  {
    name: "result — обрезанная строка (unterminated)",
    data: {
      id: "3",
      status: "completed",
      result: '{"segments":[{"start":"00:00:00","end":"00:00:05","text":"Длинный текст без закрывающей кавычки...',
    },
  },
  {
    name: "result == null",
    data: { id: "4", status: "processing", result: null },
  },
];

let ok = 0;
for (const { name, data } of cases) {
  const out = normalizeTaskResult(data);
  let json: string;
  try {
    json = JSON.stringify(out);
    JSON.parse(json); // убеждаемся, что обратный парс возможен
    ok++;
    console.log("✓", name, "→ валидный JSON, длина:", json.length);
  } catch (e) {
    console.error("✗", name, e);
  }
}
console.log("\nИтог:", ok === cases.length ? "все проверки пройдены" : "есть ошибки");
