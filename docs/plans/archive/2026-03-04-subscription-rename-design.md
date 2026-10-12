# Design: Universal Subscription Rename

**Date:** 2026-03-04  
**Status:** Approved  
**Scope:** Frontend-only (API already supports name updates)

## Overview

Add the ability to rename any subscription from the "Configure Subscription" modal. Currently the `name` field is read-only for all types except `spotify_public_playlist` (which has a separate editable name input). This feature makes naming universal and consistent.

## Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| UX pattern (edit mode) | Inline edit button (pencil icon) | Prevents accidental renames, clean and intentional |
| spotify_public_playlist duplicate input | Remove it | Universal rename replaces it; two inputs for same field is confusing |
| UX pattern (create mode) | Auto-populated, editable from the start | Users are already filling out a form; normal input with default is natural |
| Validation | min 1, max 255 chars, trimmed | Matches existing backend schema exactly |

## Component Changes

**File:** `apps/web/src/components/subscriptions/SubscriptionFormModal.tsx` (only file modified)

### New State
- `isNameEditing` (boolean, default `false`) — tracks whether the edit-mode name field is unlocked
- Resets to `false` when modal opens/closes (in existing `useEffect` reset logic)

### Name Field Rendering (replaces read-only block ~line 487-491)

**Create mode** (`!editingSubscription`):
- Normal `<Input>` bound to `form.name`
- Pre-populated with type label or preset name
- Placeholder: "Enter subscription name"

**Edit mode** (`editingSubscription`):
- When `!isNameEditing`: Read-only `<Input>` with `bg-muted` styling + `Pencil` icon button
- When `isNameEditing`: Normal editable `<Input>`, auto-focused

### Name Auto-Population
- `handleTypeChange` updates `form.name` to new type's label (creation only — type selector is disabled during edit)

### Removal
- Delete the `spotify_public_playlist`-specific "Subscription Name" input block (~line 594-604)

### Validation Addition
In `validateForm()`:
- If `form.name.trim().length === 0` → `errors.name = 'Name is required'`
- If `form.name.length > 255` → `errors.name = 'Name must be 255 characters or less'`

## Data Flow

### Save Flow
Existing `handleSave` logic: `const name = form.name || subscriptionTypes.find(...)?.label || form.type`
- Fallback remains as safety net but validation should prevent empty names

### Edge Cases
- **Whitespace-only names:** Caught by `trim().length === 0` validation
- **Preset selection:** `getFormStateFromPreset` populates `form.name` with `preset.name` — displayed in universal field
- **Type change during creation:** `handleTypeChange` updates `form.name` to new type label
- **Cancel after editing name:** `handleClose` resets form state and `isNameEditing`

## What Does NOT Change
- Backend schemas, routes, or service logic
- Subscription card display
- `onSave` prop interface
- API client code
- Any other file

## Design Attack

- ✅ Rubber-duck: Data traceable end-to-end in both create and edit flows
- ✅ Attack: Empty names blocked by validation, cancel resets state, no concurrent editing issues at this scale
- ✅ Best practices: Single component change, mirrors backend validation, standard accessible inputs
- ✅ No architectural contradictions found
