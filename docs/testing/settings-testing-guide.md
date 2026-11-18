# Settings Feature Testing Guide

## 🧪 Testing Infrastructure

### Integration Tests

The settings feature includes comprehensive integration tests with a sophisticated mock infrastructure:

**Test Suite:** `finance-app/client/src/pages/settings/__tests__/integration.test.tsx`

**Mock Component:** `finance-app/client/src/pages/settings/__tests__/mocks/MockSettingsPage.tsx`

**Mock Features:**
- **TanStack Query Integration**: Real query/mutation hooks for realistic API state management
- **Error Boundaries**: Section-level error isolation with retry functionality
- **Loading States**: Independent loading skeletons per section
- **Form State Management**: Dirty state tracking and mutation-based updates
- **Toast Notifications**: Success/error feedback using Sonner
- **TypeScript Compliance**: Fully typed with proper React patterns
- **React Hooks Rules**: Components properly structured with hooks inside function components

**Test Coverage:**
- **Profile Save and Retrieve Workflows**: End-to-end form submission with mutations
- **Section Isolation on Error**: Error boundaries prevent cascading failures
- **Multi-Section Navigation**: State preservation across section changes
- **Form State Persistence**: Unsaved changes retained during navigation
- **Loading States**: Independent loading indicators per section with query-based fetching
- **Error Recovery**: Network error handling with retry mechanisms and query invalidation

### Property-Based Tests

The codebase includes property-based tests using fast-check for:
- **API Failure State Preservation**: Form values retained after API failures (uses `fc.sample` pattern with reusable helpers, 10 runs, 60s timeout)
- **Session Audit Logging**: Validates session operations are properly logged
- **Environment Validation**: Ensures startup configuration validation
- **Transaction Atomicity**: Database transaction rollback on failures
- **Accessibility Attributes**: Interactive elements have proper ARIA labels
- **URL Structure Compatibility**: Navigation maintains expected URL patterns
- **API Endpoint Compatibility**: Backward compatibility of API calls
- **End-to-End Scenarios**: Complete user workflows with random data generation

### Test Categories

1. **Unit Tests**: Individual component and utility function testing
2. **Integration Tests**: Complete user workflow testing
3. **Property Tests**: Invariant validation across random inputs
4. **Accessibility Tests**: Screen reader and keyboard navigation compliance
5. **Performance Tests**: Loading states and optimization verification

## 🧪 Manual Testing Checklist

### 1. Profile Completeness Bar

- [ ] **Visual Progress**: Bar shows completion percentage
- [ ] **Color Coding**: Red (0-40%), Yellow (41-70%), Green (71-100%)
- [ ] **Suggestions**: Shows actionable suggestions for missing fields
- [ ] **Real-time Updates**: Progress updates as fields are filled

### 2. Auto-Save Functionality

- [ ] **Auto-Save**: Changes save automatically after 2 seconds
- [ ] **Status Indicator**: Shows "Saving...", "Saved", or "Error" states
- [ ] **Undo/Redo**: Buttons work to revert/restore changes
- [ ] **Change History**: Tooltip shows recent changes
- [ ] **No Manual Save**: No traditional save button needed

### 3. Multiple Phone Number Inputs

- [ ] **Three Fields**: Mobile (required), Work, Home
- [ ] **Zambian Default**: Country defaults to ZM (+260)
- [ ] **Format Preview**: Shows "097 123 4567" format
- [ ] **Validation**: Green checkmark for valid Zambian numbers
- [ ] **Hints**: Shows format hints for Zambian numbers

### 4. Industry-Grouped Occupation Selector

- [ ] **Categories**: 11 industry categories with icons
- [ ] **Search**: Real-time search across all occupations
- [ ] **Custom Entry**: "Add custom occupation" option
- [ ] **250+ Options**: Comprehensive occupation list
- [ ] **Clinical Informatics**: Verify it appears in Technology category

### 5. Enhanced Date Picker

- [ ] **Quick Age**: "I'm 25 years old" auto-calculates birth year
- [ ] **Age Display**: Shows calculated age next to date
- [ ] **Privacy Option**: Checkbox to hide birth year
- [ ] **Dropdown Navigation**: Year and month dropdowns work
- [ ] **Range**: Years from 1920 to current year

### 6. Smart Timezone Selector

- [ ] **Auto-Detection**: "Auto-detect my timezone" button works
- [ ] **Current Time**: Shows current time in selected timezone
- [ ] **Search**: Searchable timezone list
- [ ] **Default**: Defaults to Africa/Lusaka for Zambian users
- [ ] **Format**: "UTC+02:00 Lusaka, Zambia" format

### 7. Intelligent City Selector

- [ ] **Zambian Priority**: Zambian cities appear first
- [ ] **Auto-Population**: Selecting city auto-fills country
- [ ] **Timezone Auto-Set**: City selection updates timezone
- [ ] **Search**: Real-time city search
- [ ] **120+ Cities**: Comprehensive city database

### 8. Salary Range Selector

