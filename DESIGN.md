---
name: TaskGlass
description: Aqua Lab, the visual system for designing, running, and auditing annotation experiments.
colors:
  deep-ocean-ink: "#102a32"
  tide-slate: "#60767b"
  lagoon-teal: "#087796"
  lagoon-teal-deep: "#05627d"
  shallows-cyan: "#30afff"
  spray-cyan: "#92eeff"
  kelp-mint: "#23745d"
  kelp-mint-wash: "#c4f7ca"
  sea-glass-mint: "#d8ffc5"
  gold-standard-amber: "#b97812"
  gold-standard-wash: "#fff5d9"
  coral-alert: "#b83e47"
  coral-alert-wash: "#fff0f1"
  salt-white: "#f6fafa"
  shoal: "#eef8f8"
  pure-white: "#ffffff"
  waterline: "#dce9e9"
  glass-edge: "#e4eeee"
typography:
  display:
    fontFamily: "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif"
    fontSize: "clamp(2.3rem, 6vw, 4.7rem)"
    fontWeight: 600
    lineHeight: 0.98
    letterSpacing: "-0.025em"
  headline:
    fontFamily: "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif"
    fontSize: "2.5rem"
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: "-0.025em"
  title:
    fontFamily: "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif"
    fontSize: "1.75rem"
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: "-0.025em"
  body:
    fontFamily: "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif"
    fontSize: "0.95rem"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif"
    fontSize: "0.78rem"
    fontWeight: 700
    letterSpacing: "0.05em"
  data-mono:
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace"
    fontSize: "0.82rem"
    fontWeight: 400
rounded:
  xs: "6px"
  sm: "8px"
  md: "10px"
  lg: "12px"
  xl: "14px"
  pill: "999px"
spacing:
  xs: "8px"
  sm: "12px"
  md: "16px"
  lg: "24px"
  xl: "40px"
components:
  button-primary:
    backgroundColor: "{colors.lagoon-teal}"
    textColor: "{colors.pure-white}"
    rounded: "{rounded.sm}"
    padding: "10px 20px"
  button-primary-hover:
    backgroundColor: "{colors.lagoon-teal-deep}"
    textColor: "{colors.pure-white}"
  button-secondary:
    backgroundColor: "transparent"
    textColor: "{colors.deep-ocean-ink}"
    rounded: "{rounded.sm}"
    padding: "10px 20px"
  button-danger:
    backgroundColor: "{colors.coral-alert}"
    textColor: "{colors.pure-white}"
    rounded: "{rounded.sm}"
    padding: "10px 20px"
  input:
    backgroundColor: "{colors.pure-white}"
    textColor: "{colors.deep-ocean-ink}"
    rounded: "{rounded.sm}"
    padding: "12px 16px"
  panel:
    backgroundColor: "{colors.pure-white}"
    rounded: "{rounded.xl}"
    padding: "24px"
  chip-metadata:
    backgroundColor: "{colors.shoal}"
    textColor: "{colors.tide-slate}"
    rounded: "{rounded.pill}"
    padding: "5px 9px"
  chip-gold:
    backgroundColor: "{colors.gold-standard-wash}"
    textColor: "{colors.gold-standard-amber}"
    rounded: "{rounded.pill}"
    padding: "5px 9px"
  chip-status-active:
    backgroundColor: "{colors.sea-glass-mint}"
    textColor: "{colors.kelp-mint}"
    rounded: "{rounded.pill}"
    padding: "4px 9px"
  selectable-card:
    backgroundColor: "{colors.pure-white}"
    textColor: "{colors.deep-ocean-ink}"
    rounded: "{rounded.lg}"
    padding: "16px"
  nav-link:
    textColor: "{colors.deep-ocean-ink}"
    rounded: "{rounded.sm}"
    padding: "9px 13px"
  nav-link-primary:
    backgroundColor: "{colors.lagoon-teal}"
    textColor: "{colors.pure-white}"
    rounded: "{rounded.sm}"
    padding: "9px 13px"
---

# Design System: TaskGlass

## Overview

**Creative North Star: "The Clear Instrument"**

