import { useState, useEffect } from 'react'
import { CheckCircle, XCircle, Info, AlertTriangle, X } from 'lucide-react'

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
    error:   'bg-red-50 border-[#db0000]/30 text-[#db0000]',
    info:    'bg-bg-secondary border-brand/20 text-brand',
    warning: 'bg-yellow-50 border-yellow-200 text-yellow-800',
  }

  const icons = {
    success: <CheckCircle className="h-5 w-5 text-green-600 shrink-0" />,
    error:   <XCircle className="h-5 w-5 shrink-0" style={{ color: '#db0000' }} />,
    info:    <Info className="h-5 w-5 text-brand shrink-0" />,
    warning: <AlertTriangle className="h-5 w-5 text-yellow-600 shrink-0" />,
  }

  return (
    <div className="fixed top-4 right-4 z-50 space-y-2">
      {toasts.map(t => (
        <div key={t.id} className={`flex items-center gap-3 px-4 py-3 rounded-lg shadow-lg min-w-[300px] max-w-md border animate-slide-in-right ${styles[t.type]}`}>
          {icons[t.type]}
          <p className="flex-1 text-sm font-medium">{t.message}</p>
          <button onClick={() => remove(t.id)} className="text-gray-400 hover:text-gray-600 shrink-0">
            <X className="h-4 w-4" />
          </button>
        </div>
      ))}
    </div>
  )
}
