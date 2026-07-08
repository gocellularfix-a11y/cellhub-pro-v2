# CellHub Pro Product Bible

> **Status:** Permanent project document. Read this first, before any code is written.
> **Companion document:** `CHATGPT-ONBOARDING.md` explains *how* the project is
> built (stack, architecture, conventions). This document explains *why* the
> project exists and the reasoning every decision must respect.
>
> This is an internal engineering handbook, not marketing material. It exists so
> that any developer — human or AI — arriving at this repository understands the
> intent behind the code before changing it. Code without intent decays. This
> document is the intent.

---

## 1. Mission

CellHub Pro is not another point-of-sale application.

The category "POS" describes the smallest part of what this product does.
A POS records a transaction after a decision has already been made. CellHub Pro
is being built to participate in the decisions themselves — what to stock, what
to charge, which repairs are stalling, which customers to follow up with, where
money is leaking, and what the owner should do next. It is becoming the
**operating system for a wireless retail store**: the single environment in
which the business is run, not merely rung up.

That framing sets the standard for every feature. The question is never "does
this look like a feature a POS should have?" The question is: **does this reduce
the owner's workload?** A store owner's time and attention are the scarcest
resources in the business. Software that consumes them — through configuration,
ceremony, cleanup, or confusion — is a liability regardless of how capable it is.

Every feature must justify itself against at least one of four outcomes:

1. **Save time** — fewer clicks, fewer steps, less waiting, less re-entry.
2. **Reduce mistakes** — fewer wrong prices, miscounts, missed follow-ups,
   lost tickets, accounting errors.
3. **Increase profit** — better pricing, less shrinkage, faster turnaround,
   recovered revenue, tighter margins.
4. **Improve customer experience** — faster checkout, accurate status,
   professional receipts, fewer errors the customer sees.

A feature that does none of these does not belong, no matter how technically
interesting it is.

Finally, and without apology: **commercial usability is always more important
than elegant code.** This is production software that runs a real business every
day. A clumsy internal abstraction that ships a reliable checkout is worth more
than a beautiful architecture that confuses a cashier or drops a sale. Code
serves the store. The store never serves the code.

---

## 2. Product Philosophy

The following principles are load-bearing. They are not aspirations; they
constrain what may be built and how.

### Production software first
This is not a demo, a prototype, or a portfolio piece. It is live software with
real money, real inventory, and real customers behind every screen. There is no
"we'll fix it later" grace period, because "later" is a day the store is open.
Every change ships into an environment where a bug costs a sale, a customer, or
trust. Build accordingly.

### Dogfooded daily at Go Cellular
The product runs in production at Go Cellular before it is sold to anyone else.
This is deliberate. Dogfooding is the fastest, most honest feedback loop
available: if a workflow is slow, the owner feels it that afternoon; if a report
is wrong, it is caught against real books. It also means the bar for "done" is
"works in the store," not "passes a test." When in doubt about whether something
is acceptable, imagine it running at the counter with a customer waiting.

### Stability over cleverness
Given two ways to solve a problem — one clever, one boring and predictable —
choose boring. Cleverness concentrates risk and hides intent. A store owner
cannot debug a clever abstraction at 6 PM on a Saturday, and neither can the next
developer. Predictable code that a stranger can read and trust is the asset.
Clever code is a liability wearing a compliment.

### Deterministic whenever possible
Business logic must produce the same output for the same input, every time, on
every machine. Money, tax, inventory counts, totals, and reports are
deterministic by nature and must remain so in code. Non-determinism —
randomness, wall-clock dependence, race conditions, floating-point drift — is a
defect in this domain, not a feature. Where the product uses AI (see §5),
determinism is preserved by keeping AI out of the calculation path entirely.

### AI assists — it does not replace business logic
AI is an advisor layered on top of a deterministic core. It surfaces patterns,
drafts text, ranks priorities, and flags anomalies. It never *is* the business
logic. The moment an AI output can silently change a total, a tax figure, or a
stock count, the product has failed its own reliability contract. AI proposes;
the application computes and decides. This boundary is absolute (see §5).

