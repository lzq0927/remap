import { useState } from "react";
import type { AuditArchitecture } from "../../../packages/contracts/src/audit-architecture";
import { atlas950LayoutConflict } from "../../../packages/contracts/src/atlas950-evidence";
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
  supernodesPerPod: "每集群分组最大超节点数",
  scaleUpSwitchesPerRack: "每计算柜L1互联刀片数",
  interconnectRacksPerSupernode: "每超节点互联柜数",
  l2DevicesPerSupernode: "每超节点L2互联设备数",
  planesPerSupernode: "每超节点互联平面数",
  portsPerL1: "每L1刀片端口数",
  portsPerL2: "每L2设备端口数",
  ioBladesPerRack: "每计算柜IO刀片数",
  ubNicsPerIoBlade: "每IO刀片UB网卡数",
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
        1024卡是参考组网单元；实际评估卡数不强制取1024的整数倍。64模组/计算柜及L1/L2来自指定华为页面；板、节点密度和集群分组仍是工程假设；交换机和光链路空白表示未知。显式填写的各规模数量优先于公式。
      </p>
      <div className="topology-evidence-choice">
        <strong>互联柜部署参照</strong>
        <p>{atlas950LayoutConflict}</p>
        {[2, 4].map((count) => (
          <button
            type="button"
            key={count}
            onClick={() => {
              setValues({
                ...values,
                interconnectRacksPerSupernode: String(count),
                l2DevicesPerSupernode: "16",
              });
              setSource(
                t.source +
                  `；本次选择${count === 2 ? "正文2柜×8台L2" : "PDF图1的4柜×4台L2"}部署参照；原资料存在差异，待项目BOM确认。`,
              );
            }}
          >
            {count === 2 ? "采用正文：2柜 × 8台L2" : "采用图示：4柜 × 4台L2"}
          </button>
        ))}
        <small>
          只更新下方待保存配置；不改变源事件FIT。保存后按实际部署共同故障域验证。
        </small>
      </div>
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
                v === ""
                  ? t[k as keyof typeof t] === undefined
                    ? undefined
                    : null
                  : Number(v),
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
              <th>超节点 / 集群分组</th>
              <th>整超节点预留容量</th>
              <th>L1 / L2 / 互联柜</th>
              <th>IO刀片 / UB网卡</th>
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
      <td>
        {q.l1Blades ?? "待补"} / {q.l2Devices ?? "待补"} /{" "}
        {q.interconnectRacks ?? "待补"}
      </td>
      <td>
        {q.ioBlades ?? "待补"} / {q.ubNics ?? "待补"}
      </td>
    </tr>
  );
}
