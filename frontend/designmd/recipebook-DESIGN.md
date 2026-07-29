# RecipeBook Design System

## Overview

RecipeBook is a homey, step-by-step design system tailored for recipe sharing and cooking instruction platforms. It emphasizes clarity in ingredient lists and sequential cooking steps. The warm, natural color palette and rounded components create a welcoming kitchen-table feel that encourages users to explore, save, and share recipes.

---

## Colors

- **Primary** (#65A30D): Primary actions, step numbers
- **Secondary** (#DC2626): Favorites, hearts, alerts
- **Tertiary** (#FEF9C3): Tip highlights, background tint
- **Background** (#FFFBF5): Page background (warm)
- **Surface** (#FFFFFF): Recipe cards, modals
- **Success** (#059669): Step complete, saved
- **Warning** (#D97706): Allergy warnings
- **Error** (#EF4444): Missing ingredient, error
- **Info** (#2563EB): Tips, chef's notes

## Typography

- **Headline Font**: Merriweather
- **Body Font**: Nunito
- **Mono Font**: JetBrains Mono

- **h1**: 32px black, 40px line height. Recipe title.
- **h2**: 24px bold, 32px line height. Section headings.
- **h3**: 20px bold, 28px line height. Subsections.
- **h4**: 16px bold, 24px line height. Ingredient groups.
- **body**: 15px regular, 24px line height. Instructions, desc.
- **small**: 13px regular, 20px line height. Prep time, servings.
- **mono**: 14px regular, 20px line height. Measurements, timers.

---

## Spacing

Base unit: **8px**
- **xs**: 4px — Tag gaps, tight inline
- **sm**: 8px — Between ingredients
- **md**: 16px — Card padding, step gaps
- **lg**: 24px — Section spacing
- **xl**: 32px — Card padding (large)
- **2xl**: 48px — Page section spacing
- **3xl**: 64px — Hero/layout margins

## Border Radius

- **None** (0px): —
- **sm** (4px): Chips, small elements
- **md** (8px): Cards, buttons, inputs
- **lg** (12px): Modals, image containers
- **full** (9999px): Step number circles, pills

## Elevation

Subtle shadows for a warm, inviting feel.
- **sm**: 1px offset, 3px blur, #000000 at 5%. Inputs, chips.
- **md**: 2px offset, 8px blur, #000000 at 8%. Recipe cards.
- **lg**: 4px offset, 16px blur, #000000 at 10%. Modals, lightbox.
- **focus**: 3px ring #65A30D at 25%. Focus ring.

## Components

### Buttons
#### Variants
- ****Primary****: #65A30D fill, #FFFFFF text, no border, #4D7C0F fill.
- ****Secondary****: Transparent fill, #65A30D text, 1.5px #65A30D border, #F7FEE7 fill.
- ****Ghost****: Transparent fill, #57534E text, no border, #F5F5F4 fill.
- ****Destructive****: #EF4444 fill, #FFFFFF text, no border, #DC2626 fill.
#### Sizes
Sizes: sm (6px 12px, 13px, 32px), md (8px 16px, 15px, 40px), lg (10px 24px, 16px, 48px).
#### Disabled State
0.45 opacity, disabled cursor.
- No hover or focus transitions

### Cards
- ****Default****: #FFFFFF fill, 1px #E7E5E4 border, sm shadow, 8px radius.
- ****Elevated****: #FFFFFF fill, no border, md shadow, 8px radius.
16px padding, image top, 16:10 aspect ratio, radius `8px 8px 0 0` recipe card, aligned right, Nunito 600 small prep/cook time row.

### Inputs
- **Default**: #E7E5E4 border, #FFFFFF fill, sm shadow.
- **Hover**: #A8A29E border, #FFFFFF fill, sm shadow.
- **Focus**: #65A30D border, #FFFFFF fill, focus` ring shadow.
- **Error**: #EF4444 border, #FEF2F2 fill, no shadow.
- **Disabled**: #E7E5E4 border, #FAFAF9 fill, no shadow.
40px, padding: 8px 12px, radius: 8px tall, Nunito 600, 14px, `text-primary`, 4px bottom margin **label**, Nunito 400, 13px, `text-tertiary`, 4px margin-top; errors use `error` color **helper text**.

### Chips
- ****Filter****: #F7FEE7 fill, #65A30D text, 1px #65A30D border, pill shape.
- ****Status****: varies fill, varies text, no border, pill shape.
Status chip semantic mapping:
bg #DCFCE7, text #059669 published, bg #F5F5F4, text #57534E draft, bg #FEF3C7, text #D97706 allergy, bg #FEE2E2, text #DC2626 favorited.

### Lists
Nunito 400 15px. 44px row height, 10px/16px padding, 1px #E7E5E4 divider. Hover: background #FFFBF5. Selected: background #F7FEE7, left border 3px #65A30D.
- Ingredient lists use checkbox + quantity (mono) + name pattern

### Checkboxes
20px square, radius: 4px. strikethrough text (for ingredient tracking) checked label. Unchecked: border 2px #D6D3D1, background white. Checked: background #65A30D, border #65A30D, white checkmark. Indeterminate: background #65A30D, white dash. Disabled: 45% opacity. Labels in 8px gap Nunito 400 15px.

### Radio Buttons
20px circle. Unchecked: border 2px #D6D3D1, background white. Selected: border 2px #65A30D, inner dot 12px #65A30D. Disabled: 45% opacity. Labels in 8px gap Nunito 400 15px.

### Tooltips
#1C1917 fill, #FFFFFF, Nunito 400, 13px text, 8px corners, `md` shadow. 8px/12px padding, 6px arrow, 240px max width.
---

## Do's and Don'ts

1. **Do** use monospace font for all measurements and quantities (e.g., "2 cups", "350F").
2. **Do** number cooking steps with `primary` colored circles for clear visual sequence.
3. **Don't** truncate ingredient lists — always show the full list without scrolling when possible.
4. **Do** use the strikethrough checkbox pattern for ingredient shopping/prep tracking.
5. **Don't** use the secondary red for anything except favorites and error states.
6. **Do** include a tip box (using `surface-raised` yellow) for chef's tips and substitutions.
7. **Don't** auto-play video content; let users initiate playback from step instructions.
8. **Do** display prep time, cook time, and servings prominently in every recipe card header.
9. **Don't** use complex layouts for step instructions — one step per row, clear numbering.
10. **Do** provide allergy and dietary chips (gluten-free, vegan) near the recipe title.