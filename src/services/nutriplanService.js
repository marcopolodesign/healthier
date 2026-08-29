import { supabase } from '../lib/supabase'

// Default config
export const DEFAULT_CALC_CONFIG = {
  deficitKcal: 500, surplusKcal: 500,
  proHypo: 2.2, fatHypo: 0.8,
  proNormo: 2.0, fatNormo: 1.0,
  proHyper: 1.8, fatHyper: 1.0,
  fiberPer1000: 14,
}

export const DEFAULT_MEALS = [
  { id: 'm1', name: 'Desayuno', time: '08:00' },
  { id: 'm2', name: 'Almuerzo', time: '12:00' },
  { id: 'm3', name: 'Merienda', time: '16:00' },
  { id: 'm4', name: 'Cena', time: '20:00' },
]

export const ACTIVITY_MULTIPLIERS = [
  { value: '1.2', label: 'Sedentario', desc: 'Poco/nada' },
  { value: '1.375', label: 'Ligero', desc: '1-3 días' },
  { value: '1.55', label: 'Moderado', desc: '3-5 días' },
  { value: '1.725', label: 'Activo', desc: '6-7 días' },
  { value: '1.9', label: 'Muy Activo', desc: 'Doble turno' },
]

export const DIET_OPTIONS = [
  { value: 'hypocaloric', label: 'Déficit', desc: 'Pérdida de peso' },
  { value: 'normocaloric', label: 'Balance', desc: 'Mantenimiento' },
  { value: 'hypercaloric', label: 'Volumen', desc: 'Ganancia muscular' },
]

export function calculateNutrition({ gender, age, weight, height, activityLevel, dietType, calcConfig }) {
  const w = parseFloat(weight) || 0
  const h = parseFloat(height) || 0
  const a = parseFloat(age) || 0
  const hm = h / 100
  const bmi = hm > 0 ? w / (hm * hm) : 0
  const bmiCategory = bmi < 18.5 ? 'Bajo peso' : bmi < 25 ? 'Normal' : bmi < 30 ? 'Sobrepeso' : 'Obesidad'
  const bmr = (10 * w) + (6.25 * h) - (5 * a) + (gender === 'male' ? 5 : -161)
  const tdee = bmr * parseFloat(activityLevel)
  let target = tdee
  if (dietType === 'hypocaloric') target -= calcConfig.deficitKcal
  if (dietType === 'hypercaloric') target += calcConfig.surplusKcal
  let pG = 0, fG = 0
  if (dietType === 'hypocaloric') { pG = w * calcConfig.proHypo; fG = w * calcConfig.fatHypo }
  else if (dietType === 'normocaloric') { pG = w * calcConfig.proNormo; fG = w * calcConfig.fatNormo }
  else { pG = w * calcConfig.proHyper; fG = w * calcConfig.fatHyper }
  const cG = Math.max(0, (target - pG * 4 - fG * 9) / 4)
  const fibG = (target / 1000) * calcConfig.fiberPer1000
  return {
    bmi: isNaN(bmi) || !isFinite(bmi) ? 0 : parseFloat(bmi.toFixed(1)),
    bmiCategory,
    bmr: Math.round(bmr || 0),
    tdee: Math.round(tdee || 0),
    targetCalories: Math.round(target || 0),
    macros: { protein: Math.round(pG || 0), fat: Math.round(fG || 0), carbs: Math.round(cG || 0), fiber: Math.round(fibG || 0) },
  }
}

export function computeConsumedFood(food, qty) {
  const f = qty / 100
  return { ...food, consumedQuantity: qty,
    consumedCalories: Math.round(food.calories * f),
    consumedProtein: Math.round(food.protein * f * 10) / 10,
    consumedCarbs: Math.round(food.carbs * f * 10) / 10,
    consumedFat: Math.round(food.fat * f * 10) / 10,
    consumedFiber: Math.round(food.fiber * f * 10) / 10,
  }
}

