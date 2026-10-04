import { redirect } from "next/navigation";
import { AuthError } from "next-auth";
import { adminPasswordConfigured, signIn } from "@/lib/auth/config";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CARD, LABEL, NOTE_FLAG, NOTE_MUTED } from "@/components/admin/styles";

export const metadata = { title: "Sign in · PersCase" };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ callbackUrl?: string; error?: string }>;
}) {
  const sp = await searchParams;
  // With no password hash set, every attempt fails however correct it is, so
  // the page says so instead of reporting a wrong password.
  const configured = adminPasswordConfigured();
  const errorMessage = !configured
    ? null
    : sp.error === "CredentialsSignin"
      ? "Wrong username or password."
      : sp.error
        ? `Sign-in error: ${sp.error}`
        : null;

  return (
    <div className="flex min-h-[calc(100vh-10rem)] items-start justify-center sm:items-center">
      <section className={`${CARD} w-full max-w-sm px-5 py-6 sm:px-7 sm:py-8`}>
        <h1 className="text-2xl font-semibold">Instructor sign-in</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Students do not sign in. They open the link their instructor gives them.
        </p>

        {!configured ? (
          <div
            role="alert"
            className={`mt-6 ${NOTE_MUTED}`}
          >
            This instance has no instructor password configured, so no sign-in can
            succeed. Whoever set it up needs to set{" "}
            <code className="font-mono text-xs">ADMIN_PASSWORD_HASH</code>;{" "}
            <code className="font-mono text-xs">pnpm change-admin-password --local</code>{" "}
            prints the line to paste in.
          </div>
        ) : null}

        {errorMessage ? (
          <div
            role="alert"
            className={`mt-6 ${NOTE_FLAG}`}
          >
            {errorMessage}
          </div>
        ) : null}

        <form
          action={async (formData) => {
            "use server";
            try {
              await signIn("credentials", {
                email: formData.get("email"),
                password: formData.get("password"),
                redirectTo: sp.callbackUrl ?? "/admin",
              });
            } catch (error) {
              if (error instanceof AuthError) {
                redirect(`/admin/login?error=${error.type}`);
              }
              throw error;
            }
          }}
          className="mt-6 space-y-4"
        >
          <div>
            <label htmlFor="email" className={LABEL}>
              Username
            </label>
            <Input
              id="email"
              name="email"
              type="text"
              required
              autoComplete="username"
              autoFocus
              className="mt-1.5"
            />
          </div>
          <div>
            <label htmlFor="password" className={LABEL}>
              Password
            </label>
            <Input
              id="password"
              name="password"
              type="password"
              required
              autoComplete="current-password"
              className="mt-1.5"
            />
          </div>
          <Button type="submit" variant="primary" size="md" className="mt-2 w-full">
            Sign in
          </Button>
        </form>
      </section>
    </div>
  );
}
