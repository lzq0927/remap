import { spawn } from "node:child_process";

// An IPC owner survives Windows' abrupt termination of the API process long enough
// to stop the native child. No credentials or session contents cross this channel.
const [binary, directory, port] = process.argv.slice(2);
if (!process.connected || !binary || !directory || !/^\d+$/.test(port ?? ""))
  throw new Error("This helper must be started by the task Agent runtime");
const native = spawn(
  binary,
  ["serve", "--hostname", "127.0.0.1", "--port", port],
  {
    cwd: directory,
    env: process.env,
    windowsHide: true,
    stdio: "ignore",
  },
);
let stopping = false;
function stop() {
  if (stopping) return;
  stopping = true;
  native.kill();
  setTimeout(() => process.exit(0), 3000).unref();
}
process.on("disconnect", stop);
process.on("message", (message) => {
  if (message?.type === "stop") stop();
});
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
native.on("error", () => process.exit(1));
native.on("exit", (code) => process.exit(stopping ? 0 : (code ?? 1)));
