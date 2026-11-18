# Integration Testing Documentation

## Overview

The Settings feature includes comprehensive integration tests that validate complete user workflows and ensure robust error handling across the application. These tests go beyond unit testing to verify that components work together correctly in realistic scenarios.

## Test Location

**Primary Test Suite:** `finance-app/client/src/pages/settings/__tests__/integration.test.tsx`

**Mock Components:** `finance-app/client/src/pages/settings/__tests__/mocks/MockSettingsPage.tsx`

**Runner:** Vitest (JSDOM) using `client/vitest.config.ts`

## Mock Infrastructure

### MockSettingsPage Component

The test suite uses a sophisticated mock component (`MockSettingsPage.tsx`) that simulates the real Settings page behavior with:

- **TanStack Query Integration**: Real query/mutation hooks for API state management
- **Error Boundaries**: Section-level error isolation with retry functionality
- **Loading States**: Independent loading indicators per section
- **Form State Management**: Dirty state tracking and auto-save simulation
- **Multi-Section Navigation**: Profile, Categories, and Merchants sections
- **Toast Notifications**: Success/error feedback using Sonner
- **Proper React Patterns**: Components use hooks correctly following React rules

**Key Features:**

```typescript
// Query-based data fetching
const { data: profileResponse, isLoading: profileLoading } = useQuery({
  queryKey: ['profile'],
  queryFn: mockProfileApi.getProfile,
  enabled: activeSection === 'profile',
});

// Mutation-based updates
const updateProfileMutation = useMutation({
  mutationFn: mockProfileApi.updateProfile,
  onSuccess: () => {
    toast.success('Profile updated successfully');
    setIsDirty(false);
    queryClient.invalidateQueries({ queryKey: ['profile'] });
  },
});

// Section components with proper hook usage
const CategoriesSection = () => {
  const { data: categories, isLoading, error } = useQuery({
    queryKey: ['categories', retryKey],
    queryFn: mockCategoriesApi.getCategories,
  });

  if (isLoading) return <div data-testid="loading-skeleton">Loading...</div>;
  if (error) throw error;

  return (
    <div>
      <h2>Categories</h2>
      {categories?.map((cat: any) => (
        <div key={cat.id}>{cat.name}</div>
      ))}
    </div>
  );
};

// Error boundary with retry
<ErrorBoundary 
  sectionName="Categories" 
  onRetry={() => setRetryKey(prev => prev + 1)}
>
  <CategoriesSection />
</ErrorBoundary>
```

## Test Categories

### 1. Profile Save and Retrieve Workflow

Tests the complete form submission flow:
- User fills out profile form
- Data is submitted to API
- Success/error handling
- Data persistence verification
- Form state management

**Key Scenarios:**
- Successful profile update with multiple fields
- Error handling when API calls fail
- Form retains user input after errors
- Toast notifications display correctly

### 2. Section Isolation on Error

Validates that errors in one section don't crash others:
- Categories API fails → Profile section continues working
- Error boundaries catch section-specific failures
- Users can retry failed sections
- Other sections remain functional

**Key Scenarios:**
- API failure in one section
- Error boundary displays retry option
- Navigation to working sections remains possible
- Retry mechanism recovers from failures

### 3. Multi-Section Navigation

Tests navigation between settings sections:
- Active section highlighting
- URL structure preservation
- State management across navigation
- Section-specific loading states

**Key Scenarios:**
- Navigation between Profile, Categories, Merchants sections
- Active section visual indicators
- URL patterns match expected structure
- Independent section loading

### 4. Form State Persistence

Validates that unsaved changes are preserved:
- User modifies form fields
- Navigates to different section
- Returns to original section
- Changes are still present

**Key Scenarios:**
- Multiple field modifications
- Navigation away and back
- Dirty state indicators
- Auto-save functionality

### 5. Loading States

Tests independent loading behavior:
- Each section loads independently
- Loading skeletons display correctly
- No blocking between sections
- Proper loading state cleanup

**Key Scenarios:**
- Delayed API responses
- Concurrent section loading
- Loading indicator display
- State transitions

### 6. Error Recovery

Validates network error handling:
- Initial API failure
- User retry action
- Successful recovery
- State consistency

