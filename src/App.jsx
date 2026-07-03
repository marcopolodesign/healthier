import { useState, useEffect } from 'react'
import { BrowserRouter as Router, Routes, Route, Navigate, Outlet } from 'react-router-dom'
import { ToastContainer } from './components/Toast'
import AppLayout from './layouts/AppLayout'
import AuthLayout from './layouts/AuthLayout'
import PatientMobileLayout from './layouts/PatientMobileLayout'
import IndexSidecart from './components/IndexSidecart'
import { authService } from './services/authService'
import { supabase } from './lib/supabase'
import { professionalService } from './services/professionalService'

// Pages
import Landing from './pages/Landing'
import LandingPediatria from './pages/landing/Pediatria'
import LandingSinCoberturaMedica from './pages/landing/SinCoberturaMedica'
import LandingMedicoOnline from './pages/landing/MedicoOnline'
import Login from './pages/auth/Login'
import Register from './pages/auth/Register'
import TerminosYCondiciones from './pages/TerminosYCondiciones'

import PatientDashboard from './pages/patient/Dashboard'
import PatientOnboarding from './pages/patient/Onboarding'
import PatientSearch from './pages/patient/Search'
import ProfessionalProfile from './pages/patient/ProfessionalProfile'
import BookConsultation from './pages/patient/Book'
import PatientConsultations from './pages/patient/Consultations'
import PatientDocuments from './pages/patient/Documents'
import PatientProfile from './pages/patient/Profile'
import OnDemand from './pages/patient/OnDemand'
import Emergency from './pages/patient/Emergency'

import ProfessionalDashboard from './pages/professional/Dashboard'
import ProfessionalOnboarding from './pages/professional/Onboarding'
import ProfessionalAgenda from './pages/professional/Agenda'
import ConsultationDetail from './pages/professional/ConsultationDetail'
import ProfessionalProfileEdit from './pages/professional/Profile'
import ProfessionalVideoCall from './pages/professional/VideoCall'
import NutriPlan from './pages/professional/NutriPlan'
import ProfessionalEmergencias from './pages/professional/Emergencias'
import HistoriaClinica from './pages/professional/HistoriaClinica'
import ProfessionalHistorial from './pages/professional/Historial'
import ProfessionalPatientProfile from './pages/professional/PatientProfile'
import ProfessionalPacientes from './pages/professional/Pacientes'
import ProfessionalGanancias from './pages/professional/Ganancias'
import ProfessionalConfiguracion from './pages/professional/Configuracion'
import PatientBiovisor from './pages/patient/Biovisor'
import PatientNutriPlan from './pages/patient/NutriPlan'
import PatientComprobantes from './pages/patient/Comprobantes'
import PatientVideoCall from './pages/patient/VideoCall'
import HistoriaClinicaPaciente from './pages/paciente/HistoriaClinicaPaciente'
import WaitingRoom from './pages/patient/WaitingRoom'
import ConsultationReview from './pages/patient/ConsultationReview'
import BuscarProfesional from './pages/patient/BuscarProfesional'
import ReservarConsulta from './pages/patient/ReservarConsulta'
import PaymentPage from './pages/patient/PaymentPage'
import PatientAIChat from './pages/patient/PatientAIChat'
import WalkInQueue from './pages/patient/WalkInQueue'
import HealthSnapshot from './pages/patient/HealthSnapshot'
import BookingConfirmed from './pages/patient/BookingConfirmed'

import AdminProfessionals from './pages/admin/Professionals'
import AdminUsers from './pages/admin/Users'
import AdminConsultations from './pages/admin/Consultations'

