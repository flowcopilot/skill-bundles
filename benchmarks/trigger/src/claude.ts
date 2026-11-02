import { commandReads } from "./commands";
import { events, installedRead, record, workingDirectory, type ParseOptions, type RecordValue, type SuccessfulRead, type Transcript } from "./transcript";

export function parseClaudeTranscript(transcript: Transcript, options: ParseOptions = {}): SuccessfulRead[] {
  const calls = new Map<string, { block: RecordValue; cwd?: string }>();
  const results = new Map<string, RecordValue>();
  let cwd = options.cwd;
  for (const event of events(transcript)) {
    if (event.type === "system" && event.subtype === "init") cwd = workingDirectory(event.cwd, cwd);
    const content = record(event.message).content;
    if (!Array.isArray(content)) continue;
    for (const value of content) {
      const block = record(value);
      if (event.type === "assistant" && block.type === "tool_use" && typeof block.id === "string") {
        calls.set(block.id, { block, cwd: workingDirectory(record(block.input).cwd, event.cwd, cwd) });
      }
      if (event.type === "user" && block.type === "tool_result" && typeof block.tool_use_id === "string") {
        results.set(block.tool_use_id, block);
      }
    }
  }
  const reads: SuccessfulRead[] = [];
  for (const [id, { block, cwd }] of calls) {
    const result = results.get(id);
    if (!result || result.is_error) continue;
    const input = record(block.input);
    if (block.name === "Skill" && typeof input.skill === "string") {
      const bundle = input.skill.trim().replace(/^\//, "").split(/\s+/)[0].split(":").pop()!;
      if (/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(bundle)) reads.push({ bundle, path: "SKILL.md", tool: "Skill", complete: true });
    } else if (block.name === "Read" && typeof input.file_path === "string") {
      const complete = input.limit === undefined && input.offset === undefined;
      const start = typeof input.offset === "number" && input.offset > 0 ? input.offset : 1;
      const lines: [number, number | null] | undefined = complete ? undefined
        : [start, typeof input.limit === "number" ? start + input.limit - 1 : null];
      const read = installedRead(input.file_path, "Read", complete, { ...options, cwd }, lines);
      if (read) reads.push(read);
    } else if (block.name === "Bash" && typeof input.command === "string") {
      reads.push(...commandReads(input.command, "Bash", { ...options, cwd }));
    }
  }
  return reads;
}
