import { useState, useEffect, useMemo, useCallback } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  Leaf, User, AppleLogo, SquaresFour, Pulse,
  Plus, Minus, X, MagnifyingGlass,
  Clock, Trash, Globe, Check, Warning,
  TrendUp, Flame, Wind,
  Calendar, ChartBar, Info, ProhibitInset
} from '@phosphor-icons/react'
import { professionalService } from '../../services/professionalService'
import { profilesService } from '../../services/profilesService'
import { toast } from '../../components/Toast'
import localFoodDatabase from '../../data/localFoods'
import {
  DEFAULT_CALC_CONFIG,
  DEFAULT_MEALS,
  ACTIVITY_MULTIPLIERS,
  DIET_OPTIONS,
  calculateNutrition,
  computeConsumedFood,
  computeTotals,
  buildPatientMealsData,
  searchFatSecret,
} from '../../services/nutriplanService'

const SAGE = '#7CB38B'
const SAGE_BG = '#EDF7F0'
const SAGE_DARK = '#3D6B4A'

const LOCAL_CATEGORIES = [...new Set(localFoodDatabase.map(f => f.category))].sort()

// ─── Small utility components ────────────────────────────────────────────────

function PillToggle({ options, value, onChange }) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map(opt => (
        <button
          key={opt.value}
          onClick={() => onChange(opt.value)}
          className="px-3 py-1.5 rounded-full text-sm font-medium border transition-all"
          style={value === opt.value
            ? { backgroundColor: SAGE, borderColor: SAGE, color: '#fff' }
            : { backgroundColor: '#fff', borderColor: '#d1d5db', color: '#6b7280' }
          }
        >
          {opt.label}
          {opt.desc && <span className="ml-1 opacity-75 text-xs">· {opt.desc}</span>}
        </button>
      ))}
    </div>
  )
}

function MacroBar({ label, consumed, target, color }) {
  const pct = target > 0 ? Math.min(100, Math.round((consumed / target) * 100)) : 0
  const over = consumed > target && target > 0
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-xs text-gray-500">
        <span className="font-medium text-gray-700">{label}</span>
        <span className={over ? 'text-red-500 font-medium' : ''}>
          {consumed}g / {target}g
        </span>
      </div>
      <div className="h-2 rounded-full bg-gray-100 overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-300"
          style={{ width: `${pct}%`, backgroundColor: over ? '#ef4444' : color }}
        />
      </div>
    </div>
  )
}

function StatCard({ icon: Icon, label, value, sub, color }) {
  return (
    <div className="bg-white rounded-xl p-4 border border-gray-100 shadow-sm">
      <div className="flex items-start gap-3">
        <div className="p-2 rounded-lg" style={{ backgroundColor: SAGE_BG }}>
          <Icon className="h-4 w-4" style={{ color: SAGE_DARK }} />
        </div>
        <div className="min-w-0">
          <p className="text-xs text-gray-500 truncate">{label}</p>
          <p className="text-xl font-bold text-gray-800">{value}</p>
          {sub && <p className="text-xs text-gray-400 mt-0.5">{sub}</p>}
        </div>
      </div>
    </div>
  )
}

// ─── Add Food Modal (quantity picker) ────────────────────────────────────────

