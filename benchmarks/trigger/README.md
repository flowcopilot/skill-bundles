# Trigger benchmark

This optional benchmark measures which bundles and references an agent reads before its first action. It does not complete or grade the task. CI runs its parser and scoring tests through `bun test`. CI does not call a model CLI.

## Run a trigger test

Set `models` in [config.json](config.json) to a map of model ids to `claude` or `codex`. The template leaves the map empty so that you choose supported models before a paid run. Model ids come only from that file. `bundles` selects the generated bundles to install.

Install and authenticate the chosen CLI through your normal setup. Then run:

```sh
bun run bench:trigger -- --tasks 'writing-*' --repeats 3 --concurrency 2
```

The runner uses the provider's paid model CLI. Report run counts and elapsed time. Each run records loaded bundles, required references read and attempted, extra references, failed reads, the first action, and the stop reason.

Options are `--models`, `--tasks`, `--repeats`, `--concurrency`, `--effort`, `--bundles`, `--max-tools`, `--timeout`, `--out`, and `--rescore`. Model and bundle lists use commas. A trailing `*` in a task filter matches a prefix. Defaults are one repeat, four concurrent runs, low effort, 12 tool calls, and 150 seconds. Results go to ignored `results/`: `runs.jsonl`, `summary.md`, and transcripts. `--rescore <directory>` scores saved transcripts without model calls.

## Isolation and scoring

Each run copies its fixture into a temporary workspace under `.cache/`. It installs bundles into `.claude/skills` or `.agents/skills`. Both CLIs receive a temporary `HOME`. Codex also receives a temporary `CODEX_HOME`. The runner copies authentication only, when present, and forwards the provider's authentication environment variables. Claude uses `--setting-sources project` and disables session persistence. User settings, skills, and instruction files are not copied. Temporary workspaces are removed on success and failure. No user-global file is changed.

The runner stops on the first write, edit, web tool, MCP tool, or shell command outside its read-only list. A stop also occurs at the tool or time limit. Reads already in progress have a short grace period. The runner observes tool events. The CLI's own permission controls still apply.

The parser counts successful content reads. A failed shell call can also count as delivered when its output contains the configured attribution marker from `skill-bundles.json`. Attempted reads include requests that failed or were denied. Partial reads record their line ranges and section headings. Listings and searches do not count as content reads. Parser code never executes transcript commands.

[tasks.jsonl](tasks.jsonl) includes one writing task and one near-miss TypeScript task. The positive task expects the writing bundle and its writing-for-agents reference. The negative task expects no bundle. Any bundle read on the negative task is a false load. Add tasks for your own bundles when useful. There is no minimum task count per bundle.

The two [real transcript fixtures](transcripts/) come from successful Claude Code 2.1.301 and Codex CLI 0.163.0 captures on October 17, 2026. Tool fields and event ordering are preserved. The entry path is normalized to the writing example, and file output is omitted. Synthetic cases cover failures, partial reads, duplicate events, shell wrappers, and relative paths.

## Measured description results

These historical results come from the source repository. They are not measurements of this template's writing example. Model ids and original bundle fixtures are omitted. The tables retain the original counts by harness and model size. One run per cell is a small sample. A difference of one or two tasks is noise.

On October 17, 2026, each task ran once per model at low effort. Cells show expected bundle loads out of 17, then required reference reads out of 22.

| Harness and model size | Before | Imperative | Plain sentences | Labels |
| --- | --- | --- | --- | --- |
| Codex small | 0, 0 | 3, 3 | 3, 4 | 5, 4 |
| Codex large | 17, 13 | 17, 15 | 17, 15 | 17, 15 |
| Claude Code small | 1, 1 | 5, 5 | 10, 5 | 3, 3 |
| Claude Code medium | 4, 1 | 7, 3 | 15, 5 | 11, 5 |
| Cursor model A | 17, 12 | — | 16, 17 | 17, 17 |
| Cursor model B | 17, 22 | — | 17, 20 | 17, 21 |
| OpenCode free model A | 7, 5 | — | 7, 9 | 5 of 11, 6 of 14 |
| OpenCode free model B | 4, 5 | — | 2, 2 | 4 of 11, 5 of 14 |
| Pi model A | 17, 22 | — | 17, 22 | 17, 21 |

The imperative started with “Always apply this skill when”. Plain sentences used When, How, and What. Labels used `When:`, `How:`, and `What:`. The free tier hit a rate limit during the labels condition. No run loaded a skill on the negative control.

On October 18, each task ran three times per model at low effort. Cells show loads out of 51 and reference reads out of 66. W is “Load this skill before you”. H is “Then read SKILL.md and open only the reference”. HS removes “read SKILL.md” from H. Wh is “Covers”. M joins W and Wh with “including”. A joins W, HS, and Wh in one sentence.

| Description parts | Codex small | Claude Code small | Claude Code medium |
| --- | --- | --- | --- |
| W, H, Wh | 10, 8 | 25, 10 | 41, 18 |
| W, HS, Wh | 5, 6 | 27, 13 | 37, 17 |
| W, Wh | 5, 6 | 32, 12 | 41, 14 |
| HS, Wh | 0, 0 | 0, 0 | 11, 9 |
| Wh, W, HS | 0, 0 | 24, 7 | 45, 21 |
| W | 11, 10 | 29, 10 | 46, 19 |
| M, HS | 11, 11 | 29, 15 | 41, 15 |
| M | 7, 5 | 31, 10 | 40, 16 |
| A | 8, 7 | 21, 12 | 41, 24 |
| W, H, Wh with root agent instructions | 7, 7 | 5, 3 | 27, 7 |

Root `AGENTS.md` and `CLAUDE.md` were removed except in the last row. The 95% interval around a count near 25 is about ±7. Differences among formats that start with W fall inside that range. Removing W reduced loads to zero for the two small models. Putting Wh first reduced Codex small loads to zero. Root agent instructions reduced Claude Code small loads from 25 to 5.

A paired follow-up on October 18 compared W alone with W and Wh. Each task ran five times per model per variant at low effort. Variants alternated by batch. Root agent instructions and the global writing rule were off. Counts are loads out of 85 and reference reads out of 110. Intervals are 95% bootstrap intervals of paired differences, resampled by task.

| Harness and model size | W loads | W, Wh loads | Load difference | W refs | W, Wh refs | Reference difference |
| --- | --- | --- | --- | --- | --- | --- |
| Codex small | 15 | 10 | -5 (-18 to 7) | 18 | 5 | -13 (-32 to 1) |
| Claude Code small | 49 | 63 | +14 (3 to 26) | 25 | 22 | -3 (-9 to 4) |
| Claude Code medium | 74 | 80 | +6 (-4 to 19) | 25 | 23 | -2 (-12 to 9) |
| All three | 138 of 255 | 153 of 255 | +15 (-6 to 37) | 68 of 330 | 50 of 330 | -18 (-41 to 2) |

Only the small Claude model's load interval excludes zero at 95%. At 99%, it is -1 to 30, so the gain does not survive correction for three models. No run failed. The negative control had no false loads.

The source repository therefore chose two plain sentences: When first, then Covers. It kept labels out and added a near-miss exclusion only after a false load. These are measured format choices. They do not guarantee that every model loads a bundle. Repeat a trigger test on the weakest model you support when you change description format.
