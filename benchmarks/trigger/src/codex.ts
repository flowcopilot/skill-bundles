import { commandReads } from "./commands";
import { events, record, workingDirectory, type ParseOptions, type SuccessfulRead, type Transcript } from "./transcript";

export function parseCodexTranscript(transcript: Transcript, options: ParseOptions = {}): SuccessfulRead[] {
  const reads: SuccessfulRead[] = [];
  const seen = new Set<string>();
  for (const event of events(transcript)) {
    const item = record(event.item);
    if (event.type !== "item.completed" || item.type !== "command_execution") continue;
    if (typeof item.id !== "string" || seen.has(item.id)) continue;
    seen.add(item.id);
    if (item.exit_code !== 0 || item.status !== "completed" || typeof item.command !== "string") continue;
    reads.push(...commandReads(item.command, "command_execution", {
      ...options,
      cwd: workingDirectory(item.cwd, event.cwd, options.cwd),
    }));
  }
  return reads;
}
