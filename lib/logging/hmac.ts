import { createHmac } from "node:crypto";

export function hashFingerprint(fingerprint: string, salt: string): string {
  if (!salt || salt === "CHANGE_ME" || salt.startsWith("replace-with-")) {
    throw new Error("PSEUDONYM_SALT is unset or default; refuse to hash.");
  }
  return createHmac("sha256", salt).update(fingerprint).digest("hex");
}
