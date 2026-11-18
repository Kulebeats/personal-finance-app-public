# Form Field Design System Guidelines

## Overview

This document defines the standard pattern for form fields across the application. All form inputs should use the `FormField` component wrapper to ensure consistent styling, accessibility, and user experience.

## The FormField Component

Location: `client/src/features/settings/components/FormField.tsx`

### Features

1. **Hover Shadow Effect**: Fields display a subtle shadow glow on hover
2. **Conditional Tooltips**: Info icons appear on hover and show contextual help
3. **Accessibility**: Proper ARIA attributes and label associations
4. **Error Display**: Consistent error message styling

### Usage

```tsx
import { FormField } from "@/features/settings/components";

<FormField
  label="Email"
  required
  error={errors.email?.message}
  hint="We'll never share your email"
  htmlFor="email"
  tooltip="Your primary contact email for account notifications"
>
  <Input id="email" {...register("email")} />
</FormField>;
```

### Props

| Prop        | Type      | Required | Description                        |
| ----------- | --------- | -------- | ---------------------------------- |
| `label`     | string    | Yes      | Field label text                   |
| `htmlFor`   | string    | Yes      | ID of the input element            |
| `required`  | boolean   | No       | Shows required indicator (\*)      |
| `error`     | string    | No       | Error message to display           |
| `hint`      | string    | No       | Hint text below input              |
| `tooltip`   | ReactNode | No       | Tooltip content (appears on hover) |
| `className` | string    | No       | Additional CSS classes             |
| `children`  | ReactNode | Yes      | The input element(s)               |

## Design Principles

### 1. Hover Effects

- **DO**: Use shadow effects for hover feedback (`group-hover/formfield:shadow-[...]`)
- **DON'T**: Use CSS `transform` (scale, translate) on containers with Radix Select/Popover components

Reason: CSS transforms create new stacking contexts that break Radix portal positioning.

### 2. Tooltips

- Use the `tooltip` prop for fields that need contextual help
- Tooltips appear when hovering over the field
- Keep tooltip content concise and helpful

### 3. Accessibility

- Always provide `htmlFor` matching the input's `id`
- Use `required` prop for mandatory fields
- Provide meaningful error messages via `error` prop

## Migration Guide

When updating existing forms:

1. Import `FormField` from settings components
2. Wrap each input group with `FormField`
3. Move labels into the `label` prop
4. Associate tooltips for helpful context
5. Ensure `id` and `htmlFor` match

### Before

```tsx
<div>
  <label htmlFor="name">Name</label>
  <Input id="name" />
</div>
```

### After

```tsx
<FormField label="Name" htmlFor="name" tooltip="Your display name">
  <Input id="name" />
</FormField>
```

## Files Already Using This Pattern

- ✅ `settings/sections/ProfileSection/ProfileForm.tsx`
- ✅ `settings/sections/ProfileSection/components/AddressFields.tsx`
- ✅ `settings/sections/ProfileSection/components/ContactFields.tsx`
- ✅ `settings/sections/ProfileSection/components/FinancialProfileFields.tsx`
- ✅ `settings/sections/ProfileSection/components/SocialLinksFields.tsx`

## Files Needing Migration (Priority Order)

1. 🔲 `pages/Login.tsx` (high priority - first impression)
2. 🔲 `pages/Transactions.tsx` (dialogs/forms)
3. 🔲 `pages/Budget.tsx`
4. 🔲 `pages/Recurring.tsx`
5. 🔲 `pages/Profile.tsx` (large file, many forms)
6. 🔲 `settings/sections/RulesSection/index.tsx`
7. 🔲 `settings/sections/MerchantsSection/index.tsx`
8. 🔲 `settings/sections/CategoriesSection/CategoryList.tsx`

## Important Restrictions

### CSS Transform Restriction

**NEVER apply CSS transforms to containers that hold Radix components:**

```tsx
// ❌ BAD - Will break Select/Popover positioning
<div className="hover:scale-105 hover:-translate-y-1">
  <Select>...</Select>
</div>

// ✅ GOOD - Use shadow for visual feedback
<div className="hover:shadow-lg transition-shadow">
  <Select>...</Select>
</div>
```

This restriction applies to:

- `Select`
- `Popover`
- `Dialog`
- `DropdownMenu`
- `HoverCard`
- `Tooltip` (when nested)

## Exporting FormField

Ensure FormField is properly exported for use across the app:

```tsx
// In client/src/features/settings/components/index.ts
export { FormField } from "./FormField";
export type { FormFieldProps } from "../types/settings";
```
