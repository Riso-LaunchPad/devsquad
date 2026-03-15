# Refactor Plan — ngan-heo Orchestrator

## Design Principles

These principles govern every solution in this plan. A finding that addresses only the symptom without satisfying the relevant principle below is considered insufficiently elevated.

### 1. Single Source of Truth (SSoT)
Every data element — agent definitions, project configuration, protocol paths — has exactly one authoritative owner. All consumers read from that source; no consumer maintains a local copy. Drift between locations is a bug, not a documentation gap.

### 2. Config-Driven Configuration
All environment-specific values (paths, tokens, agent lists, mode flags) are resolved from `~/.devsquad/config.json` or files derived from it. No hardcoded string in source code or protocol files may require manual editing when the environment changes.

### 3. Cohesive Feature Layers
Related primitives are designed together as a complete interaction layer. A partial implementation (e.g., `react` without `unreact`, or a registry with no CLI) is not merged. Features ship as cohesive units.

### 4. Protocol–Code Parity
Protocol files (CLAUDE.md, orchestrator-slack.md, etc.) are the Orchestrator's operating manual. Any instruction in a protocol that contradicts actual CLI behavior is a bug at the protocol level. Protocol files are validated against or generated from the code, not maintained in parallel.

### 5. Minimal Context Footprint
Every protocol decision is evaluated for its token/context cost. The default stance is "load less, reference more." Full content is loaded only when the agent actively needs it at that turn. Append-only logs without compaction are an anti-pattern.

### 6. Self-Healing Systems
Services detect degraded state and recover autonomously where safe. Protocols include diagnostic runbooks. Manual intervention is the last resort, not the first response.

### 7. Explicit Contracts at Boundaries
Every inter-process communication channel (IPC) has a documented contract: owner, format, lifecycle, and failure mode. Every CLI command has documented auto-resolution rules with clear boundary conditions. Implicit behavior is documented; undocumented behavior is a defect.

---

## Summary

This refactor plan addresses 21 optimization findings and 3 architecture risks from the workflow, token, and DevSquad CLI feature analyses. The objective is to eliminate token bloat, remove manual approval bottlenecks, and build systemic features that prevent entire classes of problems — not patch individual symptoms. Each finding is elevated to a feature or system design that satisfies one or more Design Principles above.

> **Revision note (2026-03-15 v1):** Plan supplemented after Tech Lead code review (`post-task-t1-code-review.md`). Added findings C1, C2, D8, W6.
> **Revision note (2026-03-15 v2):** Full rewrite. All solutions elevated from one-off patches to systemic feature designs. Sprint assignments re-evaluated for actual complexity. Design Principles section added.

---

## Findings Overview

| ID | Category | Title | Priority | Sprint |
|---|---|---|---|---|
| W5 | Workflow | Session Initialization Protocol | Medium | 1 |
| D6 | CLI/Usage | Project Context Detection — Protocol Layer | High | 1 |
| D7 | CLI/Usage | Operational Self-Diagnostics Protocol | Low | 1 |
| C2 | Consistency | Config-Driven Protocol Paths | Medium | 1 |
| T1 | Token | Observation Masking System | High | 2 |
| T2 | Token | Protocol Cache Layer | High | 2 |
| T3 | Token | Structured Session State Machine | High | 2 |
| T4 | Token | Tiered Context Strategy | Medium | 2 |
| T5 | Token | Task Brief Template Engine | Medium | 2 |
| C1 | Consistency | Agent Registry | High | 3 |
| D1 | CLI/Usage | Agent Lifecycle State Machine | Medium | 3 |
| D2 | CLI/Usage | Slack Interaction Layer — Reactions | High | 3 |
| D3 | CLI/Usage | Slack Interaction Layer — File Uploads | High | 3 |
| D4 | CLI/Usage | Project Context Detection — Protocol Layer (update/agent) | Medium | 3 |
| D5 | CLI/Usage | Atomic Status Update API | High | 3 |
| D8 | CLI/Usage | Project Context Detection — Code Layer | High | 3 |
| W1 | Workflow | Auto-Approve Gate System | High | 4 |
| W2 | Workflow | Parallel Agent Dispatch System | High | 4 |
| W3 | Workflow | Structured Error Routing Protocol | Medium | 4 |
| W4 | Workflow | Adaptive Polling Strategy | Low | 4 |
| W6 | Workflow | IPC Channel Registry | Medium | 4 |
| A1 | Architecture | IPC Transport Layer Migration | High | N/A |
| A2 | Architecture | Atomic State Management | Medium | N/A |
| A3 | Architecture | Process Supervision Modernization | Low | N/A |

> **Sprint re-evaluation note:** C1 (formerly Sprint 1) is elevated to the Agent Registry feature and moved to Sprint 3. D1 (formerly Sprint 1) is elevated to the Agent Lifecycle State Machine (code + protocol) and moved to Sprint 3. D4 is now explicitly the protocol-layer complement of D8 and moves to Sprint 3 alongside it.

---

## Sprint 1 — Protocol & Configuration Quick Wins

### [W5] Session Initialization Protocol

- **Root Cause:** The First Response Step 2 prompt is an LLM instruction that asks Claude to _re-derive_ and _regenerate_ information already loaded into context. Generating a protocol table adds latency and token cost while producing a redundant artifact. The Orchestrator has no concept of "what a healthy initialization looks like" as a deterministic check — it improvises every time.
- **Solution:** Design a **Session Initialization Protocol** backed by deterministic shell output:
  1. Replace the LLM table-generation prompt in Step 2 with a static bash-injected banner. The banner is emitted by a simple `echo` or a future `devsquad session status` command that reads live data from `~/.devsquad/projects.json` and `project-{name}.state.json`.
  2. The banner format is standardized: session name, active phase, loaded protocols (by name), daemon health indicator. The Orchestrator reads this as fact, not re-derives it.
  3. `CLAUDE.md` Step 2 instruction changes from "summarize what you've read into a table" to "acknowledge initialization is complete and state the active phase from context.json."
  4. Future evolution: `devsquad session init` validates that all protocol files are readable, the daemon is active, and Redis is reachable — returning a structured `READY` or `DEGRADED` status. This makes initialization self-checking without adding token cost.
- **Files to change:** Session `CLAUDE.md` (First Response Step 2 instruction)
- **Acceptance Criteria:**
  - No LLM-generated markdown table is produced during session initialization.
  - The initialization step output is deterministic and identical for identical session state.
  - Initialization token cost is ≤20 tokens (a static acknowledgment line).

---

### [D6] Project Context Detection — Protocol Layer (slack commands)

