import { NextResponse } from "next/server";
import { sql } from "@vercel/postgres";
import pkg from "@/package.json";

// Public liveness probe: one request tells whether the deployment can reach
// its database and has a generation key configured, without exposing any
// secret. 200 when both hold, 503 otherwise.

export const dynamic = "force-dynamic";

function providerName(): "openai" | "anthropic" {
  const p = (process.env.LLM_PROVIDER ?? "openai").trim().toLowerCase();
  return p === "anthropic" ? "anthropic" : "openai";
}

// Retrieval always embeds through OpenAI, so an Anthropic deployment still
// needs an OpenAI key; both are required before the app is fully usable.
function keyPresent(provider: "openai" | "anthropic"): boolean {
  const openai = Boolean(process.env.OPENAI_API_KEY?.trim());
  if (provider === "anthropic") {
    return openai && Boolean(process.env.ANTHROPIC_API_KEY?.trim());
  }
  return openai;
}

function version(): string {
  const sha = process.env.VERCEL_GIT_COMMIT_SHA?.trim();
  return sha ? sha.slice(0, 7) : (pkg as { version: string }).version;
}

export async function GET() {
  let dbOk = false;
  try {
    await sql`select 1`;
    dbOk = true;
  } catch {
    dbOk = false;
  }

  const provider = providerName();
  const key = keyPresent(provider);
  const ok = dbOk && key;

  return NextResponse.json(
    { ok, db: dbOk, provider, keyPresent: key, version: version() },
    { status: ok ? 200 : 503, headers: { "cache-control": "no-store" } },
  );
}
