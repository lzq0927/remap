import { expect, test } from "vitest";
import { audit, getAuditDefaults } from "../../analysis/src/audit";
import { auditAtlas } from "../../analysis/src/audit-atlas";
import { networkStudyDemo } from "../../contracts/src/audit-network-study";
import { atlasStandaloneHtml } from "../src/audit-atlas";

test("auxiliary network inputs and results are frozen with a run, and exports read the snapshot", () => {
  const input = {
    ...getAuditDefaults(),
    cards: 10000,
    targets: {},
    hours: 8,
    trials: 4,
    attributionTrials: 2,
    verificationTrials: 2,
    sensitivity: false,
    scales: [10000],
  };
  input.architecture.networkStudy = {
    ...networkStudyDemo,
    trials: 1000,
    source: "演示 <script>bad()</script>",
  };
  const result = audit(input);
  expect(result.networkStudyResult!.rows).toHaveLength(3);
  const original = JSON.stringify(result.networkStudyResult);
  input.architecture.networkStudy.deviceFit = 1;
  expect(JSON.stringify(result.networkStudyResult)).toBe(original);
  const frozen = JSON.stringify(result);
  const html = atlasStandaloneHtml(
    auditAtlas({ result, events: result.events }, input.cards),
  );
  expect(html).toContain("L2平面结构可用度");
  expect(html).toContain("100000 FIT");
  expect(html).not.toContain("<script>bad()</script>");
  expect(html).toContain("&lt;script&gt;");
  expect(JSON.stringify(result)).toBe(frozen);
});

test("historical configuration without a network snapshot does not invent a historical calculation", () => {
  const input = getAuditDefaults();
  input.architecture.networkStudy = { ...networkStudyDemo, trials: 1000 };
  const preview = auditAtlas(
    {
      request: input,
      events: [],
      architecture: {
        ...input.architecture,
        nodes: input.architecture.nodes.map((n) => ({ ...n, eventIds: [] })),
      },
    },
    input.cards,
  );
  const html = atlasStandaloneHtml(preview);
  expect(html).toContain("尚无冻结结果");
  expect(html).not.toContain("BDD精确值");
});
