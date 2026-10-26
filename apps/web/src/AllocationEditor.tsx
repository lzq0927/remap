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
                {availability
                  ? "锁定目标（可留空）"
                  : data.method === "agree.classical"
                    ? "条件故障重要度 Eᵢ（0–1）"
                    : "任务重要度 Eᵢ（AGREE）"}
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
          : data.method === "agree.classical"
            ? "经典AGREE：Rᵢ=1−(1−R^(nᵢ/Σn))/Eᵢ。Eᵢ是子系统故障导致系统故障的条件重要度，不能直接填Shapley贡献。按∏[1−Eᵢ(1−Rᵢ)]复核设计目标；普通串联乘积不一定相等。"
            : "Equal 均分总体故障率预算；ARINC 按基线故障率等比缩放；NASA近似AGREE使用∏Rᵢ^Eᵢ，与经典条件式有区别。检测、恢复的实际效果需正向模型验证，不能用分配结果直接宣称达标。"}
      </p>
    </div>
  );
}
