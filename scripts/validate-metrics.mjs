#!/usr/bin/env node
/**
 * Validate metrics in Elastic (no Next.js required).
 * Loads .env.local, then queries ELASTIC_ENDPOINT for metric doc count and sample.
 * Usage: node scripts/validate-metrics.mjs
 */

import { readFileSync, existsSync } from "fs";
import { pathToFileURL } from "url";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const envPath = join(root, ".env.local");

function loadEnv() {
  if (!existsSync(envPath)) {
    console.error("No .env.local found. Create it with ELASTIC_ENDPOINT and ELASTIC_API_KEY.");
    process.exit(1);
  }
  const content = readFileSync(envPath, "utf8");
  const env = {};
  for (const line of content.split("\n")) {
    const m = line.match(/^\s*([^#=]+)=(.*)$/);
    if (m) env[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, "");
  }
  return env;
}

const env = loadEnv();
const ELASTIC_ENDPOINT = env.ELASTIC_ENDPOINT || env.ELASTIC_ENDPOINT_URL || "";
const ELASTIC_API_KEY = env.ELASTIC_API_KEY || "";

if (!ELASTIC_ENDPOINT || !ELASTIC_API_KEY) {
  console.error("Set ELASTIC_ENDPOINT and ELASTIC_API_KEY in .env.local");
  process.exit(1);
}

const base = ELASTIC_ENDPOINT.replace(/\/+$/, "");
const headers = {
  "Content-Type": "application/json",
  Authorization: `ApiKey ${ELASTIC_API_KEY}`,
};

async function main() {
  console.log("Validating metrics in Elastic...");
  console.log("Endpoint:", base.replace(/:[^/]*@/, ":****@"));

  const index = "metrics-generic.otel-default";
  const from = "now-24h";
  const to = "now";

  const countBody = {
    size: 0,
    query: { range: { "@timestamp": { gte: from, lte: to } } },
    track_total_hits: true,
  };

  let res = await fetch(`${base}/${index}/_search`, {
    method: "POST",
    headers,
    body: JSON.stringify(countBody),
  });
  let usedIndex = index;
  if (!res.ok && (res.status === 404 || res.status === 400)) {
    res = await fetch(`${base}/metrics-*/_search`, {
      method: "POST",
      headers,
      body: JSON.stringify(countBody),
    });
    usedIndex = "metrics-*";
  }
  if (!res.ok) {
    console.error("Elasticsearch error:", res.status, await res.text());
    process.exit(1);
  }

  const countData = await res.json();
  const total = countData.hits?.total;
  const count = typeof total === "number" ? total : total?.value ?? 0;

  console.log("\n--- Result ---");
  console.log("Index queried:", usedIndex);
  console.log("Time range:", from, "to", to);
  console.log("Metric document count:", count);

  if (count === 0) {
    console.log("\nNo metrics found. Ensure:");
    console.log("  1. ELASTIC_ENDPOINT is the .es. URL for the same project as OTLP ingest");
    console.log("  2. You have sent metrics (Step or Auto-run in the app)");
    console.log("  3. ELASTIC_API_KEY has read access to metrics-*");
    process.exit(0);
  }

  const ecolabBody = {
    size: 0,
    query: {
      bool: {
        must: [
          { range: { "@timestamp": { gte: from, lte: to } } },
          { term: { "resource.attributes.service.name": "ecolab-iot-demo" } },
        ],
      },
    },
    track_total_hits: true,
  };
  const ecolabRes = await fetch(`${base}/${usedIndex}/_search`, {
    method: "POST",
    headers,
    body: JSON.stringify(ecolabBody),
  });
  if (ecolabRes.ok) {
    const ecolabData = await ecolabRes.json();
    const et = ecolabData.hits?.total;
    const ecolabCount = typeof et === "number" ? et : et?.value ?? 0;
    console.log("  (ecolab-iot-demo service.name count:", ecolabCount + ")");
    if (ecolabCount === 0 && count > 0) {
      console.log("\n  The docs in this index are from other apps. Ensure OTLP_ENDPOINT and ELASTIC_ENDPOINT use the SAME Elastic project (same deployment ID in the URL).");
    }
  }

  const sampleBody = {
    size: 1,
    query: { range: { "@timestamp": { gte: from, lte: to } } },
    sort: [{ "@timestamp": "desc" }],
    _source: true,
  };
  const sampleRes = await fetch(`${base}/${usedIndex}/_search`, {
    method: "POST",
    headers,
    body: JSON.stringify(sampleBody),
  });
  if (!sampleRes.ok) {
    console.log("(Could not fetch sample doc)");
    process.exit(0);
  }
  const sampleData = await sampleRes.json();
  const hit = sampleData.hits?.hits?.[0];
  if (hit?._source) {
    const keys = Object.keys(hit._source).sort();
    console.log("\nSample document field names:", keys.join(", "));
  }
  console.log("\nMetrics are present in Elastic. If charts are still empty, check Sample doc fields on the dashboard and the time range.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
