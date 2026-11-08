import { useEffect, useState } from 'react'
import {
  calculate,
  activityLabel,
  estimateBodyFatByImc,
  estimateBodyFatBySkinfold,
  type ClientData,
  type RaioXResult,
  type ActivityLevel,
  type Goal,
} from './calc'
import {
  getUserId,
  saveCalculation,
  getCalculations,
  deleteCalculation,
  generateRaioX,
  generateStrategy,
  generateTraining,
  type Calculation,
  type TrainingProgram,
} from './api'
import { EXERCISE_CATALOG, type CatalogExercise } from './exerciseCatalog'

// Renderizador mínimo de markdown (tabela + negrito) para a saída da IA
function inline(s: string): string {
  return s.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
}

function renderMarkdown(md: string): string {
  const lines = md.split('\n')
  let html = ''
  let inTable = false
  let tableHtml = ''
  let lastCells: string[] = []
  let lastTag = 'td'
  for (const line of lines) {
    const t = line.trim()
    if (t.startsWith('|')) {
      const cells = t.split('|').slice(1, -1).map((c) => c.trim())
      if (cells.every((c) => /^-+$/.test(c))) continue // linha separadora
      if (!inTable) { inTable = true; tableHtml = '<table class="ai-table">' }
      lastTag = tableHtml.endsWith('</tr>') ? 'td' : 'th'
      lastCells = cells
      tableHtml += `<tr>${cells.map((c) => `<${lastTag}>${inline(c)}</${lastTag}>`).join('')}</tr>`
    } else if (inTable && t) {
      // linha de continuação dentro de uma célula (a IA às vezes quebra linha): junta na última célula
      lastCells[lastCells.length - 1] += ' ' + t
      const idx = tableHtml.lastIndexOf('<tr>')
      tableHtml = tableHtml.slice(0, idx) + `<tr>${lastCells.map((c) => `<${lastTag}>${inline(c)}</${lastTag}>`).join('')}</tr>`
    } else {
      if (inTable) { html += tableHtml + '</table>'; inTable = false; tableHtml = ''; lastCells = [] }
      if (t && !t.includes('|')) html += `<p>${inline(t)}</p>`
    }
  }
  if (inTable) html += tableHtml + '</table>'
  return html
}

const emptyForm: ClientData = {
  name: '',
  age: 0,
  gender: '',
  weight: 0,
  height: 0,
  bodyFat: undefined,
  bodyFatEstimationMethod: '',
  activityLevel: '',
  goal: '',
  restrictions: '',
  prazoMeses: undefined,
  metaKg: undefined,
}

function genCode(): string {
  return 'CODE' + Math.floor(1000 + Math.random() * 9000)
}

function bodyFatClass(bf: number, gender: string): string {
  if (gender === 'male') {
    if (bf < 10) return 'Atleta'
    if (bf < 20) return 'Saudável'
    if (bf < 25) return 'Acima da média'
    return 'Elevado'
  }
  if (bf < 20) return 'Atleta'
  if (bf < 30) return 'Saudável'
  if (bf < 35) return 'Acima da média'
  return 'Elevado'
}

const CATALOG_MAP = new Map(EXERCISE_CATALOG.map((e) => [e.name.toLowerCase(), e]))

