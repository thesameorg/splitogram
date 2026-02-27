# Frontend Tests

Priority: **Medium**. Should be done during Phase 2 to prevent regressions as features are added.

---

## FT1. Unit tests for utilities

- `formatAmount` edge cases: zero, negative, large values, currency formatting
- Deep link parsing logic (extract from App.tsx into a testable function)
- Any date/time formatting utilities

---

## FT2. Hook tests

- `useAuth` state transitions: loading → authenticated → error
- Back button hook behavior
- Main button hook behavior

---

## FT3. Component tests (when time permits)

- Expense list rendering with various data shapes
- Balance display (positive, negative, zero)
- Settlement status indicators

---

## Setup

Vitest + `@testing-library/react` already installed. Just need test files.

Convention: `*.test.tsx` co-located with components, or `__tests__/` directory — match backend pattern.