- **Root Cause:** Protocol files treat the Orchestrator as if it has no awareness of its own working directory. Every `slack send` and `slack reply` example explicitly passes `--channel` and `--project` flags, even though `src/commands/slack.ts` already auto-resolves the project from `path.basename(process.cwd())` when neither flag is provided. The protocol is unaware of this contract, forcing redundant flags that add noise and token cost to every command.
- **Solution:** Design the **Project Context Detection** contract as an explicit, documented protocol-level standard:
  1. Add a "CLI Context Resolution" section to `orchestrator-slack.md` that formally states: "Any `devsquad` command run from within a project directory (where `basename(cwd)` matches a registered project name) inherits project context automatically. Do not pass `--channel` or `--project`."
  2. Remove `--channel` and `--project` from all `slack send` / `slack reply` protocol examples.
  3. Document the boundary conditions: auto-resolution does not apply to `project update` and `project agent` until D8 (Sprint 3) is complete; note this explicitly in the protocol.
  4. This Sprint 1 change covers only the protocol layer. D8 (Sprint 3) delivers the code layer for `update`/`agent` subcommands.
- **Files to change:** Session `CLAUDE.md`, `master-flow.md`, `orchestrator-slack.md`
- **Acceptance Criteria:**
  - No `--channel` or `--project` flags appear in any `slack send` / `slack reply` protocol examples.
  - Protocol documentation explicitly states the auto-resolution rule and its current boundary (`update`/`agent` excluded until D8).
  - A "CLI Context Resolution" section exists in `orchestrator-slack.md`.

---

### [D7] Operational Self-Diagnostics Protocol

- **Root Cause:** Protocols are silent on both normal lifecycle transitions (e.g., `Done` → `Standby` auto-revert) and abnormal states (daemon down, Redis unreachable, tmux session gone). The Orchestrator has no documented path from "something is wrong" to "here is how I diagnose and recover." Every failure mode requires ad-hoc improvisation, producing inconsistent behavior across sessions.
- **Solution:** Design an **Operational Self-Diagnostics Protocol** as a dedicated section in the protocols:
  1. **Lifecycle Transitions Reference:** document every auto-transition with its trigger, observable effect, and expected next state. Specifically: `Done → Standby` (triggered by `ProjectStatusService.updateAgent()` line 80), `Listening → Crashed` (daemon process exit), etc.
  2. **Diagnostic Runbook:** an ordered sequence: (1) `devsquad daemon status` — check all process PIDs; (2) `devsquad daemon logs` — check error output; (3) `redis-cli llen queue:{project}` — check queue depth; (4) `tmux ls` — check session existence.
  3. **Recovery Playbook:** a table mapping each failure class to its recovery command: daemon down → `devsquad daemon restart`; Redis unreachable → `brew services restart redis`; tmux session gone → `devsquad project resume`; Slack API error → check token expiry via `devsquad config`.
  4. **Escalation threshold:** after 2 failed recovery attempts for the same failure class, surface the error to the human in the Slack thread with a structured report.
- **Files to change:** Session `orchestrator-slack.md` (new "Diagnostics & Recovery" section), session `CLAUDE.md` (reference to diagnostics section)
- **Acceptance Criteria:**
  - `orchestrator-slack.md` contains a "Diagnostics & Recovery" section with lifecycle transitions, a diagnostic runbook, and a recovery playbook.
  - The `Done → Standby` auto-transition is explicitly documented.
  - At least 4 failure modes have documented recovery commands.
  - Escalation threshold is defined.

---

### [C2] Config-Driven Protocol Paths

- **Root Cause:** Protocol files embed absolute machine-specific paths (e.g., `/Users/binn/.claude/protocols/master-flow.md`). When the home directory, user, or machine changes, every protocol file breaks. There is no single location to update these paths — they are scattered across multiple markdown files. The actual protocol files reside at session-local paths that differ from what `CLAUDE.md` references.
- **Solution:** Design a **Config-Driven Protocol Paths** system — eliminating all hardcoded absolute paths:
  1. Add `protocol_base` field to `DevsquadConfig` in `src/utils/config.ts` — the root directory where the session's protocol files live (e.g., `/Volumes/Data/ai-hub/ngan-heo/session`).
  2. `devsquad config` interactive setup prompts for `protocol_base` if unset. `devsquad config --set protocol_base=/path/to/session` for scripted setup.
  3. Protocol files use **relative paths** for all intra-session references (`./master-flow.md`, `./pipelines.md`) since they are co-located. Absolute paths are only used to reference files outside the session directory, and those are resolved via `$DEVSQUAD_PROTOCOL_BASE` environment variable (set by `devsquad` at runtime from `config.json`).
  4. `CLAUDE.md` replaces all `/Users/binn/...` absolute paths with relative `./` references or `$DEVSQUAD_PROTOCOL_BASE/...` references.
  5. **Linting rule:** add a check (runnable as `grep -rn '/Users/' session/ /Volumes/` against the session directory) that fails if any absolute path containing a username is found in protocol files. This is documented as a pre-push check in the session workflow.
- **Files to change:** `src/utils/config.ts` (add `protocol_base` field), `src/commands/config.ts` (add prompt and `--set` flag support), session `CLAUDE.md` (remove all absolute paths), any other protocol files with absolute paths
- **Acceptance Criteria:**
  - Zero absolute paths containing a username or machine-specific prefix in any protocol file.
  - `devsquad config` shows and allows setting `protocol_base`.
  - Relocating the session directory to a different path and updating `protocol_base` in `config.json` is sufficient to restore all protocol references without editing any other file.
  - The lint check command is documented in the session workflow.

---

## Sprint 2 — Token Optimization Systems

### [T1] Observation Masking System

- **Root Cause:** `wait-agent.sh` pipes full agent output directly to stdout via `echo "$RESPONSE" | jq -r '.data.output'`. This flows uncontrolled into the Orchestrator's active context. For large agent outputs (code reviews, full file contents, long reports), this injects thousands of tokens in a single turn with no feedback mechanism, no size bound, and no protocol for selectively reading vs. skipping the content.
- **Solution:** Design an **Observation Masking System** that separates output delivery from output consumption:
  1. All `wait-agent.sh` raw output is written to a namespaced file: `session/output/{task-id}_{iso-timestamp}.md`. The file is created atomically (write to temp → rename).
  2. A compact summary stub (≤8 lines) is emitted to stdout: task ID, agent name, status (success/failure), duration, exit code, and output file path.
  3. If the output file contains a `## Summary` section (per T5 Task Brief Template Engine contract), that section (≤20 lines) is additionally printed to stdout as the fast-path result. Full content remains on disk.
  4. Protocol (`master-flow.md`, `CLAUDE.md`) instructs: "Read the output file only when the task status requires it — error review, artifact extraction, or explicit human request. Trust the summary stub for status tracking."
  5. **Retention policy:** output files older than 7 days are purged. Protocol documents a `find session/output/ -mtime +7 -delete` cleanup command. Future: `devsquad session cleanup --older-than 7d`.
