import { useEffect, useState } from 'react'
import {
  calculate,
  activityLabel,
  trainingDays,
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
  saveProfile,
  getProfile,
  type Calculation,
  type TrainingProgram,
  type Profile,
} from './api'
import { EXERCISE_CATALOG, type CatalogExercise } from './exerciseCatalog'
import { buildTrainingProgram } from './trainingPlan'
import { buildStrategy } from './strategyPlan'
import { supabase } from './supabase'

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
  frequenciaOverride: '',
  duracaoTreino: '',
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
  const [knowsBodyFat, setKnowsBodyFat] = useState<'' | 'sim' | 'nao'>('')
  const [effectiveBodyFat, setEffectiveBodyFat] = useState<number | null>(null)
  const [skinfolds, setSkinfolds] = useState<{ a?: number; b?: number; c?: number }>({})
  const [history, setHistory] = useState<Calculation[]>([])
  const [loadingHistory, setLoadingHistory] = useState(false)
  const [error, setError] = useState('')
  const [training, setTraining] = useState<TrainingProgram | null>(null)
  const [viewing, setViewing] = useState<CatalogExercise | null>(null)
  const [openDay, setOpenDay] = useState<number | null>(0)
  const [showFrequency, setShowFrequency] = useState(false)
  const [showDuration, setShowDuration] = useState(false)
  const [visits, setVisits] = useState<number | null>(null)
  const [user, setUser] = useState<{ id: string; email?: string } | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [authMode, setAuthMode] = useState<'login' | 'register' | null>(null)
  const [profileMode, setProfileMode] = useState(false)
  const [infoPopup, setInfoPopup] = useState('')
  const [pdfLoading, setPdfLoading] = useState(false)
  const [authEmail, setAuthEmail] = useState('')
  const [authPassword, setAuthPassword] = useState('')
  const [pf, setPf] = useState({ fullName: '', address: '', cep: '', neighborhood: '', city: '', uf: '', cpf: '', whatsapp: '', termsAccepted: false })

  const userId = getUserId()

  const loadHistory = async (uid?: string) => {
    setLoadingHistory(true)
    try {
      setHistory(await getCalculations(uid ?? userId))
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoadingHistory(false)
    }
  }

  const loadProfile = async (id: string) => {
    try {
      const p = await getProfile(id)
      setProfile(p)
      if (p) {
        setPf({ fullName: p.fullName || '', address: p.address || '', cep: p.cep || '', neighborhood: p.neighborhood || '', city: p.city || '', uf: p.uf || '', cpf: p.cpf || '', whatsapp: p.whatsapp || '', termsAccepted: p.termsAccepted })
      }
    } catch {
      setProfile(null)
    }
  }

  useEffect(() => {
    loadHistory()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    let cancelled = false
    supabase.rpc('increment_visit').then(({ data, error }) => {
      if (!cancelled && !error && typeof data === 'number') setVisits(data)
    })
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      const u = data.session?.user
      setUser(u ? { id: u.id, email: u.email } : null)
      if (u) loadProfile(u.id)
    })
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      const u = session?.user
      setUser(u ? { id: u.id, email: u.email } : null)
      if (u) {
        loadProfile(u.id)
        loadHistory(u.id)
      } else {
        setProfile(null)
        loadHistory()
      }
    })
    return () => sub.subscription.unsubscribe()
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
    if (!user) {
      setInfoPopup('Para salvar seu roteiro, crie um login ou entre com sua conta.')
      setAuthMode('login')
      return
    }
    if (!profile) {
      setInfoPopup('Complete seu cadastro para salvar.')
      setProfileMode(true)
      return
    }
    if (!strategyContent || !training) {
      setInfoPopup('Gere a Estratégia para Meta e o treino antes de salvar o roteiro.')
      return
    }
    setSaving(true)
    setSavedMsg('')
    setError('')
    try {
      const { prazoMeses, metaKg, frequenciaOverride, duracaoTreino, ...restForm } = form
      await saveCalculation({
        ...restForm,
        prazo_meses: prazoMeses ?? null,
        meta_kg: metaKg ?? null,
        frequencia_treino: frequenciaOverride || null,
        duracao_treino: duracaoTreino || null,
        bodyFat: effectiveBodyFat ?? form.bodyFat ?? null,
        userId: user.id,
        calculationCode: calcCode,
        savedAt: new Date().toISOString(),
        results: result,
        strategy: strategyContent,
        trainingProgram: training,
      })
      setSavedMsg('Roteiro salvo!')
      await loadHistory(user.id)
      await downloadPdf()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  const downloadPdf = async () => {
    const el = document.getElementById('pdf-content')
    if (!el) return
    setPdfLoading(true)
    try {
      const [{ jsPDF }, html2canvasMod] = await Promise.all([import('jspdf'), import('html2canvas')])
      const html2canvas = html2canvasMod.default
      const canvas = await html2canvas(el, { scale: 2, backgroundColor: '#ffffff' })
      const img = canvas.toDataURL('image/png')
      const pdf = new jsPDF('p', 'mm', 'a4')
      const w = pdf.internal.pageSize.getWidth()
      const h = (canvas.height * w) / canvas.width
      pdf.addImage(img, 'PNG', 0, 0, w, h)
      pdf.save(`roteiro-${calcCode}.pdf`)
    } catch {
      setError('Falha ao gerar o PDF.')
    } finally {
      setPdfLoading(false)
    }
  }

  const onLogin = async () => {
    setError('')
    if (!authEmail || !authPassword) {
      setError('Informe e-mail e senha.')
      return
    }
    const { error } = await supabase.auth.signInWithPassword({ email: authEmail, password: authPassword })
    if (error) {
      setError(error.message)
    } else {
      setAuthMode(null)
      setAuthEmail('')
      setAuthPassword('')
    }
  }

  const onRegister = async () => {
    setError('')
    if (!authEmail || !authPassword) {
      setError('Informe e-mail e senha.')
      return
    }
    const { data, error } = await supabase.auth.signUp({ email: authEmail, password: authPassword, options: { emailRedirectTo: window.location.origin } })
    if (error) {
      setError(error.message)
      return
    }
    if (data.user && !data.session) {
      setInfoPopup('Enviamos um link de ativação para seu e-mail. Clique no link para ativar sua conta e depois entre.')
    }
    setAuthMode(null)
    setAuthEmail('')
    setAuthPassword('')
  }

  const onGoogle = async () => {
    await supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: window.location.origin } })
  }

  const onLogout = async () => {
    await supabase.auth.signOut()
  }

  const onCepChange = async (cep: string) => {
    setPf((p) => ({ ...p, cep }))
    const c = cep.replace(/\D/g, '')
    if (c.length === 8) {
      try {
        const res = await fetch(`https://viacep.com.br/ws/${c}/json/`)
        const d = await res.json()
        if (d && !d.erro) {
          setPf((p) => ({ ...p, address: d.logradouro || p.address, neighborhood: d.bairro || p.neighborhood, city: d.localidade || p.city, uf: d.uf || p.uf }))
        } else {
          setInfoPopup('CEP não encontrado. Verifique o número.')
        }
      } catch {
        /* ignore */
      }
    }
  }

  const onSaveProfile = async () => {
    setError('')
    if (!user) return
    if (!pf.fullName || !pf.address || !pf.cep || !pf.neighborhood || !pf.city || !pf.cpf || !pf.whatsapp) {
      setError('Preencha todos os campos do cadastro.')
      return
    }
    if (!pf.termsAccepted) {
      setError('Você precisa aceitar os termos de uso.')
      return
    }
    try {
      const saved = await saveProfile({ id: user.id, ...pf })
      setProfile(saved)
      setProfileMode(false)
      setInfoPopup('Cadastro concluído!')
    } catch (e) {
      setError((e as Error).message)
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

  const onGenerateStrategy = () => {
    if (!result) return
    setError('')
    setStrategyContent(buildStrategy(form.goal, form.activityLevel, form.prazoMeses, form.weight, result, form.frequenciaOverride))
  }

  const onGoToTraining = () => {
    if (!strategyContent) {
      setError('Gere a Estratégia para Meta antes de criar o roteiro de treinos.')
      return
    }
    goToStep(4)
  }

  const onDelete = async (id: string) => {
    try {
      await deleteCalculation(id)
      setHistory((h) => h.filter((c) => c.id !== id))
    } catch (e) {
      setError((e as Error).message)
    }
  }

  const onLoadCalc = (c: Calculation) => {
    if (!c.results) {
      setError('Este roteiro não tem dados de Raio X.')
      return
    }
    setForm({
      name: c.name,
      age: c.age,
      gender: c.gender as any,
      weight: c.weight,
      height: c.height,
      bodyFat: c.bodyFat ?? undefined,
      bodyFatEstimationMethod: c.bodyFatEstimationMethod ?? '',
      activityLevel: c.activityLevel as any,
      goal: c.goal as any,
      restrictions: c.restrictions ?? '',
      prazoMeses: c.prazo_meses ?? undefined,
      metaKg: c.meta_kg ?? undefined,
      frequenciaOverride: c.frequencia_treino || '',
      duracaoTreino: c.duracao_treino || '',
    })
    setCalcCode(c.calculationCode)
    setEffectiveBodyFat(c.bodyFat ?? null)
    setResult(c.results as RaioXResult)
    setStrategyContent(typeof c.strategy === 'string' ? c.strategy : '')
    setTraining(c.trainingProgram)
    setAiContent('')
    setView('app')
    setStep(3)
    setError('')
  }

  const onGenerateTraining = () => {
    if (!result) return
    setError('')
    setTraining(buildTrainingProgram(form.goal, form.activityLevel, form.frequenciaOverride))
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
          {user ? (
            <button className="navlink" onClick={onLogout} title={user.email}>
              Sair
            </button>
          ) : (
            <button className="navlink" onClick={() => setAuthMode('login')}>
              Entrar
            </button>
          )}
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

              <div className="actions secondary">
                <button className="btn btn-secondary" onClick={onGenerateAI} disabled={aiLoading}>
                  {aiLoading ? 'Gerando...' : '1 Gerar Análise Corporal Completa'}
                </button>
                <button className="btn btn-secondary" onClick={onGenerateStrategy}>
                  2 Gerar Estratégia para Meta
                </button>
              </div>

              {aiContent && (
                <div className="ai-result">
                  <h3 className="ai-title">Análise Completa</h3>
                  <div dangerouslySetInnerHTML={{ __html: renderMarkdown(aiContent) }} />
                </div>
              )}
              {strategyContent && (
                <div className="ai-result">
                  <h3 className="ai-title">Estratégia para Meta</h3>
                  <div dangerouslySetInnerHTML={{ __html: renderMarkdown(strategyContent) }} />
                </div>
              )}

              <div className="actions">
                <button className="btn btn-ghost" onClick={() => goToStep(2)}>Voltar</button>
                <button className="btn btn-primary" onClick={onGoToTraining} disabled={!strategyContent}>
                  3 Criar roteiro de treinos
                </button>
              </div>
              {!strategyContent && (
                <p className="hint">Gere a Estratégia para Meta para liberar o roteiro de treinos.</p>
              )}

              <p className="legal">
                * Resultados gerados a partir de fórmulas padrão. Consulte um nutricionista ou médico antes de iniciar qualquer dieta.
              </p>
            </div>
          )}

          {step === 4 && (
            <div className="card">
              <h1>Divisão de Treino</h1>
              <p className="lede">Seu plano semanal de treino, exercício a exercício.</p>

              <p className="hint">
                Frequência de treino calculada: <strong>{trainingDays(form.activityLevel, form.frequenciaOverride)}x/semana</strong>
              </p>

              <button type="button" className="btn-toggle" onClick={() => setShowFrequency((v) => !v)}>
                {showFrequency ? '▾' : '▸'} Incluir nova frequência
              </button>
              {showFrequency && (
                <div className="pill-group">
                  {([
                    ['1-3', '1 a 3x'],
                    ['3-5', '3 a 5x'],
                    ['6-7', '6 a 7x'],
                  ] as const).map(([v, label]) => (
                    <button
                      key={v}
                      type="button"
                      className={`pill ${form.frequenciaOverride === v ? 'active' : ''}`}
                      onClick={() => set('frequenciaOverride', form.frequenciaOverride === v ? '' : v)}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              )}

              <button type="button" className="btn-toggle" onClick={() => setShowDuration((v) => !v)}>
                {showDuration ? '▾' : '▸'} Duração de treino
              </button>
              {showDuration && (
                <>
                  <div className="pill-group">
                    {['30', '45', '60', '90'].map((d) => (
                      <button
                        key={d}
                        type="button"
                        className={`pill ${form.duracaoTreino === d ? 'active' : ''}`}
                        onClick={() => set('duracaoTreino', form.duracaoTreino === d ? '' : d)}
                      >
                        {d} min
                      </button>
                    ))}
                  </div>
                  <p className="hint">
                    Recomendação (literatura): 45-60 min é o ideal para hipertrofia. Sessões acima de 60-90 min elevam o cortisol e reduzem o retorno.
                  </p>
                </>
              )}

              <div className="actions">
                <button className="btn btn-primary" onClick={onGenerateTraining}>
                  {training ? 'Regenerar treino semanal' : 'Gerar treino semanal'}
                </button>
              </div>

              {training && (
                <div className="training">
                  {training.split && <h2 className="training-split">{training.split}</h2>}
                  {form.duracaoTreino && <p className="tduration">Duração sugerida: {form.duracaoTreino} min por sessão</p>}
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
                <button className="btn btn-primary" onClick={onSave} disabled={saving || pdfLoading}>
                  {pdfLoading ? 'Gerando PDF...' : saving ? 'Salvando...' : 'Salvar Roteiro'}
                </button>
              </div>
              {savedMsg && <div className="ok">{savedMsg}</div>}

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
                <div className="hist-actions">
                  <button className="btn-view" onClick={() => onLoadCalc(c)}>Ver roteiro</button>
                  <button className="btn-del" onClick={() => onDelete(c.id)}>Apagar</button>
                </div>
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
        <p className="version">
          v{__APP_COMMIT__} · {new Date(__APP_BUILD_TIME__).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
        </p>
        {visits != null && (
          <p className="version">Acessos: {visits.toLocaleString('pt-BR')}</p>
        )}
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

      {authMode && (
        <div className="modal-overlay" onClick={() => setAuthMode(null)}>
          <div className="modal auth-modal" onClick={(e) => e.stopPropagation()}>
            <button className="modal-close" onClick={() => setAuthMode(null)} aria-label="Fechar">×</button>
            <h2 className="auth-title">{authMode === 'login' ? 'Entrar' : 'Criar conta'}</h2>
            <p className="auth-sub">{authMode === 'login' ? 'Entre para salvar e consultar seus roteiros.' : 'Crie sua conta para salvar seus roteiros.'}</p>

            <div className="auth-social">
              <button type="button" className="btn-social" onClick={onGoogle}>
                <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/></svg>
                Continuar com Google
              </button>
            </div>

            <div className="auth-divider">ou</div>

            <label>E-mail</label>
            <input type="email" value={authEmail} onChange={(e) => setAuthEmail(e.target.value)} placeholder="seu@email.com" />
            <label>Senha</label>
            <input type="password" value={authPassword} onChange={(e) => setAuthPassword(e.target.value)} placeholder="••••••" />

            <div className="actions">
              <button className="btn btn-primary" onClick={authMode === 'login' ? onLogin : onRegister}>
                {authMode === 'login' ? 'Entrar' : 'Criar conta'}
              </button>
            </div>

            <p className="hint" style={{ textAlign: 'center', cursor: 'pointer' }} onClick={() => setAuthMode(authMode === 'login' ? 'register' : 'login')}>
              {authMode === 'login' ? 'Não tem uma conta? Criar conta' : 'Já tem uma conta? Entrar'}
            </p>
            {authMode === 'register' && (
              <p className="hint">Você receberá um e-mail com um link para ativar sua conta.</p>
            )}
          </div>
        </div>
      )}

      {profileMode && (
        <div className="modal-overlay" onClick={() => setProfileMode(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <button className="modal-close" onClick={() => setProfileMode(false)} aria-label="Fechar">×</button>
            <h3>Complete seu cadastro</h3>
            <label>Nome completo</label>
            <input value={pf.fullName} onChange={(e) => setPf((p) => ({ ...p, fullName: e.target.value }))} placeholder="Seu nome completo" />
            <label>CEP</label>
            <input value={pf.cep} onChange={(e) => onCepChange(e.target.value)} placeholder="00000-000" />
            <label>Endereço</label>
            <input value={pf.address} onChange={(e) => setPf((p) => ({ ...p, address: e.target.value }))} placeholder="Rua, número" />
            <div className="row">
              <div>
                <label>Bairro</label>
                <input value={pf.neighborhood} onChange={(e) => setPf((p) => ({ ...p, neighborhood: e.target.value }))} />
              </div>
              <div>
                <label>Cidade</label>
                <input value={pf.city} onChange={(e) => setPf((p) => ({ ...p, city: e.target.value }))} />
              </div>
            </div>
            <label>CPF</label>
            <input value={pf.cpf} onChange={(e) => setPf((p) => ({ ...p, cpf: e.target.value }))} placeholder="000.000.000-00" />
            <label>Contato (WhatsApp)</label>
            <input value={pf.whatsapp} onChange={(e) => setPf((p) => ({ ...p, whatsapp: e.target.value }))} placeholder="(11) 90000-0000" />
            <label className="radio" style={{ marginTop: 14 }}>
              <input type="checkbox" checked={pf.termsAccepted} onChange={(e) => setPf((p) => ({ ...p, termsAccepted: e.target.checked }))} />
              Aceito os termos de uso
            </label>
            <p className="hint">Ao usar o Body & Health você concorda com os termos de uso e a política de privacidade.</p>
            <div className="actions">
              <button className="btn btn-primary" onClick={onSaveProfile}>Concluir cadastro</button>
            </div>
          </div>
        </div>
      )}

      {infoPopup && (
        <div className="modal-overlay" onClick={() => setInfoPopup('')}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <button className="modal-close" onClick={() => setInfoPopup('')} aria-label="Fechar">×</button>
            <h3>Aviso</h3>
            <p>{infoPopup}</p>
            <div className="actions">
              <button className="btn btn-primary" onClick={() => setInfoPopup('')}>Entendi</button>
            </div>
          </div>
        </div>
      )}

      <div id="pdf-content" className="pdf-hidden">
        <div style={{ fontFamily: 'Sora, sans-serif', color: '#111', fontSize: 13 }}>
          <h1 style={{ fontSize: 22, margin: '0 0 4px' }}>Body & Health</h1>
          <p style={{ color: '#555', margin: '0 0 16px' }}>Análise Corporal - {form.name}, {calcCode}, {new Date().toLocaleDateString('pt-BR')}</p>
          {result && (
            <>
              <h2 style={{ fontSize: 16, borderBottom: '1px solid #ccc', paddingBottom: 4 }}>Raio X Corporal</h2>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <tbody>
                  <tr><td style={{ padding: '4px 8px 4px 0', fontWeight: 700, width: 160 }}>IMC</td><td style={{ padding: '4px 0' }}>{result.imc} ({result.imcClass})</td></tr>
                  <tr><td style={{ padding: '4px 8px 4px 0', fontWeight: 700 }}>Massa magra</td><td style={{ padding: '4px 0' }}>{result.leanMass} kg</td></tr>
                  {result.bodyFatPct != null && <tr><td style={{ padding: '4px 8px 4px 0', fontWeight: 700 }}>% gordura</td><td style={{ padding: '4px 0' }}>{result.bodyFatPct}%</td></tr>}
                  <tr><td style={{ padding: '4px 8px 4px 0', fontWeight: 700 }}>TMB</td><td style={{ padding: '4px 0' }}>{result.tmb} kcal</td></tr>
                  <tr><td style={{ padding: '4px 8px 4px 0', fontWeight: 700 }}>GCT</td><td style={{ padding: '4px 0' }}>{result.gct} kcal</td></tr>
                  <tr><td style={{ padding: '4px 8px 4px 0', fontWeight: 700 }}>Meta calórica</td><td style={{ padding: '4px 0' }}>{result.calorieTarget} kcal</td></tr>
                  <tr><td style={{ padding: '4px 8px 4px 0', fontWeight: 700 }}>Macros</td><td style={{ padding: '4px 0' }}>P {result.protein}g / C {result.carbs}g / G {result.fat}g</td></tr>
                  <tr><td style={{ padding: '4px 8px 4px 0', fontWeight: 700 }}>Água</td><td style={{ padding: '4px 0' }}>{result.water} L/dia</td></tr>
                </tbody>
              </table>
            </>
          )}
          {aiContent && <><h2 style={{ fontSize: 16, borderBottom: '1px solid #ccc', paddingBottom: 4, marginTop: 16 }}>Análise Corporal Completa</h2><div style={{ fontSize: 12 }} dangerouslySetInnerHTML={{ __html: renderMarkdown(aiContent) }} /></>}
          {strategyContent && <><h2 style={{ fontSize: 16, borderBottom: '1px solid #ccc', paddingBottom: 4, marginTop: 16 }}>Estratégia para Meta</h2><div style={{ fontSize: 12 }} dangerouslySetInnerHTML={{ __html: renderMarkdown(strategyContent) }} /></>}
          {training && <><h2 style={{ fontSize: 16, borderBottom: '1px solid #ccc', paddingBottom: 4, marginTop: 16 }}>Roteiro de Treinos</h2>{form.duracaoTreino && <p>Duração: {form.duracaoTreino} min por sessão</p>}{training.days.map((d, i) => <div key={i} style={{ marginTop: 10 }}><h3 style={{ fontSize: 14, margin: '0 0 4px' }}>{d.name}</h3><ul style={{ margin: '0 0 0 18px', padding: 0 }}>{d.exercises.map((e, j) => <li key={j} style={{ margin: '2px 0' }}>{e.name} - {e.sets} séries de {e.reps}{e.rest ? `, descanso ${e.rest}` : ''}</li>)}</ul></div>)}</>}
        </div>
      </div>
    </div>
  )
}
