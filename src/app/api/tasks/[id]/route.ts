import { NextRequest, NextResponse } from "next/server";
import { getTask, deleteTask } from "@/lib/directus";

/** Нормализует result: если пришёл как строка (или битый JSON) — парсим или подставляем безопасный объект, чтобы ответ всегда был валидным JSON. */
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
      /* битая или обрезанная строка — отдаём пустой результат */
    }
    return { ...data, result: { segments: [], summary: "", _truncated: true } };
  }
  return data;
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const id = (await params).id;
  try {
    const { data } = await getTask(id);
    const safe = normalizeTaskResult(data as Record<string, unknown>);
    return NextResponse.json(safe);
  } catch (e) {
    return NextResponse.json({ error: "Task not found" }, { status: 404 });
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const id = (await params).id;
  try {
    await deleteTask(id);
    return new NextResponse(null, { status: 204 });
  } catch (e) {
    return NextResponse.json({ error: "Failed to delete" }, { status: 500 });
  }
}