import SuperAdminDashboard from './pages/super-admin/Dashboard'
import SuperAdminAdmins from './pages/super-admin/Admins'
import SuperAdminSettings from './pages/super-admin/Settings'
import SuperAdminZones from './pages/super-admin/Zones'
import SuperAdminUsuarios from './pages/super-admin/Usuarios'
import SuperAdminUsuariosProspects from './pages/super-admin/UsuariosProspects'
import SuperAdminProfesionales from './pages/super-admin/Profesionales'
import SuperAdminProfesionalesProspects from './pages/super-admin/ProfesionalesProspects'

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
  const [profSpecialty, setProfSpecialty] = useState(null)
  const [loading, setLoading] = useState(true)
  const [sidecartOpen, setSidecartOpen] = useState(false)

  const loadProfSpecialty = async (userId) => {
    try {
      const pp = await professionalService.getByUserId(userId)
      setProfSpecialty(pp?.specialty ?? null)
    } catch {
      // non-critical — sidebar just won't show specialty-gated items
    }
  }

  useEffect(() => {
    // Initial session check
    const init = async () => {
      try {
        const user = await authService.getCurrentUser()
        if (user) {
          const p = await authService.getCurrentUserProfile(user.id)
          setProfile(p)
          if (p?.role === 'professional') loadProfSpecialty(user.id)
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
        if (p?.role === 'professional') loadProfSpecialty(session.user.id)
      } else if (event === 'SIGNED_OUT') {
        setProfile(null)
        setProfSpecialty(null)
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
        <Route path="/landing/pediatria"       element={<LandingPediatria />} />
        <Route path="/landing/sin-cobertura-medica" element={<LandingSinCoberturaMedica />} />
        <Route path="/landing/medico-online"   element={<LandingMedicoOnline />} />
        <Route path="/terminos" element={<TerminosYCondiciones />} />

        {/* Auth */}
        <Route element={<AuthLayout />}>
          <Route path="/login" element={<Login onLogin={handleLogin} />} />
          <Route path="/registro" element={<Register onLogin={handleLogin} />} />
        </Route>

        {/* Patient — mobile shell */}
        <Route element={
          <RequireRole profile={profile} allowed={['patient']}>
            <PatientMobileLayout profile={profile} />
          </RequireRole>
        }>
          <Route path="/paciente/dashboard"       element={<PatientDashboard    profile={profile} />} />
          <Route path="/paciente/consultas"        element={<PatientConsultations profile={profile} />} />
          <Route path="/paciente/documentos"       element={<PatientDocuments    profile={profile} />} />
          <Route path="/paciente/perfil"           element={<PatientProfile      profile={profile} onProfileUpdate={setProfile} />} />
          <Route path="/paciente/ondemand/:vertical" element={<OnDemand          profile={profile} />} />
          <Route path="/paciente/sos"              element={<Emergency           profile={profile} />} />
          {/* Legacy routes kept for backward compatibility */}
          <Route path="/paciente/buscar"           element={<PatientSearch       profile={profile} />} />
          <Route path="/paciente/profesional/:id"  element={<ProfessionalProfile profile={profile} />} />
          <Route path="/paciente/agendar/:id"      element={<BookConsultation    profile={profile} />} />
          <Route path="/paciente/biovisor"         element={<PatientBiovisor     profile={profile} />} />
          <Route path="/paciente/nutriplan"        element={<PatientNutriPlan    profile={profile} />} />
          <Route path="/paciente/comprobantes"     element={<PatientComprobantes profile={profile} />} />
          <Route path="/paciente/videollamada/:id" element={<PatientVideoCall    profile={profile} />} />
          <Route path="/paciente/reservar"            element={<ReservarConsulta   profile={profile} />} />
          <Route path="/paciente/buscar-profesional"  element={<BuscarProfesional  profile={profile} />} />
          <Route path="/paciente/sala-espera/:consultationId" element={<WaitingRoom profile={profile} />} />
          <Route path="/paciente/pago" element={<PaymentPage profile={profile} />} />
          <Route path="/paciente/consulta/review/:consultationId" element={<ConsultationReview profile={profile} />} />
          <Route path="/paciente/historia-clinica" element={<HistoriaClinicaPaciente profile={profile} />} />
          <Route path="/paciente/ia"              element={<PatientAIChat           profile={profile} />} />
          <Route path="/paciente/urgente"         element={<WalkInQueue             profile={profile} />} />
          <Route path="/paciente/salud"           element={<HealthSnapshot          profile={profile} />} />
          <Route path="/paciente/turno-confirmado/:consultationId" element={<BookingConfirmed profile={profile} />} />
        </Route>

        {/* Patient onboarding — full-screen, no mobile nav */}
        <Route path="/paciente/onboarding" element={
          <RequireRole profile={profile} allowed={['patient']}>
            <PatientOnboarding profile={profile} />
          </RequireRole>
        } />

        {/* Professional — full-screen standalone routes (no sidebar) */}
        <Route path="/profesional/emergencias" element={
          <RequireRole profile={profile} allowed={['professional']}>
            <ProfessionalEmergencias profile={profile} />
          </RequireRole>
        } />
        <Route path="/profesional/videollamada/:id" element={
          <RequireRole profile={profile} allowed={['professional']}>
            <ProfessionalVideoCall profile={profile} />
          </RequireRole>
        } />

        {/* Professional */}
        <Route element={
          <RequireRole profile={profile} allowed={['professional']}>
            <AppLayout profile={profile} profSpecialty={profSpecialty} onOpenSidecart={() => setSidecartOpen(true)} />
          </RequireRole>
        }>
          <Route path="/profesional/dashboard" element={<ProfessionalDashboard profile={profile} />} />
          <Route path="/profesional/onboarding" element={<ProfessionalOnboarding profile={profile} />} />
          <Route path="/profesional/agenda" element={<ProfessionalAgenda profile={profile} />} />
          <Route path="/profesional/consulta/:id" element={<ConsultationDetail profile={profile} />} />
          <Route path="/profesional/perfil" element={<ProfessionalProfileEdit profile={profile} onProfileUpdate={setProfile} />} />
          <Route path="/profesional/nutriplan" element={<NutriPlan profile={profile} />} />
          <Route path="/profesional/historia-clinica/:patientId" element={<HistoriaClinica profile={profile} />} />
          <Route path="/profesional/historial" element={<ProfessionalHistorial profile={profile} />} />
          <Route path="/profesional/paciente/:patientId" element={<ProfessionalPatientProfile />} />
          <Route path="/profesional/pacientes" element={<ProfessionalPacientes profile={profile} />} />
          <Route path="/profesional/ganancias" element={<ProfessionalGanancias profile={profile} />} />
          <Route path="/profesional/configuracion" element={<ProfessionalConfiguracion profile={profile} />} />
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
          <Route path="/super-admin/zonas" element={<SuperAdminZones />} />
          <Route path="/super-admin/settings" element={<SuperAdminSettings />} />
          <Route path="/super-admin/usuarios" element={<SuperAdminUsuarios />} />
          <Route path="/super-admin/usuarios/prospects" element={<SuperAdminUsuariosProspects />} />
          <Route path="/super-admin/profesionales" element={<SuperAdminProfesionales />} />
          <Route path="/super-admin/profesionales/prospects" element={<SuperAdminProfesionalesProspects />} />
        </Route>

        {/* Catch-all */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Router>
  )
}
