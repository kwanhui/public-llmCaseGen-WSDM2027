// Minimal Auth.js config for the Edge runtime (middleware).
// The full config in `config.ts` uses bcryptjs which is not Edge-compatible.

import type { NextAuthConfig } from "next-auth";

export default {
  providers: [],
  pages: {
    signIn: "/admin/login",
    error: "/admin/login",
  },
  session: { strategy: "jwt" },
} satisfies NextAuthConfig;
