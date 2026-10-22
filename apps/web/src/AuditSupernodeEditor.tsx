import { useState } from "react";
import type { AuditArchitecture } from "../../../packages/contracts/src/audit-architecture";
import {
  supernodeCounts,
  supernodeTopologySchema,
  type SupernodeTopology,
} from "../../../packages/contracts/src/audit-topology-config";

const fields = {
  cardsPerSupernode: "每超节点卡数",
  cardsPerRack: "每机柜卡数",
  cardsPerNode: "每计算节点卡数",
  cardsPerBoard: "每计算板卡数",
  supernodesPerPod: "每Pod最大超节点数",
  scaleUpSwitchesPerRack: "每机柜高速互联交换机数",
  scaleOutLeavesPerSupernode: "每超节点跨域Leaf数",
  scaleOutSpinesPerPod: "每Pod跨域Spine数",
  opticalLinksPerNode: "每计算节点光链路数",
  opticalLinksPerSupernode: "每超节点跨域光链路数",
} as const;
export default function AuditSupernodeEditor({
  architecture: a,
  scales,
  onChange,
}: {
  architecture: AuditArchitecture;
  scales: number[];
  onChange: (a: AuditArchitecture) => void;
}) {
  const t = a.topology!;
  const [values, setValues] = useState<Record<string, string>>(
    Object.fromEntries(
      Object.keys(fields).map((k) => [
        k,
        String(t[k as keyof typeof fields] ?? ""),
      ]),
    ),
  );
  const [source, setSource] = useState(t.source),
    [error, setError] = useState("");
  return (
    <details className="supernode-editor">
      <summary>超节点密度、网络数量与跨规模推导</summary>
      <p className="note">
        1024卡是参考组网单元；实际评估卡数不强制取1024的整数倍。板、柜、节点密度是工程假设；交换机和光链路空白表示未知。显式填写的各规模数量优先于公式。
      </p>
      <div className="fields">
        {Object.entries(fields).map(([id, name]) => (
          <label key={id}>
            {name}
            <input
              type="number"
              min={id.startsWith("cards") || id === "supernodesPerPod" ? 1 : 0}
              step="1"
              aria-label={name}
              value={values[id]}
              onChange={(e) => setValues({ ...values, [id]: e.target.value })}
            />
          </label>
        ))}
      </div>
      <label>
        拓扑配置依据
        <textarea
          aria-label="拓扑配置依据"
          value={source}
          onChange={(e) => setSource(e.target.value)}
        />
      </label>
      <p className="note">
        光模块数=2×（节点数×每节点光链路数＋超节点数×每超节点跨域光链路数）；需排除链路重复与铜缆，并按实际BOM校准。改变拓扑数量后，仅显式启用的故障数量折算进入求解，源FIT保持其原证据口径。
      </p>
      <button
        type="button"
        onClick={() => {
          const parsed = supernodeTopologySchema.safeParse({
            ...t,
            source,
            ...Object.fromEntries(
              Object.entries(values).map(([k, v]) => [
                k,
                v === "" ? null : Number(v),
              ]),
            ),
          });
          if (!parsed.success) {
            setError(parsed.error.issues.map((i) => i.message).join("；"));
            return;
          }
          setError("");
          onChange({ ...a, topology: parsed.data });
        }}
      >
        保存超节点拓扑配置
      </button>
      {error && <p role="alert">{error}</p>}
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>评估规模</th>
              <th>节点 / 板</th>
              <th>使用中机柜</th>
              <th>超节点 / Pod</th>
              <th>整超节点预留容量</th>
            </tr>
          </thead>
          <tbody>
            {[...new Set([1000, 1024, ...scales])]
              .sort((a, b) => a - b)
              .map((c) => (
                <CountRow key={c} t={t} cards={c} />
              ))}
          </tbody>
        </table>
      </div>
      <p className="note">
        表内为拓扑公式推导，区域明细以“硬件组成与各规模数量”中的显式覆盖为准。预留的闲置容量不自动进入当前评估故障率。
      </p>
    </details>
  );
}
function CountRow({ t, cards }: { t: SupernodeTopology; cards: number }) {
  const q = supernodeCounts(t, cards);
  return (
    <tr>
      <th>{cards.toLocaleString()}卡</th>
      <td>
        {q.nodes.toLocaleString()} / {q.boards.toLocaleString()}
      </td>
      <td>{q.racks.toLocaleString()}</td>
      <td>
        {q.supernodes.toLocaleString()} / {q.pods.toLocaleString()}
      </td>
      <td>
        {q.provisionedCards.toLocaleString()}卡
        {q.tailCards > 0 && <small>末超节点使用{q.tailCards}卡</small>}
      </td>
    </tr>
  );
}
