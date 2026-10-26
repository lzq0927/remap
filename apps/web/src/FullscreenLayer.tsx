import { useLayoutEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";

/** A browser top-layer modal: independent of workflow / Agent stacking contexts. */
export default function FullscreenLayer({
  children,
  onClose,
  label,
}: {
  children: ReactNode;
  onClose: () => void;
  label: string;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useLayoutEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialog.current?.showModal();
    return () => {
      document.body.style.overflow = overflow;
      previous?.focus({ preventScroll: true });
    };
  }, []);
  return createPortal(
    <dialog
      ref={dialog}
      className="diagram-full-dialog"
      aria-label={label}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
    >
      {children}
    </dialog>,
    document.body,
  );
}
