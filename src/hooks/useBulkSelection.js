import { useState, useMemo, useCallback, useEffect } from 'react'

// Selección múltiple genérica para tablas del super admin. `ids` es la lista
// de ids actualmente visible (ya filtrada/paginada) — al cambiar de filtro o
// recargar datos, la selección se limpia sola para no arrastrar ids que ya
// no están en pantalla.
export function useBulkSelection(ids) {
  const [selected, setSelected] = useState(() => new Set())

  useEffect(() => {
    setSelected(prev => {
      const visible = new Set(ids)
      const next = new Set([...prev].filter(id => visible.has(id)))
      return next.size === prev.size ? prev : next
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ids.join(',')])

  const toggle = useCallback((id) => {
    setSelected(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }, [])

  const toggleAll = useCallback(() => {
    setSelected(prev => (prev.size === ids.length ? new Set() : new Set(ids)))
  }, [ids])

  const clear = useCallback(() => setSelected(new Set()), [])

  const isAllSelected = ids.length > 0 && selected.size === ids.length
  const isSomeSelected = selected.size > 0 && !isAllSelected

  return {
    selected,
    selectedIds: useMemo(() => [...selected], [selected]),
    isSelected: (id) => selected.has(id),
    toggle,
    toggleAll,
    clear,
    isAllSelected,
    isSomeSelected,
    count: selected.size,
  }
}
