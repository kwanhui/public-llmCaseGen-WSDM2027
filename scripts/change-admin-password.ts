// Hash a new admin password, for a local instance or for the deployment.
//
//   pnpm change-admin-password --local                # print the hash and stop
//   pnpm change-admin-password --vercel-production    # write it to Vercel and redeploy
//
// --local touches nothing outside the terminal: it prints the bcrypt hash and
// the line to paste into .env.local, which is all a fresh clone needs to sign
// in. The Vercel path rewrites the linked project's production environment and
// triggers a production deployment, so it has to be asked for by name.
//
// The plaintext is read from a hidden TTY prompt: never echoed, never an
// argument, never in shell history. For the public demo, enter the
// demonstration password given in the README.

import { hash } from "bcryptjs";
import { spawnSync } from "node:child_process";
import { createInterface } from "node:readline";

// Piped input is read a line at a time: the password on the first line and the
// confirmation on the second.
let pipedLines: AsyncIterator<string> | null = null;

async function readPipedLine(): Promise<string> {
  if (!pipedLines) {
    pipedLines = createInterface({ input: process.stdin })[Symbol.asyncIterator]();
  }
  const next = await pipedLines.next();
  return next.done ? "" : String(next.value).trim();
}

async function readPasswordHidden(prompt: string): Promise<string> {
  process.stdout.write(prompt);
  if (!process.stdin.isTTY) return readPipedLine();
  return new Promise((resolve, reject) => {
    let pwd = "";
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.setEncoding("utf8");
    const onData = (key: string) => {
      if (key === "\r" || key === "\n" || key === "") {
        process.stdin.setRawMode(false);
        process.stdin.pause();
        process.stdin.removeListener("data", onData);
        process.stdout.write("\n");
        resolve(pwd);
      } else if (key === "") {
        process.stdout.write("\n");
        process.stdin.setRawMode(false);
        process.stdin.pause();
        reject(new Error("Cancelled"));
      } else if (key === "" || key === "\b") {
        if (pwd.length > 0) pwd = pwd.slice(0, -1);
      } else {
        pwd += key;
      }
    };
    process.stdin.on("data", onData);
  });
}

const LOCAL = process.argv.includes("--local");
const VERCEL = process.argv.includes("--vercel-production");

async function main() {
  if (!LOCAL && !VERCEL) {
    console.error(
      "Say where the password is for.\n" +
        "  --local               print the hash and the .env.local line, change nothing else\n" +
        "  --vercel-production   write the hash to the linked Vercel project and redeploy it",
    );
    process.exit(1);
  }

  const pwd = await readPasswordHidden("New admin password: ");
  if (pwd.length < 4) {
    console.error("Password too short (>=4 chars).");
    process.exit(1);
  }
  const confirm = await readPasswordHidden("Confirm password: ");
  if (confirm !== pwd) {
    console.error("Passwords don't match.");
    process.exit(1);
  }

  console.log("Hashing...");
  const h = await hash(pwd, 12);

  if (LOCAL) {
    // Next.js expands $NAME inside .env files, which would empty a bcrypt hash,
    // so each dollar sign is written with a backslash in front of it.
    console.log("\nAdd this line to .env.local, then restart the dev server:\n");
    console.log(`ADMIN_PASSWORD_HASH=${h.replace(/\$/g, "\\$")}`);
    console.log("\nNothing was sent anywhere. Vercel was not called.");
    return;
  }

  console.log("Removing old hash from Vercel (if present)...");
  spawnSync("vercel", ["env", "rm", "ADMIN_PASSWORD_HASH", "production", "--yes"], {
    stdio: ["ignore", "ignore", "inherit"],
  });

  console.log("Adding new hash to Vercel Production...");
  const add = spawnSync(
    "vercel",
    ["env", "add", "ADMIN_PASSWORD_HASH", "production", "--value", h, "--yes"],
    { stdio: "inherit" },
  );
  if (add.status !== 0) {
    console.error("Failed to add env var. Local hash:");
    console.log(h);
    console.error("Add it to .env.local manually if you only need it locally.");
    process.exit(1);
  }

  console.log("Triggering production redeploy...");
  const deploy = spawnSync("vercel", ["--prod", "--yes"], { stdio: "inherit" });
  if (deploy.status !== 0) {
    console.error("Redeploy failed.");
    process.exit(1);
  }
  console.log("Done. Admin password updated.");
}

main().catch((err) => {
  console.error(err.message ?? err);
  process.exit(1);
});
