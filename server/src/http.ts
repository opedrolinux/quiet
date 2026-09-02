import type { IncomingMessage, ServerResponse } from "node:http";

/** What a handler returns. Handlers never touch the response directly, which
 *  keeps them plain functions that can be called from a test. */
export type Reply = {
  status: number;
  json?: unknown;
  html?: string;
  headers?: Record<string, string>;
};

/** Refuse oversized bodies rather than buffering whatever arrives. */
const MAX_BODY = 8 * 1024 * 1024;

export async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY) throw new Error("body too large");
    chunks.push(chunk as Buffer);
  }
  if (!chunks.length) return undefined;
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

export function send(res: ServerResponse, reply: Reply): void {
  const headers: Record<string, string> = {
    // The phone loads the PWA from this same server, so same-origin covers it;
    // this is here for running the desktop app against it from vite on :1420.
    "access-control-allow-origin": "*",
    "access-control-allow-headers": "authorization, content-type",
    "access-control-allow-methods": "GET, POST, OPTIONS",
    ...reply.headers,
  };

  if (reply.html !== undefined) {
    headers["content-type"] = "text/html; charset=utf-8";
    res.writeHead(reply.status, headers);
    res.end(reply.html);
    return;
  }
  if (reply.json !== undefined) {
    headers["content-type"] = "application/json; charset=utf-8";
    res.writeHead(reply.status, headers);
    res.end(JSON.stringify(reply.json));
    return;
  }
  res.writeHead(reply.status, headers);
  res.end();
}
