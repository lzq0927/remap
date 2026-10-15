import { expect, test } from "vitest";
import { auditMechanismSummary } from "../src/audit-mechanism-view";
test("describes actual selected capabilities and deduplicates fixed deployments", () => {
  const summary = auditMechanismSummary({
    mechanisms: ["process", "fast", "process"],
    baseline: { mechanisms: ["process", "hardDetect"] },
  });
  expect(summary.count).toBe(3);
  expect(summary.candidates).toEqual(["fast"]);
  expect(summary.deployed).toEqual(["process", "hardDetect"]);
  expect(summary.features).toEqual(["恢复", "检测", "检查点"]);
  expect(summary.title).toContain("3项措施");
  expect(summary.roles).toBe("固定部署2项 · 组合候选1项");
});
test("describes the base model when no additional mechanisms are selected", () => {
  const summary = auditMechanismSummary({ mechanisms: [] });
  expect(summary.count).toBe(0);
  expect(summary.title).toBe("基础模型 · 未选附加措施");
  expect(summary.names).toEqual([]);
});
