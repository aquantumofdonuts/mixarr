# Subscription Rename Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Allow users to rename any subscription from the configure subscription modal.

**Architecture:** Frontend-only change to `SubscriptionFormModal.tsx`. Add `isNameEditing` state for edit-mode pencil-to-unlock UX. Make Name field always editable during creation. Remove duplicate spotify_public_playlist name input. Add name validation. No backend changes needed — API already supports name updates.

**Tech Stack:** React, TypeScript, Lucide icons

---

### Task 1: Add Pencil icon import and `isNameEditing` state

**Files:**
- Modify: `apps/web/src/components/subscriptions/SubscriptionFormModal.tsx`

**Step 1: Add the Pencil icon import**

At line 19, after the `Plus` import, add:

```tsx
import Pencil from 'lucide-react/dist/esm/icons/pencil';
```

**Step 2: Add `isNameEditing` state**

Inside the component, after the existing state declarations (after line 202, `const [showArtistDropdown, setShowArtistDropdown] = useState(false);`), add:

```tsx
  // Name editing state (for edit mode pencil-to-unlock)
  const [isNameEditing, setIsNameEditing] = useState(false);
```

**Step 3: Reset `isNameEditing` in the existing useEffect**

In the `useEffect` that resets state when the modal opens (around line 213), add `setIsNameEditing(false);` inside the `if (isOpen)` block, after `setShowArtistDropdown(false);`:

The block currently ends with:
```tsx
      setShowArtistDropdown(false);
    }
```

Change to:
```tsx
      setShowArtistDropdown(false);
      setIsNameEditing(false);
    }
```

**Step 4: Verify — run TypeScript check**

Run: `cd /home/chris/Github/mixarr && npx tsc --noEmit -p apps/web/tsconfig.json 2>&1 | head -20`
Expected: No errors (or only pre-existing ones)

**Step 5: Commit**

```bash
git add apps/web/src/components/subscriptions/SubscriptionFormModal.tsx
git commit -m "feat(rename): add Pencil icon import and isNameEditing state"
```

---

### Task 2: Replace read-only Name field with conditional editable field

**Files:**
- Modify: `apps/web/src/components/subscriptions/SubscriptionFormModal.tsx`

**Step 1: Replace the Name field block**

Find the current read-only Name block (around lines 487-491):

```tsx
          {/* Name (read-only, derived from type) */}
          <div>
            <label className="text-sm font-medium">Name</label>
            <Input value={form.name || typeConfig?.label || ''} readOnly className="bg-muted cursor-not-allowed" />
          </div>
```

Replace with:

```tsx
          {/* Name */}
          <div>
            <label className="text-sm font-medium">Name</label>
            {editingSubscription && !isNameEditing ? (
              <div className="flex gap-2">
                <Input
                  value={form.name || typeConfig?.label || ''}
                  readOnly
                  className="bg-muted cursor-not-allowed flex-1"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setIsNameEditing(true)}
                  title="Rename subscription"
                  className="shrink-0"
                >
                  <Pencil className="h-4 w-4" />
                </Button>
              </div>
            ) : (
              <Input
                value={form.name || (editingSubscription ? '' : typeConfig?.label || '')}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="Enter subscription name"
                autoFocus={isNameEditing}
                maxLength={255}
              />
            )}
            {validationErrors.name && (
              <p className="text-xs text-destructive mt-1">{validationErrors.name}</p>
            )}
          </div>
```

**Step 2: Verify — run TypeScript check**

Run: `cd /home/chris/Github/mixarr && npx tsc --noEmit -p apps/web/tsconfig.json 2>&1 | head -20`
Expected: No errors

**Step 3: Commit**

```bash
git add apps/web/src/components/subscriptions/SubscriptionFormModal.tsx
git commit -m "feat(rename): replace read-only Name with conditional editable field

- Create mode: always-editable input, pre-populated with type label
- Edit mode: read-only with pencil button to unlock editing
- Shows validation error below field"
```

---

### Task 3: Auto-populate name on type change during creation

**Files:**
- Modify: `apps/web/src/components/subscriptions/SubscriptionFormModal.tsx`

**Step 1: Update `handleTypeChange` to set the name**

Find `handleTypeChange` (around line 374):

```tsx
  const handleTypeChange = (newType: string) => {
    setForm({ ...form, type: newType });
    setValidationErrors({});
    setArtistSearch('');
    setArtistResults([]);
  };
```

Replace with:

```tsx
  const handleTypeChange = (newType: string) => {
    const newTypeLabel = subscriptionTypes.find((t) => t.value === newType)?.label || newType;
    setForm({ ...form, type: newType, name: newTypeLabel });
    setValidationErrors({});
    setArtistSearch('');
    setArtistResults([]);
  };
```