export function computeTotals(foods) {
  return foods.reduce((a, c) => ({
    calories: a.calories + c.consumedCalories,
    protein: a.protein + c.consumedProtein,
    carbs: a.carbs + c.consumedCarbs,
    fat: a.fat + c.consumedFat,
    fiber: a.fiber + c.consumedFiber,
  }), { calories: 0, protein: 0, carbs: 0, fat: 0, fiber: 0 })
}

// El identificador de una porción dentro del plan. Vive en un solo lado a
// propósito: es la clave con la que se guarda la adherencia, y si el formato
// cambia en un lugar y no en el otro el matching se rompe sin tirar un error —
// simplemente la pestaña Monitoreo aparece vacía.
export function buildFoodUid(foodId, mealId) {
  return `${foodId}-${mealId}`
}

export function buildPatientMealsData(meals, foods, dist) {
  const d = {}
  meals.forEach(m => { d[m.id] = [] })
  foods.forEach(food => {
    const assigned = dist[food.id] || []
    if (assigned.length > 0) {
      const portionQty = Math.round(food.consumedQuantity / assigned.length)
      assigned.forEach(mId => {
        if (d[mId]) d[mId].push({ ...food, qty: portionQty, uid: buildFoodUid(food.id, mId) })
      })
    }
  })
  return d
}

// FatSecret food search via CORS proxy
const FS_CLIENT_ID = '19f1e6a8c3524f6abb85e6bc77786b49'
const FS_CLIENT_SECRET = 'dc24e43c85c840e789ba8bcd4239ebd7'
const FS_TOKEN_URL = 'https://oauth.fatsecret.com/connect/token'
const FS_API_URL = 'https://platform.fatsecret.com/rest/server.api'
const FS_PROXY = 'https://corsproxy.io/?'

let _fsToken = null
let _fsTokenExpiry = 0

async function getFsToken() {
  if (_fsToken && Date.now() < _fsTokenExpiry) return _fsToken
  const credentials = btoa(`${FS_CLIENT_ID}:${FS_CLIENT_SECRET}`)
  const res = await fetch(FS_PROXY + encodeURIComponent(FS_TOKEN_URL), {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Authorization': `Basic ${credentials}` },
    body: 'grant_type=client_credentials&scope=basic',
  })
  if (!res.ok) throw new Error(`FatSecret token error ${res.status}`)
  const data = await res.json()
  _fsToken = data.access_token
  _fsTokenExpiry = Date.now() + (data.expires_in * 1000) - 60000
  return _fsToken
}

export async function searchFatSecret(query) {
  const token = await getFsToken()
  const params = new URLSearchParams({ method: 'foods.search', search_expression: query, format: 'json', page_number: '0', max_results: '20', language: 'es', region: 'AR' })
  const res = await fetch(FS_PROXY + encodeURIComponent(`${FS_API_URL}?${params}`), { headers: { 'Authorization': `Bearer ${token}` } })
  if (!res.ok) throw new Error(`FatSecret search error ${res.status}`)
  const data = await res.json()
  if (!data.foods?.food) return []
  const foods = Array.isArray(data.foods.food) ? data.foods.food : [data.foods.food]
  return foods.map(f => {
    const desc = f.food_description || ''
    const extract = (regex) => { const m = desc.match(regex); return m ? parseFloat(m[1]) : 0 }
    return {
      id: `fs_${f.food_id}`,
      name: f.food_name || 'Sin nombre',
      brand: f.brand_name || null,
      category: f.food_type === 'Brand' ? 'Marca' : 'Genérico',
      calories: Math.round(extract(/Calories:\s*([\d.]+)/i) || extract(/Calorías:\s*([\d.]+)/i)),
      protein: Math.round((extract(/Protein:\s*([\d.]+)/i) || extract(/Prot(?:eínas?)?:\s*([\d.]+)/i)) * 10) / 10,
      carbs: Math.round((extract(/Carbs:\s*([\d.]+)/i) || extract(/Carboh?:\s*([\d.]+)/i) || extract(/Hidratos:\s*([\d.]+)/i)) * 10) / 10,
      fat: Math.round((extract(/Fat:\s*([\d.]+)/i) || extract(/Grasas?:\s*([\d.]+)/i)) * 10) / 10,
      fiber: 0,
      isExternal: true,
    }
  })
}

