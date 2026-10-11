/** Synthetic fields only. Install an independently reviewed enterprise mapper inside the intranet. */
export default {
  contractVersion: "1.0.0",
  id: "synthetic-enterprise",
  version: "1.0.0",
  map(data, source) {
    const rows = Array.isArray(data) ? data : data.faults;
    if (!Array.isArray(rows)) throw new Error("Expected explicit faults rows");
    const failureModes = rows.map((row, index) => ({
      name: row.synthetic_name,
      // Empty/missing rates stay absent. The core warns; they are never filled with zero.
      ...(row.synthetic_fit !== undefined && row.synthetic_fit !== ""
        ? { fit: row.synthetic_fit }
        : {}),
      ...(row.synthetic_basis ? { rateBasis: row.synthetic_basis } : {}),
      source: Array.isArray(data)
        ? source.sources?.[index]
        : { file: source.filename, pointer: `/faults/${index}` },
      // Preserve unknown columns and ambiguity flags for review instead of silently dropping them.
      importedRow: { ...row },
    }));
    const parameters = Array.isArray(data)
      ? []
      : (data.parameters ?? []).map((row, index) => ({
          modelField: row.synthetic_field,
          value: row.synthetic_value,
          unit: row.synthetic_unit,
          ...(row.synthetic_basis ? { rateBasis: row.synthetic_basis } : {}),
          source: { file: source.filename, pointer: `/parameters/${index}` },
          importedRow: { ...row },
        }));
    return {
      failureModes,
      parameters,
      ...(data.ambiguities ? { ambiguities: data.ambiguities } : {}),
    };
  },
};
