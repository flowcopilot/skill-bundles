import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { markdownLines } from "./markdown-code";

// Keep destination syntax and labels intact when the import changes a local filename.
export function mapMarkdownDestinations(text: string, rewrite: (destination: string) => string, protect = (text: string) => text): string {
  const replace = (_: string, prefix: string, angle: string | undefined, bare: string | undefined, suffix: string) =>
    protect(prefix + (angle === undefined ? rewrite(bare!) : `<${rewrite(angle)}>`) + suffix);
  return text.replace(/(^ {0,3}\[[^\]\n]+\]:[ \t]*)(?:<([^>\n]+)>|(\S+))([^\n]*)$/gm, replace)
    .replace(/((?<!\\)!?\[[^\]\n]*\]\([ \t]*)(?:<([^>\n]+)>|((?:\\.|[^\s()\\]|\([^()\n]*\))+))((?:[ \t]+(?:"[^"\n]*"|'[^'\n]*'|\([^()\n]*\)))?[ \t]*\))/g, replace);
}

export function markdownLinks(markdown: string): string[] {
  const text = markdownLines(markdown.replace(/<!--[^]*?-->/g, ""))
    .map(({ content, code }) => code ? "\n" : content).join("").replace(/(`+)([^]*?)\1(?!`)/g, "");
  const definitions = new Map<string, string>();
  const label = (value: string) => value.trim().replace(/\s+/g, " ").toLowerCase();
  const body = text.replace(
    /^ {0,3}\[([^\]]+)\]:\s*(?:<([^>]+)>|(\S+)).*$/gm,
    (_, name: string, angle: string, bare: string) => {
      if (!definitions.has(label(name))) definitions.set(label(name), angle ?? bare);
      return "";
    },
  );
  const links: string[] = [];
  const remaining = body.replace(
    /(?<!\\)(!?)\[[^\]\n]*\]\(\s*(?:<([^>\n]+)>|((?:\\.|[^\s()\\]|\([^()\n]*\))+))(?:\s+(?:"[^"\n]*"|'[^'\n]*'|\([^()\n]*\)))?\s*\)/g,
    (_, image: string, angle: string, bare: string) => {
      links.push(angle ?? bare);
      return "";
    },
  );
  for (const match of remaining.matchAll(/(?<!\\)(!?)\[([^\]\n]+)\](?:\[([^\]\n]*)\])?/g)) {
    const target = definitions.get(label(match[3] || match[2]));
    if (target) links.push(target);
  }
  return links.map((link) => link.replace(/\\([!"#$%&'()*+,\-./:;<=>?@[\]\\^_`{|}~])/g, "$1"));
}

// Upstream routers list references as a directory tree in a code block: a `folder/` line,
// then indented bare file names. This returns those names joined with their folders.
export function treeMentions(text: string): string[] {
  const mentions: string[] = [];
  let fence = "";
  let folders: { indent: number; name: string }[] = [];
  for (const line of text.split("\n")) {
    const marker = line.match(/^\s*(`{3,}|~{3,})/);
    if (marker) {
      if (!fence) [fence, folders] = [marker[1], []];
      else if (marker[1][0] === fence[0] && marker[1].length >= fence.length) fence = "";
      continue;
    }
    if (!fence) continue;
    const item = line.match(/^([\s|`├└│─-]*)([\w.-]+(?:\/[\w.-]+)*)(\/)?(?=\s|$)/);
    if (!item) continue;
    const indent = item[1].length;
    while (folders.length > 0 && folders.at(-1)!.indent >= indent) folders.pop();
    if (item[3]) folders.push({ indent, name: item[2] });
    else if (folders.length > 0) {
      mentions.push([...folders.map((folder) => folder.name), item[2]].join("/"));
    }
  }
  return mentions;
}

export function reachableMarkdown(entry: string, files: string[]): Set<string> {
  const available = new Set(files);
  const reached = new Set<string>();
  const pending = [entry];
  const bases = [resolve(dirname(entry), "references"), dirname(entry)];
  while (pending.length > 0) {
    const file = pending.pop()!;
    if (reached.has(file) || !available.has(file)) continue;
    reached.add(file);
    const text = readFileSync(file, "utf8").replace(/<!--[^]*?-->/g, "");
    if (text.includes("\0")) continue;
    // Agents follow literal paths in code and directory trees as well as Markdown links.
    const prose = text.replace(/[a-z][a-z0-9+.-]*:\/\/[^\s<>"')]+/gi, "");
    const mentions = [...prose.matchAll(/(?<![\w./:-])(?:\.{1,2}\/)*[\w.-]+(?:\/[\w.-]+)*\.[a-zA-Z0-9]+\b/g)].map(([mention]) => mention);
    for (const mention of [...mentions, ...treeMentions(prose)]) {
      const target = [dirname(file), ...bases].map((base) => resolve(base, mention)).find((path) => available.has(path));
      if (target) pending.push(target);
    }
    for (const link of markdownLinks(text)) {
      if (/^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i.test(link)) continue;
      try {
        pending.push(resolve(dirname(file), decodeURIComponent(link.split(/[?#]/)[0])));
      } catch {
        throw new Error(`${file}: invalid Markdown link ${link}`);
      }
    }
  }
  return reached;
}