**Key Scenarios:**
- Network failures followed by success
- Retry button functionality
- Error message display
- Recovery workflows

## Test Framework

### Dependencies

```json
{
  "@testing-library/react": "^16.3.0",
  "@testing-library/user-event": "^14.6.1",
  "@tanstack/react-query": "^5.60.5",
  "vitest": "^4.0.15",
  "jsdom": "^27.3.0"
}
```

### Test Setup

```typescript
/// <reference types="vitest/globals" />
// Add triple-slash reference for TypeScript support with Vitest globals

import React from 'react';
import { vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// Test wrapper with QueryClient (using wouter for routing, not react-router-dom)
function TestWrapper({ children }: { children: React.ReactNode }) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  
  return (
    <QueryClientProvider client={queryClient}>
      {children}
    </QueryClientProvider>
  );
}
```

### Mock Strategy

The tests use comprehensive API mocking with the MockSettingsPage component:

```typescript
// Mock API functions are injected into the component
const mockProfileApi = {
  getProfile: vi.fn().mockResolvedValue({
    fullName: 'John Doe',
    firstName: 'John',
    lastName: 'Doe',
    email: 'john@example.com',
    phoneNumberMobile: '+260971234567',
    occupation: 'Developer',
  }),
  updateProfile: vi.fn().mockResolvedValue({ success: true }),
};

const mockCategoriesApi = {
  getCategories: vi.fn().mockResolvedValue([
    { id: 1, name: 'Food' },
    { id: 2, name: 'Transport' },
  ]),
};

const mockMerchantsApi = {
  getMerchants: vi.fn().mockResolvedValue([
    { id: 1, name: 'Shoprite' },
    { id: 2, name: 'Shell' },
  ]),
};

// Mock toast notifications
vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));
```

### Error Boundary Testing

The MockSettingsPage includes a built-in ErrorBoundary component that:

1. **Catches Errors**: Intercepts JavaScript errors in child components
2. **Displays Fallback UI**: Shows user-friendly error message with section name
3. **Provides Retry**: Includes retry button to recover from failures
4. **Isolates Sections**: Prevents one section's error from crashing others

```typescript
// Section component throws errors for error boundary to catch
const CategoriesSection = () => {
  const { data: categories, isLoading, error } = useQuery({
    queryKey: ['categories', retryKey],
    queryFn: mockCategoriesApi.getCategories,
  });

  if (isLoading) return <div data-testid="loading-skeleton">Loading...</div>;
  if (error) throw error; // Error boundary catches this

  return (
    <div>
      <h2>Categories</h2>
      {categories?.map((cat: any) => (
        <div key={cat.id}>{cat.name}</div>
      ))}
    </div>
  );
};

// Wrapped in error boundary
<ErrorBoundary 
  sectionName="Categories" 
  onRetry={() => setRetryKey(prev => prev + 1)}
>
  <CategoriesSection />
</ErrorBoundary>
```

## Running Tests

### Integration Tests Only

```bash
# Run integration tests using npm script
npm run test:client:integration

# Run integration tests directly with Vitest
npx vitest run client/src/pages/settings/__tests__/integration.test.tsx --config client/vitest.config.ts

# Run with coverage
npx vitest run client/src/pages/settings/__tests__/integration.test.tsx --config client/vitest.config.ts --coverage

# Run in watch mode
npx vitest client/src/pages/settings/__tests__/integration.test.tsx --config client/vitest.config.ts
```

### All Tests

```bash
# Run complete client test suite (watch)
npm test

# Run all client tests once (no watch mode)
npm run test:run

# Run with verbose output
npx vitest --config client/vitest.config.ts --reporter=verbose

# Generate coverage report
npx vitest run --config client/vitest.config.ts --coverage
```

## Test Patterns

### 1. User Event Simulation

```typescript
const user = userEvent.setup();

// Realistic user interactions
const fullNameInput = screen.getByDisplayValue('John Doe');
await user.clear(fullNameInput);
await user.type(fullNameInput, 'Jane Smith');

const saveButton = screen.getByRole('button', { name: /save/i });
await user.click(saveButton);
```

