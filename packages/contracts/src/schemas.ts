import Ajv from "ajv";
export const schemas = {
  run: {
    type: "object",
    required: ["operation", "input"],
    additionalProperties: false,
    properties: {
      executionId: { type: "string", minLength: 1 },
      inputRevision: { type: "integer", minimum: 0 },
      operation: {
        type: "string",
        enum: [
          "training",
          "rbd",
          "fta",
          "bdd",
          "ctmc",
          "allocate",
          "compare",
          "search",
          "sensitivity",
          "attribute",
          "estimateRate",
        ],
      },
      input: { type: "object" },
    },
  },
  catalog: {
    type: "object",
    required: ["kind", "name", "payload"],
    additionalProperties: false,
    properties: {
      kind: {
        enum: [
          "failure-mode",
          "mechanism",
          "parameter-evidence",
          "scenario-template",
          "validation-case",
          "incident",
        ],
      },
      name: { type: "string", minLength: 1, maxLength: 250 },
      payload: { type: "object" },
    },
  },
  input: {
    type: "object",
    required: ["name", "base64"],
    additionalProperties: false,
    properties: {
      name: { type: "string", minLength: 1, maxLength: 250 },
      base64: { type: "string", maxLength: 28000000 },
    },
  },
};
const ajv = new Ajv({ allErrors: true });
export const contractValidators = Object.fromEntries(
  Object.entries(schemas).map(([key, schema]) => [key, ajv.compile(schema)]),
);
