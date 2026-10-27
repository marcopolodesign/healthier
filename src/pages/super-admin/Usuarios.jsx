import { useState, useEffect } from 'react';
import { MagnifyingGlass, Users, DownloadSimple, Trash } from '@phosphor-icons/react';
import { supabase } from '../../lib/supabase';
import { toast } from '../../components/Toast';
import { adminService } from '../../services/adminService';
import { MENSAJE_BAJA } from '../../services/bajaService';
import { useBulkSelection } from '../../hooks/useBulkSelection';
import BulkActionBar from '../../components/super-admin/BulkActionBar';
import ConfirmDeleteDialog from '../../components/super-admin/ConfirmDeleteDialog';
import PacienteOnboardingDrawer from '../../components/super-admin/PacienteOnboardingDrawer';
import { toCamelCase } from '../../lib/supabase';
import { completitudPaciente, esLead, entraEnEmbudo, CAMPOS_ONBOARDING, CONSULTA_VIGENTE } from '../../lib/pacienteOnboarding';
import MetricCard from '../../components/super-admin/MetricCard';


const fechaCorta = (ts) => new Date(ts).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', timeZone: 'America/Argentina/Buenos_Aires' });

/** Cinco puntos, uno por paso; los obligatorios más oscuros. */
function PuntosPerfil({ c }) {
  return (
    <div className="flex items-center gap-1" aria-label={`${c.completados} de ${c.total} pasos`}>
      {c.pasos.map((s) => (
        <span
          key={s.key}
          title={`${s.corto}${s.obligatorio ? '' : ' (opcional)'}: ${s.done ? 'hecho' : 'pendiente'}`}
          className={`w-2.5 h-2.5 rounded-full ${
            s.done ? (s.obligatorio ? 'bg-brand' : 'bg-brand/50') : (s.obligatorio ? 'bg-gray-300' : 'bg-gray-200')
          }`}
        />
      ))}
    </div>
  );
}

