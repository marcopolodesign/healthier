// Flat top-down ambulance vector (client design spec)
export default function TopDownAmbulance({ className, style }) {
  return (
    <svg width="40" height="84" viewBox="0 0 40 84" fill="none" xmlns="http://www.w3.org/2000/svg" className={className} style={style}>
      <rect x="2" y="4" width="36" height="78" rx="10" fill="rgba(0,0,0,0.15)" />
      <rect x="0" y="16" width="4" height="14" rx="2" fill="#1E293B" />
      <rect x="36" y="16" width="4" height="14" rx="2" fill="#1E293B" />
      <rect x="0" y="56" width="4" height="14" rx="2" fill="#1E293B" />
      <rect x="36" y="56" width="4" height="14" rx="2" fill="#1E293B" />
      <rect x="2" y="2" width="36" height="76" rx="8" fill="#FFFFFF" stroke="#CBD5E1" strokeWidth="1" />
      <path d="M 4 20 L 36 20 L 34 8 Q 20 4 6 8 Z" fill="#F8FAFC" />
      <path d="M 6 22 L 34 22 L 31 12 Q 20 9 9 12 Z" fill="#0F172A" />
      <rect x="4" y="26" width="32" height="50" rx="4" fill="#F1F5F9" />
      <rect x="16" y="40" width="8" height="20" rx="1" fill="#EF4444" />
      <rect x="10" y="46" width="20" height="8" rx="1" fill="#EF4444" />
      <rect x="6" y="76" width="8" height="3" rx="1" fill="#EF4444" />
      <rect x="26" y="76" width="8" height="3" rx="1" fill="#EF4444" />
      <rect x="6" y="2" width="8" height="4" rx="2" fill="#FEF08A" />
      <rect x="26" y="2" width="8" height="4" rx="2" fill="#FEF08A" />
      <rect x="10" y="24" width="20" height="4" rx="2" fill="#334155" />
      <rect x="11" y="24" width="8" height="4" rx="1" fill="#EF4444" className="animate-pulse" />
      <rect x="21" y="24" width="8" height="4" rx="1" fill="#3B82F6" className="animate-pulse" style={{ animationDelay: '0.3s' }} />
    </svg>
  )
}
