import { useEffect, useRef, useCallback } from 'react';
import { UseFormReturn, FieldValues } from 'react-hook-form';
import { useDebouncedCallback } from 'use-debounce';

interface UseAutoSaveFormOptions<T extends FieldValues> {
  form: UseFormReturn<T>;
  onSave: (data: T) => Promise<void>;
  debounceMs?: number;
  enabled?: boolean;
}

interface UseAutoSaveFormReturn {
  isSaving: boolean;
  lastSaved: Date | null;
  saveNow: () => Promise<void>;
}

export function useAutoSaveForm<T extends FieldValues>(
  options: UseAutoSaveFormOptions<T>
): UseAutoSaveFormReturn {
  const { form, onSave, debounceMs = 1000, enabled = true } = options;
  
  const isSavingRef = useRef(false);
  const lastSavedRef = useRef<Date | null>(null);

  const debouncedSave = useDebouncedCallback(async (data: T) => {
    if (isSavingRef.current) return;
    
    try {
      isSavingRef.current = true;
      await onSave(data);
      lastSavedRef.current = new Date();
    } catch (error) {
      console.error('Auto-save failed:', error);
    } finally {
      isSavingRef.current = false;
    }
  }, debounceMs);

  const saveNow = useCallback(async () => {
    const data = form.getValues();
    const isValid = await form.trigger();
    
    if (isValid) {
      debouncedSave.cancel();
      await onSave(data);
      lastSavedRef.current = new Date();
    }
  }, [form, onSave, debouncedSave]);

  useEffect(() => {
    if (!enabled) return;

    const subscription = form.watch((data) => {
      if (form.formState.isDirty && !form.formState.isSubmitting) {
        debouncedSave(data as T);
      }
    });

    return () => {
      subscription.unsubscribe();
      debouncedSave.cancel();
    };
  }, [form, debouncedSave, enabled]);

  return {
    isSaving: isSavingRef.current,
    lastSaved: lastSavedRef.current,
    saveNow,
  };
}
