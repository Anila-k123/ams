import { useEffect, useState } from "react";

/**
 * The value, but only after it has stopped changing for `delay` ms.
 *
 * Search boxes here fire a request per keystroke. Typing "university" meant ten
 * round trips, and on the slower field-scoped searches the replies could land
 * out of order - so the list briefly showed results for "universi" after
 * "university" had already been typed. Debouncing the value the request is
 * built from fixes both: one request, and it is always the latest one.
 */
export default function useDebouncedValue(value, delay = 300) {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    // Clearing on every change is what makes this a debounce rather than a
    // throttle: the timer only fires once typing pauses.
    return () => clearTimeout(t);
  }, [value, delay]);

  return debounced;
}
