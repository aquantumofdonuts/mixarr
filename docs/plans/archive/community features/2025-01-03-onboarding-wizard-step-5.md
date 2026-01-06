# Implementation Task: Onboarding Wizard Completion Step

**Date**: 2025-01-03  
**Gap Identified In**: `docs/plans/archive/2024-12-23-onboarding-wizard-redesign.md`  
**Status**: Not Implemented

## Problem Statement

The onboarding wizard design specified 5 steps but only 4 are implemented:
- ✅ Step 1: Welcome
- ✅ Step 2: Create Admin Account  
- ✅ Step 3: Configure Base URL
- ✅ Step 4: Connect Services
- ❌ Step 5: Complete (with celebration/summary)

Currently `handleFinishSetup()` just does `router.push('/')` with no celebration.

## Current Code

**File**: `apps/web/src/app/setup/page.tsx`

```tsx
// Line 11
type Step = 'welcome' | 'admin' | 'url' | 'connections';
const steps: Step[] = ['welcome', 'admin', 'url', 'connections'];

// Line 134
const handleFinishSetup = () => {
  router.push('/');
};
```

## Required Changes

### Task 1: Add 'complete' to Step type (2 min)

**File**: `apps/web/src/app/setup/page.tsx`

Update lines 11-12:
```tsx
type Step = 'welcome' | 'admin' | 'url' | 'connections' | 'complete';
const steps: Step[] = ['welcome', 'admin', 'url', 'connections', 'complete'];
```

### Task 2: Update handleFinishSetup to show completion (2 min)

Replace the current `handleFinishSetup` function:

```tsx
const handleFinishSetup = () => {
  setStep('complete');
};

const handleGoToDashboard = () => {
  router.push('/');
};
```

### Task 3: Add Complete step UI (5 min)

Add after the `connections` step content (around line 450):

```tsx
{step === 'complete' && (
  <Card>
    <CardHeader className="text-center">
      <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-green-500/10">
        <Check className="h-8 w-8 text-green-500" />
      </div>
      <CardTitle className="text-2xl">You&apos;re All Set!</CardTitle>
      <CardDescription>
        Mixarr is ready to discover amazing music
      </CardDescription>
    </CardHeader>
    <CardContent className="space-y-6">
      {/* Summary of what was configured */}
      <div className="rounded-lg bg-muted p-4 space-y-3">
        <p className="font-medium text-sm">What you can do now:</p>
        <ul className="space-y-2 text-sm text-muted-foreground">
          <li className="flex items-center gap-2">
            <Music2 className="h-4 w-4 text-primary shrink-0" />
            <span>Import artists from your connected services</span>
          </li>
          <li className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary shrink-0" />
            <span>Create subscriptions for automatic discovery</span>
          </li>
          <li className="flex items-center gap-2">
            <Search className="h-4 w-4 text-primary shrink-0" />
            <span>Search for artists across multiple sources</span>
          </li>
        </ul>
      </div>
      
      <Button className="w-full" onClick={handleGoToDashboard}>
        Go to Dashboard <ChevronRight className="ml-2 h-4 w-4" />
      </Button>
    </CardContent>
  </Card>
)}
```

## Verification Steps

1. Run `npm run build` in `apps/web/` - should compile without errors
2. Navigate to `/setup` (delete any existing admin user or reset DB)
3. Complete all 4 steps - should see Step 5 "Complete" with celebration UI
4. Click "Go to Dashboard" - should redirect to `/`

## Estimated Time

- Task 1: 2 minutes
- Task 2: 2 minutes  
- Task 3: 5 minutes
- Testing: 5 minutes

**Total: ~15 minutes**
