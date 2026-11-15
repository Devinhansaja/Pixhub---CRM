// Runs once when the Next.js server starts. Node-only setup lives in instrumentation-node.ts
// (kept separate so it is never bundled into the Edge runtime used by middleware).
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./instrumentation-node");
  }
}
