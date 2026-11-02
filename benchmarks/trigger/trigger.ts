import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseClaudeTranscript } from "./src/claude";
import { parseCodexTranscript } from "./src/codex";
import { record, type RecordValue, type SuccessfulRead } from "./src/transcript";
import {
  attemptedReads, claudeResults, claudeToolCalls, codexResult, codexToolCall, deliveredReads, scoreReads, sectionsFor,
  type Score, type Task, type ToolCall, type ToolResult,
} from "./src/trigger";

const benchRoot = import.meta.dir;
const repositoryRoot = resolve(benchRoot, "../..");
const config = JSON.parse(readFileSync(resolve(benchRoot, "config.json"), "utf8"));
const models: Record<string, "claude" | "codex"> = config.models;
for (const cli of Object.values(models)) if (cli !== "claude" && cli !== "codex") throw new Error(`Unknown model CLI: ${cli}`);

function option(name: string, fallback: string): string {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

const allTasks: Task[] = readFileSync(resolve(benchRoot, "tasks.jsonl"), "utf8").trim().split("\n").map((line) => JSON.parse(line));
const taskPatterns = option("tasks", "*").split(",");
const tasks = allTasks.filter((task) => taskPatterns.some((pattern) =>
  pattern.endsWith("*") ? task.id.startsWith(pattern.slice(0, -1)) : task.id === pattern));
const selectedModels = option("models", Object.keys(models).join(",")).split(",").filter(Boolean);
if (!selectedModels.length) throw new Error("Set models in benchmarks/trigger/config.json before a paid run.");
const repeats = Number(option("repeats", "1"));
const concurrency = Number(option("concurrency", "4"));
const maxTools = Number(option("max-tools", "12"));
const timeoutMs = Number(option("timeout", "150")) * 1000;
const effort = option("effort", "low");
const bundles: string[] = option("bundles", config.bundles.join(",")).split(",");
const outDir = resolve(option("out", resolve(benchRoot, "results", `trigger-${new Date().toISOString().replace(/[:.]/g, "-")}`)));

for (const model of selectedModels) if (!models[model]) throw new Error(`unknown model ${model}; use ${Object.keys(models).join(", ")}`);
if (!tasks.length) throw new Error(`no task matches ${taskPatterns.join(",")}`);

type Run = {
  task: string; model: string; repeat: number; stop: string; firstAction?: string; toolCalls: number;
  seconds: number; score: Score & { requiredAttempted: string[] };
  failedSkillReads: string[];
  reads: (SuccessfulRead & { sections?: string[] })[];
};

// A clean environment keeps this session's gateway, hooks, and agent variables out of the child.
function baseEnv(home: string): Record<string, string> {
  return {
    PATH: process.env.PATH ?? "/usr/bin:/bin",
    HOME: home,
    USER: process.env.USER ?? "",
    LANG: "en_US.UTF-8",
    TMPDIR: resolve(home, "tmp"),
    SHELL: "/bin/sh",
    TERM: "dumb",
  };
}

function prepare(task: Task, cli: "claude" | "codex", root: string) {
  const workspace = resolve(root, "workspace");
  cpSync(resolve(benchRoot, task.fixture), workspace, { recursive: true });
  Bun.spawnSync(["git", "init", "-q"], { cwd: workspace });
  // Each CLI gets the bundles only in its own project skill directory.
  const skillDir = resolve(workspace, cli === "claude" ? ".claude/skills" : ".agents/skills");
  mkdirSync(skillDir, { recursive: true });
  for (const bundle of bundles) cpSync(resolve(repositoryRoot, "skills", bundle), resolve(skillDir, bundle), { recursive: true });
  return { root, workspace };
}

function command(task: Task, model: string, cli: "claude" | "codex", root: string, workspace: string) {
  const home = resolve(root, "home");
  mkdirSync(resolve(home, "tmp"), { recursive: true });
  if (cli === "claude") {
    const auth = resolve(process.env.HOME ?? "", ".claude/.credentials.json");
    if (existsSync(auth)) {
      mkdirSync(resolve(home, ".claude"), { recursive: true });
      cpSync(auth, resolve(home, ".claude/.credentials.json"));
    }
    const env = baseEnv(home);
    for (const key of ["ANTHROPIC_API_KEY", "CLAUDE_CODE_OAUTH_TOKEN"]) if (process.env[key]) env[key] = process.env[key]!;
    return {
      argv: ["claude", "-p", task.prompt, "--model", model, "--effort", effort, "--output-format", "stream-json", "--verbose",
        "--setting-sources", "project", "--no-session-persistence"],
      env,
    };
  }
  // A temporary CODEX_HOME and HOME hide user config, AGENTS.md, and user skills. Only auth is copied.
  const codexHome = resolve(root, "codex-home");
  mkdirSync(codexHome, { recursive: true });
  const auth = resolve(process.env.HOME ?? "", ".codex/auth.json");
  if (existsSync(auth)) cpSync(auth, resolve(codexHome, "auth.json"));
  return {
    argv: ["codex", "exec", "--json", "-m", model, "-c", `model_reasoning_effort=${effort}`, "-s", "read-only",
      "--skip-git-repo-check", "-C", workspace, task.prompt],
    env: { ...baseEnv(home), CODEX_HOME: codexHome, ...(process.env.OPENAI_API_KEY ? { OPENAI_API_KEY: process.env.OPENAI_API_KEY } : {}) },
  };
}

function analyze(task: Task, cli: "claude" | "codex", events: RecordValue[]) {
  const calls = new Map<string, ToolCall>();
  const failedSkillReads: string[] = [];
  for (const event of events) {
    const started = cli === "claude" ? claudeToolCalls(event) : [codexToolCall(event)].filter((call) => call !== undefined);
    for (const call of started) calls.set(call.id, call);
    const results = cli === "claude" ? claudeResults(event) : [codexResult(event)].filter((result) => result !== undefined);
    for (const result of results) {
      const call = calls.get(result.id);
      if (!call) continue;
      if (result.error && /\/skills\/|SKILL\.md|references\//.test(call.text)) failedSkillReads.push(call.label);
    }
  }
  const delivered = deliveredReads(events, cli);
  const reads = (cli === "claude" ? parseClaudeTranscript(delivered) : parseCodexTranscript(delivered, { cwd: "/workspace" }))
    .map((read) => {
      const file = resolve(repositoryRoot, "skills", read.bundle, read.path);
      return read.lines && existsSync(file) ? { ...read, sections: sectionsFor(readFileSync(file, "utf8"), read.lines) } : read;
    });
  const parse = (list: RecordValue[]) => cli === "claude" ? parseClaudeTranscript(list) : parseCodexTranscript(list, { cwd: "/workspace" });
  // Required references that the agent asked for, even in a call that failed or was denied.
  const attempted = scoreReads(task, parse(attemptedReads(events, cli))).requiredRead;
  return { score: { ...scoreReads(task, reads), requiredAttempted: attempted }, reads, failedSkillReads };
}

async function runOnce(task: Task, model: string, repeat: number): Promise<Run> {
  const cli = models[model];
  mkdirSync(resolve(repositoryRoot, ".cache"), { recursive: true });
  const root = mkdtempSync(resolve(repositoryRoot, `.cache/trigger-${task.id}-`));
  let child: ReturnType<typeof Bun.spawn> | undefined;
  let timer: ReturnType<typeof setInterval> | undefined;
  try {
    const { workspace } = prepare(task, cli, root);
    const { argv, env } = command(task, model, cli, root, workspace);
    const started = Date.now();
    const agent = Bun.spawn(argv, { cwd: workspace, env, stdout: "pipe", stderr: "pipe", stdin: "ignore" });
    child = agent;
    const stderrOutput = new Response(agent.stderr).text();
    const events: RecordValue[] = [];
    const pending = new Set<string>();
    let toolCalls = 0;
    let stop = "";
    let firstAction: string | undefined;
    let deadline = started + timeoutMs;

    const halt = (reason: string, graceMs: number) => {
      if (stop) return;
      stop = reason;
      // Let reads that started before the stop return, so their results count.
      deadline = Math.min(deadline, Date.now() + graceMs);
    };
    timer = setInterval(() => {
      if (Date.now() >= deadline || (stop && pending.size === 0)) {
        if (!stop) stop = "timeout";
        agent.kill("SIGTERM");
        setTimeout(() => agent.kill("SIGKILL"), 3000);
      }
    }, 250);

    const observe = (started: ToolCall[], results: ToolResult[]) => {
      for (const result of results) pending.delete(result.id);
      for (const call of started) {
        toolCalls++;
        if (call.action) {
          firstAction ??= call.label;
          halt("first-action", 8000);
        } else if (!stop) {
          pending.add(call.id);
        }
        if (toolCalls >= maxTools) halt("max-tools", 10000);
      }
    };

    const decoder = new TextDecoder();
    let buffer = "";
    for await (const chunk of agent.stdout) {
      buffer += decoder.decode(chunk, { stream: true });
      let newline: number;
      while ((newline = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (!line.startsWith("{")) continue;
        let event: RecordValue;
        try {
          event = record(JSON.parse(line));
        } catch {
          continue;
        }
        events.push(event);
        if (cli === "claude") observe(claudeToolCalls(event), claudeResults(event));
        else {
          const call = codexToolCall(event);
          const result = codexResult(event);
          observe(call ? [call] : [], result ? [result] : []);
        }
      }
    }
    await agent.exited;
    if (!stop) stop = agent.exitCode === 0 ? "finished" : `exit-${agent.exitCode}`;
    const stderr = await stderrOutput;
    const run: Run = {
      task: task.id, model, repeat, stop, firstAction, toolCalls, seconds: Math.round((Date.now() - started) / 1000),
      ...analyze(task, cli, events),
    };
    const transcriptDir = resolve(outDir, "transcripts", task.id);
    mkdirSync(transcriptDir, { recursive: true });
    writeFileSync(resolve(transcriptDir, `${encodeURIComponent(model)}-${repeat}.jsonl`), events.map((event) => JSON.stringify(event)).join("\n") + "\n");
    if (stderr.trim()) writeFileSync(resolve(transcriptDir, `${encodeURIComponent(model)}-${repeat}.stderr.txt`), stderr);
    return run;
  } finally {
    if (timer) clearInterval(timer);
    if (child && child.exitCode === null) child.kill("SIGKILL");
    rmSync(root, { recursive: true, force: true });
  }
}

function summary(runs: Run[]): string {
  const rows = [
    "| Task | Model | Runs | Expected bundle loaded | Required refs read | Required refs attempted | Other bundles | Stops |",
    "| --- | --- | --- | --- | --- | --- | --- | --- |",
  ];
  for (const task of tasks) {
    for (const model of selectedModels) {
      const group = runs.filter((run) => run.task === task.id && run.model === model);
      if (!group.length) continue;
      const required = Object.values(task.requiredReferences).flat().length;
      const loaded = task.expectedBundles.length ? `${group.filter((run) => run.score.expectedLoaded).length}` : "n/a";
      const requiredRead = required ? `${group.reduce((total, run) => total + run.score.requiredRead.length, 0)} of ${required * group.length}` : "n/a";
      const attempted = required ? `${group.reduce((total, run) => total + (run.score.requiredAttempted?.length ?? 0), 0)} of ${required * group.length}` : "n/a";
      const others = [...new Set(group.flatMap((run) => run.score.otherBundles))].join(", ") || "none";
      const stops = Object.entries(group.reduce<Record<string, number>>((counts, run) => ({ ...counts, [run.stop]: (counts[run.stop] ?? 0) + 1 }), {}))
        .map(([stop, count]) => `${stop} ${count}`).join(", ");
      rows.push(`| ${task.id} | ${model} | ${group.length} | ${loaded} | ${requiredRead} | ${attempted} | ${others} | ${stops} |`);
    }
  }
  return rows.join("\n");
}

// `--rescore <dir>` scores saved transcripts again with the current parsers and scoring.
const rescore = option("rescore", "");
if (rescore) {
  const saved: Run[] = readFileSync(resolve(rescore, "runs.jsonl"), "utf8").trim().split("\n").map((line) => JSON.parse(line));
  const runs = saved.flatMap((run) => {
    const task = allTasks.find((item) => item.id === run.task);
    const file = resolve(rescore, "transcripts", run.task, `${encodeURIComponent(run.model)}-${run.repeat}.jsonl`);
    if (!task || !existsSync(file)) return [];
    const events = readFileSync(file, "utf8").trim().split("\n").filter(Boolean).map((line) => record(JSON.parse(line)));
    return [{ ...run, ...analyze(task, models[run.model], events) }];
  });
  writeFileSync(resolve(rescore, "runs.jsonl"), runs.map((run) => JSON.stringify(run)).join("\n") + "\n");
  const table = summary(runs);
  writeFileSync(resolve(rescore, "summary.md"), `${table}\n`);
  console.log(table);
  process.exit(0);
}

const jobs = tasks.flatMap((task) => selectedModels.flatMap((model) =>
  Array.from({ length: repeats }, (_, index) => ({ task, model, repeat: index + 1 }))));
mkdirSync(outDir, { recursive: true });
console.log(`${jobs.length} runs: ${tasks.length} tasks, ${selectedModels.length} models, ${repeats} repeats, ${effort} effort. Output: ${outDir}`);
const runs: Run[] = [];
let failed = false;
let next = 0;
await Promise.all(Array.from({ length: Math.min(concurrency, jobs.length) }, async () => {
  while (next < jobs.length) {
    const job = jobs[next++];
    try {
      const run = await runOnce(job.task, job.model, job.repeat);
      runs.push(run);
      writeFileSync(resolve(outDir, "runs.jsonl"), runs.map((item) => JSON.stringify(item)).join("\n") + "\n");
      const refs = run.reads.filter((read) => read.path !== "SKILL.md").map((read) => `${read.bundle}/${read.path}`);
      console.log(`[${runs.length}/${jobs.length}] ${job.task.id} ${job.model} #${job.repeat}: ${run.stop}, bundles ${run.score.bundles.join(",") || "none"}, refs ${[...new Set(refs)].join(",") || "none"}`);
    } catch (error) {
      failed = true;
      console.error(`${job.task.id} ${job.model} #${job.repeat}: ${error}`);
    }
  }
}));
const table = summary(runs);
writeFileSync(resolve(outDir, "summary.md"), `${table}\n`);
console.log(`\n${table}`);

if (failed) process.exitCode = 1;
