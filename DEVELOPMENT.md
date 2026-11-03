# Development reference

`bundles/` is the source of truth. `skills/`, `NOTICE.md`, and `upstreams.lock.json` are generated. A new bundle needs no engine adapter.

## Toolchain and commands

Run `mise install` inside the repository to install the pinned tools in `mise.toml`. Use the installed tools through your mise shell activation or shims. Do not install ad hoc tools or change user-global config.

| Command | Result |
| --- | --- |
| `bun run sources -- <repository> [--ref <ref>] [--root <path>]` | List upstream skill folders, descriptions, invocation flags, and license files. Defaults: `HEAD`, `.`. |
| `bun run new -- <name>` | Create an empty bundle config and router template. |
| `bun run sync` | Regenerate every bundle at its locked SHA. An initial source needs `--update`. |
| `bun run sync -- --only <bundle>` | Regenerate one bundle without moving other pins. |
| `bun run sync -- --update [--only <bundle>]` | Fetch the latest source refs and write real SHA pins. |
| `bun run sync -- --check` | Regenerate in staging and fail if output, notice, or lock differs. The repository output stays unchanged. |
| `bun run sync -- --update --accept-license <bundle>/<id>` | Accept a reviewed license change. Repeat the flag for more sources. |
| `bun test` | Run engine fixture tests and benchmark unit tests. No paid model calls. |
| `bun run check` | Check structure, descriptions, reach, links, attribution, licenses, and output content. |
| `bun run validate` | Run the commit-pinned Agent Skills reference validator through uv. |
| `lychee --offline --no-progress './**/*.md'` | Check local Markdown links across the repository. |
| `actionlint .github/workflows/*.yml` | Check workflows and their shell scripts. |
| `git diff --check` | Check whitespace in tracked changes. |

Zero bundles is valid. Sync removes stale output on a full run. `--only` preserves other generated bundles and their pins. Staging and fixture repositories use the ignored `.cache/` directory. The engine deletes each staging checkout when the command ends. All generated files are staged before publication. If a publication write fails, sync restores `skills/`, `NOTICE.md`, and `upstreams.lock.json` from backups.

## Repository settings

`skill-bundles.json` has three non-empty string fields:

```json
{ "attribution": "Your Org", "author": "your-org", "defaultBranch": "main" }
```

`attribution` supplies the imported Markdown marker. `author` supplies the generated router's `metadata.author`. `defaultBranch` supplies the sync pull request base. Workflow push filters and Git init defaults also need an edit if you rename the branch.

The marker appears after YAML frontmatter, or at the start when no frontmatter exists:

```text
<!-- Modified by Your Org from owner/repo. -->
```

The marker names no revision, because agents read it each time they open the file. `NOTICE.md` and `upstreams.lock.json` hold the pinned revision. The checker fails on a marker in any other form. The checker and benchmark read the attribution setting. GitHub source names use `owner/repo`. Other hosts keep the repository URL.

## Bundle config

Each `bundles/<name>/bundle.json` contains `sources` and an optional `notForAgents` map. Bundle and source ids use lowercase letters, numbers, and single hyphens. Source ids must be unique within the bundle.

```json
{
  "sources": [
    {
      "id": "example",
      "repository": "https://github.com/example/skills.git",
      "ref": "main",
      "root": "skills",
      "include": ["docs"],
      "exclude": ["other"],
      "license": { "spdx": "MIT", "file": "LICENSE" },
      "drop": [],
      "replacements": [],
      "guards": []
    }
  ],
  "notForAgents": {
    "references/example/docs/agents/openai.yaml": "Display metadata that the instructions do not read."
  }
}
```

`repository` accepts Git URLs, including SSH, non-GitHub hosts, and file URLs for tests. `ref` names a branch, tag, or commit. `root` and `license.file` are repository-relative paths. Skill paths in `include` and `exclude` are relative to `root`. Guards, replacements, and `drop` also use paths relative to `root`. Paths cannot be absolute, contain `..`, or pass through symlinks.

