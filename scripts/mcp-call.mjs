#!/usr/bin/env node
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";

const serverPath = new URL("../dist/server.js", import.meta.url).pathname;

const child = spawn("node", [serverPath], {
  stdio: ["pipe", "pipe", "pipe"],
});

const rl = createInterface({ input: child.stdout });
let buf = "";
let id = 1;
const pending = new Map();

function send(method, params) {
  const msg = { jsonrpc: "2.0", id: id++, method, params };
  child.stdin.write(JSON.stringify(msg) + "\n");
  return new Promise((resolve, reject) => {
    pending.set(msg.id, { resolve, reject });
  });
}

function notify(method, params) {
  const msg = { jsonrpc: "2.0", method, params };
  child.stdin.write(JSON.stringify(msg) + "\n");
}

rl.on("line", (line) => {
  if (!line.trim()) return;
  let msg;
  try {
    msg = JSON.parse(line);
  } catch (e) {
    console.error("[non-json]", line);
    return;
  }
  if (msg.id != null && pending.has(msg.id)) {
    const { resolve, reject } = pending.get(msg.id);
    pending.delete(msg.id);
    if (msg.error) reject(new Error(msg.error.message));
    else resolve(msg.result);
  }
});

child.stderr.on("data", (d) => process.stderr.write(d));

async function main() {
  const args = process.argv.slice(2);
  const callName = args[0] ?? "list_cinemas";
  const callArgs = args[1] ? JSON.parse(args[1]) : {};
  try {
    await send("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "e2e-driver", version: "0.0.1" },
    });
    await send("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "e2e-driver", version: "0.0.1" },
    });
    notify("notifications/initialized", {});
    // tiny pause to let the server process the notification
    await new Promise((r) => setTimeout(r, 50));
    const result = await send("tools/call", {
      name: callName,
      arguments: callArgs,
    });
    console.log(JSON.stringify(result, null, 2));
  } finally {
    child.stdin.end();
    child.kill();
  }
}

main().catch((err) => {
  console.error("ERROR:", err);
  child.kill();
  process.exit(1);
});
