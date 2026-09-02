import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { medicationOrdersService } from '../services/medicationOrdersService'
import { toast } from '../components/Toast'

/**
 * El carrito de farmacia, compartido por toda la app del paciente.
 *
 * Es local Y de la base a la vez, a propósito (pedido de Mateo, 2026-09-02:
 * *"ambos, persiste el de la base pero verificar el sync correcto"*):
 *
 * - **La base manda.** El carrito ES el borrador de `medication_orders` en
 *   `no_pagado`. Se carga al entrar y sobrevive a cerrar la pestaña, cambiar
 *   de teléfono o pasar de la web a la app.
 * - **La pantalla no espera a la base.** Cada `+`/`-` se pinta en el acto como
 *   un delta pendiente encima de lo que devolvió el servidor, y la llamada
 *   sale por atrás.
 *
 * Cómo no se desincronizan, que es la parte que importa:
 *
 * 1. **Las llamadas van en fila, nunca en paralelo.** Tocar `+` cinco veces
 *    rápido son cinco RPC encadenadas; si salieran juntas, cada una leería el
 *    mismo borrador y el total quedaría en cualquier lado.
 * 2. **Cada respuesta descuenta exactamente su propio delta**, no limpia todo
 *    el overlay. Si mientras vuelve la primera el paciente toca dos veces más,
 *    esos dos deltas siguen pintados hasta que vuelva *su* respuesta.
 * 3. **Un error revierte sólo su delta** y avisa. El estado del servidor no se
 *    toca: la próxima respuesta que llegue lo va a corregir igual.
 * 4. **El servidor es el que valora.** El precio y el nombre salen del
 *    catálogo dentro de la función (migración 138), así que el total que se ve
 *    es el que se va a cobrar aunque el catálogo haya cambiado.
 */
const PharmacyCartContext = createContext(null)