### 2. Loading State Testing

```typescript
// Test loading skeleton display
render(<MockSettingsPage defaultSection="profile" />);

// Initially shows loading skeleton
expect(screen.getByTestId('loading-skeleton')).toBeInTheDocument();

// Wait for data to load
await waitFor(() => {
  expect(screen.queryByTestId('loading-skeleton')).not.toBeInTheDocument();
});

// Content is now visible
expect(screen.getByDisplayValue('John Doe')).toBeInTheDocument();
```

### 3. Error Boundary Testing

```typescript
// Mock API to return no data (triggers error)
mockCategoriesApi.getCategories.mockResolvedValue(null);

// Navigate to categories section
const categoriesButton = screen.getByTestId('nav-categories');
await user.click(categoriesButton);

// Error boundary catches and displays error
expect(screen.getByText('Categories failed to load')).toBeInTheDocument();
expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument();

// Retry recovers from error
mockCategoriesApi.getCategories.mockResolvedValue([
  { id: 1, name: 'Food' },
]);

const retryButton = screen.getByRole('button', { name: /retry/i });
await user.click(retryButton);

// Section loads successfully
await waitFor(() => {
  expect(screen.getByText('Food')).toBeInTheDocument();
});
```

### 4. API Failure State Preservation Testing

```typescript
// Test that form state is preserved when API calls fail
import fc from 'fast-check';

// Simple alphanumeric string generator
const safeStringArb = fc.stringMatching(/^[a-zA-Z][a-zA-Z0-9]{0,19}$/);

// Helper to create test setup
const createTestSetup = (initialData: Record<string, unknown>) => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: Infinity },
      mutations: { retry: false },
    },
  });

  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      {children}
    </QueryClientProvider>
  );

  return { queryClient, wrapper };
};

// Helper to setup mock fetch
const setupMockFetch = (initialData: Record<string, unknown>, failOnPut = true) => {
  global.fetch = vi.fn().mockImplementation((url: string, options?: RequestInit) => {
    if (url.includes('/api/settings/profile')) {
      if (options?.method === 'PUT') {
        if (failOnPut) {
          return Promise.resolve({
            ok: false,
            status: 500,
            json: () => Promise.resolve({ error: { message: 'Server error' } }),
          });
        }
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ data: { profile: initialData } }),
        });
      }
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ data: { profile: initialData } }),
      });
    }
    return Promise.reject(new Error('Unknown URL'));
  });
};

// Property: Form values SHALL be retained after API failure
// Uses fc.sample with for-loop for better test isolation
const testCases = fc.sample(safeStringArb, 10);

for (const fullName of testCases) {
  const initialData = {
    fullName,
    timezone: 'Africa/Lusaka',
    incomeFrequency: 'monthly',
    birthdayHideYear: false,
  };

  const { queryClient, wrapper } = createTestSetup(initialData);
  setupMockFetch(initialData);

  const { result, unmount } = renderHook(() => useProfileForm(), { wrapper });

  await waitFor(() => expect(result.current.isLoading).toBe(false), { timeout: 2000 });

  const beforeSave = result.current.form.getValues().fullName;

  await act(async () => {
    try {
      await result.current.saveProfile(result.current.form.getValues());
    } catch {
      // Expected
    }
  });

  const afterFailure = result.current.form.getValues().fullName;
  expect(afterFailure).toBe(beforeSave);

  unmount();
  queryClient.clear();
}
```

### 5. Mutation Testing

```typescript
// Test form submission with mutation
const user = userEvent.setup();

// Modify form
const fullNameInput = screen.getByDisplayValue('John Doe');
await user.clear(fullNameInput);
await user.type(fullNameInput, 'Jane Smith');

// Verify dirty state
expect(screen.getByText('Unsaved changes')).toBeInTheDocument();

// Submit form
const saveButton = screen.getByRole('button', { name: /save/i });
await user.click(saveButton);

// Button disabled during save
expect(saveButton).toBeDisabled();

// Wait for mutation to complete
await waitFor(() => {
  expect(mockProfileApi.updateProfile).toHaveBeenCalledWith({
    fullName: 'Jane Smith',
    firstName: '',
    lastName: '',
    email: '',
    phoneNumberMobile: '',
    occupation: '',
  });
});

// Success toast displayed
expect(toast.success).toHaveBeenCalledWith('Profile updated successfully');

// Dirty state cleared
expect(screen.queryByText('Unsaved changes')).not.toBeInTheDocument();
```