- **Files to change:** `session/wait-agent.sh`, session `CLAUDE.md` (observation protocol), session `master-flow.md`
- **Acceptance Criteria:**
  - `wait-agent.sh` stdout is ≤10 lines per task, regardless of output size.
  - Full agent output is written to `session/output/{id}_{ts}.md`.
  - Protocol explicitly defines when the Orchestrator reads vs. skips the output file.
  - Retention policy is documented.

---

### [T2] Protocol Cache Layer

- **Root Cause:** All protocol files are reloaded on every session turn, consuming tokens on static content that changes rarely or never within a session. The Orchestrator has no mechanism to distinguish "content I've already internalized" from "content that may have changed and needs re-reading." The result is thousands of wasted tokens per session turn on unchanged protocol text.
- **Solution:** Design a **Protocol Cache Layer** with explicit cache policies:
  1. **Classification:** protocols are partitioned into two classes:
     - `[STATIC]`: content that does not change during a session — `pipelines.md`, `orchestrator-agents.md`, task briefs. Load once during First Response; never re-read unless explicitly told.
     - `[DYNAMIC]`: content that may change during a session — `orchestrator-slack.md` (new commands added), `session-log.md` (protocol updates), `context.json`, `project-{name}.state.json`. Re-read when stale (staleness threshold documented per file).
  2. **Cache policy annotation:** each protocol file's header includes a one-line comment: `<!-- Cache: STATIC -->` or `<!-- Cache: DYNAMIC refresh=10m -->`. `CLAUDE.md` First Response instructs the Orchestrator to honor these annotations.
  3. **Staleness check:** for `DYNAMIC` files, the Orchestrator checks `Last-Modified` (via a `stat` call or a content-hash comparison if `devsquad protocol hash` is available) before re-reading. If unchanged, skip.
  4. **Future:** `devsquad protocol hash <file>` outputs a content hash. Orchestrator stores the hash per file in `context.json`; re-reads only if the hash changes.
- **Files to change:** Session `CLAUDE.md` (cache policy instructions), `pipelines.md`, `orchestrator-slack.md`, `master-flow.md`, `orchestrator-agents.md` (add cache annotation headers)
- **Acceptance Criteria:**
  - Every protocol file has a cache policy annotation in its header.
  - Static protocols are read once per session. Protocol explicitly forbids re-reading them mid-session without a documented trigger.
  - Dynamic protocols define a staleness threshold. The Orchestrator skips re-reads when within the threshold.
  - Token cost for mid-session protocol reads decreases to near-zero for static protocols.

---

### [T3] Structured Session State Machine

- **Root Cause:** `conversation.md` is an append-only log with no compaction boundary, no semantic structure, and no TTL. The Orchestrator reads the entire file on every turn, including stale context from the beginning of the session. The 500-line archive threshold in `session-log.md` is a proxy metric — it triggers archiving based on file length, not semantic age. Long sessions accumulate "lost-in-the-middle" degradation as early turns dilute the relevant recent context.
- **Solution:** Design a **Structured Session State Machine** to replace the append-only log with versioned, compacting state:
  1. **State document:** `session/state/current.json` — machine-readable session state: `{ phase, activeTask, pendingDecisions[], lastKnownAgentStatuses{}, turnCount, sessionStart, contextSummaryPath }`. Updated on every turn boundary.
  2. **Turn archive:** `session/state/turns/turn-{N:04d}.md` — one file per Orchestrator response turn, capped at 10 files. Each file captures: input summary, decisions made, delegations dispatched, outputs received.
  3. **Compaction trigger:** when `turns/` contains >10 files, the Orchestrator summarizes the oldest 5 turns into `session/state/summary.md` before writing the new turn file, then deletes those 5 raw turn files. The summary is a structured bullet list (decisions, delegations, outcomes) — not prose.
  4. **Read protocol:** `CLAUDE.md` instructs — "At each turn: read `current.json` (always), `summary.md` (if exists), and the most recent 3 turn files. Stop there. Do not read older turn files unless explicitly recovering from a crash."
  5. **Deprecation:** `session-log.md` protocol is replaced by this state machine specification. `conversation.md` is retired.
- **Files to change:** Session `session-log.md` (full rewrite to state machine spec), session `CLAUDE.md` (update read protocol), new compaction shell fragment or protocol instruction
- **Acceptance Criteria:**
  - `conversation.md` is replaced by the `session/state/` structure.
  - The Orchestrator reads at most `current.json` + `summary.md` + 3 turn files per turn — never more.
  - Compaction is triggered automatically when turn count exceeds 10, without human intervention.
  - Session state survives a crash and resume cycle via `current.json`.

---

### [T4] Tiered Context Strategy

- **Root Cause:** `context.json` retains the rolling last 20 tasks in the active window, including completed tasks that have no bearing on the current session state. Every time the Orchestrator reads context, it must parse all 20 entries. Completed tasks from the start of the session provide no planning value but consume context budget equivalent to 3–5 active tasks.
- **Solution:** Design a **Tiered Context Strategy** with three explicit tiers:
  1. **Hot tier** (`context.json`): maximum 5 entries; only tasks in `InProgress` or `Blocked` status. This is the Orchestrator's active working set. Read on every turn.
  2. **Warm tier** (`context-recent.json`): last 20 completed tasks. Read only when the Orchestrator explicitly needs to reference recent history (e.g., "what did the QA agent find last sprint?").
  3. **Cold tier** (`context-archive/YYYY-MM.json`): all older completed tasks, partitioned by month. Archival only — read only for explicit historical lookup.
  4. **Atomic promotion:** when a task transitions to `Done`, the write operation simultaneously: removes it from hot tier, prepends it to warm tier. If warm tier exceeds 20 entries, oldest entries are promoted to cold tier. All three files are updated in a single logical operation.
  5. **Protocol:** `CLAUDE.md` and `session-log.md` define each tier's purpose and when to read each. Hot tier is the only tier read by default.
- **Files to change:** Session `session-log.md` (context management protocol rewrite), session `CLAUDE.md` (read protocol)
- **Acceptance Criteria:**
  - `context.json` never contains more than 5 entries.
  - Completed task promotion to warm tier is documented as an atomic write requirement.
  - Protocols explicitly define tier boundaries, contents, and read conditions.
  - Warm and cold tiers exist and accumulate historical tasks rather than being discarded.

---

### [T5] Task Brief Template Engine

