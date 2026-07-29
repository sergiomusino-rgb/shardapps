# BistroMenu Design System

## Overview

BistroMenu is a warm, appetite-inducing design system inspired by the classic menu card. It is crafted for restaurant websites and digital menu boards where elegance meets readability. The serif typography and burgundy-gold palette evoke the intimacy of a fine dining experience while keeping dish descriptions and pricing scannable.

---

## Colors

- **Primary** (#881337): Headlines, CTAs, nav accents
- **Secondary** (#CA8A04): Prices, featured badges
- **Tertiary** (#FFFBEB): Card backgrounds, warm tint
- **Background** (#FFFBEB): Page background (warm cream)
- **Surface** (#FFFFFF): Menu cards, modals
- **Success** (#059669): Available, confirmed
- **Warning** (#D97706): Limited availability
- **Error** (#EF4444): Sold out, error
- **Info** (#7C3AED): Chef's special, featured

## Typography

- **Headline Font**: Playfair Display
- **Body Font**: Lora
- **Mono Font**: Source Code Pro

- **h1**: 36px bold, 44px line height. Restaurant name, hero.
- **h2**: 28px semibold, 36px line height. Menu section headers.
- **h3**: 22px semibold, 30px line height. Category titles.
- **h4**: 18px semibold, 26px line height. Dish names.
- **body**: 15px regular, 24px line height. Descriptions.
- **small**: 13px regular, 20px line height. Dietary tags, notes.
- **mono**: 14px regular, 20px line height. Prices, order numbers.

---

## Spacing

Base unit: **12px** (spacious)
- **xs**: 6px — Inline tag gaps
- **sm**: 12px — Between dish name and desc
- **md**: 24px — Card internal padding
- **lg**: 36px — Between menu sections
- **xl**: 48px — Page section spacing
- **2xl**: 60px — Hero padding
- **3xl**: 84px — Layout margins

## Border Radius

- **None** (0px): Decorative rules
- **sm** (4px): Buttons, cards, inputs
- **md** (6px): Modals
- **lg** (8px): Image containers
- **full** (9999px): Dietary badges, pills

## Elevation

Flat, menu-card aesthetic. No shadows by default.
- **sm**: 1px offset, 2px blur, #000000 at 3%. Subtle lift (rare).
- **md**: 2px offset, 6px blur, #000000 at 6%. Dropdowns.
- **lg**: 4px offset, 12px blur, #000000 at 8%. Lightbox, modal.
- **focus**: 3px ring #881337 at 20%. Focus ring.

## Components

### Buttons
#### Variants
- ****Primary****: #881337 fill, #FFFFFF text, no border, #6B1030 fill.
- ****Secondary****: Transparent fill, #881337 text, 1px #881337 border, #FFF1F2 fill.
- ****Ghost****: Transparent fill, #57534E text, no border, #F5F5F4 fill.
- ****Destructive****: #EF4444 fill, #FFFFFF text, no border, #DC2626 fill.
#### Sizes
Sizes: sm (6px 14px, 13px, 34px), md (8px 20px, 15px, 42px), lg (12px 28px, 16px, 50px).
#### Disabled State
0.45 opacity, disabled cursor.
- No hover or focus transitions

### Cards
- ****Default****: #FFFFFF fill, 1px #E7E5E4 border, no shadow, 4px radius.
- ****Elevated****: #FFFFFF fill, no border, md shadow, 4px radius.
24px padding, top border 3px #CA8A04 featured card variant.

### Inputs
- **Default**: #E7E5E4 border, #FFFFFF fill, no shadow.
- **Hover**: #CA8A04 border, #FFFFFF fill, no shadow.
- **Focus**: #881337 border, #FFFFFF fill, focus` ring shadow.
- **Error**: #EF4444 border, #FEF2F2 fill, no shadow.
- **Disabled**: #E7E5E4 border, #FAFAF9 fill, no shadow.
42px, padding: 8px 14px, radius: 4px tall, Lora 500, 14px, `text-primary`, 6px bottom margin **label**, Lora 400, 13px, `text-tertiary`, 4px margin-top; errors use `error` color **helper text**.

### Chips
- ****Filter****: #FFFBEB fill, #881337 text, 1px #E7E5E4 border, pill shape.
- ****Status****: varies fill, varies text, no border, pill shape.
Status chip semantic mapping:
bg #DCFCE7, text #059669 available, bg #FEF3C7, text #D97706 limited, bg #FEE2E2, text #EF4444 sold out, bg #F5F3FF, text #7C3AED featured.

### Lists
Lora 400 15px. 52px row height, 12px/24px padding, `1px dashed #E7E5E4` (dashed for menu aesthetic) divider. Hover: background #FFFBEB. Selected: background #FEF9C3, left border 3px #881337.

### Checkboxes
18px square, radius: 4px. Unchecked: border 1.5px #D6D3D1, background white. Checked: background #881337, border #881337, white checkmark. Indeterminate: background #881337, white dash. Disabled: 45% opacity. Labels in 8px gap Lora 400 15px.

### Radio Buttons
18px circle. Unchecked: border 1.5px #D6D3D1, background white. Selected: border 2px #881337, inner dot 10px #881337. Disabled: 45% opacity. Labels in 8px gap Lora 400 15px.

### Tooltips
#1C1917 fill, #FFFFFF, Lora 400, 13px text, 4px corners, `md` shadow. 8px/12px padding, 6px arrow, 240px max width.
---

## Do's and Don'ts

1. **Do** use Playfair Display for all dish category headings to maintain the menu-card elegance.
2. **Do** display prices in monospace to ensure clean column alignment on menus.
3. **Don't** use neon or saturated accent colors — stick to the warm burgundy-gold palette.
4. **Do** use dashed dividers between menu items for the traditional bistro feel.
5. **Don't** overload cards with too many dish images; whitespace is part of the luxury experience.
6. **Do** use the featured variant (gold top border) sparingly for chef's specials or seasonal items.
7. **Don't** place more than one primary CTA per menu section.
8. **Do** include dietary icons (vegetarian, gluten-free) as small chip components next to dish names.
9. **Don't** use the destructive button variant for standard actions like "Remove from Cart."
10. **Do** maintain generous spacing (12px base) to let the typography breathe.