# Intelligence — Regression Checklist

> R-INTELLIGENCE-REGRESSION-GUARD-V1. Run this before/after any round that
> touches Intelligence routing, actions, continuity, or sessions. The
> automated half is `npm run test`; the browser half is the manual list below
> (the deterministic tests cannot observe render or navigation).

---

## 1. Automated guards (must be green)

```bash
./node_modules/.bin/tsc --noEmit        # EXIT 0
npm run test                            # all Intelligence suites green
npm run build                           # EXIT 0 (only if runtime paths changed)
```

Key suites:
- `intentRouter.test.ts` — base routing.
- `intentRouterAliases.test.ts` — operator-phrase aliases + typo tolerance.
- `intelligenceRegression.contract.test.ts` — **intent contract** (locks the
  exact intent each core prompt routes to).
- `intelligenceRegression.actions.test.ts` — open-by-id safety, no-context
  follow-up safety, proactive button dedupe.
- `followUpSafety.test.ts` / `sessionContext.test.ts` — TTL + stale-entity.

If a contract test flips, a routing behavior changed — confirm it was intended
before updating the expected value.

### Intent contract (current, empirically captured)

| Prompt | Lang | Intent |
|---|---|---|
| `what should i do now` | EN | `proactive_operations` |
| `que hago ahora` / `qué hago ahora` | ES | `recommended_next_best_action` |
| `what should i do today` | EN | `daily_operator_brief` |
| `mi mejor cliente` / `my best customer` | ES/EN | `best_customer` |
| `open order` | EN | `entity_operational_command` |
| `contact him` / `open it` / `why` / `show more` | — | follow-up gate (`isFollowUpQuery`), **only acts when context exists** |

> NOTE: the three "do something" prompts route to **three different**
> handlers. That overlap is intentional and fragile — do not add a fourth
> "what should I do" intent (see `docs/INTELLIGENCE-HANDOFF.md` §10).

---

## 2. Browser runtime checks (manual)

Run the app (`npm run dev`), open the Intelligence tab, and walk through:

1. **Ask `que hago ahora`**
   - [ ] Response renders a ranked recommendation card.
   - [ ] **No raw markdown** (`**`, `##`) leaks as literal characters.
   - [ ] **No duplicate buttons** (e.g. not both "WhatsApp" and "Notify customer"
         pointing at the same action; not "Open Order" twice).

2. **Click `Open Order` / `Open Repair` / `Open Layaway` / `Open Unlock`**
   - [ ] The **existing** entity opens, populated with real data.
   - [ ] It is **never** a blank/new-creation modal with placeholder fields.

3. **Click `WhatsApp`**
   - [ ] The confirm modal appears (no auto-send).
   - [ ] On confirm, exactly **one** continuity message scrolls into view.

4. **Ask a follow-up `why` (right after a real answer)**
   - [ ] It explains the previous answer using the same context.
   - [ ] After 30 min idle (or app refresh), `why` returns the safe
         "ask a complete question" message — **no stale context hijack**.

5. **Ask a typo command `que hago ahorta`**
   - [ ] Routes the same as `que hago ahora` (recommended next best action).
   - [ ] An uncontrolled typo (`opne order`, `custmer`) does **not** mis-route to
         a wrong business screen — it falls back to a safe clarifying answer.

6. **Type a bare customer name (e.g. `daniel morales`)**
   - [ ] Does **not** hijack a business view (sales/proactive/etc.); it asks to
         clarify or shows the customer lookup — never a wrong analytics answer.

7. **Refresh the app, then immediately ask `contact him` / `open it`**
   - [ ] No action fires against a stale entity — safe no-context message.

---

## 3. Red flags (stop and investigate)

- A core prompt now returns `fallback_question`.
- An "Open X" button opens a blank/new modal.
- Two buttons in one response do the same thing.
- Raw `**`/`##` visible in the chat bubble.
- A follow-up (`why`, `contact him`) acts after a refresh with no fresh context.
- A typo routes to a wrong operational screen instead of a safe fallback.
