import { expect, it } from "vitest";
import { audit, getAuditDefaults } from "../../analysis/src/audit";
import { auditExperiment } from "../../analysis/src/audit-experiments";
import { auditExperimentPlan } from "../../analysis/src/audit-experiment-plan";
import { architectureReport } from "../src/audit-architecture";
import {
  compareAuditExperiments,
  experimentSections,
} from "../src/audit-experiments";
import { report } from "../src/render";

function fixture() {
  const input = {
    ...getAuditDefaults(),
    hours: 24,
    trials: 8,
    attributionTrials: 4,
    verificationTrials: 4,
    scales: [500000, 200000, 100000, 10000],
    sensitivity: false,
  };
  input.architecture.nodes[1].name = '计算层 <script>alert("x")</script>';
  input.architecture.dependencies.push({
    from: "object-CORE",
    to: "object-NIC",
    label: "共享网络",
    source: "项目待确认依赖",
  });
  const result = audit(input);
  return {
    id: "first",
    inputHash: "frozen",
    createdAt: "2026-10-16",
    input,
    result,
  };
}
it("exports architecture, cross-scale gaps, rankings, recovery semantics and escaped evidence", () => {
  const source = fixture();
  const html = report(
    {
      id: "first",
      operation: "audit",
      status: "succeeded",
      result: source.result,
    } as any,
    "html",
  );
  expect(html).toContain("系统分层目标与现状诊断");
  expect(html).toContain("不同规模的措施贡献排序");
  expect(html).toContain("各规模的分层损失与目标差距");
  expect(html).toContain("恢复停机 / 次（秒）");
  expect(html).toContain("项目待确认依赖");
  expect(html).not.toContain('计算层 <script>alert("x")</script>');
  expect(html).toContain("计算层 &lt;script&gt;");
  expect(html.includes("不代表完整物理修复MTTR")).toBe(true);
  const md = report(
    {
      id: "first",
      operation: "audit",
      status: "succeeded",
      result: source.result,
    } as any,
    "md",
  );
  expect(md.includes("恢复停机/次 s")).toBe(true);
  expect(md.includes("中断MTBF h")).toBe(true);
});
it("keeps old snapshots without inventing a confirmed architecture", () => {
  expect(architectureReport({ request: { cards: 500000 } })).toContain(
    "本历史结果未保存分层诊断",
  );
});
it("traces scoped AGREE responsibility and retains separately executed scenario diagnostics in comparison", () => {
  const source = fixture();
  const plan = auditExperimentPlan({
    source,
    options: { enabled: true, screeningTrials: 4, exploreExtensions: false },
  });
  for (const scale of plan.allocations)
    expect(Math.abs(scale.responsibilityResidualHours)).toBeLessThan(1e-8);
  expect(
    experimentSections(plan).some(
      (s) => s.title === "分层薄弱点到机制的责任追溯",
    ),
  ).toBe(true);
  expect(plan.architectureDiagnosis).toEqual(
    source.result.architectureDiagnosis,
  );
  const changed = auditExperiment({
    source,
    name: "参数对照",
    configuration: {
      enabled: true,
      policy: { "C-FAST": { saveSeconds: 1.2 } },
      attributionTrials: 2,
      permutations: 2,
    },
  });
  expect(changed.architectureDiagnosis.version).toContain("incremental");
  const comparison = compareAuditExperiments([
    {
      id: source.id,
      inputHash: source.inputHash,
      createdAt: source.createdAt,
      status: "succeeded",
      result: source.result,
    },
    {
      id: "changed",
      inputHash: "changed-hash",
      createdAt: "2026-10-16",
      status: "succeeded",
      result: changed,
    },
  ] as any);
  const section = experimentSections(comparison).find(
    (s) => s.title === "各轮分层薄弱点比较",
  )!;
  expect(section.tables![0].scaleRows).toHaveLength(4);
  const html = report(
    {
      id: "compare",
      status: "succeeded",
      result: comparison,
    } as any,
    "html",
  );
  expect(html).toContain("各轮分层薄弱点比较");
  expect(html).toContain("参数对照");
});
