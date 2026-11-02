import { chmodSync, copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve, sep } from "node:path";
import { createHash } from "node:crypto";
import { markdownLines } from "./markdown-code";
import { mapMarkdownDestinations } from "./markdown-links";

export type Source = {
  id: string; repository: string; ref: string; root: string; include: string[]; exclude: string[];
  license: { spdx: string; file: string };
  drop?: string[];
  replacements?: { file: string; find: string; replace: string; reason: string }[];
  guards?: { file: string; contains: string; reason: string }[];
};
export type Bundle = { sources: Source[]; notForAgents?: Record<string, string> };
export type Settings = { attribution: string; author: string; defaultBranch: string };
export type Pin = { repository: string; ref: string; root: string; revision: string; licenseSha256: string; licenseFile: string; spdx: string };
export type Lock = { version: 1; bundles: Record<string, Record<string, Pin>> };
export const repositoryRoot = resolve(import.meta.dir, "..");
export const json = <T>(file: string): T => JSON.parse(readFileSync(file, "utf8"));
export const sha256 = (value: Uint8Array | string) => createHash("sha256").update(value).digest("hex");
export const identifier = (value: string) => typeof value === "string" && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value);
export function safePath(root: string, path: string): string {
  if (typeof path !== "string" || !path || path.startsWith("/") || path.includes("\\") || path.split("/").includes("..")) throw new Error(`Unsafe path: ${path}`);
  const target = resolve(root, path);
  if (target !== root && !target.startsWith(`${root}${sep}`)) throw new Error(`Path escapes root: ${path}`);
  let current = root;
  for (const part of relative(root, target).split(sep).filter(Boolean)) {
    current = resolve(current, part);
    if (existsSync(current) && lstatSync(current).isSymbolicLink()) throw new Error(`Refused symlink: ${current}`);
  }
  return target;
}
export function filesUnder(directory: string): string[] {
  const entry = lstatSync(directory, { throwIfNoEntry: false });
  if (!entry) return [];
  if (entry.isSymbolicLink()) throw new Error(`Refused symlink: ${directory}`);
  return readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name)).flatMap((entry) => {
    const path = resolve(directory, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`Refused symlink: ${path}`);
    if (entry.name === ".git") return [];
    if (entry.isDirectory()) return filesUnder(path);
    if (!entry.isFile()) throw new Error(`Unsupported file: ${path}`);
    return [path];
  });
}
export function write(file: string, value: string | Uint8Array) {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, value);
}
export function copy(source: string, destination: string) {
  mkdirSync(dirname(destination), { recursive: true });
  copyFileSync(source, destination);
  chmodSync(destination, statSync(source).mode & 0o777);
}
export function metadata(text: string, file = "Markdown"): { data: Record<string, any>; header: string; body: string } {
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!match) throw new Error(`${file}: missing YAML frontmatter`);
  const data = Bun.YAML.parse(match[1]);
  if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error(`${file}: frontmatter must be a mapping`);
  return { data, header: match[0], body: text.slice(match[0].length) };
}
export function parseSkill(file: string) {
  const text = readFileSync(file, "utf8");
  const { data } = metadata(text, file);
  if (typeof data.name !== "string" || typeof data.description !== "string") throw new Error(`${file}: name and description must be strings`);
  if (data["disable-model-invocation"] !== undefined && typeof data["disable-model-invocation"] !== "boolean") throw new Error(`${file}: disable-model-invocation must be boolean`);
  return { text, name: data.name, description: data.description.replace(/\s+/g, " ").trim(), explicit: data["disable-model-invocation"] === true };
}
export function marker(settings: Settings, source: string, revision: string) {
  return `<!-- Modified by ${settings.attribution} from ${source} revision ${revision}. -->`;
}
export function sourceName(repository: string) {
  return repository.match(/(?:github\.com[:/])([^/]+\/[^/]+?)(?:\.git)?$/)?.[1] ?? repository;
}
export function upstreamURL(repository: string, revision: string, path: string) {
  const name = sourceName(repository);
  return name !== repository ? `https://github.com/${name}/blob/${revision}/${path.split("/").filter((p) => p !== ".").map(encodeURIComponent).join("/")}` : repository;
}
export function writeMarkdown(file: string, text: string, attribution: string) {
  const header = text.match(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/)?.[0] ?? "";
  write(file, `${header}${header && !header.endsWith("\n") ? "\n" : ""}${attribution}\n\n${text.slice(header.length).replace(/^\s*\n/, "")}`);
}
export function outsideCode(text: string, rewrite: (text: string) => string) {
  return markdownLines(text).map(({ line, code }) => code ? line : rewrite(line)).join("");
}
export function rewriteLocalPaths(text: string, file: string, source: Source, revision: string, skillNames: string[]) {
  const rewrite = (destination: string, literal = false) => {
    if (/^(?:[a-z][a-z0-9+.-]*:|\/|git@|#)/i.test(destination)) return destination;
    const [encodedPath] = destination.split(/[?#]/);
    let path: string;
    try { path = decodeURIComponent(encodedPath.replace(/\\([!"#$%&'()*+,\-./:;<=>?@[\]\\^_`{|}~])/g, "$1")); } catch { return destination; }
    // Sentence punctuation is prose. Inside a link, it is part of the filename.
    const punctuation = literal ? path.match(/[.,;:!]+$/)?.[0] ?? "" : "";
    if (punctuation) path = path.slice(0, -punctuation.length);
    if (path.split("/").at(-1) !== "SKILL.md") return destination;
    const suffix = destination.slice(encodedPath.length);
    const resolved = resolve("/", dirname(file), path).slice(1);
    const skill = resolved.replace(/\/SKILL\.md$/, "");
    if (skillNames.includes(skill) && !source.include.includes(skill)) return upstreamURL(source.repository, revision, `${source.root}/${resolved}`) + suffix + punctuation;
    const localPath = path.replace(/SKILL\.md$/, "index.md").split("/").map((part) => encodeURIComponent(part).replace(/[!'()*]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`)).join("/");
    return localPath + suffix + punctuation;
  };
  return outsideCode(text, (prose) => {
    const links: string[] = [];
    const remaining = mapMarkdownDestinations(prose, (destination) => rewrite(destination), (link) => {
      links.push(link);
      return `\0${links.length - 1}\0`;
    });
    return remaining.replace(/(?:[a-z][a-z0-9+.-]*:\/\/|git@)[^\s<>"')]+|[^\s<>"'()[\]`]+/gi, (path) => rewrite(path, true))
      .replace(/\0(\d+)\0/g, (_, index) => links[Number(index)]);
  });
}
export function patchGeneratedFile(file: string, changes: NonNullable<Source["replacements"]>) {
  let text = readFileSync(file, "utf8");
  for (const change of changes) {
    if (!change.find || text.split(change.find).length !== 2) throw new Error(`${file}: replacement text changed or is not unique: ${change.find}`);
    text = text.replace(change.find, () => change.replace);
  }
  write(file, text);
}
export function frontmatter(template: string, sources: Source[], settings: Settings) {
  const { data, body } = metadata(template);
  data.license = [...new Set(sources.map((source) => source.license.spdx))].sort().join(" AND ") || "MIT";
  data.metadata = { ...(data.metadata ?? {}), author: settings.author };
  return `---\n${Bun.YAML.stringify(data, null, 2).trimEnd()}\n---\n${body}`;
}
export function settingsAt(root: string): Settings {
  const settings = json<Settings>(resolve(root, "skill-bundles.json"));
  for (const key of ["attribution", "author", "defaultBranch"] as const) if (typeof settings[key] !== "string" || !settings[key].trim() || /[\r\n<>]/.test(settings[key])) throw new Error(`Invalid setting: ${key}`);
  return settings;
}
export function bundleNames(root: string): string[] {
  const directory = resolve(root, "bundles");
  if (!existsSync(directory)) return [];
  return readdirSync(directory).sort().map((name) => {
    if (!identifier(name)) throw new Error(`Invalid bundle name: ${name}`);
    if (!lstatSync(resolve(directory, name)).isDirectory()) throw new Error(`Expected bundle directory: ${name}`);
    return name;
  });
}
export function bundleAt(root: string, name: string): Bundle {
  const bundle = json<Bundle>(safePath(root, `bundles/${name}/bundle.json`));
  if (!Array.isArray(bundle.sources)) throw new Error(`${name}: sources must be an array`);
  const ids = new Set();
  for (const source of bundle.sources) {
    if (!identifier(source.id) || ids.has(source.id)) throw new Error(`${name}: invalid or duplicate source id ${source.id}`);
    ids.add(source.id);
    for (const value of [source.repository, source.ref, source.license?.spdx, source.license?.file]) if (typeof value !== "string" || !value.trim() || /[\r\n]/.test(value)) throw new Error(`${name}/${source.id}: missing source field`);
    if (source.ref.startsWith("-")) throw new Error(`Invalid ref: ${source.ref}`);
    safePath(root, source.root);
    safePath(root, source.license.file);
    if (!Array.isArray(source.include) || !Array.isArray(source.exclude)) throw new Error(`${source.id}: include and exclude must be arrays`);
    const names = [...source.include, ...source.exclude];
    for (const path of names) { safePath(root, path); if (path === ".") throw new Error(`A skill must be a folder under root`); }
    if (new Set(names).size !== names.length) throw new Error(`${source.id}: duplicate include or exclude`);
    if (source.drop !== undefined && !Array.isArray(source.drop)) throw new Error(`${source.id}: drop must be an array`);
    for (const path of source.drop ?? []) {
      safePath(root, path);
      if (path === ".") throw new Error(`${source.id}: drop must name an imported file or folder`);
    }
    for (const change of source.replacements ?? []) {
      safePath(root, change.file);
      if (typeof change.find !== "string" || !change.find || typeof change.replace !== "string" || !change.reason?.trim()) throw new Error(`${source.id}: replacement needs find, replace, and reason`);
    }
    for (const guard of source.guards ?? []) {
      safePath(root, guard.file);
      if (!guard.contains?.trim() || !guard.reason?.trim()) throw new Error(`${source.id}: guard needs contains and reason`);
    }
  }
  for (const [path, reason] of Object.entries(bundle.notForAgents ?? {})) {
    safePath(root, path);
    if (!path.startsWith("references/") || typeof reason !== "string" || !reason.trim()) throw new Error(`${name}: invalid notForAgents entry ${path}`);
  }
  return bundle;
}
export function run(command: string[], cwd: string, env = process.env) {
  const result = Bun.spawnSync(command, { cwd, env, stdout: "pipe", stderr: "pipe" });
  if (result.exitCode !== 0) {
    const stderr = result.stderr.toString().trim();
    throw new Error(`${command[0]} ${command[1]} failed: ${env.UPSTREAM_TOKEN ? stderr.replaceAll(env.UPSTREAM_TOKEN, "[redacted]") : stderr}`);
  }
  return result.stdout.toString().trim();
}
export function gitEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env, GIT_TERMINAL_PROMPT: "0" };
  if (!env.UPSTREAM_TOKEN) return env;
  const index = Number(env.GIT_CONFIG_COUNT ?? "0");
  return { ...env, GIT_CONFIG_COUNT: String(index + 1), [`GIT_CONFIG_KEY_${index}`]: `url.https://x-access-token:${env.UPSTREAM_TOKEN}@github.com/.insteadOf`, [`GIT_CONFIG_VALUE_${index}`]: "https://github.com/" };
}
export function checkout(repository: string, ref: string, destination: string, pinned = false) {
  if (!repository || repository.startsWith("-") || !ref || ref.startsWith("-")) throw new Error("Invalid repository or ref");
  if (pinned && !/^[a-f0-9]{40}$/.test(ref)) throw new Error(`Invalid revision pin: ${ref}`);
  mkdirSync(destination, { recursive: true });
  const git = (...args: string[]) => run(["git", "-c", "core.hooksPath=/dev/null", ...args], destination, gitEnv());
  git("init", "-q");
  git("remote", "add", "origin", repository);
  git("fetch", "--depth", "1", "origin", ref);
  git("checkout", "--detach", "--force", "FETCH_HEAD");
  const revision = git("rev-parse", "HEAD");
  if (pinned && revision !== ref) throw new Error(`Revision mismatch: expected ${ref}, got ${revision}`);
  return revision;
}
