import { NextRequest, NextResponse } from "next/server";
import { getTask } from "@/lib/directus";
import { buildDocx, buildSrt, normalizeSegments } from "@/lib/export";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const id = (await params).id;
  const format = request.nextUrl.searchParams.get("format") || "docx";

  try {
    const { data: task } = await getTask(id);
    if (task.status !== "completed" || !task.result?.segments?.length) {
      return NextResponse.json(
        { error: "Task not ready or no result" },
        { status: 400 }
      );
    }

    const segments = normalizeSegments(task.result.segments);
    const baseName = (task.file_name || "transcription").replace(/\.[^.]+$/, "");

    if (format === "srt") {
      const srt = buildSrt(segments);
      return new NextResponse(srt, {
        headers: {
          "Content-Type": "application/x-subrip; charset=utf-8",
          "Content-Disposition": `attachment; filename="${baseName}.srt"`,
        },
      });
    }

    if (format === "docx" || format === "docx_plain") {
      const withTimestamps = format === "docx";
      const buffer = await buildDocx(segments, {
        withTimestamps,
        summary: task.result.summary,
      });
      const suffix = withTimestamps ? "_with_timestamps" : "_plain";
      return new NextResponse(buffer, {
        headers: {
          "Content-Type":
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          "Content-Disposition": `attachment; filename="${baseName}${suffix}.docx"`,
        },
      });
    }

    return NextResponse.json({ error: "Unknown format" }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ error: "Download failed" }, { status: 500 });
  }
}
