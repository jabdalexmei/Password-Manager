import React, { useEffect, useMemo, useRef, useState } from 'react';

export type FolderSelectOption = {
  id: string;
  name: string;
};

type FolderSelectProps = {
  id: string;
  value: string | null;
  options: FolderSelectOption[];
  noneLabel: string;
  onChange: (folderId: string | null) => void;
  disabled?: boolean;
};

export function FolderSelect({
  id,
  value,
  options,
  noneLabel,
  onChange,
  disabled = false,
}: FolderSelectProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [isOpen, setIsOpen] = useState(false);

  const selectedLabel = useMemo(() => {
    if (!value) return noneLabel;
    const match = options.find((opt) => opt.id === value);
    return match?.name ?? noneLabel;
  }, [noneLabel, options, value]);

  useEffect(() => {
    if (!isOpen) return;

    const onMouseDown = (event: MouseEvent) => {
      const root = rootRef.current;
      if (!root) return;
      if (event.target instanceof Node && root.contains(event.target)) return;
      setIsOpen(false);
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setIsOpen(false);
    };

    window.addEventListener('mousedown', onMouseDown);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [isOpen]);

  const selectValue = (folderId: string | null) => {
    onChange(folderId);
    setIsOpen(false);
  };

  return (
    <div ref={rootRef} className="folder-select">
      <button
        id={id}
        type="button"
        className="folder-select__button"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        onClick={() => setIsOpen((open) => !open)}
      >
        <span className="folder-select__buttonLabel">{selectedLabel}</span>
        <span className="folder-select__buttonIcon" aria-hidden="true">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
            <path
              d="M7 10l5 5 5-5"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </span>
      </button>

      {isOpen ? (
        <div className="folder-select__menu" role="listbox" aria-labelledby={id}>
          <button
            type="button"
            className={`folder-select__option ${value === null ? 'is-selected' : ''}`}
            onClick={() => selectValue(null)}
          >
            {noneLabel}
          </button>
          {options.map((opt) => (
            <button
              key={opt.id}
              type="button"
              className={`folder-select__option ${value === opt.id ? 'is-selected' : ''}`}
              onClick={() => selectValue(opt.id)}
            >
              {opt.name}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
