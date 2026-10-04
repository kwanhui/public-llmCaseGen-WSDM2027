import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { compare } from "bcryptjs";
import { db } from "@/lib/db/client";
import { users } from "@/lib/db/schema";

// Single-instructor demo auth.
// ADMIN_EMAIL: what the user types in the email field (default: "admin").
// ADMIN_PASSWORD_HASH: bcrypt hash of the password, generated with
// `pnpm change-admin-password`.

export const ADMIN_USER_ID = "admin";
const ADMIN_EMAIL = (process.env.ADMIN_EMAIL ?? "admin").trim();
const ADMIN_PASSWORD_HASH = (process.env.ADMIN_PASSWORD_HASH ?? "").trim();

// With no hash configured every password is rejected. The sign-in page asks
// this so that it can say what is missing. It reveals nothing about the
// password itself.
export function adminPasswordConfigured(): boolean {
  return ADMIN_PASSWORD_HASH.length > 0;
}

async function ensureAdminUserRow() {
  await db
    .insert(users)
    .values({ id: ADMIN_USER_ID, email: ADMIN_EMAIL, role: "instructor" })
    .onConflictDoNothing({ target: users.id })
    .catch(() => {
      // No database: sign-in fails at the next database write.
    });
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [
    Credentials({
      credentials: {
        email: { label: "Username", type: "text", placeholder: "admin" },
        password: { label: "Password", type: "password" },
      },
      async authorize(creds) {
        if (!ADMIN_PASSWORD_HASH) return null;
        const email = (creds?.email as string | undefined)?.toLowerCase()?.trim();
        const password = creds?.password as string | undefined;
        if (!email || !password) return null;
        if (email !== ADMIN_EMAIL.toLowerCase()) return null;
        const ok = await compare(password, ADMIN_PASSWORD_HASH);
        if (!ok) return null;
        await ensureAdminUserRow();
        return { id: ADMIN_USER_ID, email: ADMIN_EMAIL, name: "Instructor" };
      },
    }),
  ],
  pages: {
    signIn: "/admin/login",
    error: "/admin/login",
  },
  session: { strategy: "jwt" },
  callbacks: {
    async jwt({ token, user }) {
      if (user?.id) {
        token.id = user.id;
        token.role = "instructor";
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        (session.user as { id?: string; role?: string }).id =
          (token.id as string) ?? ADMIN_USER_ID;
        (session.user as { role?: string }).role = "instructor";
      }
      return session;
    },
  },
});
