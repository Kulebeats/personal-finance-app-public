# Project Roadmap: Personal Finance App Profile Enhancement

**Last Updated:** 2026-01-28
**Goal:** Create a world-class, industry-standard Profile Settings experience with a modern "Glassmorphism" aesthetic, deeper localization (Zambia), and premium features.

---

## 📊 Overall Progress Summary

| Phase | Status | Completion | Key Achievements |
|-------|--------|------------|------------------|
| Phase 1: Core UI & Localization | ✅ Complete | 100% | All core components, glassmorphism, tab structure, validation |
| Phase 2: Identity & Premium | 🎯 Nearly Done | 90% | Avatar, camera capture, banner, bio, social links (missing GitHub UI) |
| Phase 3: Engagement & Polish | 🔮 In Progress | 33% | Completeness widget (animations & privacy pending) |

**Overall Project Completion: 74%**

### Critical Gaps Identified

1. **GitHub Field Missing in UI** - Schema supports it but SocialLinksFields.tsx doesn't render the field
2. **Bio Markdown Support** - Currently plain text only
3. **Tab Animations** - Framer Motion available but not utilized
4. **100% Completion Confetti** - Not implemented
5. **Privacy Controls** - No granular visibility settings

---

## 🚀 Strategic Vision

The objective is to move beyond a basic data-entry form to a **rich, engaging user identity hub**. We draw inspiration from top-tier applications (Monarch Money, Google, LinkedIn) to ensure the UI is not only functional but visually stunning and "delightful" to use.

### Design Philosophy

- **Glassmorphism**: Use of translucency (`backdrop-blur`), subtle borders, and depth to create a modern, layered feel.
- **Mobile-First**: Touch-friendly inputs, large touch targets, and responsive layouts.
- **Localization First**: deeply integrated Zambian context (Network logos, Province auto-fill, Phone validation) rather than generic fields.
- **Interactive & Alive**: Inputs "lift" on focus, thorough validation feedback (Toasts), and dynamic widgets.

---

## 🗺️ Implementation Phases

### ✅ Phase 1: Core UI & Localization (100% Complete)

**Status:** All features implemented and verified in codebase.

- ✅ **Glassmorphism Overhaul**: Applied `.input-glass` class with `bg-white/50 backdrop-blur-sm` for glassmorphism effect throughout profile forms.
- ✅ **Structure**: Split monolithic form into `Personal`, `Contact`, and `Financial` tabs with proper validation and tab switching logic.
- ✅ **Components** (All Implemented):
  - ✅ `BirthdayPicker` (/client/src/pages/settings/sections/ProfileSection/components/BirthdayPicker.tsx): Modern 3-dropdown selector with 18+ age validation, auto-correction, and year hiding option.
  - ✅ `OccupationSelect` (/client/src/pages/settings/sections/ProfileSection/components/OccupationSelect.tsx): Dynamic "Creatable" combobox with 10 occupation categories and custom occupation support.
  - ✅ `NetworkLogo` (/client/src/pages/settings/sections/ProfileSection/components/NetworkLogo.tsx): Visual feedback for Zambian mobile networks (Airtel, MTN, Zamtel, Zed Mobile) with logo fallbacks.
  - ✅ `AddressFields` (/client/src/pages/settings/sections/ProfileSection/components/AddressFields.tsx): Auto-filling Province/Country based on City with dynamic state/province labels and postal code requirements.
- ✅ **Data**: Financial fields (Income, Goals) restored with comprehensive validation schemas in profileSchema.ts.

### 🎯 Phase 2: Identity & Premium Features (90% Complete)

**Status:** Most features implemented. Minor gaps identified.

#### 1. Profile Visuals "Pro" (100% Complete)

