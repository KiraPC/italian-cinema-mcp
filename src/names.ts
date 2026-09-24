import type { ChainId } from "./types.js";

export function displayNameFor(chain: ChainId, rawName: string): string {
  const base = stripPipeSuffix(rawName).trim().replace(/\s+/g, " ");
  if (chain === "uci") {
    return base.replace(/^UCI\s+Cinemas\s+/, "UCI ");
  }
  if (chain === "thespace") {
    if (/^the\s+space\s+/i.test(base)) return base;
    return `The Space ${base}`;
  }
  return base;
}

function stripPipeSuffix(name: string): string {
  const idx = name.indexOf("|");
  return idx >= 0 ? name.slice(0, idx) : name;
}
