import type { Asset } from "../../contracts/src/types";
import { DomainError } from "../../contracts/src/errors";
export function applyBindings(input: Record<string, any>, assets: Asset[]) {
  const result = structuredClone(input);
  result.model = { ...input.model };
  const touched = new Map<string, string>();
  for (const a of assets) {
    const p = a.payload;
    if (p.conditions && !input.applicabilityConfirmed)
      throw new DomainError(
        "INPUT_UNCONFIRMED",
        "请确认机制适用条件：" + a.name,
      );
    const patch: Record<string, any> = { ...p.patch };
    const binding = p.modelBinding;
    if (binding) {
      if (binding.array === "fits") {
        if (
          !Number.isInteger(binding.index) ||
          binding.index < 0 ||
          binding.index > 3 ||
          typeof p.fit !== "number"
        )
          throw new DomainError("SCHEMA_INVALID", "FIT 字段映射无效");
        const fits = [...(result.model.fits ?? [])];
        fits[binding.index] = p.fit;
        patch.fits = fits;
      } else if (binding.field) {
        patch[binding.field] = binding.value ?? p.value;
      } else
        throw new DomainError(
          "SCHEMA_INVALID",
          "资产映射需提供 array/index 或 field",
        );
    }
    for (const [key, value] of Object.entries(patch)) {
      const conflictKey =
        key === "fits" && binding?.array === "fits"
          ? `fits.${binding.index}`
          : key;
      if (touched.has(conflictKey))
        throw new DomainError(
          "BINDING_CONFLICT",
          `资产 ${a.name} 与 ${touched.get(conflictKey)} 同时写入 ${conflictKey}`,
        );
      touched.set(conflictKey, a.name);
      result.model[key] = value;
    }
  }
  return result;
}
