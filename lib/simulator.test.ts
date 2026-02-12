import { describe, it, expect } from "vitest";
import { generateMetricBatch, getSiteNames, METRIC_NAMES } from "./simulator";

describe("simulator", () => {
  it("returns same metric count for same seed and stepIndex", () => {
    const a = generateMetricBatch({ seed: 123, stepIndex: 0 });
    const b = generateMetricBatch({ seed: 123, stepIndex: 0 });
    expect(a.metrics.length).toBe(b.metrics.length);
    expect(a.stepIndex).toBe(0);
    expect(b.stepIndex).toBe(0);
  });

  it("produces deterministic values for same seed", () => {
    const a = generateMetricBatch({ seed: 42, stepIndex: 1 });
    const b = generateMetricBatch({ seed: 42, stepIndex: 1 });
    expect(a.metrics.length).toBeGreaterThan(0);
    expect(a.metrics.length).toBe(b.metrics.length);
    const namesA = a.metrics.map((m) => `${m.name}:${m.value}`).sort();
    const namesB = b.metrics.map((m) => `${m.name}:${m.value}`).sort();
    expect(namesA).toEqual(namesB);
  });

  it("includes required attributes per point", () => {
    const batch = generateMetricBatch({ seed: 1, stepIndex: 0 });
    for (const m of batch.metrics) {
      expect(m.attributes["site.id"]).toBeDefined();
      expect(m.attributes["site.name"]).toBeDefined();
      expect(m.attributes["region"]).toBeDefined();
      expect(m.attributes["device.type"]).toBeDefined();
      expect(m.attributes["device.id"]).toBeDefined();
    }
  });

  it("includes expected metric names", () => {
    const batch = generateMetricBatch({ seed: 1, stepIndex: 0 });
    const names = [...new Set(batch.metrics.map((m) => m.name))];
    expect(names).toContain("chemical.dosing_rate_lpm");
    expect(names).toContain("chemical.tank_level_pct");
    expect(names).toContain("sanitation.sanitizer_ppm");
    expect(names).toContain("device.status");
  });

  it("inject underdosing lowers dosing and sanitizer", () => {
    const normal = generateMetricBatch({ seed: 99, stepIndex: 0 });
    const under = generateMetricBatch({ seed: 99, stepIndex: 0, injectAnomaly: "underdosing" });
    const dosingNormal = normal.metrics.filter((m) => m.name === "chemical.dosing_rate_lpm");
    const dosingUnder = under.metrics.filter((m) => m.name === "chemical.dosing_rate_lpm");
    expect(dosingUnder.length).toBeGreaterThan(0);
    const avgNormal = dosingNormal.reduce((s, m) => s + m.value, 0) / dosingNormal.length;
    const avgUnder = dosingUnder.reduce((s, m) => s + m.value, 0) / dosingUnder.length;
    expect(avgUnder).toBeLessThan(avgNormal);
    expect(under.anomaliesInjected).toContain("underdosing");
  });

  it("inject pump_failure sets device.status to 0", () => {
    const batch = generateMetricBatch({ seed: 1, stepIndex: 0, injectAnomaly: "pump_failure" });
    const statuses = batch.metrics.filter((m) => m.name === "device.status");
    expect(statuses.length).toBeGreaterThan(0);
    expect(statuses.some((m) => m.value === 0)).toBe(true);
    expect(batch.anomaliesInjected).toContain("pump_failure");
  });

  it("inject tank_leak reduces tank_level", () => {
    const normal = generateMetricBatch({ seed: 77, stepIndex: 0 });
    const leak = generateMetricBatch({ seed: 77, stepIndex: 0, injectAnomaly: "tank_leak" });
    const tankNormal = normal.metrics.filter((m) => m.name === "chemical.tank_level_pct");
    const tankLeak = leak.metrics.filter((m) => m.name === "chemical.tank_level_pct");
    const avgNormal = tankNormal.reduce((s, m) => s + m.value, 0) / tankNormal.length;
    const avgLeak = tankLeak.reduce((s, m) => s + m.value, 0) / tankLeak.length;
    expect(avgLeak).toBeLessThan(avgNormal);
    expect(leak.anomaliesInjected).toContain("tank_leak");
  });

  it("getSiteNames returns three sites", () => {
    const sites = getSiteNames();
    expect(sites).toContain("Hospital");
    expect(sites).toContain("Restaurant");
    expect(sites).toContain("FoodPlant");
    expect(sites.length).toBe(3);
  });

  it("METRIC_NAMES includes required metrics", () => {
    expect(METRIC_NAMES).toContain("chemical.dosing_rate_lpm");
    expect(METRIC_NAMES).toContain("sanitation.cycle_count");
    expect(METRIC_NAMES).toContain("water.ph");
    expect(METRIC_NAMES).toContain("device.status");
  });
});
