import { useState } from "react";
import { parameterLabels } from "../../../packages/reports/src/audit-labels";
export function NumericParameters({
  value,
  onChange,
  prefix,
}: {
  value: Record<string, number>;
  onChange: (value: Record<string, number>) => void;
  prefix: string;
}) {
  return (
    <div className="fields">
      {Object.entries(value).map(([key, number]) => (
        <label key={key}>
          {parameterLabels[key] ?? key}
          <input
            aria-label={prefix + " · " + (parameterLabels[key] ?? key)}
            type="number"
            step="any"
            min={0}
            value={number}
            onChange={(e) =>
              onChange({ ...value, [key]: Number(e.target.value) })
            }
          />
        </label>
      ))}
    </div>
  );
}
export function EventEditor({
  events,
  value,
  onChange,
  title,
}: {
  events: any[];
  value: string;
  onChange: (s: string) => void;
  title: string;
}) {
  const [id, setId] = useState(events[0]?.id ?? "");
  const [fit, setFit] = useState("");
  const [source, setSource] = useState("");
  const [evidence, setEvidence] = useState("scenario");
  const [error, setError] = useState("");
  let rows: any[] = [];
  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed)) rows = parsed;
  } catch {
    /* advanced editor reports invalid JSON on submission */
  }
  const selected = events.find((e) => e.id === id);
  return (
    <fieldset className="event-editor">
      <legend>{title}</legend>
      <div className="fields">
        <label>
          事件
          <select
            aria-label={title + "事件"}
            value={id}
            onChange={(e) => setId(e.target.value)}
          >
            {events.map((e) => (
              <option key={e.id} value={e.id}>
                {e.id} · {e.description}
              </option>
            ))}
          </select>
        </label>
        <label>
          新 FIT
          <input
            aria-label={title + "FIT"}
            type="number"
            min={0}
            step="any"
            value={fit}
            placeholder={String(selected?.fit ?? "")}
            onChange={(e) => setFit(e.target.value)}
          />
        </label>
        <label>
          证据类型
          <select
            aria-label={title + "证据"}
            value={evidence}
            onChange={(e) => setEvidence(e.target.value)}
          >
            <option value="scenario">方案假设</option>
            <option value="internal-measured">内部观测</option>
            <option value="external-prior">外网先验</option>
          </select>
        </label>
        <label>
          数据来源
          <input
            aria-label={title + "来源"}
            value={source}
            placeholder="观测范围、时间或文档编号"
            onChange={(e) => setSource(e.target.value)}
          />
        </label>
      </div>
      <p className="note">
        参考 FIT {selected?.fit.toFixed(3)}；单位为每十亿 NPU
        等效运行小时。仅更新所选事件。
      </p>
      <button
        type="button"
        onClick={() => {
          try {
            const old = JSON.parse(value);
            if (!Array.isArray(old)) throw new Error("请先修正高级 JSON 数组");
            if (
              fit.trim() === "" ||
              !Number.isFinite(Number(fit)) ||
              Number(fit) < 0 ||
              !source.trim()
            )
              throw new Error("请填写非负 FIT 和数据来源");
            onChange(
              JSON.stringify(
                [
                  ...old.filter((e) => e.id !== id),
                  {
                    id,
                    fit: Number(fit),
                    source: source.trim(),
                    evidence,
                    rateBasis: "npu-equivalent-hour",
                  },
                ],
                null,
                2,
              ),
            );
            setError("");
          } catch (e) {
            setError((e as Error).message);
          }
        }}
      >
        加入更新
      </button>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {rows.length > 0 && (
        <ul className="event-updates">
          {rows.map((e) => (
            <li key={e.id}>
              <span>
                <strong>{e.id}</strong> → {e.fit} FIT · {e.source}
              </span>
              <button
                type="button"
                aria-label={"移除" + title + e.id}
                onClick={() =>
                  onChange(
                    JSON.stringify(
                      rows.filter((x) => x.id !== e.id),
                      null,
                      2,
                    ),
                  )
                }
              >
                移除
              </button>
            </li>
          ))}
        </ul>
      )}
    </fieldset>
  );
}
