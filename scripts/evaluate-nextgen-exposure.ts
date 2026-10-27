import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { audit } from "../packages/analysis/src/audit";
const dir = process.argv[2] ?? "/workspace/artifacts/remap-refinement-20261027";
const base = JSON.parse(
  readFileSync(`${dir}/breakthrough-snapshot.json`, "utf8"),
);
const input = structuredClone(base.result.request);
input.trials = 256;
input.attributionTrials = 16;
for (const n of input.architecture.nodes) {
  const ids = n.eventIds.filter((id: string) =>
    ["STORAGE", "OPT", "NIC"].includes(id.split("-")[0]),
  );
  if (ids.length)
    n.exposure = {
      multipliers: { 10000: 1, 100000: 2, 200000: 2, 500000: 2 },
      eventIds: ids,
      source:
        "敏感性假设：共享存储、光模块、NIC等效暴露×2；待BOM验证，不代表单位器件FIT必然翻倍",
    };
}
const result = audit(input);
writeFileSync(
  `${dir}/nextgen-exposure-sensitivity.json`,
  JSON.stringify(
    {
      note: "独立敏感性场景；不覆盖三阶段曲线；与主样本区间重叠不能证明暴露翻倍无损",
      inputHash: createHash("sha256")
        .update(JSON.stringify(input))
        .digest("hex"),
      createdAt: new Date().toISOString(),
      result,
    },
    null,
    2,
  ),
);
console.log(
  result.rows
    .filter((r: any) => r.id === "combined")
    .map((r: any) => ({ cards: r.cards, statistics: r.statistics })),
);
