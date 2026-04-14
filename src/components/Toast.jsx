import { useState, useEffect } from 'react'
import { CheckCircleIcon, XCircleIcon, InformationCircleIcon, ExclamationTriangleIcon, XMarkIcon } from '@heroicons/react/24/outline'

let toastId = 0
const toastListeners = new Set()

export const toast = {
  success: (message) => {
    const id = toastId++
    toastListeners.forEach(l => l({ id, type: 'success', message }))
    return id
  },
  error: (message) => {
    const id = toastId++
    toastListeners.forEach(l => l({ id, type: 'error', message }))
    return id
  },
  info: (message) => {
    const id = toastId++
    toastListeners.forEach(l => l({ id, type: 'info', message }))
    return id
  },
  warning: (message) => {
    const id = toastId++
    toastListeners.forEach(l => l({ id, type: 'warning', message }))
    return id
  },
}

export const ToastContainer = () => {
  const [toasts, setToasts] = useState([])

  useEffect(() => {
    const handle = (t) => {
      setToasts(prev => [...prev, t])
      setTimeout(() => setToasts(prev => prev.filter(x => x.id !== t.id)), 4000)
    }
    toastListeners.add(handle)
    return () => toastListeners.delete(handle)
  }, [])

  const remove = (id) => setToasts(prev => prev.filter(t => t.id !== id))

  const styles = {
    success: 'bg-green-50 border-green-200 text-green-800',
    error:   'bg-red-50 border-red-200 text-red-800',
    info:    'bg-blue-50 border-blue-200 text-blue-800',
    warning: 'bg-yellow-50 border-yellow-200 text-yellow-800',
  }

  const icons = {
    success: <CheckCircleIcon className="h-5 w-5 text-green-600 shrink-0" />,
    error:   <XCircleIcon className="h-5 w-5 text-red-600 shrink-0" />,
    info:    <InformationCircleIcon className="h-5 w-5 text-blue-600 shrink-0" />,
    warning: <ExclamationTriangleIcon className="h-5 w-5 text-yellow-600 shrink-0" />,
  }

  return (
    <div className="fixed top-4 right-4 z-50 space-y-2">
      {toasts.map(t => (
        <div key={t.id} className={`flex items-center gap-3 px-4 py-3 rounded-lg shadow-lg min-w-[300px] max-w-md border animate-slide-in-right ${styles[t.type]}`}>
          {icons[t.type]}
          <p className="flex-1 text-sm font-medium">{t.message}</p>
          <button onClick={() => remove(t.id)} className="text-gray-400 hover:text-gray-600 shrink-0">
            <XMarkIcon className="h-4 w-4" />
          </button>
        </div>
      ))}
    </div>
  )
}
