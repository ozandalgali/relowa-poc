# Test category — Frontend Component

**Status:** 📋 P1, to build.
**Owner:** `design-system-keeper` (for `packages/ui`), `feature-component-builder` (for feature components). `tester` adds a11y + snapshot polish.
**Runner:** Vitest + React Testing Library + axe-core.
**Location:** Co-located with components (`*.test.tsx`).

## Purpose

Verify component behavior, accessibility, and visual stability at the unit level. Catch regressions before they reach pages or E2E.

## What this covers

- **Primitives (`packages/ui/primitives/`):** all states (default, hover, focus, disabled, error), keyboard nav, ARIA correctness.
- **Patterns (`packages/ui/patterns/`):** composed behavior, prop variants, edge cases (empty, loading, error).
- **Feature components:** interaction logic, conditional rendering, i18n key resolution.

## Test shape

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { axe } from 'vitest-axe';
import { Button } from './Button';

describe('Button', () => {
  it('renders with variant=primary and brand-500 background', () => {
    const { container } = render(<Button variant="primary">Save</Button>);
    expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument();
    expect(container.firstChild).toHaveClass('bg-brand-500');
  });

  it('is keyboard activatable via Enter and Space', () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Save</Button>);
    fireEvent.keyDown(screen.getByRole('button'), { key: 'Enter' });
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('does not call onClick when disabled', () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick} disabled>Save</Button>);
    fireEvent.click(screen.getByRole('button'));
    expect(onClick).not.toHaveBeenCalled();
  });

  it('has no a11y violations in default state', async () => {
    const { container } = render(<Button>Save</Button>);
    expect(await axe(container)).toHaveNoViolations();
  });

  it('has no a11y violations when disabled', async () => {
    const { container } = render(<Button disabled>Save</Button>);
    expect(await axe(container)).toHaveNoViolations();
  });
});
```

## Required assertions per primitive

1. Renders with default props.
2. Each `variant` renders correctly.
3. Each interactive state (focus, hover, disabled).
4. Keyboard navigation works (Tab, Enter, Space, Escape, arrows where relevant).
5. ARIA attributes set correctly (`role`, `aria-disabled`, `aria-label`).
6. a11y passes via `axe` in default and disabled states.

## Required assertions per pattern (Layer 1)

1. Renders with required props.
2. Each variant from the design (`KPIStatCard` light + dark, `BidOfferCard` default + ai_best).
3. Loading skeleton variant if applicable.
4. Empty state variant if applicable.
5. a11y passes.

## Required assertions per feature component

1. Renders correctly with mock props.
2. Interaction logic works (form submit, modal open/close).
3. i18n keys resolve (use `<NextIntlClientProvider>` with the message map in tests).
4. Conditional rendering based on role / state.

## Visual regression (P2)

Snapshot-based visual diffs happen in Playwright (P2, separate category). Component-level tests don't snapshot the DOM.

## Non-negotiables

- ❌ Never test implementation details (`expect(component.state.foo).toBe(...)`). Test behavior visible to a user.
- ❌ Never query by `data-testid` when an accessible query works. `getByRole`, `getByLabelText` first.
- ❌ Never skip the a11y check.
- ✅ Always test keyboard activation, not just clicks.
- ✅ Always test the disabled state behavior.

## See also

- `docs/adr/0011-ui-kit-design-tokens.md`
- `docs/frontend/component-inventory.md`
- `.opencode/skills/design-system-keeper.md`
- `.opencode/skills/feature-component-builder.md`
