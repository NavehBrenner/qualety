import { spawn } from "node:child_process";

type TimedCommandResult = {
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  error: string | undefined;
};

export function runTimedCommand(
  bin: string,
  args: readonly string[],
  cwd: string,
  timeoutMs: number,
  options?: { env?: NodeJS.ProcessEnv; stdin?: string },
): Promise<TimedCommandResult> {
  return new Promise((ok) => {
    let settled = false;
    const finish = (result: TimedCommandResult) => {
      if (settled) {
        return;
      }
      settled = true;
      ok(result);
    };
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(bin, args, { cwd, env: options?.env });
    } catch (e) {
      finish({
        code: null,
        stdout: "",
        stderr: "",
        timedOut: false,
        error: e instanceof Error ? e.message : String(e),
      });
      return;
    }
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeoutMs);
    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr?.on("data", (chunk: string) => {
      stderr += chunk;
    });
    if (options?.stdin !== undefined) {
      child.stdin?.end(options.stdin);
    }
    child.on("error", (e) => {
      clearTimeout(timer);
      finish({
        code: null,
        stdout,
        stderr,
        timedOut,
        error: e.message,
      });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      finish({ code, stdout, stderr, timedOut, error: undefined });
    });
  });
}
