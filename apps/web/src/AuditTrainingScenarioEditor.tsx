import { useState } from "react";
import {
  applyTrainingScenario,
  trainingScenarioPreset,
  trainingScenarioIssues,
  type TrainingScenario,
} from "../../../packages/contracts/src/audit-training-scenario";
import type { AuditRequest } from "../../../packages/analysis/src/audit";
import type { AuditEventView } from "../../../packages/contracts/src/audit-objects";
import AuditRecoveryBudget from "./AuditRecoveryBudget";
const fields: [keyof TrainingScenario, string, number?][] = [
  ["referenceCards", "MTBF参考卡数"],
  ["referenceAvailability", "场景参考可用度（%）", 1],
  ["checkpointSeconds", "检查点 / step周期（秒）"],
  ["saveSeconds", "保存阻塞（秒）"],
  ["detectionSeconds", "检测与调度（秒）"],
  ["communicationSeconds", "建链与通信（秒）"],
  ["constructionSeconds", "模型构建（秒）"],
  ["loadSeconds", "CKPT加载（秒）"],
  ["compilationSeconds", "算子编译执行（秒）"],
  ["detectionSuccess", "故障检出成功率（%）", 1],
  ["recoverySuccess", "自动恢复成功率（%）", 1],
  ["manualRecoveryHours", "失败后人工追加恢复（小时）"],
  ["sdcCoverage", "静默检出率（%，可调整）", 1],
  ["slowCoverage", "亚健康检出率（%）", 1],
  ["investigationHours", "人工排查时长（小时）"],
  ["slowDetectionSeconds", "亚健康发现秒数（参考300）"],
  ["sdcDetectionSeconds", "静默发现秒数（参考1）"],
  ["hardTimeoutSeconds", "中断漏检超时秒数（参考60）"],
];
export default function AuditTrainingScenarioEditor({
  request,
  events,
  onApply,
}: {
  request: AuditRequest;
  events: AuditEventView[];
  onApply: (r: AuditRequest) => void;
}) {
  const [s, set] = useState<TrainingScenario>(
    () => request.trainingScenario ?? trainingScenarioPreset("current"),
  );
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const patch = (v: Partial<TrainingScenario>) => {
    set({ ...s, ...v });
    setMessage("");
  };
  return (
    <details className="training-scenario-editor">
      <summary>600小时三档训练场景 · 现状 / 延长线 / 突破</summary>
      <p>
        固定600小时总窗口。当前万卡98.5%是现状参考；各需求规模默认共同目标为98.5%，技术增强后的结果可以高于目标。60%
        /
        82%是原始现状/延长线参考值；延长线与突破方案均按正式目标评估，默认50万卡98.5%。参数只是可调整的参考起点，未达标时可通过分配继续改善，再单独评估。每档分别运行，保留旧结果。
      </p>
      <label>
        场景模板
        <select
          aria-label="训练场景模板"
          value={s.id}
          onChange={(e) => {
            set(
              trainingScenarioPreset(e.target.value as TrainingScenario["id"]),
            );
            setMessage("");
            setError("");
          }}
        >
          <option value="current">现状</option>
          <option value="extension">延长线改进</option>
          <option value="breakthrough">突破性改进</option>
        </select>
      </label>
      <AuditRecoveryBudget request={request} scenario={s} />
      <details>
        <summary>其他规模的可用度参考值（可选，非计算结果）</summary>
        <div className="fields">
          {[
            ...new Set([
              request.cards,
              ...(request.scales ?? []),
              ...Object.keys(s.referenceAvailabilityByScale ?? {}).map(Number),
            ]),
          ]
            .filter((c) => c !== (s.referenceAvailabilityCards ?? 500000))
            .sort((a, b) => a - b)
            .map((c) => (
              <label key={c}>
                {c.toLocaleString()}卡参考可用度（%）
                <input
                  aria-label={`${c}卡参考可用度（%）`}
                  type="number"
                  min="0"
                  max="100"
                  step="any"
                  value={
                    s.referenceAvailabilityByScale?.[c] === undefined
                      ? ""
                      : Number(
                          (s.referenceAvailabilityByScale[c] * 100).toPrecision(
                            12,
                          ),
                        )
                  }
                  onChange={(e) => {
                    const referenceAvailabilityByScale = {
                      ...s.referenceAvailabilityByScale,
                    };
                    if (e.target.value === "")
                      delete referenceAvailabilityByScale[c];
                    else
                      referenceAvailabilityByScale[c] =
                        Number(e.target.value) / 100;
                    patch({ referenceAvailabilityByScale });
                  }}
                />
              </label>
            ))}
        </div>
        <p className="note">
          这些是各规模分别提供的参考点；不假定各规模采用相同MTTR，不强制拟合仿真结果。
        </p>
      </details>
      <div className="fields">
        <label>
          参考MTBF（分钟）
          <input
            aria-label="参考MTBF（分钟）"
            type="number"
            min="0.000001"
            step="any"
            value={Number((s.mtbfHours * 60).toPrecision(12))}
            onChange={(e) => patch({ mtbfHours: Number(e.target.value) / 60 })}
          />
          <small>现状万卡30小时 = 1800分钟；其他档在各自参考卡数下填写。</small>
        </label>
        <label>
          可用度参考卡数
          <input
            aria-label="可用度参考卡数"
            type="number"
            min="1"
            step="1"
            value={s.referenceAvailabilityCards ?? 500000}
            onChange={(e) =>
              patch({ referenceAvailabilityCards: Number(e.target.value) })
            }
          />
        </label>
        <label>
          场景名称
          <input
            aria-label="训练场景名称"
            value={s.name}
            onChange={(e) => patch({ name: e.target.value })}
          />
        </label>
        {fields.map(([key, label, max]) => (
          <label key={key}>
            {label}
            <input
              aria-label={label}
              type="number"
              min="0"
              max={max === 1 ? 100 : max}
              step="any"
              value={
                s[key] === null
                  ? ""
                  : max === 1
                    ? Number((Number(s[key]) * 100).toPrecision(12))
                    : String(s[key])
              }
              onChange={(e) =>
                patch({
                  [key]:
                    e.target.value === ""
                      ? null
                      : Number(e.target.value) / (max === 1 ? 100 : 1),
                })
              }
            />
          </label>
        ))}
      </div>
      <fieldset>
        <legend>MTBF参考范围的代际暴露</legend>
        <p>
          万卡保持×1，大规模可填写×2；只作用于下方选中的中断事件，其他存储、链路等在硬件配置中独立设置。未启用时沿用当前架构。
        </p>
        <label>
          <input
            type="checkbox"
            aria-label="按规模设置MTBF暴露"
            checked={!!s.exposureByScale}
            onChange={(e) =>
              patch({
                exposureByScale: e.target.checked
                  ? { 10000: 1, 100000: 2, 200000: 2, 500000: 2 }
                  : undefined,
              })
            }
          />
          启用MTBF范围的分规模暴露
        </label>
        {s.exposureByScale && (
          <div className="fields">
            {[10000, 100000, 200000, 500000].map((c) => (
              <label key={c}>
                {c / 10000}万卡
                <input
                  aria-label={`MTBF暴露倍率 ${c}`}
                  type="number"
                  min="0.001"
                  max="100"
                  step="0.1"
                  value={s.exposureByScale?.[c] ?? 1}
                  onChange={(e) =>
                    patch({
                      exposureByScale: {
                        ...s.exposureByScale,
                        [c]: Number(e.target.value),
                      },
                    })
                  }
                />
              </label>
            ))}
          </div>
        )}
      </fieldset>
      <label>
        MTBF故障范围
        <select
          aria-label="MTBF故障范围"
          value={s.mtbfEventIds.length ? "selected" : ""}
          onChange={(e) =>
            patch({
              mtbfEventIds:
                e.target.value === "all"
                  ? events.filter((e) => e.type === "hard").map((e) => e.id)
                  : e.target.value === "compute"
                    ? events
                        .filter(
                          (e) =>
                            e.type === "hard" &&
                            /^(CORE|SRAM|IOD|MEMP|MEMT|MODULE|CPU|DDR|SSD)-/.test(
                              e.id,
                            ),
                        )
                        .map((e) => e.id)
                    : [],
            })
          }
        >
          <option value="">请选择范围</option>
          {s.mtbfEventIds.length > 0 && (
            <option value="selected">
              已选{s.mtbfEventIds.length}类中断：{s.mtbfEventIds.join("、")}
            </option>
          )}
          <option value="all">全部已建模中断事件</option>
          <option value="compute">算力 / 内存 / 主机 / 本地存储中断事件</option>
        </select>
      </label>
      <label>
        人工排查的模型映射
        <select
          aria-label="人工排查映射"
          value={s.investigationMapping ?? ""}
          onChange={(e) =>
            patch({
              investigationMapping: (e.target.value ||
                null) as TrainingScenario["investigationMapping"],
            })
          }
        >
          <option value="">请选择映射假设</option>
          <option value="sdc-only">作为漏检静默的兜底发现时延</option>
          <option value="sdc-and-slow">同时作为漏检亚健康持续时长近似</option>
        </select>
      </label>
      <label>
        场景依据
        <textarea
          aria-label="训练场景依据"
          value={s.source}
          onChange={(e) => patch({ source: e.target.value })}
        />
      </label>
      <p className="note">
        载入后启用中断检测、亚健康检测、静默检测和检查点四个基础能力开关，参数以表中为准；可在可靠性措施步骤继续调整。MTBF只校准选中hard事件，其他故障FIT保持。模型构建、建链、加载、编译合成一次自动恢复；人工恢复在自动失败后追加。人工排查映射为漏检暴露时长，不另重复加一笔停机。其他未提供参数沿用当前模型并在报告保留快照。与基础参数相同的开关，其Shapley可能为零。
      </p>
      <label className="arch-toggle">
        <input
          type="checkbox"
          aria-label="确认训练场景映射"
          checked={s.assumptionsConfirmed}
          onChange={(e) => patch({ assumptionsConfirmed: e.target.checked })}
        />
        确认以上映射及继承参数；这些是评估假设，需产品验证
      </label>
      <button
        type="button"
        onClick={() => {
          try {
            const issues = trainingScenarioIssues(s, events);
            if (issues.length) throw Error(issues.join("；"));
            onApply(applyTrainingScenario(request, s, events));
            setError("");
            setMessage("场景已载入；请核对六阶段输入后单独运行评估。");
          } catch (e) {
            setError((e as Error).message);
          }
        }}
      >
        载入本档输入
      </button>
      <label>
        机制意图（由参数体现，不重复叠加收益）
        <textarea
          aria-label="训练场景机制意图"
          value={s.mechanismNotes ?? ""}
          onChange={(e) => patch({ mechanismNotes: e.target.value })}
        />
      </label>
      {error && <p role="alert">{error}</p>}
      {message && <p role="status">{message}</p>}
    </details>
  );
}
