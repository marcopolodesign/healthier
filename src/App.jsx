import { useState, useEffect } from 'react'
import { BrowserRouter as Router, Routes, Route, Navigate, Outlet } from 'react-router-dom'
import { ToastContainer } from './components/Toast'
import AppLayout from './layouts/AppLayout'
import AuthLayout from './layouts/AuthLayout'
import IndexSidecart from './components/IndexSidecart'
import { authService } from './services/authService'
import { supabase } from './lib/supabase'

// Pages
import Landing from './pages/Landing'
import Login from './pages/auth/Login'
import Register from './pages/auth/Register'

import PatientDashboard from './pages/patient/Dashboard'
import PatientSearch from './pages/patient/Search'
import ProfessionalProfile from './pages/patient/ProfessionalProfile'
import BookConsultation from './pages/patient/Book'
import PatientConsultations from './pages/patient/Consultations'
import PatientDocuments from './pages/patient/Documents'
import PatientProfile from './pages/patient/Profile'

import ProfessionalDashboard from './pages/professional/Dashboard'
import ProfessionalOnboarding from './pages/professional/Onboarding'
import ProfessionalAgenda from './pages/professional/Agenda'
import ConsultationDetail from './pages/professional/ConsultationDetail'
import ProfessionalProfileEdit from './pages/professional/Profile'

import AdminProfessionals from './pages/admin/Professionals'
import AdminUsers from './pages/admin/Users'
import AdminConsultations from './pages/admin/Consultations'

import SuperAdminDashboard from './pages/super-admin/Dashboard'
import SuperAdminAdmins from './pages/super-admin/Admins'
import SuperAdminSettings from './pages/super-admin/Settings'

// ── Role guards ──────────────────────────────────────────
function RequireRole({ profile, allowed, children }) {
  if (!profile) return <Navigate to="/login" replace />
  if (!allowed.includes(profile.role)) {
    const redirects = {
      patient: '/paciente/dashboard',
      professional: '/profesional/dashboard',
      admin: '/admin/profesionales',
      super_admin: '/super-admin/dashboard',
    }
    return <Navigate to={redirects[profile.role] || '/'} replace />
  }
  return children
}

// ── Protected layout wrapper ─────────────────────────────
function ProtectedLayout({ profile, allowed }) {
  return (
    <RequireRole profile={profile} allowed={allowed}>
      <AppLayout profile={profile}>
        <Outlet />
      </AppLayout>
    </RequireRole>
  )
}

// ── Main App ─────────────────────────────────────────────
export default function App() {
  const [profile, setProfile] = useState(null)
  const [loading, setLoading] = useState(true)
  const [sidecartOpen, setSidecartOpen] = useState(false)

  useEffect(() => {
    // Initial session check
    const init = async () => {
      try {
        const user = await authService.getCurrentUser()
        if (user) {
          const p = await authService.getCurrentUserProfile(user.id)
          setProfile(p)
        }
      } catch {
        // ignore
      } finally {
        setLoading(false)
      }
    }
    init()

    // Auth state listener
    const { data: { subscription } } = authService.onAuthStateChange(async (event, session) => {
      if (event === 'SIGNED_IN' && session?.user) {
        const p = await authService.getCurrentUserProfile(session.user.id)
        setProfile(p)
      } else if (event === 'SIGNED_OUT') {
        setProfile(null)
      }
    })
    return () => subscription.unsubscribe()
  }, [])

  const handleLogin = (p) => setProfile(p)

  if (loading) {
    return (
      <div className="min-h-screen bg-bg-primary flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 border-2 border-brand border-t-transparent rounded-full animate-spin" />
          <span className="text-text-secondary text-sm">Cargando...</span>
        </div>
      </div>
    )
  }

  return (
    <Router>
      <ToastContainer />
      <IndexSidecart isOpen={sidecartOpen} onClose={() => setSidecartOpen(false)} />
      {/* Floating trigger — always visible */}
      <button
        onClick={() => setSidecartOpen(true)}
        title="Índice de pantallas"
        className="fixed bottom-5 right-5 z-30 w-10 h-10 bg-brand text-white rounded-full shadow-lg flex items-center justify-center hover:bg-brand/90 transition-colors text-xs font-bold"
      >
        #
      </button>
      <Routes>
        {/* Public */}
        <Route path="/" element={<Landing />} />

        {/* Auth */}
        <Route element={<AuthLayout />}>
          <Route path="/login" element={<Login onLogin={handleLogin} />} />
          <Route path="/registro" element={<Register onLogin={handleLogin} />} />
        </Route>

        {/* Patient */}
        <Route element={
          <RequireRole profile={profile} allowed={['patient']}>
            <AppLayout profile={profile} onOpenSidecart={() => setSidecartOpen(true)} />
          </RequireRole>
        }>
          <Route path="/paciente/dashboard" element={<PatientDashboard profile={profile} />} />
          <Route path="/paciente/buscar" element={<PatientSearch profile={profile} />} />
          <Route path="/paciente/profesional/:id" element={<ProfessionalProfile profile={profile} />} />
          <Route path="/paciente/agendar/:id" element={<BookConsultation profile={profile} />} />
          <Route path="/paciente/consultas" element={<PatientConsultations profile={profile} />} />
          <Route path="/paciente/documentos" element={<PatientDocuments profile={profile} />} />
          <Route path="/paciente/perfil" element={<PatientProfile profile={profile} onProfileUpdate={setProfile} />} />
        </Route>

        {/* Professional */}
        <Route element={
          <RequireRole profile={profile} allowed={['professional']}>
            <AppLayout profile={profile} onOpenSidecart={() => setSidecartOpen(true)} />
          </RequireRole>
        }>
          <Route path="/profesional/dashboard" element={<ProfessionalDashboard profile={profile} />} />
          <Route path="/profesional/onboarding" element={<ProfessionalOnboarding profile={profile} />} />
          <Route path="/profesional/agenda" element={<ProfessionalAgenda profile={profile} />} />
          <Route path="/profesional/consulta/:id" element={<ConsultationDetail profile={profile} />} />
          <Route path="/profesional/perfil" element={<ProfessionalProfileEdit profile={profile} onProfileUpdate={setProfile} />} />
        </Route>

        {/* Admin */}
        <Route element={
          <RequireRole profile={profile} allowed={['admin', 'super_admin']}>
            <AppLayout profile={profile} onOpenSidecart={() => setSidecartOpen(true)} />
          </RequireRole>
        }>
          <Route path="/admin/profesionales" element={<AdminProfessionals />} />
          <Route path="/admin/usuarios" element={<AdminUsers />} />
          <Route path="/admin/consultas" element={<AdminConsultations />} />
        </Route>

        {/* Super Admin */}
        <Route element={
          <RequireRole profile={profile} allowed={['super_admin']}>
            <AppLayout profile={profile} onOpenSidecart={() => setSidecartOpen(true)} />
          </RequireRole>
        }>
          <Route path="/super-admin/dashboard" element={<SuperAdminDashboard />} />
          <Route path="/super-admin/admins" element={<SuperAdminAdmins />} />
          <Route path="/super-admin/settings" element={<SuperAdminSettings />} />
        </Route>

        {/* Catch-all */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Router>
  )
}
