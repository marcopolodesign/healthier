import { useState, useEffect } from 'react';
import { MagnifyingGlass, Stethoscope, WarningCircle, CheckCircle, Trash, X, ArrowSquareOut } from '@phosphor-icons/react';
import { supabase } from '../../lib/supabase';
import { toast } from '../../components/Toast';
import { adminService } from '../../services/adminService';
import WhatsAppButton from '../../components/super-admin/WhatsAppButton';
import { useBulkSelection } from '../../hooks/useBulkSelection';
import BulkActionBar from '../../components/super-admin/BulkActionBar';
import ConfirmDeleteDialog from '../../components/super-admin/ConfirmDeleteDialog';

// Mismos labels que STEPS en pages/professional/Onboarding.jsx — si ese
// wizard cambia de pasos, actualizar acá también.
const STEP_LABELS = ['Especialidad', 'Presentación', 'Documentos', 'Privacidad', 'Revisión'];

function getInitials(name) {
  if (!name) return '?';
  const parts = name.trim().split(' ').filter(Boolean);
  return parts.length === 1
    ? parts[0][0].toUpperCase()
    : (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function fmtDateTime(dateStr) {
  if (!dateStr) return '—';
  return new Date(dateStr).toLocaleString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function StepBadge({ step }) {
  if (step == null) {
    return <span className="status-badge">Sin dato</span>;
  }
  return <span className="status-badge status-pending">{STEP_LABELS[step] ?? `Paso ${step}`}</span>;
}

function ProspectDrawer({ prospect, onClose }) {
  const p = prospect;
  return (
    <div className="fixed inset-0 z-40 flex justify-end">
      <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" onClick={onClose} />
      <div className="relative z-50 w-full max-w-md bg-white shadow-2xl flex flex-col h-full overflow-hidden">
        <div className="flex items-start gap-3 p-5 border-b border-gray-100">
          <div className="w-10 h-10 rounded-full bg-[#e8f0eb] text-[#7CB38B] flex items-center justify-center font-semibold shrink-0">
            {getInitials(p.full_name)}
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-semibold text-gray-900 truncate">{p.full_name || '(sin nombre)'}</p>
            <p className="text-xs text-gray-400 truncate">{p.email}</p>
            <div className="mt-1.5">
              <StepBadge step={p.onboarding_step} />
            </div>
          </div>
          <button type="button" onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 shrink-0">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-6">
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <p className="text-xs text-gray-400 mb-0.5">Teléfono</p>
              <div className="flex items-center gap-1.5">
                <p className="font-medium text-gray-800">{p.phone || '—'}</p>
                <WhatsAppButton phone={p.phone} />
              </div>
            </div>
            <div>
              <p className="text-xs text-gray-400 mb-0.5">Registro</p>
              <p className="font-medium text-gray-800">{fmtDateTime(p.created_at)}</p>
            </div>
            <div>
              <p className="text-xs text-gray-400 mb-0.5">Fuente UTM</p>
              <p className="font-medium text-gray-800">{p.utm_source || '—'}</p>
            </div>
            <div>
              <p className="text-xs text-gray-400 mb-0.5">Medio UTM</p>
              <p className="font-medium text-gray-800">{p.utm_medium || '—'}</p>
            </div>
            <div className="col-span-2">
              <p className="text-xs text-gray-400 mb-0.5">Campaña</p>
              <p className="font-medium text-gray-800">{p.utm_campaign || '—'}</p>
            </div>
            {p.referrer_url && (
              <div className="col-span-2">
                <p className="text-xs text-gray-400 mb-0.5">Referrer</p>
                <a href={p.referrer_url} target="_blank" rel="noreferrer" className="font-medium text-brand hover:underline break-all inline-flex items-center gap-1">
                  {p.referrer_url} <ArrowSquareOut className="h-3.5 w-3.5 shrink-0" />
                </a>
              </div>
            )}
          </div>

          <div className="rounded-xl border border-gray-200 px-4 py-3">
            <p className="text-xs font-medium text-gray-500 mb-1">Dónde se quedó</p>
            <p className="text-sm text-gray-800">
              {p.onboarding_step == null
                ? 'Sin dato — se registró antes del 2026-08-10, cuando se empezó a trackear el paso.'
                : `Llegó hasta "${STEP_LABELS[p.onboarding_step] ?? `Paso ${p.onboarding_step}`}" y no envió el perfil para revisión.`}
            </p>
          </div>

          <a href={`mailto:${p.email}`} className="btn-secondary text-sm inline-block">
            Escribir por email
          </a>
        </div>
      </div>
    </div>
  );
}

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
          .select('id, email, full_name, phone, created_at, onboarding_step, utm_source, utm_medium, utm_campaign, referrer_url')
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
  const [selectedProspect, setSelectedProspect] = useState(null);

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
                  <tr key={p.id} className="table-row cursor-pointer" onClick={() => setSelectedProspect(p)}>
                    <td className="table-cell" onClick={(e) => e.stopPropagation()}>
                      <input type="checkbox" checked={selection.isSelected(p.id)} onChange={() => selection.toggle(p.id)} className="rounded border-border-default" />
                    </td>
                    <td className="table-cell">
                      <div className="flex items-center gap-1.5">
                        <div className="font-medium text-gray-900">
                          {p.full_name || '(sin nombre)'}
                        </div>
                        <div onClick={(e) => e.stopPropagation()}>
                          <WhatsAppButton phone={p.phone} />
                        </div>
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
                    <td className="table-cell" onClick={(e) => e.stopPropagation()}>
                      <a href={`mailto:${p.email}`} className="btn-secondary text-xs">
                        Escribir
                      </a>
                    </td>
                    <td className="table-cell" onClick={(e) => e.stopPropagation()}>
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
      {selectedProspect && (
        <ProspectDrawer prospect={selectedProspect} onClose={() => setSelectedProspect(null)} />
      )}
    </div>
  );
}
