import { useState, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, ChefHat, Clock, CheckCircle, Circle, CircleNotch, Sparkle, Check, ForkKnife } from '@phosphor-icons/react';
import { toast } from '../../components/Toast'
import {
  getActivePlanForPatient,
  getAdherence,
  setAdherence,
  buildPatientMealsData,
  computeConsumedFood,
  computeTotals,
  toLocalDateString,
} from '../../services/nutriplanService'

const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-05-20:generateContent?key=${import.meta.env.VITE_GEMINI_API_KEY ?? ''}`

function formatUpdatedAt(iso) {
  if (!iso) return ''
  try {
    return new Date(iso).toLocaleDateString('es-AR', { day: 'numeric', month: 'long' })
  } catch {
    return ''
  }
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

function MacroBar({ label, value, max, barClass }) {
  const pct = max > 0 ? Math.min((value / max) * 100, 100) : 0
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-xs">
        <span className="text-text-secondary">{label}</span>
        <span className={`font-medium text-text-primary`}>{Math.round(value)}<span className="text-text-secondary">/{Math.round(max)}g</span></span>
      </div>
      <div className="h-1.5 rounded-full bg-bg-surface-hover overflow-hidden">
        <div className={`h-full w-full rounded-full progress-bar-fill ${barClass}`} style={{ '--bar-value': pct / 100 }} />
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
      {error && <p className="text-xs text-danger">{error}</p>}
      {recipe && <p className="text-xs text-text-secondary whitespace-pre-wrap">{recipe}</p>}
    </div>
  )
}

function MealCard({ meal, foods, checked, onToggle }) {
  const status = getMealStatus(meal.time)
  const [showRecipe, setShowRecipe] = useState(false)

  const completedCount = foods.filter(f => checked[f.uid]).length
  const allDone = completedCount === foods.length && foods.length > 0

  const statusStyle = {
    past: { border: 'border-border-default', header: 'bg-bg-surface-hover' },
    now: { border: 'border-brand/30', header: 'bg-brand-muted' },
    upcoming: { border: 'border-border-default', header: 'bg-bg-surface' },
  }[status]

  // Cada `food` ya trae `qty` = la porción de ESTA comida (buildPatientMealsData
  // reparte consumedQuantity entre las comidas que comparten el alimento).
  // `calories`/`protein`/etc en el alimento son tasas por 100g, así que hay que
  // recalcular por porción con computeConsumedFood en vez de sumar los campos
  // consumed* del alimento entero (esos son el total across todas sus comidas).
  const portions = foods.map(f => computeConsumedFood(f, f.qty))
  const macros = computeTotals(portions)

  return (
    <div className={`rounded-2xl border overflow-hidden ${statusStyle.border}`}>
      <div className={`px-4 py-3 flex items-center justify-between ${statusStyle.header}`}>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1">
            {allDone
              ? <CheckCircle size={16} weight="fill" className="text-brand" />
              : <Circle size={16} className="text-text-secondary" />}
          </div>
          <span className="font-semibold text-sm text-text-primary">{meal.name}</span>
          {status === 'now' && (
            <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-brand-muted text-brand">
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
        {foods.map((food, i) => {
          const isChecked = !!checked[food.uid]
          const portion = portions[i]
          return (
            <label key={food.uid} className="flex items-center gap-3 cursor-pointer group">
              <div
                className={`w-5 h-5 rounded flex items-center justify-center border transition-colors ${
                  isChecked ? 'bg-brand border-brand' : 'bg-transparent border-border-hover'
                }`}
                onClick={() => onToggle(meal, food)}
              >
                {isChecked && <Check size={12} className="text-white" />}
              </div>
              <div className="flex-1 min-w-0">
                <span className={`text-sm ${isChecked ? 'line-through text-text-secondary' : 'text-text-primary'}`}>
                  {food.name}
                </span>
              </div>
              <span className="text-xs text-text-secondary shrink-0">{food.qty}g · {Math.round(portion.consumedCalories)} kcal</span>
            </label>
          )
        })}

        <div className="pt-2 grid grid-cols-3 gap-2 text-center">
          {[
            { label: 'Proteínas', value: macros.protein, bg: 'bg-brand/15', text: 'text-brand' },
            { label: 'Hidratos', value: macros.carbs, bg: 'bg-warning/15', text: 'text-warning' },
            { label: 'Grasas', value: macros.fat, bg: 'bg-macro-fat/15', text: 'text-macro-fat' },
          ].map(({ label, value, bg, text }) => (
            <div key={label} className={`rounded-lg py-1.5 px-2 ${bg}`}>
              <p className={`text-xs font-bold ${text}`}>{Math.round(value)}g</p>
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

function NutriPlanHeader({ navigate, subtitle }) {
  return (
    <div className="flex items-center gap-3 px-4 patient-column pt-6 pb-4 border-b border-border-default bg-bg-surface">
      <button onClick={() => navigate(-1)} className="p-2 -ml-2 rounded-lg hover:bg-bg-muted">
        <ArrowLeft size={20} className="text-text-secondary" />
      </button>
      <div>
        <h1 className="font-bold text-text-primary">NutriPlan</h1>
        <p className="text-xs text-text-secondary">{subtitle}</p>
      </div>
    </div>
  )
}

export default function PatientNutriPlan({ profile }) {
  const navigate = useNavigate()
  const [plan, setPlan] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [checked, setChecked] = useState({})
  const today = toLocalDateString()

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    getActivePlanForPatient(profile.id)
      .then(p => { if (!cancelled) setPlan(p) })
      .catch(err => { if (!cancelled) setError(err) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [profile.id])

  useEffect(() => {
    if (!plan) return
    let cancelled = false
    getAdherence(plan.id, today)
      .then(rows => {
        if (cancelled) return
        const map = {}
        rows.forEach(r => { map[r.foodUid] = r.consumed })
        setChecked(map)
      })
      .catch(err => toast.error(err.message))
    return () => { cancelled = true }
  }, [plan?.id, today])

  const mealsData = useMemo(() => {
    if (!plan) return {}
    return buildPatientMealsData(plan.meals, plan.foods, plan.foodDistribution)
  }, [plan])

  const totalConsumed = useMemo(() => {
    if (!plan) return { calories: 0, protein: 0, carbs: 0, fat: 0, fiber: 0 }
    const consumedPortions = []
    plan.meals.forEach(meal => {
      const foods = mealsData[meal.id] || []
      foods.forEach(food => {
        if (checked[food.uid]) {
          // Mismo prorrateo que en MealCard: `food.qty` es la porción de esta
          // comida, así que recalculamos sus macros con computeConsumedFood en
          // vez de sumar los consumed* del alimento entero (que representan el
          // total repartido entre todas sus comidas, no sólo esta porción
          // tildada). Así un alimento en N comidas aporta 1/N por cada una que
          // el paciente marcó como consumida hoy.
          consumedPortions.push(computeConsumedFood(food, food.qty))
        }
      })
    })
    return computeTotals(consumedPortions)
  }, [plan, mealsData, checked])

  async function handleToggle(meal, food) {
    const uid = food.uid
    const newValue = !checked[uid]
    setChecked(c => ({ ...c, [uid]: newValue }))
    // Se manda la foto de la porción junto con la marca: el nutricionista
    // puede cambiar el plan mañana, y el historial de lo que el paciente comió
    // hoy no tiene que depender de eso.
    const porcion = computeConsumedFood(food, food.qty)
    try {
      await setAdherence(plan.id, profile.id, today, meal.id, uid, newValue, {
        foodName: food.name,
        mealName: meal.name,
        qtyG: food.qty,
        calories: porcion.consumedCalories,
        protein: porcion.consumedProtein,
        carbs: porcion.consumedCarbs,
        fat: porcion.consumedFat,
        fiber: porcion.consumedFiber,
      })
    } catch (err) {
      setChecked(c => ({ ...c, [uid]: !newValue }))
      toast.error(err.message)
    }
  }

  if (loading) {
    return (
      <div className="absolute inset-0 flex flex-col bg-bg-primary">
        <NutriPlanHeader navigate={navigate} subtitle="Tu plan nutricional de hoy" />
        <div className="flex-1 flex items-center justify-center">
          <CircleNotch size={28} className="animate-spin text-text-secondary" />
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="absolute inset-0 flex flex-col bg-bg-primary">
        <NutriPlanHeader navigate={navigate} subtitle="Tu plan nutricional de hoy" />
        <div className="flex-1 flex items-center justify-center px-8 text-center">
          <p className="text-sm text-danger">{error.message}</p>
        </div>
      </div>
    )
  }

  if (!plan) {
    return (
      <div className="absolute inset-0 flex flex-col bg-bg-primary">
        <NutriPlanHeader navigate={navigate} subtitle="Tu plan nutricional de hoy" />
        <div className="flex-1 flex flex-col items-center justify-center px-8 text-center gap-3">
          <div className="w-14 h-14 rounded-full bg-brand-muted flex items-center justify-center">
            <ForkKnife size={24} className="text-brand" />
          </div>
          <p className="font-semibold text-text-primary">Todavía no tenés un plan nutricional</p>
          <p className="text-sm text-text-secondary">Tu nutricionista te lo arma durante la consulta.</p>
        </div>
      </div>
    )
  }

  const subtitle = plan.professional?.fullName
    ? `Armado por ${plan.professional.fullName} · ${formatUpdatedAt(plan.updatedAt)}`
    : `Actualizado el ${formatUpdatedAt(plan.updatedAt)}`

  return (
    <div className="absolute inset-0 flex flex-col bg-bg-primary">
      <NutriPlanHeader navigate={navigate} subtitle={subtitle} />

      <div className="flex-1 overflow-y-auto pb-32 patient-column">
        {/* Daily summary card */}
        <div className="m-4 p-4 rounded-2xl bg-bg-surface border border-border-default space-y-3">
          <div className="flex justify-between items-center">
            <span className="text-sm font-semibold text-text-primary">Calorías del día</span>
            <span className="text-xs text-text-secondary">{Math.round(totalConsumed.calories)} / {plan.targetCalories} kcal</span>
          </div>
          <div className="h-2.5 rounded-full bg-bg-surface-hover overflow-hidden">
            <div
              className="h-full w-full rounded-full progress-bar-fill bg-brand"
              style={{ '--bar-value': plan.targetCalories > 0 ? Math.min(totalConsumed.calories / plan.targetCalories, 1) : 0 }}
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <MacroBar label="Proteínas" value={totalConsumed.protein} max={plan.targetProteinG} barClass="bg-brand" />
            <MacroBar label="Hidratos" value={totalConsumed.carbs} max={plan.targetCarbsG} barClass="bg-warning" />
            <MacroBar label="Grasas" value={totalConsumed.fat} max={plan.targetFatG} barClass="bg-macro-fat" />
            <MacroBar label="Fibra" value={totalConsumed.fiber} max={plan.targetFiberG} barClass="bg-macro-fiber" />
          </div>
        </div>

        {/* Meals */}
        <div className="px-4 space-y-3">
          {plan.meals.map(meal => (
            <MealCard
              key={meal.id}
              meal={meal}
              foods={mealsData[meal.id] || []}
              checked={checked}
              onToggle={handleToggle}
            />
          ))}
        </div>
      </div>
    </div>
  )
}
