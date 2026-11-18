/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useAutoSave } from "../useAutoSave";
import { useUpdateProfile } from "../use-settings";

const updateProfileState = vi.hoisted(() => ({
  mutate: vi.fn(),
  isPending: false,
}));

// Mock the useUpdateProfile hook
vi.mock("../use-settings", () => ({
  useUpdateProfile: vi.fn(() => updateProfileState),
}));

const mockUseUpdateProfile = vi.mocked(useUpdateProfile);

// Mock toast
vi.mock("sonner", () => ({
  toast: {
    error: vi.fn(),
  },
}));

describe("useAutoSave", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    updateProfileState.mutate = vi.fn();
    updateProfileState.isPending = false;
    mockUseUpdateProfile.mockReturnValue(updateProfileState as unknown as ReturnType<typeof useUpdateProfile>);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("should initialize with correct default state", () => {
    const { result } = renderHook(
      ({ data }) => useAutoSave(data, { debounceMs: 1000 }),
      { initialProps: { data: { name: "John" } } }
    );

    expect(result.current.state.status).toBe("idle");
    expect(result.current.state.hasUnsavedChanges).toBe(false);
    expect(result.current.state.lastSaved).toBe(null);
    expect(result.current.history).toEqual([]);
    expect(result.current.canUndo).toBe(false);
    expect(result.current.canRedo).toBe(false);
  });

  it("should detect changes and set hasUnsavedChanges to true", () => {
    const { result, rerender } = renderHook(
      ({ data }) => useAutoSave(data, { debounceMs: 1000 }),
      { initialProps: { data: { name: "John" } } }
    );

    expect(result.current.state.hasUnsavedChanges).toBe(false);

    rerender({ data: { name: "Jane" } });

    expect(result.current.state.hasUnsavedChanges).toBe(true);
  });

  it("should debounce auto-save calls", () => {
    const mockMutate = vi.fn();
    updateProfileState.mutate = mockMutate;

    const { result, rerender } = renderHook(
      ({ data }) => useAutoSave(data, { debounceMs: 1000 }),
      { initialProps: { data: { name: "John" } } }
    );

    // Change data multiple times quickly
    rerender({ data: { name: "Jane" } });
    rerender({ data: { name: "Bob" } });
    rerender({ data: { name: "Alice" } });

    // Should not have called mutate yet
    expect(mockMutate).not.toHaveBeenCalled();

    // Fast-forward time
    act(() => {
      vi.advanceTimersByTime(1000);
    });

    // Should have called mutate only once with the latest data
    expect(mockMutate).toHaveBeenCalledTimes(1);
    expect(mockMutate).toHaveBeenCalledWith(
      { name: "Alice" },
      expect.any(Object)
    );
  });

  it("should maintain change history", () => {
    const { result, rerender } = renderHook(
      ({ data }) => useAutoSave(data, { debounceMs: 100, maxHistorySize: 5 }),
      { initialProps: { data: { name: "John" } } }
    );

    // Make changes
    rerender({ data: { name: "Jane" } });
    act(() => {
      vi.advanceTimersByTime(100);
    });

    rerender({ data: { name: "Bob" } });
    act(() => {
      vi.advanceTimersByTime(100);
    });

    expect(result.current.history.length).toBe(2);
    expect(result.current.history[0].description).toContain("name");
    expect(result.current.history[1].description).toContain("name");
  });

  it("should support undo functionality", () => {
    const { result, rerender } = renderHook(
      ({ data }) => useAutoSave(data, { debounceMs: 100 }),
      { initialProps: { data: { name: "John" } } }
    );

    // Make a change
    rerender({ data: { name: "Jane" } });
    act(() => {
      vi.advanceTimersByTime(100);
    });

    expect(result.current.canUndo).toBe(true);

    // Perform undo
    let undoResult;
    act(() => {
      undoResult = result.current.undo();
    });

    expect(undoResult).toEqual({ name: "John" });
  });

  it("should support redo functionality", () => {
    const { result, rerender } = renderHook(
      ({ data }) => useAutoSave(data, { debounceMs: 100 }),
      { initialProps: { data: { name: "John" } } }
    );

    // Make a change
    rerender({ data: { name: "Jane" } });
    act(() => {
      vi.advanceTimersByTime(100);
    });

    // Undo
    act(() => {
      result.current.undo();
    });

    expect(result.current.canRedo).toBe(true);

    // Perform redo
    let redoResult;
    act(() => {
      redoResult = result.current.redo();
    });

    expect(redoResult).toEqual({ name: "Jane" });
  });

  it("should limit history size", () => {
    const { result, rerender } = renderHook(
      ({ data }) => useAutoSave(data, { debounceMs: 50, maxHistorySize: 2 }),
      { initialProps: { data: { name: "John" } } }
    );

    // Make multiple changes
    for (let i = 0; i < 5; i++) {
      rerender({ data: { name: `Name${i}` } });
      act(() => {
        vi.advanceTimersByTime(50);
      });
    }

    expect(result.current.history.length).toBeLessThanOrEqual(2);
  });

  it("should call onSave callback when save succeeds", () => {
    const onSave = vi.fn();
    const mockMutate = vi.fn((data, options) => {
      options.onSuccess();
    });

    updateProfileState.mutate = mockMutate;

    const { rerender } = renderHook(
      ({ data }) => useAutoSave(data, { debounceMs: 100, onSave }),
      { initialProps: { data: { name: "John" } } }
    );

    rerender({ data: { name: "Jane" } });
    act(() => {
      vi.advanceTimersByTime(100);
    });

    expect(onSave).toHaveBeenCalledWith({ name: "Jane" });
  });

  it("should call onError callback when save fails", () => {
    const onError = vi.fn();
    const mockMutate = vi.fn((data, options) => {
      options.onError(new Error("Save failed"));
    });

    updateProfileState.mutate = mockMutate;

    const { rerender } = renderHook(
      ({ data }) => useAutoSave(data, { debounceMs: 100, onError }),
      { initialProps: { data: { name: "John" } } }
    );

    rerender({ data: { name: "Jane" } });
    act(() => {
      vi.advanceTimersByTime(100);
    });

    expect(onError).toHaveBeenCalledWith(expect.any(Error));
  });

  it("should support manual save", () => {
    const mockMutate = vi.fn();
    updateProfileState.mutate = mockMutate;

    const { result } = renderHook(
      ({ data }) => useAutoSave(data, { debounceMs: 1000 }),
      { initialProps: { data: { name: "John" } } }
    );

    act(() => {
      result.current.save();
    });

    act(() => {
      vi.advanceTimersByTime(1000);
    });

    expect(mockMutate).toHaveBeenCalledWith(
      { name: "John" },
      expect.any(Object)
    );
  });

  it("should reset state correctly", () => {
    const { result, rerender } = renderHook(
      ({ data }) => useAutoSave(data, { debounceMs: 100 }),
      { initialProps: { data: { name: "John" } } }
    );

    // Make changes
    rerender({ data: { name: "Jane" } });
    act(() => {
      vi.advanceTimersByTime(100);
    });

    expect(result.current.history.length).toBeGreaterThan(0);

    // Reset
    act(() => {
      result.current.reset();
    });

    expect(result.current.history).toEqual([]);
    expect(result.current.state.hasUnsavedChanges).toBe(false);
  });
});
