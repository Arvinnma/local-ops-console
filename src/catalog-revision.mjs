import crypto from "node:crypto";

export function catalogRevision(publicCatalog) {
  return crypto.createHash("sha256").update(stableJson(publicCatalog)).digest("hex").slice(0, 24);
}

export function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}
