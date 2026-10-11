import { useState } from "react";

export interface CatalogFieldsProps {
  kind: string;
  value: string;
  onChange: (value: string) => void;
  readOnly?: boolean;
}
const bases = [
  ["device-hour", "设备小时"],
  ["job-hour", "作业小时"],
  ["call", "每次调用"],
  ["task", "每个任务"],
] as const;
const fitSlots = ["HBM", "GPU", "网络", "其他"];
export const catalogPatchFields = [
  ["hardDetect", "硬故障检测率（%）"],
  ["slowDetect", "亚健康检测率（%）"],
  ["silentDetect", "静默错误检测率（%）"],
  ["hardSeconds", "硬故障检测/暂停（秒）"],
  ["fallbackMinutes", "失败回退（分钟）"],
  ["slowMinutes", "亚健康检测（分钟）"],
  ["globalMinutes", "全局恢复（分钟）"],
  ["localMinutes", "局部恢复（分钟）"],
  ["silentMinutes", "静默错误恢复（分钟）"],
  ["silentFallbackHours", "静默恢复失败回退（小时）"],
  ["intervalSeconds", "检查点计算间隔（秒）"],
  ["saveSeconds", "检查点保存（秒）"],
  ["reconfigureSeconds", "重新配置（秒）"],
  ["recoveryDomains", "恢复域数"],
  ["repairSlots", "并行恢复槽位"],
  ["silentLocatePct", "静默定位成功率（%）"],
  ["cleanVerifyPct", "恢复验证成功率（%）"],
  ["silentRecoveryPct", "静默恢复成功率（%）"],
  ["silentMonitorPct", "监控开销（%）"],
] as const;
const object = (x: unknown): x is Record<string, any> =>
  !!x && typeof x === "object" && !Array.isArray(x);
export function parseCatalogFields(value: string): Record<string, any> {
  const payload: unknown = JSON.parse(value);
  if (!object(payload)) throw new Error("资产内容必须是 JSON 对象");
  return payload;
}
/** Changes one explicit field; preserves every other field, including nested metadata. */
export function editCatalogField(
  value: string,
  path: string[],
  next: unknown,
): string {
  const payload = parseCatalogFields(value);
  if (
    !path.length ||
    path.some((key) => ["__proto__", "constructor", "prototype"].includes(key))
  )
    throw new Error("字段路径无效");
  let cursor = payload;
  for (const key of path.slice(0, -1)) {
    if (cursor[key] !== undefined && !object(cursor[key]))
      throw new Error("现有字段不是对象，请在完整 JSON 中编辑：" + key);
    cursor[key] ??= {};
    cursor = cursor[key];
  }
  const key = path.at(-1)!;
  if (next === undefined) delete cursor[key];
  else cursor[key] = next;
  return JSON.stringify(payload, null, 2);
}
/** FIT only uses device-hour. Removing a FIT also removes its obsolete fits binding. */
export function editFailureBasis(value: string, basis: string): string {
  if (basis && !bases.some(([id]) => id === basis))
    throw new Error("不支持的发生率口径");
  const payload = parseCatalogFields(value);
  if (basis) payload.rateBasis = basis;
  else delete payload.rateBasis;
  if (basis !== "device-hour") {
    delete payload.fit;
    if (payload.modelBinding?.array === "fits") delete payload.modelBinding;
  }
  return JSON.stringify(payload, null, 2);
}
export function editFitsBinding(value: string, index?: number): string {
  const payload = parseCatalogFields(value);
  if (index === undefined) delete payload.modelBinding;
  else {
    if (
      !Number.isInteger(index) ||
      index < 0 ||
      index > 3 ||
      payload.rateBasis !== "device-hour"
    )
      throw new Error("只有设备小时 FIT 可绑定 HBM/GPU/网络/其他");
    payload.modelBinding = {
      ...(object(payload.modelBinding) ? payload.modelBinding : {}),
      array: "fits",
      index,
    };
    delete payload.modelBinding.field;
    delete payload.modelBinding.value;
  }
  return JSON.stringify(payload, null, 2);
}
export function editCatalogPatch(
  value: string,
  field: string,
  next?: number,
): string {
  if (
    !catalogPatchFields.some(([id]) => id === field) ||
    (next !== undefined && (!Number.isFinite(next) || next < 0))
  )
    throw new Error("请选择明确的模型字段与非负数值");
  if (next !== undefined && /Detect$|Pct$/.test(field) && next > 100)
    throw new Error("检测率、成功率和开销百分比必须在 0–100 之间");
  if (
    next !== undefined &&
    ["recoveryDomains", "repairSlots"].includes(field) &&
    (!Number.isInteger(next) || (field === "recoveryDomains" && next < 1))
  )
    throw new Error("恢复域数须为正整数，恢复槽位须为非负整数");
  return editCatalogField(value, ["patch", field], next);
}