### Offline-first and local-first
A retail store cannot stop selling because the internet went down. The product
must remain fully functional with no network connection. Data lives locally and
is authoritative locally; cloud sync, when enabled, is a mirror and a
convenience, not a dependency. During current dogfooding the app runs
localStorage-only by design. "Local-first" also means the store owns their data
and their store keeps working regardless of anyone else's uptime.

### Fast
Speed is a feature, and often the most important one. A cashier will forgive a
missing capability far sooner than a slow one. Latency at the counter is felt by
the customer, not just the employee. The product must feel instant on the actions
that happen hundreds of times a day.

### Reliable
The product must do the same correct thing under load, on tired hardware, at the
end of a long day, with an impatient line. Reliability is measured at the worst
moment, not the best. See §8.

### Commercial-grade
Everything the customer or owner touches — receipts, labels, reports, status
pages, error messages — must look and behave like a professional commercial
product, because that is what it is and what it is being sold as. Rough edges
that would be acceptable in an internal tool are not acceptable here.

---

## 3. User Philosophy

Design for the people who actually use the software, in the conditions they
actually work in.

### Who uses CellHub Pro

- **Store owner** — cares about profit, shrinkage, staff accountability, and
  time. Often technical enough to be dangerous, rarely technical enough to
  debug. Wants the business summarized, not the software explained.
- **Manager** — runs the floor, handles exceptions, approves overrides, reconciles
  the day. Needs authority (PIN-gated actions) and visibility without friction.
- **Technician** — lives in Repairs and Unlocks. Wants to update ticket status,
  find parts, and move on. Every extra field is a tax on their real work.
- **Sales associate / cashier** — lives in POS. High volume, low patience,
  frequently interrupted. Needs the fastest possible path from "customer walks
  up" to "customer walks away paid."

### The conditions they work in

Employees are **busy**. Assume they are doing three things at once. Assume a
customer is standing in front of them right now. Assume the phone is ringing.
Assume they will be interrupted mid-task and return to the screen thirty seconds
later needing to know exactly where they were.

From this, hard design consequences follow:

- **Assume interruptions.** Workflows must be resumable. State must not be lost
  because someone walked away. A half-finished sale is normal, not an error.
- **Assume customers are waiting.** The user cannot read a paragraph, hunt
  through a menu, or wait for a spinner. The common path must be short enough to
  complete while making eye contact with a customer.
- **Every click matters.** Each click is a small tax paid dozens or hundreds of
  times per day, multiplied across every employee. Removing one click from
  checkout is a real, compounding productivity gain. Adding one is a real cost.
- **Never interrupt workflows.** Do not block the user with modals, prompts, or
  confirmations that are not strictly necessary. Do not steal focus. Do not force
  a decision that could be deferred. The software's job is to get out of the way.

The user is not the developer. The user has not read the manual, does not want to,
and should never need to. If a feature requires explanation to be used, the
feature is not finished.

---

## 4. UX Philosophy

UX rules follow directly from the user philosophy. They are not stylistic
preferences; they are performance requirements for a busy retail counter.

### The fastest workflow wins
When choosing between two designs, the deciding factor is time-to-complete for
the common case. Not aesthetics, not symmetry, not novelty. The design that lets
a cashier finish faster is the correct design, even if it is less pretty.

### Never hide critical information
Prices, totals, balances, taxes, stock status, ticket status, and payment state
must be visible when they matter, without a click to reveal them. Hiding critical
data behind a hover, a tab, or a second screen creates mistakes. If it changes a
decision, it belongs on screen.

### Avoid unnecessary dialogs
Native browser dialogs (`alert`, `confirm`, `prompt`) are forbidden — they break
the Electron experience and block the entire UI thread. Beyond that technical
rule, dialogs of any kind are interruptions and must earn their place. A dialog is
justified only when it prevents a costly, irreversible mistake (see §8). It is not
justified for information that could be a toast, or a choice that could have a
sensible default.

