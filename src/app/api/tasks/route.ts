import { NextResponse } from "next/server";
import { getTasks } from "@/lib/directus";

export async function GET() {
  try {
    const { data } = await getTasks();
    return NextResponse.json({ tasks: data ?? [] });
  } catch (e) {
    console.error("GET /api/tasks:", e);
    return NextResponse.json({ error: "Failed to fetch tasks" }, { status: 500 });
  }
}
