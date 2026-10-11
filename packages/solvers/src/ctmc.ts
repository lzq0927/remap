import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { delimiter } from "node:path";
export interface CtmcRequest {
  Q: number[][];
  p0: number[];
  times: number[];
  rewards?: number[];
  distribution?: "exponential";
}
export interface CtmcResult {
  solver: string;
  stationary: number[];
  stationaryReward: number;
  transient: Array<{ time: number; probabilities: number[]; reward: number }>;
  integratedReward: number;
  diagnostics: Record<string, number>;
  assumptions: string[];
}
export function solveCtmc(req: CtmcRequest): Promise<CtmcResult> {
  const supported = new Set(["Q", "p0", "times", "rewards", "distribution"]);
  for (const key of Object.keys(req))
    if (!supported.has(key))
      return Promise.reject(new Error("Unsupported CTMC schema key: " + key));
  if (req.distribution !== undefined && req.distribution !== "exponential")
    return Promise.reject(
      new Error("CTMC supports only exponential holding-time distributions"),
    );
  const deps = fileURLToPath(
    new URL("../../../solvers/ctmc/.python-deps", import.meta.url),
  );
  const env = {
    ...process.env,
    PYTHONPATH: [deps, process.env.PYTHONPATH].filter(Boolean).join(delimiter),
  };
  const configured =
    process.env.RELIABILITY_PYTHON ?? process.env.PYTHON_EXECUTABLE;
  const candidates = configured
    ? [[configured]]
    : process.platform === "win32"
      ? [["python"], ["py", "-3"], ["python3"]]
      : [["python3"], ["python"]];
  const found = candidates.find(
    ([command, ...prefix]) =>
      spawnSync(command, [...prefix, "-c", "import numpy, scipy"], {
        windowsHide: true,
        env,
        timeout: 10000,
        stdio: "ignore",
      }).status === 0,
  );
  if (!found)
    return Promise.reject(
      new Error(
        "CTMC 可选 Python/SciPy 环境不可用。运行 pnpm run doctor，安装 Python、NumPy、SciPy 或配置 PYTHON_EXECUTABLE；其他求解器仍可使用。",
      ),
    );
  const [executable, ...prefix] = found;
  return new Promise((resolve, reject) => {
    const child = spawn(
      executable,
      [
        ...prefix,
        fileURLToPath(
          new URL("../../../solvers/ctmc/solver.py", import.meta.url),
        ),
      ],
      { windowsHide: true, stdio: ["pipe", "pipe", "pipe"], env },
    );
    let out = "",
      err = "";
    const timeout = setTimeout(() => {
      child.kill();
      reject(new Error("CTMC solver timeout (30s)"));
    }, 30000);
    child.stdout.on("data", (b) => {
      out += b;
      if (out.length > 10000000) child.kill();
    });
    child.stderr.on("data", (b) => {
      err += b;
    });
    child.on("error", (e) => {
      clearTimeout(timeout);
      reject(
        new Error(
          "CTMC 可选 Python 环境不可用。安装 Python、NumPy、SciPy 并配置 PYTHON_EXECUTABLE；其他求解器仍可使用。" +
            e.message,
        ),
      );
    });
    child.on("close", (code) => {
      clearTimeout(timeout);
      try {
        const value = JSON.parse(out);
        if (code !== 0 || value.error) reject(new Error(value.error ?? err));
        else resolve(value);
      } catch {
        reject(new Error("CTMC failed: " + err));
      }
    });
    child.stdin.end(JSON.stringify(req));
  });
}
