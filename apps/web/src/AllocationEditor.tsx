import { pretty } from "./api";
export default function AllocationEditor({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  let data: any;
  try {
    data = JSON.parse(value);
  } catch {
    return <p className="note">请先修正高级输入中的 JSON。</p>;
  }
  if (!Array.isArray(data.items))
    return <p className="note">分配需要 items 模块列表。</p>;
  const availability = data.method === "availability";
  const edit = (index: number, key: string, text: string) => {
    const next = structuredClone(data);
    if (text === "") delete next.items[index][key];
    else next.items[index][key] = Number(text);
    onChange(pretty(next));
  };
  return (
    <div className="allocation-editor">
      <div className="fields">
        <label>
          子模型整体目标（0–1）
          <input
            type="number"
            min="0"
            max="1"
            step=".001"
            value={data.target ?? ""}
            onChange={(e) =>
              onChange(pretty({ ...data, target: Number(e.target.value) }))
            }
          />
        </label>
        <label>
          子模型任务窗口（小时）
          <input
            type="number"
            min="0.01"
            value={data.hours ?? ""}
            onChange={(e) =>
              onChange(pretty({ ...data, hours: Number(e.target.value) }))
            }
          />
        </label>
        <label>
          指标口径
          <select
            aria-label="分配指标口径"
            value={
              availability ? "steady-state-availability" : "task-reliability"
            }
            onChange={(e) =>
              onChange(
                pretty({
                  ...data,
                  metricId: e.target.value,
                  method:
                    e.target.value === "steady-state-availability"
                      ? "availability"
                      : "equal",
                  items: data.items.map((i: any) => {
                    const { locked: _l, bounds: _b, ...rest } = i;
                    return rest;
                  }),
                }),
              )
            }
          >
            <option value="task-reliability">
              无中断任务可靠度 · Equal / ARINC / AGREE
            </option>
            <option value="steady-state-availability">
              稳态可用度 · Availability 串联合成
            </option>
          </select>
        </label>
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>子模块</th>
              <th>
                {availability
                  ? "实测稳态可用度（0–1）"
                  : "基线故障率（次/小时）"}
              </th>
              <th>{availability ? "分配权重" : "复杂度 nᵢ（AGREE）"}</th>
              <th>
                {availability ? "锁定目标（可留空）" : "任务重要度 Eᵢ（AGREE）"}
              </th>
            </tr>
          </thead>
          <tbody>
            {data.items.map((i: any, index: number) => (
              <tr key={i.id}>
                <td>{i.name ?? i.id}</td>
                <td>
                  <input
                    aria-label={
                      (i.name ?? i.id) +
                      (availability ? "基线可用度" : "基线故障率")
                    }
                    type="number"
                    min="0"
                    max={availability ? 1 : undefined}
                    step="any"
                    value={
                      i[
                        availability ? "baselineAvailability" : "baselineRate"
                      ] ?? ""
                    }
                    onChange={(e) =>
                      edit(
                        index,
                        availability ? "baselineAvailability" : "baselineRate",
                        e.target.value,
                      )
                    }
                  />
                </td>
                <td>
                  <input
                    aria-label={
                      (i.name ?? i.id) + (availability ? "分配权重" : "复杂度")
                    }
                    type="number"
                    min="0"
                    step="any"
                    value={i[availability ? "weight" : "complexity"] ?? 1}
                    onChange={(e) =>
                      edit(
                        index,
                        availability ? "weight" : "complexity",
                        e.target.value,
                      )
                    }
                  />
                </td>
                <td>
                  <input
                    aria-label={
                      (i.name ?? i.id) +
                      (availability ? "锁定目标" : "任务重要度")
                    }
                    type="number"
                    min="0"
                    step="any"
                    value={
                      i[availability ? "locked" : "importance"] ??
                      (availability ? "" : 1)
                    }
                    onChange={(e) =>
                      edit(
                        index,
                        availability ? "locked" : "importance",
                        e.target.value,
                      )
                    }
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="note">
        {availability
          ? "缺少实测稳态可用度时显示未知，不能用 exp(−λT) 替代；独立串联假设需确认。"
          : "推荐 Equal 作为均分基线；有基线发生率时比较 ARINC，有复杂度/任务重要度时比较具名 AGREE。故障率必须属于相同任务口径，示例值需要替换。"}
      </p>
    </div>
  );
}