export default function SuperAdminUsuarios() {
  const [patients, setPatients] = useState([]);
  const [consultationMap, setConsultationMap] = useState({});
  const [conVigente, setConVigente] = useState(new Set());
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('todos');
  const [search, setSearch] = useState('');
  const [perfilFilter, setPerfilFilter] = useState('todos');
  const [verCampanas, setVerCampanas] = useState(false);
  const [abierto, setAbierto] = useState(null);

  useEffect(() => {
    fetchData();
  }, []);

  async function fetchData() {
    setLoading(true);
    try {
      const [profilesRes, consultationsRes] = await Promise.all([
        supabase
          .from('profiles')
          .select(`id, email, full_name, created_at, utm_source, utm_medium, utm_campaign, es_prueba, ${CAMPOS_ONBOARDING}`)
          .eq('role', 'patient')
          .is('deleted_at', null) // bajas lógicas (188) fuera
          .order('created_at', { ascending: false }),
        supabase
          .from('consultations')
          .select('patient_id, status'),
      ]);

      if (profilesRes.error) throw profilesRes.error;
      if (consultationsRes.error) throw consultationsRes.error;

      const map = {};
      for (const row of consultationsRes.data || []) {
        map[row.patient_id] = (map[row.patient_id] || 0) + 1;
      }

      setPatients((profilesRes.data || []).map((p) => {
        const cc = toCamelCase(p);
        return { ...p, _c: completitudPaciente(cc), _nuevo: entraEnEmbudo(cc) && !p.es_prueba, _lead: esLead(cc) && !p.es_prueba };
      }));
      setConsultationMap(map);
      setConVigente(new Set((consultationsRes.data || []).filter((c) => CONSULTA_VIGENTE.includes(c.status)).map((c) => c.patient_id)));
    } catch (err) {
      toast.error('Error al cargar usuarios');
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  const filteredPatients = patients.filter((p) => {
    const count = consultationMap[p.id] || 0;
    if (filter === 'con_consultas' && count === 0) return false;
    if (filter === 'sin_consultas' && count > 0) return false;
    if (perfilFilter === 'leads' && !p._lead) return false;
    if (perfilFilter === 'incompleto' && p._c.obligatoriosCompletos) return false;
    if (perfilFilter === 'sin_consentimiento' && p.consentimiento_at) return false;

    if (search.trim()) {
      const q = search.toLowerCase();
      const name = (p.full_name || '').toLowerCase();
      const email = (p.email || '').toLowerCase();
      if (!name.includes(q) && !email.includes(q)) return false;
    }

    return true;
  });

  function formatDate(dateStr) {
    if (!dateStr) return '—';
    return new Date(dateStr).toLocaleDateString('es-AR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    });
  }

  function exportCSV() {
    const headers = ['Nombre', 'Email', 'UTM Source', 'UTM Campaign', 'Consultas', 'Registro', 'Perfil', 'Lead', 'Le falta', 'Consentimiento'];
    const rows = filteredPatients.map((p) => [
      p.full_name || '',
      p.email || '',
      p.utm_source || '',
      p.utm_campaign || '',
      consultationMap[p.id] || 0,
      formatDate(p.created_at),
      `${p._c.completados}/${p._c.total}`,
      p._lead ? 'Sí' : '',
      p._c.faltan.join(' · '),
      p.consentimiento_at ? formatDate(p.consentimiento_at) : 'Sin consentimiento',
    ]);

    const csvContent = [headers, ...rows]
      .map((row) =>
        row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(',')
      )
      .join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `usuarios-pacientes-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
    toast.success('CSV exportado correctamente');
  }

  const selection = useBulkSelection(filteredPatients.map((p) => p.id));
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  async function deleteSelected(ids) {
    setDeleting(true);
    try {
      await adminService.deleteProfiles(ids);
      setPatients((prev) => prev.filter((p) => !ids.includes(p.id)));
      selection.clear();
      setConfirmOpen(false);
      toast.success(`${ids.length} usuario${ids.length === 1 ? '' : 's'} eliminado${ids.length === 1 ? '' : 's'}`);
    } catch (err) {
      toast.error(err.message || 'No se pudo eliminar');
    } finally {
      setDeleting(false);
    }
  }

  // Lead = terminó el onboarding (Mateo, 2026-10-26; `esLead`). Sólo cuentan los
  // que pasaron por el wizard y no son de prueba. Dónde se frena el resto está
  // en Prospectos, no acá, para no ver el mismo número en dos pantallas.
  const nuevos = patients.filter((p) => p._nuevo);
  const leads = nuevos.filter((p) => p._lead);
  const leadsConConsulta = leads.filter((p) => conVigente.has(p.id));
  const pct = (a, b) => (b > 0 ? `${Math.round((a / b) * 100)}%` : '');
  const porCampana = Object.values(nuevos.reduce((acc, p) => {
    const k = p.utm_campaign || 'Sin UTM';
    acc[k] ??= { campana: k, registros: 0, leads: 0, conConsulta: 0 };
    acc[k].registros += 1;
    if (p._lead) acc[k].leads += 1;
    if (p._lead && conVigente.has(p.id)) acc[k].conConsulta += 1;
    return acc;
  }, {})).sort((a, b) => b.registros - a.registros);

  const perfilPills = [
    { key: 'todos', label: 'Todos los perfiles' },
    { key: 'leads', label: 'Leads' },
    { key: 'incompleto', label: 'Le faltan datos obligatorios' },
    { key: 'sin_consentimiento', label: 'Sin consentimiento' },
  ];

  const filterPills = [
    { key: 'todos', label: 'Todos' },
    { key: 'con_consultas', label: 'Con consultas' },
    { key: 'sin_consultas', label: 'Sin consultas' },
  ];

  return (
    <div className="p-6 space-y-6">
      {/* Page header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-text-primary">Usuarios (Pacientes)</h1>
          <p className="text-sm text-text-secondary mt-1">
            {loading ? 'Cargando…' : `${filteredPatients.length} usuario${filteredPatients.length !== 1 ? 's' : ''} en total`}
          </p>
        </div>
        <button onClick={exportCSV} className="btn-secondary flex items-center gap-2 shrink-0">
          <DownloadSimple size={16} />
          Exportar CSV
        </button>
      </div>

      {!loading && (
        <div className="space-y-3">
          <div className="grid grid-cols-3 gap-4">
            <MetricCard label="Registros nuevos" value={nuevos.length} />
            <button type="button" onClick={() => setVerCampanas((v) => !v)} className={`text-left rounded-2xl ${verCampanas ? 'ring-1 ring-brand' : ''}`}>
              <MetricCard label="Leads" value={leads.length} hint={pct(leads.length, nuevos.length)} tone="ok" />
            </button>
            <MetricCard label="Con consulta" value={leadsConConsulta.length} hint={pct(leadsConConsulta.length, leads.length)} />
          </div>
          {verCampanas && (
            <div className="card overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr>
                    <th className="table-header">Campaña</th>
                    <th className="table-header text-right">Registros</th>
                    <th className="table-header text-right">Leads</th>
                    <th className="table-header text-right">%</th>
                    <th className="table-header text-right">Con consulta</th>
                  </tr>
                </thead>
                <tbody>
                  {porCampana.map((f) => (
                    <tr key={f.campana} className="table-row">
                      <td className="table-cell">{f.campana === 'Sin UTM' ? <span className="text-text-tertiary">Sin UTM</span> : f.campana}</td>
                      <td className="table-cell text-right tabular-nums">{f.registros}</td>
                      <td className="table-cell text-right tabular-nums font-semibold">{f.leads}</td>
                      <td className="table-cell text-right tabular-nums text-text-secondary">{pct(f.leads, f.registros)}</td>
                      <td className="table-cell text-right tabular-nums">{f.conConsulta}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      <div className="flex gap-2 flex-wrap">
        {perfilPills.map((pill) => (
          <button
            key={pill.key}
            onClick={() => setPerfilFilter(pill.key)}
            className={`px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
              perfilFilter === pill.key
                ? 'bg-text-primary text-white'
                : 'bg-white text-text-secondary border border-border hover:border-text-primary hover:text-text-primary'
            }`}
          >
            {pill.label}
          </button>
        ))}
      </div>

      {/* Filters + Search */}
      <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center justify-between">
        <div className="flex gap-2 flex-wrap">
          {filterPills.map((pill) => (
            <button
              key={pill.key}
              onClick={() => setFilter(pill.key)}
              className={`px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
                filter === pill.key
                  ? 'bg-brand text-white'
                  : 'bg-white text-text-secondary border border-border hover:border-brand hover:text-brand'
              }`}
            >
              {pill.label}
            </button>
          ))}
        </div>
        <div className="relative max-w-sm w-full">
          <MagnifyingGlass
            size={16}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-text-tertiary"
          />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar por nombre o email…"
            className="form-input pl-9 w-full"
          />
        </div>
      </div>

      {/* Table */}
      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr>
                <th className="table-header w-8">
                  <input type="checkbox" checked={selection.isAllSelected} onChange={selection.toggleAll} className="rounded border-border-default" />
                </th>
                <th className="table-header">Usuario</th>
                <th className="table-header">Perfil</th>
                <th className="table-header">Consentimiento</th>
                <th className="table-header">Fuente UTM</th>
                <th className="table-header">Consultas</th>
                <th className="table-header">Registro</th>
                <th className="table-header w-8" />
              </tr>
            </thead>
            <tbody>
              {loading ? (
                Array.from({ length: 6 }).map((_, i) => (
                  <tr key={i} className="table-row">
                    <td className="table-cell">
                      <div className="space-y-2 animate-pulse">
                        <div className="h-4 bg-gray-200 rounded w-36" />
                        <div className="h-3 bg-gray-100 rounded w-48" />
                      </div>
                    </td>
                    <td className="table-cell">
                      <div className="h-5 bg-gray-200 rounded w-20 animate-pulse" />
                    </td>
                    <td className="table-cell">
                      <div className="h-4 bg-gray-200 rounded w-8 animate-pulse" />
                    </td>
                    <td className="table-cell">
                      <div className="h-4 bg-gray-200 rounded w-24 animate-pulse" />
                    </td>
                  </tr>
                ))
              ) : filteredPatients.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-16 text-center">
                    <div className="flex flex-col items-center gap-3 text-text-tertiary">
                      <Users size={40} weight="thin" />
                      <span className="text-sm">No se encontraron usuarios</span>
                    </div>
                  </td>
                </tr>
              ) : (
                filteredPatients.map((patient) => {
                  const count = consultationMap[patient.id] || 0;
                  return (
                    <tr key={patient.id} className="table-row cursor-pointer" onClick={() => setAbierto(patient)}>
                      <td className="table-cell">
                        <input type="checkbox" checked={selection.isSelected(patient.id)} onChange={() => selection.toggle(patient.id)} onClick={(e) => e.stopPropagation()} className="rounded border-border-default" />
                      </td>
                      {/* Usuario */}
                      <td className="table-cell">
                        <div>
                          <p className="font-medium text-text-primary">
                            {patient.full_name || '(Sin nombre)'}
                            {/* Cuenta de prueba (migración 186): sólo se cruza con
                                profesionales de prueba — no ve ni le llega nada de uno real. */}
                            {patient.es_prueba && (
                              <span className="ml-1.5 align-middle rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-800">
                                Prueba
                              </span>
                            )}
                          </p>
                          <p className="text-xs text-text-secondary mt-0.5">{patient.email}</p>
                        </div>
                      </td>

                      {/* Perfil — onboarding por pasos */}
                      <td className="table-cell">
                        {patient.titular_id ? (
                          <span className="text-sm text-text-tertiary">Familiar a cargo</span>
                        ) : (
                          <div className="space-y-1.5">
                            <div className="flex items-center gap-2">
                              <PuntosPerfil c={patient._c} />
                              {patient._lead && (
                                <span className="rounded-full bg-green-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-green-800">Lead</span>
                              )}
                            </div>
                            {patient._c.faltan.length > 0 && (
                              <div className="flex gap-1 flex-wrap">
                                {patient._c.faltan.filter((f) => f !== 'Sin consentimiento').slice(0, 1).map((f) => (
                                  <span key={f} className="status-badge status-pending whitespace-nowrap">{f}</span>
                                ))}
                                {patient._c.faltan.filter((f) => f !== 'Sin consentimiento').length > 1 && (
                                  <span className="status-badge">+{patient._c.faltan.filter((f) => f !== 'Sin consentimiento').length - 1}</span>
                                )}
                              </div>
                            )}
                          </div>
                        )}
                      </td>

                      {/* Consentimiento */}
                      <td className="table-cell text-sm">
                        {patient.consentimiento_at
                          ? <span className="text-text-secondary tabular-nums">{fechaCorta(patient.consentimiento_at)}</span>
                          : <span className="text-text-tertiary">Sin consentimiento</span>}
                      </td>

                      {/* UTM Source */}
                      <td className="table-cell">
                        {patient.utm_source ? (
                          <span className="inline-block px-2 py-0.5 rounded-full text-xs font-medium bg-purple-50 text-purple-700">
                            {patient.utm_source}
                          </span>
                        ) : (
                          <span className="text-text-tertiary">—</span>
                        )}
                      </td>

                      {/* Consultas */}
                      <td className="table-cell">
                        {count > 0 ? (
                          <span className="font-bold text-text-primary">{count}</span>
                        ) : (
                          <span className="text-text-tertiary">0</span>
                        )}
                      </td>

                      {/* Registro */}
                      <td className="table-cell text-sm text-text-secondary">
                        {formatDate(patient.created_at)}
                      </td>
                      <td className="table-cell">
                        <button onClick={(e) => { e.stopPropagation(); selection.toggle(patient.id); setConfirmOpen(true); }} className="p-1 text-text-tertiary hover:text-danger transition-colors" title="Eliminar">
                          <Trash className="h-4 w-4" />
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {abierto && <PacienteOnboardingDrawer paciente={abierto} onClose={() => setAbierto(null)} />}

      <BulkActionBar count={selection.count} onDelete={() => setConfirmOpen(true)} onClear={selection.clear} />
      <ConfirmDeleteDialog
        open={confirmOpen}
        title={`Eliminar ${selection.count} usuario${selection.count === 1 ? '' : 's'}`}
        message={MENSAJE_BAJA}
        loading={deleting}
        onConfirm={() => deleteSelected(selection.selectedIds)}
        onCancel={() => setConfirmOpen(false)}
      />
    </div>
  );
}
