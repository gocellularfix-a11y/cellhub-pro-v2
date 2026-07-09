# CellHub Pro — Intelligence System Handoff

> Handoff doc for a new auditor. Goal: understand the Intelligence subsystem well
> enough to design safe, surgical change prompts. Everything here is grounded in
> the actual code under `src/services/intelligence/` and `src/modules/intelligence/`.
> Last updated: 2026-06-02 (after R-INTELLIGENCE-OPERATOR-SESSIONS-V1).

---

## 0. TL;DR for the auditor

- Intelligence is **deterministic** (no AI/LLM, no embeddings, no vector DB). Every
  answer is computed from local store data.
- It is **large and mature**: ~60 sub-modules, **84 chat intents**, 52 engine
  read-methods. **It is NOT lacking intelligence — it lacks polished execution.**
- The dominant risk is **routing instability** and **handlers.ts bloat**. Most new
  asks should **reuse existing intents/handlers**, not add new ones.
- Money is **cents (integer)**. Never float. Tax via `forwardTaxFromBase()`.
- All user-facing text via `tChat()` / `useTranslation()` (EN/ES/PT). Function-style
  translation entries are the project standard (655+ of them, 0 `{{token}}`).

---

## 1. Where things live

```
src/services/intelligence/
  IntelligenceEngine.ts        ← the engine: 52 read-methods (getSales, getRepairs,
                                  getProactiveReport, …). Memoized. No store writes.
  chat/
    intentRouter.ts            ← classifyIntent() — THE router. ~84 intents, keyword banks.
    handlers.ts                ← 6000+ line monolith: handleIntent() switch + most handlers.
    <per-domain>.ts            ← extracted handlers: conversationRunner, focusToday,
                                  nextBestAction, whoNeedsAttentionToday, whatIsLosingMoney,
                                  whyDidSalesDrop, whyIsTodaySlow, repairIntelligence,
                                  productPromotion, customerOutreach, restockOpportunity, …
    sessionContext.ts          ← cross-tab follow-up memory (30-min TTL, localStorage).
    opportunityActionAdapter.ts← opportunity action shape → ChatActionUI.
    *.test.ts                  ← intentRouter / aliases / sessionContext / followUpSafety tests.
  continuity/
    postActionContinuity.ts    ← deterministic next-step suggestions (this session).
    operatorSession.ts         ← active workflow session tracking (this session).
    continuityEngine.ts / *.ts ← older continuity snapshot helpers.
  proactive/
    proactiveEngine.ts         ← generateProactiveOperationsReport(): ranked operator actions.
    types.ts                   ← ProactiveAction (carries entityType/entityId).
  actions/
    actionEngine.ts            ← ActionPayload type (executionTarget union).
    actionExecutor.ts          ← executeActionPayload(): runs a payload, dispatches cellhub:* events.
  execution/executionResolver.ts ← toActionPayload() / entityKindToExecutionPayload().
  operatorQueue/operatorQueue.ts ← OperatorTaskType + the operator task queue.
  (≈50 more sub-modules: attention, alerts, missions, workflows, decisions, digest,
   outcomes, scoring, ranking, rootCause, dataAccess, oce, gpo, fusion, …)

src/modules/intelligence/
  IntelligenceChat.tsx         ← the chat UI: fireQuery, handleActionClick, continuity +
                                  session wiring, WhatsApp confirm modal.
  IntelligenceModule.tsx       ← the tab shell (engine lifecycle, panels).
src/components/layout/AppShell.tsx ← listens for cellhub:open-* events → navigates/opens entities.
```

---

## 2. Routing — `classifyIntent()` (intentRouter.ts)

The single entry point. Flow:

1. `normalize(raw)` → lowercase, strip `¿?¡!.,;:`, collapse spaces.
2. `correctOperatorTypos(normalized)` → **tight, deterministic typo dictionary**
   (ahorta→ahora, q/qe/ke/que-ago→que hago, what-shoud→what should, …). Runs BEFORE
   scoring. Never touches names/phones/invoices/barcodes (no alphabetic token overlap).