- ✅ **High-Fidelity Avatar** (/client/src/pages/settings/sections/ProfileSection/components/ProfilePictureUpload.tsx):
  - ✅ **Size**: Upgraded to 200px (UHD) for premium look - exceeds target of 160px.
  - ✅ **Position**: Centered prominently at top of Personal tab.
  - ✅ **Interaction**: Modal with "Upload" and "Camera" tabs implemented.
  - ✅ **Tech**: `react-webcam` dependency installed (v7.2.0) and integrated with camera capture, preview, and retake functionality.
  - ✅ **File Validation**: 5MB size limit with user-friendly error messages.
- ✅ **Cover Photo / Banner** (/client/src/pages/settings/sections/ProfileSection/components/BannerUpload.tsx):
  - ✅ Customizable background banner (256px height) with upload/delete functionality.
  - ✅ LinkedIn-style layout with hover effects and edit overlay.
  - ✅ Backend API endpoints implemented (/api/settings/profile/banner).
- ✅ **Initials Fallback** (ProfilePictureUpload.tsx):
  - ✅ `InitialsAvatar` component with 8 gradient variations.
  - ✅ Consistent gradient generation based on name hash.
  - ✅ Proper initials extraction (first + last name).

#### 2. Rich Personal Details (80% Complete)

- ✅ **Bio / About Me** (/client/src/pages/settings/sections/ProfileSection/components/BioField.tsx):
  - ✅ `bio` field implemented with 1000 character limit.
  - ✅ Real-time character counter with color indicators (warning at 90%, error at 100%).
  - ✅ Glassmorphism styling applied.
  - ⚠️ **Note:** Markdown support not yet implemented (plain text only).
- ⚠️ **Social Connectivity** (/client/src/pages/settings/sections/ProfileSection/components/SocialLinksFields.tsx):
  - ✅ Schema supports: `LinkedIn`, `Twitter`, `Facebook`, `GitHub`, `Email`, `Website`.
  - ✅ Implemented fields: LinkedIn, Twitter, Facebook, Website.
  - ❌ **Missing:** GitHub field not displayed in UI (schema ready but component incomplete).
  - ✅ URL validation with platform-specific regex patterns.
  - ✅ Icon integration for visual identity.

### 🔮 Phase 3: Engagement & Polish (33% Complete)

**Status:** Profile completeness widget implemented. Animations and privacy features pending.

- ✅ **Profile Strength Meter** (/client/src/pages/settings/sections/ProfileSection/components/ProfileCompletenessWidget.tsx):
  - ✅ Circular progress indicator with percentage display.
  - ✅ Comprehensive checklist tracking 9 profile fields:
    - Core: Full Name, Mobile, Occupation, Address, Financial Goal, Income
    - Rich: Profile Picture, Bio (10+ chars), Social Links (any)
  - ✅ Interactive popover showing completion status per field.
  - ✅ Trophy badge display when profile reaches 100%.
  - ✅ Progress bar visualization with smooth transitions.
- ❌ **Animation**:
  - ❌ Tab entry animations not implemented (Framer Motion available in dependencies but not used for tabs).
  - ❌ Confetti effect on 100% completion not implemented.
- ❌ **Privacy Controls**:
  - ❌ Granular visibility settings not implemented (all fields currently visible to authenticated user only).

---

## ✅ Technical Verification Summary

**Codebase Verification Completed:** 2026-01-28

### Components Verified

