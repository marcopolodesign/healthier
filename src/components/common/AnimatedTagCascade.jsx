import { buildDelayClasses } from '../../lib/staggerDelay'

// Tailwind's JIT scanner only generates a utility's CSS if its class name
// literally appears in source — a template-literal className would be invisible
// to it, so every chip-delay-N variant must still exist as a literal
// @utility block in index.css (0..19).
const DELAY_CLASSES = buildDelayClasses('chip', 20)

// Staggered tag/chip picker — emulates the Tandem Health onboarding animation
// where specialty tags cascade in after picking a profession category. Also
// reusable as a plain (non-animated) pill-button group via `animate={false}`
// — e.g. the profession-category row above it, which is always visible and
// has nothing to cascade in reaction to.
// Pass a `cascadeKey` that changes whenever `items` changes (e.g. the selected
// category) so the reveal replays — CSS `animation: ... forwards` only runs
// once per mount, so re-triggering requires actually remounting the chips.
export function AnimatedTagCascade({ items, value, onSelect, cascadeKey, animate = true }) {
  return (
    <div className="flex flex-wrap gap-2" key={cascadeKey}>
      {items.map((item, i) => {
        const delayClass = DELAY_CLASSES[Math.min(i, DELAY_CLASSES.length - 1)]
        const active = item.value === value
        const Icon = item.icon
        return (
          <button
            key={item.value}
            type="button"
            onClick={() => onSelect(item.value)}
            className={[
              animate ? `chip-reveal ${delayClass}` : '',
              'flex items-center gap-1.5 px-4 py-2 rounded-full text-sm font-medium border transition-colors',
              active
                ? 'bg-brand text-white border-brand'
                : 'bg-white border-border-default text-text-secondary hover:border-brand/50',
            ].join(' ')}
          >
            {Icon && <Icon className="h-4 w-4" />}
            {item.label}
          </button>
        )
      })}
    </div>
  )
}
