// How a button that calls one of the model routes reads the reply.
//
// Those routes answer with JSON that carries a message written for the reader,
// whether the call worked or not (lib/generation/generate-attempts.ts keeps
// them inside their time limit so that they can). When the route itself does
// not answer (the platform's gateway timeout, a 502 or 503 from the platform,
// a dropped connection) there is no such message. The button then says in
// words what happened and what was left as it was, never a bare HTTP status.

export type ModelReply<T> =
  | { ok: true; data: T }
  // `message` is the route's own message, or null when it sent none.
  // `status` is null when the request got no response at all.
  | { ok: false; status: number | null; message: string | null };

// The route's message, when the body is the route's JSON and has one.
export function replyMessage(body: unknown): string | null {
  if (!body || typeof body !== "object") return null;
  const m = (body as { message?: unknown }).message;
  return typeof m === "string" && m.trim() ? m : null;
}

export function readModelReply<T>(status: number, body: unknown): ModelReply<T> {
  if (status >= 200 && status < 300 && body && typeof body === "object") {
    return { ok: true, data: body as T };
  }
  return { ok: false, status, message: replyMessage(body) };
}

// POSTs JSON (or nothing) and reads the reply. Never throws.
export async function postForReply<T>(url: string, body?: unknown): Promise<ModelReply<T>> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      ...(body === undefined
        ? {}
        : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
    });
  } catch {
    return { ok: false, status: null, message: null };
  }
  const parsed: unknown = await res.json().catch(() => undefined);
  return readModelReply<T>(res.status, parsed);
}

// What happened, in words, for a reply that carried no message of the route's.
// `unchanged` says what was left as it was, e.g. "This section is unchanged."
export function noAnswerMessage(status: number | null, unchanged: string): string {
  const what =
    status === null
      ? "The connection to the server was lost before it answered."
      : status === 504
        ? "The server did not answer in time."
        : status >= 500
          ? "The server did not answer."
          : "The server did not accept the request.";
  return `${what} ${unchanged} Wait a minute and try again.`;
}

// The message to show for a failed reply: the route's own, or the one above.
export function failureMessage(reply: { status: number | null; message: string | null }, unchanged: string): string {
  return reply.message ?? noAnswerMessage(reply.status, unchanged);
}