3. `isConversationalFiller(query)` → hard-block chatter ("wow", "interesting", "ok",
   "tell me more", ES/PT) → `fallback_question`. Exact-phrase match only.
4. **Keyword scoring**: each intent has a `*_KEYWORDS` bank. `scoreKeywords` = count of
   bank tokens that are **substrings** of the query. Highest score wins; **ties broken by
   array order** (earlier = more specific). `confidence = min(1, score/2)`.
5. Score 0 on all banks → `fallback_question` (deterministic fallback handler).
6. A few hard tie-break rules (e.g. PROACTIVE_TIEBREAK_PHRASES forces
   `proactive_operations` over `decision_recommendation` for "what should i do").
7. Name/product extraction for customer/product intents.

### Critical routing facts
- **84 intents** exist. The "what should I do / make money / who to contact" cluster is
  covered by **~12 overlapping intents**: `proactive_operations`, `recommended_next_best_action`,
  `focus_today`, `daily_revenue_missions`, `proactive_opportunities`, `today_money_map`,
  `who_to_contact_today`, `who_is_most_likely_to_buy_today`, `global_priority_status`,
  `what_to_do_today`, `who_needs_attention_today`, `operator_mode`.
  → **Adding another "what to do now" intent re-introduces routing instability.** Don't.
- Scoring is substring-based, so **bare tokens are dangerous** (e.g. `money`/`dinero` in
  WHAT_HURTING_PROFIT_KEYWORDS catch "who owes me money"; `pending` in REPAIRS_KEYWORDS
  catches "pending payments"). Known + documented; left as-is (narrowing them regresses
  legit phrases).
- **Aliases** (R-OPERATIONAL-PHRASES-1): added explicit phrases to EXISTING banks
  (who_to_contact, data_query appointments) + an `OPERATIONAL_ALIASES` table that only
  powers a debug log. No new handlers.

### Routing guardrails to enforce in prompts
- New phrases → **alias into an existing bank**, never a new competing intent.
- Respect array order (specific-before-generic) when inserting.
- Keep the filler guard and typo dictionary tight.

---

## 3. Handlers

- `handleIntent(match, engine, lang)` in **handlers.ts** is a giant switch → per-intent
  handler functions. Many handlers live inline in handlers.ts; newer ones are **extracted
  into per-domain modules** under `chat/`.
- **RULE (from project memory): do NOT grow handlers.ts further.** New features go in a
  new per-domain module (like `conversationRunner.ts`, `productPromotion.ts`,
  `whoNeedsAttentionToday.ts`). handlers.ts is already 6000+ lines.
- Handlers return a **`ChatResponse`**: `{ kind, text, actions?, establishesContext?, panelCampaign? }`.
- i18n via `tChat(lang)` (mirrors useTranslation; supports function-style entries).

---

## 4. Data / engine layer

`IntelligenceEngine` (52 methods) is the read-only data API. Key getters:
`getSales, getRepairs, getCustomers, getInventory, getLayaways, getUnlocks,
getSpecialOrders, getAppointments, getEmployees, getExpenses, getReturns` plus computed
reports: `getProactiveReport, getDailyBrief, getMorningDigest, getAttentionSnapshot,
getReorderRecommendations, getTrendDirectionReport, getDecisionRecommendationReport,
getRevenueRootCause, getDeadStockRootCause, getSlowDayRootCause, getChurnRootCause,
getHealthScore, getCustomerScores, getRepairScores, getInventoryScores, …`.

- **Memoized**; refreshed on data change. Never writes to the store.
- `proactiveEngine.generateProactiveOperationsReport()` builds the ranked action list from:
  collection (repair/layaway balances), repair follow-ups, VIP retention, workflow
  escalation, approval backlog, inventory reorder risk. Each `ProactiveAction` carries
  `entityType` + `entityId` (this is what powers executable buttons).

---

## 5. Execution pipeline (how a button runs)

