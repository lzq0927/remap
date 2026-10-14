import { parseModel, semanticHash } from "./validate";
import { hash } from "../../assets/src/hash";
import { compileStatic } from "./compile";
import { solveStatic } from "../../solvers/src/static";
import { getToolAdapter } from "./tools";
import type { ToolResult } from "./tool-contract";
import type { SavedModel } from "./schema";

export async function executeEngineering(input: {
  snapshot: SavedModel;
  caseId: string;
}) {
  if (
    input.snapshot.contentHash !== hash(input.snapshot.model) ||
    input.snapshot.semanticHash !== semanticHash(input.snapshot.model)
  )
    throw new Error("运行快照摘要不匹配");
  const model = parseModel(input.snapshot.model),
    c = model.cases.find((c) => c.id === input.caseId);
  if (!c) throw new Error("分析案例不存在");
  let result: ToolResult;
  let mapping: unknown[] = [],
    assumptions = c.assumptions;
  if (c.method === "rbd" || c.method === "fta") {
    const compiled = compileStatic(model, c.id),
      solved = solveStatic(compiled.input);
    mapping = compiled.mapping;
    assumptions = compiled.assumptions;
    result = {
      engine: "ReMAP reduced ordered BDD",
      version: "1",
      verdict: "computed",
      completed: true,
      scope: c.scope,
      metrics: { probability: solved.probability },
      trace: [],
      diagnostics: compiled.mapping.some((m) => m.excluded)
        ? ["当前为条件分析：范围外事件假定不发生"]
        : [],
      rawOutput: JSON.stringify(solved, null, 2),
      artifacts: [
        { name: "compiled.json", content: JSON.stringify(compiled, null, 2) },
      ],
    };
  } else {
    const request = {
      files: c.files,
      scope: c.scope,
      timeoutMs: 60000,
      metadata: {
        modelId: input.snapshot.id,
        revision: input.snapshot.revision,
        caseId: c.id,
        propertyRefs: c.propertyRefs,
        inputHash: hash({
          semanticHash: input.snapshot.semanticHash,
          caseId: c.id,
          files: c.files,
        }),
      },
    };
    result = await getToolAdapter(c.toolId ?? "", c.method).execute(request);
  }
  return {
    ...result,
    modelId: input.snapshot.id,
    revision: input.snapshot.revision,
    semanticHash: input.snapshot.semanticHash,
    caseId: c.id,
    method: c.method,
    metric: c.metric,
    assumptions,
    mapping,
    executionMode: "real",
    traceability: {
      properties: model.requirements.filter((r) =>
        c.propertyRefs.includes(r.id),
      ),
      bindings: c.bindings ?? [],
      entities: model.entities
        .filter((e) => c.entityRefs.includes(e.id))
        .map((e) => ({ id: e.id, name: e.name, sourceRefs: e.sourceRefs })),
    },
  };
}