### 6. State Persistence Testing

```typescript
// Modify form without saving
await user.type(fullNameInput, 'Modified Name');

// Navigate away
const categoriesButton = screen.getByTestId('nav-categories');
await user.click(categoriesButton);

// Navigate back
const profileButton = screen.getByTestId('nav-profile');
await user.click(profileButton);

// Verify changes preserved
expect(screen.getByDisplayValue('Modified Name')).toBeInTheDocument();
expect(screen.getByText('Unsaved changes')).toBeInTheDocument();
```

### 7. Independent Section Loading

```typescript
// Profile section loads independently
render(<MockSettingsPage defaultSection="profile" />);

// Profile query is enabled
expect(mockProfileApi.getProfile).toHaveBeenCalled();

// Categories query is NOT enabled (different section)
expect(mockCategoriesApi.getCategories).not.toHaveBeenCalled();

// Navigate to categories
const categoriesButton = screen.getByTestId('nav-categories');
await user.click(categoriesButton);

// Now categories query is enabled
await waitFor(() => {
  expect(mockCategoriesApi.getCategories).toHaveBeenCalled();
});
```

## Coverage Goals

### Current Coverage

- **Integration Tests**: 100% of critical user workflows
- **Error Scenarios**: All major failure modes covered
- **Navigation Flows**: Complete section switching scenarios
- **State Management**: Form persistence and auto-save flows

### Target Metrics

- **User Workflows**: 100% coverage of primary use cases
- **Error Paths**: 90% coverage of failure scenarios
- **Component Integration**: 85% coverage of inter-component communication
- **API Integration**: 100% coverage of API interaction patterns

## Best Practices

### 1. Realistic User Interactions

- Use `userEvent` instead of `fireEvent` for realistic interactions
- Test complete workflows, not isolated actions
- Include proper waiting for async operations

### 2. Comprehensive Error Testing

- Test both API failures and recovery scenarios
- Verify error boundaries isolate failures
- Ensure retry mechanisms work correctly

### 3. State Management Validation

- Test form state persistence across navigation
- Verify auto-save functionality
- Validate dirty state indicators

### 4. Accessibility Integration

- Test keyboard navigation workflows
- Verify screen reader announcements
- Ensure focus management in error scenarios

## Maintenance

### Adding New Tests

1. **Identify User Workflow**: Define the complete user journey
2. **Setup Test Data**: Create realistic mock data
3. **Simulate User Actions**: Use userEvent for interactions
4. **Verify Outcomes**: Check both success and failure paths
5. **Test Error Recovery**: Ensure graceful error handling

### Updating Existing Tests

1. **Review Test Scenarios**: Ensure they match current workflows
2. **Update Mock Data**: Keep mock responses current with API changes
3. **Verify Assertions**: Ensure expectations match current behavior
4. **Test Error Paths**: Update error scenarios for new failure modes

## Integration with CI/CD

### Pre-commit Hooks

```bash
# Run integration tests before commit
npm run test:client:integration -- --passWithNoTests
```

### Build Pipeline

```yaml
# GitHub Actions example
- name: Run Integration Tests
  run: |
    npm run test:client:integration -- --coverage
    # add coverage reporting here if desired
```

### Quality Gates

- **Test Pass Rate**: 100% of integration tests must pass
- **Coverage Threshold**: Maintain 85%+ coverage on integration scenarios
- **Performance**: Tests must complete within 60 seconds
- **Reliability**: Tests must be deterministic and not flaky

## Troubleshooting

### Common Issues

1. **Async Timing**: Use `waitFor` for async operations
2. **Mock Cleanup**: Ensure mocks are reset between tests
3. **State Isolation**: Clear component state between test cases
4. **Memory Leaks**: Properly cleanup event listeners and timers

### Debug Strategies

```typescript
// Debug test failures
screen.debug(); // Print current DOM
console.log(screen.getByRole('button', { name: /save/i })); // Find elements
```

