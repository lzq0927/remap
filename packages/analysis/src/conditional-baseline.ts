/** A fixed scenario shared by every candidate and coalition, independent of product type. */
export interface ConditionalBaseline {
  mechanisms?: string[];
  resolvedEventIds?: string[];
  note?: string;
}
export function resolveConditionalBaseline<
  T extends { id: string; fit: number },
>(input: ConditionalBaseline | undefined, mechanismIds: string[], events: T[]) {
  if (
    input !== undefined &&
    (!input ||
      typeof input !== "object" ||
      Array.isArray(input) ||
      Object.keys(input).some(
        (k) => !["mechanisms", "resolvedEventIds", "note"].includes(k),
      ))
  )
    throw new Error("条件基线格式无效");
  const choices = (value: unknown, known: string[]) => {
    if (value === undefined) return [];
    if (
      !Array.isArray(value) ||
      new Set(value).size !== value.length ||
      value.some((id) => typeof id !== "string" || !known.includes(id))
    )
      throw new Error("条件基线必须选择不重复的已知故障或机制");
    return [...value] as string[];
  };
  const mechanisms = choices(input?.mechanisms, mechanismIds),
    ids = choices(
      input?.resolvedEventIds,
      events.map((e) => e.id),
    );
  if (
    input?.note !== undefined &&
    (typeof input.note !== "string" || input.note.length > 2000)
  )
    throw new Error("条件基线说明必须是最多2000字符的文字");
  return {
    active: !!(mechanisms.length || ids.length),
    mechanisms,
    resolvedEvents: events
      .filter((e) => ids.includes(e.id))
      .map((e) => ({ id: e.id, originalFit: e.fit })),
    note: input?.note ?? "",
    events: events.map((e) => (ids.includes(e.id) ? { ...e, fit: 0 } : e)),
  };
}

export function rankMarginalGains<
  T extends { id: string; statistics: { mean: number } },
>(rows: T[]) {
  return [...rows]
    .sort(
      (a, b) =>
        b.statistics.mean - a.statistics.mean || a.id.localeCompare(b.id),
    )
    .map((row, index) => ({ ...row, rank: index + 1 }));
}