export function PharmacyCartProvider({ profile, children }) {
  const [order, setOrder] = useState(null)          // lo último que dijo el servidor
  const [deltas, setDeltas] = useState({})          // productId -> cantidad todavía sin confirmar
  const [productsById, setProductsById] = useState({}) // para pintar filas que el servidor aún no devolvió
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [sheetOpen, setSheetOpen] = useState(false)   // la hoja es una sola, la abren el pill y la barra de Farmacia

  const colaRef = useRef(Promise.resolve())
  const enVueloRef = useRef(0)
  const montadoRef = useRef(true)

  useEffect(() => {
    montadoRef.current = true
    return () => { montadoRef.current = false }
  }, [])

  const refresh = useCallback(async () => {
    if (!profile?.id) { setOrder(null); setLoading(false); return null }
    try {
      const draft = await medicationOrdersService.getPendingDraft(profile.id)
      if (montadoRef.current) setOrder(draft)
      return draft
    } catch {
      // Un carrito que no carga no debería romper la pantalla que lo contiene:
      // el provider envuelve TODA la app del paciente.
      return null
    } finally {
      if (montadoRef.current) setLoading(false)
    }
  }, [profile?.id])

  useEffect(() => {
    setLoading(true)
    setDeltas({})
    refresh()
  }, [refresh])

  const olvidarDelta = useCallback((productId, delta) => {
    setDeltas(prev => {
      const next = { ...prev }
      const restante = (next[productId] ?? 0) - delta
      if (restante === 0) delete next[productId]
      else next[productId] = restante
      return next
    })
  }, [])

  /** delta positivo suma, negativo resta. Ver el bloque de arriba. */
  const changeQuantity = useCallback((product, delta) => {
    if (!product?.id || !delta) return
    setProductsById(prev => ({ ...prev, [product.id]: product }))
    setDeltas(prev => ({ ...prev, [product.id]: (prev[product.id] ?? 0) + delta }))

    enVueloRef.current += 1
    setSyncing(true)
    colaRef.current = colaRef.current
      .then(() => medicationOrdersService.addToCart(product.id, delta))
      .then(actualizado => {
        if (montadoRef.current) setOrder(actualizado)
        olvidarDelta(product.id, delta)
      })
      .catch(err => {
        olvidarDelta(product.id, delta)
        toast.error(err?.message || 'No se pudo actualizar el carrito')
      })
      .finally(() => {
        enVueloRef.current -= 1
        if (montadoRef.current && enVueloRef.current === 0) setSyncing(false)
      })
  }, [olvidarDelta])

  const add = useCallback(product => changeQuantity(product, 1), [changeQuantity])
  const subtract = useCallback(product => changeQuantity(product, -1), [changeQuantity])

  /** Saca el producto entero del carrito, sin importar la cantidad que tenga. */
  const remove = useCallback((product, quantity) => {
    if (!quantity) return
    changeQuantity(product, -quantity)
  }, [changeQuantity])

  /** El carrito se vacía solo cuando el borrador pasa a pagado. */
  const clear = useCallback(() => {
    setOrder(null)
    setDeltas({})
  }, [])

  const items = useMemo(() => {
    const porProducto = new Map()
    for (const it of order?.items ?? []) {
      const pid = it.pharmacyProductId ?? `item:${it.id}`
      porProducto.set(pid, {
        itemId: it.id,
        productId: it.pharmacyProductId,
        name: it.medicationName,
        presentation: it.presentation,
        unitPrice: Number(it.unitPrice),
        quantity: it.quantity,
        requiresPrescription: it.requiresPrescription,
        imageUrl: productsById[pid]?.imageUrl ?? null,
      })
    }
    for (const [pid, delta] of Object.entries(deltas)) {
      const actual = porProducto.get(pid)
      const producto = productsById[pid]
      const cantidad = (actual?.quantity ?? 0) + delta
      if (cantidad <= 0) { porProducto.delete(pid); continue }
      porProducto.set(pid, actual
        ? { ...actual, quantity: cantidad }
        : {
            itemId: null,
            productId: pid,
            name: producto?.name ?? 'Medicamento',
            presentation: producto?.presentation ?? null,
            unitPrice: Number(producto?.price ?? 0),
            quantity: cantidad,
            requiresPrescription: producto?.prescriptionType !== 'venta_libre',
            imageUrl: producto?.imageUrl ?? null,
          })
    }
    return [...porProducto.values()]
  }, [order, deltas, productsById])

  const quantities = useMemo(
    () => Object.fromEntries(items.filter(it => it.productId).map(it => [it.productId, it.quantity])),
    [items],
  )
  const count = useMemo(() => items.reduce((s, it) => s + it.quantity, 0), [items])
  const total = useMemo(() => items.reduce((s, it) => s + it.unitPrice * it.quantity, 0), [items])

  const openSheet = useCallback(() => setSheetOpen(true), [])
  const closeSheet = useCallback(() => setSheetOpen(false), [])

  const value = useMemo(() => ({
    orderId: order?.id ?? null,
    order,
    items,
    quantities,
    quantityOf: productId => quantities[productId] ?? 0,
    count,
    total,
    loading,
    syncing,
    add,
    subtract,
    remove,
    refresh,
    clear,
    sheetOpen,
    openSheet,
    closeSheet,
  }), [order, items, quantities, count, total, loading, syncing, add, subtract, remove, refresh, clear, sheetOpen, openSheet, closeSheet])

  return <PharmacyCartContext.Provider value={value}>{children}</PharmacyCartContext.Provider>
}

/**
 * Devuelve un carrito inerte si no hay provider, en vez de romper: hay
 * pantallas de paciente que se montan fuera del shell (la videollamada, por
 * ejemplo) y ninguna de ellas necesita carrito.
 */
const CARRITO_VACIO = {
  orderId: null, order: null, items: [], quantities: {}, quantityOf: () => 0,
  count: 0, total: 0, loading: false, syncing: false,
  add: () => {}, subtract: () => {}, remove: () => {},
  refresh: async () => null, clear: () => {},
  sheetOpen: false, openSheet: () => {}, closeSheet: () => {},
}

export function usePharmacyCart() {
  return useContext(PharmacyCartContext) ?? CARRITO_VACIO
}
