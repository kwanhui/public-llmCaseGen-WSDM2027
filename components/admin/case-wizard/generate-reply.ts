// How the "Generate case" button reads the reply of POST
// /api/admin/cases/<id>/generate.
//
// The route answers with JSON: the draft, or an error with a message written
// for the instructor. When the route itself does not answer (the platform's
// gateway timeout, a 502 or 503 from the platform, a dropped connection), the
// body is not the route's JSON and there is no message to show. The button
// then tries once more by itself, because such a failure is usually a one-off
// and a second request usually finishes in well under a minute, and only after
// a second failure asks the instructor to try again.
import type { CaseContent } from "@/lib/generation/schema";

export type GenerateReply =
  | { kind: "ok"; contentJson: CaseContent }
  // The route answered with a reason; show it and do not retry by itself.
  | { kind: "error"; message: string }
  // No answer from the route. `status` is null for a network failure.
  | { kind: "no-reply"; status: number | null };

function messageOf(body: unknown): string | null {
  if (!body || typeof body !== "object") return null;
  const b = body as { message?: unknown; error?: unknown };
  if (typeof b.message === "string" && b.message.trim()) return b.message;
  if (typeof b.error === "string" && b.error.trim()) return b.error;
  return null;
}

// `body` is the parsed JSON of the reply, or undefined when it was not JSON.
export function readGenerateReply(status: number, body: unknown): GenerateReply {
  if (status >= 200 && status < 300) {
    const content = (body as { contentJson?: CaseContent } | undefined)?.contentJson;
    return content ? { kind: "ok", contentJson: content } : { kind: "no-reply", status };
  }
  const message = messageOf(body);
  if (message) return { kind: "error", message };
  return { kind: "no-reply", status };
}

export function shouldRetryByItself(reply: GenerateReply, triesSoFar: number): boolean {
  return reply.kind === "no-reply" && triesSoFar < 2;
}

// Shown while the second try runs.
export const RETRYING_NOTICE =
  "The server did not answer the first request in time, so PersCase is trying once more. Nothing was saved from the first request.";

// Shown when the second try also got no answer.
export function noReplyMessage(status: number | null): string {
  const what =
    status === null
      ? "The connection to the server was lost"
      : status === 504
        ? "The server did not answer in time (HTTP 504)"
        : `The server did not answer (HTTP ${status})`;
  return `${what}, on the first request and on the automatic retry. Nothing was saved and the case is unchanged. Wait a minute and press the button again.`;
}
