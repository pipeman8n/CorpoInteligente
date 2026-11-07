export type Gender = 'male' | 'female' | ''
export type ActivityLevel = 'sedentary' | 'light' | 'moderate' | 'active' | ''
export type Goal = 'emagrecimento' | 'hipertrofia' | 'saude' | ''

export interface ClientData {
  name: string
  age: number
  gender: Gender
  weight: number
  height: number
  bodyFat?: number
  bodyFatEstimationMethod?: string
  activityLevel: ActivityLevel
  goal: Goal
  restrictions?: string
}

export interface RaioXResult {
  imc: number
  imcClass: string
  leanMass: number
  bodyFatPct: number | null
  tmb: number
  gct: number
  calorieTarget: number
  deficit: number | null
  protein: number
  carbs: number
  fat: number
  water: number
}

const PAL: Record<ActivityLevel, number> = {
  sedentary: 1.2,
  light: 1.375,
  moderate: 1.55,
  active: 1.725,
  '': 1.2,
}

const ACTIVITY_LABEL: Record<ActivityLevel, string> = {
  sedentary: 'Sedentário',
  light: 'Leve (1-3x/semana)',
  moderate: 'Moderado (3-5x/semana)',
  active: 'Ativo (6-7x/semana)',
  '': '',
}

export function activityLabel(a: ActivityLevel): string {
  return ACTIVITY_LABEL[a]
}

// TMB — Harris-Benedict (fórmula usada pelo prompt do "Nutrólogo Esportivo")
export function calcTMB(d: ClientData): number {
  if (d.gender === 'male') return 66 + 13.7 * d.weight + 5 * d.height - 6.8 * d.age
  return 655 + 9.6 * d.weight + 1.8 * d.height - 4.7 * d.age
}

export function imcClass(imc: number): string {
  if (imc < 18.5) return 'Abaixo do peso'
  if (imc < 25) return 'Eutrofia (normal)'
  if (imc < 30) return 'Sobrepeso'
  if (imc < 35) return 'Obesidade grau I'
  if (imc < 40) return 'Obesidade grau II'
  return 'Obesidade grau III'
}

// Estimativa de % gordura pelo IMC (fórmula de Deurenberg)
export function estimateBodyFatByImc(bmi: number, age: number, gender: Gender): number {
  const sex = gender === 'male' ? 1 : 0
  return Math.max(3, 1.2 * bmi + 0.23 * age - 10.8 * sex - 5.4)
}

// Estimativa de % gordura por dobras cutâneas (Pollock 3 dobras + Siri)
export function estimateBodyFatBySkinfold(sum: number, age: number, gender: Gender): number {
  const d = gender === 'male'
    ? 1.10938 - 0.0008267 * sum + 0.0000016 * sum * sum - 0.0002574 * age
    : 1.0994921 - 0.0009929 * sum + 0.0000023 * sum * sum - 0.0001392 * age
  return Math.max(3, (4.95 / d - 4.5) * 100)
}

export function calculate(d: ClientData): RaioXResult {
  const imc = d.weight / Math.pow(d.height / 100, 2)
  const leanMass = d.bodyFat != null && d.bodyFat > 0
    ? d.weight - (d.weight * d.bodyFat) / 100
    : d.weight
  const tmb = calcTMB(d)
  const gct = tmb * PAL[d.activityLevel]

  let calorieTarget = gct
  let deficit: number | null = null
  if (d.goal === 'hipertrofia') {
    calorieTarget = gct + 250
  } else if (d.goal === 'emagrecimento') {
    calorieTarget = Math.max(gct - 400, tmb) // déficit nunca abaixo da TMB
    deficit = gct - calorieTarget
  }

  const proteinPerKg = d.goal === 'hipertrofia' ? 2.2 : d.goal === 'emagrecimento' ? 2.0 : 1.8
  const protein = Math.round(proteinPerKg * d.weight)
  const fat = Math.round((calorieTarget * 0.25) / 9) // 25% das calorias
  const carbs = Math.max(0, Math.round((calorieTarget - protein * 4 - fat * 9) / 4))

  const water = Math.round(35 * d.weight) / 1000 // 35ml/kg → litros

  return {
    imc: round1(imc),
    imcClass: imcClass(imc),
    leanMass: round1(leanMass),
    bodyFatPct: d.bodyFat ?? null,
    tmb: Math.round(tmb),
    gct: Math.round(gct),
    calorieTarget: Math.round(calorieTarget),
    deficit: deficit != null ? Math.round(deficit) : null,
    protein,
    carbs,
    fat,
    water: round1(water),
  }
}

function round1(n: number): number {
  return Math.round(n * 10) / 10
}