export default function App() {
  const [view, setView] = useState<'app' | 'meus'>('app')
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1)
  const [form, setForm] = useState<ClientData>(emptyForm)
  const [result, setResult] = useState<RaioXResult | null>(null)
  const [calcCode, setCalcCode] = useState(genCode())
  const [saving, setSaving] = useState(false)
  const [savedMsg, setSavedMsg] = useState('')
  const [aiContent, setAiContent] = useState('')
  const [aiLoading, setAiLoading] = useState(false)
  const [strategyContent, setStrategyContent] = useState('')
  const [strategyLoading, setStrategyLoading] = useState(false)
  const [knowsBodyFat, setKnowsBodyFat] = useState<'' | 'sim' | 'nao'>('')
  const [effectiveBodyFat, setEffectiveBodyFat] = useState<number | null>(null)
  const [skinfolds, setSkinfolds] = useState<{ a?: number; b?: number; c?: number }>({})
  const [history, setHistory] = useState<Calculation[]>([])
  const [loadingHistory, setLoadingHistory] = useState(false)
  const [error, setError] = useState('')
  const [training, setTraining] = useState<TrainingProgram | null>(null)
  const [trainingLoading, setTrainingLoading] = useState(false)
  const [viewing, setViewing] = useState<CatalogExercise | null>(null)
  const [openDay, setOpenDay] = useState<number | null>(0)

  const userId = getUserId()

  const loadHistory = async () => {
    setLoadingHistory(true)
    try {
      setHistory(await getCalculations(userId))
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoadingHistory(false)
    }
  }

  useEffect(() => {
    loadHistory()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const set = (k: keyof ClientData, v: unknown) => setForm((f) => ({ ...f, [k]: v }))

  const goToStep = (n: 1 | 2 | 3 | 4) => {
    setError('')
    setStep(n)
    window.scrollTo({ top: 0 })
  }

  const validateStep1 = (): boolean => {
    setError('')
    if (!form.name.trim() || form.age <= 0 || !form.gender || form.weight <= 0 || form.height <= 0) {
      setError('Preencha nome, idade, sexo, peso e altura.')
      return false
    }
    if (knowsBodyFat === '') {
      setError('Informe se você sabe o % de gordura.')
      return false
    }
    if (knowsBodyFat === 'sim' && (form.bodyFat == null || form.bodyFat <= 0)) {
      setError('Informe o % de gordura.')
      return false
    }
    if (knowsBodyFat === 'nao' && !form.bodyFatEstimationMethod) {
      setError('Escolha como estimar o % de gordura.')
      return false
    }
    return true
  }

  const validateStep2 = (): boolean => {
    setError('')
    if (!form.goal) {
      setError('Selecione o objetivo principal.')
      return false
    }
    if (!form.activityLevel) {
      setError('Selecione o nível de atividade.')
      return false
    }
    if ((form.goal === 'emagrecimento' || form.goal === 'hipertrofia') && (!form.prazoMeses || !form.metaKg)) {
      setError('Preencha o prazo e a meta.')
      return false
    }
    return true
  }

  const onGenerate = () => {
    if (!validateStep2()) return
    // Estima o % de gordura quando o cliente não informa diretamente
    let bf = form.bodyFat ?? null
    if (bf == null && form.bodyFatEstimationMethod === 'deurenberg') {
      const imc = form.weight / Math.pow(form.height / 100, 2)
      bf = estimateBodyFatByImc(imc, form.age, form.gender)
    } else if (bf == null && form.bodyFatEstimationMethod === 'pollock3') {
      const sum = (skinfolds.a ?? 0) + (skinfolds.b ?? 0) + (skinfolds.c ?? 0)
      if (sum > 0) bf = estimateBodyFatBySkinfold(sum, form.age, form.gender)
    }
    setEffectiveBodyFat(bf)
    setCalcCode(genCode())
    setResult(calculate({ ...form, bodyFat: bf ?? undefined }))
    goToStep(3)
  }

  const onSave = async () => {
    if (!result) return
    setSaving(true)
    setSavedMsg('')
    setError('')
    try {
      await saveCalculation({
        ...form,
        bodyFat: effectiveBodyFat ?? form.bodyFat ?? null,
        userId,
        calculationCode: calcCode,
        savedAt: new Date().toISOString(),
        results: result,
      })
      setSavedMsg('Cálculo salvo!')
      await loadHistory()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  const onGenerateAI = async () => {
    if (!result) return
    setAiLoading(true)
    setAiContent('')
    setError('')
    try {
      const res = await generateRaioX({
        ...form,
        bodyFat: effectiveBodyFat ?? form.bodyFat ?? null,
        calculationCode: calcCode,
        results: result,
      })
      setAiContent(res.content)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setAiLoading(false)
    }
  }

  const onGenerateStrategy = async () => {
    if (!result) return
    setStrategyLoading(true)
    setStrategyContent('')
    setError('')
    try {
      const res = await generateStrategy({
        ...form,
        bodyFat: effectiveBodyFat ?? form.bodyFat ?? null,
        calculationCode: calcCode,
        results: result,
      })
      setStrategyContent(res.content)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setStrategyLoading(false)
    }
  }

  const onDelete = async (id: string) => {
    try {
      await deleteCalculation(id)
      setHistory((h) => h.filter((c) => c.id !== id))
    } catch (e) {
      setError((e as Error).message)
    }
  }

  const onGenerateTraining = async () => {
    if (!result) return
    setTrainingLoading(true)
    setTraining(null)
    setError('')
    try {
      const res = await generateTraining({
        ...form,
        bodyFat: effectiveBodyFat ?? form.bodyFat ?? null,
        calculationCode: calcCode,
        results: result,
      })
      setTraining(res.program)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setTrainingLoading(false)
    }
  }

  const lookup = (name: string): CatalogExercise | undefined => {
    const key = name.trim().toLowerCase()
    if (CATALOG_MAP.has(key)) return CATALOG_MAP.get(key)
    for (const [k, v] of CATALOG_MAP) {
      if (key.includes(k) || k.includes(key)) return v
    }
    return undefined
  }

  const leanPct = result && form.weight > 0 ? Math.round((result.leanMass / form.weight) * 100) : null

  return (
    <div className="app">
      <div className="topbar">
        <div className="brand">Body <b>&</b> Health</div>
        <div>
          <button className={view === 'app' ? 'navlink active' : 'navlink'} onClick={() => setView('app')}>
            Calculadora
          </button>
          <button className={view === 'meus' ? 'navlink active' : 'navlink'} onClick={() => setView('meus')}>
            Meus Cálculos <span className="badge">{history.length}</span>
          </button>
        </div>
      </div>

      {error && <div className="error">{error}</div>}

      {view === 'app' && (
        <>
          <div className="stepper">
            <div className={`step ${step === 1 ? 'now' : step > 1 ? 'done' : ''}`}>
              <div className="dot">1</div>
              <div className="step-label">Perfil</div>
            </div>
            <div className={`line ${step > 1 ? 'fill' : ''}`} />
            <div className={`step ${step === 2 ? 'now' : step > 2 ? 'done' : ''}`}>
              <div className="dot">2</div>
              <div className="step-label">Objetivo</div>
            </div>
            <div className={`line ${step > 2 ? 'fill' : ''}`} />
            <div className={`step ${step === 3 ? 'now' : step > 3 ? 'done' : ''}`}>
              <div className="dot">3</div>
              <div className="step-label">Resultado</div>
            </div>
            <div className={`line ${step > 3 ? 'fill' : ''}`} />
            <div className={`step ${step === 4 ? 'now' : ''}`}>
              <div className="dot">4</div>
              <div className="step-label">Treino</div>
            </div>
          </div>

          {step === 1 && (
            <div className="card">
              <h1>Vamos começar</h1>
              <p className="lede">Conte um pouco sobre o cliente para calcular o Raio X Corporal.</p>

              <label>Nome</label>
              <input value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="Nome do cliente" />

              <div className="row">
                <div>
                  <label>Idade</label>
                  <input type="number" value={form.age === 0 ? '' : form.age} onChange={(e) => set('age', Number(e.target.value))} placeholder="ex.: 30" />
                </div>
                <div>
                  <label>Sexo</label>
                  <select value={form.gender} onChange={(e) => set('gender', e.target.value)}>
                    <option value="">Selecione</option>
                    <option value="male">Masculino</option>
                    <option value="female">Feminino</option>
                  </select>
                </div>
              </div>

              <div className="row">
                <div>
                  <label>Peso (kg)</label>
                  <input type="number" value={form.weight === 0 ? '' : form.weight} onChange={(e) => set('weight', Number(e.target.value))} placeholder="ex.: 80" />
                </div>
                <div>
                  <label>Altura (cm)</label>
                  <input type="number" value={form.height === 0 ? '' : form.height} onChange={(e) => set('height', Number(e.target.value))} placeholder="ex.: 175" />
                </div>
              </div>

              <label>Você sabe o % de gordura?</label>
              <div className="radio-group">
                <label className="radio">
                  <input type="radio" name="knowsFat" checked={knowsBodyFat === 'sim'} onChange={() => setKnowsBodyFat('sim')} /> Sim, sei o valor
                </label>
                <label className="radio">
                  <input type="radio" name="knowsFat" checked={knowsBodyFat === 'nao'} onChange={() => setKnowsBodyFat('nao')} /> Estimar pra mim
                </label>
              </div>

              {knowsBodyFat === 'sim' && (
                <>
                  <label>% Gordura Corporal</label>
                  <input
                    type="number"
                    value={form.bodyFat ?? ''}
                    onChange={(e) => set('bodyFat', e.target.value === '' ? undefined : Number(e.target.value))}
                    placeholder="ex.: 18"
                  />
                </>
              )}

              {knowsBodyFat === 'nao' && (
                <>
                  <label>Como estimar o % de gordura?</label>
                  <div className="radio-group">
                    <label className="radio">
                      <input
                        type="radio"
                        name="method"
                        checked={form.bodyFatEstimationMethod === 'deurenberg'}
                        onChange={() => set('bodyFatEstimationMethod', 'deurenberg')}
                      /> Pelo IMC
                    </label>
                    <label className="radio">
                      <input
                        type="radio"
                        name="method"
                        checked={form.bodyFatEstimationMethod === 'pollock3'}
                        onChange={() => set('bodyFatEstimationMethod', 'pollock3')}
                      /> Dobras cutâneas
                    </label>
                  </div>

                  {form.bodyFatEstimationMethod === 'pollock3' && (
                    <div className="row">
                      <div>
                        <label>{form.gender === 'female' ? 'Tríceps (mm)' : 'Peitoral (mm)'}</label>
                        <input
                          type="number"
                          value={skinfolds.a ?? ''}
                          onChange={(e) => setSkinfolds((s) => ({ ...s, a: e.target.value === '' ? undefined : Number(e.target.value) }))}
                          placeholder="10"
                        />
                      </div>
                      <div>
                        <label>{form.gender === 'female' ? 'Suprailíaca (mm)' : 'Abdominal (mm)'}</label>
                        <input
                          type="number"
                          value={skinfolds.b ?? ''}
                          onChange={(e) => setSkinfolds((s) => ({ ...s, b: e.target.value === '' ? undefined : Number(e.target.value) }))}
                          placeholder="20"
                        />
                      </div>
                      <div>
                        <label>Coxa (mm)</label>
                        <input
                          type="number"
                          value={skinfolds.c ?? ''}
                          onChange={(e) => setSkinfolds((s) => ({ ...s, c: e.target.value === '' ? undefined : Number(e.target.value) }))}
                          placeholder="15"
                        />
                      </div>
                    </div>
                  )}
                </>
              )}

              <div className="actions">
                <button className="btn btn-primary" onClick={() => { if (validateStep1()) goToStep(2) }}>Continuar</button>
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="card">
              <h1>Seu objetivo</h1>
              <p className="lede">Isso define o déficit ou superávit calórico e a duração do plano.</p>

              <label>Objetivo principal</label>
              <select value={form.goal} onChange={(e) => set('goal', e.target.value as Goal)}>
                <option value="">Selecione</option>
                <option value="hipertrofia">Hipertrofia (ganhar massa)</option>
                <option value="emagrecimento">Emagrecimento (perder gordura)</option>
                <option value="saude">Saúde (manter peso)</option>
              </select>

              {(form.goal === 'emagrecimento' || form.goal === 'hipertrofia') && (
                <div className="row">
                  <div>
                    <label>Prazo</label>
                    <select
                      value={form.prazoMeses ?? ''}
                      onChange={(e) => set('prazoMeses', e.target.value === '' ? undefined : Number(e.target.value))}
                    >
                      <option value="">Selecione</option>
                      <option value="3">3 meses</option>
                      <option value="5">5 meses</option>
                      <option value="7">7 meses</option>
                      <option value="9">9 meses</option>
                    </select>
                  </div>
                  <div>
                    <label>{form.goal === 'hipertrofia' ? 'Meta de ganho (kg)' : 'Meta de perda (kg)'}</label>
                    <input
                      type="number"
                      value={form.metaKg ?? ''}
                      onChange={(e) => set('metaKg', e.target.value === '' ? undefined : Number(e.target.value))}
                      placeholder="ex.: 5"
                    />
                  </div>
                </div>
              )}

              <label>Nível de atividade</label>
              <select value={form.activityLevel} onChange={(e) => set('activityLevel', e.target.value as ActivityLevel)}>
                <option value="">Selecione</option>
                <option value="sedentary">Sedentário</option>
                <option value="light">Leve (1-3x/semana)</option>
                <option value="moderate">Moderado (3-5x/semana)</option>
                <option value="active">Ativo (6-7x/semana)</option>
              </select>

              <label>Restrições / alergias</label>
              <input value={form.restrictions} onChange={(e) => set('restrictions', e.target.value)} placeholder="ex.: lactose, glúten" />
              <p className="hint">Opcional. A IA considera isso na dieta.</p>

              <div className="actions">
                <button className="btn btn-ghost" onClick={() => goToStep(1)}>Voltar</button>
                <button className="btn btn-primary" onClick={onGenerate}>Gerar Raio X</button>
              </div>
            </div>
          )}

          {step === 3 && result && (
            <div className="card">
              <h1>Raio X Corporal</h1>
              <div className="client-meta">
                <span className="chip">{calcCode}</span>
                <span>{form.name}, {form.age} anos, {form.gender === 'male' ? 'Masculino' : 'Feminino'}</span>
              </div>

              <table className="result">
                <thead>
                  <tr>
                    <th>Parâmetro</th>
                    <th>Resultado</th>
                    <th>Leitura</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>IMC</td>
                    <td><strong>{result.imc}</strong></td>
                    <td><span className="ok-pill">{result.imcClass}</span></td>
                  </tr>
                  <tr>
                    <td>Massa magra</td>
                    <td><strong>{result.leanMass} kg</strong></td>
                    <td>{leanPct != null && <small>{leanPct}% do peso</small>}</td>
                  </tr>
                  {result.bodyFatPct != null && (
                    <tr>
                      <td>% gordura</td>
                      <td><strong>{result.bodyFatPct}%</strong></td>
                      <td><span className="ok-pill">{bodyFatClass(result.bodyFatPct, form.gender)}</span></td>
                    </tr>
                  )}
                  <tr>
                    <td>TMB</td>
                    <td><strong>{result.tmb} kcal</strong></td>
                    <td><small>Gasto em repouso</small></td>
                  </tr>
                  <tr>
                    <td>GCT</td>
                    <td><strong>{result.gct} kcal</strong></td>
                    <td><small>{activityLabel(form.activityLevel)}</small></td>
                  </tr>
                  <tr>
                    <td>Meta calórica</td>
                    <td><strong>{result.calorieTarget} kcal</strong></td>
                    <td>
                      <span className="ok-pill">
                        {result.deficit != null ? `Déficit ${result.deficit}` : form.goal === 'hipertrofia' ? 'Superávit +250' : 'Manutenção'}
                      </span>
                    </td>
                  </tr>
                  <tr>
                    <td>Macros</td>
                    <td><strong>P {result.protein}g / C {result.carbs}g / G {result.fat}g</strong></td>
                    <td><small>Proteína {(result.protein / form.weight).toFixed(1)} g/kg</small></td>
                  </tr>
                  <tr>
                    <td>Água</td>
                    <td><strong>{result.water} L/dia</strong></td>
                    <td><small>35 ml/kg</small></td>
                  </tr>
                </tbody>
              </table>

              {savedMsg && <div className="ok">{savedMsg}</div>}

              <div className="actions">
                <button className="btn btn-primary" onClick={onSave} disabled={saving}>
                  {saving ? 'Salvando...' : 'Salvar cálculo'}
                </button>
              </div>
              <div className="actions secondary">
                <button className="btn btn-secondary" onClick={onGenerateAI} disabled={aiLoading}>
                  {aiLoading ? 'Gerando...' : 'Gerar análise completa'}
                </button>
                <button className="btn btn-secondary" onClick={onGenerateStrategy} disabled={strategyLoading}>
                  {strategyLoading ? 'Gerando...' : 'Gerar estratégia macro'}
                </button>
              </div>

              {aiContent && <div className="ai-result" dangerouslySetInnerHTML={{ __html: renderMarkdown(aiContent) }} />}
              {strategyContent && <div className="ai-result" dangerouslySetInnerHTML={{ __html: renderMarkdown(strategyContent) }} />}

              <div className="actions">
                <button className="btn btn-ghost" onClick={() => goToStep(2)}>Voltar</button>
                <button className="btn btn-primary" onClick={() => goToStep(4)}>Treino</button>
              </div>

              <p className="legal">
                * Resultados gerados a partir de fórmulas padrão. Consulte um nutricionista ou médico antes de iniciar qualquer dieta.
              </p>
            </div>
          )}

          {step === 4 && (
            <div className="card">
              <h1>Divisão de Treino</h1>
              <p className="lede">Seu plano semanal de treino, exercício a exercício.</p>

              {!training && !trainingLoading && (
                <div className="actions">
                  <button className="btn btn-primary" onClick={onGenerateTraining} disabled={trainingLoading}>
                    Gerar treino semanal
                  </button>
                </div>
              )}

              {trainingLoading && (
                <div className="training">
                  <div className="skeleton" style={{ height: 16, width: '50%', marginBottom: 14 }} />
                  <div className="skeleton" style={{ height: 64, marginBottom: 10 }} />
                  <div className="skeleton" style={{ height: 64, marginBottom: 10 }} />
                  <div className="skeleton" style={{ height: 64 }} />
                </div>
              )}

              {training && (
                <div className="training">
                  {training.split && <h2 className="training-split">{training.split}</h2>}
                  {training.days.map((day, di) => (
                    <div className="tday" key={di}>
                      <button
                        type="button"
                        className="tday-head"
                        aria-expanded={openDay === di}
                        onClick={() => setOpenDay(openDay === di ? null : di)}
                      >
                        <h3>{day.name}</h3>
                        <span className="tday-toggle">{openDay === di ? '▾' : '▸'}</span>
                      </button>
                      {openDay === di && (
                        <ul className="tlist">
                          {day.exercises.map((ex, ei) => {
                            const cat = lookup(ex.name)
                            return (
                              <li key={ei}>
                                <div>
                                  <strong>{ex.name}</strong>
                                  <span className="tmeta">
                                    {ex.sets} séries de {ex.reps} reps{ex.rest ? `, descanso ${ex.rest}` : ''}
                                  </span>
                                </div>
                                {cat && (
                                  <button className="btn-view" onClick={() => setViewing(cat)}>
                                    Ver
                                  </button>
                                )}
                              </li>
                            )
                          })}
                        </ul>
                      )}
                    </div>
                  ))}
                </div>
              )}

              <div className="actions">
                <button className="btn btn-ghost" onClick={() => goToStep(3)}>Voltar</button>
              </div>
            </div>
          )}
        </>
      )}

      {view === 'meus' && (
        <div className="card">
          <h1>Meus Cálculos</h1>
          <p className="lede">Clientes que você já avaliou.</p>
          {loadingHistory ? (
            <>
              <div className="skeleton skeleton-row" />
              <div className="skeleton skeleton-row" />
              <div className="skeleton skeleton-row" />
            </>
          ) : history.length === 0 ? (
            <p className="placeholder">Nenhum cálculo salvo ainda.</p>
          ) : (
            history.map((c) => (
              <div className="hist-item" key={c.id}>
                <div>
                  <h3>{c.name}</h3>
                  <div className="meta">
                    {c.goal === 'emagrecimento' ? 'Emagrecimento' : c.goal === 'hipertrofia' ? 'Hipertrofia' : 'Saúde'}
                    {', '}{c.age} anos, {c.weight}kg/{c.height}cm, {new Date(c.savedAt).toLocaleDateString('pt-BR')}
                  </div>
                </div>
                <button className="btn-del" onClick={() => onDelete(c.id)}>Apagar</button>
              </div>
            ))
          )}
        </div>
      )}

      <footer className="footer">
        <p>© 2026 Body And Health. Todos os direitos reservados.</p>
        <p>
          Criado por{' '}
          <a href="https://www.linkedin.com/in/uebersonlsousa" target="_blank" rel="noopener noreferrer">
            Ueberson Sousa
          </a>
          {' · '}
          <a href="https://www.linkedin.com/in/uebersonlsousa" target="_blank" rel="noopener noreferrer">
            LinkedIn
          </a>
        </p>
        <p>As recomendações são geradas por IA e não substituem o conselho médico profissional.</p>
        <p>Estratégias de dieta e treino são sugestões e devem ser adaptadas individualmente, preferencialmente com acompanhamento profissional.</p>
      </footer>

      {viewing && (
        <div className="modal-overlay" onClick={() => setViewing(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <button className="modal-close" onClick={() => setViewing(null)} aria-label="Fechar">×</button>
            <h3>{viewing.name}</h3>
            <p className="tmeta">{viewing.muscle} · {viewing.equipment}</p>
            <video className="ex-video" src={viewing.video} poster={viewing.thumb} controls autoPlay loop muted playsInline />
            {viewing.instructions && <p className="ex-instructions">{viewing.instructions}</p>}
          </div>
        </div>
      )}
    </div>
  )
}
