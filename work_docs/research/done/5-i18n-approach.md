# i18n Approach

**Phase:** 5
**Type:** RESEARCH → decision
**Status:** open

---

## Context

Need to support English (base), Russian, Spanish. More languages possible later.

Requirements:

- All UI text from translation files (no hardcoded strings)
- Missing translation in dev: show raw key (e.g., `ACCOUNT_DESCRIPTION`). In production: fall back to English.
- Language switchable from Account page, persists (see `themes-and-persistence.md`)
- Default language detected from Telegram's `language_code`

## Options to evaluate

### A: Custom lightweight JSON lookup

```
/frontend/src/i18n/
  en.json    — {"home.title": "Groups", "home.balance": "Total balance"}
  ru.json    — {"home.title": "Группы", "home.balance": "Общий баланс"}
  es.json    — {"home.title": "Grupos", "home.balance": "Balance total"}
  index.ts   — t('home.title') function, reads current locale, returns string or key
```

- **Pro:** zero dependencies, tiny bundle, full control, simple
- **Con:** no plurals, no interpolation (unless we add it), no tooling for translators
- **Effort:** ~2h to build

### B: react-i18next

- Industry standard React i18n library
- Supports plurals, interpolation, namespaces, lazy loading
- **Pro:** battle-tested, handles edge cases (plurals in Russian are complex), translator-friendly
- **Con:** dependency (~15KB gzipped for i18next + react-i18next), more setup, heavier API
- **Effort:** ~1h to set up, but more structured long-term

### C: Lightweight alternative (e.g., `typesafe-i18n`, `rosetta`)

- Smaller than react-i18next but more features than raw JSON
- **Pro:** type-safe keys, small bundle
- **Con:** less ecosystem, fewer examples

## Research tasks

- [ ] Do we need pluralization? Russian has 3 plural forms (1, 2-4, 5+). Check if any current UI text needs plurals.
- [ ] Do we need interpolation? (e.g., "You owe {name} {amount}") — check current codebase for dynamic strings.
- [ ] Check react-i18next bundle size impact on our frontend
- [ ] Check if `typesafe-i18n` supports our use case
- [ ] How many translatable strings do we currently have? (rough count)

## Research Answers

1. **Pluralization needed?** Yes. Already have "member/members" with ternary. Russian has 3 plural forms (1 участник, 2 участника, 5 участников) — can't do with a simple ternary. i18next handles this via CLDR rules.
2. **Interpolation needed?** Heavily. ~20+ dynamic strings: "You owe {name} {amount}", "Paid by {name}", "{count} members", time ago strings, invite links, confirm dialogs, error messages.
3. **react-i18next bundle size:** ~15KB gzipped (i18next core + react-i18next). Negligible for an app already loading React (~40KB) + Tailwind.
4. **typesafe-i18n:** Viable but smaller ecosystem, fewer examples for Russian plural handling, less translator tooling.
5. **String count:** ~80-120 unique user-visible strings across 6 pages (Home, Group, GroupSettings, AddExpense, SettleUp, Account). Heaviest: GroupSettings and Group.

## Decision

**react-i18next (Option B).**

Reasons:

- Russian plurals (3 forms) handled correctly out of the box via CLDR — building this from scratch is error-prone
- Heavy interpolation throughout the app — i18next's `{{variable}}` syntax is clean and safe
- 15KB gzipped is nothing for our app
- ~1h setup, battle-tested, well-documented
- Standard JSON format — any translation tool can import/export
- Option A (custom) would need plurals + interpolation added manually (~4-6h for something worse)
- Option C (typesafe-i18n) has smaller ecosystem and weaker Russian plural support
