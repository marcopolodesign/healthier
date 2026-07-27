import { useState } from 'react'
import { authService } from '../../services/authService'
import { toast } from '../../components/Toast'
import { GoogleIcon } from '../common/GoogleIcon'
import { track } from '../../utils/analytics'

export function GoogleAuthButton({ className = '', analyticsEvent, analyticsParams = {} }) {
  const [loading, setLoading] = useState(false)

  const submit = async () => {
    setLoading(true)
    try {
      if (analyticsEvent) track(analyticsEvent, analyticsParams)
      await authService.loginWithGoogle()
    } catch (err) {
      toast.error(err.message)
      setLoading(false)
    }
  }

  return (
    <button
      type="button"
      onClick={submit}
      disabled={loading}
      className={`w-full flex items-center justify-center gap-2.5 py-2.5 rounded-lg border-2 border-border-default hover:border-brand/50 transition-colors disabled:opacity-50 text-sm font-semibold text-text-primary ${className}`}
    >
      <GoogleIcon size={18} />
      {loading ? 'Redirigiendo...' : 'Continuar con Google'}
    </button>
  )
}
