# Viral UX Plan — Task Breakdown

Analysis of `viral-ux-plan.md` tasks against current codebase. Estimates based on actual code structure.

## Phase A — Quick Wins (Low invasiveness, no DB changes) ✅ DONE

| #   | Task                             | SP  | Status | Changes                                                                                      |
| --- | -------------------------------- | --- | ------ | -------------------------------------------------------------------------------------------- |
| 1   | Post-creation invite nudge       | 2   | ✅     | Auto-opens TG share dialog on `?created=1`. Nudge card as fallback. Empty state shows invite. |
| 2   | Better bot reply on join         | 1   | ✅     | Join notification includes member count ("— N members now").                                  |
| 3   | Better share text (member count) | 2   | ✅     | Emoji, concise copy, member count on new line (2+ only).                                      |
| 4   | First-time user welcome          | 2   | ✅     | FAB pulses when `showWelcomeBanner` active. Banner simplified (FAB is CTA).                   |

## Phase B — Engagement & Social Pressure

| #   | Task                                        | SP  | Invasiveness | Decompose?                                                                                                                       |
| --- | ------------------------------------------- | --- | ------------ | -------------------------------------------------------------------------------------------------------------------------------- |
| 11  | Split Roulette                              | 3   | Low          | No — pure client-side using existing balance data                                                                                |
| 6   | Random placeholder names + claim deep links | 5   | Medium       | Yes: (a) name generator util, (b) wire into placeholder API, (c) bot `claim_X_Y` handler, (d) frontend deep link, (e) claim UI   |
| 10  | Expense emoji reactions                     | 5   | Medium       | Yes: (a) new `expense_reactions` table + migration, (b) API endpoints, (c) reaction picker UI, (d) counts on expense items       |
| 12  | Debt birthday reminders                     | 5   | Medium       | Yes: (a) Cron Trigger (new infra primitive), (b) milestone tracking table, (c) notification messages, (d) `wrangler.toml` config |

## Phase C — Shareable Content

| #   | Task                         | SP  | Invasiveness | Decompose?                                                                                                        |
| --- | ---------------------------- | --- | ------------ | ----------------------------------------------------------------------------------------------------------------- |
| 5   | Post-settlement share moment | 2   | Low          | No                                                                                                                |
| 7   | Shame Board leaderboard      | 5   | Medium       | Yes — depends on task 8's Canvas renderer                                                                         |
| 8   | IOU receipt shareable card   | 8   | High         | Yes: (a) Canvas card renderer (new `shareCard.ts`), (b) share button on expense detail, (c) i18n                  |
| 9   | Trip Wrap summary            | 13  | High         | Yes: (a) new `/wrap` API, (b) all-settled detection, (c) animated card component, (d) Canvas export, (e) i18n ×11 |

## Phase D — Platform Integration

| #   | Task                       | SP  | Invasiveness | Decompose?                                                                                                                                             |
| --- | -------------------------- | --- | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 14  | Group chat bot integration | 13  | High         | Yes: (a) group message reception, (b) `/split` command, (c) `group_chat_id` migration, (d) auto-post expenses to chat, (e) deep links back to Mini App |

## Cross-Cutting Concerns

1. **Canvas renderer is a shared dependency** — Tasks 5, 7, 8, 9 all need shareable visual cards. Build `shareCard.ts` with task 8 first, then reuse.
2. **Cron Trigger is new infra** — Task 12 is the only item needing it. First scheduled job in the codebase, needs `wrangler dev --test-scheduled` for local testing.
3. **Task 6's claim deep link partially duplicates join flow** — Extract a shared `ensureUserExists()` helper to avoid copy-pasting the upsert block.
4. **i18n overhead** — Every feature touches 11 locale files. Budget ~30-45 min per feature just for translations.
5. **Phase A is zero-risk** — No migrations, no new tables, pure UI/copy. Ship as a single PR.

## Recommended Order

Phase A (all 4 as one PR) → 11 → 5 → 8 → 6 → 10 → 7 → 12 → 9 → 14

**Total: ~66 story points**
