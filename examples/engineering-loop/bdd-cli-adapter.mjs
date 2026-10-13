// Executable example of the administrator CLI contract, backed by the real ReMAP BDD.
// Node 24 strips the solver's TypeScript types. No model-controlled commands are executed.
import { solveStatic } from "../../packages/solvers/src/static.ts";
let text = "";
for await (const chunk of process.stdin) {
  text += chunk;
  if (text.length > 2_000_000) throw new Error("Input too large");
}
const input = JSON.parse(text),
  file = input.files.find((f) => f.name === "Static.json");
if (!file) throw new Error("Expected Static.json");
const solved = solveStatic(JSON.parse(file.content));
process.stdout.write(
  JSON.stringify({
    engine: "ReMAP BDD CLI example",
    version: "1",
    verdict: "computed",
    completed: true,
    scope: input.scope,
    metrics: { probability: solved.probability },
    trace: [],
    diagnostics: [],
    rawOutput: JSON.stringify(solved),
    artifacts: input.files,
  }),
);
