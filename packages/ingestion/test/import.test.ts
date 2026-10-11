import { test, expect } from "vitest";
import { parseInput } from "../src/parser";
test("quoted CSV, source locations and JSON input stay structured", async () => {
  const csv = await parseInput(
    "modes.csv",
    Buffer.from('name,fit\n"GPU, HBM",1000'),
  );
  expect(csv.data[0]).toEqual({ name: "GPU, HBM", fit: "1000" });
  expect(csv.sources[0].row).toBe(2);
  const json = await parseInput(
    "system.json",
    Buffer.from('{"cards":10000,"target":0.99}'),
  );
  expect(json.data.cards).toBe(10000);
  expect(json.status).toBe("extracted");
});
test("image without provider returns explicit manual review rather than invented topology", async () => {
  const r = await parseInput(
    "architecture.png",
    Buffer.from("not a real image"),
  );
  expect(r.status).toBe("needs-input");
  expect(r.issues[0].code).toBe("AGENT_UNAVAILABLE");
});
