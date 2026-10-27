import { useState, useEffect } from 'react';
import { MagnifyingGlass, Users, CheckCircle, Trash } from '@phosphor-icons/react';
import { supabase, toCamelCase } from '../../lib/supabase';
import { toast } from '../../components/Toast';
import { adminService } from '../../services/adminService';
import { MENSAJE_BAJA } from '../../services/bajaService';
import { useBulkSelection } from '../../hooks/useBulkSelection';
import BulkActionBar from '../../components/super-admin/BulkActionBar';
import ConfirmDeleteDialog from '../../components/super-admin/ConfirmDeleteDialog';
import PacienteOnboardingDrawer from '../../components/super-admin/PacienteOnboardingDrawer';
import { PASOS_PACIENTE, esProspecto, CAMPOS_ONBOARDING } from '../../lib/pacienteOnboarding';


// Prospecto (Mateo, 2026-10-26): se registró y no terminó el onboarding. El que
// lo terminó es un lead y está en Pacientes. Los pacientes de antes del wizard
// no son ni una cosa ni la otra (ver `entraEnEmbudo` en pacienteOnboarding.js).

function daysSince(dateStr) {
  return Math.floor((Date.now() - new Date(dateStr)) / 86400000);
}

function DaysPill({ days }) {
  const tono = days < 7 ? 'bg-green-100 text-green-700' : days <= 30 ? 'bg-amber-100 text-amber-700' : 'bg-red-100 text-red-700';
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${tono}`}>
      {days} días
    </span>
  );
}

export default function SuperAdminUsuariosProspects() {
  const [prospects, setProspects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [utmFilter, setUtmFilter] = useState('');
  const [campaignFilter, setCampaignFilter] = useState('');
  // null = sin filtro, número = índice de PASOS_PACIENTE, 'sin_dato' = nunca guardó un paso.
  const [stepFilter, setStepFilter] = useState(null);
  const [abierto, setAbierto] = useState(null);

  useEffect(() => {
    fetchData();
  }, []);

  async function fetchData() {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('profiles')
        .select(`id, email, full_name, created_at, utm_source, utm_medium, utm_campaign, utm_content, es_prueba, ${CAMPOS_ONBOARDING}`)
        .eq('role', 'patient')
        .is('deleted_at', null)
        .order('created_at', { ascending: false });
      if (error) throw error;

      const filtered = (data || []).filter((p) => !p.es_prueba && esProspecto(toCamelCase(p)));

      // Google vs. email vive en auth.users — misma vista que Prospectos de profesionales (110).
      // En tandas: con cientos de prospectos, un solo `.in()` pasa el largo de URL.
      const ids = filtered.map((p) => p.id);
      const providerById = new Map();
      for (let i = 0; i < ids.length; i += 100) {
        const { data: providersData, error: provErr } = await supabase
          .from('auth_providers_super_admin')
          .select('id, auth_provider')
          .in('id', ids.slice(i, i + 100));
        if (provErr) throw provErr;
        for (const r of providersData || []) providerById.set(r.id, r.auth_provider);
      }

      setProspects(filtered.map((p) => ({ ...p, auth_provider: providerById.get(p.id) ?? null })));
    } catch (err) {
      console.error(err);
      toast.error('Error al cargar los prospectos.');
    } finally {
      setLoading(false);
    }
  }

  const uniqueUtmSources = [...new Set(prospects.map((p) => p.utm_source).filter(Boolean))];
  const uniqueCampaigns = [...new Set(prospects.map((p) => p.utm_campaign).filter(Boolean))];

  const pasoDe = (p) => (p.paciente_paso_onboarding == null ? 'sin_dato' : p.paciente_paso_onboarding);

  const filtered = prospects.filter((p) => {
    const q = search.toLowerCase();
    const matchSearch = !q || (p.full_name || '').toLowerCase().includes(q) || (p.email || '').toLowerCase().includes(q);
    const matchUtm = !utmFilter || p.utm_source === utmFilter;
    const matchCampaign = !campaignFilter || p.utm_campaign === campaignFilter;
    const matchStep = stepFilter === null || pasoDe(p) === stepFilter;
    return matchSearch && matchUtm && matchCampaign && matchStep;
  });

  // El embudo cuenta sobre los filtros de fuente y campaña (no sobre el de paso):
  // así se ve dónde se frena la gente de UNA campaña.
  const base = prospects.filter((p) => (!utmFilter || p.utm_source === utmFilter) && (!campaignFilter || p.utm_campaign === campaignFilter));
  const funnelCounts = PASOS_PACIENTE.map((_, i) => base.filter((p) => pasoDe(p) === i).length);
  const sinDato = base.filter((p) => pasoDe(p) === 'sin_dato').length;

  const selection = useBulkSelection(filtered.map((p) => p.id));
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  async function deleteSelected(ids) {
    setDeleting(true);
    try {
      await adminService.deleteProfiles(ids);
      setProspects((prev) => prev.filter((p) => !ids.includes(p.id)));
      selection.clear();
      setConfirmOpen(false);
      toast.success(`${ids.length} prospecto${ids.length === 1 ? '' : 's'} eliminado${ids.length === 1 ? '' : 's'}`);
    } catch (err) {
      toast.error(err.message || 'No se pudo eliminar');
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Prospectos — Pacientes</h1>
          <p className="text-sm text-gray-500 mt-1">
            {loading ? '…' : `${prospects.length} sin terminar el registro`}
          </p>
        </div>
        <Users size={32} className="text-brand mt-1" weight="duotone" />
      </div>

      {/* Embudo: hasta qué paso llegó cada uno */}
      {!loading && prospects.length > 0 && (
        <div className="card p-4">
          <div className="flex items-center justify-between mb-3">
            <p className="text-sm font-medium text-gray-500">Dónde quedaron</p>
            {stepFilter !== null && (
              <button type="button" onClick={() => setStepFilter(null)} className="text-xs font-medium text-brand hover:underline">
                Ver todos
              </button>
            )}
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-6 gap-3">
            {PASOS_PACIENTE.map((paso, i) => (
              <button
                type="button"
                key={paso.key}
                onClick={() => setStepFilter((prev) => (prev === i ? null : i))}
                className={`text-center rounded-lg py-2 transition-colors ${
                  stepFilter === i ? 'bg-brand-muted ring-1 ring-brand' : 'hover:bg-gray-50'
                }`}
              >
                <p className="text-2xl font-bold text-gray-900 tabular-nums">{funnelCounts[i]}</p>
                <p className="text-sm text-gray-500 mt-0.5">{paso.corto}</p>
              </button>
            ))}
            <button
              type="button"
              onClick={() => setStepFilter((prev) => (prev === 'sin_dato' ? null : 'sin_dato'))}
              className={`text-center rounded-lg py-2 transition-colors ${
                stepFilter === 'sin_dato' ? 'bg-gray-200 ring-1 ring-gray-400' : 'hover:bg-gray-50'
              }`}
            >
              <p className="text-2xl font-bold text-gray-400 tabular-nums">{sinDato}</p>
              <p className="text-sm text-gray-400 mt-0.5">Sin dato</p>
            </button>
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <MagnifyingGlass size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            placeholder="Buscar por nombre o email…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="form-input pl-9 w-full"
          />
        </div>
        <select value={utmFilter} onChange={(e) => setUtmFilter(e.target.value)} className="form-input sm:w-48">
          <option value="">Todas las fuentes</option>
          {uniqueUtmSources.map((src) => <option key={src} value={src}>{src}</option>)}
        </select>
        <select value={campaignFilter} onChange={(e) => setCampaignFilter(e.target.value)} className="form-input sm:w-64">
          <option value="">Todas las campañas</option>
          {uniqueCampaigns.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
      </div>

      {/* Table */}
      <div className="card overflow-x-auto">
        {loading ? (
          <div className="space-y-3 p-4">
            {[...Array(6)].map((_, i) => <div key={i} className="h-10 bg-gray-100 rounded animate-pulse" />)}
          </div>
        ) : prospects.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 gap-3">
            <CheckCircle size={40} className="text-brand" weight="duotone" />
            <p className="text-gray-500 text-sm">Todos los pacientes nuevos terminaron el registro</p>
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 gap-3">
            <MagnifyingGlass size={32} className="text-gray-300" />
            <p className="text-gray-400 text-sm">Sin resultados</p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr>
                <th className="table-header w-8">
                  <input type="checkbox" checked={selection.isAllSelected} onChange={selection.toggleAll} className="rounded border-border-default" />
                </th>
                <th className="table-header">Paciente</th>
                <th className="table-header">Quedó en</th>
                <th className="table-header">Método</th>
                <th className="table-header">Fuente</th>
                <th className="table-header">Campaña</th>
                <th className="table-header">Registro</th>
                <th className="table-header w-8" />
              </tr>
            </thead>
            <tbody>
              {filtered.map((p) => {
                const paso = pasoDe(p);
                return (
                  <tr key={p.id} className="table-row cursor-pointer" onClick={() => setAbierto(p)}>
                    <td className="table-cell">
                      <input type="checkbox" checked={selection.isSelected(p.id)} onChange={() => selection.toggle(p.id)} onClick={(e) => e.stopPropagation()} className="rounded border-border-default" />
                    </td>
                    <td className="table-cell">
                      <div className="font-medium text-gray-900">{p.full_name || '(sin nombre)'}</div>
                      <div className="text-xs text-gray-400">{p.email}</div>
                    </td>
                    <td className="table-cell">
                      {paso === 'sin_dato'
                        ? <span className="text-gray-300">—</span>
                        : <span className="status-badge status-pending whitespace-nowrap">{PASOS_PACIENTE[paso]?.corto}</span>}
                    </td>
                    <td className="table-cell text-gray-700">
                      {p.auth_provider === 'google' ? 'Google' : p.auth_provider === 'apple' ? 'Apple' : p.auth_provider === 'email' ? 'Email' : <span className="text-gray-300">—</span>}
                    </td>
                    <td className="table-cell">
                      {p.utm_source ? <span className="text-gray-700">{p.utm_source}</span> : <span className="text-gray-300">—</span>}
                    </td>
                    <td className="table-cell">
                      {p.utm_campaign ? (
                        <div>
                          <p className="text-gray-700">{p.utm_campaign}</p>
                          {p.utm_content && <p className="text-xs text-gray-400">{p.utm_content}</p>}
                        </div>
                      ) : <span className="text-gray-300">—</span>}
                    </td>
                    <td className="table-cell"><DaysPill days={daysSince(p.created_at)} /></td>
                    <td className="table-cell">
                      <button onClick={(e) => { e.stopPropagation(); selection.toggle(p.id); setConfirmOpen(true); }} className="p-1 text-text-tertiary hover:text-danger transition-colors" title="Eliminar">
                        <Trash className="h-4 w-4" />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {abierto && <PacienteOnboardingDrawer paciente={abierto} onClose={() => setAbierto(null)} />}

      <BulkActionBar count={selection.count} onDelete={() => setConfirmOpen(true)} onClear={selection.clear} />
      <ConfirmDeleteDialog
        open={confirmOpen}
        title={`Eliminar ${selection.count} prospecto${selection.count === 1 ? '' : 's'}`}
        message={MENSAJE_BAJA}
        loading={deleting}
        onConfirm={() => deleteSelected(selection.selectedIds)}
        onCancel={() => setConfirmOpen(false)}
      />
    </div>
  );
}
