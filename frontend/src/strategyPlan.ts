import { trainingDays, type RaioXResult } from './calc'

function phaseNames(n: number): string[] {
  if (n === 3) return ['Adaptação', 'Otimização', 'Definição']
  if (n === 4) return ['Adaptação', 'Otimização', 'Força', 'Definição']
  const middle = ['Otimização', 'Força', 'Consolidação', 'Peaking', 'Manutenção', 'Reavaliação']
  const names = ['Adaptação']
  for (let i = 0; i < n - 2; i++) names.push(middle[i % middle.length])
  names.push('Definição')
  return names
}

function trainingSplit(activityLevel: string, frequenciaOverride?: string): string {
  const days = trainingDays(activityLevel, frequenciaOverride)
  if (days === 3) return 'Push/Pull/Legs 3x'
  if (days === 4) return 'Superiores/Inferiores 4x'
  if (days === 6) return 'Push/Pull/Legs 6x (A/B)'
  return 'Push/Pull/Legs + Superiores/Inferiores 5x'
}

function objetivo(phase: string): string {
  if (phase === 'Adaptação') return 'Adaptar o corpo ao novo estímulo e criar rotina'
  if (phase === 'Otimização') return 'Aumentar volume e intensidade para acelerar resultados'
  if (phase === 'Força') return 'Priorizar ganho de força com cargas progressivas'
  if (phase === 'Definição') return 'Reduzir gordura preservando massa magra'
  return 'Consolidar os resultados e ajustar o plano'
}

function recomendacao(goal: string, phase: string): string {
  if (goal === 'hipertrofia') {
    if (phase === 'Adaptação') return 'Foco em técnica e consistência; sono 7-9h; creatina 3-5g/dia'
    if (phase === 'Otimização') return 'Progressão de carga semanal; volume 12-16 séries/grupo'
    if (phase === 'Força') return 'Reps baixas nos compostos; priorizar carga'
    if (phase === 'Definição') return 'Manter proteína alta; cardio moderado'
    return 'Ajustar volume conforme a resposta'
  }
  if (goal === 'emagrecimento') {
    if (phase === 'Adaptação') return 'Criar déficit moderado; cardio leve no início'
    if (phase === 'Otimização') return 'Aumentar cardio; manter treino de força'
    if (phase === 'Força') return 'Manter força para preservar massa magra'
    if (phase === 'Definição') return 'Déficit seguro; proteína 2,0g/kg'
    return 'Ajustar déficit conforme estagnação'
  }
  if (phase === 'Adaptação') return 'Rotina equilibrada; foco em consistência'
  if (phase === 'Otimização') return 'Aumentar intensidade gradualmente'
  if (phase === 'Força') return 'Progressão de carga leve'
  if (phase === 'Definição') return 'Manter equilíbrio calórico'
  return 'Manter rotina saudável'
}

function monitoramento(): string {
  return 'Peso semanal, medidas e fotos a cada 4 semanas'
}

function observacao(goal: string, phase: string): string {
  if (phase === 'Adaptação') return 'Fase inicial: foco em consistência e técnica'
  if (phase === 'Definição') return 'Ajustar kcal se estagnar por 2 semanas'
  return goal === 'hipertrofia' ? 'Proteína 2,0g/kg ou mais; superávit progressivo' : goal === 'emagrecimento' ? 'Carbs não abaixo de 100g/dia' : 'Observar a resposta do corpo'
}

function phaseKcal(goal: string, baseKcal: number, i: number): number {
  if (goal === 'hipertrofia') return Math.round(baseKcal + i * 50)
  if (goal === 'emagrecimento') return Math.round(baseKcal - i * 25)
  return Math.round(baseKcal)
}

function phaseMacros(goal: string, kcal: number, weight: number): { protein: number; fat: number; carbs: number } {
  const pPerKg = goal === 'hipertrofia' ? 2.2 : goal === 'emagrecimento' ? 2.0 : 1.8
  const protein = Math.round(pPerKg * weight)
  const fat = Math.round((kcal * 0.25) / 9)
  const carbs = Math.max(0, Math.round((kcal - protein * 4 - fat * 9) / 4))
  return { protein, fat, carbs }
}

export function buildStrategy(
  goal: string,
  activityLevel: string,
  prazoMeses: number | undefined,
  weight: number,
  results: RaioXResult,
  frequenciaOverride?: string,
): string {
  const prazo = prazoMeses ? Number(prazoMeses) : 0
  const semanas = prazo > 0 ? prazo * 4 : 16
  const numPhases = Math.max(3, Math.round(semanas / 4))
  const weeksPerPhase = Math.max(3, Math.round(semanas / numPhases))
  const split = trainingSplit(activityLevel, frequenciaOverride)

  const header = '| Fase | Semanas | Dieta (kcal, proteínas, gorduras, carbs) | Divisão Treino | Recomendação | Objetivo | Monitoramento | Observação |'
  const sep = '|---|---|---|---|---|---|---|---|'
  const rows: string[] = []

  const names = phaseNames(numPhases)
  for (let i = 0; i < numPhases; i++) {
    const phase = names[i] ?? 'Fase ' + (i + 1)
    const semIni = i * weeksPerPhase + 1
    const semFim = Math.min((i + 1) * weeksPerPhase, semanas)
    const kcal = phaseKcal(goal, results.calorieTarget, i)
    const m = phaseMacros(goal, kcal, weight)
    rows.push(`| ${phase} | ${semIni}-${semFim} | ${kcal} kcal; P ${m.protein}g; G ${m.fat}g; C ${m.carbs}g | ${split} | ${recomendacao(goal, phase)} | ${objetivo(phase)} | ${monitoramento()} | ${observacao(goal, phase)} |`)
  }

  return [header, sep, ...rows].join('\n')
}
