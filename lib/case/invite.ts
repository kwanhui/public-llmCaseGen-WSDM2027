import { randomBytes } from "node:crypto";

// Base64url (RFC 4648 §5): no padding, no `+` or `/`, so it is safe in URLs.
function base64url(buf: Buffer): string {
  return buf
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

export function newInviteToken(): string {
  return base64url(randomBytes(24));
}
