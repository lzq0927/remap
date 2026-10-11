import { buildApp } from "./server";
import { loadEnvironment } from "../../../scripts/runtime.mjs";
loadEnvironment();
const app = await buildApp();
await app.listen({ host: "127.0.0.1", port: Number(process.env.PORT ?? 4178) });
console.log("Reliability API http://127.0.0.1:" + (process.env.PORT ?? 4178));
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.on(signal, async () => {
    await app.close();
    process.exit(0);
  });
