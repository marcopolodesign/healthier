self.addEventListener('push', event => {
  const data = event.data ? event.data.json() : {}
  const title = data.title || 'Healthier'
  const options = {
    body:  data.body  || '',
    icon:  data.icon  || '/favicon.ico',
    badge: data.badge || '/favicon.ico',
    data:  { url: data.url || '/' },
    tag:   data.tag   || 'healthier-notification',
    renotify: true,
  }
  event.waitUntil(self.registration.showNotification(title, options))
})

self.addEventListener('notificationclick', event => {
  event.notification.close()
  const url = event.notification.data?.url || '/'
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(windowClients => {
      for (const client of windowClients) {
        if (client.url === url && 'focus' in client) return client.focus()
      }
      if (clients.openWindow) return clients.openWindow(url)
    })
  )
})
