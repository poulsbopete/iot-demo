# Ecolab IoT Command Center

A production-quality **demo** web app that simulates Ecolab-style IoT signals (OpenTelemetry metrics) from chemical dosing, sanitation, and water equipment, sends them to **Elastic Observability (Elastic Serverless)** via OTLP HTTP, and provides an **AI Ops Copilot** panel that uses MCP-style tools to query Elastic and summarize results.

- **Stack:** Next.js 14+ (App Router), TypeScript, Tailwind CSS, Recharts, OpenTelemetry SDK.
- **Deploy:** Vercel (serverless); no Docker required. Configuration via environment variables only.

## Quick start

1. **Clone and install**

   ```bash
   cd iot-demo
   npm install
   ```

2. **Configure environment**

   Copy `.env.example` to `.env.local` and set:

   - `ELASTIC_ENDPOINT` — Elastic Serverless base URL (e.g. `https://<deployment>.es.us-central1.gcp.cloud.es.io`).
   - `ELASTIC_API_KEY` — API key for Elastic (create in Elastic Cloud console).
   - `OTLP_ENDPOINT` — OTLP HTTP endpoint. Often the **same** as `ELASTIC_ENDPOINT`; Elastic’s OTLP intake may be on the same host (e.g. `https://<deployment>.es.../v1/metrics`). If your setup uses a dedicated OTLP URL, set it here.
   - `OTLP_HEADERS` — e.g. `Authorization=ApiKey <your_api_key>` (same key as above if using same deployment).

3. **Run**

   ```bash
   npm run dev
   ```

   Open [http://localhost:3000](http://localhost:3000). Use **Demo Control** to send metrics (Step, Auto-run, Burst 60s, Inject anomaly). Charts and **Copilot** will query Elastic; ensure metrics have been sent and are available in your deployment.

## Configuring Elastic Serverless

- **Endpoint:** In Elastic Cloud, open your deployment and use the **Elasticsearch** endpoint (e.g. `https://xxx.es.us-central1.gcp.cloud.es.io`). Put it in `ELASTIC_ENDPOINT`.
- **API key:** Create an API key with access to the same deployment (Cluster privileges or minimal required for writing and reading metrics). Put it in `ELASTIC_API_KEY` and in `OTLP_HEADERS` as `Authorization=ApiKey <key>`.
- **OTLP:** If OTLP is served on the same host as the Elasticsearch API, set `OTLP_ENDPOINT` to that same base URL. The app will send to `OTLP_ENDPOINT/v1/metrics`. If your docs specify a different OTLP URL or port, set `OTLP_ENDPOINT` to that value.

## How OTLP is used

- The app uses `@opentelemetry/sdk-metrics` and `@opentelemetry/exporter-metrics-otlp-http` to export metrics.
- Each **Step** or **Burst** generates a batch of gauges/counters (e.g. `chemical.dosing_rate_lpm`, `sanitation.sanitizer_ppm`, `device.status`), sends them in one flush to `OTLP_ENDPOINT/v1/metrics`, with auth from `OTLP_HEADERS`.
- Metrics are tagged with `site.name`, `site.id`, `device.type`, `device.id`, `region`. Elastic’s OTLP intake creates data streams like `metrics-generic.otel-default` (see [Elastic OTLP docs](https://www.elastic.co/docs/manage-data/data-store/data-streams/tsds-ingest-otlp)). The app’s query layer uses index pattern `metrics-*` and assumes metric name/value and site/device attributes are available (e.g. `metric.name`, `metric.value`, `labels.*` or `attributes.*` depending on your Elastic version). If your mapping differs, adjust `lib/elastic.ts` accordingly.

## How MCP works in this demo

- **External MCP:** If `MCP_SERVER_URL` is set, the Copilot sends tool invocations to that server (JSON-RPC style `tools/call`).
- **Internal MCP:** If `MCP_SERVER_URL` is not set, the app uses an **internal MCP-like tool router** at `POST /api/mcp` that implements these tools:
  - `elastic.get_timeseries(metric, site, from, to, interval)` — time-series for charts.
  - `elastic.detect_anomalies(from, to)` — anomaly list.
  - `elastic.search(index, body)` — raw Elasticsearch search.
  - `elastic.esql_query(query)` — ES|QL query (if your deployment supports `_query`).
- The Copilot UI offers **5 canned questions** (e.g. “Any pump failures today?”, “Show sanitizer ppm by site last 15 minutes”) that map to these tools. **Freeform** input is supported; without an external LLM, the app uses canned tools + optional OpenAI summarization.
- **Summarization:** If `OPENAI_API_KEY` is set, tool results are summarized with OpenAI. If not, a **rule-based summarizer** is used so the demo works without an LLM.

## Demo narrative

- **Sites:** Hospital, Restaurant, Food Plant (3 sites).
- **Device types:** Chemical Dosing Pump, Commercial Dishwasher / Wash Station, Water System (cooling tower / boiler loop).
- **Metrics:** e.g. `chemical.dosing_rate_lpm`, `chemical.tank_level_pct`, `chemical.conductivity_uS`, `sanitation.cycle_count`, `sanitation.water_temp_c`, `sanitation.sanitizer_ppm`, `water.ph`, `water.conductivity_uS`, `water.flow_rate_lpm`, `device.status`.
- **Anomalies:** Underdosing, pump failure, tank leak, thermal high/low — injectable via **Inject anomaly** and detectable via **Anomalies** API and Copilot.

## Scripts

- `npm run dev` — development server.
- `npm run build` — production build.
- `npm run start` — run production build.
- `npm run test` — run Vitest tests (simulator determinism, anomaly injection).

## Project structure (key files)

- `app/page.tsx` — main dashboard (charts, alerts, Copilot, demo control).
- `app/api/simulate/step` — generate one batch and export via OTLP.
- `app/api/metrics/summary`, `app/api/metrics/timeseries` — Elastic query APIs.
- `app/api/anomalies` — anomalies from Elastic.
- `app/api/mcp` — MCP tool router (canned questions + tool invocations).
- `app/api/status` — connectivity (Elastic + OTLP).
- `lib/simulator.ts` — deterministic metric generation and anomaly injection.
- `lib/elastic.ts` — Elasticsearch queries (summary, timeseries, anomalies).
- `lib/otlpExport.ts` — OTLP HTTP export to Elastic.
- `lib/mcpClient.ts` — MCP client and internal tool implementation.
- `lib/copilotSummarizer.ts` — OpenAI or rule-based summarization.

## Sample screenshots

*(Placeholder: add screenshots of the dashboard, Copilot panel, and demo control here.)*

## License

MIT.
