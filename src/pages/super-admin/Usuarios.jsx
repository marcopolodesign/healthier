import { useState, useEffect } from 'react';
import { MagnifyingGlass, Users, DownloadSimple, Trash } from '@phosphor-icons/react';
import { supabase } from '../../lib/supabase';
import { toast } from '../../components/Toast';
import { adminService } from '../../services/adminService';
import { useBulkSelection } from '../../hooks/useBulkSelection';
import BulkActionBar from '../../components/super-admin/BulkActionBar';
import ConfirmDeleteDialog from '../../components/super-admin/ConfirmDeleteDialog';
import { faltanDatosPaciente, listar } from '../../lib/datosReceta';

// Esta pantalla lee `profiles` sin pasar por el service, así que las filas
// vienen en snake_case y `faltanDatosPaciente` espera camelCase. Se adapta sólo
// lo que la función mira, en vez de convertir la fila entera.
const faltanRcta = row => faltanDatosPaciente({
  dni: row.dni,
  gender: row.gender,
  birthDate: row.birth_date,
});

export default function SuperAdminUsuarios() {
  const [patients, setPatients] = useState([]);
  const [consultationMap, setConsultationMap] = useState({});
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('todos');
  const [search, setSearch] = useState('');

  useEffect(() => {
    fetchData();
  }, []);

  async function fetchData() {
    setLoading(true);
    try {
      const [profilesRes, consultationsRes] = await Promise.all([
        supabase
          .from('profiles')
          // dni/gender/birth_date: son los que exige la receta electrónica y los
          // que hoy frenan la reserva si faltan — ver la columna "Datos receta".
          .select('id, email, full_name, created_at, utm_source, utm_medium, utm_campaign, dni, gender, birth_date')
          .eq('role', 'patient')
          .order('created_at', { ascending: false }),
        supabase
          .from('consultations')
          .select('patient_id'),
      ]);

      if (profilesRes.error) throw profilesRes.error;
      if (consultationsRes.error) throw consultationsRes.error;

      const map = {};
      for (const row of consultationsRes.data || []) {
        map[row.patient_id] = (map[row.patient_id] || 0) + 1;
      }

      setPatients(profilesRes.data || []);
      setConsultationMap(map);
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
    const headers = ['Nombre', 'Email', 'UTM Source', 'UTM Campaign', 'Consultas', 'Registro'];
    const rows = filteredPatients.map((p) => [
      p.full_name || '',
      p.email || '',
      p.utm_source || '',
      p.utm_campaign || '',
      consultationMap[p.id] || 0,
      formatDate(p.created_at),
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
            {loading ? 'Cargando...' : `${filteredPatients.length} usuario${filteredPatients.length !== 1 ? 's' : ''} en total`}
          </p>
        </div>
        <button onClick={exportCSV} className="btn-secondary flex items-center gap-2 shrink-0">
          <DownloadSimple size={16} />
          Exportar CSV
        </button>
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
                <th className="table-header">Fuente UTM</th>
                <th className="table-header">Datos receta</th>
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
                  <td colSpan={7} className="py-16 text-center">
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
                    <tr key={patient.id} className="table-row">
                      <td className="table-cell">
                        <input type="checkbox" checked={selection.isSelected(patient.id)} onChange={() => selection.toggle(patient.id)} className="rounded border-border-default" />
                      </td>
                      {/* Usuario */}
                      <td className="table-cell">
                        <div>
                          <p className="font-medium text-text-primary">
                            {patient.full_name || '(Sin nombre)'}
                          </p>
                          <p className="text-xs text-text-secondary mt-0.5">{patient.email}</p>
                        </div>
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

                      {/* Datos receta — lo que hoy le frena la reserva */}
                      <td className="table-cell">
                        {faltanRcta(patient).length === 0 ? (
                          <span className="inline-block px-2 py-0.5 rounded-full text-xs font-medium bg-brand-muted text-brand">
                            Completo
                          </span>
                        ) : (
                          <span
                            className="inline-block px-2 py-0.5 rounded-full text-xs font-medium bg-amber-50 text-amber-700"
                            title={`No puede reservar hasta cargar: ${listar(faltanRcta(patient))}`}
                          >
                            Falta {listar(faltanRcta(patient))}
                          </span>
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
                        <button onClick={() => { selection.toggle(patient.id); setConfirmOpen(true); }} className="p-1 text-text-tertiary hover:text-danger transition-colors" title="Eliminar">
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

      <BulkActionBar count={selection.count} onDelete={() => setConfirmOpen(true)} onClear={selection.clear} />
      <ConfirmDeleteDialog
        open={confirmOpen}
        title={`Eliminar ${selection.count} usuario${selection.count === 1 ? '' : 's'}`}
        message="Esta acción no se puede deshacer. Si el usuario tiene historia clínica, la ley 26.529 impide borrarlo."
        loading={deleting}
        onConfirm={() => deleteSelected(selection.selectedIds)}
        onCancel={() => setConfirmOpen(false)}
      />
    </div>
  );
}
