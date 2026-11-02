import { posix } from "node:path";

export type SuccessfulRead = {
  bundle: string;
  path: string;
  tool: string;
  complete: boolean;
  // Requested 1-based line range of a partial read. `null` means to the end of the file.
  lines?: [number, number | null];
};

export type ParseOptions = {
  cwd?: string;
  skillRoots?: string[];
};

export type Transcript = string | readonly unknown[];
export type RecordValue = Record<string, unknown>;

export function record(value: unknown): RecordValue {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as RecordValue
    : {};
}

export function events(transcript: Transcript): RecordValue[] {
  return (typeof transcript === "string"
    ? transcript.split("\n").filter((line) => line.trim()).map((line) => JSON.parse(line))
    : transcript).map(record);
}

export function workingDirectory(...values: unknown[]): string | undefined {
  return values.find((value) => typeof value === "string" && value.length > 0) as string | undefined;
}

export function installedRead(
  file: string,
  tool: string,
  complete: boolean,
  options: ParseOptions,
  lines?: [number, number | null],
): SuccessfulRead | undefined {
  const path = posix.normalize(options.cwd ? posix.join(options.cwd, file) : file);
  const absolute = file.startsWith("/") ? posix.normalize(file) : path;
  let match = absolute.match(/(?:^|\/)\.(?:claude|agents|codex)\/skills\/([^/]+)\/(.+)$/);
  if (!match) {
    for (const root of options.skillRoots ?? []) {
      const prefix = `${posix.normalize(root).replace(/\/$/, "")}/`;
      if (!absolute.startsWith(prefix)) continue;
      match = absolute.slice(prefix.length).match(/^([^/]+)\/(.+)$/);
      if (match) break;
    }
  }
  if (!match || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(match[1])) return;
  if (match[2] !== "SKILL.md" && !/^references\/.+\.md$/.test(match[2])) return;
  return lines ? { bundle: match[1], path: match[2], tool, complete, lines } : { bundle: match[1], path: match[2], tool, complete };
}
