import { useState, useEffect } from 'react';
import { MagnifyingGlass, Stethoscope, WarningCircle, CheckCircle, Trash } from '@phosphor-icons/react';
import { supabase } from '../../lib/supabase';
import { toast } from '../../components/Toast';
import { adminService } from '../../services/adminService';
import { useBulkSelection } from '../../hooks/useBulkSelection';
import BulkActionBar from '../../components/super-admin/BulkActionBar';
import ConfirmDeleteDialog from '../../components/super-admin/ConfirmDeleteDialog';

// Mismos labels que STEPS en pages/professional/Onboarding.jsx — si ese
// wizard cambia de pasos, actualizar acá también.
const STEP_LABELS = ['Especialidad', 'Presentación', 'Documentos', 'Privacidad', 'Revisión'];

export default function SuperAdminProfesionalesProspects() {
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
      const [profilesRes, professionalProfilesRes] = await Promise.all([
        supabase
          .from('profiles')
          .select('id, email, full_name, created_at, onboarding_step, utm_source, utm_medium, utm_campaign, referrer_url')
          .eq('role', 'professional')
          .order('created_at', { ascending: false }),
        supabase.from('professional_profiles').select('user_id'),
      ]);

      if (profilesRes.error) throw profilesRes.error;
      if (professionalProfilesRes.error) throw professionalProfilesRes.error;

      // Un profesional "completó" cuando existe su fila en professional_profiles
      // (se crea recién al enviar el wizard, no antes — ver Onboarding.jsx).
      const completaron = new Set((professionalProfilesRes.data || []).map((p) => p.user_id));
      const filtered = (profilesRes.data || []).filter((p) => !completaron.has(p.id));

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

  // Cuenta cuántos prospectos llegaron a cada paso — a los que nunca abrieron
  // el wizard, o se registraron antes de que existiera onboarding_step
  // (2026-08-10), no se les puede saber el paso.
  const funnelCounts = STEP_LABELS.map(
    (_, i) => prospects.filter((p) => p.onboarding_step === i).length
  );
  const sinDatoCount = prospects.filter((p) => p.onboarding_step == null).length;

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

  function StepBadge({ step }) {
    if (step == null) {
      return <span className="status-badge">Sin dato</span>;
    }
    return <span className="status-badge status-pending">{STEP_LABELS[step] ?? `Paso ${step}`}</span>;
  }

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Prospectos — Profesionales</h1>
          <p className="text-sm text-gray-500 mt-1">
            {loading ? '…' : `${prospects.length} profesionales que no terminaron el alta`}
          </p>
        </div>
        <Stethoscope size={32} className="text-brand mt-1" weight="duotone" />
      </div>

      {/* Callout */}
      <div className="bg-amber-50 border border-amber-100 rounded-xl p-4 mb-2 flex items-start gap-3">
        <WarningCircle size={20} className="text-amber-600 flex-shrink-0 mt-0.5" weight="fill" />
        <p className="text-sm text-amber-800">
          Profesionales que crearon cuenta pero no enviaron el perfil para revisión —
          no aparecen en el panel de Profesionales hasta que lo hacen.
          "Sin dato" son de antes del 2026-08-10, cuando se empezó a trackear el paso.
        </p>
      </div>

      {/* Funnel */}
      {!loading && (
        <div className="card p-4">
          <p className="text-xs font-medium text-gray-500 mb-3">Dónde se frenan</p>
          <div className="grid grid-cols-2 sm:grid-cols-6 gap-3">
            {STEP_LABELS.map((label, i) => (
              <div key={label} className="text-center">
                <p className="text-2xl font-bold text-gray-900">{funnelCounts[i]}</p>
                <p className="text-xs text-gray-500 mt-0.5">{label}</p>
              </div>
            ))}
            <div className="text-center">
              <p className="text-2xl font-bold text-gray-400">{sinDatoCount}</p>
              <p className="text-xs text-gray-400 mt-0.5">Sin dato</p>
            </div>
          </div>
        </div>
      )}

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
              ¡Todos los que se registraron como profesional completaron el alta!
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
                <th className="table-header w-8">
                  <input type="checkbox" checked={selection.isAllSelected} onChange={selection.toggleAll} className="rounded border-border-default" />
                </th>
                <th className="table-header">Profesional</th>
                <th className="table-header">Último paso</th>
                <th className="table-header">Fuente UTM</th>
                <th className="table-header">Campaña</th>
                <th className="table-header">Días desde registro</th>
                <th className="table-header">Acción</th>
                <th className="table-header w-8" />
              </tr>
            </thead>
            <tbody>
              {filtered.map((p) => {
                const days = daysSince(p.created_at);
                return (
                  <tr key={p.id} className="table-row">
                    <td className="table-cell">
                      <input type="checkbox" checked={selection.isSelected(p.id)} onChange={() => selection.toggle(p.id)} className="rounded border-border-default" />
                    </td>
                    <td className="table-cell">
                      <div className="font-medium text-gray-900">
                        {p.full_name || '(sin nombre)'}
                      </div>
                      <div className="text-xs text-gray-400">{p.email}</div>
                    </td>
                    <td className="table-cell">
                      <StepBadge step={p.onboarding_step} />
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
                      <a href={`mailto:${p.email}`} className="btn-secondary text-xs">
                        Escribir
                      </a>
                    </td>
                    <td className="table-cell">
                      <button onClick={() => { selection.toggle(p.id); setConfirmOpen(true); }} className="p-1 text-text-tertiary hover:text-danger transition-colors" title="Eliminar">
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

      <BulkActionBar count={selection.count} onDelete={() => setConfirmOpen(true)} onClear={selection.clear} />
      <ConfirmDeleteDialog
        open={confirmOpen}
        title={`Eliminar ${selection.count} prospecto${selection.count === 1 ? '' : 's'}`}
        message="Esta acción no se puede deshacer."
        loading={deleting}
        onConfirm={() => deleteSelected(selection.selectedIds)}
        onCancel={() => setConfirmOpen(false)}
      />
    </div>
  );
}
