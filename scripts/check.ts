import { existsSync, readFileSync, readdirSync } from "node:fs";
import { basename, dirname, relative, resolve, sep } from "node:path";
import { bundleAt, bundleNames, filesUnder, json, marker, metadata, repositoryRoot, safePath, settingsAt, sha256, sourceName, type Lock } from "./lib";
import { markdownLinks, reachableMarkdown } from "./markdown-links";

export function check(root = repositoryRoot): string[] {
  const errors: string[] = [];
  const settings = settingsAt(root);
  const ignoreFile = resolve(root, ".lycheeignore");
  const ignoredLinks = existsSync(ignoreFile) ? readFileSync(ignoreFile, "utf8").split(/\r?\n/).map((line) => line.trim()).filter((line) => line && !line.startsWith("#")).map((pattern) => new RegExp(pattern)) : [];
  const names = bundleNames(root);
  const skillsRoot = resolve(root, "skills");
  filesUnder(skillsRoot);
  const outputNames = existsSync(skillsRoot) ? readdirSync(skillsRoot).sort() : [];
  if (JSON.stringify(names) !== JSON.stringify(outputNames)) errors.push("bundles/ and skills/ names differ");
  const lockPath = resolve(root, "upstreams.lock.json");
  const lock = existsSync(lockPath) ? json<Lock>(lockPath) : { version: 1, bundles: {} };
  for (const name of names) {
    try {
      const config = bundleAt(root, name);
      const target = resolve(skillsRoot, name);
      for (const entry of [resolve(root, "bundles", name, "SKILL.md"), resolve(target, "SKILL.md")]) {
        const routerText = readFileSync(entry, "utf8");
        if (routerText.includes("REPLACE_WITH_")) errors.push(`${entry}: replace every REPLACE_WITH_ placeholder from bun run new`);
        const { data } = metadata(routerText, entry);
        if (data.name !== name) errors.push(`${entry}: name must be ${name}`);
        const description = data.description;
        if (typeof description !== "string" || description.length >= 1024 || !description.startsWith("Load this skill before you") || !/(?:^|\.\s+)Covers\s/.test(description)) errors.push(`${entry}: description needs a When sentence, then a Covers sentence, under 1024 characters`);
      }
      const files = filesUnder(target);
      const reached = reachableMarkdown(resolve(target, "SKILL.md"), files);
      for (const [path] of Object.entries(config.notForAgents ?? {})) {
        const file = safePath(target, path);
        if (!files.includes(file)) errors.push(`${name}: stale notForAgents entry ${path}`);
        else if (reached.has(file)) errors.push(`${name}: notForAgents file is now reachable: ${path}`);
      }
      for (const file of files) {
        const path = relative(target, file);
        const text = readFileSync(file, "utf8");
        if (path.startsWith("references/") && !reached.has(file) && !(path in (config.notForAgents ?? {}))) errors.push(`${name}: unreachable reference ${path}`);
        if (/\.(md)$/i.test(file)) {
          for (const link of markdownLinks(text)) {
            if (/^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i.test(link)) continue;
            try {
              const destination = decodeURIComponent(link.split(/[?#]/)[0]);
              const localTarget = resolve(dirname(file), destination);
              if (destination.startsWith("/") || (localTarget !== target && !localTarget.startsWith(`${target}${sep}`))) errors.push(`${name}/${path}: link leaves bundle ${link}`);
              else if (!ignoredLinks.some((pattern) => pattern.test(link)) && !existsSync(localTarget)) errors.push(`${name}/${path}: broken relative link ${link}`);
            } catch { errors.push(`${name}/${path}: invalid relative link ${link}`); }
          }
        }
        const isLicense = path.startsWith("licenses/") || /^(?:LICENSE|LICENCE|COPYING|NOTICE)/i.test(basename(file));
        if (/\/(?:Users|home)\//.test(text)) errors.push(`${name}/${path}: absolute home path`);
        const withoutGitAddresses = text.replace(/(?:ssh|git\+ssh):\/\/[^\s<>"')]+|git@[\w.-]+:[^\s<>"')]+/g, "");
        if (!isLicense && /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(withoutGitAddresses)) errors.push(`${name}/${path}: email address`);
        if (/\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|sk-(?:proj-)?[A-Za-z0-9_-]{20,}|AKIA[A-Z0-9]{16})\b/.test(text)) errors.push(`${name}/${path}: token-like string`);
        if (/\$(?:ARGUMENTS|CLAUDE_PROJECT_DIR|CODEX_HOME)\b|\{\{(?:ARGUMENTS|args)\}\}/.test(text)) errors.push(`${name}/${path}: harness placeholder`);
      }
      for (const source of config.sources) {
        const pin = lock.bundles[name]?.[source.id];
        if (!pin || !/^[a-f0-9]{40}$/.test(pin.revision)) { errors.push(`${name}/${source.id}: missing revision pin`); continue; }
        const license = resolve(target, "licenses", `${source.id}-LICENSE`);
        if (!existsSync(license)) errors.push(`${name}/${source.id}: missing license file`);
        else if (sha256(readFileSync(license)) !== pin.licenseSha256) errors.push(`${name}/${source.id}: license hash differs from lock`);
        for (const file of files.filter((file) => relative(target, file).startsWith(`references/${source.id}/`) && /\.md$/i.test(file))) {
          const text = readFileSync(file, "utf8");
          const header = text.match(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/)?.[0] ?? "";
          if (!text.slice(header.length).trimStart().startsWith(marker(settings, sourceName(source.repository), pin.revision))) errors.push(`${name}/${relative(target, file)}: missing attribution after frontmatter`);
        }
      }
    } catch (error) { errors.push(`${name}: ${error}`); }
  }
  return errors;
}
if (import.meta.main) {
  try {
    const errors = check();
    if (errors.length) { console.error(errors.join("\n")); process.exitCode = 1; }
    else console.log("All bundle structure, content, links, and reach checks pass.");
  } catch (error) { console.error(String(error)); process.exitCode = 1; }
}