function AddFoodModal({ food, onAdd, onClose }) {
  const [qty, setQty] = useState(100)
  const preview = computeConsumedFood(food, qty)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-6 space-y-5">
        <div className="flex items-start justify-between">
          <div>
            <h3 className="font-semibold text-gray-800 leading-tight">{food.name}</h3>
            {food.brand && <p className="text-xs text-gray-400 mt-0.5">{food.brand}</p>}
            <span className="inline-block mt-1 text-xs px-2 py-0.5 rounded-full" style={{ backgroundColor: SAGE_BG, color: SAGE_DARK }}>
              {food.category}
            </span>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 p-1">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Cantidad (gramos)</label>
          <div className="flex items-center gap-3">
            <button
              onClick={() => setQty(q => Math.max(5, q - 10))}
              className="w-9 h-9 rounded-full border border-gray-200 flex items-center justify-center text-gray-600 hover:bg-gray-50"
            >
              <Minus className="h-4 w-4" />
            </button>
            <input
              type="number"
              min="5"
              max="2000"
              value={qty}
              onChange={e => setQty(Math.max(5, parseInt(e.target.value) || 5))}
              className="flex-1 text-center border border-gray-200 rounded-lg py-2 text-lg font-bold focus:outline-none focus:ring-2"
              style={{ focusRingColor: SAGE }}
            />
            <button
              onClick={() => setQty(q => Math.min(2000, q + 10))}
              className="w-9 h-9 rounded-full border border-gray-200 flex items-center justify-center text-gray-600 hover:bg-gray-50"
            >
              <Plus className="h-4 w-4" />
            </button>
          </div>
          <p className="text-xs text-gray-400 mt-1 text-center">Valores por 100g en catálogo</p>
        </div>

        <div className="grid grid-cols-4 gap-2 text-center">
          {[
            { label: 'Cal', value: preview.consumedCalories, unit: 'kcal' },
            { label: 'Prot', value: preview.consumedProtein, unit: 'g' },
            { label: 'HC', value: preview.consumedCarbs, unit: 'g' },
            { label: 'Grasas', value: preview.consumedFat, unit: 'g' },
          ].map(m => (
            <div key={m.label} className="bg-gray-50 rounded-lg py-2 px-1">
              <p className="text-xs text-gray-500">{m.label}</p>
              <p className="font-bold text-gray-800 text-sm">{m.value}</p>
              <p className="text-xs text-gray-400">{m.unit}</p>
            </div>
          ))}
        </div>

        <div className="flex gap-3">
          <button onClick={onClose} className="flex-1 py-2.5 rounded-xl border border-gray-200 text-gray-600 text-sm font-medium hover:bg-gray-50">
            Cancelar
          </button>
          <button
            onClick={() => { onAdd(preview); onClose() }}
            className="flex-1 py-2.5 rounded-xl text-white text-sm font-medium"
            style={{ backgroundColor: SAGE }}
          >
            Agregar
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Custom Food Modal ────────────────────────────────────────────────────────

function CustomFoodModal({ onAdd, onClose }) {
  const [form, setForm] = useState({ name: '', category: 'Varios', calories: '', protein: '', carbs: '', fat: '', fiber: '' })

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))
  const valid = form.name.trim() && form.calories !== ''

  const handleAdd = () => {
    const food = {
      id: `custom_${Date.now()}`,
      name: form.name.trim(),
      category: form.category,
      calories: parseFloat(form.calories) || 0,
      protein: parseFloat(form.protein) || 0,
      carbs: parseFloat(form.carbs) || 0,
      fat: parseFloat(form.fat) || 0,
      fiber: parseFloat(form.fiber) || 0,
    }
    onAdd(food)
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6 space-y-5">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-gray-800">Alimento personalizado</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 p-1">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="grid grid-cols-1 gap-3">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Nombre *</label>
            <input
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1"
              style={{ '--tw-ring-color': SAGE }}
              placeholder="Ej: Tortilla casera"
              value={form.name}
              onChange={e => set('name', e.target.value)}
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Categoría</label>
            <select
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none"
              value={form.category}
              onChange={e => set('category', e.target.value)}
            >
              {LOCAL_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
              <option value="Varios">Varios</option>
            </select>
          </div>
          <p className="text-xs text-gray-400">Valores por 100g</p>
          <div className="grid grid-cols-3 gap-2">
            {[
              { k: 'calories', label: 'Calorías (kcal)', required: true },
              { k: 'protein', label: 'Proteínas (g)' },
              { k: 'carbs', label: 'Hidratos (g)' },
              { k: 'fat', label: 'Grasas (g)' },
              { k: 'fiber', label: 'Fibra (g)' },
            ].map(({ k, label, required }) => (
              <div key={k}>
                <label className="block text-xs text-gray-500 mb-1">{label}{required && ' *'}</label>
                <input
                  type="number"
                  min="0"
                  className="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-sm focus:outline-none"
                  placeholder="0"
                  value={form[k]}
                  onChange={e => set(k, e.target.value)}
                />
              </div>
            ))}
          </div>
        </div>

        <div className="flex gap-3">
          <button onClick={onClose} className="flex-1 py-2.5 rounded-xl border border-gray-200 text-gray-600 text-sm font-medium hover:bg-gray-50">
            Cancelar
          </button>
          <button
            onClick={handleAdd}
            disabled={!valid}
            className="flex-1 py-2.5 rounded-xl text-white text-sm font-medium disabled:opacity-40"
            style={{ backgroundColor: SAGE }}
          >
            Agregar
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Tab: Paciente ────────────────────────────────────────────────────────────

function TabPaciente({ gender, setGender, age, setAge, weight, setWeight, height, setHeight,
  activityLevel, setPulseLevel, dietType, setDietType, results }) {

  const bmiColors = { 'Bajo peso': '#3b82f6', 'Normal': SAGE, 'Sobrepeso': '#f59e0b', 'Obesidad': '#ef4444' }
  const bmiColor = bmiColors[results?.bmiCategory] || '#6b7280'

  return (
    <div className="space-y-6">
      {/* Biometric form */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 space-y-5">
        <h2 className="font-semibold text-gray-700 flex items-center gap-2">
          <User className="h-4 w-4" style={{ color: SAGE }} />
          Datos del paciente
        </h2>

        {/* Gender */}
        <div>
          <p className="text-sm font-medium text-gray-600 mb-2">Sexo biológico</p>
          <PillToggle
            options={[{ value: 'male', label: 'Masculino' }, { value: 'female', label: 'Femenino' }]}
            value={gender}
            onChange={setGender}
          />
        </div>

        {/* Numeric inputs */}
        <div className="grid grid-cols-3 gap-4">
          {[
            { label: 'Edad', unit: 'años', value: age, onChange: setAge, min: 10, max: 99 },
            { label: 'Peso', unit: 'kg', value: weight, onChange: setWeight, min: 20, max: 300 },
            { label: 'Talla', unit: 'cm', value: height, onChange: setHeight, min: 100, max: 250 },
          ].map(({ label, unit, value, onChange, min, max }) => (
            <div key={label}>
              <label className="block text-sm font-medium text-gray-600 mb-1">{label}</label>
              <div className="relative">
                <input
                  type="number"
                  min={min}
                  max={max}
                  value={value}
                  onChange={e => onChange(e.target.value)}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 pr-10 text-sm focus:outline-none focus:ring-1 focus:border-transparent"
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-gray-400">{unit}</span>
              </div>
            </div>
          ))}
        </div>

        {/* Pulse */}
        <div>
          <p className="text-sm font-medium text-gray-600 mb-2">Nivel de actividad</p>
          <PillToggle options={ACTIVITY_MULTIPLIERS} value={activityLevel} onChange={setPulseLevel} />
        </div>

        {/* Diet type */}
        <div>
          <p className="text-sm font-medium text-gray-600 mb-2">Tipo de plan</p>
          <PillToggle options={DIET_OPTIONS} value={dietType} onChange={setDietType} />
        </div>
      </div>

      {/* Results card */}
      {results && results.targetCalories > 0 && (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 space-y-5">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold text-gray-700 flex items-center gap-2">
              <TrendUp className="h-4 w-4" style={{ color: SAGE }} />
              Resultados calculados
            </h2>
            <span
              className="text-xs font-medium px-3 py-1 rounded-full"
              style={{ backgroundColor: SAGE_BG, color: SAGE_DARK }}
            >
              Mifflin-St Jeor
            </span>
          </div>

          {/* BMI */}
          <div className="flex items-center gap-4 p-4 rounded-xl" style={{ backgroundColor: SAGE_BG }}>
            <div className="text-center">
              <p className="text-3xl font-bold" style={{ color: bmiColor }}>{results.bmi}</p>
              <p className="text-xs text-gray-500 mt-0.5">IMC</p>
            </div>
            <div className="h-10 w-px bg-gray-200" />
            <div>
              <p className="font-semibold" style={{ color: bmiColor }}>{results.bmiCategory}</p>
              <p className="text-xs text-gray-500">kg/m²</p>
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <StatCard icon={Flame} label="TMB" value={`${results.bmr} kcal`} sub="Metabolismo basal" />
            <StatCard icon={Pulse} label="TDEE" value={`${results.tdee} kcal`} sub="Gasto total" />
            <StatCard icon={TrendUp} label="Objetivo" value={`${results.targetCalories} kcal`} sub="Meta diaria" />
            <StatCard icon={Wind} label="Fibra" value={`${results.macros.fiber}g`} sub="14g/1000kcal" />
          </div>

          {/* Macros breakdown */}
          <div className="grid grid-cols-3 gap-3">
            {[
              { label: 'Proteínas', value: results.macros.protein, kcal: results.macros.protein * 4, color: '#8b5cf6' },
              { label: 'Hidratos', value: results.macros.carbs, kcal: results.macros.carbs * 4, color: '#f59e0b' },
              { label: 'Grasas', value: results.macros.fat, kcal: results.macros.fat * 9, color: '#ef4444' },
            ].map(m => (
              <div key={m.label} className="bg-gray-50 rounded-xl p-3 text-center">
                <p className="text-xs text-gray-500 mb-1">{m.label}</p>
                <p className="text-xl font-bold text-gray-800">{m.value}g</p>
                <p className="text-xs text-gray-400">{m.kcal} kcal</p>
                <div className="mt-2 h-1.5 rounded-full bg-gray-200 overflow-hidden">
                  <div
                    className="h-full rounded-full"
                    style={{
                      width: `${results.targetCalories > 0 ? Math.min(100, Math.round((m.kcal / results.targetCalories) * 100)) : 0}%`,
                      backgroundColor: m.color
                    }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {!results || results.targetCalories === 0 ? (
        <div className="rounded-2xl border border-dashed border-gray-200 p-8 text-center text-gray-400">
          <User className="h-8 w-8 mx-auto mb-2 opacity-30" />
          <p className="text-sm">Completá los datos del paciente para ver los resultados</p>
        </div>
      ) : null}
    </div>
  )
}

// ─── Tab: Dieta ───────────────────────────────────────────────────────────────

function TabDieta({ consumedFoods, addFood, removeFood, totals, results,
  search, setSearch, selectedCat, setSelectedCat,
  fsResults, fsLoading, fsError, fsSearched, onFsSearch,
  showCustomModal, setShowCustomModal, addCustomFood }) {

  const [pendingFood, setPendingFood] = useState(null)

  const localFiltered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return localFoodDatabase.filter(f =>
      (selectedCat === '' || f.category === selectedCat) &&
      (q === '' || f.name.toLowerCase().includes(q))
    ).slice(0, 50)
  }, [search, selectedCat])

  const targetCal = results?.targetCalories || 0
  const calPct = targetCal > 0 ? Math.min(100, Math.round((totals.calories / targetCal) * 100)) : 0
  const calOver = totals.calories > targetCal && targetCal > 0

  return (
    <div className="space-y-6">
      {/* Calorie progress */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-semibold text-gray-700 flex items-center gap-2">
            <Flame className="h-4 w-4" style={{ color: SAGE }} />
            Calorías del plan
          </h2>
          <span className={`text-lg font-bold ${calOver ? 'text-red-500' : 'text-gray-800'}`}>
            {totals.calories} / {targetCal > 0 ? targetCal : '—'} kcal
          </span>
        </div>
        <div className="h-3 rounded-full bg-gray-100 overflow-hidden">
          <div
            className="h-full rounded-full transition-all duration-500"
            style={{ width: `${calPct}%`, backgroundColor: calOver ? '#ef4444' : SAGE }}
          />
        </div>
        {targetCal > 0 && (
          <div className="flex justify-between text-xs text-gray-400 mt-1">
            <span>{calPct}% del objetivo</span>
            <span>{Math.max(0, targetCal - totals.calories)} kcal restantes</span>
          </div>
        )}

        {/* Macros */}
        {results?.macros && (
          <div className="mt-4 grid grid-cols-1 gap-2.5">
            <MacroBar label="Proteínas" consumed={Math.round(totals.protein)} target={results.macros.protein} color="#8b5cf6" />
            <MacroBar label="Hidratos" consumed={Math.round(totals.carbs)} target={results.macros.carbs} color="#f59e0b" />
            <MacroBar label="Grasas" consumed={Math.round(totals.fat)} target={results.macros.fat} color="#ef4444" />
            <MacroBar label="Fibra" consumed={Math.round(totals.fiber)} target={results.macros.fiber} color={SAGE} />
          </div>
        )}
      </div>

      {/* Current food list */}
      {consumedFoods.length > 0 && (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 space-y-3">
          <h2 className="font-semibold text-gray-700 flex items-center gap-2">
            <AppleLogo className="h-4 w-4" style={{ color: SAGE }} />
            Alimentos del plan ({consumedFoods.length})
          </h2>
          <div className="divide-y divide-gray-50">
            {consumedFoods.map(food => (
              <div key={food.id} className="flex items-center gap-3 py-2.5">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-800 truncate">{food.name}</p>
                  <p className="text-xs text-gray-400">
                    {food.consumedQuantity}g · {food.consumedCalories} kcal
                    · P:{food.consumedProtein}g HC:{food.consumedCarbs}g G:{food.consumedFat}g
                  </p>
                </div>
                <button
                  onClick={() => removeFood(food.id)}
                  className="text-gray-300 hover:text-red-400 p-1 shrink-0 transition-colors"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Food search */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold text-gray-700 flex items-center gap-2">
            <MagnifyingGlass className="h-4 w-4" style={{ color: SAGE }} />
            Buscar alimento
          </h2>
          <button
            onClick={() => setShowCustomModal(true)}
            className="text-xs px-3 py-1.5 rounded-full border flex items-center gap-1 hover:bg-gray-50 transition-colors"
            style={{ borderColor: SAGE, color: SAGE }}
          >
            <Plus className="h-3 w-3" />
            Personalizado
          </button>
        </div>

        {/* MagnifyingGlass input */}
        <div className="relative">
          <MagnifyingGlass className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-300" />
          <input
            type="text"
            placeholder="Buscar en catálogo local..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full pl-9 pr-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-1 bg-gray-50"
          />
        </div>

        {/* Category filter */}
        <div className="flex gap-1.5 flex-wrap">
          <button
            onClick={() => setSelectedCat('')}
            className="px-2.5 py-1 rounded-full text-xs font-medium border transition-all"
            style={selectedCat === ''
              ? { backgroundColor: SAGE, borderColor: SAGE, color: '#fff' }
              : { backgroundColor: '#fff', borderColor: '#e5e7eb', color: '#6b7280' }
            }
          >
            Todos
          </button>
          {LOCAL_CATEGORIES.map(cat => (
            <button
              key={cat}
              onClick={() => setSelectedCat(cat === selectedCat ? '' : cat)}
              className="px-2.5 py-1 rounded-full text-xs font-medium border transition-all"
              style={selectedCat === cat
                ? { backgroundColor: SAGE, borderColor: SAGE, color: '#fff' }
                : { backgroundColor: '#fff', borderColor: '#e5e7eb', color: '#6b7280' }
              }
            >
              {cat}
            </button>
          ))}
        </div>

        {/* FatSecret online search */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => onFsSearch(search)}
            disabled={!search.trim() || fsLoading}
            className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium border transition-all disabled:opacity-40"
            style={{ borderColor: SAGE, color: SAGE }}
          >
            <Globe className="h-4 w-4" />
            {fsLoading ? 'Buscando...' : 'Buscar en FatSecret'}
          </button>
          {fsError && (
            <span className="text-xs text-red-500 flex items-center gap-1">
              <Warning className="h-3 w-3" />
              Error al buscar
            </span>
          )}
        </div>

        {/* FatSecret results */}
        {fsSearched && fsResults.length === 0 && !fsLoading && (
          <p className="text-sm text-gray-400 text-center py-2">Sin resultados en FatSecret para "{search}"</p>
        )}
        {fsResults.length > 0 && (
          <div>
            <p className="text-xs font-medium text-gray-500 mb-2 flex items-center gap-1">
              <Globe className="h-3 w-3" />
              FatSecret — {fsResults.length} resultados
            </p>
            <div className="divide-y divide-gray-50 max-h-48 overflow-y-auto">
              {fsResults.map(food => (
                <button
                  key={food.id}
                  onClick={() => setPendingFood(food)}
                  className="w-full text-left flex items-center justify-between py-2.5 px-1 hover:bg-gray-50 rounded-lg group transition-colors"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-gray-800 truncate">{food.name}</p>
                    {food.brand && <p className="text-xs text-gray-400">{food.brand}</p>}
                    <p className="text-xs text-gray-400">
                      {food.calories} kcal · P:{food.protein}g HC:{food.carbs}g G:{food.fat}g
                    </p>
                  </div>
                  <Plus className="h-4 w-4 shrink-0 text-gray-300 group-hover:text-sage transition-colors ml-2" style={{ color: SAGE }} />
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Local results */}
        {localFiltered.length > 0 && (
          <div>
            <p className="text-xs font-medium text-gray-500 mb-2">
              Catálogo local — {localFiltered.length} alimentos
            </p>
            <div className="divide-y divide-gray-50 max-h-64 overflow-y-auto">
              {localFiltered.map(food => (
                <button
                  key={food.id}
                  onClick={() => setPendingFood(food)}
                  className="w-full text-left flex items-center justify-between py-2.5 px-1 hover:bg-gray-50 rounded-lg group transition-colors"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-gray-800 truncate">{food.name}</p>
                    <p className="text-xs text-gray-400">
                      {food.calories} kcal/100g · P:{food.protein}g HC:{food.carbs}g G:{food.fat}g
                    </p>
                  </div>
                  <Plus className="h-4 w-4 shrink-0 text-gray-300 ml-2" style={{ color: SAGE }} />
                </button>
              ))}
            </div>
          </div>
        )}

        {localFiltered.length === 0 && !search && (
          <p className="text-sm text-gray-400 text-center py-3">Escribí para buscar en el catálogo</p>
        )}
        {localFiltered.length === 0 && search && (
          <p className="text-sm text-gray-400 text-center py-3">
            Sin resultados locales para "{search}". Probá FatSecret.
          </p>
        )}
      </div>

      {/* Quantity modal */}
      {pendingFood && (
        <AddFoodModal
          food={pendingFood}
          onAdd={(consumed) => addFood(consumed)}
          onClose={() => setPendingFood(null)}
        />
      )}

      {/* Custom food modal */}
      {showCustomModal && (
        <CustomFoodModal
          onAdd={(food) => { addCustomFood(food); toast.success(`${food.name} agregado`) }}
          onClose={() => setShowCustomModal(false)}
        />
      )}
    </div>
  )
}

// ─── Tab: Template ────────────────────────────────────────────────────────────

function TabTemplate({ meals, setMeals, consumedFoods, foodDist, toggleDist }) {
  const [newMealName, setNewMealName] = useState('')
  const [newMealTime, setNewMealTime] = useState('12:00')

  const addMeal = () => {
    if (!newMealName.trim()) return
    const id = `m_${Date.now()}`
    setMeals(m => [...m, { id, name: newMealName.trim(), time: newMealTime }])
    setNewMealName('')
    setNewMealTime('12:00')
    toast.success('Comida agregada')
  }

  const removeMeal = (id) => {
    setMeals(m => m.filter(x => x.id !== id))
  }

  const updateMeal = (id, field, value) => {
    setMeals(m => m.map(x => x.id === id ? { ...x, [field]: value } : x))
  }

  return (
    <div className="space-y-6">
      {/* Meals editor */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 space-y-4">
        <h2 className="font-semibold text-gray-700 flex items-center gap-2">
          <SquaresFour className="h-4 w-4" style={{ color: SAGE }} />
          Comidas del plan
        </h2>

        <div className="divide-y divide-gray-50">
          {meals.map((meal, idx) => (
            <div key={meal.id} className="py-3 flex items-center gap-3">
              <div className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold text-white shrink-0" style={{ backgroundColor: SAGE }}>
                {idx + 1}
              </div>
              <input
                type="text"
                value={meal.name}
                onChange={e => updateMeal(meal.id, 'name', e.target.value)}
                className="flex-1 border-b border-gray-200 py-1 text-sm text-gray-800 focus:outline-none focus:border-transparent"
                placeholder="Nombre de la comida"
              />
              <div className="flex items-center gap-1 text-gray-400">
                <Clock className="h-3.5 w-3.5" />
                <input
                  type="time"
                  value={meal.time}
                  onChange={e => updateMeal(meal.id, 'time', e.target.value)}
                  className="text-sm text-gray-600 focus:outline-none bg-transparent"
                />
              </div>
              <button
                onClick={() => removeMeal(meal.id)}
                className="text-gray-300 hover:text-red-400 p-1 shrink-0 transition-colors"
              >
                <Trash className="h-4 w-4" />
              </button>
            </div>
          ))}
        </div>

        {/* Add meal */}
        <div className="flex items-center gap-2 pt-2">
          <input
            type="text"
            value={newMealName}
            onChange={e => setNewMealName(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && addMeal()}
            placeholder="Nueva comida..."
            className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 bg-gray-50"
          />
          <input
            type="time"
            value={newMealTime}
            onChange={e => setNewMealTime(e.target.value)}
            className="border border-gray-200 rounded-lg px-2 py-2 text-sm focus:outline-none bg-gray-50"
          />
          <button
            onClick={addMeal}
            disabled={!newMealName.trim()}
            className="px-4 py-2 rounded-lg text-white text-sm font-medium disabled:opacity-40"
            style={{ backgroundColor: SAGE }}
          >
            <Plus className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Food distribution */}
      {consumedFoods.length > 0 && meals.length > 0 && (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 space-y-4">
          <h2 className="font-semibold text-gray-700 flex items-center gap-2">
            <AppleLogo className="h-4 w-4" style={{ color: SAGE }} />
            Distribución de alimentos
          </h2>
          <p className="text-xs text-gray-400">Marcá en qué comidas aparece cada alimento</p>

          <div className="space-y-3">
            {consumedFoods.map(food => (
              <div key={food.id} className="border border-gray-100 rounded-xl p-3">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-sm font-medium text-gray-800">{food.name}</p>
                  <p className="text-xs text-gray-400">{food.consumedQuantity}g · {food.consumedCalories} kcal</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {meals.map(meal => {
                    const assigned = (foodDist[food.id] || []).includes(meal.id)
                    return (
                      <button
                        key={meal.id}
                        onClick={() => toggleDist(food.id, meal.id)}
                        className="px-2.5 py-1 rounded-full text-xs font-medium border transition-all flex items-center gap-1"
                        style={assigned
                          ? { backgroundColor: SAGE, borderColor: SAGE, color: '#fff' }
                          : { backgroundColor: '#fff', borderColor: '#e5e7eb', color: '#6b7280' }
                        }
                      >
                        {assigned && <Check className="h-3 w-3" />}
                        {meal.name}
                      </button>
                    )
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Preview: patient template */}
      {meals.length > 0 && consumedFoods.length > 0 && (
        <PatientTemplatePreview meals={meals} consumedFoods={consumedFoods} foodDist={foodDist} />
      )}
    </div>
  )
}

function PatientTemplatePreview({ meals, consumedFoods, foodDist }) {
  const data = buildPatientMealsData(meals, consumedFoods, foodDist)
  const assignedCount = Object.values(data).reduce((a, arr) => a + arr.length, 0)

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold text-gray-700 flex items-center gap-2">
          <Calendar className="h-4 w-4" style={{ color: SAGE }} />
          Vista del paciente
        </h2>
        {assignedCount === 0 && (
          <span className="text-xs text-gray-400 flex items-center gap-1">
            <Info className="h-3 w-3" />
            Sin distribución
          </span>
        )}
      </div>

      <div className="space-y-3">
        {meals.map((meal, idx) => {
          const items = data[meal.id] || []
          const mealCal = items.reduce((a, f) => a + computeConsumedFood(f, f.qty).consumedCalories, 0)
          return (
            <div key={meal.id} className="border border-gray-100 rounded-xl overflow-hidden">
              <div className="px-4 py-2.5 flex items-center justify-between" style={{ backgroundColor: SAGE_BG }}>
                <div className="flex items-center gap-2">
                  <span className="w-5 h-5 rounded-full text-white text-xs flex items-center justify-center font-bold" style={{ backgroundColor: SAGE }}>
                    {idx + 1}
                  </span>
                  <span className="font-medium text-sm" style={{ color: SAGE_DARK }}>{meal.name}</span>
                  <span className="text-xs text-gray-400">{meal.time}</span>
                </div>
                {mealCal > 0 && <span className="text-xs font-medium" style={{ color: SAGE_DARK }}>{mealCal} kcal</span>}
              </div>
              {items.length === 0 ? (
                <div className="px-4 py-3 text-xs text-gray-400 italic">Sin alimentos asignados</div>
              ) : (
                <ul className="divide-y divide-gray-50">
                  {items.map(f => (
                    <li key={f.uid} className="px-4 py-2 flex justify-between text-sm">
                      <span className="text-gray-700">{f.name}</span>
                      <span className="text-gray-400">{f.qty}g</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ─── Tab: Monitoreo ───────────────────────────────────────────────────────────

function TabMonitoreo({ tracking, trackingHistory, trackingDate, setTrackingDate, results }) {
  const todayReports = tracking.filter(r => {
    const d = new Date(r.date)
    const t = new Date(trackingDate)
    return d.toDateString() === t.toDateString()
  })

  const allDates = [...new Set(trackingHistory.map(r => new Date(r.date).toLocaleDateString('es-AR')))].slice(0, 7)

  return (
    <div className="space-y-6">
      {/* Date selector */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 space-y-3">
        <h2 className="font-semibold text-gray-700 flex items-center gap-2">
          <Calendar className="h-4 w-4" style={{ color: SAGE }} />
          Monitoreo diario
        </h2>
        <div className="flex items-center gap-3">
          <input
            type="date"
            value={trackingDate}
            onChange={e => setTrackingDate(e.target.value)}
            className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none"
          />
          <span className="text-sm text-gray-500">
            {new Date(trackingDate).toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long' })}
          </span>
        </div>
      </div>

      {/* Today's reports */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 space-y-3">
        <h3 className="font-medium text-gray-700 flex items-center gap-2">
          <Pulse className="h-4 w-4" style={{ color: SAGE }} />
          Reportes del paciente
        </h3>

        {todayReports.length === 0 ? (
          <div className="py-10 text-center space-y-2">
            <ChartBar className="h-10 w-10 mx-auto opacity-20 text-gray-400" />
            <p className="text-sm text-gray-400 font-medium">Sin reportes para esta fecha</p>
            <p className="text-xs text-gray-300">El paciente aún no registró consumo para este día</p>
          </div>
        ) : (
          <div className="space-y-3">
            {todayReports.map((report, i) => (
              <div key={i} className="border border-gray-100 rounded-xl p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-gray-700">{report.meal}</span>
                  <span className="text-xs text-gray-400">{report.time}</span>
                </div>
                <div className="grid grid-cols-4 gap-2 text-center">
                  {[
                    { label: 'Cal', value: report.calories, unit: 'kcal' },
                    { label: 'Prot', value: report.protein, unit: 'g' },
                    { label: 'HC', value: report.carbs, unit: 'g' },
                    { label: 'Grasas', value: report.fat, unit: 'g' },
                  ].map(m => (
                    <div key={m.label} className="bg-gray-50 rounded-lg py-1.5 px-1">
                      <p className="text-xs text-gray-400">{m.label}</p>
                      <p className="font-bold text-gray-800 text-sm">{m.value}</p>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ClockCounterClockwise */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 space-y-3">
        <h3 className="font-medium text-gray-700 flex items-center gap-2">
          <TrendUp className="h-4 w-4" style={{ color: SAGE }} />
          Historial reciente
        </h3>

        {trackingHistory.length === 0 ? (
          <div className="py-8 text-center space-y-2">
            <TrendUp className="h-8 w-8 mx-auto opacity-20 text-gray-400" />
            <p className="text-sm text-gray-400">Sin historial disponible</p>
            <p className="text-xs text-gray-300">Los registros del paciente aparecerán aquí</p>
          </div>
        ) : (
          <div className="space-y-2">
            {allDates.map(date => {
              const dayReports = trackingHistory.filter(r => new Date(r.date).toLocaleDateString('es-AR') === date)
              const dayTotals = dayReports.reduce((a, r) => ({
                calories: a.calories + (r.calories || 0),
                protein: a.protein + (r.protein || 0),
              }), { calories: 0, protein: 0 })
              const adherence = results?.targetCalories > 0
                ? Math.min(100, Math.round((dayTotals.calories / results.targetCalories) * 100))
                : 0
              return (
                <div key={date} className="flex items-center gap-3 py-2 border-b border-gray-50 last:border-0">
                  <span className="text-xs text-gray-500 w-24 shrink-0">{date}</span>
                  <div className="flex-1 h-2 rounded-full bg-gray-100 overflow-hidden">
                    <div
                      className="h-full rounded-full"
                      style={{
                        width: `${adherence}%`,
                        backgroundColor: adherence >= 90 ? SAGE : adherence >= 70 ? '#f59e0b' : '#ef4444'
                      }}
                    />
                  </div>
                  <span className="text-xs font-medium text-gray-600 w-16 text-right shrink-0">
                    {dayTotals.calories} kcal
                  </span>
                  <span className="text-xs text-gray-400 w-12 text-right shrink-0">
                    {adherence}%
                  </span>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Info note */}
      <div className="rounded-xl border border-dashed border-gray-200 p-4 flex items-start gap-3 text-gray-400">
        <Info className="h-4 w-4 shrink-0 mt-0.5" />
        <p className="text-xs leading-relaxed">
          El monitoreo se activará cuando el paciente comience a registrar su consumo diario desde la app móvil.
          Esta vista mostrará la adherencia en tiempo real al plan prescripto.
        </p>
      </div>
    </div>
  )
}

// ─── Main Page ────────────────────────────────────────────────────────────────

const TABS = [
  { id: 'paciente', label: 'Paciente', icon: User },
  { id: 'dieta', label: 'Dieta', icon: AppleLogo },
  { id: 'template', label: 'Template', icon: SquaresFour },
  { id: 'monitoreo', label: 'Monitoreo', icon: Pulse, comingSoon: true },
]

export default function NutriPlan({ profile }) {
  // Gate
  const [profProfile, setProfProfile] = useState(null)
  const [gateLoading, setGateLoading] = useState(true)

  // Paciente precargado desde la videollamada (?patientId=) — sólo prefill de
  // los campos del cálculo, esta pantalla todavía no guarda el plan contra un
  // paciente en la base (ver nota en `linkPatient` más abajo).
  const [searchParams] = useSearchParams()
  const linkedPatientId = searchParams.get('patientId')
  const [linkedPatient, setLinkedPatient] = useState(null)

  // Active tab
  const [activeTab, setActiveTab] = useState('paciente')

  // Patient form
  const [gender, setGender] = useState('female')
  const [age, setAge] = useState(30)
  const [weight, setWeight] = useState(65)
  const [height, setHeight] = useState(165)
  const [activityLevel, setPulseLevel] = useState('1.375')
  const [dietType, setDietType] = useState('normocaloric')
  const [calcConfig] = useState(DEFAULT_CALC_CONFIG)

  // Consumed foods
  const [consumedFoods, setConsumedFoods] = useState([])

  // Meals
  const [meals, setMeals] = useState(DEFAULT_MEALS)

  // Food distribution: { foodId: [mealId, ...] }
  const [foodDist, setFoodDist] = useState({})

  // MagnifyingGlass
  const [search, setSearch] = useState('')
  const [selectedCat, setSelectedCat] = useState('')

  // FatSecret
  const [fsResults, setFsResults] = useState([])
  const [fsLoading, setFsLoading] = useState(false)
  const [fsError, setFsError] = useState(false)
  const [fsSearched, setFsSearched] = useState(false)

  // Custom food modal
  const [showCustomModal, setShowCustomModal] = useState(false)

  // Tracking (mock — no backend yet)
  const [tracking] = useState([])
  const [trackingHistory] = useState([])
  const [trackingDate, setTrackingDate] = useState(() => new Date().toISOString().split('T')[0])

  // Load profProfile on mount
  useEffect(() => {
    if (!profile?.id) return
    professionalService.getByUserId(profile.id)
      .then(p => setProfProfile(p))
      .catch(() => toast.error('Error al verificar especialidad'))
      .finally(() => setGateLoading(false))
  }, [profile?.id])

  // Precarga desde el paciente de la videollamada — sólo pisa lo que el
  // perfil trae cargado, el resto se queda en el default del calculador para
  // que el nutricionista lo complete a mano.
  useEffect(() => {
    if (!linkedPatientId) return
    profilesService.getById(linkedPatientId)
      .then(p => {
        setLinkedPatient(p)
        if (p.gender === 'femenino') setGender('female')
        else if (p.gender === 'masculino') setGender('male')
        if (p.birthDate) {
          const b = new Date(p.birthDate), t = new Date()
          let a = t.getFullYear() - b.getFullYear()
          const m = t.getMonth() - b.getMonth()
          if (m < 0 || (m === 0 && t.getDate() < b.getDate())) a--
          if (a > 0) setAge(a)
        }
        if (p.weightKg) setWeight(p.weightKg)
        if (p.heightCm) setHeight(p.heightCm)
      })
      .catch(() => toast.error('No se pudo cargar el paciente de la consulta'))
  }, [linkedPatientId])

  // Computed nutrition results
  const results = useMemo(() =>
    calculateNutrition({ gender, age, weight, height, activityLevel, dietType, calcConfig }),
    [gender, age, weight, height, activityLevel, dietType, calcConfig]
  )

  // Totals
  const totals = useMemo(() => computeTotals(consumedFoods), [consumedFoods])

  // Food actions
  const addFood = useCallback((consumed) => {
    setConsumedFoods(prev => {
      const exists = prev.find(f => f.id === consumed.id)
      if (exists) {
        toast.info(`${consumed.name} ya está en el plan. Eliminalo primero para cambiar la cantidad.`)
        return prev
      }
      toast.success(`${consumed.name} agregado`)
      return [...prev, consumed]
    })
  }, [])

  const removeFood = useCallback((id) => {
    setConsumedFoods(prev => prev.filter(f => f.id !== id))
    setFoodDist(prev => {
      const copy = { ...prev }
      delete copy[id]
      return copy
    })
  }, [])

  const addCustomFood = useCallback((food) => {
    const consumed = computeConsumedFood(food, 100)
    setConsumedFoods(prev => [...prev, consumed])
  }, [])

  const toggleDist = useCallback((foodId, mealId) => {
    setFoodDist(prev => {
      const current = prev[foodId] || []
      if (current.includes(mealId)) {
        return { ...prev, [foodId]: current.filter(id => id !== mealId) }
      }
      return { ...prev, [foodId]: [...current, mealId] }
    })
  }, [])

  const handleFsSearch = async (query) => {
    if (!query.trim()) return
    setFsLoading(true)
    setFsError(false)
    setFsSearched(false)
    try {
      const res = await searchFatSecret(query)
      setFsResults(res)
      setFsSearched(true)
    } catch {
      setFsError(true)
      toast.error('No se pudo conectar a FatSecret')
    } finally {
      setFsLoading(false)
    }
  }

  // ── Gate rendering ────────────────────────────────────────────────────────

  if (gateLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="text-center space-y-3">
          <div className="w-10 h-10 rounded-full border-2 border-t-transparent animate-spin mx-auto" style={{ borderColor: SAGE, borderTopColor: 'transparent' }} />
          <p className="text-sm text-gray-400">Verificando especialidad...</p>
        </div>
      </div>
    )
  }

  if (profProfile?.specialty !== 'nutricion') {
    return (
      <div className="max-w-md mx-auto py-16 text-center space-y-4">
        <div className="w-16 h-16 rounded-full mx-auto flex items-center justify-center" style={{ backgroundColor: SAGE_BG }}>
          <ProhibitInset className="h-7 w-7" style={{ color: SAGE_DARK }} />
        </div>
        <h2 className="text-xl font-bold text-gray-800">Acceso restringido</h2>
        <p className="text-sm text-gray-500 leading-relaxed">
          NutriPlan Pro está disponible exclusivamente para profesionales con especialidad en <strong>nutrición</strong>.
        </p>
        <p className="text-xs text-gray-400">
          Tu especialidad registrada: <span className="font-medium text-gray-600">{profProfile?.specialty || 'no configurada'}</span>
        </p>
      </div>
    )
  }

  // ── Main render ───────────────────────────────────────────────────────────

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start gap-4">
        <div className="p-3 rounded-2xl shrink-0" style={{ backgroundColor: SAGE_BG }}>
          <Leaf className="h-6 w-6" style={{ color: SAGE_DARK }} />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-gray-800">NutriPlan Pro</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Planificación clínica de nutrición · {profile?.fullName}
          </p>
        </div>
        {results.targetCalories > 0 && (
          <div className="ml-auto text-right">
            <p className="text-2xl font-bold" style={{ color: SAGE }}>{results.targetCalories}</p>
            <p className="text-xs text-gray-400">kcal objetivo</p>
          </div>
        )}
      </div>

      {linkedPatient && (
        <div className="flex items-center gap-2 rounded-xl px-3 py-2 text-sm" style={{ backgroundColor: SAGE_BG, color: SAGE_DARK }}>
          <User className="h-4 w-4 shrink-0" />
          Plan para <strong>{linkedPatient.fullName}</strong> — datos precargados desde la consulta, revisalos antes de calcular.
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 bg-gray-100 p-1 rounded-xl">
        {TABS.map(tab => (
          <button
            key={tab.id}
            onClick={() => !tab.comingSoon && setActiveTab(tab.id)}
            className={`flex-1 flex items-center justify-center gap-2 py-2 rounded-lg text-sm font-medium transition-all ${tab.comingSoon ? 'opacity-40 pointer-events-none' : ''}`}
            style={activeTab === tab.id
              ? { backgroundColor: '#fff', color: SAGE_DARK, boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }
              : { backgroundColor: 'transparent', color: '#6b7280' }
            }
          >
            <tab.icon className="h-4 w-4 shrink-0" />
            <span className="hidden sm:inline">{tab.label}</span>
          </button>
        ))}
      </div>

      {/* Tab content */}
      {activeTab === 'paciente' && (
        <TabPaciente
          gender={gender} setGender={setGender}
          age={age} setAge={setAge}
          weight={weight} setWeight={setWeight}
          height={height} setHeight={setHeight}
          activityLevel={activityLevel} setPulseLevel={setPulseLevel}
          dietType={dietType} setDietType={setDietType}
          results={results}
        />
      )}

      {activeTab === 'dieta' && (
        <TabDieta
          consumedFoods={consumedFoods}
          addFood={addFood}
          removeFood={removeFood}
          totals={totals}
          results={results}
          search={search} setSearch={setSearch}
          selectedCat={selectedCat} setSelectedCat={setSelectedCat}
          fsResults={fsResults}
          fsLoading={fsLoading}
          fsError={fsError}
          fsSearched={fsSearched}
          onFsSearch={handleFsSearch}
          showCustomModal={showCustomModal}
          setShowCustomModal={setShowCustomModal}
          addCustomFood={addCustomFood}
        />
      )}

      {activeTab === 'template' && (
        <TabTemplate
          meals={meals}
          setMeals={setMeals}
          consumedFoods={consumedFoods}
          foodDist={foodDist}
          toggleDist={toggleDist}
        />
      )}

      {activeTab === 'monitoreo' && (
        <TabMonitoreo
          tracking={tracking}
          trackingHistory={trackingHistory}
          trackingDate={trackingDate}
          setTrackingDate={setTrackingDate}
          results={results}
        />
      )}
    </div>
  )
}