```
ChatActionUI { id, label, actionType?, payload: ActionPayload, triggerQuery? }
  payload.executionTarget ∈ {
    whatsapp_url, open_repair, open_customer, open_layaway, open_unlock,
    open_special_order, open_inventory, open_promote_panel, pos_discount, pos_bundle,
    review_panel, reminder_queue, queue_manager_review, add_to_operator_queue,
    copy_to_clipboard, record_outreach_outcome, none
  }
```
Click → **`handleActionClick(action)`** in IntelligenceChat:
1. Special targets handled inline: `triggerQuery` (re-fires a chat query),
   `copy_to_clipboard`, `add_to_operator_queue` (→ operator task queue).
2. Otherwise `executeActionPayload(payload)` (actionExecutor.ts):
   - Guards `!entityId` → `{ ok:false }` → safe "not available" feedback.
   - Dispatches a `cellhub:open-<entity>` **window event** with the id.
3. **AppShell.tsx** listens for `cellhub:open-*` → `nav(tab)` + re-dispatches an
   `cellhub:_intel-open-<entity>` event (80ms later, so the module is mounted).
4. The target module (e.g. SpecialOrdersModule) listens, **finds the entity by id**,
   and opens its edit modal **populated from the real entity** (must set BOTH the entity
   ref AND the form state — see the Open-Order bug below).

**Auto-queue note:** any `actions[]` a handler returns through `fireQuery` get auto-added
to the operator queue (deduped by `automationKey`). Continuity/session messages are pushed
via `setMessages` directly and are NOT auto-queued.

---

## 6. Continuity + Sessions (added this session)

### Post-action continuity (`postActionContinuity.ts`, wired in IntelligenceChat)
- After an action executes → `maybePushContinuity(executionTarget, payload, sourceActionId)`.
- `resolvePostActionContinuity()` (pure) maps executionTarget+entity → ≤3 next-step
  ChatActionUI using ONLY existing executionTargets. Examples:
  open_repair → Mark follow-up / WhatsApp / View history; open_customer → Reconnect /
  Add reminder; open_inventory → Discount / Promote; whatsapp_url → Open unpaid repair /
  Reminder / History.
- **Loop guard:** continuity actions are tagged `cont-…`; clicking one never spawns more
  continuity (depth 1). **Cooldown:** 45s per `target:entity`. **Deferred** push
  (`setTimeout 0`) so it lands after navigation/render settles and auto-scroll reaches it.
- Only emits a button when the entity exists (no dead buttons). No profit/cost shown.

### Operator sessions (`operatorSession.ts`, wired in IntelligenceChat)
- Single active workflow session (V1) in a ref. Types: repair_collection,
  layaway_collection, vip_retention, customer_reactivation, inventory_push, manager_queue,
  generic_operator.
- `deriveOperatorSessionFromAction()` classifies the executed action → session type+entity.
  Same type+entity → UPDATE (stepCount++). Different → REPLACE. 30-min inactivity expiry.
- Surfaces ONE subtle hint ("🔧 Continuing repair collection workflow.") prepended to the
  continuity message, **max once per session** (`hintShown`). State-only — NOT a second
  continuity/ranking/memory engine. Stores entity ids + workflow type only (no money).

---

## 7. i18n / privacy conventions

- **Every** user-facing string via `tChat(lang)` (handlers) or `useTranslation().t` (UI).
  Both support function-style entries `{ en: (n)=>\`…${n}\`, es: …, pt: … }`. This is the
  established standard (655+ function entries, 0 `{{token}}`). Do NOT introduce `{{token}}`.
- **Financial Privacy:** `canSeeOwnerFinancials` gates profit/cost/margin. Intelligence
  must NOT expose profit unless allowed. Recoverable *balances* (money owed) are
  operational, not profit, and are shown. New continuity/session code shows neither.

---

## 8. Canonical patterns the auditor must enforce

- **Reuse > new.** New "operator command" → alias into an existing bank + reuse an existing
  handler. New executable action → reuse an existing `executionTarget`.
