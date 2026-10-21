// Shared helpers for the collectors.
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const root = join(dirname(fileURLToPath(import.meta.url)), "..");
export const dataPath = (name) => join(root, "site", "data", name);

export const TIMEOUT_MS = 10_000;
export const SLOW_MS = 1500;

export async function readJson(path, fallback) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    return fallback;
  }
}

export async function writeJson(path, value) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(value) + "\n");
}

export const loadConfig = () => readJson(join(root, "config.json"), null);

export const nowSec = () => Math.floor(Date.now() / 1000);

export function errorText(err) {
  if (err.name === "TimeoutError") return "timeout";
  return err.cause?.code || err.message;
}

// JSON-RPC call that also measures latency.
export async function rpc(url, method, params = []) {
  const started = performance.now();
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const body = await res.json().catch(() => null);
  const ms = Math.round(performance.now() - started);
  if (!res.ok || !body || body.error) {
    const msg = body?.error?.message || `HTTP ${res.status}`;
    throw Object.assign(new Error(msg), { code: res.status, ms });
  }
  return { result: body.result, ms, code: res.status };
}
