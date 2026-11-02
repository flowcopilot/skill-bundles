import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseClaudeTranscript } from "./src/claude";
import { parseCodexTranscript } from "./src/codex";
import { commandReads } from "./src/commands";

const file = "/project/.agents/skills/writing/references/guide.md";
const read = { bundle: "writing", path: "references/guide.md", tool: "Read", complete: true };

function claudeCall(name: string, input: Record<string, unknown>, id = "read-1") {
  return { type: "assistant", message: { content: [{ type: "tool_use", name, id, input }] } };
}

function claudeResult(id = "read-1", is_error?: boolean) {
  return { type: "user", message: { content: [{ type: "tool_result", tool_use_id: id, content: "file contents", ...(is_error === undefined ? {} : { is_error }) }] } };
}

function codexCommand(command: string, overrides: Record<string, unknown> = {}) {
  return { type: "item.completed", item: { id: "item-1", type: "command_execution", command, exit_code: 0, status: "completed", ...overrides } };
}

describe("Claude stream-json", () => {
  test("joins successful results by tool_use_id without requiring is_error", () => {
    expect(parseClaudeTranscript([
      claudeResult("other", true),
      claudeCall("Read", { file_path: file }),
      claudeResult(),
    ])).toEqual([read]);
  });

  test("drops failed and unfinished reads", () => {
    expect(parseClaudeTranscript([claudeCall("Read", { file_path: file }), claudeResult("read-1", true)])).toEqual([]);
    expect(parseClaudeTranscript([claudeCall("Read", { file_path: file })])).toEqual([]);
    expect(parseClaudeTranscript([claudeCall("Bash", { command: `cat ${file}` }), claudeResult("read-1", true)])).toEqual([]);
  });

  test("marks reads with either limit or offset as partial", () => {
    for (const [partial, lines] of [
      [{ limit: 10 }, [1, 10]],
      [{ offset: 1 }, [1, null]],
      [{ offset: 0, limit: 2000 }, [1, 2000]],
      [{ offset: 40, limit: 20 }, [40, 59]],
    ] as const) {
      expect(parseClaudeTranscript([claudeCall("Read", { file_path: file, ...partial }), claudeResult()])).toEqual([{ ...read, complete: false, lines: [...lines] }]);
    }
  });

  test("deduplicates repeated assistant and result events", () => {
    const call = claudeCall("Read", { file_path: file });
    expect(parseClaudeTranscript([call, claudeResult(), call, claudeResult()])).toEqual([read]);
  });

  test("resolves relative reads against the init or command cwd", () => {
    expect(parseClaudeTranscript([
      { type: "system", subtype: "init", cwd: "/project" },
      claudeCall("Read", { file_path: ".agents/skills/writing/references/guide.md" }),
      claudeResult(),
    ])).toEqual([read]);
    expect(parseClaudeTranscript([
      claudeCall("Bash", { command: "cat references/guide.md", cwd: "/project/.agents/skills/writing" }),
      claudeResult(),
    ])).toEqual([{ ...read, tool: "Bash" }]);
  });

  test("maps successful Skill calls to the entry file", () => {
    for (const skill of ["writing", "/writing", "example:writing"]) {
      expect(parseClaudeTranscript([claudeCall("Skill", { skill }), claudeResult()])).toEqual([
        { bundle: "writing", path: "SKILL.md", tool: "Skill", complete: true },
      ]);
    }
    expect(parseClaudeTranscript([claudeCall("Skill", { skill: "writing" }), claudeResult("read-1", true)])).toEqual([]);
  });

  test("uses only assistant tool_use blocks and user tool_result blocks", () => {
    const call = claudeCall("Read", { file_path: file });
    expect(parseClaudeTranscript([{ ...call, type: "user" }, claudeResult()])).toEqual([]);
  });
});

