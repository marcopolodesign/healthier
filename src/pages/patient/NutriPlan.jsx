import { useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, ChefHat, Clock, CheckCircle, Circle, CircleNotch, Sparkle, Check } from '@phosphor-icons/react';

const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-05-20:generateContent?key=${import.meta.env.VITE_GEMINI_API_KEY ?? ''}`

const SAGE = '#7CB38B'
const SAGE_BG = 'rgba(124,179,139,0.12)'
const WARNING_COLOR = '#E4A853'

const MOCK_MEALS = [
  { id: 'm1', name: 'Desayuno', time: '08:00' },
  { id: 'm2', name: 'Almuerzo', time: '12:00' },
  { id: 'm3', name: 'Merienda', time: '16:00' },
  { id: 'm4', name: 'Cena', time: '20:00' },
]

const MOCK_FOODS = [
  { id: 'f1', name: 'Pechuga de pollo sin piel', calories: 120, protein: 23, carbs: 0, fat: 2.5, fiber: 0 },
  { id: 'f2', name: 'Avena en hojuelas', calories: 389, protein: 17, carbs: 66, fat: 7, fiber: 10.6 },
  { id: 'f3', name: 'Yogur griego', calories: 59, protein: 10, carbs: 3.6, fat: 0.4, fiber: 0 },
  { id: 'f4', name: 'Arroz integral cocido', calories: 111, protein: 2.6, carbs: 23, fat: 0.9, fiber: 1.8 },
  { id: 'f5', name: 'Brócoli cocido', calories: 35, protein: 2.4, carbs: 7.2, fat: 0.4, fiber: 2.6 },
  { id: 'f6', name: 'Banana', calories: 89, protein: 1.1, carbs: 23, fat: 0.3, fiber: 2.6 },
]

const MOCK_PLAN = {
  targetCalories: 2000,
  macros: { protein: 150, carbs: 220, fat: 67, fiber: 30 },
}

const MEAL_DIST = {
  m1: ['f2', 'f3'],
  m2: ['f1', 'f4', 'f5'],
  m3: ['f6'],
  m4: ['f1', 'f5'],
}

function getMealStatus(time) {
  const now = new Date()
  const [h, m] = time.split(':').map(Number)
  const mealDate = new Date()
  mealDate.setHours(h, m, 0, 0)
  const diff = (mealDate - now) / (1000 * 60)
  if (diff < -60) return 'past'
  if (diff >= -60 && diff <= 60) return 'now'
  return 'upcoming'
}

function MacroBar({ label, value, max, color }) {
  const pct = Math.min((value / max) * 100, 100)
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-xs">
        <span className="text-text-secondary">{label}</span>
        <span className="font-medium text-text-primary">{Math.round(value)}<span className="text-text-secondary">/{max}g</span></span>
      </div>
      <div className="h-1.5 rounded-full bg-gray-100 overflow-hidden">
        <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: color }} />
      </div>
    </div>
  )
}

function RecipeCard({ mealName, foods }) {
  const [loading, setLoading] = useState(false)
  const [recipe, setRecipe] = useState(null)
  const [error, setError] = useState('')

  async function fetchRecipe() {
    const apiKey = import.meta.env.VITE_GEMINI_API_KEY
    if (!apiKey) { setError('Configurá VITE_GEMINI_API_KEY para usar recetas.'); return }
    setLoading(true)
    setError('')
    try {
      const foodList = foods.map(f => f.name).join(', ')
      const res = await fetch(GEMINI_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{
            parts: [{
              text: `Inventá una receta saludable para ${mealName} usando estos ingredientes: ${foodList}. Respondé en español argentino. Formato: nombre del plato, tiempo de preparación, y pasos numerados. Máximo 200 palabras.`,
            }],
          }],
          generationConfig: { maxOutputTokens: 350 },
        }),
      })
      const json = await res.json()
      const text = json?.candidates?.[0]?.content?.parts?.[0]?.text ?? ''
      if (!text) throw new Error()
      setRecipe(text)
    } catch {
      setError('Error al generar la receta.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="mt-3 p-3 rounded-xl border border-dashed border-border-default space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-xs text-text-secondary">
          <ChefHat size={13} />
          <span>Receta sugerida</span>
        </div>
        <button
          onClick={fetchRecipe}
          disabled={loading}
          className="flex items-center gap-1 text-xs px-2 py-1 rounded-full border border-brand text-brand hover:bg-brand hover:text-white transition-colors"
        >
          {loading ? <CircleNotch size={11} className="animate-spin" /> : <Sparkle size={11} />}
          {loading ? 'Generando...' : 'Ver receta'}
        </button>
      </div>
      {error && <p className="text-xs text-red-500">{error}</p>}
      {recipe && <p className="text-xs text-text-secondary whitespace-pre-wrap">{recipe}</p>}
    </div>
  )
}

function MealCard({ meal, foods }) {
  const [checked, setChecked] = useState({})
  const status = getMealStatus(meal.time)
  const [showRecipe, setShowRecipe] = useState(false)

  const completedCount = Object.values(checked).filter(Boolean).length
  const allDone = completedCount === foods.length && foods.length > 0

  const statusStyle = {
    past: { border: 'border-gray-200', header: 'bg-gray-50' },
    now: { border: 'border-brand/30', header: 'bg-brand/5' },
    upcoming: { border: 'border-border-default', header: 'bg-bg-surface' },
  }[status]

  const macros = foods.reduce((acc, f) => ({
    calories: acc.calories + f.calories,
    protein: acc.protein + f.protein,
    carbs: acc.carbs + f.carbs,
    fat: acc.fat + f.fat,
  }), { calories: 0, protein: 0, carbs: 0, fat: 0 })

  return (
    <div className={`rounded-2xl border overflow-hidden ${statusStyle.border}`}>
      <div className={`px-4 py-3 flex items-center justify-between ${statusStyle.header}`}>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1">
            {allDone
              ? <CheckCircle size={16} style={{ color: SAGE }} />
              : <Circle size={16} className="text-text-secondary" />}
          </div>
          <span className="font-semibold text-sm text-text-primary">{meal.name}</span>
          {status === 'now' && (
            <span className="text-xs px-2 py-0.5 rounded-full font-medium"
              style={{ background: SAGE_BG, color: SAGE }}>
              Ahora
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Clock size={12} className="text-text-secondary" />
          <span className="text-xs text-text-secondary">{meal.time}</span>
          <span className="text-xs font-bold text-text-primary">{Math.round(macros.calories)} kcal</span>
        </div>
      </div>

      <div className="p-4 space-y-2">
        {foods.map(food => (
          <label key={food.id} className="flex items-center gap-3 cursor-pointer group">
            <div
              className="w-5 h-5 rounded flex items-center justify-center border transition-colors"
              style={{
                background: checked[food.id] ? SAGE : 'transparent',
                borderColor: checked[food.id] ? SAGE : '#d1d5db',
              }}
              onClick={() => setChecked(c => ({ ...c, [food.id]: !c[food.id] }))}
            >
              {checked[food.id] && <Check size={12} color="white" />}
            </div>
            <div className="flex-1 min-w-0">
              <span className={`text-sm ${checked[food.id] ? 'line-through text-text-secondary' : 'text-text-primary'}`}>
                {food.name}
              </span>
            </div>
            <span className="text-xs text-text-secondary shrink-0">{food.calories} kcal</span>
          </label>
        ))}

        <div className="pt-2 grid grid-cols-3 gap-2 text-center">
          {[
            { label: 'Proteínas', value: macros.protein, color: SAGE },
            { label: 'Hidratos', value: macros.carbs, color: WARNING_COLOR },
            { label: 'Grasas', value: macros.fat, color: '#4A90D9' },
          ].map(({ label, value, color }) => (
            <div key={label} className="rounded-lg py-1.5 px-2" style={{ background: `${color}15` }}>
              <p className="text-xs font-bold" style={{ color }}>{Math.round(value)}g</p>
              <p className="text-xs text-text-secondary">{label}</p>
            </div>
          ))}
        </div>

        <button
          onClick={() => setShowRecipe(s => !s)}
          className="w-full text-xs text-text-secondary hover:text-brand flex items-center justify-center gap-1 py-1"
        >
          <ChefHat size={12} />
          {showRecipe ? 'Ocultar receta' : 'Ver receta sugerida'}
        </button>
        {showRecipe && <RecipeCard mealName={meal.name} foods={foods} />}
      </div>
    </div>
  )
}

export default function PatientNutriPlan() {
  const navigate = useNavigate()
  const plan = MOCK_PLAN

  const totalConsumed = { calories: 0, protein: 50, carbs: 80, fat: 20 }

  return (
    <div className="absolute inset-0 flex flex-col bg-bg-primary">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 patient-column pt-6 pb-4 border-b border-border-default bg-bg-surface">
        <button onClick={() => navigate(-1)} className="p-2 -ml-2 rounded-lg hover:bg-bg-muted">
          <ArrowLeft size={20} className="text-text-secondary" />
        </button>
        <div>
          <h1 className="font-bold text-text-primary">NutriPlan</h1>
          <p className="text-xs text-text-secondary">Tu plan nutricional de hoy</p>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto pb-32 patient-column">
        {/* Daily summary card */}
        <div className="m-4 p-4 rounded-2xl bg-bg-surface border border-border-default space-y-3">
          <div className="flex justify-between items-center">
            <span className="text-sm font-semibold text-text-primary">Calorías del día</span>
            <span className="text-xs text-text-secondary">{totalConsumed.calories} / {plan.targetCalories} kcal</span>
          </div>
          <div className="h-2.5 rounded-full bg-gray-100 overflow-hidden">
            <div
              className="h-full rounded-full transition-all"
              style={{
                width: `${Math.min((totalConsumed.calories / plan.targetCalories) * 100, 100)}%`,
                background: SAGE,
              }}
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <MacroBar label="Proteínas" value={totalConsumed.protein} max={plan.macros.protein} color={SAGE} />
            <MacroBar label="Hidratos" value={totalConsumed.carbs} max={plan.macros.carbs} color={WARNING_COLOR} />
            <MacroBar label="Grasas" value={totalConsumed.fat} max={plan.macros.fat} color="#4A90D9" />
            <MacroBar label="Fibra" value={0} max={plan.macros.fiber} color="#9B59B6" />
          </div>
        </div>

        {/* Meals */}
        <div className="px-4 space-y-3">
          {MOCK_MEALS.map(meal => {
            const foodIds = MEAL_DIST[meal.id] ?? []
            const foods = MOCK_FOODS.filter(f => foodIds.includes(f.id))
            return <MealCard key={meal.id} meal={meal} foods={foods} />
          })}
        </div>
      </div>
    </div>
  )
}
