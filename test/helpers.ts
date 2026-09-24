import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const fixturesDir = resolve(here, "fixtures");

export function readFixture(name: string): unknown {
  return JSON.parse(readFileSync(resolve(fixturesDir, name), "utf8"));
}

export function makeHttp(url: string, body: unknown) {
  return {
    url,
    respond: () => Promise.resolve(new Response(JSON.stringify(body), { status: 200 })),
  };
}

export function recordFetchCalls(): {
  calls: string[];
  restore: () => void;
} {
  const calls: string[] = [];
  const original = globalThis.fetch;
  return {
    calls,
    restore() {
      globalThis.fetch = original;
    },
  };
}

export interface FetchStubHandler {
  (input: string | URL | Request, init?: RequestInit): Promise<Response>;
}

export function installFetch(handler: FetchStubHandler): () => void {
  const original = globalThis.fetch;
  globalThis.fetch = handler as typeof fetch;
  return () => {
    globalThis.fetch = original;
  };
}

export interface RecordedRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
}

export function recordingFetch(responder: (req: RecordedRequest) => Promise<Response>) {
  const calls: RecordedRequest[] = [];
  const handler: FetchStubHandler = async (input, init) => {
    const url = typeof input === "string" ? input : input.toString();
    const headers = Object.fromEntries(
      Object.entries(init?.headers ?? {}).map(([k, v]) => [k, String(v)]),
    );
    const req: RecordedRequest = { url, method: init?.method ?? "GET", headers };
    calls.push(req);
    return responder(req);
  };
  return { handler, calls };
}

export function describeIntegration() {
  return process.env.LIVE === "1" ? describe : describe.skip;
}