### Performance Optimization

- Use `screen.getByRole` instead of `querySelector`
- Minimize DOM queries with proper selectors
- Use `waitFor` efficiently to avoid unnecessary delays
- Mock heavy operations to focus on integration logic

## Recent Enhancements (December 2025)

### LiveRegion Component Performance Optimization (December 11, 2025)

The `useLiveRegion` hook was optimized to prevent unnecessary re-renders by memoizing the returned component:

**Change:**
- Wrapped the `LiveRegion` component in `React.useMemo` with `[message, priority]` dependencies
- Component function only recreated when message or priority changes
- Provides stable component reference to consuming components

**Benefits:**
- Improved performance for accessibility features
- Reduced unnecessary re-renders in `AccessibleToastProvider` and other consumers
- Better React DevTools profiling results
- Follows React best practices for component memoization

**Usage Example:**
```typescript
const { LiveRegion, announce } = useLiveRegion();

// LiveRegion is now a stable, memoized component
return (
  <>
    <button onClick={() => announce('Success!', 'polite')}>
      Trigger Announcement
    </button>
    <LiveRegion /> {/* Stable reference, won't cause unnecessary re-renders */}
  </>
);
```

### MockSettingsPage Component Upgrade

The MockSettingsPage component was significantly enhanced to provide more realistic testing scenarios:

**Before:**
- Simple state management with useState
- Simulated API calls with setTimeout
- Basic section rendering
- No error boundaries
- No loading states

**After:**
- **TanStack Query Integration**: Real query/mutation hooks with proper caching and invalidation
- **Error Boundaries**: Section-level error isolation with retry functionality
- **Loading States**: Query-based loading indicators per section
- **Mutation Management**: Proper mutation state (pending, success, error)
- **Toast Integration**: Real toast notifications using Sonner
- **Query Invalidation**: Proper cache invalidation after mutations
- **Retry Mechanisms**: Query retry with key-based invalidation
- **Proper React Patterns**: Components follow React hooks rules with hooks inside component functions

**Benefits:**
1. **More Realistic Tests**: Tests now use the same patterns as production code
2. **Better Error Testing**: Error boundaries can be tested in isolation
3. **Loading State Validation**: Independent loading states per section can be verified
4. **Mutation Testing**: Form submissions use real mutation hooks
5. **Cache Behavior**: Query caching and invalidation can be tested
6. **Retry Logic**: Error recovery mechanisms can be validated
7. **Type Safety**: Proper TypeScript types with optional chaining for null safety
8. **React Compliance**: Follows React hooks rules with proper component structure

**Example Usage:**

```typescript
// Test with realistic query/mutation behavior
render(<MockSettingsPage defaultSection="profile" />);

// Loading state appears first
expect(screen.getByTestId('loading-skeleton')).toBeInTheDocument();

// Wait for query to resolve
await waitFor(() => {
  expect(screen.getByDisplayValue('John Doe')).toBeInTheDocument();
});

// Modify and save using mutation
const input = screen.getByDisplayValue('John Doe');
await user.clear(input);
await user.type(input, 'Jane Smith');

const saveButton = screen.getByRole('button', { name: /save/i });
await user.click(saveButton);

// Mutation pending state
expect(saveButton).toBeDisabled();

// Wait for mutation success
await waitFor(() => {
  expect(toast.success).toHaveBeenCalledWith('Profile updated successfully');
});
```

## Future Enhancements

### Planned Additions

1. **Visual Regression Tests**: Screenshot comparison for UI consistency
2. **Performance Integration**: Measure and validate loading times
3. **Accessibility Integration**: Automated a11y testing in workflows
4. **Cross-browser Testing**: Validate behavior across browsers
5. **Mobile Integration**: Touch interaction and responsive behavior testing
6. **Network Simulation**: Test with various network conditions (slow, offline, intermittent)

### Monitoring

- **Test Execution Time**: Track and optimize slow tests
- **Flaky Test Detection**: Identify and fix unreliable tests
- **Coverage Trends**: Monitor coverage changes over time
- **Failure Analysis**: Categorize and address common failure patterns