A skill is a directory below `root` with `SKILL.md`. Discovery is recursive. Every discovered skill must appear in exactly one list. A new unlisted skill stops sync and names both lists. A missing included or excluded skill also stops sync. Nested skills retain their relative folders. Files belong to the nearest enclosing skill, so an excluded nested skill is not copied with an included parent.

`notForAgents` maps generated bundle-relative reference paths to reasons. Use it only for files that provide no agent instructions. The checker rejects stale entries and files that become reachable. Reach includes Markdown links, literal paths, and directory-tree mentions. It covers non-Markdown files such as scripts and images as well as Markdown.

## Router template

`bundles/<name>/SKILL.md` has frontmatter with `name` equal to the bundle folder. Write the description as two plain sentences:

1. Start with `Load this skill before you`. Name a project signal, such as a dependency or config file, and relevant product names.
2. Start with `Covers` and list the topics in task language.

Keep the description under 1024 characters. Add `Do not load it for` only after a near-miss task loads it by mistake. The [benchmark notes](benchmarks/trigger/README.md) record the measured results behind this format.

The engine expands these placeholders:

| Placeholder | Content |
| --- | --- |
| `{{routes}}` | All included references, grouped by source, with upstream descriptions. |
| `{{routes:<id>}}` | Routes for one source id. |
| `{{excluded}}` | Excluded skill names and upstream links at the pinned revision. |

Agents read the whole router each time they load the bundle, so every line costs context. Do not add a section about sources, attribution, or licenses. `NOTICE.md` and `upstreams.lock.json` already hold them. Sync stops on the removed `{{sources}}` placeholder, and `bun run check` fails on a heading such as `Sources` or `Attribution`. Use `{{excluded}}` only when the excluded list is short, or when users can ask for an excluded skill. The import already links excluded siblings that an imported reference mentions to their upstream files. `bun run new` writes `REPLACE_WITH_` placeholders, and `bun run check` fails until you replace them all.

Unknown placeholders stop sync. Routes preserve `disable-model-invocation: true` under **Use only when the user asks for it by name**. The router must keep this rule visible. Paths in the router are relative to its `SKILL.md` folder. Each route points directly to an imported `index.md`. Read that reference as a file.

The engine adds `license` from the sorted set of source SPDX ids, joined with `AND`. It sets `metadata.author` from repository settings and preserves other router metadata. Metadata values are strings, except `internal`. Set `metadata.internal: true` to hide a bundle from `npx skills add` until a user names it with `--skill`. `bun run new` sets it on every new bundle. Remove it when the bundle is ready to publish. A bundle with no sources uses the template's MIT license.

## Import rules

Included folders go to `skills/<bundle>/references/<id>/<skill>/`. Source ids prevent collisions between skills with the same name. `SKILL.md` becomes `index.md`. Upstream frontmatter, other files, and executable modes remain present. The engine rejects symlinks in source roots and imported trees.

The optional per-source `drop` array removes named files or complete folders from the import. For example, `"drop": ["docs/AGENTS.md", "docs/.cursor/rules"]` removes those paths relative to the source's `root`. Each entry must name an imported file or folder. An entry cannot remove an included skill's `SKILL.md`.

Sync stops if an imported file supplies agent instructions, such as `AGENTS.md`, `CLAUDE.md`, `GEMINI.md`, `.cursorrules`, `.cursor/rules/`, or `.github/copilot-instructions.md`. The error names the file. Review the file, then list its path in that source's `drop` array to remove it.

Outside fenced code and URLs, local references to `SKILL.md` become `index.md`. Included sibling references remain local. Excluded siblings link to the upstream file at the pinned revision. Non-GitHub links fall back to the repository URL.

Import adds attribution, then applies configured replacements. Local files under `bundles/<name>/files/` are copied unchanged. A local file cannot overwrite an imported file or the router. Finally, `bundles/<name>/patches/*.patch` files apply in filename order with `git apply`. No upstream scripts execute during sync.

## Guards, replacements, and patches

A guard checks upstream text before import:

```json
{ "file": "docs/SKILL.md", "contains": "text the router depends on", "reason": "The router maps this upstream instruction to a local path." }
```

