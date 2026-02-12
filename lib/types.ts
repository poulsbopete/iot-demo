/** Site and device identifiers for the demo. */
export type SiteName = "Hospital" | "Restaurant" | "FoodPlant";
export type DeviceType = "ChemicalDosingPump" | "Dishwasher" | "WaterSystem";
export type Region = "NA" | "EMEA" | "APAC";

export interface SiteConfig {
  id: string;
  name: SiteName;
  region: Region;
}

export interface DeviceConfig {
  id: string;
  type: DeviceType;
  siteId: string;
}

/** Single metric point with attributes. */
export interface MetricPoint {
  name: string;
  value: number;
  timestamp: number;
  attributes: Record<string, string | number>;
}

/** Batch of metrics from one simulation step. */
export interface MetricBatch {
  metrics: MetricPoint[];
  stepIndex: number;
  anomaliesInjected?: string[];
}

/** Anomaly types the simulator can inject. */
export type AnomalyType =
  | "underdosing"
  | "pump_failure"
  | "tank_leak"
  | "thermal_high"
  | "thermal_low";

/** Chart-friendly time bucket. */
export interface TimeSeriesBucket {
  time: string;
  value: number;
  site?: string;
  device?: string;
}

/** API response shapes. */
export interface MetricsSummary {
  from: string;
  to: string;
  sites: Record<string, { deviceCount: number; metricCount: number }>;
  totalMetrics: number;
}

export interface AnomalyRecord {
  time: string;
  site: string;
  device: string;
  type: string;
  description: string;
  severity: "low" | "medium" | "high";
}

/** MCP tool call / result. */
export interface MCPToolCall {
  name: string;
  arguments: Record<string, unknown>;
}

export interface MCPToolResult {
  tool: string;
  content: string | unknown;
  error?: string;
}
