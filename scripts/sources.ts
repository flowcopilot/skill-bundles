import { existsSync, lstatSync, readFileSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { basename, dirname, relative, resolve } from "node:path";
import { checkout, filesUnder, parseSkill, repositoryRoot, safePath, run } from "./lib";

const args = process.argv.slice(2).filter((arg) => arg !== "--");
const repository = args.shift();
if (!repository) throw new Error("Usage: bun run sources -- <repository> [--ref <ref>] [--root <path>]");
let ref = "HEAD";
let root = ".";
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--ref" && args[i + 1]) ref = args[++i];
  else if (args[i] === "--root" && args[i + 1]) root = args[++i];
  else throw new Error(`Unknown or incomplete option: ${args[i]}`);
}
mkdirSync(resolve(repositoryRoot, ".cache"), { recursive: true });
const workspace = mkdtempSync(resolve(repositoryRoot, ".cache/sources-"));
try {
  const revision = checkout(repository, ref, workspace);
  const directory = safePath(workspace, root);
  if (!existsSync(directory)) throw new Error(`Missing root: ${root}`);
  console.log(`Repository: ${repository}\nRevision: ${revision}\nRoot: ${root}`);
  for (const file of filesUnder(directory).filter((file) => basename(file) === "SKILL.md")) {
    const skill = parseSkill(file);
    console.log(JSON.stringify({ path: relative(directory, dirname(file)) || ".", name: skill.name, description: skill.description, "disable-model-invocation": skill.explicit }));
  }
  const licenses = run(["git", "ls-files", "-z"], workspace).split("\0").filter((file) => /^(?:licen[cs]e|copying|notice)(?:[.-].*)?$/i.test(basename(file)));
  console.log(`License files: ${licenses.join(", ") || "none"}`);
  for (const path of licenses) {
    const file = safePath(workspace, path);
    if (!lstatSync(file).isFile()) throw new Error(`License is not a regular file: ${path}`);
    const text = readFileSync(file, "utf8");
    const spdx = /Permission is hereby granted, free of charge/.test(text) ? "MIT" : /Apache License/.test(text) ? "Apache-2.0" : "Review required";
    console.log(JSON.stringify({ license: path, spdx, heading: text.split("\n").slice(0, 3).join(" ") }));
  }
} finally { rmSync(workspace, { recursive: true, force: true }); }