- **Additive/surgical only.** No refactor of handlers.ts, the router, or the engine.
- **Deterministic only.** No AI/LLM/embeddings/probabilistic behavior/background jobs.
- **Money = cents.** Never recalc tax/totals in a display change.
- **Open-by-id, never blank.** Any "open entity" action must carry the real id; missing/
  invalid id must be a safe no-op (never a blank/default modal).
- **tChat + EN/ES/PT** for any new string.
- **`tsc --noEmit` (local binary) must be EXIT 0; `npm run build` must pass; tests pass.**

## 9. Anti-patterns (do NOT do)
- Add another "what should I do now" intent / ranking engine / memory engine.
- Grow handlers.ts further.
- Use bare single-word keyword tokens (substring matching → false positives).
- Mutate the router's name/phone/invoice handling via typo correction.
- Auto-execute or auto-send anything (every action is owner-approved).

---

## 10. Known gaps / TODOs / risks

- **`unpaid_balances` intent — IMPLEMENTED (`aa896ad`, R-INTELLIGENCE-UNPAID-BALANCES-V1).**
  Phrases "show unpaid", "who owes me money", "payments due", "quién me debe dinero",
  "saldos pendientes", "contas em aberto" now route to a dedicated accounts-receivable
  handler instead of falling to fallback or mis-routing (via bare `money`/`dinero`/`pending`
  tokens) to what_hurting_profit / repairs_overdue.
  - **Source module:** `src/services/intelligence/chat/unpaidBalances.ts` (`handleUnpaidBalances`).
    handlers.ts only dispatches the new `unpaid_balances` intent — no inline handler block added.
  - **Data sources:** aggregates the stored `balance` across repairs, layaways, special orders,
    and unlocks (engine getters `getRepairs/getLayaways/getSpecialOrders/getUnlocks`). Excludes
    zero/negative balances and terminal statuses; sorts highest-balance first.
  - **Deterministic + read-only, no LLM.** Balances are read as-is (never recalculated); money
    stays integer cents; no tax/persistence logic touched.
  - **Router:** `UNPAID_BALANCES_KEYWORDS` bank + `unpaid_balances` listed HIGH in INTENTS
    (above what_hurting_profit / repairs_overdue) so anchored AR tokens win over the bare
    substrings; the bare tokens were left as-is (narrowing them regresses legit phrases).
  - **Tests:** `src/services/intelligence/chat/unpaidBalances.test.ts` (4 handler tests) plus
    router coverage — all passing.
- **Runtime verification pending.** All this session's work passes tsc + build + 43 tests,
  but the live flows (executable buttons → continuity → sessions) were **not run in a real
  browser**; needs manual QA (see §11).
- **Auto-queue volume.** Proactive/continuity action buttons follow the existing auto-queue
  pattern; heavy use could fill the operator queue (deduped, but worth watching).
- **handlers.ts size (6000+ lines)** is a maintainability risk; keep extracting per-domain.

---

## 10.1 AR Collections Action Loop — COMPLETE (Phases 0–2)

The `unpaid_balances` answer (see §10) is now a full owner-approved collections
workflow. **Boundary: Intelligence only proposes and navigates — the deterministic
modules own every payment, balance, and tax calculation** (PRODUCT-BIBLE §5). No AR
code marks a balance paid, mutates a balance, creates a transaction, or touches tax.

1. **Find who owes money** — `unpaid_balances` → `handleUnpaidBalances`
   (`chat/unpaidBalances.ts`) aggregates the stored `balance` across repairs /
   layaways / unlocks / special orders, excludes zero/terminal, sorts highest-first.
   Trust fixes (`1fa805d`, Phase 0): voided-sale exclusion, `repairs.pending` KPI,
   card-fee flat amount (cents), phantom-WhatsApp-sent guard, daily-brief profit gate.
2. **Send reminder** — `bbc7379` Phase 1: WhatsApp + Copy reminder actions with
   deterministic EN/ES/PT text (mirrors the Payment Date Finder builder —
   `sanitizeToBMP`, integer-cents amount via `COP`). Reuses the existing
   `whatsapp_url` / `copy_to_clipboard` targets + the Phase 0 popup-block guard.
