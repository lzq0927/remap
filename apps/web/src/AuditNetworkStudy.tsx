import { useState } from "react";
import { compareNetworkLayouts } from "../../../packages/analysis/src/audit-network-study";
import {
  networkStudyDemo,
  networkStudySchema,
  type NetworkStudy,
} from "../../../packages/contracts/src/audit-network-study";
import { networkStudyHtml } from "../../../packages/reports/src/audit-network-study";

const fields = [
  ["planes", "配置平面数"],
  ["requiredPlanes", "业务所需平面数"],
  ["cabinets", "互联柜数量"],
  ["deviceFit", "单L2原始FIT"],
  ["deviceRepairHours", "L2维修时长 / h"],
  ["cabinetFit", "机柜共因FIT"],
  ["cabinetRepairHours", "机柜恢复时长 / h"],
  ["trials", "蒙特卡洛样本数"],
  ["seed", "随机种子"],
] as const;
export default function AuditNetworkStudy({
  saved,
  supernodes,
  onSave,
  referencePlanes,
  referenceCabinets,
}: {
  saved?: NetworkStudy;
  referencePlanes?: number | null;
  referenceCabinets?: number | null;
  supernodes: number;
  onSave?: (config?: NetworkStudy) => void;
}) {
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      fields.map(([id]) => [
        id,
        saved
          ? String(saved[id])
          : id === "planes" || id === "requiredPlanes"
            ? String(referencePlanes ?? "")
            : id === "cabinets"
              ? String(referenceCabinets ?? "")
              : "",
      ]),
    ),
  );
  const [source, setSource] = useState(saved?.source ?? "");
  const [evidence, setEvidence] = useState<NetworkStudy["evidence"]>(
    saved?.evidence ?? "project",
  );
  const [result, setResult] =
    useState<ReturnType<typeof compareNetworkLayouts>>();
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [running, setRunning] = useState(false);
  const invalidate = () => {
    setResult(undefined);
    setError("");
    setMessage("");
  };
  return (
    <section className="network-study" aria-label="组网辅助验证">
      <div className="network-study-intro">
        <div>
          <span className="workbench-eyebrow">STRUCTURAL STUDY</span>
          <h3>冗余能消除多少结构风险？</h3>
          <p>
            比较单L2、双L2同柜、双L2跨柜。先明确业务所需平面数，再用BDD与蒙特卡洛交叉核验。
          </p>
        </div>
        <span className="workbench-badge">独立辅助模型</span>
      </div>
      <div className="network-model-cards">
        {[
          ["01", "单路径", "平面 = L2 ∧ 机柜"],
          ["02", "同柜冗余", "平面 = (L2₁ ∨ L2₂) ∧ 同一机柜"],
          ["03", "跨柜冗余", "平面 = (L2₁ ∧ 柜A) ∨ (L2₂ ∧ 柜B)"],
        ].map(([i, name, formula]) => (
          <div key={i}>
            <small>{i}</small>
            <b>{name}</b>
            <code>{formula}</code>
          </div>
        ))}
      </div>
      <p className="note">
        当前架构参考：{referencePlanes ?? "待补"}个平面，
        {referenceCabinets ?? "待补"}
        个互联柜/超节点。下面可编辑辅助对照配置，不会自动回写部署。
      </p>
      <p className="note">
        使用原始设备故障率，不能填写已含保护收益的FABRIC残余FIT。输入为空时不生成预测。网络结构可用度不会覆盖训练可用度或自动改写故障库。
      </p>
      <button
        type="button"
        onClick={() => {
          setValues(
            Object.fromEntries(
              fields.map(([id]) => [
                id,
                String(
                  id === "planes" || id === "requiredPlanes"
                    ? Math.max(1, Math.min(8, referencePlanes ?? 8))
                    : id === "cabinets"
                      ? Math.max(2, Math.min(4, referenceCabinets ?? 2))
                      : networkStudyDemo[id],
                ),
              ]),
            ),
          );
          setSource(networkStudyDemo.source);
          setEvidence("demonstration");
          invalidate();
        }}
      >
        载入方法演示参数
      </button>
      <div className="network-study-fields">
        {fields.map(([id, label]) => (
          <label key={id}>
            {label}
            <input
              type="number"
              aria-label={label}
              value={values[id]}
              min={id.endsWith("Fit") ? 0 : 1}
              onChange={(e) => {
                setValues({ ...values, [id]: e.target.value });
                invalidate();
              }}
            />
          </label>
        ))}
      </div>
      <label>
        输入证据
        <select
          aria-label="组网输入证据"
          value={evidence}
          onChange={(e) => {
            setEvidence(e.target.value as NetworkStudy["evidence"]);
            invalidate();
          }}
        >
          <option value="project">项目数据 / 工程要求</option>
          <option value="demonstration">方法演示，非项目预测</option>
        </select>
      </label>
      <label className="network-study-source">
        数据来源与成功条件依据
        <textarea
          aria-label="组网数据来源"
          value={source}
          onChange={(e) => {
            setSource(e.target.value);
            invalidate();
          }}
          placeholder="逐器件FIT、维修时长、共同故障原因与所需平面数的依据"
        />
      </label>
      <div className="network-study-actions">
        <button
          type="button"
          disabled={running}
          onClick={async () => {
            setError("");
            setMessage("");
            if (fields.some(([id]) => values[id].trim() === "")) {
              setError(
                "请填写所有输入，未知值不能按零处理；也可显式载入方法演示。",
              );
              return;
            }
            const p = networkStudySchema.safeParse({
              version: "1",
              ...Object.fromEntries(
                fields.map(([id]) => [id, Number(values[id])]),
              ),
              source,
              evidence,
            });
            if (!p.success) {
              setError(
                p.error.issues
                  .map((i) => `${i.path.join(".")} ${i.message}`)
                  .join("；"),
              );
              return;
            }
            setRunning(true);
            await new Promise((resolve) => setTimeout(resolve, 25));
            try {
              setResult(compareNetworkLayouts(p.data, supernodes));
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setRunning(false);
            }
          }}
        >
          {running ? "正在交叉验证…" : "运行组网比较"}
        </button>
        {result && onSave && (
          <button
            type="button"
            onClick={() => {
              onSave(result.config);
              setMessage(
                "已保存到本轮架构输入。后续正式评估报告将保留此辅助验证的输入和结果。",
              );
            }}
          >
            保存本轮组网验证
          </button>
        )}
        {saved && onSave && (
          <button
            type="button"
            onClick={() => {
              onSave(undefined);
              setMessage("已移除本轮辅助验证配置，历史结果不变。");
            }}
          >
            移除已保存验证
          </button>
        )}
        {result && (
          <button
            type="button"
            onClick={() => {
              const url = URL.createObjectURL(
                new Blob([JSON.stringify(result, null, 2)], {
                  type: "application/json",
                }),
              );
              const link = document.createElement("a");
              link.href = url;
              link.download = "remap-network-study.json";
              link.click();
              setTimeout(() => URL.revokeObjectURL(url), 1000);
            }}
          >
            导出组网输入与结果JSON
          </button>
        )}
      </div>
      {error && <p role="alert">{error}</p>}
      {message && <p role="status">{message}</p>}
      {result && (
        <div dangerouslySetInnerHTML={{ __html: networkStudyHtml(result) }} />
      )}
      {!result && saved && (
        <p className="note">
          已保存输入已载入。点击运行可重现本次组网辅助验证；正式业务评估仍需在“计算与权衡”单独运行。
        </p>
      )}
    </section>
  );
}
