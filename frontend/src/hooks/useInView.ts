import { useEffect, useState } from "react";
import type { RefObject } from "react";

/** Whether at least `threshold` of the element is on screen. Starts true, so nothing hides without an observer. */
export function useInView(ref: RefObject<Element | null>, threshold = 0.35): boolean {
  const [inView, setInView] = useState(true);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        setInView((entry?.intersectionRatio ?? 1) >= threshold);
      },
      { threshold: [0, threshold, 1] },
    );
    observer.observe(el);
    return () => {
      observer.disconnect();
    };
  }, [ref, threshold]);
  return inView;
}
