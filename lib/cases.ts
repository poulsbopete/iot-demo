/**
 * Fetch Ecolab cases from Kibana Cases API (Observability).
 * Requires Kibana base URL (from MCP_SERVER_URL or KIBANA_URL) and ELASTIC_API_KEY with Cases read.
 */

const MCP_SERVER_URL = process.env.MCP_SERVER_URL ?? "";
const KIBANA_URL = process.env.KIBANA_URL ?? "";

function getKibanaBase(): string {
  if (KIBANA_URL.trim()) return KIBANA_URL.replace(/\/+$/, "");
  const u = MCP_SERVER_URL.replace(/\/+$/, "");
  return u.replace(/\/api\/agent_builder\/mcp\/?$/i, "") || u;
}

export interface EcolabCase {
  id: string;
  title: string;
  description: string;
  status: string;
  severity?: string;
  tags: string[];
  createdAt: string;
  totalAlerts: number;
  totalComments: number;
  url: string;
}

interface KibanaCaseFindResponse {
  cases?: Array<{
    id: string;
    title: string;
    description?: string;
    status: string;
    severity?: string;
    tags?: string[];
    created_at?: string;
    total_alerts?: number;
    total_comments?: number;
  }>;
  page?: number;
  per_page?: number;
  total?: number;
}

/**
 * Fetch Observability cases tagged with Ecolab (and optionally IoT, Demo).
 * Returns a list of cases with a link to open in Kibana.
 */
export async function getEcolabCases(limit = 10): Promise<{ cases: EcolabCase[]; error?: string }> {
  const base = getKibanaBase();
  const apiKey = process.env.ELASTIC_API_KEY ?? "";
  if (!base || !apiKey) {
    return { cases: [], error: "KIBANA_URL or MCP_SERVER_URL and ELASTIC_API_KEY are required." };
  }
  try {
    const params = new URLSearchParams({
      owner: "observability",
      tags: "Ecolab",
      perPage: String(limit),
      sortField: "createdAt",
      sortOrder: "desc",
    });
    const res = await fetch(`${base}/api/cases/_find?${params}`, {
      method: "GET",
      headers: {
        "kbn-xsrf": "true",
        Authorization: `ApiKey ${apiKey}`,
      },
    });
    const data = (await res.json()) as KibanaCaseFindResponse & { message?: string };
    if (!res.ok) {
      return { cases: [], error: data.message ?? res.statusText };
    }
    const cases = (data.cases ?? []).map((c) => ({
      id: c.id,
      title: c.title,
      description: c.description ?? "",
      status: c.status,
      severity: c.severity,
      tags: c.tags ?? [],
      createdAt: c.created_at ?? "",
      totalAlerts: c.total_alerts ?? 0,
      totalComments: c.total_comments ?? 0,
      url: `${base}/app/observability/cases/${c.id}`,
    }));
    return { cases };
  } catch (e) {
    return {
      cases: [],
      error: e instanceof Error ? e.message : String(e),
    };
  }
}
