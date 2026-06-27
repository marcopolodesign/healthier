import { useState, useEffect } from 'react';
import { MagnifyingGlass, ShieldCheck } from '@phosphor-icons/react';
import { supabase } from '../../lib/supabase';
import { SPECIALTY_LABELS } from '../../lib/verticals';
import { toast } from '../../components/Toast';

function getInitials(fullName) {
  if (!fullName) return '?';
  const parts = fullName.trim().split(' ').filter(Boolean);
  if (parts.length === 1) return parts[0][0].toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function formatDate(dateStr) {
  if (!dateStr) return '—';
  const d = new Date(dateStr);
  return d.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

export default function SuperAdminProfesionales() {
  const [professionals, setProfessionals] = useState([]);
  const [consultationMap, setConsultationMap] = useState({});
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('todos');
  const [search, setSearch] = useState('');

  useEffect(() => {
    async function fetchData() {
      setLoading(true);
      try {
        const [profResult, consultResult] = await Promise.all([
          supabase
            .from('professional_profiles')
            .select('id, specialty, is_verified, average_rating, total_reviews, created_at, profiles(id, full_name, email, created_at, utm_source)')
            .order('created_at', { ascending: false }),
          supabase
            .from('consultations')
            .select('professional_id'),
        ]);

        if (profResult.error) throw profResult.error;
        if (consultResult.error) throw consultResult.error;

        setProfessionals(profResult.data || []);

        const map = {};
        for (const row of consultResult.data || []) {
          if (!row.professional_id) continue;
          map[row.professional_id] = (map[row.professional_id] || 0) + 1;
        }
        setConsultationMap(map);
      } catch (err) {
        console.error(err);
        toast.error('Error al cargar los profesionales');
      } finally {
        setLoading(false);
      }
    }

    fetchData();
  }, []);

  const filtered = professionals.filter((p) => {
    if (filter === 'verificados' && !p.is_verified) return false;
    if (filter === 'pendientes' && p.is_verified) return false;

    if (search.trim()) {
      const q = search.toLowerCase();
      const name = p.profiles?.full_name?.toLowerCase() || '';
      const email = p.profiles?.email?.toLowerCase() || '';
      const specialty = (SPECIALTY_LABELS[p.specialty] || p.specialty || '').toLowerCase();
      if (!name.includes(q) && !email.includes(q) && !specialty.includes(q)) return false;
    }

    return true;
  });

  const filterPills = [
    { key: 'todos', label: 'Todos' },
    { key: 'verificados', label: 'Verificados' },
    { key: 'pendientes', label: 'Pendientes' },
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Profesionales</h1>
        <p className="text-sm text-gray-500 mt-1">
          {loading ? 'Cargando...' : `${professionals.length} profesionales registrados`}
        </p>
      </div>

      {/* Filters + Search */}
      <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center justify-between">
        <div className="flex gap-2 flex-wrap">
          {filterPills.map((pill) => (
            <button
              key={pill.key}
              onClick={() => setFilter(pill.key)}
              className={`px-4 py-1.5 rounded-full text-sm font-medium transition-colors ${
                filter === pill.key
                  ? 'bg-[#7CB38B] text-white'
                  : 'bg-white text-gray-600 border border-gray-200 hover:border-[#7CB38B] hover:text-[#7CB38B]'
              }`}
            >
              {pill.label}
            </button>
          ))}
        </div>

        <div className="relative w-full sm:w-64">
          <MagnifyingGlass
            size={16}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"
          />
          <input
            type="text"
            placeholder="Buscar profesional..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="form-input pl-9 w-full text-sm"
          />
        </div>
      </div>

      {/* Table */}
      <div className="card overflow-hidden p-0">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-100">
                <th className="table-header">Profesional</th>
                <th className="table-header">Especialidad</th>
                <th className="table-header">Estado</th>
                <th className="table-header">Rating</th>
                <th className="table-header">Consultas</th>
                <th className="table-header">Registro</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                Array.from({ length: 6 }).map((_, i) => (
                  <tr key={i} className="table-row">
                    <td className="table-cell">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-gray-200 animate-pulse shrink-0" />
                        <div className="space-y-1.5">
                          <div className="h-3 w-32 bg-gray-200 rounded animate-pulse" />
                          <div className="h-2.5 w-24 bg-gray-100 rounded animate-pulse" />
                        </div>
                      </div>
                    </td>
                    {Array.from({ length: 5 }).map((_, j) => (
                      <td key={j} className="table-cell">
                        <div className="h-3 w-16 bg-gray-200 rounded animate-pulse" />
                      </td>
                    ))}
                  </tr>
                ))
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-16 text-center">
                    <div className="flex flex-col items-center gap-3 text-gray-400">
                      <ShieldCheck size={40} weight="thin" />
                      <p className="text-sm">No se encontraron profesionales</p>
                    </div>
                  </td>
                </tr>
              ) : (
                filtered.map((pro) => {
                  const name = pro.profiles?.full_name || '—';
                  const email = pro.profiles?.email || '—';
                  const initials = getInitials(pro.profiles?.full_name);
                  const specialtyLabel = SPECIALTY_LABELS[pro.specialty] || pro.specialty || '—';
                  const consultCount = consultationMap[pro.id] || 0;
                  const hasRating = pro.average_rating > 0;

                  return (
                    <tr key={pro.id} className="table-row">
                      {/* Profesional */}
                      <td className="table-cell">
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 rounded-full bg-[#e8f0eb] text-[#7CB38B] flex items-center justify-center text-xs font-semibold shrink-0">
                            {initials}
                          </div>
                          <div className="min-w-0">
                            <p className="text-sm font-medium text-gray-900 truncate">{name}</p>
                            <p className="text-xs text-gray-400 truncate">{email}</p>
                          </div>
                        </div>
                      </td>

                      {/* Especialidad */}
                      <td className="table-cell">
                        <span className="text-sm text-gray-700">{specialtyLabel}</span>
                      </td>

                      {/* Estado */}
                      <td className="table-cell">
                        {pro.is_verified ? (
                          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-emerald-50 text-emerald-700">
                            Verificado
                          </span>
                        ) : (
                          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-amber-50 text-amber-700">
                            Pendiente
                          </span>
                        )}
                      </td>

                      {/* Rating */}
                      <td className="table-cell">
                        {hasRating ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-amber-50 text-amber-700">
                            ★ {Number(pro.average_rating).toFixed(1)}
                          </span>
                        ) : (
                          <span className="text-gray-400 text-sm">—</span>
                        )}
                      </td>

                      {/* Consultas */}
                      <td className="table-cell">
                        <span className="text-sm text-gray-700">{consultCount}</span>
                      </td>

                      {/* Registro */}
                      <td className="table-cell">
                        <span className="text-sm text-gray-500">{formatDate(pro.created_at)}</span>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
