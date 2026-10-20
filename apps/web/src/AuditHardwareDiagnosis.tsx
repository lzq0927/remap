import { useState } from "react";
import type { AuditArchitectureDiagnosis } from "../../../packages/analysis/src/audit-architecture";
import {
  architectureHeatmap,
  architectureTree,
} from "../../../packages/reports/src/audit-architecture";
import {
  hardwareCss,
  hardwareDiagnosisDetail,
  hardwareFaultHeatmap,
  hardwareFrequencyRecovery,
  hardwareInventorySummary,
  hardwarePropagation,
} from "../../../packages/reports/src/audit-hardware";

export default function AuditHardwareDiagnosis({
  diagnosis: d,
  cards,
}: {
  diagnosis: AuditArchitectureDiagnosis;
  cards: number;
}) {
  const root = d.architecture.nodes.find((n) => !n.parentId)!;
  const [focus, setFocus] = useState(root.id);
  const node = d.architecture.nodes.find((n) => n.id === focus) ?? root;
  const children = d.architecture.nodes.filter((n) => n.parentId === node.id);
  const html = (value: string) => (
    <div dangerouslySetInnerHTML={{ __html: value }} />
  );
  return (
    <div className="hardware-focus" role="region" aria-label="硬件架构下钻">
      <style>{hardwareCss}</style>
      <div className="hardware-nav">
        <label>
          查看硬件层级
          <select
            aria-label="硬件诊断层级"
            value={node.id}
            onChange={(e) => setFocus(e.target.value)}
          >
            {d.architecture.nodes.map((n) => (
              <option value={n.id} key={n.id}>
                {n.name}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          disabled={!node.parentId}
          onClick={() => setFocus(node.parentId ?? root.id)}
        >
          返回上级
        </button>
        <button
          type="button"
          disabled={node.id === root.id}
          onClick={() => setFocus(root.id)}
        >
          返回集群
        </button>
      </div>
      <p className="note">
        点击架构模块下钻；也可用层级选择框操作。目标和现状为折算至业务口径的损失责任，灰色节点需要补充故障数据。
      </p>
      <div
        onClick={(e) => {
          const id = (e.target as HTMLElement).closest<HTMLElement>(
            "[data-node-id]",
          )?.dataset.nodeId;
          if (id) setFocus(id);
        }}
        dangerouslySetInnerHTML={{
          __html: architectureTree(d.architecture, d, cards, 1, node.id),
        }}
      />
      {children.length > 0 &&
        html(architectureHeatmap(d, "subsystem", node.id))}
      {html(hardwareFaultHeatmap(d, cards, node.id))}
      <details>
        <summary>按损失环节与恢复频率分析</summary>
        {html(hardwareFaultHeatmap(d, cards, node.id, "loss"))}
        {html(hardwareFrequencyRecovery(d, cards, node.id))}
      </details>
      {html(hardwareDiagnosisDetail(d, cards, node.id))}
      <details>
        <summary>当前对象的故障传播证据</summary>
        {html(hardwarePropagation(d, node.id))}
      </details>
      <details>
        <summary>查看各规模完整硬件数量</summary>
        {html(hardwareInventorySummary(d))}
      </details>
    </div>
  );
}
