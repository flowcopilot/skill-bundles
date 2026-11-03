import { cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, statSync } from "node:fs";
import { basename, dirname, relative, resolve } from "node:path";
import { bundleAt, bundleNames, checkout, copy, filesUnder, frontmatter, json, marker, metadata, parseSkill, patchGeneratedFile, repositoryRoot, rewriteLocalPaths, run, safePath, settingsAt, sha256, sourceName, upstreamURL, write, writeMarkdown, type Lock, type Pin, type Source } from "./lib";

function isAgentInstruction(path: string) {
  return /(?:^|\/)(?:AGENTS(?:\.[^/]+)?\.md|CLAUDE(?:\.[^/]+)?\.md|GEMINI(?:\.[^/]+)?\.md|\.(?:cursorrules|windsurfrules|clinerules|roorules|goosehints)|[^/]+\.instructions\.md)$/i.test(path)
    || /(?:^|\/)(?:\.(?:cursor|windsurf|roo|claude|continue|kilocode)\/rules(?:\/|$)|\.clinerules\/|\.github\/(?:copilot-instructions\.md|instructions\/)|\.junie\/guidelines\.md|\.codex\/instructions\.md)/i.test(path);
}

export function readSkillTree(checkoutRoot: string, source: Source) {
  const sourceRoot = safePath(checkoutRoot, source.root);
  if (!existsSync(sourceRoot)) throw new Error(`${source.id}: missing source root ${source.root}`);
  const allFiles = filesUnder(sourceRoot);
  const skills = allFiles.filter((file) => basename(file) === "SKILL.md" && dirname(file) !== sourceRoot).map((file) => ({
    ...parseSkill(file), path: relative(sourceRoot, dirname(file)),
  }));
  const names = skills.map((skill) => skill.path);
  for (const name of names) if (!source.include.includes(name) && !source.exclude.includes(name)) throw new Error(`${source.id}: unlisted upstream skill ${name}; add it to include or exclude`);
  for (const name of source.include) if (!names.includes(name)) throw new Error(`${source.id}: missing included skill ${name}`);
  for (const name of source.exclude) if (!names.includes(name)) throw new Error(`${source.id}: missing excluded skill ${name}; remove the stale entry`);
  const files = allFiles.filter((file) => {
    const path = relative(sourceRoot, file);
    const owner = names.filter((name) => path.startsWith(`${name}/`)).sort((a, b) => b.length - a.length)[0];
    return owner && source.include.includes(owner);
  });
  for (const path of source.drop ?? []) {
    if (!files.some((file) => relative(sourceRoot, file) === path || relative(sourceRoot, file).startsWith(`${path.replace(/\/$/, "")}/`))) throw new Error(`${source.id}: drop does not name an imported file or folder: ${path}`);
  }
  const imported = files.filter((file) => !(source.drop ?? []).some((path) => relative(sourceRoot, file) === path || relative(sourceRoot, file).startsWith(`${path.replace(/\/$/, "")}/`)));
  for (const file of imported) {
    const path = relative(sourceRoot, file);
    if (isAgentInstruction(path)) throw new Error(`${source.id}: imported agent instruction file ${path}; list it in this source's drop array in bundle.json to remove it from the import`);
  }
  for (const name of source.include) if (!imported.includes(resolve(sourceRoot, name, "SKILL.md"))) throw new Error(`${source.id}: drop cannot remove included skill ${name}/SKILL.md`);
  const destinations = imported.map((file) => relative(sourceRoot, file).replace(/(^|\/)SKILL\.md$/, "$1index.md"));
  if (new Set(destinations).size !== destinations.length) throw new Error(`${source.id}: SKILL.md to index.md collision`);
  return { sourceRoot, skills, files: imported, names };
}

export function skillRoutes(source: Source, tree: ReturnType<typeof readSkillTree>) {
  const included = tree.skills.filter((skill) => source.include.includes(skill.path));
  const routes = (explicit: boolean) => included.filter((skill) => skill.explicit === explicit).map((skill) =>
    `- [${skill.name}](references/${source.id}/${skill.path}/index.md): ${skill.description}${explicit ? " (`disable-model-invocation: true`)" : ""}`,
  ).join("\n");
  return [`## ${source.id}`, routes(false), included.some((skill) => skill.explicit) ? `### Use only when the user asks for it by name\n\n${routes(true)}` : ""].filter(Boolean).join("\n\n");
}

