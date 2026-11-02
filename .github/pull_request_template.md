<!--
Write for a reviewer who will not open the files. Short prose.
Delete any section that does not apply.
-->

## Why

<!-- One or two sentences: the problem or the goal. Link the failed sync run, issue, or thread if there is one. -->

## What changes

<!--
One diagram with a Before and an After. For a new thing, write "Before: none."

Pick the diagram with one question: does the next step wait for something
outside the system, which can come late, come wrong, or not come?
- Yes: a Mermaid state diagram (stateDiagram-v2). An outside input is a
  user action, a reply from a service or a subagent, a webhook, a timer, or
  a cancel. A state is a place where the thing waits, for example
  "Waiting for the user's answer" in a skill step. An arrow is the event
  that moves it on. Draw the bad events too: timeout, error, cancel, retry.
- No, and it is control flow inside the code: a call tree.
- No, and it is data flow or how components interact: a Mermaid flowchart.
- No diagram fits (a bundle description, a version pin, a rename, a config
  value): a table of old and new values, or a diff.

Add up to three bullets for what the diagram misses. For a sync, name the
bundles and upstream revisions that changed. For a description change, give
the load counts from the trigger benchmark.
-->

## Risk

<!--
Only when a revert can't undo the change, or the change touches a license,
attribution, secrets, or copies that consumers already installed. One or two
plain sentences: what breaks, and for whom.
-->

## After merge

<!-- Manual steps in order: reinstall a bundle, run the sync workflow by hand, or set SYNC_TOKEN. Delete if none. -->