Guard only facts that local instructions depend on. A guard failure requires review of the changed fact. Weakening the guard without that review hides the change.

A replacement is an exact edit to an imported file after link rewrites and attribution:

```json
{ "file": "docs/SKILL.md", "find": "exact text", "replace": "new text", "reason": "Correct an upstream fact that the bundle relies on." }
```

`find` must occur exactly once. Zero or multiple matches stop sync. Each reason appears in `NOTICE.md`. Replacements must target imported files.

Use a patch for a larger fork. Patch paths are relative to the generated bundle folder, for example `a/references/example/docs/index.md`. If a patch fails, sync gives a `git apply --3way` hint. Use that command in a scratch checkout to review the conflict. Save the reviewed result back to the patch. Never resolve the conflict by editing `skills/`.

## Pins and licenses

The version-1 `upstreams.lock.json` groups pins by bundle, then source id. Each pin records `repository`, `ref`, `root`, `revision`, `licenseSha256`, `licenseFile`, and `spdx`. Normal sync fetches `origin <sha>` with `--depth 1` and verifies the checked-out SHA. It does not follow HEAD. A changed source identity needs `--update`.

The license file is mandatory. Sync copies it to `licenses/<id>-LICENSE`. If `NOTICE`, `NOTICE.md`, or `NOTICE.txt` exists beside the license or at the upstream root, sync also copies it to `licenses/<id>-NOTICE`.

The lock stores the license's SHA-256. A changed license file, license path, or SPDX id stops an update. Review the complete license change before you use `--accept-license <bundle>/<id>`. The first import also needs a license review, although there is no previous hash to compare. The SPDX id is your reviewed declaration. Automatic text detection in `sources` is a discovery aid, not legal validation.

For private HTTPS GitHub sources, `UPSTREAM_TOKEN` adds a process-local `url.insteadOf` rule. The engine does not write credentials to user-global Git config. Git handles SSH and other hosts normally.

## Update and review loop

1. Run `bun run sources` for each repository and root before you add config. Read the reported license file.
2. Add or edit a bundle's config, router, local files, or patch.
3. Run `bun run sync -- --update --only <bundle>` when you intend to move that bundle's source pins. Use normal `--only` for local config changes at the existing pins.
4. Review the lock, instruction changes, attribution, licenses, and `NOTICE.md`.
5. Run `bun test`, `bun run check`, and `bun run validate`.
6. Run `bun run sync` twice. The second run must report no changes.
7. Run `bun run sync -- --check`, offline lychee, actionlint, and `git diff --check`.
8. Open a pull request with the repository template. Reinstall the bundle in consumer projects after merge.

For an upstream placeholder link, add its target pattern to `.lycheeignore` at the repository root. Both `bun run check` and lychee use this file. Write one regular expression per line. Blank lines and lines that start with `#` are ignored. For example, `missing\.md` excuses the link target `missing.md`. Keep patterns narrow. The bundle checker still rejects a target outside the bundle folder.

The content checker rejects home paths, email addresses outside license files, common token formats, harness placeholders, missing provenance, unresolved local links, and unreachable references. It rejects symlinks. The reference validator checks the installable router format and optional field types. These checks do not execute imported helpers, inspect remote URLs, or prove instruction quality.

## Fix a failed weekly sync

The weekly workflow updates sources, runs the same validation checks, and pushes `automation/sync-upstream-skills` with a lease. It opens or updates a pull request only when `SYNC_TOKEN` is set. Otherwise, its summary contains a compare link. Failures open or update one issue titled **Upstream sync failed**, with the run URL.

Read that run's first error. Run a focused local update for the failed bundle. For a new or moved skill, run `sources` again and update both selection lists. For a guard or replacement failure, compare the upstream text with the local dependency. For a license change, review the file before acceptance. For a patch failure, review with `--3way` in a scratch checkout and update the patch.

Regenerate and run the full checks after the fix. Open the fix through a pull request. Run the weekly workflow by hand after merge and close the failure issue when the run passes. The engine never accepts a license change automatically in CI.
