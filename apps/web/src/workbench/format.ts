/** 四步工作台的数值显示规则，界面与导出报告共用。 */
export const percent = (value: number, digits?: number) => {
  if (!Number.isFinite(value)) return "—";
  const auto = value >= 0.9995 && value < 1 ? 3 : 2;
  let precision = digits ?? auto;
  // Preserve a nonzero loss instead of rounding a five-nines target to 100%.
  while (
    value < 1 &&
    value >= 0 &&
    Number((value * 100).toFixed(precision)) === 100 &&
    precision < 12
  )
    precision++;
  return (value * 100).toFixed(precision) + "%";
};
/** 百分点差值，带正负号。 */
export const points = (value: number, digits = 2) =>
  (value >= 0 ? "+" : "−") + Math.abs(value * 100).toFixed(digits) + " pp";
export const hours = (value: number) => {
  if (!Number.isFinite(value)) return "—";
  if (Math.abs(value) > 0 && Math.abs(value) < 0.01)
    return Number(value.toPrecision(3)) + " h";
  const digits = Math.abs(value) >= 100 ? 0 : Math.abs(value) >= 10 ? 1 : 2;
  return value.toFixed(digits) + " h";
};
export const count = (value: number, digits = 0) =>
  Number.isFinite(value)
    ? value.toLocaleString("zh-CN", {
        maximumFractionDigits: digits,
        minimumFractionDigits: digits,
      })
    : "—";
export const fit = (value: number) =>
  count(value, value > 0 && value < 100 ? 1 : 0);
/** 时长自动选择秒、分钟、小时或天。 */
export const duration = (valueHours: number) => {
  if (!Number.isFinite(valueHours)) return "—";
  if (valueHours === 0) return "0";
  const seconds = valueHours * 3600;
  if (seconds < 90) return trim(seconds, seconds < 10 ? 1 : 0) + " 秒";
  if (valueHours < 1.5) return trim(valueHours * 60, 1) + " 分钟";
  if (valueHours < 72) return trim(valueHours, 1) + " 小时";
  return trim(valueHours / 24, 1) + " 天";
};
export const times = (value: number) =>
  !Number.isFinite(value)
    ? "∞"
    : value >= 100
      ? count(value) + "×"
      : value.toFixed(1) + "×";
export const scale = (cards: number) =>
  cards >= 10000 ? trim(cards / 10000, 1) + " 万卡" : count(cards) + " 卡";
function trim(value: number, digits: number) {
  return String(Number(value.toFixed(digits)));
}

/** 把内容保存为本地文件。链接需先挂到页面上，文件名才会生效。 */
export function saveFile(name: string, content: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type })),
    link = document.createElement("a");
  link.href = url;
  link.download = name.replace(/[\\/:*?"<>|]/g, "_");
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
