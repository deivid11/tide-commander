/**
 * Reusable hook for form state management
 * Provides field state, validation, and reset functionality
 */

import { useState, useCallback, useMemo } from 'react';

export interface FormState<T extends Record<string, unknown>> {
  /** Current form values */
  values: T;
  /** Whether any field has been modified from initial values */
  isDirty: boolean;
  /** Set a single field value */
  setField: <K extends keyof T>(field: K, value: T[K]) => void;
  /** Set multiple field values at once */
  setFields: (fields: Partial<T>) => void;
  /** Reset form to initial values */
  reset: () => void;
  /** Reset form to new initial values */
  resetTo: (newInitial: T) => void;
  /** Get props to spread on an input element */
  getInputProps: <K extends keyof T>(field: K) => {
    value: T[K];
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => void;
  };
  /** Get props for a checkbox input */
  getCheckboxProps: <K extends keyof T>(field: K) => {
    checked: boolean;
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  };
}

/**
 * Hook for managing form state with reset capabilities
 *
 * @example
 * const form = useFormState({
 *   name: '',
 *   email: '',
 *   enabled: false,
 * });
 *
 * // In JSX:
 * <input {...form.getInputProps('name')} />
 * <input {...form.getInputProps('email')} type="email" />
 * <input {...form.getCheckboxProps('enabled')} type="checkbox" />
 * <button onClick={form.reset}>Reset</button>
 * <button onClick={() => console.log(form.values)}>Submit</button>
 */
export function useFormState<T extends Record<string, unknown>>(
  initialValues: T
): FormState<T> {
  const [values, setValues] = useState<T>(initialValues);
  const [initialState, setInitialState] = useState<T>(initialValues);

  const isDirty = useMemo(() => {
    return Object.keys(initialState).some(
      key => values[key] !== initialState[key]
    );
  }, [values, initialState]);

  const setField = useCallback(<K extends keyof T>(field: K, value: T[K]) => {
    setValues(prev => ({ ...prev, [field]: value }));
  }, []);

  const setFields = useCallback((fields: Partial<T>) => {
    setValues(prev => ({ ...prev, ...fields }));
  }, []);

  const reset = useCallback(() => {
    setValues(initialState);
  }, [initialState]);

  const resetTo = useCallback((newInitial: T) => {
    setInitialState(newInitial);
    setValues(newInitial);
  }, []);

  const getInputProps = useCallback(<K extends keyof T>(field: K) => ({
    value: values[field] as T[K],
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
      const target = e.target;
      const value = target.type === 'number' ? Number(target.value) : target.value;
      setField(field, value as T[K]);
    },
  }), [values, setField]);

  const getCheckboxProps = useCallback(<K extends keyof T>(field: K) => ({
    checked: Boolean(values[field]),
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => {
      setField(field, e.target.checked as T[K]);
    },
  }), [values, setField]);

  return {
    values,
    isDirty,
    setField,
    setFields,
    reset,
    resetTo,
    getInputProps,
    getCheckboxProps,
  };
}

/**
 * Hook for managing form state that syncs with external data
 * Useful for edit forms where the data can change externally
 *
 * @example
 * const form = useSyncedFormState(
 *   agent, // external data that might change
 *   agent => ({ name: agent?.name || '', class: agent?.class || 'scout' })
 * );
 */
export function useSyncedFormState<TData, TForm extends Record<string, unknown>>(
  data: TData | undefined | null,
  transform: (data: TData | undefined | null) => TForm
): FormState<TForm> {
  const transformed = useMemo(() => transform(data), [data, transform]);
  const form = useFormState(transformed);

  // When external data changes, reset form to new values
  // This uses the reference equality of transformed values
  useMemo(() => {
    form.resetTo(transformed);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  return form;
}

export default useFormState;
