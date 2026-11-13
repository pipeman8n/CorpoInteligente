// Cliente da Edge Function "calculations" do Supabase (substitui o server action antigo).
const EDGE_URL =
  import.meta.env.VITE_EDGE_URL ??
  'https://ylmwwwtnqhqjtufqmctf.supabase.co/functions/v1/calculations'

// Chave ANON (pública — pode ir no frontend). NUNCA a service_role aqui.
export const ANON =
  import.meta.env.VITE_SUPABASE_ANON_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlsbXd3d3RucWhxanR1ZnFtY3RmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzYwNTA2MjUsImV4cCI6MjA5MTYyNjYyNX0.qEFf4OBdLG4yq6TgQ7F5vSTuuSQVbTCrITiPV6ZLghE'

export interface Calculation {
  id: string
  userId: string
  calculationCode: string
  name: string
  age: number
  gender: string
  weight: number
  height: number
  bodyFat: number | null
  bodyFatEstimationMethod: string | null
  goal: string
  activityLevel: string
  restrictions: string | null
  prazo_meses: number | null
  meta_kg: number | null
  frequencia_treino: string | null
  duracao_treino: string | null
  strategy: string | null
  dieta: string | null
  trainingProgram: TrainingProgram | null
  results: any
  savedAt: string
}

async function a1(action: string, params: Record<string, unknown>): Promise<any> {
  const res = await fetch(EDGE_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${ANON}`,
      apikey: ANON,
    },
    body: JSON.stringify({ action, ...params }),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Request failed' }))
    throw new Error(err.error || `HTTP ${res.status}`)
  }
  return res.json()
}

export function getUserId(): string {
  let id = localStorage.getItem('bh-userId')
  if (!id) {
    id = 'bh-user-' + crypto.randomUUID()
    localStorage.setItem('bh-userId', id)
  }
  return id
}

export const saveCalculation = (data: Record<string, unknown>) =>
  a1('save_new_calculation', { data })

export const getCalculations = (userId: string): Promise<Calculation[]> =>
  a1('get_user_calculations', { userId })

export const deleteCalculation = (calculationId: string) =>
  a1('delete_calculation', { calculationId })

export const generateRaioX = (data: Record<string, unknown>): Promise<{ content: string }> =>
  a1('generate_raio_x', { data })

export const generateStrategy = (data: Record<string, unknown>): Promise<{ content: string }> =>
  a1('generate_strategy', { data })

export interface TrainingExercise {
  name: string
  sets: number
  reps: string
  rest?: string
}
export interface TrainingDay {
  name: string
  exercises: TrainingExercise[]
}
export interface TrainingProgram {
  split?: string
  days: TrainingDay[]
}

export const generateTraining = (data: Record<string, unknown>): Promise<{ program: TrainingProgram }> =>
  a1('generate_training', { data })

export interface DietaAlimento {
  descricao: string
  quantidade_g: number
  alimento: { id: number; descricao: string } | null
  macros: { kcal: number; proteina: number; carbo: number; gordura: number } | null
}
export interface DietaRefeicao {
  nome: string
  horario: string
  alimentos: DietaAlimento[]
  observacao: string
  totais: { kcal: number; proteina: number; carbo: number; gordura: number }
}
export interface DietaPlan {
  refeicoes: DietaRefeicao[]
  totais: { kcal: number; proteina: number; carbo: number; gordura: number }
  meta: { calorias: number | null; proteinaG: number | null; carbG: number | null; gorduraG: number | null }
  naoEncontrados: string[]
}

export const generateDieta = (data: Record<string, unknown>): Promise<DietaPlan> =>
  a1('generate_dieta', { data })

export interface Alimento {
  id: number
  descricao: string
  categoria: string | null
  energia_kcal: number | null
  proteina_g: number | null
  lipideos_g: number | null
  carboidrato_g: number | null
  fibra_g: number | null
  sodio_mg: number | null
}
export const searchAlimentos = (query: string): Promise<{ results: Alimento[] }> =>
  a1('search_alimentos', { query })

export interface Profile {
  id: string
  fullName: string
  address: string
  numero: string
  cep: string
  neighborhood: string
  city: string
  uf: string
  cpf: string
  whatsapp: string
  instagram: string
  termsAccepted: boolean
}

export const saveProfile = (data: Record<string, unknown>): Promise<Profile> =>
  a1('save_profile', { data })

export const getProfile = (id: string): Promise<Profile | null> =>
  a1('get_profile', { id })
