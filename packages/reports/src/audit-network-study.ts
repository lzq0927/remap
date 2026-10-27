import type { compareNetworkLayouts } from "../../analysis/src/audit-network-study";
const esc = (s: unknown) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
const pct = (n: number) => (n * 100).toFixed(5) + "%";
export function networkStudyHtml(r: ReturnType<typeof compareNetworkLayouts>) {
  return `<section class="network-study-result" aria-label="组网比较结果"><h4>L2平面结构可用度 · ${r.config.requiredPlanes} / ${r.config.planes} 平面必需</h4><p>${r.config.evidence === "demonstration" ? "方法演示 · 不能用于项目达标判断" : "项目输入 · 按所列模型假设计算"} · ${esc(r.config.source)}</p>
  <div class="atlas-table-wrap"><table><thead><tr><th>组网方案</th><th>L2数 / 超节点</th><th>BDD精确值</th><th>蒙特卡洛估计 / 95%区间</th><th>失败样本</th><th>${r.supernodes.toLocaleString()}个独立超节点连乘</th></tr></thead><tbody>${r.rows.map((v) => `<tr><th>${v.name}</th><td>${v.deviceCount}</td><td>${pct(v.availability)}</td><td>${pct(v.sample.availability)}<small>${pct(v.sample.interval95[0])} – ${pct(v.sample.interval95[1])}</small></td><td>${v.sample.failures} / ${v.sample.trials}</td><td>${pct(v.independentFleetAvailability)}</td></tr>`).join("")}</tbody></table></div>
  <p>BDD与蒙特卡洛计算同一成功条件。零失败样本不代表100%可用。跨柜收益依赖共因边界；增加路径不保证容量达标。</p>
  <details><summary>本次输入、成功门与模型边界</summary><p>单L2 ${r.config.deviceFit} FIT / 维修 ${r.config.deviceRepairHours} h；机柜共因 ${r.config.cabinetFit} FIT / 恢复 ${r.config.cabinetRepairHours} h；${r.config.cabinets}个柜；随机种子 ${r.config.seed}。</p><p>${r.config.opticsPerPath === undefined ? "历史模型未包含光模块及超节点内共享故障，不补造旧结果。" : `每路径光模块 ${r.config.opticsPerPath}个 × ${r.config.opticFit} FIT / 维修 ${r.config.opticRepairHours}h；超节点内共享故障 ${r.config.sharedFit} FIT / 恢复 ${r.config.sharedRepairHours}h。`}</p><ol>${r.assumptions.map((s) => `<li>${esc(s)}</li>`).join("")}</ol><p>版本：${r.method}。同柜方案同一平面两条分支共享机柜事件；跨柜方案分到相邻两柜，机柜故障同时影响所承载的所有平面。</p></details></section>`;
}
