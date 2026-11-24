/** 四步工作台的数值显示规则，界面与导出报告共用。 */
export const percent = (value: number, digits?: number) => {
  if (!Number.isFinite(value)) return "—";
  const auto = value >= 0.9995 && value < 1 ? 3 : 2;
  return (value * 100).toFixed(digits ?? auto) + "%";
};
/** 百分点差值，带正负号。 */
export const points = (value: number, digits = 2) =>
  (value >= 0 ? "+" : "−") + Math.abs(value * 100).toFixed(digits) + " pp";
export const hours = (value: number) => {
  if (!Number.isFinite(value)) return "—";
  const size = Math.abs(value),
    // 不到 0.01 小时的预算（如单独指定很高目标的模块）多留两位，避免显示成 0
    digits =
      size >= 100 ? 0 : size >= 10 ? 1 : size >= 0.01 || size === 0 ? 2 : 4;
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
  value > 0 && value < 1
    ? // 全系统只有几套的设施折算到每卡后远小于 1，保留两位有效数字
      String(Number(value.toPrecision(2)))
    : count(value, value > 0 && value < 100 ? 1 : 0);
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
/**
 * 故障频次，以周为粒度：每周不到 1 次的换成更直观的“每年几次”或“几年一次”。
 */
export const frequency = (perWeek: number) => {
  if (!Number.isFinite(perWeek)) return "—";
  if (perWeek <= 0) return "0";
  if (perWeek >= 100) return count(perWeek) + " 次/周";
  if (perWeek >= 0.95) return trim(perWeek, 1) + " 次/周";
  const perYear = perWeek * (8760 / 168);
  if (perYear >= 0.95) return trim(perYear, 1) + " 次/年";
  return trim(1 / perYear, 1) + " 年 1 次";
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
