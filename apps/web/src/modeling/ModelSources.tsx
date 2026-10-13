import { useState } from "react";
import { useTaskApi } from "../api";
import type {
  EngineeringModel,
  Material,
} from "../../../../packages/modeling/src/schema";
import type { ModelEdit } from "./shared";
export default function ModelSources({
  model,
  edit,
  materials,
  onRefresh,
  onAgent,
  onError,
}: {
  model: EngineeringModel;
  edit: ModelEdit;
  materials: Material[];
  onRefresh: () => Promise<void>;
  onAgent: (question: string) => void;
  onError: (message: string) => void;
}) {
  const { api } = useTaskApi();
  const [question, setQuestion] = useState(
    "根据已导入的专家材料，核对当前架构、共享故障域和检查点恢复机制。保留原有性质，发现缺口先说明，提交有来源的工程模型修改草案。",
  );
  const [busy, setBusy] = useState(false);
  const upload = async (file: File) => {
    setBusy(true);
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      let s = "";
      for (const b of bytes) s += String.fromCharCode(b);
      const material: Material = await api("/engineering/materials", {
        name: file.name,
        base64: btoa(s),
        scope: "private",
      });
      edit((d) => d.sources.push(material));
      await onRefresh();
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <section>
      <div className="eng-source-intro">
        <h3>从专家材料开始</h3>
        <p>
          导入现有 PPT、设计说明或讨论记录，保留原文与位置。与 Agent
          讨论后，在草案区审阅模型变化。
        </p>
        <label className="eng-upload">
          导入 PPTX / Markdown / TXT / JSON
          <input
            aria-label="导入专家材料"
            type="file"
            accept=".pptx,.md,.txt,.json"
            disabled={busy}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void upload(f);
              e.target.value = "";
            }}
          />
        </label>
      </div>
      <label>
        交给 Agent 的建模问题
        <textarea
          aria-label="建模问题"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
        />
      </label>
      <button
        className="primary"
        disabled={busy || !question.trim()}
        onClick={() => onAgent(question)}
      >
        交给原生 Agent 辅助建模
      </button>
      <p className="note">
        请先保存已关联材料。Agent
        读取任务模型和材料，提交草案；确认后才更新设计。
      </p>
      <h4>当前模型来源</h4>
      {model.sources.map((s) => (
        <details key={s.id}>
          <summary>
            {s.name} · {s.scope === "synthetic" ? "合成示例" : s.scope} ·{" "}
            {s.segments.length} 个定位
          </summary>
          <p className="note">
            ID {s.id} · {s.contentHash}
          </p>
          <pre>{s.text}</pre>
        </details>
      ))}
      {materials
        .filter((m) => !model.sources.some((s) => s.id === m.id))
        .map((m) => (
          <div className="eng-relation" key={m.id}>
            <span>{m.name}</span>
            <button onClick={() => edit((d) => d.sources.push(m))}>
              关联到当前模型
            </button>
          </div>
        ))}
    </section>
  );
}