### Avoid wizard-style interfaces unless absolutely required
Multi-step wizards are slow, hard to resume after interruption, and hostile to
experienced users who already know what they want. Prefer a single dense screen
that a practiced user can operate at speed. Reserve wizards for genuinely one-time,
rarely-touched setup flows where guidance outweighs speed.

### The scanner should be usable globally wherever practical
Scanning is the fastest input method in retail. The barcode scanner should be
usable from as many contexts as possible so that scanning "just works" without the
user first navigating to the right screen. The long-term direction is a scanner
that resolves an item, ticket, or customer from anywhere in the app.

### The cart should eventually become globally accessible
A sale in progress should not be trapped inside one screen. The direction is a
cart the user can add to and review from anywhere, so a customer adding "one more
thing" never forces a navigation detour. This is a stated architectural goal, to
be approached additively and carefully — not a license to rewrite existing cart
behavior.

### Reduce navigation
Every screen change is a context switch and a delay. Prefer bringing the action to
the user over sending the user to the action. Fewer screens, fewer menus, fewer
"go here then come back" round trips.

### Reuse existing UI patterns
The product must feel like one coherent application, not a collection of screens
built by different hands. Reuse the existing modal, toast, table, and form
patterns. A new pattern must justify why the existing one was insufficient. Visual
and behavioral consistency reduces training time and mistakes.

### Commercial software over flashy software
Restraint is the house style. Animations, gradients, and novelty cost performance
and attention and age badly. The product should look competent, clean, and
trustworthy — the way a tool that handles money should look. Flash is not a
feature; it is a distraction that the counter cannot afford.

---

## 5. Intelligence Philosophy

Intelligence is the product's long-term differentiator and its highest priority
(see §11). It is becoming the **assistant for the business** — the layer that
watches the store's data and helps the owner run it, rather than making them read
every number themselves.

### What Intelligence is for

The Intelligence layer should:

- **Recommend** — suggest next actions, pricing, reorders, follow-ups.
- **Detect** — surface anomalies, mismatches, and problems the owner would
  otherwise miss.
- **Predict** — anticipate stockouts, slow-moving inventory, cash-flow patterns.
- **Warn** — flag risks before they become losses.
- **Summarize** — turn a day, a week, or a report into a readable briefing.
- **Prioritize** — rank what deserves attention now versus later.
- **Automate repetitive work** — draft messages, prepare lists, pre-fill the
  obvious so a human only confirms.

Done well, this is the difference between software that records the business and
software that helps run it (see §13).

### The absolute boundary

**Deterministic code always executes critical business logic. AI never does.**

This is the single most important rule in the entire product, and it is not
negotiable:

> **AI must never calculate taxes, totals, inventory quantities, accounting
> figures, or any financial data.**

AI is probabilistic. Money is not. A tax figure that is "usually right" is a
catastrophe — it is wrong receipts, wrong books, and legal exposure. Therefore the
calculation path contains no AI. Totals, tax, change due, balances, commissions,
stock counts, and every figure that appears on a receipt or in a report are
computed by deterministic, tested code and nothing else.

The mental model is a strict division of labor:

- **AI proposes.** It may say "this order looks like it should reorder 12 units,"
  or "this customer probably owes a follow-up," or "revenue looks off this week."
- **The application decides and computes.** A human or deterministic rule accepts
  the proposal, and the deterministic engine performs the actual mutation and the
  actual math.

An AI suggestion is an input to a human decision or a deterministic process. It is
never the final authority over money, stock, or the ledger. When designing any
Intelligence feature, draw this line explicitly and keep the calculation on the
deterministic side of it.

---

## 6. Coding Philosophy

How code is written here is downstream of everything above: it must protect a
running business.

- **Small diffs.** The smallest change that correctly solves the problem is the
  best change. Small diffs are easy to review, easy to reason about, easy to
  revert, and unlikely to disturb a working flow. Large diffs hide regressions.
- **No unnecessary refactors.** Do not refactor code that is not the target of the
  task. "While I'm here" cleanups are how working systems break. If a refactor is
  genuinely needed, it is its own scoped, approved piece of work — never a
  side effect of something else.
