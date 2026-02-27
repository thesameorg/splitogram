# Phase 2: Splitwise Polish — Todo Tracker

Work order. Each file is a work stream. Do them roughly in this order:

## Execution Order

### Wave 1: Stop the bleeding (1-2 days)
1. **[00-critical-bugs.md](00-critical-bugs.md)** — PAGES_URL, creditor settle, join query, language_code, bot message

### Wave 2: Technical foundation (1-2 days)
2. **[01-tech-debt.md](01-tech-debt.md)** — N+1 queries, balance dedup, types, formatAmount, dead code

### Wave 3: Core features (parallel streams, ~1 week)
3. **[02-manual-settlement.md](02-manual-settlement.md)** — Settlement rework (either party can settle, remove crypto UI)
4. **[03-expense-management.md](03-expense-management.md)** — Edit and delete expenses
5. **[04-group-currency.md](04-group-currency.md)** — Per-group currency with correct display

### Wave 4: Management & polish (~1 week)
6. **[05-group-management.md](05-group-management.md)** — Settings, delete group, leave group, owner indicator
7. **[06-ux-fixes.md](06-ux-fixes.md)** — Labels, buttons, deep links, type safety
8. **[07-notifications.md](07-notifications.md)** — Noise reduction, bot 403 handling

### Wave 5: Quality gate
9. **[08-frontend-tests.md](08-frontend-tests.md)** — Tests for utilities, hooks, components

## Success Criteria (from PLAN.md)

- Full cycle: create group → invite friends → add expenses → see balances → settle manually → clean slate
- Tested with 3+ real people
- Zero broken bot interactions
- UX on par with Splitwise basic functionality

## Dependencies

- Settlement rework (02) depends on critical bugs (00) — specifically C2
- Group currency (04) depends on formatAmount refactor (01-T4)
- Group management (05) can run parallel with settlement (02) and expenses (03)
- UX fixes (06) overlap with other streams — some will be fixed as part of 02/03/05