- [ ] **Privacy Icon**: Shield icon with tooltip
- [ ] **Zambian Ranges**: 6 salary ranges (Under K5,000 to Over K100,000)
- [ ] **Optional Field**: Clearly marked as optional
- [ ] **Encryption**: Data stored encrypted (backend)

## 🎯 User Experience Tests

### Zambian User Flow

1. **New User**: Start with empty profile
2. **Phone**: Enter +260 97 123 4567 → See format preview
3. **City**: Select "Lusaka" → Country auto-fills "Zambia"
4. **Timezone**: Verify auto-set to "UTC+02:00 Lusaka, Zambia"
5. **Age**: Enter "25" in age field → Birth year calculated
6. **Occupation**: Search "clinical" → Find "Clinical Informatics Specialist"
7. **Progress**: Watch completeness bar increase
8. **Auto-Save**: See changes save automatically

### Data Enrichment Flow

1. **City Selection**: Choose any city
2. **Verify Auto-Fill**: Country field updates automatically
3. **Timezone Update**: Timezone changes to city's timezone
4. **Phone Code**: Country code updates for phone input

### Privacy Controls

1. **Birthday Privacy**: Check "Hide birth year" option
2. **Salary Privacy**: Hover over shield icon for tooltip
3. **Optional Fields**: Verify salary range is clearly optional

## 🔧 Technical Validation

### Component Integration

- [ ] All imports resolve correctly
- [ ] No TypeScript errors
- [ ] CSS styles apply properly
- [ ] Event handlers work correctly

### Data Validation

- [ ] Phone numbers validate correctly
- [ ] Date ranges work (1920 to current year)
- [ ] Timezone detection works
- [ ] City search is case-insensitive

### Performance

- [ ] Auto-save debouncing works (2-second delay)
- [ ] Search is responsive
- [ ] No memory leaks in change history
- [ ] Smooth animations and transitions

## 🚨 Error Handling

### Validation Errors

- [ ] Invalid phone numbers show error state
- [ ] Required fields show validation messages
- [ ] Date validation prevents future dates
- [ ] Form prevents submission with errors

### Network Errors

- [ ] Auto-save handles network failures gracefully
- [ ] Error states are clearly communicated
- [ ] Retry mechanisms work properly

## 📱 Mobile Responsiveness

### Layout Tests

- [ ] Profile completeness bar scales properly
- [ ] Phone inputs work on mobile keyboards
- [ ] Dropdowns are touch-friendly
- [ ] Auto-save indicator is visible

### Touch Interactions

- [ ] All buttons are properly sized for touch
- [ ] Dropdowns open correctly on mobile
- [ ] Scrolling works in long lists
- [ ] Keyboard navigation is smooth

## 🎉 Success Criteria

✅ **Complete Implementation**: All 8 major features working
✅ **Zambian Context**: Default values and prioritization
✅ **Smart Auto-Population**: City → Country → Timezone flow
✅ **Privacy Controls**: Optional fields and encryption
✅ **Enhanced UX**: Auto-save, progress tracking, validation
✅ **No Breaking Changes**: Existing functionality preserved

## 🔍 Known Limitations

- LinkedIn integration not implemented (marked as future enhancement)
- Database session issues (requires environment setup)
- Some advanced validation rules may need refinement

## 🚀 Running Tests

### Integration Tests
```bash
# Run integration tests using npm script
npm run test:client:integration

# Run integration tests directly with Vitest
npx vitest run client/src/pages/settings/__tests__/integration.test.tsx --config client/vitest.config.ts

# Run with coverage
npx vitest run --config client/vitest.config.ts --coverage --testNamePattern="Integration"

# Run in watch mode
npx vitest --config client/vitest.config.ts --testNamePattern="Integration"
```

### Property-Based Tests
```bash
# Run property tests (server-side)
npm run test:server -- --testNamePattern="Property"

# Run specific property test
npx vitest run server/services/__tests__/SessionAuditLogging.property.test.ts --config server/vitest.config.ts

# Run client property tests
npx vitest run --config client/vitest.config.ts --testNamePattern="property"

# Run API failure state preservation test
npx vitest run client/src/pages/settings/__tests__/apiFailureStatePreservation.property.test.tsx --config client/vitest.config.ts
```

**Note:** The API failure state preservation test uses `fc.sample` with for-loops instead of `fc.assert` for better test isolation and cleaner error reporting. Each test case runs with its own QueryClient instance and explicit cleanup.

### All Tests
```bash
# Run complete client test suite
npm test

# Run all tests once (no watch mode)
npm run test:run

# Run server tests
npm run test:server

# Run tests with verbose output
npx vitest --config client/vitest.config.ts --reporter=verbose
```

## 📊 Test Results Summary

When all tests pass, users will experience:

- **75%+ Profile Completeness** on first complete fill
- **2-Second Auto-Save** with visual feedback
- **Intelligent Data Entry** with auto-population
- **Zambian-Optimized Experience** with local defaults
- **Privacy-Conscious Design** with optional sensitive fields
- **Error Isolation**: Individual section failures don't affect others
- **State Persistence**: Form changes preserved during navigation
- **Accessibility Compliance**: Full keyboard and screen reader support
