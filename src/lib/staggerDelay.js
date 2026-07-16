// Shared by AnimatedHeadline (letter-delay-N) and AnimatedTagCascade (chip-delay-N).
// Tailwind's JIT scanner only generates a utility's CSS if its class name
// literally appears in source — a template-literal className is invisible to
// it, so callers must still spell out the matching @utility blocks in
// index.css for every index this can return. This only centralizes the JS
// array-building, not the CSS.
export function buildDelayClasses(prefix, count) {
  return Array.from({ length: count }, (_, i) => `${prefix}-delay-${i}`)
}
