import { useState } from "react";
import {
  applyTrainingScenario,
  trainingScenarioPreset,
  trainingScenarioIssues,
  type TrainingScenario,
} from "../../../packages/contracts/src/audit-training-scenario";
import type { AuditRequest } from "../../../packages/analysis/src/audit";
import type { AuditEventView } from "../../../packages/contracts/src/audit-objects";
const fields: [keyof TrainingScenario, string, number?][] = [
  ["referenceCards", "MTBF参考卡数"],
  ["mtbfHours", "参考MTBF（小时）"],
  ["checkpointSeconds", "检查点 / step周期（秒）"],
  ["saveSeconds", "保存阻塞（秒）"],
  ["detectionSeconds", "检测与调度（秒）"],
  ["communicationSeconds", "建链与通信（秒）"],
  ["constructionSeconds", "模型构建（秒）"],
  ["loadSeconds", "CKPT加载（秒）"],
  ["compilationSeconds", "算子编译执行（秒）"],
  ["detectionSuccess", "故障检出成功率", 1],
  ["recoverySuccess", "自动恢复成功率", 1],
  ["manualRecoveryHours", "失败后人工追加恢复（小时）"],
  ["sdcCoverage", "静默检出率（99.x须明确）", 1],
  ["slowCoverage", "亚健康检出率", 1],
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
        固定600小时窗口，参考60% / 82% / 98.5%分别对应损失240 / 108 /
        9小时。参考百分比不写入计算结果。每档分别载入、确认、运行；旧结果保持。
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
      <div className="fields">
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
              max={max}
              step="any"
              value={s[key] === null ? "" : String(s[key])}
              onChange={(e) =>
                patch({
                  [key]: e.target.value === "" ? null : Number(e.target.value),
                })
              }
            />
          </label>
        ))}
      </div>
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
                            /^(CORE|SRAM|MEMP|MEMT|MODULE|CPU|DDR)-/.test(e.id),
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
          <option value="compute">计算 / 内存对象中断事件</option>
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