// ── Persistencia (migración 131_nutriplan_persistencia.sql) ────────────────
//
// Mapeo de columnas a mano en vez de toCamelCase/toSnakeCase: esos helpers
// son recursivos y bajarían por dentro de meals/foods/food_distribution
// destruyendo las claves de food_distribution (que son ids de alimento, no
// snake_case) y las de cada food/meal armado por la UI.

function mapPlan(row) {
  if (!row) return null
  return {
    id: row.id,
    patientId: row.patient_id,
    professionalId: row.professional_id,
    status: row.status,
    gender: row.gender,
    age: row.age,
    weightKg: row.weight_kg,
    heightCm: row.height_cm,
    activityLevel: row.activity_level,
    dietType: row.diet_type,
    targetCalories: row.target_calories,
    targetProteinG: row.target_protein_g,
    targetCarbsG: row.target_carbs_g,
    targetFatG: row.target_fat_g,
    targetFiberG: row.target_fiber_g,
    bmr: row.bmr,
    tdee: row.tdee,
    bmi: row.bmi,
    meals: row.meals,
    foods: row.foods,
    foodDistribution: row.food_distribution,
    notes: row.notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    professional: row.professional
      ? {
          id: row.professional.id,
          fullName: row.professional.full_name,
          avatarUrl: row.professional.avatar_url,
        }
      : null,
  }
}

// Crea o actualiza el plan activo del par (paciente, profesional).
//
// No se usa upsert con onConflict: el índice único que hay que respetar es
// PARCIAL (`WHERE status = 'active'`), y Postgres sólo lo toma como target de
// ON CONFLICT si la cláusula incluye el mismo WHERE — algo que el upsert de
// supabase-js no permite expresar. Por eso: select del activo existente →
// UPDATE si hay, INSERT si no.
export async function savePlan({
  patientId, professionalId, gender, age, weightKg, heightCm,
  activityLevel, dietType, results, meals, foods, foodDistribution, notes,
}) {
  const row = {
    patient_id: patientId,
    professional_id: professionalId,
    gender,
    age,
    weight_kg: weightKg,
    height_cm: heightCm,
    activity_level: activityLevel,
    diet_type: dietType,
    target_calories: results.targetCalories,
    target_protein_g: results.macros.protein,
    target_carbs_g: results.macros.carbs,
    target_fat_g: results.macros.fat,
    target_fiber_g: results.macros.fiber,
    bmr: results.bmr,
    tdee: results.tdee,
    bmi: results.bmi,
    meals,
    foods,
    food_distribution: foodDistribution,
    notes,
  }

  const { data: existing, error: findError } = await supabase
    .from('nutrition_plans')
    .select('id')
    .eq('patient_id', patientId)
    .eq('professional_id', professionalId)
    .eq('status', 'active')
    .maybeSingle()
  if (findError) throw findError

  const query = existing
    ? supabase.from('nutrition_plans').update(row).eq('id', existing.id)
    : supabase.from('nutrition_plans').insert({ ...row, status: 'active' })

  const { data, error } = await query
    .select('*, professional:profiles!professional_id(id, full_name, avatar_url)')
    .single()
  if (error) throw error
  return mapPlan(data)
}

// Plan activo más reciente del paciente, con el profesional que lo armó.
export async function getActivePlanForPatient(patientId) {
  const { data, error } = await supabase
    .from('nutrition_plans')
    .select('*, professional:profiles!professional_id(id, full_name, avatar_url)')
    .eq('patient_id', patientId)
    .eq('status', 'active')
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) throw error
  return mapPlan(data)
}

// Plan activo del par, para que el profesional lo recupere y lo siga editando.
export async function getPlanForPatient(patientId, professionalId) {
  const { data, error } = await supabase
    .from('nutrition_plans')
    .select('*, professional:profiles!professional_id(id, full_name, avatar_url)')
    .eq('patient_id', patientId)
    .eq('professional_id', professionalId)
    .eq('status', 'active')
    .maybeSingle()
  if (error) throw error
  return mapPlan(data)
}

