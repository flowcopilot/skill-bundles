# Skill bundles

A skill bundle combines related upstream skills behind one `SKILL.md` router. The router points agents to the reference that fits the task. Each source keeps its own folder, revision pin, license, and attribution.

This GitHub template includes a config-driven sync engine and a small [writing bundle](skills/writing/SKILL.md). You add a bundle through config and router text in `bundles/`. The engine stays the same.

## Use this template

1. Select **Use this template** on GitHub. Create a public or private repository.
2. Clone your new repository and open it in a coding agent.
3. Give the agent a prompt like this:

   > Bundle the X, Y, and Z skills from <repository URLs> into one skill, and track their upstreams.

4. Review the config, generated instructions, licenses, and lock before you merge.

[AGENTS.md](AGENTS.md) gives the agent the procedure. In a new repository, the agent first asks for your organization name and author id and writes them to [skill-bundles.json](skill-bundles.json). It also asks whether to keep the example bundle. Then it settles the bundle name, sources, and skills with you before it writes config. If you change `skill-bundles.json` by hand, run a full `bun run sync` after the change. This updates attribution and author metadata in every generated bundle.

To start by hand, follow the [development reference](DEVELOPMENT.md).

The example combines `mattpocock/skills` writing-for-agents and `cursor/plugins` technical-writing. Both use MIT. The router preserves upstream invocation flags. The technical-writing reference is available only when the user asks for it by name.

## Install a bundle

Consumers run this command from their project:

```sh
npx skills add <owner>/<repo> --skill writing
```

To install for your user account, add `--global`:

```sh
npx skills add <owner>/<repo> --skill writing --global
```

Replace `<owner>/<repo>` with the repository created from this template. Replace `writing` with the bundle you want. Run `skills add` on each new machine. An update command does not install a missing bundle. After installation, check that the skill appears in your agent's skill list.

## Use private repositories

Consumers need Git access to the bundle repository. The sync engine also supports private upstream repositories. It uses `UPSTREAM_TOKEN`, when set, through a process-local Git `url.insteadOf` rule for HTTPS GitHub URLs. SSH repositories use the SSH credentials available to Git. Other Git hosts use their configured Git authentication.

CI needs `SYNC_TOKEN` to open a pull request that starts other workflows. This token needs access to the bundle repository with contents and pull request write permissions. If an upstream is private, CI can also need `UPSTREAM_TOKEN` with read access to that upstream. These are separate credentials.

Private installation with `npx skills add` is not verified by this template's tests. Check installation with your organization's Git access before you distribute a private bundle.

## Set up the repository

Enable GitHub Actions and Issues. Add a ruleset for `main` that requires a pull request and the `validate` check. On GitHub Free, only public repositories can have rulesets. Allow the workflow to push `automation/sync-upstream-skills`. Set the secrets described above. Turn on secret scanning and push protection. Dependabot checks the pinned workflow actions each month. Renovate checks the tools in `mise.toml` each month. Install the [Renovate GitHub app](https://github.com/apps/renovate) for the repository to get its pull requests.

The weekly sync updates this bot branch with `--force-with-lease`. With `SYNC_TOKEN`, it opens or updates one pull request. Without it, the workflow writes a compare link to the run summary. A pull request created with `GITHUB_TOKEN` does not start the validation workflow. A failed sync opens or updates the issue **Upstream sync failed**.

If you rename the default branch, update `defaultBranch` in `skill-bundles.json`, the `push.branches` filter, and `GIT_CONFIG_VALUE_0` in both workflows.

## Maintain bundles

Edit `bundles/`, then regenerate `skills/`. Normal sync uses the locked revisions. Only `--update` fetches the current source refs. A license change requires explicit acceptance after review. New or missing skills, changed replacement text, and failed guards stop sync.

See [DEVELOPMENT.md](DEVELOPMENT.md) for the config and review loop. The optional [trigger benchmark](benchmarks/trigger/README.md) measures whether agents load the bundle. It calls paid model CLIs only when you start the runner.

## Credit and licenses

The generic helpers, checks, workflows, and benchmark come from [flowcopilot/skills](https://github.com/flowcopilot/skills). Their authors release them in this template under the [MIT license](LICENSE). Imported instructions retain their source licenses. [NOTICE.md](NOTICE.md) lists each source revision and local replacement.
