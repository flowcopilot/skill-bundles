import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { RecordValue, SuccessfulRead } from "./transcript";
import { record } from "./transcript";

export type Task = {
  id: string;
  prompt: string;
  fixture: string;
  expectedBundles: string[];
  requiredReferences: Record<string, string[]>;
  allowedReferences: Record<string, string[]>;
};

// `text` is the command or file path, kept to find failed skill reads.
export type ToolCall = { id: string; action: boolean; label: string; text: string };
export type ToolResult = { id: string; error: boolean };

const readOnlyPrograms = new Set([
  "cat", "head", "tail", "ls", "rg", "grep", "find", "wc", "pwd", "tree", "nl", "stat", "file",
  "echo", "printf", "true", "which", "test", "[", "jq", "cd", "realpath", "basename", "dirname", "uniq",
  "printenv", "uname", "sw_vers", "whoami", "id", "hostname",
]);
const readOnlyGit = new Set(["status", "log", "diff", "show", "ls-files", "rev-parse"]);

// Unwraps `zsh -lc '<script>'` and `bash -c "<script>"`, which Codex uses for every command.
function unwrapShell(command: string): string {
  const match = command.trim().match(/^(?:\/\S+\/)?(?:ba|z|da)?sh\s+-[a-z]*c\s+(['"])([\s\S]*)\1$/);
  return match ? unwrapShell(match[2]) : command;
}

// Splits a script into commands of words. Operators inside quotes stay part of their word.
// Returns undefined for redirection, substitution, or backgrounding, which can write or run anything.
function shellCommands(script: string): string[][] | undefined {
  const commands: string[][] = [[]];
  let word = "";
  let quote = "";
  const flush = () => {
    if (word) commands[commands.length - 1].push(word);
    word = "";
  };
  const cleaned = script.replace(/\s2>\s*\/dev\/null|\s2>&1/g, "");
  for (let index = 0; index < cleaned.length; index++) {
    const character = cleaned[index];
    if (quote) {
      if (character === quote) quote = "";
      else if (character === "\\" && quote === '"') word += cleaned[++index] ?? "";
      else word += character;
    } else if (character === "'" || character === '"') {
      quote = character;
    } else if (character === "\\") {
      word += cleaned[++index] ?? "";
    } else if (character === "`" || (character === "$" && cleaned[index + 1] === "(") || character === ">" || character === "<") {
      return;
    } else if (character === "&" && cleaned[index + 1] !== "&") {
      return;
    } else if (/[;|&\n(){}]/.test(character)) {
      flush();
      if (cleaned[index + 1] === character) index++;
      commands.push([]);
    } else if (/\s/.test(character)) {
      flush();
    } else {
      word += character;
    }
  }
  if (quote) return;
  flush();
  return commands.filter((words) => words.length > 0);
}

export function isReadOnlyCommand(command: string): boolean {
  const commands = shellCommands(unwrapShell(command));
  return !!commands?.length && commands.every((words) => {
    const program = words[0].split("/").pop()!;
    if (program === "command" || program === "type") return words[1] === "-v" || program === "type";
    if (program === "sed") return words.includes("-n") && !words.some((word) => /^-[a-z]*i/.test(word) || word === "--in-place");
    if (program === "find") return !words.some((word) => ["-exec", "-execdir", "-delete", "-ok", "-fprint"].includes(word));
    if (program === "git") {
      if (words[1] === "branch") return words.slice(2).every((word) => ["-a", "-r", "-v", "-vv", "--list", "--show-current"].includes(word));
      return readOnlyGit.has(words[1] ?? "");
    }
    // sort -o writes a file, and date -s sets the clock.
    if (program === "sort") return !words.some((word) => /^-[a-zA-Z]*o/.test(word) || word.startsWith("--output"));
    if (program === "date") return !words.some((word) => word === "-s" || word.startsWith("--set"));
    return readOnlyPrograms.has(program);
  });
}

const claudeReadTools = new Set(["Read", "Glob", "Grep", "LS", "Skill", "ToolSearch", "TodoWrite"]);

// Classifies tool calls in one stream-json event. Anything that is not a read is an action.
export function claudeToolCalls(event: RecordValue): ToolCall[] {
  if (event.type !== "assistant") return [];
  const content = record(event.message).content;
  if (!Array.isArray(content)) return [];
  return content.map(record).filter((block) => block.type === "tool_use" && typeof block.id === "string").map((block) => {
    const name = String(block.name);
    const input = record(block.input);
    const action = name === "Bash" ? !isReadOnlyCommand(String(input.command ?? "")) : !claudeReadTools.has(name);
    const text = String(input.command ?? input.file_path ?? input.skill ?? input.pattern ?? "");
    return { id: String(block.id), action, label: name === "Bash" ? `Bash: ${text.slice(0, 160)}` : `${name}: ${text.slice(0, 160)}`, text };
  });
}

export function claudeResults(event: RecordValue): ToolResult[] {
  if (event.type !== "user") return [];
  const content = record(event.message).content;
  if (!Array.isArray(content)) return [];
  return content.map(record).filter((block) => block.type === "tool_result" && typeof block.tool_use_id === "string")
    .map((block) => ({ id: String(block.tool_use_id), error: block.is_error === true && !outputText(block.content).includes(deliveredMarker) }));
}

export function codexToolCall(event: RecordValue): ToolCall | undefined {
  if (event.type !== "item.started") return;
  const item = record(event.item);
  if (typeof item.id !== "string") return;
  if (item.type === "command_execution") {
    const command = String(item.command ?? "");
    return { id: item.id, action: !isReadOnlyCommand(command), label: `shell: ${unwrapShell(command).slice(0, 160)}`, text: command };
  }
  if (["file_change", "mcp_tool_call", "web_search"].includes(String(item.type))) {
    return { id: item.id, action: true, label: String(item.type), text: JSON.stringify(item).slice(0, 300) };
  }
}

const settings = JSON.parse(readFileSync(resolve(import.meta.dir, "../../../skill-bundles.json"), "utf8"));
export const deliveredMarker = `<!-- Modified by ${settings.attribution} from`;

function outputText(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map((item) => outputText(record(item).text ?? item)).join("\n");
  return "";
}

// Joins `;` and `||` lists with `&&` so the strict parser accepts them.
function chained(command: string): string {
  return command.replace(/\s*;\s*(?=\S)/g, " && ").replace(/\s*\|\|\s*/g, " && ");
}

// The parsers count a read only when the whole command succeeded. A trigger run asks a different
// question: did the agent see the file? When a call's output contains bundled content, mark it as
// successful and join its command list, so reads before a failed step still count.
export function deliveredReads(events: RecordValue[], cli: "claude" | "codex"): RecordValue[] {
  if (cli === "codex") {
    return events.map((event) => {
      const item = record(event.item);
      if (event.type !== "item.completed" || item.type !== "command_execution" || item.exit_code === 0) return event;
      if (!outputText(item.aggregated_output).includes(deliveredMarker)) return event;
      return { ...event, item: { ...item, exit_code: 0, status: "completed", command: chained(String(item.command ?? "")) } };
    });
  }
  const delivered = new Set<string>();
  for (const event of events) {
    const content = record(event.message).content;
    if (event.type !== "user" || !Array.isArray(content)) continue;
    for (const block of content.map(record)) {
      if (block.type === "tool_result" && block.is_error === true && outputText(block.content).includes(deliveredMarker)) {
        delivered.add(String(block.tool_use_id));
      }
    }
  }
  if (!delivered.size) return events;
  return events.map((event) => {
    const message = record(event.message);
    if (!Array.isArray(message.content)) return event;
    const content = message.content.map((value) => {
      const block = record(value);
      if (block.type === "tool_result" && delivered.has(String(block.tool_use_id))) return { ...block, is_error: false };
      if (block.type === "tool_use" && delivered.has(String(block.id)) && typeof record(block.input).command === "string") {
        return { ...block, input: { ...record(block.input), command: chained(String(record(block.input).command)) } };
      }
      return value;
    });
    return { ...event, message: { ...message, content } };
  });
}

// Marks every call as successful and joins its command list. The reads in the result are the
// reads the agent asked for, including reads in calls that a permission check denied.
export function attemptedReads(events: RecordValue[], cli: "claude" | "codex"): RecordValue[] {
  return events.map((event) => {
    if (cli === "codex") {
      const item = record(event.item);
      if (event.type !== "item.completed" || item.type !== "command_execution") return event;
      return { ...event, item: { ...item, exit_code: 0, status: "completed", command: chained(String(item.command ?? "")) } };
    }
    const message = record(event.message);
    if (!Array.isArray(message.content)) return event;
    const content = message.content.map((value) => {
      const block = record(value);
      if (block.type === "tool_result") return { ...block, is_error: false };
      if (block.type === "tool_use" && typeof record(block.input).command === "string") {
        return { ...block, input: { ...record(block.input), command: chained(String(record(block.input).command)) } };
      }
      return value;
    });
    return { ...event, message: { ...message, content } };
  });
}

export function codexResult(event: RecordValue): ToolResult | undefined {
  const item = record(event.item);
  if (event.type !== "item.completed" || typeof item.id !== "string") return;
  const failed = item.status === "failed" || (typeof item.exit_code === "number" && item.exit_code !== 0);
  return { id: item.id, error: failed && !outputText(item.aggregated_output).includes(deliveredMarker) };
}

// Returns the headings that a line range covers, including the heading in effect at its first line.
export function sectionsFor(text: string, lines: [number, number | null]): string[] {
  const [start, end] = lines;
  const sections: string[] = [];
  let current: string | undefined;
  let fenced = false;
  text.split("\n").forEach((line, index) => {
    const number = index + 1;
    if (/^\s*(```|~~~)/.test(line)) fenced = !fenced;
    const heading = !fenced && line.match(/^#{1,6}\s+(.+?)\s*#*$/)?.[1];
    if (number < start) {
      if (heading) current = heading;
      return;
    }
    if (number === start && !heading && current) sections.push(current);
    if (heading && (end === null || number <= end)) sections.push(heading);
  });
  if (!sections.length && current) sections.push(current);
  return sections;
}

export type Score = {
  bundles: string[];
  expectedLoaded: boolean;
  requiredRead: string[];
  requiredMissed: string[];
  outsideAllowed: string[];
  otherBundles: string[];
};

export function scoreReads(task: Task, reads: SuccessfulRead[]): Score {
  const bundles = [...new Set(reads.map((read) => read.bundle))].sort();
  const paths = new Set(reads.map((read) => `${read.bundle}/${read.path}`));
  const required = Object.entries(task.requiredReferences).flatMap(([bundle, list]) => list.map((path) => `${bundle}/${path}`));
  const allowed = new Set(Object.entries(task.allowedReferences).flatMap(([bundle, list]) => list.map((path) => `${bundle}/${path}`)));
  return {
    bundles,
    expectedLoaded: task.expectedBundles.length > 0 && task.expectedBundles.every((bundle) => bundles.includes(bundle)),
    requiredRead: required.filter((path) => paths.has(path)),
    requiredMissed: required.filter((path) => !paths.has(path)),
    outsideAllowed: [...paths].filter((path) => {
      const bundle = path.split("/")[0];
      return task.expectedBundles.includes(bundle) && !path.endsWith("/SKILL.md") && !allowed.has(path);
    }).sort(),
    otherBundles: bundles.filter((bundle) => !task.expectedBundles.includes(bundle)),
  };
}