| Component | Path | Status | Notes |
|-----------|------|--------|-------|
| ProfileForm | /client/src/pages/settings/sections/ProfileSection/ProfileForm.tsx | ✅ Complete | Tab structure, validation, error handling |
| ProfileSchema | /client/src/features/settings/schemas/profileSchema.ts | ✅ Complete | Comprehensive validation with Zod |
| BirthdayPicker | /client/src/pages/settings/sections/ProfileSection/components/BirthdayPicker.tsx | ✅ Complete | 18+ validation, auto-correction |
| OccupationSelect | /client/src/pages/settings/sections/ProfileSection/components/OccupationSelect.tsx | ✅ Complete | 10 categories, custom support |
| NetworkLogo | /client/src/pages/settings/sections/ProfileSection/components/NetworkLogo.tsx | ✅ Complete | 4 Zambian networks supported |
| AddressFields | /client/src/pages/settings/sections/ProfileSection/components/AddressFields.tsx | ✅ Complete | Auto-fill, dynamic labels |
| ProfilePictureUpload | /client/src/pages/settings/sections/ProfileSection/components/ProfilePictureUpload.tsx | ✅ Complete | Camera capture, initials fallback |
| BannerUpload | /client/src/pages/settings/sections/ProfileSection/components/BannerUpload.tsx | ✅ Complete | Upload/delete, gradient fallback |
| BioField | /client/src/pages/settings/sections/ProfileSection/components/BioField.tsx | ✅ Complete | Character counter, validation |
| SocialLinksFields | /client/src/pages/settings/sections/ProfileSection/components/SocialLinksFields.tsx | ⚠️ Partial | Missing GitHub field display |
| ProfileCompletenessWidget | /client/src/pages/settings/sections/ProfileSection/components/ProfileCompletenessWidget.tsx | ✅ Complete | 9-field tracking, progress UI |

### CSS Verification

- ✅ `.input-glass` utility class defined in /client/src/index.css
- ✅ Glassmorphism: `bg-white/50 backdrop-blur-sm` (light) / `bg-slate-800/50` (dark)
- ✅ Consistent application across all input fields

### Dependencies Verification

- ✅ `react-webcam`: v7.2.0 installed
- ✅ `framer-motion`: v12.23.24 installed (available but not used for tabs)
- ✅ `zod`: v3.25.76 for validation
- ✅ `react-hook-form`: v7.66.0 for form management

---

## 🛠️ Technical Strategy

### Tech Stack

- **Frontend**: React, TypeScript, Tailwind CSS
- **UI Library**: Shadcn/UI (Radix Primitives)
- **State/Validation**: React Hook Form + Zod
- **Media**: `react-webcam` (Camera), Native File API (Uploads)

### Key Architectural Decisions

1.  **Component Functionality**:

    - Keep `ProfileForm` as the orchestrator.
    - Extract logic into domain components (`ContactFields`, `ProfilePictureUpload`).
    - Use `ContextProvider` pattern (`FormProvider`) to share state deeply without prop drilling.

2.  **Validation Strategy**:

    - **Schema-First**: All validation rules live in `profileSchema.ts`.
    - **Real-Time**: Feedback happens `onChange` or `onBlur`.
    - **Toast Notifications**: Use `sonner` for high-visibility errors/successes instead of subtle inline text only.

3.  **Performance**:
    - Optimize image uploads (client-side resize before upload if needed).
    - Lazy load heavy components (like the Camera modal) to keep initial render fast.

---

## 📋 Execution Plan

### ✅ Completed Steps

1. ✅ **Dependencies**: `react-webcam` (v7.2.0) installed in package.json
2. ✅ **Refactor**: ProfilePictureUpload.tsx updated with Upload/Camera tabs
3. ✅ **Layout**: Avatar centered prominently (200px) in ProfileForm
4. ✅ **Schema**: profileSchema.ts includes `bio`, `bannerUrl`, `socialLinks`
5. ✅ **UI**: Bio and Social Links fields added and styled
6. ✅ **Banner**: BannerUpload component created with upload/delete functionality
7. ✅ **Completeness**: ProfileCompletenessWidget tracking 9 key fields

### 🎯 Next Immediate Steps (To Reach 100%)

1. **Add GitHub Field** - Update SocialLinksFields.tsx to include GitHub input (5 min)
2. **Tab Animations** - Add Framer Motion animations to tab transitions (30 min)
3. **Confetti Effect** - Implement celebration on 100% profile completion (15 min)
4. **Bio Markdown** - Add markdown preview/editor to BioField (optional, 2 hrs)
5. **Privacy Controls** - Design and implement field visibility settings (optional, 4+ hrs)
