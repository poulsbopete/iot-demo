/**
 * Deterministic IoT metric simulator for Ecolab-style equipment.
 * Produces gauge/counter metrics with optional anomaly injection.
 */

import type {
  SiteName,
  DeviceType,
  Region,
  MetricPoint,
  MetricBatch,
  AnomalyType,
} from "./types";

const SITES: { id: string; name: SiteName; region: Region }[] = [
  { id: "site-hospital-01", name: "Hospital", region: "NA" },
  { id: "site-restaurant-01", name: "Restaurant", region: "EMEA" },
  { id: "site-foodplant-01", name: "FoodPlant", region: "APAC" },
];

const DEVICE_TYPES: DeviceType[] = [
  "ChemicalDosingPump",
  "Dishwasher",
  "WaterSystem",
];

/** Seeded PRNG (Mulberry32) for deterministic randomness. */
function createSeededRandom(seed: number): () => number {
  return function next() {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0; // mulberry32
    const t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    return ((t ^ (t >>> 15)) >>> 0) / 4294967296;
  };
}

function attr(
  siteId: string,
  siteName: string,
  region: string,
  deviceType: string,
  deviceId: string
): Record<string, string> {
  return {
    "site.id": siteId,
    "site.name": siteName,
    "region": region,
    "device.type": deviceType,
    "device.id": deviceId,
  };
}

function point(
  name: string,
  value: number,
  timestamp: number,
  attributes: Record<string, string>
): MetricPoint {
  return {
    name,
    value,
    timestamp,
    attributes: { ...attributes } as Record<string, string | number>,
  };
}

export interface SimulatorOptions {
  seed?: number;
  injectAnomaly?: AnomalyType;
  stepIndex?: number;
}

/**
 * Generate one batch of metrics for all sites and device types.
 * Deterministic when seed is fixed; stepIndex advances time-based variance.
 */
export function generateMetricBatch(options: SimulatorOptions = {}): MetricBatch {
  const seed = options.seed ?? Number(process.env.DEMO_SEED ?? 42);
  const stepIndex = options.stepIndex ?? 0;
  const injectAnomaly = options.injectAnomaly;
  const rng = createSeededRandom(seed + stepIndex * 7919);
  const metrics: MetricPoint[] = [];
  const anomaliesInjected: string[] = [];
  const now = Date.now();

  for (const site of SITES) {
    for (const deviceType of DEVICE_TYPES) {
      const deviceId = `${site.id}-${deviceType}-${Math.floor(rng() * 3) + 1}`;
      const attrs = attr(
        site.id,
        site.name,
        site.region,
        deviceType,
        deviceId
      );

      // Base variance per step (deterministic)
      const t = stepIndex * 0.1 + rng() * 0.5;
      const cycleCount = Math.floor(stepIndex * 2 + rng() * 3);

      if (deviceType === "ChemicalDosingPump") {
        let dosingRate = 0.8 + rng() * 0.4;
        let tankLevel = 70 + rng() * 25;
        let conductivity = 1200 + rng() * 400;
        let status = 1;

        if (injectAnomaly === "underdosing") {
          dosingRate *= 0.2;
          conductivity *= 0.3;
          anomaliesInjected.push("underdosing");
        }
        if (injectAnomaly === "pump_failure") {
          status = 0;
          dosingRate = 0;
          anomaliesInjected.push("pump_failure");
        }
        if (injectAnomaly === "tank_leak") {
          tankLevel = Math.max(5, tankLevel - 25 - rng() * 15);
          anomaliesInjected.push("tank_leak");
        }

        metrics.push(point("chemical.dosing_rate_lpm", dosingRate, now, attrs));
        metrics.push(point("chemical.tank_level_pct", tankLevel, now, attrs));
        metrics.push(point("chemical.conductivity_uS", conductivity, now, attrs));
        metrics.push(point("device.status", status, now, attrs));
      }

      if (deviceType === "Dishwasher") {
        let waterTemp = 55 + rng() * 15;
        let sanitizerPpm = 45 + rng() * 25;
        let status = 1;

        if (injectAnomaly === "thermal_high") {
          waterTemp = 85 + rng() * 10;
          anomaliesInjected.push("thermal_high");
        }
        if (injectAnomaly === "thermal_low") {
          waterTemp = 35 + rng() * 5;
          anomaliesInjected.push("thermal_low");
        }
        if (injectAnomaly === "underdosing") {
          sanitizerPpm *= 0.25;
          anomaliesInjected.push("underdosing");
        }
        if (injectAnomaly === "pump_failure") {
          status = 0;
          sanitizerPpm = 0;
          anomaliesInjected.push("pump_failure");
        }

        metrics.push(point("sanitation.cycle_count", cycleCount, now, attrs));
        metrics.push(point("sanitation.water_temp_c", waterTemp, now, attrs));
        metrics.push(point("sanitation.sanitizer_ppm", sanitizerPpm, now, attrs));
        metrics.push(point("device.status", status, now, attrs));
      }

      if (deviceType === "WaterSystem") {
        let ph = 7.0 + (rng() - 0.5) * 0.8;
        let conductivity = 800 + rng() * 300;
        let flowRate = 12 + rng() * 8;
        let status = 1;

        if (injectAnomaly === "pump_failure") {
          status = 0;
          flowRate = 0;
          anomaliesInjected.push("pump_failure");
        }

        metrics.push(point("water.ph", ph, now, attrs));
        metrics.push(point("water.conductivity_uS", conductivity, now, attrs));
        metrics.push(point("water.flow_rate_lpm", flowRate, now, attrs));
        metrics.push(point("device.status", status, now, attrs));
      }
    }
  }

  return {
    metrics,
    stepIndex,
    anomaliesInjected: anomaliesInjected.length ? anomaliesInjected : undefined,
  };
}

/** Get list of site names for UI. */
export function getSiteNames(): SiteName[] {
  return SITES.map((s) => s.name);
}

/** Get list of metric names for UI. */
export const METRIC_NAMES = [
  "chemical.dosing_rate_lpm",
  "chemical.tank_level_pct",
  "chemical.conductivity_uS",
  "sanitation.cycle_count",
  "sanitation.water_temp_c",
  "sanitation.sanitizer_ppm",
  "water.ph",
  "water.conductivity_uS",
  "water.flow_rate_lpm",
  "device.status",
] as const;

export type MetricName = (typeof METRIC_NAMES)[number];
