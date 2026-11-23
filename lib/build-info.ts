// What the landing page footer and /api/health say about the running build.

export const SOURCE_URL = "https://github.com/kwanhui/public-llmCaseGen-WSDM2027";

type Env = Record<string, string | undefined>;

// The commit that Vercel built, shortened to seven characters, or null
// outside Vercel.
export function buildCommit(env: Env = process.env): string | null {
  const sha = env.VERCEL_GIT_COMMIT_SHA?.trim();
  return sha ? sha.slice(0, 7) : null;
}

// The paper's link, shown only when NEXT_PUBLIC_PAPER_URL holds an http(s)
// URL; anything else is ignored.
export function paperUrl(env: Env = process.env): string | null {
  const raw = env.NEXT_PUBLIC_PAPER_URL?.trim();
  if (!raw) return null;
  try {
    const url = new URL(raw);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : null;
  } catch {
    return null;
  }
}
