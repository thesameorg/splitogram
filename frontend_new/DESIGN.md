# Design System Strategy: The Ethereal Ledger

## 1. Overview & Creative North Star
The core philosophy of this design system is **"The Ethereal Ledger."** We are moving away from the heavy, rigid structures of traditional financial apps and toward a UI that feels like light passing through a prism—precise, airy, yet authoritative. By blending Telegram’s native agility with a high-end editorial aesthetic, we create an experience where data doesn’t just sit on a screen; it floats within a curated space.

The system breaks the "template" look through **intentional asymmetry** and **tonal depth**. We prioritize legibility and professional utility, ensuring that every transaction and balance feels significant. This is achieved not through heavy lines, but through sophisticated layering and the strategic use of "Diamond Blue" to guide the eye.

---

## 2. Color Architecture
Our palette is a dual-natured ecosystem designed for high-performance financial tracking.

### The "No-Line" Rule
To achieve a premium, custom feel, **1px solid borders are strictly prohibited** for sectioning. Boundaries must be defined solely through:
- **Background Color Shifts:** Use `surface-container-low` against a `surface` background to define a region.
- **Tonal Transitions:** Use subtle shifts in luminance to separate content blocks.

### Surface Hierarchy & Nesting
Treat the UI as a physical stack of materials. 
- **Light Mode Strategy:** Utilize a crisp off-white base (`#F4F4F5`) with high-transparency glass surfaces. 
- **Dark Mode Strategy:** Utilize the deep charcoal base (`#131315`) with vibrant, glowing accents.
- **Nesting:** Place `surface-container-highest` elements inside `surface-container-low` areas to draw immediate focus to critical data points.

### The "Glass & Gradient" Rule
Floating elements (modals, FABs, and navigation bars) must utilize **Glassmorphism**. Use semi-transparent surface colors with a `backdrop-filter: blur(20px)`. 
- **Signature Texture:** Primary CTAs should use a subtle linear gradient from `primary` (#92CCFF) to `primary_container` (#2B98DD) at a 135-degree angle to provide a "jeweled" depth that flat colors lack.

---

## 3. Typography: The Manrope Scale
We use **Manrope** to maintain a "Telegram-native" feel while elevating it through aggressive hierarchical shifts.

- **Display (lg/md):** Reserved for total balances or high-impact financial summaries. These should feel like a headline in a luxury magazine—spaced with intentionality.
- **Headline (sm/md):** Used for section headers. These drive the "Ledger" feel—clean, geometric, and authoritative.
- **Title & Body:** The workhorses. `title-md` is for transaction names; `body-md` is for descriptions. 
- **Label (sm/md):** Used for metadata (timestamps, status tags). These should be treated with slightly wider letter-spacing (0.05rem) to ensure clarity at small sizes.

*Editorial Note: Use `on-surface-variant` for secondary information to ensure the primary data (in `on-surface`) "pops" against the ethereal background.*

---

## 4. Elevation & Depth
In "The Ethereal Ledger," depth is perceived, not forced.

### The Layering Principle
Avoid the standard "box-on-box" look. Instead, use the **Surface-Container Tiers**:
1. **Base:** `surface`
2. **Sub-sections:** `surface-container-low`
3. **Interactive Cards:** `surface-container-highest`

### Ambient Shadows
Shadows must never be "dirty" or grey. 
- **Light Mode:** Use a `10%` opacity shadow tinted with `primary` (#0088CC). Values: `0px 10px 30px rgba(0, 136, 204, 0.08)`.
- **Dark Mode:** Shadows are replaced by "Glows." Use a `surface-bright` outer glow or a very soft `primary` bloom to suggest elevation.

### The "Ghost Border" Fallback
If a separation is required for accessibility, use a **Ghost Border**: the `outline-variant` token at **15% opacity**. Never use a 100% opaque stroke.

---

## 5. Components

### Buttons
- **Primary:** Gradient fill (`primary` to `primary_container`), `ROUND_EIGHT` (0.5rem) corners. Text is `on_primary`. 
- **Secondary:** Glassmorphic background (semi-transparent `surface_variant`) with a `primary` text color.
- **Tertiary:** No background. Bold `primary` label with a subtle hover state using `surface_container_high`.

### Input Fields
- Avoid full-enclosure boxes. Use a `surface-container-highest` fill with a bottom-only "Ghost Border."
- Helper text must use `label-sm` in `on-surface-variant`.

### Cards & Financial Lists
- **Strict Rule:** No dividers. 
- Use **vertical white space** (Spacing scale `4` or `6`) to separate list items. 
- For high-priority items, use a background shift to `surface-container-lowest` to "indent" the item into the background.

### Chips (Transaction Tags)
- Use `secondary_container` with `on_secondary_container` text.
- Shape: Always `full` (pill) to contrast against the `ROUND_EIGHT` layout logic.

---

## 6. Do's and Don'ts

### Do
- **Do** use `primary_fixed_dim` for icons in dark mode to prevent visual vibration.
- **Do** leverage the spacing scale `12` and `16` for "editorial" breathing room between major sections.
- **Do** use `9999px` (Full Roundness) for interactive toggles and status indicators to differentiate from structural containers.

### Don't
- **Don't** use pure black (#000000) or pure white (#FFFFFF). Stick to the `surface` and `background` tokens to maintain the "Ethereal" tone.
- **Don't** use standard "drop shadows." If an element needs to feel elevated, use tonal layering first.
- **Don't** crowd the interface. If a screen feels full, increase the spacing scale and move less critical data to a secondary layer/modal.

---

## 7. Tokens Reference Summary

| Role | Token / Value |
| :--- | :--- |
| **Base Radius** | `ROUND_EIGHT` (0.5rem / 8px) |
| **Typography** | Manrope (Variable) |
| **Light BG** | `#F4F4F5` |
| **Dark BG** | `#131315` |
| **Primary Accent** | `#92CCFF` (Dark) / `#0088CC` (Light) |
| **Glass Blur** | `20px` |
| **Ghost Border** | `outline_variant` @ 15% opacity |