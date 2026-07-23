import { useState } from 'react'
import { getSignedDocUrl } from '../lib/storage'
import { toast } from './Toast'

// professional-docs is a private bucket — stored URLs are broken pseudo-public
// links (see lib/storage.js). This resolves a fresh signed URL only when clicked,
// instead of eagerly signing every document link on a page that lists many.
export default function SignedDocLink({ bucket = 'professional-docs', url, className, children }) {
  const [loading, setLoading] = useState(false)

  const open = async (e) => {
    e.preventDefault()
    if (loading) return
    setLoading(true)
    try {
      const signedUrl = await getSignedDocUrl(bucket, url)
      if (signedUrl) window.open(signedUrl, '_blank', 'noopener,noreferrer')
      else toast.error('No se pudo abrir el documento')
    } finally {
      setLoading(false)
    }
  }

  return (
    <a href={url} onClick={open} className={className}>
      {children}
    </a>
  )
}
