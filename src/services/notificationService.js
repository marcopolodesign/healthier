import { supabase } from '../lib/supabase'

const VAPID_PUBLIC_KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64  = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw     = window.atob(base64)
  return Uint8Array.from([...raw].map(c => c.charCodeAt(0)))
}

export const notificationService = {
  isSupported() {
    return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window
  },

  isPushEnabled() {
    return Notification.permission === 'granted'
  },

  async register() {
    if (!this.isSupported()) return null
    const reg = await navigator.serviceWorker.register('/sw.js')
    await navigator.serviceWorker.ready
    return reg
  },

  async subscribe(userId) {
    // Safari requires Notification.requestPermission() to run synchronously
    // within the user gesture — any await before it (e.g. service worker
    // registration) breaks user-activation and the prompt silently fails.
    if (!this.isSupported()) return false

    const permission = await Notification.requestPermission()
    if (permission !== 'granted') return false

    const reg = await this.register()
    if (!reg) return false

    let subscription = await reg.pushManager.getSubscription()
    if (!subscription) {
      subscription = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
      })
    }

    const { endpoint, keys } = subscription.toJSON()
    const { error } = await supabase.from('push_subscriptions').upsert({
      user_id:  userId,
      endpoint,
      p256dh:   keys.p256dh,
      auth:     keys.auth,
    }, { onConflict: 'user_id,endpoint' })

    return !error
  },

  async unsubscribe(userId) {
    const reg = await navigator.serviceWorker.getRegistration('/sw.js')
    if (!reg) return
    const subscription = await reg.pushManager.getSubscription()
    if (subscription) {
      await supabase.from('push_subscriptions').delete().eq('endpoint', subscription.endpoint)
      await subscription.unsubscribe()
    }
  },

  async sendToUser(userId, { title, body, url }) {
    await supabase.functions.invoke('send-push-notification', {
      body: { userId, title, body, url },
    })
  },
}