3. **Track reminder** — `7a548d5` Phase 1B: dedicated append-only store
   `src/services/intelligence/ar/arReminderStore.ts` (key
   `cellhub:intelligence:arReminders:v1`; parse-guarded, capped, 90-day TTL). Events
   `ar_reminder_whatsapp_opened` (only after `window.open` returns a handle) and
   `ar_reminder_copied` (only after a successful copy). A light "last reminder: N days
   ago" note renders per row. No existing store schema was reused/abused.
4. **Collect payment** — `1f278ea` Phase 2: a **Collect payment** action that hands
   off via the existing `open_repair` / `open_layaway` / `open_unlock` /
   `open_special_order` navigation to the entity, where each module owns its
   collect-balance flow (RepairModal 💰 Collect, LayawayModule add-payment,
   Unlock/SpecialOrder collect modals). Handoff only — no new modal, no transaction.

Tests: `chat/unpaidBalances.reminder.test.ts`, `ar/arReminderStore.test.ts` (store
roundtrip / retention / parse-guard), plus the original `unpaidBalances.test.ts`.

---

## 11. Manual QA checklist (run in the app)

1. "qué hago ahora" / "what should I do right now" → ≤5 ranked recs with executable buttons,
   buttons only where an entity exists, no duplicates.
2. Click WhatsApp → confirm modal → on send, ONE continuity message scrolls into view.
3. Click Open Repair/Customer/Inventory/Order → entity opens **with real data** (no
   placeholders) → ONE continuity message + relevant buttons.
4. Clicking a continuity (`cont-…`) button executes but does NOT cascade infinitely.
5. Session hint ("Continuing X workflow") shows **once** per workflow; changes when the
   entity/type changes; expires after 30 min.
6. "que hago ahorta?" routes same as "que hago ahora?"; customer/invoice/phone search
   unaffected.
7. Language EN/ES/PT: no English leakage in buttons/messages/hints.

---

## 12. This session's Intelligence changes (commits on `main`)

| Round | What | Commit |
|---|---|---|
| STABILIZE-1 | follow-up TTL + entity safety + conversational-filler guard + tests | `566797d` |
| OPERATIONAL-PHRASES-1 | keyword aliases to existing intents + debug log + tests | `0a73dc0` |
| EXECUTABLE-ACTIONS-V1 | executable buttons on `proactive_operations` (reuse entityType/entityId) | `9392c8f` |
| OPERATOR-CONTINUITY-V2 | deterministic post-action next-step suggestions | `c5e9b38` |
| CONTINUITY-RUNTIME-AUDIT-V1 | fix invalid queueType (`repair_follow_up`) + deferred scroll | `b41e57b` |
| OPERATOR-SESSIONS-V1 | lightweight active-workflow sessions + one-line hint | `fc139ae` |
| OPEN-ORDER + TYPO-TOLERANCE | Open Order populated from real order (form-sync bug) + typo dictionary | `a6f448a` |

### Notable bug root causes fixed this session
- **Open Order opened a blank modal:** the `_intel-open-special-order` handler set the
  entity ref + showModal but **not the form state** (the modal renders the parent `form`,
  not the entity) → placeholders. Fix: call `openEdit(order)` (sets ref + form). General
  lesson: "open entity" handlers must populate the form/state the modal actually renders.
- **Typos broke routing:** `normalize()` didn't tolerate typos → `correctOperatorTypos()`.
- **Repair margin -400% (Reports, not chat but related):** report counted repair `laborCost`
  as COGS; only PARTS are cost. Fixed in ReportsModule (`R-REPORTS-REPAIR-MARGIN-FIX-V1`).

---

## 13. Dual-tool workflow reminder
Auditor (ChatGPT) designs prompts; the reparador (Claude Code) executes one round at a time
and PAUSES for explicit auditor approval between phases unless Jorge pre-approves a batch.
Owner: Jorge Ochoa (Go Cellular, Santa Barbara CA). Communication: Mexican Spanish/Spanglish,
no voseo.
