import { Lightning } from '@phosphor-icons/react'

// Floating filter controls rendered on top of the patient dashboard map.
// Self-contained: manages its own selected-vertical state via props from
// InteractiveMap, no changes required in Dashboard.jsx.
export default function MapFilters({ verticales, activeVertical, onVerticalChange, availableNow, onToggleAvailableNow }) {
  if (verticales.length === 0) return null

  return (
    <div className="absolute top-4 sm:top-6 left-4 sm:left-6 right-[76px] z-20 flex items-center gap-2 overflow-x-auto scrollbar-hide pb-1">
      {/* Disponibles ahora — mirrors mobile's availableNow filter chip */}
      <button
        onClick={onToggleAvailableNow}
        className={`flex-shrink-0 flex items-center gap-1.5 px-3 py-2 rounded-full text-xs font-semibold shadow-[0_4px_16px_rgba(0,0,0,0.10)] border transition-all backdrop-blur-[12px] ${
          availableNow
            ? 'bg-emerald-500 border-emerald-400 text-white'
            : 'bg-white/85 border-white/60 text-gray-700 hover:bg-white'
        }`}
      >
        <Lightning weight="fill" className={`w-3.5 h-3.5 ${availableNow ? 'text-white' : 'text-emerald-500'}`} />
        Disponibles ahora
      </button>

      <div className="w-px h-5 bg-gray-300/60 flex-shrink-0" />

      {/* Especialidad — filter markers by vertical */}
      <button
        onClick={() => onVerticalChange(null)}
        className={`flex-shrink-0 px-3 py-2 rounded-full text-xs font-semibold shadow-[0_4px_16px_rgba(0,0,0,0.10)] border transition-all backdrop-blur-[12px] ${
          !activeVertical
            ? 'bg-brand border-brand text-white'
            : 'bg-white/85 border-white/60 text-gray-700 hover:bg-white'
        }`}
      >
        Todas
      </button>
      {verticales.map(v => (
        <button
          key={v.id}
          onClick={() => onVerticalChange(activeVertical === v.id ? null : v.id)}
          className={`flex-shrink-0 flex items-center gap-1.5 px-3 py-2 rounded-full text-xs font-semibold shadow-[0_4px_16px_rgba(0,0,0,0.10)] border transition-all backdrop-blur-[12px] ${
            activeVertical === v.id
              ? 'text-white'
              : 'bg-white/85 border-white/60 text-gray-700 hover:bg-white'
          }`}
          style={activeVertical === v.id ? { backgroundColor: v.color, borderColor: v.color } : undefined}
        >
          <v.icon weight={activeVertical === v.id ? 'fill' : 'regular'} className="w-3.5 h-3.5" style={activeVertical !== v.id ? { color: v.color } : undefined} />
          {v.nombre}
        </button>
      ))}
    </div>
  )
}