This only fires during creation because the type `<Select>` is `disabled={!!editingSubscription || selectedFromPreset}` when editing.

**Step 2: Verify — run TypeScript check**

Run: `cd /home/chris/Github/mixarr && npx tsc --noEmit -p apps/web/tsconfig.json 2>&1 | head -20`
Expected: No errors

**Step 3: Commit**

```bash
git add apps/web/src/components/subscriptions/SubscriptionFormModal.tsx
git commit -m "feat(rename): auto-populate name field when type changes during creation"
```

---

### Task 4: Add name validation to `validateForm`

**Files:**
- Modify: `apps/web/src/components/subscriptions/SubscriptionFormModal.tsx`

**Step 1: Add name validation**

Find `validateForm` (around line 262):

```tsx
  const validateForm = (): Record<string, string> => {
    const errors: Record<string, string> = {};
    const requiredFields = REQUIRED_FIELDS[form.type] || [];

    for (const { field, label } of requiredFields) {
      const value = form[field as keyof FormState];
      if (!value || (typeof value === 'string' && value.trim() === '')) {
        errors[field] = `${label} is required`;
      }
    }

    return errors;
  };
```

Replace with:

```tsx
  const validateForm = (): Record<string, string> => {
    const errors: Record<string, string> = {};

    // Validate name
    const trimmedName = (form.name || '').trim();
    if (trimmedName.length === 0) {
      errors.name = 'Name is required';
    } else if (trimmedName.length > 255) {
      errors.name = 'Name must be 255 characters or less';
    }

    // Validate type-specific required fields
    const requiredFields = REQUIRED_FIELDS[form.type] || [];

    for (const { field, label } of requiredFields) {
      const value = form[field as keyof FormState];
      if (!value || (typeof value === 'string' && value.trim() === '')) {
        errors[field] = `${label} is required`;
      }
    }

    return errors;
  };
```

**Step 2: Trim the name before saving in `handleSave`**

Find in `handleSave` (around line 346):

```tsx
    const name = form.name || subscriptionTypes.find((t) => t.value === form.type)?.label || form.type;
```

Replace with:

```tsx
    const name = (form.name || subscriptionTypes.find((t) => t.value === form.type)?.label || form.type).trim();
```

**Step 3: Verify — run TypeScript check**

Run: `cd /home/chris/Github/mixarr && npx tsc --noEmit -p apps/web/tsconfig.json 2>&1 | head -20`
Expected: No errors

**Step 4: Commit**

```bash
git add apps/web/src/components/subscriptions/SubscriptionFormModal.tsx
git commit -m "feat(rename): add name validation (required, max 255 chars, trimmed)"
```

---

### Task 5: Remove duplicate spotify_public_playlist name input

**Files:**
- Modify: `apps/web/src/components/subscriptions/SubscriptionFormModal.tsx`

**Step 1: Remove the duplicate name input**

Find the spotify_public_playlist "Subscription Name" block (around lines 601-612):

```tsx
              <div>
                <label className="text-sm font-medium">Subscription Name</label>
                <Input
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="e.g., Release Radar, Discover Weekly"
                />
                <p className="text-xs text-muted-foreground mt-1">
                  Optional — helps distinguish between multiple playlist subscriptions
                </p>
              </div>
```

Delete this entire block. The universal Name field at the top of the form now handles this.

**Step 2: Verify — run TypeScript check**

Run: `cd /home/chris/Github/mixarr && npx tsc --noEmit -p apps/web/tsconfig.json 2>&1 | head -20`
Expected: No errors

**Step 3: Commit**

```bash
git add apps/web/src/components/subscriptions/SubscriptionFormModal.tsx
git commit -m "refactor(rename): remove duplicate spotify_public_playlist name input

The universal Name field at the top of the form now handles naming for all
subscription types, making this type-specific input redundant."
```

---

## Plan Review Gate

1. **Wiring completeness:** ✅ Name field renders in both create/edit modes. Pencil button toggles `isNameEditing`. `onChange` updates `form.name`. `handleSave` passes `name` to `onSave`. `onSave` sends it to the API via `updateMutation`.
2. **Resource lifecycle:** ✅ `isNameEditing` state created and cleaned up (reset on modal open/close). No persistent resources.
3. **Dependency completeness:** ✅ Only new import is `Pencil` from lucide-react (already a project dependency).
4. **Config consistency:** ✅ No backend/config changes.
5. **Async/sync boundaries:** ✅ All changes are synchronous state updates.
6. **Missing integration steps:** ✅ The `onSave` callback and `updateMutation` already handle `name` — no wiring gaps.

**Plan review passed.**
