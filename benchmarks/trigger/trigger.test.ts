import { describe, expect, test } from "bun:test";
import { parseClaudeTranscript } from "./src/claude";
import { parseCodexTranscript } from "./src/codex";
import { deliveredReads, deliveredMarker, isReadOnlyCommand, scoreReads, sectionsFor, type Task } from "./src/trigger";

describe("read-only command classification", () => {
  test("accepts reads and searches", () => {
    for (const command of [
      "cat .agents/skills/writing/SKILL.md",
      `/bin/zsh -lc "sed -n '1,80p' references/core/index.md"`,
      `/bin/zsh -lc "rg --files '/tmp/x/.agents/skills' | rg 'agent-desktop/(agent-desktop|agent-desktop-macos)/index.md'"`,
      "ls -la && cat package.json 2>/dev/null",
      "command -v agent-browser",
      "ls -la; which agent-device; ls /tmp; printenv PATH",
      "rg --files | sort | uniq",
      "git branch --show-current",
      "date -u",
    ]) expect(isReadOnlyCommand(command)).toBe(true);
  });

  test("rejects writes, edits, substitutions, and other programs", () => {
    for (const command of [
      "echo 7006652 > result.txt",
      "sed -i '' 's/a/b/' file.md",
      "agent-desktop launch Calculator",
      "agent-browser open https://shop.example.test/products/42",
      "cat $(ls)",
      "npm install",
      "find . -delete",
      "git commit -m x",
      "sleep 5 &",
      "ls | xargs rm",
      "awk 'BEGIN { system(\"rm -rf x\") }'",
      "awk '{ print > \"out.txt\" }' file",
      "sort -o sorted.txt input.txt",
      "date -s 2026-01-01",
      "git branch -D main",
    ]) expect(isReadOnlyCommand(command)).toBe(false);
  });


});

describe("sections", () => {
  const text = ["# Title", "intro", "## Install", "step", "```sh", "# not a heading", "```", "## Use", "run", "## Debug", "fix"].join("\n");

  test("returns the headings a range covers and the heading in effect at its start", () => {
    expect(sectionsFor(text, [1, 4])).toEqual(["Title", "Install"]);
    expect(sectionsFor(text, [4, 9])).toEqual(["Install", "Use"]);
    expect(sectionsFor(text, [8, null])).toEqual(["Use", "Debug"]);
    expect(sectionsFor(text, [11, 11])).toEqual(["Debug"]);
  });
});

describe("scoring", () => {
  const task: Task = {
    id: "t", prompt: "p", fixture: "f", expectedBundles: ["writing"],
    requiredReferences: { "writing": ["references/a.md", "references/b.md"] },
    allowedReferences: { "writing": ["references/a.md", "references/b.md", "references/c.md"] },
  };
  const read = (bundle: string, path: string) => ({ bundle, path, tool: "Read", complete: true });

  test("scores expected loads, required reads, extra references, and other bundles", () => {
    expect(scoreReads(task, [read("writing", "SKILL.md"), read("writing", "references/a.md"), read("writing", "references/d.md"), read("other", "SKILL.md")]))
      .toEqual({
        bundles: ["other", "writing"],
        expectedLoaded: true,
        requiredRead: ["writing/references/a.md"],
        requiredMissed: ["writing/references/b.md"],
        outsideAllowed: ["writing/references/d.md"],
        otherBundles: ["other"],
      });
  });

  test("never marks a negative control as loaded", () => {
    const control = { ...task, expectedBundles: [], requiredReferences: {}, allowedReferences: {} };
    expect(scoreReads(control, [read("writing", "SKILL.md")]).expectedLoaded).toBe(false);
    expect(scoreReads(control, [read("writing", "SKILL.md")]).otherBundles).toEqual(["writing"]);
  });
});

describe("delivered reads", () => {
  const skill = "/w/.claude/skills/writing/references/agent-desktop";
  const command = `cd ${skill}; cat agent-desktop/index.md | head -80; which agent-desktop`;
  const output = `Exit code 1\n${deliveredMarker} example/repo revision abc. -->\n# Reference`;

  test("counts reads before a failed step when the output shows bundled content", () => {
    const events = [
      { type: "assistant", message: { content: [{ type: "tool_use", id: "1", name: "Bash", input: { command } }] } },
      { type: "user", message: { content: [{ type: "tool_result", tool_use_id: "1", is_error: true, content: output }] } },
    ];
    expect(parseClaudeTranscript(events)).toEqual([]);
    expect(parseClaudeTranscript(deliveredReads(events, "claude")).map((read) => read.path))
      .toEqual(["references/agent-desktop/agent-desktop/index.md"]);
  });

  test("keeps failed Codex commands without bundled output as failures", () => {
    const event = { type: "item.completed", item: { id: "1", type: "command_execution", command: `cat ${skill}/x.md`, exit_code: 1, status: "failed", aggregated_output: "No such file" } };
    expect(parseCodexTranscript(deliveredReads([event], "codex"))).toEqual([]);
    const shown = { ...event, item: { ...event.item, aggregated_output: output } };
    expect(parseCodexTranscript(deliveredReads([shown], "codex")).map((read) => read.path)).toEqual(["references/agent-desktop/x.md"]);
  });
});