- **Root Cause:** Every task brief is authored from scratch, including full skill definitions pasted inline, repeated background sections, and boilerplate communication protocol instructions. This duplicates content across all briefs for the same skill, wastes Orchestrator composing time, and injects the same boilerplate into every sub-agent's context.
- **Solution:** Design a **Task Brief Template Engine** that separates template from content:
  1. **`task-brief.md` becomes a schema**, not a document. It defines required sections and their types: `Reference` (a path or identifier — do not paste content) vs `Inline` (include directly).
  2. **Skills section:** `## Skills` contains skill identifiers only — file paths or skill names (e.g., `~/.claude/skills/code-review-excellence/`). Sub-agents resolve skill content from disk at runtime. No skill definition text appears in the brief.
  3. **Shared defaults:** boilerplate sections (Communication Protocol, Output Format, Status Contract from W3) move to `session/task-defaults.md`. Briefs reference this file via a `## Inherits: task-defaults` directive; they do not duplicate its content.
  4. **`devsquad task brief` CLI command:** `devsquad task brief --role developer --task "implement auth module"` scaffolds a brief skeleton pre-filled with Background (from the Agent Registry C1 entry for that role), Skills (from the agent's skill list in the registry), and Input/Output format templates. The Orchestrator fills in the task-specific content.
  5. **Brief size target:** a fully authored brief should be ≤40 lines after the template engine is in place.
- **Files to change:** Session `task-brief.md` (rewrite as schema), new `session/task-defaults.md`, `src/commands/task.ts` (new file for `devsquad task` commands), `src/cli.ts` (register task command)
- **Acceptance Criteria:**
  - No skill definition content appears inline in any task brief.
  - `devsquad task brief --role developer` generates a valid, pre-filled brief skeleton.
  - A completed task brief is ≤40 lines.
  - `session/task-defaults.md` exists and contains shared boilerplate. No protocol file duplicates its content.

---

## Sprint 3 — CLI & Agent Feature Extensions

### [C1] Agent Registry

- **Root Cause:** Agent definitions exist in at least three independent locations — the `TEAM_AGENTS` constant in `src/application/daemon/TeamStatusService.ts`, the agent name list in `orchestrator-slack.md`, and the Team Topology section in `CLAUDE.md`. Each is maintained manually. When `agent-claude-dev` was added to `TEAM_AGENTS`, `orchestrator-slack.md` was not updated, resulting in the protocol listing only 5 of 6 agents. This is not a one-time oversight — it is a structural guarantee of future drift wherever agents are added, removed, or renamed.
- **Solution:** Design an **Agent Registry** as the single authoritative source of truth for all agent definitions — satisfying the SSoT Design Principle:
  1. **Registry file:** `~/.devsquad/agents.json` — an array of `AgentDef` objects: `{ name, role, model, container?, skills?: string[], description? }`. This file is the sole owner of agent identity.
  2. **CLI commands (new `devsquad agent` group):**
     - `devsquad agent list` — display all registered agents
     - `devsquad agent add --name <name> --role <role> --model <model> [--container <name>] [--skills <csv>]`
     - `devsquad agent remove <name>`
     - `devsquad agent show <name>` — full agent definition
     - `devsquad agent init` — one-time migration: seeds `agents.json` from current `TEAM_AGENTS` constant
  3. **Code integration:** `TeamStatusService.TEAM_AGENTS` hardcoded constant is removed. `TeamStatusService` receives an `AgentRegistryService` dependency and calls `registry.list()` to get the current agent set. The service auto-adapts to registry changes — no code change required to add or remove an agent.
  4. **Protocol integration:** the hardcoded agent name list in `orchestrator-slack.md` is replaced with: "Run `devsquad agent list` to get the current valid agent names. Do not hardcode agent names in instructions." The Team Topology in `CLAUDE.md` similarly references the registry as the source, not a static list.
  5. **New service:** `src/application/agent/AgentRegistryService.ts` — CRUD operations over `agents.json`, following the same pattern as `ProjectService`.
  6. **Sync guarantee:** since all consumers read from the registry file, add/remove/edit automatically propagates — no manual synchronization required, ever.
- **Files to change:**
  - `src/application/daemon/TeamStatusService.ts` (remove `TEAM_AGENTS` constant; inject `AgentRegistryService`)
  - `src/application/agent/AgentRegistryService.ts` (new)
  - `src/commands/agent.ts` (new)
  - `src/cli.ts` (register `agent` command group)
  - `src/utils/paths.ts` (add `getAgentsPath()`)
  - Session `orchestrator-slack.md` (replace agent list with `devsquad agent list` instruction)
  - Session `CLAUDE.md` (update Team Topology section)
  - Tests: `tests/application/AgentRegistryService.test.ts` (new)
- **Acceptance Criteria:**
  - Running `devsquad agent add --name agent-new --role "QA Engineer" --model gemini` immediately makes the agent appear in `devsquad agent list`, on the Slack team status board (after next `refresh()`), and in any protocol instruction that references `devsquad agent list`.
  - Running `devsquad agent remove agent-new` removes it from all consumers.
  - No agent name is hardcoded in any source file or protocol file.
  - `devsquad agent init` successfully migrates the existing 6 agents from `TEAM_AGENTS` to `agents.json`.

---

### [D1] Agent Lifecycle State Machine

- **Root Cause:** The `Error` status is implemented in `ProjectStatusService.updateAgent()` and renders correctly (🔴) on the Slack board, but no protocol defines when to enter the `Error` state, how to exit it, or what downstream actions it triggers. The Orchestrator improvises on agent failures, leading to inconsistent status reporting — some failures are silently retried, some result in wrong status codes, none follow a defined transition path.
- **Solution:** Design a formal **Agent Lifecycle State Machine** embedded in the protocol and optionally enforced at the CLI:
  1. **State machine definition** (in `orchestrator-slack.md`): `Standby → Working → Done(→Standby auto) | Error | Blocked`. Each state has documented entry conditions, exit conditions, and allowed transitions.
  2. **Entry conditions:**
     - `Working`: immediately on task delegation
     - `Done`: on `wait-agent.sh` exit code 0
     - `Error`: on `wait-agent.sh` exit code > 0, on timeout, or on output containing `STATUS: UNRECOVERABLE` (per W3 contract)
     - `Blocked`: on output containing `STATUS: NEEDS_CLARIFICATION` (per W3 contract)
  3. **Exit conditions:** `Error` requires an explicit resolution: `devsquad project agent --agent <name> --status Standby` clears the error. `Blocked` requires human input before transition.
  4. **Protocol integration:** `master-flow.md` DELEGATE phase gains an error branch: "If `wait-agent.sh` exits non-zero → call `devsquad project agent --agent <name> --status Error --reason <exit-code>` → record in context.json as a blocked task → escalate per escalation matrix in `orchestrator-slack.md`."
  5. **CLI enhancement:** `devsquad project agent --status Error --reason <text>` accepts an optional `--reason` flag. The reason is stored in `project-{name}.state.json` for audit trail and displayed in the Slack status board tooltip (if feasible).
- **Files to change:**
  - Session `master-flow.md` (add error branch to DELEGATE phase)
  - Session `orchestrator-slack.md` (add Agent Lifecycle State Machine diagram + escalation matrix)
  - `src/commands/project.ts` (add `--reason` flag to `agent` subcommand)
  - `src/application/project/ProjectStatusService.ts` (store reason in state JSON)
- **Acceptance Criteria:**
  - A state machine diagram exists in `orchestrator-slack.md` covering all states and transitions.
  - Every agent task failure results in `🔴 Error` status on the Slack board without exception, per protocol.
  - `Error` state has a documented clear path in the protocol.
  - `--reason` flag is accepted by `devsquad project agent` and stored in state.
  - The `Done → Standby` auto-transition is documented in the state machine (entry via existing code behavior).

---

### [D8] Project Context Detection — Code Layer

- **Root Cause:** `project update` and `project agent` use `.requiredOption('--name <name>')`, enforcing the flag at parse time. This makes it impossible to omit `--name` even when the project is inferable from `process.cwd()`. Four other subcommands (`init`, `stop`, `resume`, `config`) already implement a `cwd` fallback using `path.basename(process.cwd())`. The `update` and `agent` subcommands are inconsistent outliers, and the resolution logic is copy-pasted across those four subcommands with no shared abstraction.
- **Solution:** Design **Project Context Detection** as a consistent, testable contract across all project subcommands:
  1. Change `.requiredOption('--name <name>')` to `.option('--name <name>')` in both `update` and `agent` subcommands.
  2. Extract the name-resolution logic into a shared `resolveProjectName(opts: { name?: string }, cwd: string, projects: ProjectConfig[]): string` utility in `src/utils/project.ts`. This replaces the four existing copy-pasted patterns.
  3. The utility validates the resolved name against the registered project list. If the resolved name is not registered, it throws a descriptive error: `"Project 'X' not found. Run 'devsquad project list' to see registered projects."` — not a silent failure.
  4. Update `--name` help text across all subcommands: `"project name (defaults to current directory name if registered)"`.
  5. The `resolveProjectName` utility is unit-tested: mock `process.cwd()` and project list to verify all resolution paths (explicit flag, cwd match, unregistered cwd).
- **Files to change:**
  - `src/commands/project.ts` (change `requiredOption` → `option` in `update` and `agent`; replace inline resolution with utility call)
  - `src/utils/project.ts` (new — `resolveProjectName` utility)
  - `tests/utils/project.test.ts` (new — unit tests for `resolveProjectName`)
- **Acceptance Criteria:**
  - All 6 project subcommands use `resolveProjectName` from `src/utils/project.ts`. No inline resolution logic exists in `commands/project.ts`.
  - `devsquad project update --phase Listening --task "—"` succeeds without `--name` from within a registered project directory.
  - `devsquad project agent --agent agent-claude-lead --status Done` succeeds without `--name` from within a registered project directory.
  - Running either command from an unregistered directory prints a descriptive error.
  - `resolveProjectName` has test coverage for all 3 resolution paths.

---

### [D2] Slack Interaction Layer — Reactions

- **Root Cause:** The CLI exposes only `send` and `reply` from `ISlackClient`, despite the interface defining `addReaction` and `removeReaction`. Without a `react` command, the Orchestrator uses text replies as acknowledgment signals, which are noisier and more expensive than reactions, and pollute thread history.
- **Solution:** Design the **Slack Interaction Layer** as a complete set of Slack interaction primitives — D2 covers reactions, D3 covers uploads. Together they form a cohesive layer, not two isolated additions:
  1. `devsquad slack react <ts> <emoji>` — adds a reaction emoji to the message at timestamp `ts`.
  2. `devsquad slack unreact <ts> <emoji>` — removes a reaction. Always paired with `react` for completeness; a `react` command without `unreact` is an incomplete primitive.
  3. Both commands support the Project Context Detection standard (D8): `--project <name>` optional, with cwd fallback.
  4. `SlackService` gains `react(channel: string, ts: string, emoji: string): Promise<void>` and `unreact(...)` methods as the service-layer entry points, wrapping `ISlackClient.addReaction` / `removeReaction`.
  5. **Protocol update:** `orchestrator-slack.md` instructs: "React ✅ (`white_check_mark`) to an inbound message immediately upon receipt as a processing acknowledgment. Use text replies only for substantive responses."
- **Files to change:**
  - `src/commands/slack.ts` (add `react` and `unreact` subcommands)
  - `src/application/slack/SlackService.ts` (add `react` and `unreact` methods)
  - Session `orchestrator-slack.md` (update to use reactions as acknowledgment)
- **Acceptance Criteria:**
  - `devsquad slack react <ts> white_check_mark` adds ✅ to the Slack message.
  - `devsquad slack unreact <ts> white_check_mark` removes it.
  - Both commands work without `--project` from a registered project directory.
  - Protocol uses reactions as primary acknowledgment signal.
  - `react` and `unreact` are tested via `MockSlackClient` tracking.

---

### [D3] Slack Interaction Layer — File Uploads

- **Root Cause:** Large artifacts (code reviews, reports, generated files) are pasted as text messages, hitting Slack's character limit and bloating thread context for all readers. `ISlackClient.uploadFile()` is defined but has no CLI exposure, making it inaccessible to the Orchestrator.
- **Solution:** (Part of Slack Interaction Layer — see D2) Design `devsquad slack upload` as the file primitive:
  1. `devsquad slack upload <filepath> --thread <ts> [--title <title>] [--comment <text>]`
  2. Supports Project Context Detection standard: `--project <name>` optional, with cwd fallback.
  3. Validates file existence and warns if file size exceeds 5MB before attempting upload.
  4. Returns the uploaded file's Slack permalink to stdout — the Orchestrator can reference it in follow-up messages without reading the file content.
  5. `SlackService` gains `upload(channel: string, filepath: string, options: UploadOptions): Promise<string>` (returns permalink).
  6. **Protocol update:** `orchestrator-slack.md` instructs: "Upload any artifact >2KB as a file using `devsquad slack upload`. Do not paste content inline."
- **Files to change:**
  - `src/commands/slack.ts` (add `upload` subcommand)
  - `src/application/slack/SlackService.ts` (add `upload` method)
  - Session `orchestrator-slack.md` (add upload instruction and size threshold)
- **Acceptance Criteria:**
  - `devsquad slack upload report.md --thread <ts>` attaches the file to the thread as a native Slack file.
  - File permalink is returned to stdout.
  - Files >5MB produce a warning before upload attempt.
  - Protocol prescribes file upload over inline text for artifacts >2KB.

---

### [D4] Project Context Detection — Protocol Layer (update/agent)

- **Root Cause:** Even after D8 makes `--name` optional in `project update` and `project agent`, the protocol files continue to instruct passing `--name <project>` explicitly in every example. This perpetuates the verbose pattern and prevents the token savings that motivated D8.
- **Solution:** Update all protocol examples to omit `--name` from `project update` and `project agent` calls, aligning the protocol with the code behavior delivered by D8. This is the protocol-layer completion of the Project Context Detection system.
  1. Remove `--name <project>` from all `devsquad project update` and `devsquad project agent` examples.
  2. Add the auto-resolution note in the "CLI Context Resolution" section (established in D6): "The `--name` flag is also optional for `project update` and `project agent` when running from a registered project directory."
  3. Keep `--name` documented as an optional override for cases where the Orchestrator needs to update a different project than the current directory.
  *(This finding is blocked on D8 being complete.)*
- **Files to change:** Session `orchestrator-slack.md`, session `master-flow.md`
- **Acceptance Criteria:**
  - No `--name` flag in any `devsquad project update` or `devsquad project agent` protocol example.
  - Protocol documents the auto-resolution rule as applying to both slack commands (D6) and project commands (D4+D8).

---

### [D5] Atomic Status Update API

- **Root Cause:** Updating project phase and agent status requires two separate CLI invocations, two Slack API calls (`updateMessage`), and two sequential file writes to `project-{name}.state.json`. The current design cannot express "the project moved to Delegating AND agent-claude-lead is now Working" as a single operation. This doubles Slack API usage per delegation step and creates a brief window where the status message is partially updated (phase updated, agent not yet updated) — visible to anyone watching the channel.
- **Solution:** Design an **Atomic Status Update API** that expresses related state changes as a single operation:
  1. Add optional `--agent <name>` and `--agent-status <status>` flags to `devsquad project update`. When provided, the combined phase + agent update is applied in a single `updateMessage` Slack API call.
  2. Extend `ProjectStatusService.updateSession()` to accept `agentUpdate?: { name: string, status: string }`. The method renders the full status block (phase + all agent rows) in one pass and calls `updateMessage` once.
  3. **Batch mode:** `devsquad project update --batch` reads a JSON object from stdin: `{ "phase": "Delegating", "task": "Auth module", "agents": { "agent-claude-lead": "Working", "agent-gemini-qa": "Standby" } }`. This enables bulk updates with a single Slack API call and a single file write.
  4. **Protocol update:** `master-flow.md` DELEGATE phase uses the combined command: `devsquad project update --phase Delegating --task "..." --agent agent-claude-lead --agent-status Working`.
- **Files to change:**
  - `src/commands/project.ts` (add `--agent`, `--agent-status`, `--batch` flags to `update`)
  - `src/application/project/ProjectStatusService.ts` (extend `updateSession` with optional agent update)
  - Session `orchestrator-slack.md`, session `master-flow.md` (use combined command)
- **Acceptance Criteria:**
  - `devsquad project update --phase Delegating --agent agent-claude-lead --agent-status Working` produces exactly one Slack `updateMessage` API call.
  - The status board reflects both changes atomically — no partially-updated state is ever visible.
  - `--batch` mode accepts stdin JSON and produces one Slack API call for N agent updates.
  - Protocol examples use the combined form for all delegation transitions.

---

## Sprint 4 — Workflow Automation

### [W1] Auto-Approve Gate System

- **Root Cause:** All pipeline stage transitions require a human approval message, regardless of task risk level, task type, or whether the human has pre-authorized an entire class of tasks. The gate granularity is binary (block everything / not implemented). This creates maximum latency even for predictable, low-risk handoffs (e.g., auto-formatting → linting → testing) where approval is a formality.
- **Solution:** Design an **Auto-Approve Gate System** with tiered trust levels:
  1. **Gate classification:** each pipeline stage in `pipelines.md` is tagged with a gate class:
     - `always-manual`: requires human approval regardless of mode (e.g., production deployments, external API calls)
     - `auto-when-autonomous`: bypassed in autonomous mode, required in supervised mode (e.g., standard dev-cycle handoffs)
     - `always-auto`: never requires human approval (e.g., automated testing, linting)
  2. **Project mode:** `devsquad project set-mode --name <project> --mode autonomous|supervised` — stored in `projects.json`. Default: `supervised`.
  3. **Per-gate override:** `devsquad project update --approve-next` pre-authorizes the next `auto-when-autonomous` gate crossing as a one-shot authorization without switching the project to full autonomous mode.
  4. **Audit log:** all auto-approved gate crossings are appended to `session/audit.log`: `{timestamp, gate_id, task, phase, mode}`. Provides traceability without human review burden.
  5. **Protocol integration:** `master-flow.md` PLAN phase gains a "Gate Assessment" step: "Check project mode with `devsquad project config --field mode`. If `autonomous`, skip approval message for `auto-when-autonomous` gates."
- **Files to change:**
  - Session `master-flow.md` (Gate Assessment step, mode-conditional approval)
  - Session `pipelines.md` (gate class annotations on all stages)
  - `src/commands/project.ts` (add `set-mode` subcommand, `--approve-next` flag)
  - `src/application/project/ProjectService.ts` (store `mode` in `projects.json`)
  - `src/application/project/ProjectStatusService.ts` (reflect mode in status display)
- **Acceptance Criteria:**
  - In `autonomous` mode, the Orchestrator completes a full Dev Pipeline cycle without requiring a human approval message for `auto-when-autonomous` gates.
  - All auto-approved steps are recorded in `session/audit.log`.
  - Gate class is documented for every stage in `pipelines.md`.
  - `supervised` mode behavior is unchanged from today.

---

### [W2] Parallel Agent Dispatch System

- **Root Cause:** Directive 7 in `CLAUDE.md` enforces "turn-based execution: complete one logical unit, report, then wait." This rule treats all sub-tasks as dependent, even when tasks are provably independent (e.g., QA code review and documentation generation can proceed simultaneously). Sequential execution multiplies wall-clock time linearly with task count, wasting the multi-agent topology's primary advantage.
- **Solution:** Design a **Parallel Agent Dispatch System** based on explicit dependency declaration:
  1. **Dependency annotation:** task briefs include a `## Dependencies: [task-id-list or "none"]` section. Empty or `"none"` means the task is parallel-eligible.
  2. **Dependency graph dispatch:** `master-flow.md` DELEGATE phase is updated: "Group tasks by dependency graph. Dispatch all tasks in a dependency layer concurrently (background `&`). Use `wait-all.sh` to aggregate results before proceeding to the next layer."
  3. **Aggregator script:** new `session/wait-all.sh` — accepts a list of task IDs as arguments; waits for each corresponding output file to appear in `session/output/` (per T1 Observation Masking); returns a JSON aggregated summary: `{ total, succeeded, failed, results: [{taskId, status, summaryPath}] }`.
  4. **Result synthesis:** the Orchestrator reads the aggregated summary from `wait-all.sh`, not individual output files. The summary keeps the context footprint constant regardless of how many tasks ran in parallel.
  5. **Protocol revision:** Directive 7 is revised from "complete one unit, wait" to: "complete one dependency layer, wait. Independent tasks within a layer run concurrently."
- **Files to change:**
  - Session `CLAUDE.md` (revise Directive 7)
  - Session `master-flow.md` (add dependency-aware dispatch to DELEGATE phase)
  - Session `task-brief.md` (add `## Dependencies` section to schema)
  - New `session/wait-all.sh`
- **Acceptance Criteria:**
  - Two tasks with `Dependencies: none` dispatched in the same DELEGATE turn produce two background processes.
  - `wait-all.sh` aggregates their results and returns a single JSON summary.
  - Wall-clock time for two parallel tasks is less than the sequential sum by a meaningful margin.
  - A task with `Dependencies: [T-001]` is only dispatched after T-001 completes.

---

### [W3] Structured Error Routing Protocol

- **Root Cause:** The Orchestrator manually interprets every agent error message (free-text) to decide loop-back routing. The loop-back rules in `pipelines.md` are a prose table the Orchestrator must interpret case-by-case. Free-text interpretation is non-deterministic — different sessions or different Orchestrator instances may route the same error differently, and there is no validation that a routing decision is correct.
- **Solution:** Design a **Structured Error Routing Protocol** that replaces free-text interpretation with table lookup:
  1. **Error taxonomy:** define a finite, exhaustive set of error codes in `task-brief.md` and `pipelines.md`:
     - `SUCCESS`: task completed successfully
     - `DESIGN_REJECTED`: design or specification needs revision (route back to Architect)
     - `IMPLEMENTATION_BLOCKED`: dependency or environment issue prevents implementation (escalate)
     - `QUALITY_FAILED`: output does not meet acceptance criteria (route back to Developer)
     - `NEEDS_CLARIFICATION`: insufficient information to proceed (route to Orchestrator for human escalation)
     - `UNRECOVERABLE`: agent cannot proceed; requires human intervention
  2. **Agent output contract:** all task briefs (via `task-defaults.md` from T5) include: "End your output with `STATUS: <CODE>` on the last line. If absent, the Orchestrator treats your output as `STATUS: UNRECOVERABLE`."
  3. **Routing table in `pipelines.md`:** a markdown table mapping `CODE → next_assignee → next_phase → action`. The Orchestrator performs a table lookup — no interpretation.
  4. **`wait-agent.sh` integration:** `wait-agent.sh` parses the `STATUS:` line from the output file (per T1) and exits with a corresponding numeric exit code (0=SUCCESS, 1=DESIGN_REJECTED, 2=IMPLEMENTATION_BLOCKED, 3=QUALITY_FAILED, 4=NEEDS_CLARIFICATION, 5=UNRECOVERABLE). The Orchestrator reads the exit code, not the full output, for routing decisions.
  5. **Protocol:** `master-flow.md` DELEGATE phase: "Check exit code of `wait-agent.sh`. Look up the routing table in `pipelines.md`. Dispatch the next step accordingly. Do not interpret free-text error messages for routing."
- **Files to change:**
  - Session `pipelines.md` (add routing table and error taxonomy)
  - Session `task-brief.md` / `task-defaults.md` (add STATUS contract)
  - `session/wait-agent.sh` (parse STATUS line, exit with numeric code)
  - Session `master-flow.md` (replace free-text routing with table lookup)
- **Acceptance Criteria:**
  - An agent returning `STATUS: DESIGN_REJECTED` causes the Orchestrator to route back to the Architect without reading full output.
  - The routing table in `pipelines.md` covers all 6 error codes.
  - `wait-agent.sh` exits with the correct numeric code for each error type.
  - No protocol instruction says "interpret the error message to decide routing."

---

### [W4] Adaptive Polling Strategy

- **Root Cause:** `wait-agent.sh` uses a hardcoded `sleep 5` polling loop. Fast tasks (completing in <5s) incur unnecessary latency waiting for the next poll. Slow tasks (running for minutes) poll at the same frequency throughout, consuming CPU and producing no new information on each iteration. The fixed interval is tuned for neither case.
- **Solution:** Design an **Adaptive Polling Strategy** with exponential backoff and a fast-path exit:
  1. Replace `sleep 5` with exponential backoff: initial interval 2s, doubling each iteration, capped at 30s.
  2. **Fast-path exit:** on each polling iteration, check for the output file existence (per T1 Observation Masking — `wait-agent.sh` now polls for file appearance rather than API status). If the file appears, exit immediately without waiting for the next interval.
  3. **Backoff formula:** `INTERVAL=2; while [not done]; do sleep $INTERVAL; INTERVAL=$(( INTERVAL < 30 ? INTERVAL * 2 : 30 )); done`
  4. **Timeout:** maximum total wait time is configurable (default 10 minutes). On timeout, `wait-agent.sh` exits with code 5 (`UNRECOVERABLE` per W3).
  5. Protocol documents the backoff behavior so the Orchestrator understands that a 20s silence is not a failure signal.
- **Files to change:** `session/wait-agent.sh`
- **Acceptance Criteria:**
  - Polling intervals follow: 2s, 4s, 8s, 16s, 30s, 30s, …
  - A task completing in 1s is detected at the 2s boundary (fast-path check).
  - Maximum interval is 30s.
  - On timeout (default 10min), script exits with code 5.
  - Protocol documents backoff behavior to prevent misdiagnosis as a hang.

---

### [W6] IPC Channel Registry

- **Root Cause:** `session/inbox.pipe` (a named FIFO) is an undocumented IPC channel. No protocol file describes who creates it, what process writes to it, what reads from it, what message format it uses, or what happens when it does not exist. `wait-slack.sh` assumes the pipe exists and exits with an error if it does not. There is no documented process for creating the pipe or diagnosing `wait-slack.sh` failures. This is a violation of the Explicit Contracts at Boundaries Design Principle.
- **Solution:** Design an **IPC Channel Registry** as a single canonical reference for all inter-process communication in the session:
  1. **Registry file:** new `session/ipc.md` — a markdown table documenting every IPC channel with columns: `Name | Type | Owner | Writer | Reader | Format | Lifecycle | Failure Mode`.
  2. **Initial entries:** document all current channels:
     - `inbox.pipe`: Named FIFO | Owner: session | Writer: `MessageProcessorDaemon` | Reader: `wait-slack.sh` | Format: plain text message | Lifecycle: created at session start, exists for session duration | Failure: FIFO missing → `mkfifo session/inbox.pipe`
     - `queue:{project}`: Redis List | Owner: `SlackListenerDaemon` | Writer: listener | Reader: `MessageProcessorDaemon` | Format: JSON `IncomingSlackMessage` | Lifecycle: created by first push, expires on `devsquad project remove`
     - tmux `send-keys` (documented as deprecated IPC path per A1)
  3. **`wait-slack.sh` hardening:** add FIFO existence check at script start. If missing: `test -p session/inbox.pipe || mkfifo session/inbox.pipe` before entering the read loop. Self-healing per Design Principle 6.
  4. **Protocol integration:** `master-flow.md` LISTEN phase includes an "IPC Readiness Check" step: `test -p session/inbox.pipe || mkfifo session/inbox.pipe`. Documents this as a required pre-condition.
  5. **Governance rule:** documented in `ipc.md` — "Adding a new IPC channel requires a corresponding entry in this registry before the implementation is merged."
- **Files to change:**
  - New `session/ipc.md`
  - Session `master-flow.md` (add IPC Readiness Check to LISTEN phase)
  - Session `orchestrator-slack.md` (reference `ipc.md` for IPC diagnostics)
  - `session/wait-slack.sh` (add FIFO existence check and self-creation)
- **Acceptance Criteria:**
  - `session/ipc.md` exists and documents all IPC channels with all required columns.
  - `wait-slack.sh` creates `inbox.pipe` if missing rather than exiting with an error.
  - LISTEN phase in `master-flow.md` includes IPC readiness verification.
  - `ipc.md` includes a governance rule requiring registration of new channels.

---

## Architecture Risks (Non-Sprint)

These risks do not have sprint assignments — they require investigation and design decisions before scoping. Each mitigation below describes a phased approach.

| ID | Risk | Severity | Mitigation Strategy |
|---|---|---|---|
| A1 | IPC Transport Layer Migration | High | Phased migration from `tmux send-keys` to FIFO → Unix socket |
| A2 | Atomic State Management | Medium | Atomic write utility + Redis migration path |
| A3 | Process Supervision Modernization | Low | LaunchAgent `KeepAlive` → health check endpoint → PM2 option |

---

### [A1] IPC Transport Layer Migration

- **Root Cause:** `tmux send-keys` is designed to simulate human keyboard input, not to serve as a programmatic IPC channel. It has no message framing, no delivery guarantee, and is sensitive to terminal state (bracketed paste mode, prompt presence, special character interpretation). Long messages may be split across multiple key events. Concurrent `send-keys` from two sources causes data interleaving and corruption. The named pipe (`session/inbox.pipe`) already exists as a superior alternative.
- **Recommended Mitigation (phased):**
  1. **Phase 1 — FIFO adoption (near term):** adopt `session/inbox.pipe` as the canonical input channel for the Claude session. Update `MessageProcessorDaemon` / `TmuxService.sendMessage()` to write to the FIFO when it exists, falling back to `send-keys` only when the FIFO is absent. Add a `useDirectIPC: boolean` flag to `DevsquadConfig`. This phase can be implemented without breaking the current fallback.
  2. **Phase 2 — Full FIFO migration (medium term):** once Phase 1 is validated, remove the `send-keys` fallback path. The Claude session reads from the FIFO via stdin redirection (`claude --stdin` or equivalent). This eliminates all fragility associated with terminal escape sequences.
  3. **Phase 3 — Unix domain socket (long term):** replace the one-way FIFO with a bidirectional Unix domain socket, enabling delivery receipts and bidirectional communication without Slack as an intermediary.
- **Files to change (Phase 1):** `src/infra/tmux/TmuxService.ts`, `src/utils/config.ts` (add `useDirectIPC`), `src/commands/daemon.ts` (document mode)

---

### [A2] Atomic State Management

- **Root Cause:** State files (`project-{name}.state.json`, `team-state.json`, `daemon-state.json`) are written with raw `fs.writeFile()` — no locking, no atomic rename, no write ordering guarantees. Concurrent writes (e.g., two rapid `devsquad project agent` calls, or an agent update racing with a `refresh()` call) can produce truncated or invalid JSON. JSON parse failures silently return `null` (see `loadState()` catch blocks), hiding corruption.
- **Recommended Mitigation (phased):**
  1. **Phase 1 — Atomic write pattern (near term):** implement `src/utils/StateStore.ts` — a generic `read<T>() / write<T>()` utility that uses write-to-temp → fsync → rename. POSIX rename is atomic within the same filesystem. All services (`ProjectStatusService`, `TeamStatusService`, `DaemonStatusService`) use `StateStore` instead of direct `fs.writeFile`. This eliminates the truncation window.
  2. **Phase 2 — Redis migration (long term):** consolidate all application state into Redis hashes (already a required dependency). Redis serializes writes server-side, eliminating file-based concurrency entirely. State files become cache replicas only, not authoritative sources.
- **Files to change (Phase 1):** `src/utils/StateStore.ts` (new), `src/application/daemon/TeamStatusService.ts`, `src/application/daemon/DaemonStatusService.ts`, `src/application/project/ProjectStatusService.ts`

---

### [A3] Process Supervision Modernization

- **Root Cause:** LaunchAgent-based daemon management (current: `KeepAlive: false`) does not automatically restart crashed processes. The `SlackSocketModeAdapter` watchdog handles WebSocket zombie connections at the application layer, but process-level crashes are not recovered. The setup is macOS-only, which limits portability.
- **Recommended Mitigation (phased):**
  1. **Phase 1 — LaunchAgent `KeepAlive` (near term):** enable `KeepAlive: true` in LaunchAgent plists to let launchd auto-restart crashed processes. Add `ThrottleInterval: 30` to prevent rapid crash loops. This is a one-line plist change.
  2. **Phase 2 — Health check endpoint (medium term):** implement `devsquad daemon health` that returns structured JSON: `{ pid, uptime_seconds, last_message_ts, redis_queue_depth, socket_connected }`. External monitors (uptime tools, CI) can query this endpoint. Documents the observable health contract.
  3. **Phase 3 — PM2 supervisor option (long term):** implement `devsquad daemon start --supervisor pm2` that uses PM2 instead of launchd, enabling cross-platform support (Linux). `LaunchDaemonManager` is refactored behind a `IDaemonSupervisor` interface; `PM2Manager` is an alternative implementation.
- **Files to change (Phase 1):** `src/infra/launchdaemon/LaunchDaemonManager.ts` (set `KeepAlive: true`, adjust `ThrottleInterval`)
