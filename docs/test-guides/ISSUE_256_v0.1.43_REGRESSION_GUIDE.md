# Issue 256 filesystem-effect slice — v0.1.43 Space regression guide

This validates Space's adoption of KodaX stale coordinator-ticket,
recorded-release, terminal-ordering, and daemon-exit convergence. Issue 256's
separate lost-ancestor descendant-closure boundary remains open and is not
inferred from these capability gates.

1. Start Space against an installed SDK that lacks either
   `sandboxRuntime:4` or `crashOutcomeModel:2`. Verify startup fails before
   daemon use and identifies the missing contract.
2. Leave an idle older daemon running, then start the candidate Space. Verify
   the SDK performs the existing fenced upgrade and the connected Runtime
   advertises both required versions.
3. Repeat with another client or active/queued work. Verify Space fails closed
   with stop/restart guidance and neither kills the daemon nor falls back to an
   inline/native execution owner.
4. Reproduce a managed Run whose repo/task projection stalls after canonical
   Session persistence. Verify the Run reaches its SDK terminal state, Stop is
   bound to the exact runId, and the configured orphan-idle daemon exit becomes
   eligible after the final client disconnects.
5. Confirm Space never deletes ProgramData lock/queue/state files, never maps
   `managed_task_status.completed` directly to a Run terminal, and never turns
   an unknown Stop receipt into a local idle state.