- **Reuse existing architecture.** Before writing something new, find where the
  project already does it and extend that. Parallel implementations of persist,
  navigation, print, or open/edit are defects. One way to do each thing.
- **Backward compatible.** Existing data, existing saved records, and existing
  workflows must keep working across changes. Data written by an older version
  must still read correctly. Migrations, when unavoidable, are explicit,
  idempotent, and safe.
- **Respect existing patterns.** The established patterns (money-as-cents, full
  entity spread on persist, the canonical tax helper, PIN gates, bilingual
  strings) exist because they were paid for in bugs. Follow them. Deviating
  reintroduces solved problems.
- **Prefer additive changes.** Add capability alongside what exists rather than
  replacing it. Additive change has a smaller blast radius than modification, and
  a far smaller one than replacement.
- **Do not introduce new frameworks.** The stack is settled (see
  `CHATGPT-ONBOARDING.md`). New dependencies add attack surface, build weight,
  maintenance burden, and risk. Adding one requires explicit justification and
  approval — never convenience.
- **Do not rewrite working systems.** A passing flow is a contract with the
  business. It is not to be rewritten because a newcomer finds it inelegant.
  Working code that is ugly is still working code, and its value is proven.
- **Never create technical debt just for speed.** Shortcuts that leave the code
  in a worse state are borrowed against the store's future stability, and the
  interest is paid in outages. If a task cannot be done properly in the time
  available, say so — do not ship a trap for the next developer.

The through-line: **write less code, disturb less, prove more.**

---

## 7. Performance Philosophy

The app must remain fast under real conditions, on real hardware, at real scale.

- **The app must remain fast.** Speed is not a late-stage optimization; it is a
  standing requirement. A change that makes a hot path slower is a regression even
  if it adds a feature. Measure the actions that happen constantly — search,
  add-to-cart, checkout, scan — and protect their latency.
- **Avoid unnecessary renders.** In a React app, wasted renders are the most
  common source of sluggishness. Keep state local where it belongs, memoize
  deliberately, and do not force large trees to re-render for a small change.
  Component structure is a performance decision.
- **Avoid large component rewrites.** Beyond the regression risk (see §6), large
  rewrites tend to collapse carefully tuned render boundaries and reintroduce
  performance problems that were previously solved. Extend surgically.
- **Keep Electron responsive.** The main thread must never be blocked. No
  synchronous heavy work on the UI thread, no blocking dialogs, no long loops
  where the user is waiting. A frozen window reads as a crashed application to a
  cashier.
- **Protect low-end hardware.** Stores do not run on developer workstations. They
  run on whatever machine is at the counter, often modest and often several years
  old. The product must feel fast there, not just on the machine it was built on.
- **Design for scale from the start.** Large stores may carry **tens of thousands
  of products**. Any list, search, filter, or report must be designed to handle
  that volume without loading everything into memory, rendering thousands of DOM
  nodes at once, or scanning linearly on every keystroke. "It works with my 50
  test items" is not evidence that it works. Assume the big store.

---

## 8. Reliability Philosophy

This section is about trust. A store that cannot trust its software will stop
using it, and rightly so.

- **Never lose customer data.** Customer records, sales history, repair tickets,
  and financial history are the store's memory and, in many cases, legal records.
  Losing them is the worst thing the software can do. Every code path that writes
  data is a code path that must not corrupt or drop it.
- **Never silently overwrite data.** The persistence layer overwrites whole
  records for most collections; therefore every write must carry the complete,
  current entity, never a partial patch. A partial write here is silent data loss.
  This is a specific, known hazard in this codebase — treat every persist call as
  a potential data-loss site and confirm the full record is being written. (See
  `CHATGPT-ONBOARDING.md` for the exact pattern.)
- **Never perform destructive actions without confirmation.** Deletes, voids,
  refunds, cancellations, and overwrites that cannot be undone must be confirmed
  through the product's own confirmation UI — never a native dialog, never
  silently. Confirmation is one of the few times a dialog is justified precisely
  because the action is irreversible.
