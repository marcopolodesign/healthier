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

export function buildPatientMealsData(meals, foods, dist) {
  const d = {}
  meals.forEach(m => { d[m.id] = [] })
  foods.forEach(food => {
    const assigned = dist[food.id] || []
    if (assigned.length > 0) {
      const portionQty = Math.round(food.consumedQuantity / assigned.length)
      assigned.forEach(mId => {
        if (d[mId]) d[mId].push({ ...food, qty: portionQty, uid: `${food.id}-${mId}` })
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
