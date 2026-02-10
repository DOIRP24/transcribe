import { Document, Packer, Paragraph, TextRun } from "docx";

export type Segment = {
  start: string;
  end: string;
  speaker?: string;
  text: string;
};

/** Убирает из текста артефакты JSON (сырой вывод модели), оставляет только читаемый текст */
function sanitizeSegmentText(text: string | undefined | null): string {
  const t = (text ?? "").trim();
  if (!t.startsWith("{") && !t.includes('"segments"') && !t.includes('"text":"')) return t || "";
  const out: string[] = [];
  let i = 0;
  while (i < t.length) {
    const keyStart = t.indexOf('"text"', i);
    if (keyStart === -1) break;
    const colon = t.indexOf(":", keyStart);
    if (colon === -1) break;
    const q = t.indexOf('"', colon + 1);
    if (q === -1) break;
    let end = q + 1;
    let value = "";
    while (end < t.length) {
      const c = t[end];
      if (c === "\\") {
        value += t[end + 1] === '"' ? '"' : t.slice(end, end + 2);
        end += 2;
        continue;
      }
      if (c === '"') break;
      value += c;
      end++;
    }
    if (value.trim()) out.push(value.trim());
    i = end + 1;
  }
  return out.length ? out.join("\n") : t || "";
}

/** Если в БД попал сырой JSON в сегментах — извлекаем нормальные сегменты и чистим текст */
export function normalizeSegments(segments: Segment[] | undefined | null): Segment[] {
  const list = Array.isArray(segments) ? segments : [];
  let normalized = list;

  if (normalized.length === 1) {
    const text = (normalized[0]?.text ?? "").trim();
    if (text.startsWith("{") && text.includes('"segments"')) {
      try {
        const startObj = text.indexOf("{");
        let depth = 0;
        let endIdx = -1;
        let inString = false;
        let escape = false;
        let quote = "";
        for (let i = startObj; i < text.length; i++) {
          const c = text[i];
          if (escape) {
            escape = false;
            continue;
          }
          if (inString) {
            if (c === quote) inString = false;
            else if (c === "\\") escape = true;
            continue;
          }
          if (c === '"' || c === "'") {
            inString = true;
            quote = c;
            continue;
          }
          if (c === "{") depth++;
          if (c === "}") {
            depth--;
            if (depth === 0) {
              endIdx = i;
              break;
            }
          }
        }
        if (endIdx !== -1) {
          const parsed = JSON.parse(text.slice(startObj, endIdx + 1)) as { segments?: unknown[] };
          if (Array.isArray(parsed.segments) && parsed.segments.length > 0) {
            normalized = (parsed.segments as Record<string, unknown>[]).map((s) => ({
              start: String(s.start ?? "00:00:00"),
              end: String(s.end ?? "00:00:00"),
              speaker: s.speaker != null ? String(s.speaker) : undefined,
              text: String(s.text ?? ""),
            }));
          }
        }
      } catch {
        // leave normalized as is
      }
    }
  }

  return normalized.map((seg) => ({
    ...seg,
    text: sanitizeSegmentText(seg?.text ?? ""),
  }));
}

function toSrtTime(s: string): string {
  if (/^\d{2}:\d{2}:\d{2},\d{3}$/.test(s)) return s;
  if (s.includes(".")) return s.replace(/\./g, ",");
  return s + ",000";
}

function segmentToSrtLine(index: number, seg: Segment): string {
  const start = toSrtTime(seg?.start ?? "00:00:00");
  const end = toSrtTime(seg?.end ?? "00:00:00");
  return `${index}\n${start} --> ${end}\n${(seg?.text ?? "").trim()}\n`;
}

export function buildSrt(segments: Segment[]): string {
  return segments.map((seg, i) => segmentToSrtLine(i + 1, seg)).join("\n") + "\n";
}

export function buildDocx(
  segments: Segment[],
  options: { withTimestamps: boolean; summary?: string }
): Promise<Buffer> {
  const children: Paragraph[] = [];

  if (options.summary) {
    children.push(
      new Paragraph({
        children: [
          new TextRun({ text: "Summary", bold: true, size: 28 }),
        ],
        spacing: { after: 200 },
      }),
      new Paragraph({
        children: [new TextRun({ text: options.summary })],
        spacing: { after: 400 },
      })
    );
  }

  children.push(
    new Paragraph({
      children: [
        new TextRun({ text: "Транскрибация", bold: true, size: 28 }),
      ],
      spacing: { after: 200 },
    })
  );

  for (const seg of segments) {
    const line = options.withTimestamps
      ? `[${seg.start} - ${seg.end}] ${seg.speaker ? seg.speaker + ": " : ""}${seg.text}`
      : `${seg.speaker ? seg.speaker + ": " : ""}${seg.text}`;
    children.push(
      new Paragraph({
        children: [new TextRun({ text: line })],
        spacing: { after: 100 },
      })
    );
  }

  const doc = new Document({
    sections: [
      {
        properties: {},
        children,
      },
    ],
  });

  return Packer.toBuffer(doc);
}