export function writeSkillTree(tree: ReturnType<typeof readSkillTree>, source: Source, revision: string, target: string, settings: ReturnType<typeof settingsAt>) {
  const sourceTarget = resolve(target, "references", source.id);
  for (const guard of source.guards ?? []) {
    const file = safePath(tree.sourceRoot, guard.file);
    if (!existsSync(file) || !readFileSync(file, "utf8").includes(guard.contains)) throw new Error(`${source.id}: guard failed for ${guard.file}: ${guard.reason}`);
  }
  for (const file of tree.files) {
    const path = relative(tree.sourceRoot, file);
    const destination = safePath(sourceTarget, path.replace(/(^|\/)SKILL\.md$/, "$1index.md"));
    if (/\.md$/i.test(file)) writeMarkdown(destination, rewriteLocalPaths(readFileSync(file, "utf8"), path, source, revision, tree.names), marker(settings, sourceName(source.repository)));
    else copy(file, destination);
    if (statSync(file).mode & 0o111) run(["chmod", "+x", destination], target);
  }
  for (const change of source.replacements ?? []) {
    if (!tree.files.some((file) => relative(tree.sourceRoot, file) === change.file)) throw new Error(`${source.id}: replacement is outside imported files: ${change.file}`);
    patchGeneratedFile(safePath(sourceTarget, change.file.replace(/(^|\/)SKILL\.md$/, "$1index.md")), [change]);
  }
}

function loadLock(root: string): Lock {
  const path = resolve(root, "upstreams.lock.json");
  if (!existsSync(path)) return { version: 1, bundles: {} };
  const lock = json<Lock>(path);
  if (lock.version !== 1 || !lock.bundles || typeof lock.bundles !== "object") throw new Error(`Invalid upstreams.lock.json`);
  return lock;
}
function snapshot(directory: string) {
  return filesUnder(directory).map((file) => `${relative(directory, file)} ${statSync(file).mode & 0o111 ? "x" : "-"} ${sha256(readFileSync(file))}`).sort().join("\n");
}
function sameFile(left: string, right: string) {
  return existsSync(left) && existsSync(right) && readFileSync(left).equals(readFileSync(right));
}
// All new files exist in output before publication. Keep complete backups until every write succeeds.
function publishGenerated(root: string, output: string, backup: string) {
  const names = ["skills", "NOTICE.md", "upstreams.lock.json"];
  mkdirSync(backup);
  const original = new Set(names.filter((name) => existsSync(resolve(root, name))));
  for (const name of original) cpSync(resolve(root, name), resolve(backup, name), { recursive: true, preserveTimestamps: true });
  try {
    rmSync(resolve(root, "skills"), { recursive: true, force: true });
    cpSync(resolve(output, "skills"), resolve(root, "skills"), { recursive: true });
    copy(resolve(output, "NOTICE.md"), resolve(root, "NOTICE.md"));
    copy(resolve(output, "upstreams.lock.json"), resolve(root, "upstreams.lock.json"));
  } catch (error) {
    for (const name of names) {
      rmSync(resolve(root, name), { recursive: true, force: true });
      if (original.has(name)) renameSync(resolve(backup, name), resolve(root, name));
    }
    throw error;
  }
}

