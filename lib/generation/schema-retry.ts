// Two attempts for a model call that returns structured output. A structured-
// output failure (the model returns JSON the schema rejects, or the JSON is cut
// off) is usually transient, so it is retried once. Any other error, and the
// second schema failure, is thrown to the caller unchanged.
import { NoObjectGeneratedError } from "ai";

export async function retrySchemaFailureOnce<T>(label: string, fn: () => Promise<T>): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (!NoObjectGeneratedError.isInstance(err)) throw err;
      console.warn(
        `${label}: output did not match the schema (attempt ${attempt} of 2; finish reason ${err.finishReason ?? "unknown"}, ${err.text?.length ?? 0} characters)`,
      );
      if (attempt >= 2) throw err;
    }
  }
}
