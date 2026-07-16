import { buildDelayClasses } from '../../lib/staggerDelay'

// Tailwind's JIT scanner only generates a utility's CSS if its class name
// literally appears in source — a template-literal className would be invisible
// to it, so every letter-delay-N variant must still exist as a literal
// @utility block in index.css (0..59). This array only needs to *contain* the
// right strings at runtime, so building it is fine — buildDelayClasses is
// shared with AnimatedTagCascade's chip-delay-N array.
const DELAY_CLASSES = buildDelayClasses('letter', 60)

// Per-character reveal headline — emulates the Tandem Health product-page hero
// animation: each letter fades/slides in with a lime→final-color transition,
// staggered via a per-letter delay utility so the cascade reads continuously
// across the whole headline. Each word is wrapped in letter-reveal-word
// (white-space: nowrap) so lines only break between words, never mid-word —
// while letters keep their own animatable box.
export function AnimatedHeadline({ text, as: Tag = 'h1', className = '' }) {
  const words = text.split(' ')
  let index = 0

  const wordEls = words.map((word, wi) => (
    <span key={wi} className="letter-reveal-word">
      {word.split('').map((char, ci) => {
        const delayClass = DELAY_CLASSES[Math.min(index++, DELAY_CLASSES.length - 1)]
        return (
          <span key={ci} className={`letter-reveal ${delayClass}`}>{char}</span>
        )
      })}
    </span>
  ))

  return (
    <Tag className={className}>
      {wordEls.reduce((acc, el, i) => (i === 0 ? [el] : [...acc, ' ', el]), [])}
    </Tag>
  )
}
