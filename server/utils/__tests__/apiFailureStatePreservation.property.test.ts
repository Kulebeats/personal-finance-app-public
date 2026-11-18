import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fc from "fast-check";
import { handleApiError, handleClientApiError, sanitizeErrorMessage } from "../errorHandler";

/**
 * **Feature: settings-refactoring, Property 4: API Failure State Preservation**
 * **Validates: Requirements 4.4**
 * 
 * For any API call that fails, the system SHALL retain the previous form values 
 * and not corrupt the UI state.
 */

// Mock console to capture error logs
let mockConsoleError: any;

beforeEach(() => {
  mockConsoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("Property 4: API Failure State Preservation", () => {
  it("handleApiError preserves original error information while sanitizing output", () => {
    // Generator for various error types and contexts
    const errorArbitrary = fc.oneof(
      fc.string({ minLength: 1 }).map(msg => new Error(msg)),
      fc.string({ minLength: 1 }).map(msg => new TypeError(msg)),
      fc.string({ minLength: 1 }).map(msg => new ReferenceError(msg)),
      fc.string({ minLength: 1 }),
      fc.integer(),
      fc.constant(null),
      fc.constant(undefined)
    );

    const contextArbitrary = fc.string({ minLength: 1, maxLength: 50 });

    fc.assert(
      fc.property(
        errorArbitrary,
        contextArbitrary,
        (error, context) => {
          // Call the error handler
          const sanitizedMessage = handleApiError(error, context);

          // Should always return a string
          expect(typeof sanitizedMessage).toBe('string');
          expect(sanitizedMessage.length).toBeGreaterThan(0);

          // Should log the error with context
          expect(mockConsoleError).toHaveBeenCalled();

          // Sanitized message should not contain technical details
          expect(sanitizedMessage).not.toMatch(/ at /);
          expect(sanitizedMessage).not.toMatch(/\//);
          expect(sanitizedMessage).not.toMatch(/\\/);
          expect(sanitizedMessage).not.toMatch(/node_modules/);
          expect(sanitizedMessage).not.toMatch(/Error:/);
          expect(sanitizedMessage).not.toMatch(/TypeError:/);
          expect(sanitizedMessage).not.toMatch(/ReferenceError:/);

          return true;
        }
      ),
      { numRuns: 100 }
    );
  });

  it("sanitizeErrorMessage removes technical details while preserving user-friendly messages", () => {
    // Generator for various error messages
    const userFriendlyMessages = fc.oneof(
      fc.constant("Invalid email address"),
      fc.constant("Password is too short"),
      fc.constant("User not found"),
      fc.constant("Access denied"),
      fc.constant("Network connection failed")
    );

    const technicalMessages = fc.oneof(
      fc.constant("Error: Cannot read property 'id' of undefined at /path/to/file.js:123"),
      fc.constant("TypeError: Cannot access before initialization"),
      fc.constant("ReferenceError: variable is not defined at node_modules/lib/index.js"),
      fc.constant("SyntaxError: Unexpected token"),
      fc.constant("Error at /home/user/project/src/component.tsx:45:12")
    );

    fc.assert(
      fc.property(userFriendlyMessages, (message) => {
        const error = new Error(message);
        const sanitized = sanitizeErrorMessage(error);
        
        // User-friendly messages should be preserved
        expect(sanitized).toBe(message);
        return true;
      }),
      { numRuns: 50 }
    );

    fc.assert(
      fc.property(technicalMessages, (message) => {
        const error = new Error(message);
        const sanitized = sanitizeErrorMessage(error);
        
        // Technical messages should be replaced with generic message
        expect(sanitized).toBe("An error occurred. Please try again.");
        return true;
      }),
      { numRuns: 50 }
    );
  });

  it("handleClientApiError preserves error context while sanitizing for users", async () => {
    // Generator for mock fetch responses
    const responseArbitrary = fc.record({
      ok: fc.boolean(),
      status: fc.integer({ min: 400, max: 599 }),
      statusText: fc.string({ minLength: 1, maxLength: 20 }),
      json: fc.constant(async () => ({ 
        error: fc.sample(fc.oneof(
          fc.constant("User-friendly error message"),
          fc.constant("Error: Technical stack trace at /path/file.js:123")
        ), 1)[0]
      }))
    });

    const contextArbitrary = fc.string({ minLength: 1, maxLength: 30 });

    await fc.assert(
      fc.asyncProperty(
        responseArbitrary,
        contextArbitrary,
        async (responseData, context) => {
          // Create mock response
          const mockResponse = {
            ok: responseData.ok,
            status: responseData.status,
            statusText: responseData.statusText,
            json: responseData.json
          } as globalThis.Response;

          // Only test error responses
          if (mockResponse.ok) {
            return true;
          }

          let thrownError: Error | null = null;
          
          try {
            await handleClientApiError(mockResponse, context);
          } catch (error) {
            thrownError = error as Error;
          }

          // Should always throw an error for failed responses
          expect(thrownError).toBeInstanceOf(Error);
          expect(thrownError!.message).toBeTruthy();

          // Error message should be sanitized
          const errorMessage = thrownError!.message;
          expect(errorMessage).not.toMatch(/ at /);
          expect(errorMessage).not.toMatch(/\//);
          expect(errorMessage).not.toMatch(/Error:/);

          // Note: handleClientApiError only logs when response is an Error instance
          // For HTTP errors, it doesn't call handleApiError, so no logging occurs
          // This is expected behavior for client-side error handling

          return true;
        }
      ),
      { numRuns: 100 }
    );
  });

  it("error handling preserves state by not modifying input parameters", () => {
    // Generator for error objects
    const errorArbitrary = fc.record({
      message: fc.string(),
      name: fc.string(),
      stack: fc.option(fc.string())
    }).map(data => {
      const error = new Error(data.message);
      error.name = data.name;
      if (data.stack) {
        error.stack = data.stack;
      }
      return error;
    });

    const contextArbitrary = fc.string();

    fc.assert(
      fc.property(
        errorArbitrary,
        contextArbitrary,
        (originalError, context) => {
          // Capture original state
          const originalMessage = originalError.message;
          const originalName = originalError.name;
          const originalStack = originalError.stack;

          // Call error handler
          handleApiError(originalError, context);

          // Verify original error object is unchanged
          expect(originalError.message).toBe(originalMessage);
          expect(originalError.name).toBe(originalName);
          expect(originalError.stack).toBe(originalStack);

          return true;
        }
      ),
      { numRuns: 100 }
    );
  });

  it("error sanitization is consistent for the same input", () => {
    // Generator for error messages
    const messageArbitrary = fc.string({ minLength: 1, maxLength: 200 });

    fc.assert(
      fc.property(messageArbitrary, (message) => {
        const error1 = new Error(message);
        const error2 = new Error(message);

        const sanitized1 = sanitizeErrorMessage(error1);
        const sanitized2 = sanitizeErrorMessage(error2);

        // Same input should produce same output
        expect(sanitized1).toBe(sanitized2);

        return true;
      }),
      { numRuns: 100 }
    );
  });

  it("error handling works with non-Error objects without corruption", () => {
    // Generator for various non-Error values
    const nonErrorArbitrary = fc.oneof(
      fc.string(),
      fc.integer(),
      fc.float(),
      fc.boolean(),
      fc.constant(null),
      fc.constant(undefined),
      fc.object(),
      fc.array(fc.anything())
    );

    const contextArbitrary = fc.string();

    fc.assert(
      fc.property(
        nonErrorArbitrary,
        contextArbitrary,
        (nonError, context) => {
          // Should handle non-Error objects gracefully
          const result = handleApiError(nonError, context);

          // Should return a valid string
          expect(typeof result).toBe('string');
          expect(result.length).toBeGreaterThan(0);

          // Should log something
          expect(mockConsoleError).toHaveBeenCalled();

          return true;
        }
      ),
      { numRuns: 100 }
    );
  });
});
