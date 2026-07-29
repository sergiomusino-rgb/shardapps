# VolunteerHub Design System

## Overview

VolunteerHub is a community-driven, action-oriented design system built for volunteer coordination and community service platforms. It uses energetic blues and oranges alongside a supportive green to encourage participation and celebrate impact. The rounded, friendly UI creates a welcoming experience that lowers the barrier to getting involved.

---

## Colors

- **Color Primary** (#2563EB): Primary actions, navigation
- **Color Secondary** (#F97316): Highlights, urgent callouts
- **Color Tertiary** (#22C55E): Success, completion indicators
- **Surface Base** (#FAFAFA): Page background
- **Color Success** (#22C55E): Signed up, complete
- **Color Warning** (#F97316): Spots limited
- **Color Error** (#EF4444): Errors, cancellation
- **Color Info** (#3B82F6): New opportunity

## Typography

- **Headline Font**: Figtree
- **Body Font**: DM Sans
- **Mono Font**: Fira Code

- **h1**: 36px extra-bold, 1.2 line height. Page titles.
- **h2**: 28px bold, 1.25 line height. Section headings.
- **h3**: 22px bold, 1.3 line height. Opportunity titles.
- **h4**: 18px semibold, 1.35 line height. Card titles.
- **body**: 16px regular, 1.6 line height. Body text.
- **small**: 14px regular, 1.5 line height. Metadata, helpers.
- **xs**: 12px medium, 1.4 line height. Badges, counts.

---

## Spacing

Base unit: **8px**.
- **xs**: 4px — Inline icon gaps
- **sm**: 8px — Tight padding
- **md**: 16px — Standard card padding
- **lg**: 24px — Section gaps
- **xl**: 32px — Layout margins
- **2xl**: 48px — Hero section spacing
- **3xl**: 64px — Major layout breaks

## Border Radius

- **radius-sm** (6px): Chips, small tags
- **radius-md** (12px): Buttons, cards, inputs
- **radius-lg** (16px): Modals, large panels
- **radius-full** (9999px): Avatars, icon buttons

## Elevation

Material shadow system with layered depth.
- **shadow-sm**: 1px offset, 3px blur, #000000 at 7%. Resting cards.
- **shadow-md**: 4px offset, 8px blur, #000000 at 10%. Hovered elements.
- **shadow-lg**: 10px offset, 24px blur, #000000 at 12%. Modals, dropdowns.
- **shadow-blue**: 4px offset, 14px blur, #2563EB at 25%. Primary CTA glow.

## Components

### Buttons
#### Variants
- **Primary**: #2563EB fill, #FFFFFF text, no border, #1D4ED8 fill.
- **Secondary**: #F97316 fill, #FFFFFF text, no border, #EA580C fill.
- **Ghost**: transparent fill, #2563EB text, 2px #2563EB border, #2563EB10 fill.
- **Destructive**: #EF4444 fill, #FFFFFF text, no border, #DC2626 fill.
#### Sizes
Sizes: Small (8px 16px, 14px, 32px), Medium (10px 24px, 16px, 40px), Large (12px 32px, 18px, 48px).
#### Disabled State
0.5 opacity.
- disabled cursor
- No hover or focus effects applied

### Cards
- **Default**: #FFFFFF fill, 1px #E5E7EB border, shadow-sm shadow. Hover: shadow-md.
- **Elevated**: #FFFFFF fill, no border, shadow-md shadow. Hover: shadow-lg.
radius-md (12px) border radius. 16px padding.

### Inputs
- **Default**: 1px #D1D5DB border, #FFFFFF fill.
- **Hover**: 1px #9CA3AF border, #FFFFFF fill.
- **Focus**: 2px #2563EB border, #FFFFFF fill, 3px ring #2563EB at 20% shadow.
- **Error**: 2px #EF4444 border, #FEF2F2 fill, 3px ring #EF4444 at 20% shadow.
- **Disabled**: 1px #E5E7EB border, #F3F4F6 fill, none; 50% opacity shadow.
14px, DM Sans 500, content-primary, 4px bottom margin **label**, 12px, DM Sans 400, content-tertiary, 4px top margin; error helper uses color-error **helper text**, 10px/14px;/border/radius:/radius-md padding.

### Chips
- **Filter**: #2563EB15 fill, #2563EB text, 1px #2563EB40 border.
- **Status**: varies by severity fill, varies text, no border.
success #DCFCE7/#166534, warning #FFF7ED/#9A3412, error #FEE2E2/#991B1B status colors, 4px/12px;/font-size:/12px;/border-radius:/radius-full padding.

### Lists
16px DM Sans content-primary. 52px; padding: 0 16px row height, 1px #E5E7EB divider. Hover: background #F9FAFB. Active: background #2563EB10, text color #2563EB.

### Checkboxes
20px square; border-radius: 6px. 8px; label font: 16px DM Sans label gap. Unchecked: 2px #D1D5DB, background #FFFFFF. Checked: background #2563EB, white checkmark icon. Focus: 3px ring #2563EB at 20%.

### Radio Buttons
20px circle; border-radius: 50%. 8px; label font: 16px DM Sans label gap. Unchecked: 2px #D1D5DB, background #FFFFFF. Selected: 2px #2563EB, inner dot 10px #2563EB. Focus: 3px ring #2563EB at 20%.

### Tooltips
#111827; text: #FFFFFF; font: 12px DM Sans fill. 6px/12px;/border-radius:/radius-sm padding, 6px; max-width: 240px arrow, 200ms show, 0ms hide delay.
---

## Do's and Don'ts

1. **Do** use the primary blue for all sign-up and engagement CTAs to drive volunteer action.
2. **Do** use the secondary orange to highlight urgent or limited-spot opportunities.
3. **Do** celebrate completions with the tertiary green for check-marks, badges, and progress bars.
4. **Don't** mix primary and secondary buttons in the same row; pick one dominant action per context.
5. **Don't** use sharp corners; the rounded aesthetic is integral to the approachable community feel.
6. **Do** include volunteer count and impact metrics prominently on opportunity cards.
7. **Don't** overwhelm users with too many CTAs; guide them through a clear sign-up funnel.
8. **Do** keep card layouts consistent with image, title, date, location, and a single action button.
9. **Don't** use dark themes; the light, open layout signals community warmth and inclusivity.
10. **Do** ensure all interactive elements have clear focus states for keyboard navigation accessibility.