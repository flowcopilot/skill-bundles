import { posix } from "node:path";
import { installedRead, type ParseOptions, type SuccessfulRead } from "./transcript";

type Token = { value: string; operator: boolean };

function tokenize(command: string): Token[] | undefined {
  const tokens: Token[] = [];
  let value = "";
  let quote = "";
  let started = false;
  const flush = () => {
    if (started) tokens.push({ value, operator: false });
    value = "";
    started = false;
  };
  for (let index = 0; index < command.length; index++) {
    const character = command[index];
    if (character === "\\" && quote !== "'") {
      const next = command[++index];
      if (next === undefined) return;
      if (next !== "\n") {
        value += quote === '"' && !/[\$`"\\]/.test(next) ? `\\${next}` : next;
        started = true;
      }
    } else if (quote && character === quote) {
      quote = "";
    } else if (!quote && (character === "'" || character === '"')) {
      quote = character;
      started = true;
    } else if (quote !== "'" && /[$`*?\[\]{}]/.test(character)) {
      return;
    } else if (!quote && character === "#" && !started) {
      return tokens;
    } else if (!quote && /[;|&<>\n]/.test(character)) {
      flush();
      let operator = character;
      if (command[index + 1] === character) operator += command[++index];
      tokens.push({ value: operator, operator: true });
    } else if (!quote && /\s/.test(character)) {
      flush();
    } else {
      value += character;
      started = true;
    }
  }
  if (quote) return;
  flush();
  return tokens;
}

type Lines = [number, number | null];

function sedRange(script: string): Lines {
  const [start, end] = script.slice(0, -1).split(",");
  return [Number(start), end === undefined ? Number(start) : end === "$" ? null : Number(end)];
}

function operands(words: string[]): { files: string[]; complete: boolean; lines?: Lines } | undefined {
  const tool = posix.basename(words[0] ?? "");
  const args = words.slice(1);
  const files: string[] = [];
  let options = true;
  let script = false;
  let lines: Lines | undefined = tool === "head" ? [1, 10] : undefined;
  if (!["cat", "head", "sed"].includes(tool)) return;
  if (tool === "sed" && !args.some((arg) => arg === "-n" || arg === "--quiet" || arg === "--silent")) return;
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (options && arg === "--") {
      options = false;
    } else if (options && arg.startsWith("-") && arg !== "-") {
      if (tool === "head" && ["-n", "-c", "--lines", "--bytes"].includes(arg)) {
        const count = args[++index];
        if (!count) return;
        lines = ["-n", "--lines"].includes(arg) && /^\d+$/.test(count) ? [1, Number(count)] : undefined;
      } else if (tool === "head" && /^(?:-[qv]+|-[0-9]+|-n[0-9]+|-c[0-9]+|--(?:lines|bytes)=\d+|--quiet|--silent|--verbose)$/.test(arg)) {
        const count = arg.match(/^(?:-n?|--lines=)(\d+)$/)?.[1];
        if (count) lines = [1, Number(count)];
        else if (/^(?:-c|--bytes=)/.test(arg)) lines = undefined;
      } else if (tool === "cat" && /^(?:-[AbEnsTuvet]+|--(?:show-all|number-nonblank|show-ends|number|squeeze-blank|show-tabs|show-nonprinting))$/.test(arg)) {
        continue;
      } else if (tool === "sed" && ["-n", "--quiet", "--silent"].includes(arg)) {
        continue;
      } else if (tool === "sed" && arg === "-e" && !script) {
        const value = args[++index] ?? "";
        if (!/^\d+(?:,(?:\d+|\$))?p$/.test(value)) return;
        lines = sedRange(value);
        script = true;
      } else {
        return;
      }
    } else if (tool === "sed" && !script) {
      if (!/^\d+(?:,(?:\d+|\$))?p$/.test(arg)) return;
      lines = sedRange(arg);
      script = true;
    } else if (arg !== "-") {
      files.push(arg);
    }
  }
  if (tool === "sed" && !script) return;
  return { files, complete: tool === "cat", lines: tool === "cat" ? undefined : lines };
}

export function commandReads(
  command: string,
  tool: string,
  options: ParseOptions = {},
  depth = 0,
): SuccessfulRead[] {
  if (depth > 3) return [];
  const tokens = tokenize(command);
  if (!tokens?.length) return [];
  if (["sh", "bash", "zsh", "dash"].includes(posix.basename(tokens[0].value))) {
    if (tokens.length !== 3 || tokens.some((token) => token.operator) || !/^-[a-z]*c[a-z]*$/.test(tokens[1].value)) return [];
    return commandReads(tokens[2].value, tool, options, depth + 1);
  }
  // A final exit code cannot prove that a command before a semicolon or || succeeded.
  if (tokens.some((token) => token.operator && !["&&", "|"].includes(token.value))) return [];
  const groups: Token[][] = [[]];
  for (const token of tokens) {
    if (token.operator && token.value === "&&") groups.push([]);
    else groups[groups.length - 1].push(token);
  }
  const reads: SuccessfulRead[] = [];
  let cwd = options.cwd;
  for (const group of groups) {
    const pipelines: string[][] = [[]];
    for (const token of group) {
      if (token.operator) pipelines.push([]);
      else pipelines[pipelines.length - 1].push(token.value);
    }
    const words = pipelines[0];
    if (words[0] === "cd" && words.length === 2 && pipelines.length === 1) {
      cwd = words[1].startsWith("/") ? posix.normalize(words[1]) : posix.join(cwd ?? ".", words[1]);
      continue;
    }
    const read = operands(words);
    if (!read) continue;
    // Only known content filters preserve evidence of a read through a pipe.
    if (pipelines.slice(1).some((words) => {
      const filter = operands(words);
      return !["head", "sed"].includes(posix.basename(words[0] ?? "")) || !filter || filter.files.length > 0;
    })) continue;
    // A content filter after cat limits the read to the filter's range.
    const filtered = pipelines.length > 1 ? operands(pipelines[pipelines.length - 1])?.lines : undefined;
    const complete = read.complete && pipelines.length === 1;
    for (const file of read.files) {
      const result = installedRead(file, tool, complete, { ...options, cwd }, complete ? undefined : filtered ?? read.lines);
      if (result) reads.push(result);
    }
  }
  return reads;
}
