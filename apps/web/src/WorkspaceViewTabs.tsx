import { useCallback, useState } from "react";

/** Display-only preference: no API writes or changes to frozen design inputs. */
export function useViewPreference(key: string, initial: string) {
  const [value, setValue] = useState(() => {
    try {
      return typeof sessionStorage === "undefined"
        ? initial
        : (sessionStorage.getItem(key) ?? initial);
    } catch {
      return initial;
    }
  });
  const change = useCallback(
    (next: string) => {
      setValue(next);
      try {
        sessionStorage.setItem(key, next);
      } catch {
        /* Private/embedded browser may block storage. */
      }
    },
    [key],
  );
  return [value, change] as const;
}

export default function WorkspaceViewTabs({
  name,
  value,
  onChange,
  options,
  idPrefix,
  panelId,
}: {
  name: string;
  value: string;
  onChange: (value: string) => void;
  options: { id: string; label: string }[];
  idPrefix: string;
  panelId: string;
}) {
  return (
    <div className="workspace-view-tabs" role="tablist" aria-label={name}>
      {options.map((option, index) => (
        <button
          key={option.id}
          id={`${idPrefix}-${option.id}`}
          type="button"
          role="tab"
          aria-selected={value === option.id}
          aria-controls={panelId}
          tabIndex={value === option.id ? 0 : -1}
          onClick={() => onChange(option.id)}
          onKeyDown={(event) => {
            let next = index;
            if (event.key === "ArrowRight") next = (index + 1) % options.length;
            else if (event.key === "ArrowLeft")
              next = (index + options.length - 1) % options.length;
            else if (event.key === "Home") next = 0;
            else if (event.key === "End") next = options.length - 1;
            else return;
            event.preventDefault();
            onChange(options[next].id);
            document.getElementById(`${idPrefix}-${options[next].id}`)?.focus();
          }}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