describe("Codex exec JSON", () => {
  test("accepts only completed successful command executions", () => {
    expect(parseCodexTranscript([codexCommand(`cat ${file}`)])).toEqual([{ ...read, tool: "command_execution" }]);
    for (const overrides of [{ exit_code: 1 }, { exit_code: null }, { status: "failed" }, { status: "in_progress" }]) {
      expect(parseCodexTranscript([codexCommand(`cat ${file}`, overrides)])).toEqual([]);
    }
    expect(parseCodexTranscript([{ ...codexCommand(`cat ${file}`), type: "item.started" }])).toEqual([]);
  });

  test("deduplicates completed events by item.id", () => {
    const event = codexCommand(`cat ${file}`);
    expect(parseCodexTranscript([event, event])).toHaveLength(1);
    expect(parseCodexTranscript([event, codexCommand(`cat ${file}`, { id: "item-2" })])).toHaveLength(2);
  });

  test("resolves relative paths against item cwd, event cwd, or the supplied cwd", () => {
    const cwd = "/project/.agents/skills/writing";
    const command = "cat references/guide.md";
    for (const [event, options] of [
      [codexCommand(command, { cwd }), {}],
      [{ ...codexCommand(command), cwd }, {}],
      [codexCommand(command), { cwd }],
    ] as const) {
      expect(parseCodexTranscript([event], options)).toEqual([{ ...read, tool: "command_execution" }]);
    }
  });

  test("marks head and sed reads as partial", () => {
    for (const [command, lines] of [
      [`head -n 20 ${file}`, [1, 20]],
      [`head -5 ${file}`, [1, 5]],
      [`head ${file}`, [1, 10]],
      [`sed -n '1,20p' ${file}`, [1, 20]],
      [`sed -n '40,$p' ${file}`, [40, null]],
      [`sed -n '7p' ${file}`, [7, 7]],
    ] as const) {
      expect(parseCodexTranscript([codexCommand(command)])).toEqual([{ ...read, tool: "command_execution", complete: false, lines: [...lines] }]);
    }
  });
});

describe("shell read commands", () => {
  test("parses shell wrappers, quotes, multiple files, and cd", () => {
    const command = `/bin/zsh -lc 'cd /project/.agents/skills/writing && cat SKILL.md "references/guide.md"'`;
    expect(commandReads(command, "Bash")).toEqual([
      { bundle: "writing", path: "SKILL.md", tool: "Bash", complete: true },
      { ...read, tool: "Bash" },
    ]);
  });

  test("maps Claude, Agents, and Codex installations and custom roots", () => {
    for (const directory of [".claude", ".agents", ".codex"]) {
      expect(commandReads(`cat /home/user/${directory}/skills/writing/SKILL.md`, "Bash")).toEqual([
        { bundle: "writing", path: "SKILL.md", tool: "Bash", complete: true },
      ]);
    }
    expect(commandReads("cat /workspace/skills/writing/references/guide.md", "Bash", { skillRoots: ["/workspace/skills"] })).toEqual([{ ...read, tool: "Bash" }]);
  });

  test("excludes listings, searches, filenames, and non-Markdown files", () => {
    for (const command of [
      `ls ${file}`, `find ${file}`, `rg -l router ${file}`, `grep -l router ${file}`,
      `rg --files ${file}`, `stat ${file}`, `wc -l ${file}`, `echo cat ${file}`,
      `cat ${file} | grep -l router`, `cat ${file} | wc -l`, `cat ${file} | head another.md`,
      "cat /project/.agents/skills/writing/scripts/example.sh", "cat /project/references/guide.md",
    ]) expect(commandReads(command, "Bash")).toEqual([]);
  });

  test("applies the same listing exclusions to Claude Bash and Codex", () => {
    for (const command of [`ls ${file}`, `find ${file}`, `rg -l router ${file}`, `grep -l router ${file}`]) {
      expect(parseClaudeTranscript([claudeCall("Bash", { command }), claudeResult()])).toEqual([]);
      expect(parseCodexTranscript([codexCommand(command)])).toEqual([]);
    }
  });

  test("does not claim reads when shell status or expansion is ambiguous", () => {
    for (const command of [`cat ${file}; true`, `cat ${file} || true`, `echo $(cat ${file})`, `cat ${file} > output.md`, `cat ${file}/*.md`]) {
      expect(commandReads(command, "Bash")).toEqual([]);
    }
  });

  test("marks a content filter pipeline as partial", () => {
    expect(commandReads(`cat ${file} | head -n 20`, "Bash")).toEqual([{ ...read, tool: "Bash", complete: false, lines: [1, 20] }]);
  });
});

describe("trimmed real CLI transcripts", () => {
  test("Claude Code 2.1.301 matches assistant and user block fields", () => {
    const transcript = readFileSync(resolve(import.meta.dir, "transcripts/claude-real.jsonl"), "utf8");
    expect(parseClaudeTranscript(transcript, { skillRoots: ["/workspace/skills"] })).toEqual([
      { bundle: "writing", path: "SKILL.md", tool: "Read", complete: true },
    ]);
  });

  test("Codex CLI 0.163.0 matches command fields and shell wrapping", () => {
    const transcript = readFileSync(resolve(import.meta.dir, "transcripts/codex-real.jsonl"), "utf8");
    expect(parseCodexTranscript(transcript, { cwd: "/workspace", skillRoots: ["/workspace/skills"] })).toEqual([
      { bundle: "writing", path: "SKILL.md", tool: "command_execution", complete: true },
    ]);
  });
});
