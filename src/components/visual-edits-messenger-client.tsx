"use client";

import dynamic from "next/dynamic";

const VisualEditsMessenger = dynamic(
  () => import("orchids-visual-edits").then((m) => ({ default: m.VisualEditsMessenger })),
  { ssr: false }
);

export function VisualEditsMessengerClient() {
  return <VisualEditsMessenger />;
}
