# Workflows Architecture

This folder contains **two intentionally separate workflow type systems**.
Do NOT merge them automatically.

---

## System 1 — Legacy Conversational Workflow System

**Files:** `types.ts`, `workflowContinuity.ts`, `workflowRegistry.ts`,
`flowEngine.ts`, `workflowSession.ts`, `workflowResolver.ts`,
`workflowContinuationEngine.ts`, `workflowContinuationScoring.ts`,
`workflowContinuationTypes.ts`, `store.ts`

**Key types:** `WorkflowStep`, `WorkflowStepKind`, `WorkflowSession`,
`OperationalWorkflow`, `WorkflowStatus`, `WorkflowCategory`

**Purpose:**
- Conversational continuity in the Intelligence chat panel
- Chat routing and step sequencing driven by user messages
- Lightweight workflow memory (session-scoped, no approval gates)
- Older flow engine / continuity scoring paths

**Introduced in:** R-INTELLIGENCE-AUTONOMOUS-FLOWS-V1 and earlier rounds

---

## System 2 — New Operational Workflow Chain System

**Files:** `workflowChainTypes.ts`, `workflowChain.ts`, `index.ts`

**Key types:** `WorkflowChain`, `WorkflowChainStep`, `WorkflowChainStatus`,
`WorkflowChainStepStatus`, `WorkflowChainStepKind`

**Purpose:**
- Operational orchestration of multi-step execution requests
- Execution coordination across the intelligence pipeline
- Approval gate integration (`ApprovalQueueItem`)
- Timeline integration via `timeline_note` step kind
- Session-only; no persistence, no cloud, no UI as of V1

**Introduced in:** R-WORKFLOW-CHAIN-V1

---

## Why They Coexist

The legacy system predates the operational chain concept. Merging would require
refactoring active chat-routing logic, which is out of scope for current rounds.
Both systems are additive — they do not conflict at runtime.

The `WorkflowChain*` types live in `workflowChainTypes.ts` precisely to avoid
shadowing `WorkflowStep` / `WorkflowStepKind` from `types.ts`.

---

## Future Possible Direction

- **Option A:** Rename the legacy system (e.g., prefix types with `Chat*` or
  `Conversational*`) to make the distinction explicit in code.
- **Option B:** Fully migrate legacy conversational flows into operational
  workflow chains, treating chat sessions as a chain variant.

**Neither option should be pursued until explicitly scoped in a future round.**
Do not refactor speculatively.
