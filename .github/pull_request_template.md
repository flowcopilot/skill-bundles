<!-- Write for a reviewer who will not open the files. Delete sections that do not apply. -->

## Why

<!-- Name the problem and the resulting behavior. Link a failed run or issue when relevant. -->

## What changes

<!-- Show the before and after with a short example, table, diff, or diagram. For a sync, name the changed bundles and source revisions. Separate upstream instruction changes from attribution-only changes. -->

**Look at:** <!-- The config, guard, patch, or engine decision that needs review. -->

## Evidence

<!-- CI runs unit tests, structure and reach checks, pinned regeneration, Agent Skills validation, offline links, workflow lint, and whitespace checks. Report the checks you ran. After engine changes, run sync twice and state whether the second run changed anything. Trigger runs are optional and use paid model CLIs. State what remains unchecked. -->

## Merge danger

**Door:** <!-- one-way for license or distributed attribution changes, or two-way when a revert fixes it -->
**Blast radius:** <!-- affected bundles or commands -->

<!-- State what can break for consumers. Files in skills/ are generated. Local edits belong in bundles/<name>/ config, templates, files, or patches. Explain any changed guard or license acceptance. -->

## After merge

<!-- List manual steps, such as reinstalling a bundle or setting SYNC_TOKEN. Delete this section when no step applies. -->
