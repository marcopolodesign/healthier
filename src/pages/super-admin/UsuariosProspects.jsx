import { useState, useEffect } from 'react';
import { MagnifyingGlass, Users, WarningCircle, CheckCircle } from '@phosphor-icons/react';
import { supabase } from '../../lib/supabase';
import { toast } from '../../components/Toast';

export default function SuperAdminUsuariosProspects() {
  const [prospects, setProspects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [utmFilter, setUtmFilter] = useState('');

  useEffect(() => {
    fetchData();
  }, []);

  async function fetchData() {
    try {
      setLoading(true);
      const [profilesRes, consultationsRes] = await Promise.all([
        supabase
          .from('profiles')
          .select('id, email, full_name, created_at, dni, utm_source, utm_medium, utm_campaign, referrer_url')
          .eq('role', 'patient')
          .order('created_at', { ascending: false }),
        // Sólo videoconsultas que siguen valiendo: una cancelada o vencida no
        // cuenta como "ya agendó", vuelve a ser un prospecto.
        supabase
          .from('consultations')
          .select('patient_id, modality, status'),
      ]);

      if (profilesRes.error) throw profilesRes.error;
      if (consultationsRes.error) throw consultationsRes.error;

      const VIGENTES = ['pending', 'confirmed', 'in_progress', 'completed'];
      const conVideo = new Set(
        (consultationsRes.data || [])
          .filter((c) => c.modality === 'video' && VIGENTES.includes(c.status))
          .map((c) => c.patient_id)
      );

      // Definición de prospecto (Mateo, 2026-08-05): arrancó el onboarding y no
      // lo terminó, o todavía no agendó una videoconsulta. `dni` es el campo
      // obligatorio del paso de salud: si está vacío, el onboarding quedó a
      // mitad de camino.
      const filtered = (profilesRes.data || [])
        .map((p) => {
          const onboardingIncompleto = !p.dni;
          const sinVideo = !conVideo.has(p.id);
          return { ...p, onboardingIncompleto, sinVideo };
        })
        .filter((p) => p.onboardingIncompleto || p.sinVideo);

      setProspects(filtered);
    } catch (err) {
      console.error(err);
      toast.error('Error al cargar los prospectos.');
    } finally {
      setLoading(false);
    }
  }

  const uniqueUtmSources = [...new Set(prospects.map((p) => p.utm_source).filter(Boolean))];

  const filtered = prospects.filter((p) => {
    const q = search.toLowerCase();
    const matchSearch =
      !q ||
      (p.full_name || '').toLowerCase().includes(q) ||
      (p.email || '').toLowerCase().includes(q);
    const matchUtm = !utmFilter || p.utm_source === utmFilter;
    return matchSearch && matchUtm;
  });

  function daysSince(dateStr) {
    return Math.floor((Date.now() - new Date(dateStr)) / 86400000);
  }

  function DaysPill({ days }) {
    if (days < 7) {
      return (
        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-700">
          {days} días
        </span>
      );
    }
    if (days <= 30) {
      return (
        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-700">
          {days} días
        </span>
      );
    }
    return (
      <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-700">
        {days} días
      </span>
    );
  }

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Prospectos — Pacientes</h1>
          <p className="text-sm text-gray-500 mt-1">
            {loading ? '…' : `${prospects.length} pacientes por recuperar`}
          </p>
        </div>
        <Users size={32} className="text-brand mt-1" weight="duotone" />
      </div>

      {/* Callout */}
      <div className="bg-amber-50 border border-amber-100 rounded-xl p-4 mb-2 flex items-start gap-3">
        <WarningCircle size={20} className="text-amber-600 flex-shrink-0 mt-0.5" weight="fill" />
        <p className="text-sm text-amber-800">
          Pacientes que dejaron el onboarding a medias o que todavía no agendaron una
          videoconsulta. Una consulta cancelada o vencida no cuenta como agendada.
        </p>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <MagnifyingGlass
            size={16}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"
          />
          <input
            type="text"
            placeholder="Buscar por nombre o email…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="form-input pl-9 w-full"
          />
        </div>
        <select
          value={utmFilter}
          onChange={(e) => setUtmFilter(e.target.value)}
          className="form-input sm:w-56"
        >
          <option value="">Todas las fuentes</option>
          {uniqueUtmSources.map((src) => (
            <option key={src} value={src}>
              {src}
            </option>
          ))}
        </select>
      </div>

      {/* Table */}
      <div className="card overflow-x-auto">
        {loading ? (
          <div className="space-y-3 p-4">
            {[...Array(6)].map((_, i) => (
              <div key={i} className="h-10 bg-gray-100 rounded animate-pulse" />
            ))}
          </div>
        ) : filtered.length === 0 && prospects.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 gap-3">
            <CheckCircle size={40} className="text-brand" weight="duotone" />
            <p className="text-gray-500 text-sm">
              ¡Todos los pacientes ya realizaron una consulta!
            </p>
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 gap-3">
            <MagnifyingGlass size={32} className="text-gray-300" />
            <p className="text-gray-400 text-sm">Sin resultados para la búsqueda actual.</p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr>
                <th className="table-header">Paciente</th>
                <th className="table-header">Motivo</th>
                <th className="table-header">Fuente UTM</th>
                <th className="table-header">Campaña</th>
                <th className="table-header">Días desde registro</th>
                <th className="table-header">Acción</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((p) => {
                const days = daysSince(p.created_at);
                return (
                  <tr key={p.id} className="table-row">
                    <td className="table-cell">
                      <div className="font-medium text-gray-900">
                        {p.full_name || '(sin nombre)'}
                      </div>
                      <div className="text-xs text-gray-400">{p.email}</div>
                    </td>
                    {/* Por qué está en la lista: sin esto un prospecto que dejó
                        el onboarding a medias y uno que sólo no agendó todavía
                        se ven idénticos, y la acción para recuperarlos no es la
                        misma. */}
                    <td className="table-cell">
                      <div className="flex flex-col gap-1 items-start">
                        {p.onboardingIncompleto && (
                          <span className="status-badge status-pending">Onboarding incompleto</span>
                        )}
                        {p.sinVideo && (
                          <span className="status-badge status-in-progress">Sin videoconsulta</span>
                        )}
                      </div>
                    </td>
                    <td className="table-cell">
                      {p.utm_source ? (
                        <span className="text-gray-700">{p.utm_source}</span>
                      ) : (
                        <span className="text-gray-300">—</span>
                      )}
                    </td>
                    <td className="table-cell">
                      {p.utm_campaign ? (
                        <span className="text-gray-700">{p.utm_campaign}</span>
                      ) : (
                        <span className="text-gray-300">—</span>
                      )}
                    </td>
                    <td className="table-cell">
                      <DaysPill days={days} />
                    </td>
                    <td className="table-cell">
                      <a href="#" className="btn-secondary text-xs">
                        Ver perfil
                      </a>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
