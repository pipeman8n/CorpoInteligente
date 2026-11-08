import { EXERCISE_CATALOG, type CatalogExercise } from './exerciseCatalog'
import type { TrainingProgram, TrainingDay, TrainingExercise } from './api'

type Goal = 'hipertrofia' | 'emagrecimento' | 'saude' | ''

// Catálogo agrupado por grupo muscular (já ordenado: compostos/barras primeiro)
const byMuscle = new Map<string, CatalogExercise[]>()
for (const e of EXERCISE_CATALOG) {
  if (!byMuscle.has(e.muscle)) byMuscle.set(e.muscle, [])
  byMuscle.get(e.muscle)!.push(e)
}

function pick(muscle: string, count: number, offset: number): CatalogExercise[] {
  const pool = byMuscle.get(muscle) ?? []
  const out: CatalogExercise[] = []
  for (let i = 0; i < count && pool.length > 0; i++) {
    out.push(pool[(offset + i) % pool.length])
  }
  return out
}

function toExercise(e: CatalogExercise, isFirst: boolean, goal: Goal): TrainingExercise {
  if (goal === 'hipertrofia') {
    // primeiro exercício do dia = composto (mais carga)
    return isFirst
      ? { name: e.name, sets: 4, reps: '8-10', rest: '90s' }
      : { name: e.name, sets: 3, reps: '10-12', rest: '60s' }
  }
  if (goal === 'emagrecimento') {
    return { name: e.name, sets: 3, reps: '12-15', rest: '45s' }
  }
  return { name: e.name, sets: 3, reps: '10-12', rest: '60s' }
}

type Muscles = [string, number][]

function buildDay(name: string, muscles: Muscles, goal: Goal, offset: number): TrainingDay {
  const exercises: TrainingExercise[] = []
  let first = true
  for (const [muscle, count] of muscles) {
    for (const e of pick(muscle, count, offset)) {
      exercises.push(toExercise(e, first, goal))
      first = false
    }
  }
  return { name, exercises }
}

export function buildTrainingProgram(goal: Goal, activityLevel: string): TrainingProgram {
  const daysCount = activityLevel === 'active' ? 5 : activityLevel === 'moderate' ? 4 : 3
  const g: Goal = goal === 'hipertrofia' || goal === 'emagrecimento' || goal === 'saude' ? goal : 'saude'

  if (daysCount === 3) {
    return {
      split: 'Push/Pull/Legs 3x',
      days: [
        buildDay('Dia 1 - Peito, Ombros e Tríceps', [['Peito', 2], ['Ombros', 2], ['Tríceps', 2]], g, 0),
        buildDay('Dia 2 - Costas e Bíceps', [['Costas', 3], ['Bíceps', 2], ['Core', 1]], g, 0),
        buildDay('Dia 3 - Pernas', [['Quadríceps', 2], ['Posterior', 1], ['Glúteos', 1], ['Panturrilha', 1]], g, 0),
      ],
    }
  }

  if (daysCount === 4) {
    return {
      split: 'Superiores/Inferiores 4x',
      days: [
        buildDay('Dia 1 - Superiores A', [['Peito', 2], ['Costas', 2], ['Ombros', 1], ['Bíceps', 1], ['Tríceps', 1]], g, 0),
        buildDay('Dia 2 - Inferiores A', [['Quadríceps', 2], ['Posterior', 1], ['Glúteos', 1], ['Panturrilha', 1]], g, 0),
        buildDay('Dia 3 - Superiores B', [['Peito', 2], ['Costas', 2], ['Ombros', 1], ['Bíceps', 1], ['Tríceps', 1]], g, 2),
        buildDay('Dia 4 - Inferiores B', [['Quadríceps', 2], ['Posterior', 1], ['Glúteos', 1], ['Panturrilha', 1]], g, 2),
      ],
    }
  }

  return {
    split: 'Push/Pull/Legs + Superiores/Inferiores 5x',
    days: [
      buildDay('Dia 1 - Push', [['Peito', 2], ['Ombros', 2], ['Tríceps', 2]], g, 0),
      buildDay('Dia 2 - Pull', [['Costas', 3], ['Bíceps', 2], ['Core', 1]], g, 0),
      buildDay('Dia 3 - Legs', [['Quadríceps', 2], ['Posterior', 1], ['Glúteos', 1], ['Panturrilha', 1]], g, 0),
      buildDay('Dia 4 - Superiores', [['Peito', 2], ['Costas', 2], ['Ombros', 2]], g, 2),
      buildDay('Dia 5 - Inferiores', [['Quadríceps', 2], ['Glúteos', 2], ['Panturrilha', 1]], g, 2),
    ],
  }
}