export type SyncOptions = { update?: boolean; only?: string; check?: boolean; acceptLicense?: string[] };
export function sync(root = repositoryRoot, options: SyncOptions = {}) {
  const settings = settingsAt(root);
  const names = bundleNames(root);
  if (options.only && !names.includes(options.only)) throw new Error(`Unknown bundle: ${options.only}`);
  if (options.check && options.update) throw new Error(`--check cannot be combined with --update`);
  if (options.acceptLicense?.length && !options.update) throw new Error(`--accept-license requires --update`);
  const configs = Object.fromEntries(names.map((name) => [name, bundleAt(root, name)]));
  for (const key of options.acceptLicense ?? []) if (!names.some((name) => configs[name].sources.some((source) => `${name}/${source.id}` === key))) throw new Error(`Unknown license acceptance: ${key}`);
  const originalLock = loadLock(root);
  const lock: Lock = { version: 1, bundles: options.only ? structuredClone(originalLock.bundles) : {} };
  mkdirSync(resolve(root, ".cache"), { recursive: true });
  const staging = mkdtempSync(resolve(root, ".cache/sync-"));
  const output = resolve(staging, "output");
  mkdirSync(resolve(output, "skills"), { recursive: true });
  try {
    if (options.only && existsSync(resolve(root, "skills"))) {
      filesUnder(resolve(root, "skills"));
      cpSync(resolve(root, "skills"), resolve(output, "skills"), { recursive: true });
    }
    for (const name of names.filter((name) => !options.only || name === options.only)) {
      const config = configs[name];
      const target = resolve(output, "skills", name);
      rmSync(target, { recursive: true, force: true });
      mkdirSync(target, { recursive: true });
      lock.bundles[name] = {};
      const routeMap: Record<string, string> = {};
      const excluded: string[] = [];
      for (const source of config.sources) {
        const previous = originalLock.bundles[name]?.[source.id];
        if (!options.update && (!previous || previous.repository !== source.repository || previous.ref !== source.ref || previous.root !== source.root || previous.licenseFile !== source.license.file || previous.spdx !== source.license.spdx)) throw new Error(`${name}/${source.id}: source has no matching pin; run sync -- --update`);
        const checkoutRoot = resolve(staging, "checkouts", name, source.id);
        const revision = checkout(source.repository, options.update ? source.ref : previous!.revision, checkoutRoot, !options.update);
        const license = safePath(checkoutRoot, source.license.file);
        if (!existsSync(license) || !lstatSync(license).isFile()) throw new Error(`${name}/${source.id}: missing license ${source.license.file}`);
        const licenseSha256 = sha256(readFileSync(license));
        if (previous && (previous.licenseSha256 !== licenseSha256 || previous.spdx !== source.license.spdx || previous.licenseFile !== source.license.file) && !options.acceptLicense?.includes(`${name}/${source.id}`)) throw new Error(`${name}/${source.id}: license changed; review it, then rerun with --update --accept-license ${name}/${source.id}`);
        const tree = readSkillTree(checkoutRoot, source);
        writeSkillTree(tree, source, revision, target, settings);
        copy(license, resolve(target, "licenses", `${source.id}-LICENSE`));
        const notice = [resolve(dirname(license), "NOTICE"), resolve(dirname(license), "NOTICE.md"), resolve(dirname(license), "NOTICE.txt"), resolve(checkoutRoot, "NOTICE"), resolve(checkoutRoot, "NOTICE.md"), resolve(checkoutRoot, "NOTICE.txt")].find(existsSync);
        if (notice) copy(safePath(checkoutRoot, relative(checkoutRoot, notice)), resolve(target, "licenses", `${source.id}-NOTICE`));
        lock.bundles[name][source.id] = { repository: source.repository, ref: source.ref, root: source.root, revision, licenseSha256, licenseFile: source.license.file, spdx: source.license.spdx };
        routeMap[source.id] = skillRoutes(source, tree);
        excluded.push(...source.exclude.map((skill) => `- ${source.id}: [${skill}](${upstreamURL(source.repository, revision, `${source.root}/${skill}/SKILL.md`)})`));
      }
      const local = resolve(root, "bundles", name, "files");
      for (const file of filesUnder(local)) {
        const destination = safePath(target, relative(local, file));
        if (existsSync(destination) || relative(local, file) === "SKILL.md") throw new Error(`${name}: local file collision: ${relative(local, file)}`);
        copy(file, destination);
      }
      const template = readFileSync(resolve(root, "bundles", name, "SKILL.md"), "utf8");
      if (metadata(template).data.name !== name) throw new Error(`${name}: router frontmatter name must match bundle`);
      const router = frontmatter(template, config.sources, settings).replace(/\{\{([^}]+)\}\}/g, (_, key: string) => {
        if (key === "routes") return Object.values(routeMap).join("\n\n");
        if (key.startsWith("routes:") && key.slice(7) in routeMap) return routeMap[key.slice(7)];
        if (key === "excluded") return excluded.join("\n") || "None.";
        if (key === "sources") throw new Error(`${name}: remove {{sources}}; NOTICE.md and upstreams.lock.json already name the sources`);
        throw new Error(`${name}: unknown router placeholder {{${key}}}`);
      });
      write(resolve(target, "SKILL.md"), router);
      const patchDir = resolve(root, "bundles", name, "patches");
      for (const patch of filesUnder(patchDir).filter((path) => path.endsWith(".patch"))) {
        // A separate Git root prevents git apply from finding the template repository above staging.
        run(["git", "init", "-q"], target);
        try { run(["git", "apply", "--check", patch], target); run(["git", "apply", patch], target); }
        catch (error) { throw new Error(`${name}: patch ${basename(patch)} failed. Review the upstream changes and try git apply --3way in a scratch checkout. ${error}`); }
        finally { rmSync(resolve(target, ".git"), { recursive: true, force: true }); }
      }
      filesUnder(target);
    }
    const notice = ["# Notice", "", "Generated by skill-bundles. Imported files retain their upstream licenses.", ""];
    for (const name of names) {
      notice.push(`## ${name}`, "");
      for (const source of configs[name].sources) {
        const pin = lock.bundles[name]?.[source.id];
        if (!pin) throw new Error(`${name}/${source.id}: missing pin for NOTICE.md; run a full sync -- --update`);
        notice.push(`- ${source.id}: ${source.repository}, revision \`${pin.revision}\`, ${source.license.spdx}. License: [${source.id}-LICENSE](skills/${name}/licenses/${source.id}-LICENSE).`);
        if (existsSync(resolve(output, "skills", name, "licenses", `${source.id}-NOTICE`))) notice.push(`- Upstream notice: [${source.id}-NOTICE](skills/${name}/licenses/${source.id}-NOTICE).`);
        for (const replacement of source.replacements ?? []) notice.push(`- Replacement in \`${replacement.file}\`: ${replacement.reason}`);
      }
      for (const patch of filesUnder(resolve(root, "bundles", name, "patches")).filter((file) => file.endsWith(".patch"))) notice.push(`- Local patch: [${basename(patch)}](bundles/${name}/patches/${basename(patch)}).`);
      notice.push("");
    }
    write(resolve(output, "NOTICE.md"), `${notice.join("\n").trimEnd()}\n`);
    const orderedLock = { version: 1, bundles: Object.fromEntries(Object.entries(lock.bundles).sort(([a], [b]) => a.localeCompare(b)).map(([name, pins]) => [name, Object.fromEntries(Object.entries(pins).sort(([a], [b]) => a.localeCompare(b)))])) };
    write(resolve(output, "upstreams.lock.json"), `${JSON.stringify(orderedLock, null, 2)}\n`);
    const changed = snapshot(resolve(output, "skills")) !== snapshot(resolve(root, "skills")) || !sameFile(resolve(output, "NOTICE.md"), resolve(root, "NOTICE.md")) || !sameFile(resolve(output, "upstreams.lock.json"), resolve(root, "upstreams.lock.json"));
    if (options.check) {
      if (changed) throw new Error(`Generated output differs. Run bun run sync and review skills/, NOTICE.md, and upstreams.lock.json.`);
    } else {
      if (changed) publishGenerated(root, output, resolve(staging, "backup"));
    }
    return { changed, bundles: names.length };
  } finally { rmSync(staging, { recursive: true, force: true }); }
}
export function syncOptions(args: string[]): SyncOptions {
  const result: SyncOptions = { acceptLicense: [] };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--") continue;
    if (arg === "--update") result.update = true;
    else if (arg === "--check") result.check = true;
    else if (arg === "--only" && args[i + 1] && !args[i + 1].startsWith("-")) result.only = args[++i];
    else if (arg === "--accept-license" && args[i + 1] && !args[i + 1].startsWith("-")) result.acceptLicense!.push(args[++i]);
    else throw new Error(`Unknown or incomplete option: ${arg}`);
  }
  return result;
}
if (import.meta.main) {
  try {
    const options = syncOptions(process.argv.slice(2));
    const result = sync(repositoryRoot, options);
    console.log(`${options.check ? "Checked" : "Synced"} ${result.bundles} bundles; ${result.changed ? "output updated" : "no changes"}.`);
  } catch (error) { console.error(String(error)); process.exitCode = 1; }
}
