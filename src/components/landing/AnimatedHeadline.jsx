// Tailwind's JIT scanner only generates a utility's CSS if its class name
// literally appears in source — a template-literal className would be invisible
// to it, so every letter-delay-N variant must be spelled out here.
const DELAY_CLASSES = [
  'letter-delay-0', 'letter-delay-1', 'letter-delay-2', 'letter-delay-3', 'letter-delay-4',
  'letter-delay-5', 'letter-delay-6', 'letter-delay-7', 'letter-delay-8', 'letter-delay-9',
  'letter-delay-10', 'letter-delay-11', 'letter-delay-12', 'letter-delay-13', 'letter-delay-14',
  'letter-delay-15', 'letter-delay-16', 'letter-delay-17', 'letter-delay-18', 'letter-delay-19',
  'letter-delay-20', 'letter-delay-21', 'letter-delay-22', 'letter-delay-23', 'letter-delay-24',
  'letter-delay-25', 'letter-delay-26', 'letter-delay-27', 'letter-delay-28', 'letter-delay-29',
  'letter-delay-30', 'letter-delay-31', 'letter-delay-32', 'letter-delay-33', 'letter-delay-34',
  'letter-delay-35', 'letter-delay-36', 'letter-delay-37', 'letter-delay-38', 'letter-delay-39',
  'letter-delay-40', 'letter-delay-41', 'letter-delay-42', 'letter-delay-43', 'letter-delay-44',
  'letter-delay-45', 'letter-delay-46', 'letter-delay-47', 'letter-delay-48', 'letter-delay-49',
  'letter-delay-50', 'letter-delay-51', 'letter-delay-52', 'letter-delay-53', 'letter-delay-54',
  'letter-delay-55', 'letter-delay-56', 'letter-delay-57', 'letter-delay-58', 'letter-delay-59',
]

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