TaskGlass is lab glassware for human data: a calm, precise vessel the designer looks *through* to see the work, not *at*. The interface is white and quiet, with a cool mineral cast, and the data is always the subject: waveforms, images, label regions, sample tables, agreement scores. The chrome stays thin and measured so these readings stay legible. Color appears only when it means something: cyan for where you are acting, mint for what has passed, amber for gold-standard reference, and coral for what will cost you data.

The density is that of a working instrument, not a brochure. Tables, wizards and dashboards are packed with real readings (counts, scores with their N, statuses), set in Inter at modest sizes with small uppercase labels that index the data. Components feel friendly and tactile: gently rounded corners, a soft ambient float on panels, and a small lift with a cyan halo on interaction. Movement is short (0.2s) and settles without bounce.

The marketing landing page (`frontend/src/components/landing/`) is a deliberate variant called the **Product Sheet**. It shares the palette but is set in Courier monospace, with square 1.5px ink rules, figure numbering ("Fig. 01"), and a hard 7px offset shadow, like a printed instrument spec sheet. It does not feed back into the app. App, catalog, annotator and dashboard screens follow Aqua Lab.

**Key Characteristics:**
- White surfaces over a salt-white ground, with faint cyan and mint light pooling at the edges of the viewport.
- One action color (Lagoon Teal) for commits and one interaction color (Shallows Cyan) for focus, selection and current position.
- Semantic color is reserved: mint means passed or active, amber means gold data or locked, coral means destructive or invalid.
- Gently rounded corners (8–14px) and pill-shaped chips.
- Quiet lift: ambient shadows on panels, with lift and glow only in response to interaction.

## Colors

A cool, mineral palette: one deep ink, two cyans and one teal for interaction, and three reserved semantic hues.

### Primary
- **Lagoon Teal** (`lagoon-teal`): the commit color. It fills primary buttons, primary nav links, checkbox/radio accents, eyebrows, sample numbers, and catalog links. Use it when the user is about to make something happen.
- **Lagoon Teal Deep** (`lagoon-teal-deep`): the hover/pressed state of Lagoon Teal, and dark text on cyan-tinted selections.

### Secondary
- **Shallows Cyan** (`shallows-cyan`): the "you are here" color. It covers focus borders, the current wizard step, selected card borders, annotator drawing regions and spatial shapes, and the 3–4px focus halo (at 14–18% alpha).
- **Spray Cyan** (`spray-cyan`): a highlight wash, always used at low alpha (10–38%). It tints selected cards, hovered rows, label chips, nav hover, and the ambient glow in the top-right of the page background.