- **Always preserve compatibility.** Data and behavior established by earlier
  versions must continue to work. The store does not get to "start fresh" because
  a schema was inconvenient. Compatibility is preserved by default and broken only
  through an explicit, safe, approved migration.
- **Prefer explicit behavior over magic.** Code should do what it plainly says it
  does. Hidden side effects, implicit conversions, and clever indirection are how
  reliable-looking systems produce surprising failures. When behavior is explicit,
  it can be read, reviewed, and trusted. Magic cannot be audited at the counter.
- **Fail safe.** When data is missing or an entity cannot be found, the correct
  response is a no-op and a clear, non-destructive message — never a blank default
  record, never a fabricated placeholder, never a guess that mutates state. The
  safe failure is the one that changes nothing.

---

## 9. Internationalization Philosophy

The product serves a multilingual customer and employee base, and this is a
first-class requirement, not a localization afterthought.

**Every user-visible string must exist in all three languages:**

- **English**
- **Spanish**
- **Portuguese**

There are **no exceptions.** A new label, button, header, toast, error message,
tooltip, or empty-state text is not complete until it exists in all three
languages. A missing translation is a bug the same as a broken button.

Additional standards:

- **Avoid slang.** Casual or trendy wording does not translate, dates quickly, and
  reads as unprofessional to some users. Keep UI text plain.
- **Avoid regional-only wording.** Prefer vocabulary that is understood across the
  whole language, not idioms specific to one country. In particular, Spanish must
  remain neutral and professional.
- **Professional language.** The words on screen are part of the commercial
  product. They should read as competent and clear, appropriate to software that
  handles a customer's money and data.

Internationalization is also a UX and reliability concern: an employee who cannot
read a screen makes mistakes on it. Trilingual coverage is how the product stays
usable and safe for everyone who touches it.

---

## 10. Commercial Philosophy

The product is built to be sold and to make its users money. That reality is a
design filter, not a footnote.

Every feature must answer one question:

> **How does this help the store make more money or save time?**

If a proposed feature makes money — through better pricing, less shrinkage, faster
turnaround, recovered revenue — it has a case. If it saves time — fewer clicks,
less re-entry, less waiting, less cleanup — it has a case. If it does **neither**,
its presence in the product is in question, and the burden is on the feature to
justify why it exists.

This filter protects the product from three common failure modes:

1. **Feature bloat** — capabilities added because they are possible, not because
   they are valuable. Every unused feature is surface area to maintain, test, and
   explain, paid for by every user forever.
2. **Developer-interest features** — things that are fun to build but do not serve
   the store. Interesting is not the bar. Useful to the business is the bar.
3. **Complexity creep** — each feature that does not clearly earn its place makes
   the whole product slower to learn, slower to run, and harder to keep reliable.

When evaluating any request, state plainly which outcome it serves — profit or
time — and how. If neither can be stated, escalate the question rather than
building on assumption.

---

## 11. Product Priorities

These are the current long-term priorities, in order. They express where
investment and attention are focused. They are a direction, not a frozen law —
priorities evolve as the business learns — but at this time this is the ranking,
and work should align to it.

1. **Intelligence** — the differentiator and the long-term vision (§5, §13). The
   assistant that helps run the business is where the product is headed.
2. **POS** — the core, highest-frequency workflow. Everything at the counter
   depends on it being fast and correct. It is foundational and must never
   regress.
3. **Inventory** — the backbone of a retail business and the source of truth that
   POS, Reports, and Intelligence all depend on.
4. **Repairs** — a defining workflow for this market. Repair shops live in this
   module; its ticket lifecycle and status accuracy are central.
5. **Customers** — the relationship layer. Customer history powers follow-ups,
   Intelligence, and repeat business.
6. **Reports** — how the owner sees the truth of the business. Must be accurate,
   deterministic, and trustworthy above all.
7. **LAN** — multi-device operation within a store. Lets a store run on more than
   one machine reliably and locally.
