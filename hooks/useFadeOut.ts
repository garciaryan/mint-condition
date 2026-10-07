"use client";

import { useEffect, useRef, useState } from "react";
import { exitMs } from "@/lib/motion.ts";

/** Close with a fade: `start` adds the closing state (CSS fades it out), then calls `onDone` once the fade is over. */
export function useFadeOut(onDone: () => void): { closing: boolean; start: () => void } {
  const [closing, setClosing] = useState(false);
  const doneRef = useRef(onDone);
  doneRef.current = onDone;
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  function start() {
    if (timer.current !== undefined) return;
    setClosing(true);
    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    timer.current = setTimeout(() => doneRef.current(), exitMs(reduced));
  }
  return { closing, start };
}