### Tertiary (semantic, reserved)
- **Kelp Mint** (`kelp-mint`) on **Kelp Mint Wash** / **Sea Glass Mint**: completed wizard steps, "ready" validation, active annotators. Sea Glass Mint also tints the ambient glow on the left of the page background.
- **Gold Standard Amber** (`gold-standard-amber`) on **Gold Standard Wash**: gold-answer panels, gold chips, locked-setting chips and notices, warning toasts, and "Coming soon" badges. Its borders use a warmer straw (#ecd79f / #e4bd68).
- **Coral Alert** (`coral-alert`) on **Coral Alert Wash**: invalid dataset rows, form errors, paused annotators, the danger zone, and delete confirmation. Its borders use #efc8cc, and its hover darkens to #96313a.

### Neutral
- **Deep Ocean Ink** (`deep-ocean-ink`): all primary text and headings. It is never pure black.
- **Tide Slate** (`tide-slate`): secondary text, paragraph copy, help text, table headers, and metadata. Placeholder text is a lighter #8ca0a4.
- **Salt White** (`salt-white`): the page ground.
- **Shoal** (`shoal`): sunken surfaces such as table header rows and metadata chips.
- **Pure White** (`pure-white`): panels, cards, inputs and tables. The app sits on white.
- **Waterline** (`waterline`): the default 1px border on inputs, cards, tables and dividers.
- **Glass Edge** (`glass-edge`): the slightly lighter border on elevated panels.

### Named Rules
**The Reserved Amber Rule.** Amber means gold-standard reference data, or something the system has locked to protect it. Never use amber for decoration, brand emphasis or generic "warning yellow" that has nothing to do with gold or locks.

**The Two Cyans Rule.** Lagoon Teal commits and Shallows Cyan indicates. A filled button is teal. A focus ring, current step or selected border is cyan. Don't swap them.

## Typography

**Body Font:** Inter (400/500/600/700, loaded from Google Fonts, falling back to the system UI stack)
**Data/Mono Font:** ui-monospace (SFMono-Regular, Menlo), used only for gold-answer JSON, code inputs and anonymous IDs

**Character:** a single neutral sans that stays out of the way of the data, with weight and small uppercase labels doing the work of hierarchy.

### Hierarchy
- **Display** (600, clamp(2.3rem, 6vw, 4.7rem), 0.98): catalog hero headings only.
- **Headline** (600, 2.5rem, 1.2, -0.025em): page-level h1.
- **Title** (600, 1.75rem, 1.2, -0.025em): section h2, panel titles, and wizard step titles.
- **Body** (400, 0.95rem, 1.5): inputs, buttons (at 500), and running copy in Tide Slate. Dense surfaces drop to 0.82–0.9rem for tables, card descriptions and help text.
- **Label** (700, 0.78rem, +0.05em, uppercase, Lagoon Teal): sample numbers, annotation labels, eyebrows and card kickers. Catalog eyebrows push to 800 weight and +0.14em.

### Named Rules
**The Index Label Rule.** Small, uppercase, tracked, teal labels index the data ("SAMPLE 12", "STEP 3"). They identify things; they are not headings, and they are never more than one line.

## Layout

Content sits in centered columns: 1000px for the app container and wizard, 1100–1160px for profile and catalog, with 40px top and 20px side padding. A sticky, translucent white header (92% white, 8px backdrop blur) spans the full width with 20px × 40px padding.

Spacing follows a loose 8-based rhythm: 8px gaps inside groups, 10–12px between sibling cards in a grid, 16–20px between form groups, 24px panel padding, and 28px below page headings. Grids are explicit: six columns for the wizard steps, four for the dataset summary, three for access modes and catalog cards, and auto-fit with a 160px minimum for choice options.

Responsive breakpoints are 900px (catalog grids go from 3 to 2 columns), 700px, and 560–620px (grids collapse to a single column, and heading rows stack). Wide data tables keep a minimum width (850px) and scroll horizontally inside a rounded wrapper rather than squeezing columns.

## Elevation & Depth

Elevation is a quiet lift. Content panels float slightly above the salt-white ground on a wide, faint ambient shadow, which is enough to separate them from the page without competing with the content. Lift and glow belong to interaction: buttons rise 1px and gain a cyan halo on hover, and catalog cards rise 3px and deepen their shadow. Overlays such as toasts reuse the panel shadow.

### Shadow Vocabulary
- **Ambient Low** (`box-shadow: 0 2px 8px rgba(16, 42, 50, 0.07)`): primary buttons at rest, catalog cards and modality buttons.
- **Ambient Panel** (`box-shadow: 0 12px 32px rgba(16, 42, 50, 0.08)`): glass panels, hovered catalog cards, and warning toasts.
- **Cyan Halo** (`box-shadow: 0 0 0 4px rgba(48, 175, 255, 0.14)`): hover on primary buttons, and focus on catalog search and modality buttons. Inputs use a 3px variant at 18% alpha.

### Named Rules
**The Ink-Tinted Shadow Rule.** Shadows are tinted with Deep Ocean Ink (rgba 16, 42, 50), never neutral black, and stay at or below 8% alpha.

## Shapes

The form language is gently rounded and friendly: 6px for inline table inputs, 8px for buttons, inputs, nav links and choice options, 10px for rows, tables and task cards, 12px for selectable access cards, toasts and confirmation blocks, and 14px for top-level panels and catalog cards. Larger containers get rounder corners. Chips, statuses and badges are full pills (999px), and wizard step markers are 26px circles. Borders are always 1px (Waterline, or the semantic border of the surface's state). A dashed border means "not available yet" (Coming soon cards).

## Components

### Buttons
Friendly and tactile, with a soft press-ready lift.
- **Shape:** gently rounded (8px), with a 10px × 20px pad, Inter 500 at 0.95rem, and an 8px gap for a leading icon.
- **Primary:** Lagoon Teal fill with white text and Ambient Low.
- **Hover / Focus:** darkens to Lagoon Teal Deep, rises 1px, and gains the Cyan Halo (0.2s ease).
- **Secondary:** transparent fill, ink text, and a Waterline border. Hover tints Spray Cyan at 24% with a #9bddea border.
- **Danger:** Coral Alert fill with white text. Hover darkens to #96313a and lifts 1px.
- **Disabled:** 50% opacity, with no lift or shadow.

### Chips
- **Metadata:** Shoal fill with Tide Slate text, as a pill at 0.78rem.
- **Gold / Locked:** Gold Standard Wash fill with Amber text, 700 weight for locks.
- **Status:** Active is mint on Sea Glass Mint. Paused and error are coral on Coral Alert Wash. Ready is Kelp Mint on Kelp Mint Wash.
- **Label (editable):** Spray Cyan at 38% with #15546a text, a pill with an inline remove button.

### Cards / Containers
- **Glass Panel:** white, a 1px Glass Edge border, 14px corners, a 24px pad, and Ambient Panel.
- **Selectable Card** (access modes, task types): white, a Waterline border, and 10–12px corners. Hover gets a cyan border and a faint cyan wash. Selected gets a Lagoon Teal border, a 1px inset ring of the same color, and a Spray Cyan wash at 17–24%.
- **Semantic Blocks:** gold-answer, lock-notice and warning-toast blocks use Gold Wash with straw borders. Delete confirmation uses Coral Wash with coral borders. All are 10–12px.

### Inputs / Fields
- **Style:** a white field with a 1px Waterline border, 8px corners, a 12px × 16px pad, and ink text with #8ca0a4 placeholders.
- **Focus:** the border shifts to Shallows Cyan with a 3px cyan halo at 18%. There is no outline, because the halo is the focus indicator.
- **Error:** coral text below the field. Invalid table rows get a Coral Wash background.
- **Mono variant:** gold-answer and code cells use the data-mono font.

### Navigation
- **Header:** sticky, translucent white, blurred, with a Waterline bottom border and the logo in ink at 1.25rem/700 with a teal icon.
- **Nav links:** bordered 8px pills at 9px × 13px and 0.9rem. Hover gets a Spray Cyan wash. The primary link is Lagoon Teal filled.

### Wizard Stepper (signature)
Six equal columns, each with a 26px circular marker and a 0.82rem label. The current step is a filled Shallows Cyan circle with dark text (#082b36), and complete steps are Sea Glass Mint circles with Kelp Mint numerals. Upcoming steps are outlined in Waterline with Tide Slate text.

### Dataset Preview Table (signature)
A table that scrolls horizontally inside a 10px rounded Waterline frame. The header is sticky, with a Shoal background and Tide Slate text. Cells are 0.82rem with 10px padding and hold inline media players, editable inputs and mono gold cells. Hover tints rows cyan, and invalid rows turn coral with an inline error under the cell.

### Annotation Overlays (signature)
Annotator regions and spatial shapes are drawn in Shallows Cyan with translucent cyan fills. The landing page's figures draw gold references as Amber dashed ranges. The app does not yet overlay gold on media, so if it is added on designer or review surfaces, follow the same mapping: cyan for annotators, amber for gold.

## Do's and Don'ts

### Do:
- **Do** keep the data the loudest thing on screen, with chrome in white, Waterline and Tide Slate.
- **Do** use Lagoon Teal (#087796) for every committing action and Shallows Cyan (#30afff) for focus, selection and current position.
- **Do** pair every semantic color with its wash: mint text on mint wash, amber on gold wash, coral on coral wash.
- **Do** let larger containers have rounder corners (8 → 10 → 12 → 14px) and keep chips as full pills.
- **Do** tint shadows with Deep Ocean Ink at ≤8% alpha, and reserve lift and glow for interaction.
- **Do** keep the landing page's Product Sheet look (Courier, square ink rules, figure numbers) on marketing surfaces only.

### Don't:
- **Don't** use amber for anything other than gold-standard data, locked settings, or warnings tied to them.
- **Don't** visually mark gold items on annotator screens. Amber gold styling is for designer and review surfaces only.
- **Don't** bring Courier, square corners or hard offset shadows into the app, catalog or annotator screens.
- **Don't** use pure black text or neutral-gray shadows. Ink is #102a32.
- **Don't** add bounce, spring or long easing. State changes are 0.2s ease, and entrance fades are ≤0.4s.
