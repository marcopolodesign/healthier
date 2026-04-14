// TODO: wire real backend — replace mock with actual dispatch system
// This service would connect to a real-time dispatcher (Supabase Realtime / websocket).

export const emergencyService = {
  // Simulates payment processing and returns a confirmation token
  async processPayment(amount) {
    await new Promise(r => setTimeout(r, 2000))
    return { success: true, token: `EMG-${Date.now()}` }
  },

  // Simulates finding and assigning a nearby unit
  async findUnit(userLocation) {
    await new Promise(r => setTimeout(r, 4500))
    return {
      unit: 'Móvil 42',
      paramedic: 'Juan Pérez',
      etaMinutes: 4,
      phone: '+54 11 4567-0042',
    }
  },
}
