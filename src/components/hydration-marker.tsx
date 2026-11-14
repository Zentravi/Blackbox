"use client";

import { useEffect } from "react";

/**
 * Sets `data-hydrated` on <html> once the client shell has committed and
 * effects have run — i.e. React event handlers are attached. E2E specs wait
 * on this attribute after page loads so the first click never lands on a
 * still-hydrating (handler-less) button.
 *
 * The attribute persists across client-side navigations (handlers stay
 * attached) and resets on full document loads.
 */
export function HydrationMarker() {
  useEffect(() => {
    document.documentElement.dataset.hydrated = "1";
    return () => {
      delete document.documentElement.dataset.hydrated;
    };
  }, []);
  return null;
}