export default function CatalogFields({
  kind,
  value,
  onChange,
  readOnly = false,
}: CatalogFieldsProps) {
  const [patchField, setPatchField] = useState("");
  const [patchValue, setPatchValue] = useState("");
  const [error, setError] = useState("");
  let payload: Record<string, any>;
  try {
    payload = parseCatalogFields(value);
  } catch {
    return (
      <p className="note">
        请先在完整 JSON 中填写合法对象，再使用字段编辑。原内容没有被覆盖。
      </p>
    );
  }
  const change = (fn: () => string) => {
    if (readOnly) return;
    try {
      onChange(fn());
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const edit = (path: string[], next: unknown) =>
    change(() => editCatalogField(value, path, next));
  const numberField = (
    label: string,
    path: string[],
    current: unknown,
    disabled = false,
  ) => (
    <label key={path.join(".")}>
      {label}
      <input
        type="number"
        min="0"
        step="any"
        value={typeof current === "number" ? current : ""}
        disabled={disabled}
        onChange={(e) =>
          edit(path, e.target.value === "" ? undefined : Number(e.target.value))
        }
      />
    </label>
  );
  const textField = (label: string, path: string[], current: unknown) => (
    <label>
      {label}
      <input
        value={typeof current === "string" ? current : ""}
        onChange={(e) => edit(path, e.target.value || undefined)}
      />
    </label>
  );
  const selectField = (
    label: string,
    path: string[],
    current: unknown,
    options: ReadonlyArray<readonly [string, string]>,
  ) => (
    <label>
      {label}
      <select
        value={typeof current === "string" ? current : ""}
        onChange={(e) => edit(path, e.target.value || undefined)}
      >
        <option value="">未指定</option>
        {typeof current === "string" &&
          current &&
          !options.some(([id]) => id === current) && (
            <option value={current}>{current}（现有值）</option>
          )}
        {options.map(([id, name]) => (
          <option key={id} value={id}>
            {name}
          </option>
        ))}
      </select>
    </label>
  );
  const sourceIsObject = object(payload.source);
  const conditionsIsObject = object(payload.conditions);
  return (
    <section aria-label="资产基础字段">
      <h3>基础字段与模型映射</h3>
      {readOnly && (
        <p className="note">当前版本只读。需要修改时，请复制为新版本。</p>
      )}
      <fieldset
        disabled={readOnly}
        style={{ border: 0, padding: 0, margin: 0 }}
      >
        {kind === "failure-mode" && (
          <>
            <div className="fields">
              <label>
                发生率口径
                <select
                  value={payload.rateBasis ?? ""}
                  onChange={(e) =>
                    change(() => editFailureBasis(value, e.target.value))
                  }
                >
                  <option value="">未指定</option>
                  {payload.rateBasis &&
                    !bases.some(([id]) => id === payload.rateBasis) && (
                      <option value={payload.rateBasis}>
                        {payload.rateBasis}（现有值）
                      </option>
                    )}
                  {bases.map(([id, name]) => (
                    <option key={id} value={id}>
                      {name} · {id}
                    </option>
                  ))}
                </select>
              </label>
              {numberField(
                "FIT（每十亿设备小时）",
                ["fit"],
                payload.fit,
                payload.rateBasis !== "device-hour",
              )}
              {numberField("发生率（按所选暴露口径）", ["rate"], payload.rate)}
              {selectField("故障影响范围", ["scope"], payload.scope, [
                ["card", "单卡"],
                ["server", "服务器"],
                ["rack", "机架"],
                ["job", "作业"],
              ])}
              {numberField(
                "恢复耗时说明（秒）",
                ["recoverySeconds"],
                payload.recoverySeconds,
              )}
              <label>
                明确绑定训练 FIT 分量
                <select
                  disabled={payload.rateBasis !== "device-hour"}
                  value={
                    payload.modelBinding?.array === "fits"
                      ? String(payload.modelBinding.index)
                      : ""
                  }
                  onChange={(e) =>
                    change(() =>
                      editFitsBinding(
                        value,
                        e.target.value === ""
                          ? undefined
                          : Number(e.target.value),
                      ),
                    )
                  }
                >
                  <option value="">不绑定模型</option>
                  {fitSlots.map((name, index) => (
                    <option key={index} value={index}>
                      {name} · fits[{index}]
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <p className="note">
              FIT 仅适用设备小时。切换到作业、调用、任务或未指定口径会清除 FIT
              和对应 fits
              绑定；不会换算或自动填充软件发生率。请填写新的发生率与证据。恢复耗时说明不会自动改变求解参数。
            </p>
            {payload.modelBinding && payload.modelBinding.array !== "fits" && (
              <p className="note">
                现有其他模型绑定已保留在完整 JSON 中；选择 FIT
                分量会明确替换该绑定。
              </p>
            )}
          </>
        )}
        {kind === "mechanism" && (
          <>
            <div className="fields">
              {textField("机制说明", ["description"], payload.description)}
              {textField(
                "检测说明（资料）",
                ["detectionDescription"],
                payload.detectionDescription,
              )}
              {textField(
                "恢复与失败回退说明（资料）",
                ["recoveryDescription"],
                payload.recoveryDescription,
              )}
            </div>
            <p className="note">
              说明文字仅作为资料。只有明确的 patch
              字段被应用到训练模型后才影响计算；已有未知补丁字段会保留在完整
              JSON 中。
            </p>
            <div className="fields">
              {catalogPatchFields
                .filter(([field]) => Object.hasOwn(payload.patch ?? {}, field))
                .map(([field, label]) =>
                  numberField(label, ["patch", field], payload.patch[field]),
                )}
            </div>
            <div className="fields">
              <label>
                新增模型补丁字段
                <select
                  value={patchField}
                  onChange={(e) => {
                    setPatchField(e.target.value);
                    setPatchValue("");
                  }}
                >
                  <option value="">请选择参数及单位</option>
                  {catalogPatchFields.map(([field, label]) => (
                    <option key={field} value={field}>
                      {label} · {field}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                明确的补丁数值
                <input
                  type="number"
                  min="0"
                  step="any"
                  value={patchValue}
                  disabled={!patchField}
                  onChange={(e) => setPatchValue(e.target.value)}
                />
              </label>
            </div>
            <button
              type="button"
              disabled={!patchField || patchValue === ""}
              onClick={() =>
                change(() =>
                  editCatalogPatch(value, patchField, Number(patchValue)),
                )
              }
            >
              写入明确模型补丁
            </button>
          </>
        )}
        {kind === "parameter-evidence" && (
          <div className="fields">
            {numberField(
              "参数数值（复杂分布保留在完整 JSON）",
              ["value"],
              payload.value,
            )}
            {textField("参数单位", ["unit"], payload.unit)}
            {selectField("证据暴露口径", ["basis"], payload.basis, bases)}
          </div>
        )}
        <div className="fields">
          {selectField("证据状态", ["evidenceStatus"], payload.evidenceStatus, [
            ["unverified", "未验证"],
            ["illustrative", "示例"],
            ["assumed", "假设"],
            ["measured", "实测"],
            ["validated", "已验证"],
          ])}
          {textField(
            "来源资料",
            sourceIsObject ? ["source", "document"] : ["source"],
            sourceIsObject
              ? (payload.source.document ?? payload.source.file)
              : payload.source,
          )}
          {sourceIsObject &&
            textField(
              "来源定位（页 / 行 / 单元格）",
              ["source", "location"],
              payload.source.location,
            )}
          {textField(
            "适用条件说明",
            conditionsIsObject ? ["conditions", "notes"] : ["conditions"],
            conditionsIsObject ? payload.conditions.notes : payload.conditions,
          )}
        </div>
        <p className="note">
          原有来源页码、单元格、适用条件、引用和其他字段均保留在完整 JSON
          中。未填写的数值不会补零；上述编辑只改变草稿，应用与发布仍需校验。
        </p>
      </fieldset>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
    </section>
  );
}