// Marcas de adherencia de un día puntual.
const CAMPOS_ADHERENCIA =
  'date, meal_id, food_uid, consumed, food_name, meal_name, qty_g, calories, protein_g, carbs_g, fat_g, fiber_g'

function mapMarca(r) {
  return {
    date: r.date,
    mealId: r.meal_id,
    foodUid: r.food_uid,
    consumed: r.consumed,
    foodName: r.food_name,
    mealName: r.meal_name,
    qtyG: r.qty_g,
    calories: Number(r.calories) || 0,
    protein: Number(r.protein_g) || 0,
    carbs: Number(r.carbs_g) || 0,
    fat: Number(r.fat_g) || 0,
    fiber: Number(r.fiber_g) || 0,
  }
}

export async function getAdherence(planId, date) {
  const { data, error } = await supabase
    .from('nutrition_plan_adherence')
    .select(CAMPOS_ADHERENCIA)
    .eq('plan_id', planId)
    .eq('date', date)
  if (error) throw error
  return (data || []).map(mapMarca)
}

// Marca/desmarca un alimento consumido. Upsert sobre la unique (plan_id,
// date, meal_id, food_uid) declarada en la migración.
// `porcion` es la foto de lo que se marcó: nombre, cantidad y macros de esa
// porción en ese momento. Se guarda junto con la marca en vez de reconstruirse
// después contra el plan, que es mutable — ver la nota de la migración 131.
export async function setAdherence(planId, patientId, date, mealId, foodUid, consumed, porcion = {}) {
  const { data, error } = await supabase
    .from('nutrition_plan_adherence')
    .upsert({
      plan_id: planId,
      patient_id: patientId,
      date,
      meal_id: mealId,
      food_uid: foodUid,
      consumed,
      food_name: porcion.foodName ?? null,
      meal_name: porcion.mealName ?? null,
      qty_g: porcion.qtyG ?? null,
      calories: porcion.calories ?? null,
      protein_g: porcion.protein ?? null,
      carbs_g: porcion.carbs ?? null,
      fat_g: porcion.fat ?? null,
      fiber_g: porcion.fiber ?? null,
    }, { onConflict: 'plan_id,date,meal_id,food_uid' })
    .select(CAMPOS_ADHERENCIA)
    .single()
  if (error) throw error
  return mapMarca(data)
}

// Marcas en un rango de fechas, para la pestaña Monitoreo del profesional.
export async function getAdherenceRange(planId, fromDate, toDate) {
  const { data, error } = await supabase
    .from('nutrition_plan_adherence')
    .select(CAMPOS_ADHERENCIA)
    .eq('plan_id', planId)
    .gte('date', fromDate)
    .lte('date', toDate)
    .order('date', { ascending: true })
  if (error) throw error
  return (data || []).map(mapMarca)
}

// ── Fechas locales ────────────────────────────────────────────────────────
//
// La adherencia se guarda como `date` (un día calendario, sin hora), y el día
// que vale es el del paciente, no el de UTC. En Buenos Aires (GMT-3) las dos
// conversiones automáticas de JS corren la fecha un día:
//   · `toISOString()` pasa a UTC → después de las 21:00 devuelve el día
//     siguiente.
//   · `new Date('2026-08-28')` parsea el string como medianoche UTC → en local
//     es el 27 a las 21:00, y cualquier formateo lo muestra un día antes.
// Por eso las dos direcciones se arman a mano con los getters locales.

// Date → 'YYYY-MM-DD' en hora local.
export function toLocalDateString(date = new Date()) {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

// 'YYYY-MM-DD' → Date a la medianoche LOCAL de ese día.
export function parseLocalDate(value) {
  const [y, m, d] = String(value).slice(0, 10).split('-').map(Number)
  return new Date(y, m - 1, d)
}
