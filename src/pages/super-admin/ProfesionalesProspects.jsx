import { useState, useEffect } from 'react';
import { MagnifyingGlass, ShieldCheck, WarningCircle } from '@phosphor-icons/react';
import { supabase } from '../../lib/supabase';
import { SPECIALTY_LABELS } from '../../lib/verticals';
import { toast } from '../../components/Toast';

export default function SuperAdminProfesionalesProspects() {
  const [prospects, setProspects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  useEffect(() => {
    fetchData();
  }, []);

  async function fetchData() {
    try {
      setLoading(true);
      const [profilesRes, professionalProfilesRes] = await Promise.all([
        supabase
          .from('profiles')
          .select('id, email, full_name, created_at, utm_source')
          .eq('role', 'professional')
          .order('created_at', { ascending: false }),
        supabase
          .from('professional_profiles')
          .select('id, specialty, is_verified, submitted_at'),
      ]);

      if (profilesRes.error) throw profilesRes.error;
      if (professionalProfilesRes.error) throw professionalProfilesRes.error;

      const verifiedMap = {};
      for (const pp of professionalProfilesRes.data || []) {
        verifiedMap[pp.id] = {
          specialty: pp.specialty,
          is_verified: pp.is_verified,
          submitted_at: pp.submitted_at,
        };
      }

      const prospectList = (profilesRes.data || [])
        .filter((p) => !verifiedMap[p.id] || verifiedMap[p.id].is_verified === false)
        .map((p) => ({
          ...p,
          profileStatus: !verifiedMap[p.id] ? 'sin_perfil' : 'pendiente',
          specialty: verifiedMap[p.id]?.specialty || null,
        }));

      setProspects(prospectList);
    } catch (err) {
      console.error(err);
      toast.error('Error al cargar los prospectos');
    } finally {
      setLoading(false);
    }
  }

  const filtered = prospects.filter((p) => {
    const q = search.toLowerCase();
    return (
      (p.full_name || '').toLowerCase().includes(q) ||
      (p.email || '').toLowerCase().includes(q) ||
      (p.utm_source || '').toLowerCase().includes(q)
    );
  });

  function getDaysWaiting(createdAt) {
    return Math.floor((Date.now() - new Date(createdAt)) / 86400000);
  }

  function DaysBadge({ days }) {
    if (days < 3) {
      return <span className="text-text-secondary text-sm">{days}</span>;
    }
    if (days <= 14) {
      return (
        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-amber-50 text-amber-700">
          {days} días
        </span>
      );
    }
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-red-50 text-red-700">
        {days} días
      </span>
    );
  }

  function StatusPill({ status }) {
    if (status === 'sin_perfil') {
      return (
        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-600">
          Sin perfil
        </span>
      );
    }
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-amber-50 text-amber-700">
        Pendiente verificación
      </span>
    );
  }

  return (
    <div className="p-6 space-y-6">
      {/* Page header */}
      <div>
        <h1 className="text-2xl font-semibold text-text-primary">
          Prospectos — Profesionales
        </h1>
        <p className="text-text-secondary mt-1">
          {prospects.length} profesionale{prospects.length !== 1 ? 's' : ''} sin verificar
        </p>
      </div>

      {/* Callout */}
      <div className="card border-l-4 border-amber-400 bg-amber-50 flex gap-3 items-start">
        <WarningCircle size={20} className="text-amber-500 mt-0.5 shrink-0" weight="fill" />
        <p className="text-sm text-amber-800">
          Estos profesionales se registraron pero no han sido verificados aún. Completar la
          verificación para que puedan atender pacientes.
        </p>
      </div>

      {/* Search */}
      <div className="relative max-w-sm">
        <MagnifyingGlass
          size={16}
          className="absolute left-3 top-1/2 -translate-y-1/2 text-text-secondary"
        />
        <input
          type="text"
          placeholder="Buscar profesional..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="form-input pl-9 w-full"
        />
      </div>

      {/* Table */}
      {loading ? (
        <div className="card space-y-3">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="h-10 bg-gray-100 rounded animate-pulse" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="card flex flex-col items-center justify-center py-16 gap-3 text-center">
          <ShieldCheck size={40} className="text-brand" weight="duotone" />
          <p className="text-text-secondary font-medium">
            ¡Todos los profesionales están verificados!
          </p>
        </div>
      ) : (
        <div className="card overflow-x-auto p-0">
          <table className="w-full">
            <thead>
              <tr>
                <th className="table-header">Profesional</th>
                <th className="table-header">Especialidad</th>
                <th className="table-header">Estado perfil</th>
                <th className="table-header">UTM Fuente</th>
                <th className="table-header">Registro</th>
                <th className="table-header">Días esperando</th>
                <th className="table-header">Acción</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((prospect) => {
                const days = getDaysWaiting(prospect.created_at);
                return (
                  <tr key={prospect.id} className="table-row">
                    <td className="table-cell">
                      <div className="flex flex-col">
                        <span className="font-medium text-text-primary text-sm">
                          {prospect.full_name || '—'}
                        </span>
                        <span className="text-xs text-text-secondary">{prospect.email}</span>
                      </div>
                    </td>
                    <td className="table-cell text-sm text-text-secondary">
                      {prospect.specialty ? SPECIALTY_LABELS[prospect.specialty] || prospect.specialty : '—'}
                    </td>
                    <td className="table-cell">
                      <StatusPill status={prospect.profileStatus} />
                    </td>
                    <td className="table-cell text-sm text-text-secondary">
                      {prospect.utm_source || '—'}
                    </td>
                    <td className="table-cell text-sm text-text-secondary whitespace-nowrap">
                      {new Date(prospect.created_at).toLocaleDateString('es-AR', {
                        day: '2-digit',
                        month: '2-digit',
                        year: 'numeric',
                      })}
                    </td>
                    <td className="table-cell">
                      <DaysBadge days={days} />
                    </td>
                    <td className="table-cell">
                      <a
                        href="/admin/profesionales"
                        className="text-brand text-sm hover:underline"
                      >
                        Revisar
                      </a>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