8. **Companion** — the mobile extension that lets an owner or manager observe and
   act away from the counter.
9. **Global Cart** — the architectural direction of a sale that follows the user
   anywhere in the app (§4), reducing navigation friction.
10. **Anywhere Scanner** — scanning that resolves items, tickets, and customers
    from any context (§4), making the fastest input method universally available.

The ordering communicates trade-offs: when two efforts compete for attention, the
higher-priority one generally wins, and nothing lower on the list justifies
destabilizing something higher. Intelligence leads the vision; POS, Inventory, and
Repairs are the load-bearing floor beneath it.

---

## 12. AI Developer Rules

This section is addressed directly to any AI coding assistant that receives this
repository. Follow it literally.

**Reading order — mandatory:**

1. **Read `PRODUCT-BIBLE.md` first** — this document. Understand *why* the product
   exists and the principles above before touching anything.
2. **Read `CHATGPT-ONBOARDING.md` second** — the *how*: stack, architecture,
   directory map, canonical patterns, and the hard technical rules.
3. **Only then begin coding.**

**Never violate either document.** Where a task appears to conflict with these
documents, stop and raise the conflict. Do not silently choose the task over the
principles; the principles were paid for in production incidents.

**When in doubt — the tie-breakers, in order:**

- **Preserve behavior.** A working flow is a contract with a live business. If you
  are unsure whether a change alters existing behavior, assume it might, and
  choose the option that does not.
- **Write less code.** The smaller change is the safer change. Prefer the diff that
  touches the fewest lines, files, and systems to correctly solve the problem.
- **Follow existing architecture.** Extend what is there. Reuse the established
  patterns and handlers. Do not introduce a second way to do something the project
  already does.
- **Commercial reliability always wins.** When elegance, cleverness, or
  convenience conflict with reliability for a real store, reliability wins every
  time, without exception.

Practical expectations for every change:

- State, before editing, which principles and rules apply, what could be affected
  (blast radius), and what you are intentionally not touching.
- Keep AI out of the calculation path — never let generated logic compute money,
  tax, stock, or accounting figures (§5).
- Keep every new user-facing string trilingual (§9).
- Validate before claiming done; never present reasoned-but-untested work as
  verified. (See `CHATGPT-ONBOARDING.md` for the exact validation commands.)

If a request cannot be satisfied without violating this document, the correct
output is not code — it is a clear explanation of the conflict and a safer
alternative.

---

## 13. Future Vision

CellHub Pro is on a deliberate trajectory. Each stage is a superset of the last,
and each is built on the same non-negotiable foundation: a deterministic,
reliable, local-first core that never puts the store's money or data at risk.

```
        POS
         │   records transactions accurately and fast
         ▼
Business Operating System
         │   runs the whole store — inventory, repairs, customers,
         │   reports, staff — as one coherent environment
         ▼
   AI Store Manager
         │   watches the business and advises the owner:
         │   recommends, detects, predicts, warns, summarizes,
         │   prioritizes — while deterministic code still executes
         │   every financial and inventory decision
         ▼
Autonomous Retail Assistant
             handles the repetitive operational load on its own,
             within strict deterministic guardrails, so the owner
             manages exceptions and strategy instead of routine work
```

The direction is unmistakable: the software should eventually help **run** the
business, not merely **record** it. Today it records transactions correctly.
Tomorrow it manages the store's routine operations and tells the owner what
matters. That progression is the reason the discipline in this document exists —
you cannot build an autonomous assistant on top of a system the owner cannot
trust with a single receipt.

Every stage forward is earned by never regressing the stage beneath it. The
Intelligence layer only becomes a manager because the deterministic core beneath
it is perfectly reliable. The assistant only becomes autonomous because the
guardrails around it are absolute. Advance the vision, but never at the cost of
the foundation — the foundation *is* the product's right to exist.

---

*End of Product Bible. This document and `CHATGPT-ONBOARDING.md` together are the
canonical brief for anyone — human or AI — working on CellHub Pro. Read both
before writing code. When they speak, they override convenience.*
