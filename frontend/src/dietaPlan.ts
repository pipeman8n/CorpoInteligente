import type { RaioXResult } from './calc'

export type CanetaSubstancia = '' | 'semaglutida' | 'tirzepatida' | 'liraglutida'
export type CanetaCiclo = '' | 'titulacao' | 'manutencao' | 'desmame'

export interface CanetaInfo {
  usa: boolean
  substancia: CanetaSubstancia
  dosagem: string
  ciclo: CanetaCiclo
}

export interface DietaMacros {
  calorias: number
  proteinaG: number
  proteinaGkg: number
  carbG: number
  carbPct: number
  gorduraG: number
  gorduraPct: number
  aguaMl: number
  pisoCalorico: number
  caneta: boolean
}

// Doses disponíveis por substância (Guia Clínico e Farmacológico das Canetas)
export const CANETA_DOSES: Record<Exclude<CanetaSubstancia, ''>, string[]> = {
  semaglutida: ['0,25 mg', '0,5 mg', '1,0 mg', '1,7 mg', '2,4 mg'],
  tirzepatida: ['2,5 mg', '5,0 mg', '7,5 mg', '10,0 mg', '12,5 mg', '15,0 mg'],
  liraglutida: ['0,6 mg', '1,2 mg', '1,8 mg', '2,4 mg', '3,0 mg'],
}

export const CANETA_LABELS: Record<Exclude<CanetaSubstancia, ''>, string> = {
  semaglutida: 'Semaglutida (Ozempic / Wegovy)',
  tirzepatida: 'Tirzepatida (Mounjaro)',
  liraglutida: 'Liraglutida (Saxenda)',
}

// Metodologia GLP-1 ("Metodologia Clínica e Nutricional para Pacientes em Uso Canetas"):
// proteína 1.6-2.2 g/kg (prioridade #1), carbo 35-45% VET, gordura 20-25% VET, água 35-45 mL/kg.
// Sem caneta ("A Precision Methodology..."): emagrecimento 2.0-2.2 g/kg; hipertrofia 1.7-2.0; manutenção 1.2-1.7.
export function buildDietaMacros(
  goal: string,
  weight: number,
  result: RaioXResult,
  caneta: CanetaInfo,
): DietaMacros {
  const cal = Math.round(result.calorieTarget ?? 0)

  let proteinaGkg: number
  let carbPct: number
  let gorduraPct: number

  if (caneta.usa) {
    proteinaGkg = 2.0 // prioridade #1 na metodologia GLP-1
    carbPct = 0.4
    gorduraPct = 0.22
  } else if (goal === 'emagrecimento') {
    proteinaGkg = 2.1
    carbPct = 0.4
    gorduraPct = 0.25
  } else if (goal === 'hipertrofia') {
    proteinaGkg = 1.85
    carbPct = 0.45
    gorduraPct = 0.25
  } else {
    proteinaGkg = 1.45 // saude / manutencao
    carbPct = 0.45
    gorduraPct = 0.3
  }

  const proteinaG = Math.round(weight * proteinaGkg)
  const carbG = Math.round((cal * carbPct) / 4)
  const gorduraG = Math.round((cal * gorduraPct) / 9)
  // GLP-1: hidratação 35-45 mL/kg (usar 40); demais: 35 mL/kg
  const aguaMl = Math.round(weight * (caneta.usa ? 40 : 35))
  // GLP-1: consumo não deve ficar abaixo da TMB (piso de segurança)
  const pisoCalorico = caneta.usa ? Math.round(result.tmb) : 0

  return {
    calorias: cal,
    proteinaG,
    proteinaGkg,
    carbG,
    carbPct,
    gorduraG,
    gorduraPct,
    aguaMl,
    pisoCalorico,
    caneta: caneta.usa,
  }
}
