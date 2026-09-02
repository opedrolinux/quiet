import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

/**
 * Magic-link delivery.
 *
 * Two ways out, chosen by whether RESEND_API_KEY is set. Resend has an HTTP
 * API, so real email costs a fetch call and no dependency; without a key the
 * link is written to the console and to a file instead.
 *
 * The file fallback is not a stub. For a server running on your own desktop and
 * serving only you, reading the link off that machine is a perfectly good way to
 * sign in, and it means the whole thing works with no account anywhere.
 */

const LOG_PATH = process.env.QUIET_MAIL_LOG ?? "server/data/magic-links.txt";

export type MagicMail = {
  to: string;
  link: string;
  code: string;
  expiresAt: number;
};

export async function sendMagicLink(mail: MagicMail): Promise<void> {
  const minutes = Math.round((mail.expiresAt - Date.now()) / 60000);
  const text = [
    `Sign in to Quiet`,
    ``,
    `Open this link on the device you want to sign in:`,
    mail.link,
    ``,
    `The app should be showing the code ${mail.code}.`,
    `If it is showing something else, someone else started this sign-in — ignore this email.`,
    ``,
    `The link stops working in ${minutes} minutes.`,
  ].join("\n");

  const key = process.env.RESEND_API_KEY;
  if (key) {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify({
        from: process.env.QUIET_MAIL_FROM ?? "Quiet <onboarding@resend.dev>",
        to: mail.to,
        subject: `Sign in to Quiet — code ${mail.code}`,
        text,
      }),
    });
    if (!res.ok) {
      // Fall through to the file rather than failing the sign-in outright: a
      // link the user can still reach beats a dead end.
      console.error(`[mail] Resend refused (${res.status}): ${await res.text()}`);
    } else {
      console.log(`[mail] magic link sent to ${mail.to}`);
      return;
    }
  }

  mkdirSync(dirname(LOG_PATH), { recursive: true });
  const entry = `\n=== ${new Date().toISOString()} → ${mail.to}\n${text}\n`;
  try {
    appendFileSync(LOG_PATH, entry);
  } catch {
    writeFileSync(LOG_PATH, entry);
  }
  // ASCII only: the Windows console mangles box-drawing characters unless the
  // code page has been changed, and a sign-in link is a bad place for mojibake.
  console.log(
    `\n-------- sign in as ${mail.to} --------\n` +
      `code ${mail.code}\n${mail.link}\n` +
      `(also appended to ${LOG_PATH})\n`,
  );
}
