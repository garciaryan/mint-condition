"use client";

import { useDisclosure } from "@/hooks/useDisclosure.ts";

// An ⓘ button that shows what a setting changes. The text is always in the page (hidden until opened) so the field
// can point at it with aria-describedby and screen readers hear it without opening the bubble.
export default function HelpTip({ id, label, text }: { id: string; label: string; text: string }) {
  const { open, toggle, root, button } = useDisclosure();
  return (
    <span ref={root} className="help-tip">
      <button
        ref={button}
        type="button"
        className="help-toggle"
        aria-label={`What ${label} changes`}
        aria-expanded={open}
        aria-controls={id}
        onClick={toggle}
      >
        <span aria-hidden="true">ⓘ</span>
      </button>
      <span id={id} className="help-bubble" hidden={!open}>
        {text}
      </span>
    </span>
  );
}
