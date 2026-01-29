/**
 * FolderInput component
 * A text input with path autocomplete functionality
 *
 * Features:
 * - Autocomplete suggestions as user types
 * - Tab completion like CLI
 * - Keyboard navigation (arrow keys, enter, escape)
 * - Support for directories only or files+directories
 */

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { apiUrl, authFetch } from '../../utils/storage';

interface PathSuggestion {
  name: string;
  path: string;
  isDirectory: boolean;
}

interface FolderInputProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit?: () => void;
  placeholder?: string;
  className?: string;
  directoriesOnly?: boolean;
  autoFocus?: boolean;
  hasError?: boolean;
  disabled?: boolean;
}

export function FolderInput({
  value,
  onChange,
  onSubmit,
  placeholder = '/path/to/folder',
  className = '',
  directoriesOnly = true,
  autoFocus = false,
  hasError = false,
  disabled = false,
}: FolderInputProps) {
  const [suggestions, setSuggestions] = useState<PathSuggestion[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const suggestionsRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<NodeJS.Timeout | null>(null);

  // Fetch suggestions from backend
  const fetchSuggestions = useCallback(async (path: string) => {
    if (!path) {
      setSuggestions([]);
      return;
    }

    setIsLoading(true);
    try {
      const params = new URLSearchParams({
        path,
        dirs: directoriesOnly ? 'true' : 'false',
        limit: '15',
      });
      const response = await authFetch(apiUrl(`/api/files/autocomplete?${params}`));
      if (response.ok) {
        const data = await response.json();
        setSuggestions(data.suggestions || []);
        setSelectedIndex(-1);
      }
    } catch (err) {
      console.error('Failed to fetch path suggestions:', err);
    } finally {
      setIsLoading(false);
    }
  }, [directoriesOnly]);

  // Debounced fetch
  useEffect(() => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }

    if (value && showSuggestions) {
      debounceRef.current = setTimeout(() => {
        fetchSuggestions(value);
      }, 150);
    } else {
      setSuggestions([]);
    }

    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
    };
  }, [value, showSuggestions, fetchSuggestions]);

  // Handle input change
  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    onChange(e.target.value);
    setShowSuggestions(true);
  };

  // Select a suggestion
  const selectSuggestion = useCallback((suggestion: PathSuggestion) => {
    // If it's a directory, append / to allow further navigation
    const newValue = suggestion.isDirectory ? suggestion.path + '/' : suggestion.path;
    onChange(newValue);
    setShowSuggestions(suggestion.isDirectory); // Keep open for directories
    setSelectedIndex(-1);
    inputRef.current?.focus();

    // Fetch new suggestions if it's a directory
    if (suggestion.isDirectory) {
      fetchSuggestions(newValue);
    }
  }, [onChange, fetchSuggestions]);

  // Handle keyboard navigation
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!showSuggestions || suggestions.length === 0) {
      if (e.key === 'Enter' && onSubmit) {
        e.preventDefault();
        onSubmit();
      }
      if (e.key === 'Escape') {
        setShowSuggestions(false);
      }
      return;
    }

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setSelectedIndex(prev =>
          prev < suggestions.length - 1 ? prev + 1 : prev
        );
        break;
      case 'ArrowUp':
        e.preventDefault();
        setSelectedIndex(prev => prev > 0 ? prev - 1 : -1);
        break;
      case 'Tab':
        e.preventDefault();
        if (suggestions.length > 0) {
          const idx = selectedIndex >= 0 ? selectedIndex : 0;
          selectSuggestion(suggestions[idx]);
        }
        break;
      case 'Enter':
        e.preventDefault();
        if (selectedIndex >= 0 && suggestions[selectedIndex]) {
          selectSuggestion(suggestions[selectedIndex]);
        } else if (onSubmit) {
          setShowSuggestions(false);
          onSubmit();
        }
        break;
      case 'Escape':
        e.preventDefault();
        setShowSuggestions(false);
        setSelectedIndex(-1);
        break;
    }
  };

  // Handle focus
  const handleFocus = () => {
    setShowSuggestions(true);
    if (value) {
      fetchSuggestions(value);
    }
  };

  // Handle blur (close suggestions after delay to allow click)
  const handleBlur = () => {
    setTimeout(() => {
      setShowSuggestions(false);
      setSelectedIndex(-1);
    }, 200);
  };

  // Scroll selected item into view
  useEffect(() => {
    if (selectedIndex >= 0 && suggestionsRef.current) {
      const items = suggestionsRef.current.querySelectorAll('.folder-input-suggestion');
      const selectedItem = items[selectedIndex] as HTMLElement;
      if (selectedItem) {
        selectedItem.scrollIntoView({ block: 'nearest' });
      }
    }
  }, [selectedIndex]);

  const inputClassName = [
    'folder-input',
    className,
    hasError ? 'error' : '',
  ].filter(Boolean).join(' ');

  return (
    <div className="folder-input-container">
      <input
        ref={inputRef}
        type="text"
        className={inputClassName}
        value={value}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        onFocus={handleFocus}
        onBlur={handleBlur}
        placeholder={placeholder}
        autoFocus={autoFocus}
        disabled={disabled}
        autoComplete="off"
        spellCheck={false}
      />
      {showSuggestions && (suggestions.length > 0 || isLoading) && (
        <div ref={suggestionsRef} className="folder-input-suggestions">
          {isLoading && suggestions.length === 0 ? (
            <div className="folder-input-loading">Loading...</div>
          ) : (
            suggestions.map((suggestion, index) => (
              <div
                key={suggestion.path}
                className={`folder-input-suggestion ${index === selectedIndex ? 'selected' : ''}`}
                onClick={() => selectSuggestion(suggestion)}
                onMouseEnter={() => setSelectedIndex(index)}
              >
                <span className="folder-input-suggestion-icon">
                  {suggestion.isDirectory ? '📁' : '📄'}
                </span>
                <span className="folder-input-suggestion-name">
                  {suggestion.name}
                </span>
                {suggestion.isDirectory && (
                  <span className="folder-input-suggestion-hint">/</span>
                )}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
