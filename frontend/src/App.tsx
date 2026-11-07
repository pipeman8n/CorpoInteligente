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
  type Calculation,
} from './api'

// Renderizador mínimo de markdown (tabela + negrito) para a saída da IA
function inline(s: string): string {
  return s.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
}

function renderMarkdown(md: string): string {
  const lines = md.split('\n')
  let html = ''
  let inTable = false
  let tableHtml = ''
  for (const line of lines) {
    const t = line.trim()
    if (t.startsWith('|')) {
      const cells = t.split('|').slice(1, -1).map((c) => c.trim())
      if (cells.every((c) => /^-+$/.test(c))) continue // linha separadora
      if (!inTable) { inTable = true; tableHtml = '<table class="ai-table">' }
      const tag = tableHtml.endsWith('</tr>') ? 'td' : 'th'
      tableHtml += `<tr>${cells.map((c) => `<${tag}>${inline(c)}</${tag}>`).join('')}</tr>`
    } else {
      if (inTable) { html += tableHtml + '</table>'; inTable = false; tableHtml = '' }
      if (t) html += `<p>${inline(t)}</p>`
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

export default function App() {
  const [tab, setTab] = useState<'calculadora' | 'meus'>('calculadora')
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

  const onCalculate = () => {
    setError('')
    if (
      !form.name.trim() ||
      form.age <= 0 ||
      form.weight <= 0 ||
      form.height <= 0 ||
      !form.gender ||
      !form.activityLevel ||
      !form.goal ||
      ((form.goal === 'emagrecimento' || form.goal === 'hipertrofia') && (!form.prazoMeses || !form.metaKg))
    ) {
      setError('Preencha todos os campos obrigatórios, incluindo prazo e meta.')
      return
    }
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

  return (
    <div className="app">
      <header className="header">
        <h1>Body <span>&</span> Health</h1>
        <p className="subtitle">Raio X Corporal com IA</p>
      </header>

      <nav className="tabs">
        <button className={tab === 'calculadora' ? 'tab active' : 'tab'} onClick={() => setTab('calculadora')}>
          Calculadora
        </button>
        <button className={tab === 'meus' ? 'tab active' : 'tab'} onClick={() => setTab('meus')}>
          Meus Cálculos ({history.length})
        </button>
      </nav>

      {error && <div className="error">{error}</div>}

      {tab === 'calculadora' && (
        <div className="grid">
          <section className="card">
            <h2>Dados do Cliente</h2>
            <label>Nome</label>
            <input value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="Nome do cliente" />

            <div className="row">
              <div>
                <label>Idade (anos)</label>
                <input type="number" value={form.age === 0 ? '' : form.age} onChange={(e) => set('age', Number(e.target.value))} />
              </div>
              <div>
                <label>Sexo</label>
                <select value={form.gender} onChange={(e) => set('gender', e.target.value)}>
                  <option value="">Selecione...</option>
                  <option value="male">Masculino</option>
                  <option value="female">Feminino</option>
                </select>
              </div>
            </div>

            <div className="row">
              <div>
                <label>Peso (kg)</label>
                <input type="number" value={form.weight === 0 ? '' : form.weight} onChange={(e) => set('weight', Number(e.target.value))} />
              </div>
              <div>
                <label>Altura (cm)</label>
                <input type="number" value={form.height === 0 ? '' : form.height} onChange={(e) => set('height', Number(e.target.value))} />
              </div>
            </div>

            <label>Você sabe qual é seu % de gordura?</label>
            <div className="radio-group">
              <label className="radio">
                <input type="radio" name="knowsFat" checked={knowsBodyFat === 'sim'} onChange={() => setKnowsBodyFat('sim')} /> Sim
              </label>
              <label className="radio">
                <input type="radio" name="knowsFat" checked={knowsBodyFat === 'nao'} onChange={() => setKnowsBodyFat('nao')} /> Não
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
                <label>Como gostaria de estimar seu % de gordura?</label>
                <div className="radio-group">
                  <label className="radio">
                    <input
                      type="radio"
                      name="method"
                      checked={form.bodyFatEstimationMethod === 'deurenberg'}
                      onChange={() => set('bodyFatEstimationMethod', 'deurenberg')}
                    /> Estimar pelo meu IMC
                  </label>
                  <label className="radio">
                    <input
                      type="radio"
                      name="method"
                      checked={form.bodyFatEstimationMethod === 'pollock3'}
                      onChange={() => set('bodyFatEstimationMethod', 'pollock3')}
                    /> Dobras Cutâneas
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

            <label>Nível de Atividade</label>
            <select value={form.activityLevel} onChange={(e) => set('activityLevel', e.target.value as ActivityLevel)}>
              <option value="">Selecione...</option>
              <option value="sedentary">Sedentário</option>
              <option value="light">Leve (1-3x/semana)</option>
              <option value="moderate">Moderado (3-5x/semana)</option>
              <option value="active">Ativo (6-7x/semana)</option>
            </select>

            <label>Objetivo Principal</label>
            <select value={form.goal} onChange={(e) => set('goal', e.target.value as Goal)}>
              <option value="">Selecione...</option>
              <option value="emagrecimento">Emagrecimento (perder gordura)</option>
              <option value="hipertrofia">Hipertrofia (ganhar massa)</option>
              <option value="saude">Saúde (manter peso)</option>
            </select>

            {(form.goal === 'emagrecimento' || form.goal === 'hipertrofia') && (
              <>
                <label>Prazo</label>
                <select
                  value={form.prazoMeses ?? ''}
                  onChange={(e) => set('prazoMeses', e.target.value === '' ? undefined : Number(e.target.value))}
                >
                  <option value="">Selecione o prazo</option>
                  <option value="3">3 meses</option>
                  <option value="5">5 meses</option>
                  <option value="7">7 meses</option>
                  <option value="9">9 meses</option>
                </select>

                <label>
                  {form.goal === 'hipertrofia'
                    ? 'Quantos quilos de massa magra você deseja ganhar?'
                    : 'Quantos quilos no total você deseja perder?'}
                </label>
                <input
                  type="number"
                  value={form.metaKg ?? ''}
                  onChange={(e) => set('metaKg', e.target.value === '' ? undefined : Number(e.target.value))}
                  placeholder="ex.: 5"
                />
              </>
            )}

            <label>Restrições / Alergias (opcional)</label>
            <input value={form.restrictions} onChange={(e) => set('restrictions', e.target.value)} placeholder="ex.: diabetes, lactose, glúten..." />

            <button className="primary" onClick={onCalculate}>
              Gerar Raio X Calórico
            </button>
          </section>

          <section className="card">
            {result ? (
              <>
                <h2>
                  {calcCode} | RAIO X CORPORAL
                </h2>
                <p className="client-name">
                  {form.name} · {form.age} anos · {form.gender === 'male' ? 'Masculino' : 'Feminino'}
                </p>
                <table className="result-table">
                  <thead>
                    <tr>
                      <th>Parâmetro</th>
                      <th>Resultado</th>
                      <th>Interpretação</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td>IMC</td>
                      <td>{result.imc}</td>
                      <td>{result.imcClass}</td>
                    </tr>
                    <tr>
                      <td>Massa Magra Estimada</td>
                      <td>{result.leanMass} kg</td>
                      <td>—</td>
                    </tr>
                    {result.bodyFatPct != null && (
                      <tr>
                        <td>% Gordura Corporal</td>
                        <td>{result.bodyFatPct}%</td>
                        <td>—</td>
                      </tr>
                    )}
                    <tr>
                      <td>TMB (Taxa Metabólica Basal)</td>
                      <td>{result.tmb} kcal/dia</td>
                      <td>—</td>
                    </tr>
                    <tr>
                      <td>GCT (Gasto Calórico Total)</td>
                      <td>{result.gct} kcal/dia</td>
                      <td>{activityLabel(form.activityLevel)}</td>
                    </tr>
                    <tr>
                      <td>Novo Consumo Calórico</td>
                      <td>{result.calorieTarget} kcal/dia</td>
                      <td>
                        {result.deficit != null
                          ? `Déficit de ${result.deficit} kcal/dia`
                          : form.goal === 'hipertrofia'
                            ? 'Superávit de 250 kcal/dia'
                            : 'Manutenção'}
                      </td>
                    </tr>
                    <tr>
                      <td>Distribuição de Macros</td>
                      <td>
                        P: {result.protein}g · C: {result.carbs}g · G: {result.fat}g
                      </td>
                      <td>Proteína {result.protein / form.weight > 0 ? (result.protein / form.weight).toFixed(1) : '—'} g/kg</td>
                    </tr>
                    <tr>
                      <td>Consumo de Água</td>
                      <td>{result.water} L/dia</td>
                      <td>35ml/kg</td>
                    </tr>
                  </tbody>
                </table>

                {savedMsg && <div className="ok">{savedMsg}</div>}
                <button className="primary" onClick={onSave} disabled={saving}>
                  {saving ? 'Salvando...' : 'Salvar Cálculo'}
                </button>
                <button className="ai" onClick={onGenerateAI} disabled={aiLoading}>
                  {aiLoading ? 'Gerando análise com IA...' : '🤖 Gerar Análise Completa (IA)'}
                </button>
                {aiContent && (
                  <div className="ai-result" dangerouslySetInnerHTML={{ __html: renderMarkdown(aiContent) }} />
                )}
                <button className="ai" onClick={onGenerateStrategy} disabled={strategyLoading}>
                  {strategyLoading ? 'Gerando estratégia...' : '📋 Gerar Estratégia Macro (16 semanas)'}
                </button>
                {strategyContent && (
                  <div className="ai-result" dangerouslySetInnerHTML={{ __html: renderMarkdown(strategyContent) }} />
                )}
                <p className="legal">
                  * Resultados gerados a partir de fórmulas padrão. Consulte um nutricionista ou médico antes de iniciar qualquer dieta.
                </p>
              </>
            ) : (
              <div className="placeholder">
                <p>Preencha os dados e clique em <strong>Gerar Raio X Calórico</strong> para ver a tabela.</p>
              </div>
            )}
          </section>
        </div>
      )}

      {tab === 'meus' && (
        <section className="card">
          <h2>Meus Cálculos</h2>
          {loadingHistory ? (
            <p>Carregando...</p>
          ) : history.length === 0 ? (
            <p className="placeholder">Nenhum cálculo salvo ainda.</p>
          ) : (
            <ul className="history">
              {history.map((c) => (
                <li key={c.id}>
                  <div>
                    <strong>{c.name}</strong> · {c.age} anos · {c.goal}
                    <div className="muted">
                      {c.weight}kg / {c.height}cm · {new Date(c.savedAt).toLocaleDateString('pt-BR')}
                    </div>
                  </div>
                  <button className="danger" onClick={() => onDelete(c.id)}>
                    Apagar
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      <footer className="footer">
        <p>© 2026 Body And Health. Todos os direitos reservados.</p>
        <p>
          Criado por{' '}
          <a href="https://www.linkedin.com/in/uebersonlsousa" target="_blank" rel="noopener noreferrer">
            Ueberson Sousa
          </a>{' '}
          ·{' '}
          <a href="https://www.linkedin.com/in/uebersonlsousa" target="_blank" rel="noopener noreferrer">
            LinkedIn
          </a>
        </p>
        <p className="legal">As recomendações são geradas por IA e não substituem o conselho médico profissional.</p>
        <p className="legal">
          Estratégias de dieta e treino são sugestões e devem ser adaptadas individualmente, preferencialmente com acompanhamento profissional.
        </p>
      </footer>
    </div>
  )
}
