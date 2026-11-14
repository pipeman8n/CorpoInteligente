import { useEffect, useRef, useState } from 'react'
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
  generateDieta,
  searchAlimentos,
  type Calculation,
  type TrainingProgram,
  type Profile,
  type Alimento,
  type DietaPlan,
} from './api'
import { EXERCISE_CATALOG, type CatalogExercise } from './exerciseCatalog'
import { buildTrainingProgram } from './trainingPlan'
import { buildStrategy } from './strategyPlan'
import { buildDietaMacros, CANETA_DOSES, CANETA_LABELS, type CanetaInfo, type CanetaSubstancia, type CanetaCiclo } from './dietaPlan'
import { supabase } from './supabase'

// Renderizador mínimo de markdown (tabela + negrito) para a saída da IA
function inline(s: string): string {
  return s.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
}

function renderMarkdown(md: string): string {
  const lines = md.split('\n')
  let html = ''
  let inTable = false
  let rows: string[] = []
  let headers: string[] = []
  let lastCells: string[] = []
  const esc = (s: string) => s.replace(/"/g, '&quot;')
  for (const line of lines) {
    const t = line.trim()
    if (t.startsWith('|')) {
      const cells = t.split('|').slice(1, -1).map((c) => c.trim())
      if (cells.every((c) => /^-+$/.test(c))) continue // linha separadora
      if (!inTable) inTable = true
      if (rows.length === 0) {
        headers = cells
        rows.push(`<tr>${cells.map((c) => `<th>${inline(c)}</th>`).join('')}</tr>`)
      } else {
        lastCells = cells
        rows.push(`<tr>${cells.map((c, i) => `<td data-label="${esc(headers[i] ?? '')}">${inline(c)}</td>`).join('')}</tr>`)
      }
    } else if (inTable && t) {
      // linha de continuação dentro de uma célula (a IA às vezes quebra linha): junta na última célula
      lastCells[lastCells.length - 1] += ' ' + t
      rows[rows.length - 1] = `<tr>${lastCells.map((c, i) => `<td data-label="${esc(headers[i] ?? '')}">${inline(c)}</td>`).join('')}</tr>`
    } else {
      if (inTable) {
        html += `<table class="ai-table"><thead>${rows[0]}</thead><tbody>${rows.slice(1).join('')}</tbody></table>`
        inTable = false; rows = []; headers = []; lastCells = []
      }
      if (t && !t.includes('|')) html += `<p>${inline(t)}</p>`
    }
  }
  if (inTable) html += `<table class="ai-table"><thead>${rows[0]}</thead><tbody>${rows.slice(1).join('')}</tbody></table>`
  return html
}

// Agrupamento dos parâmetros do Raio X em seções
const RAIO_X_GROUPS: { title: string; match: RegExp }[] = [
  { title: 'Composição Corporal', match: /IMC|Massa Magra|Gordura Corporal|PGC/i },
  { title: 'Metabolismo e Saúde', match: /Taxa Metabólica|TMB|Gasto Calórico|GCT|Consumo Calórico|Hormonal/i },
  { title: 'Recomendação Nutricional', match: /Macros|Água|Suplement/i },
  { title: 'Treino Adequado', match: /Treino/i },
]

function renderRaioX(md: string): string {
  const lines = md.split('\n')
  const headers: string[] = []
  const rows: string[][] = []
  let lastRow: string[] | null = null
  for (const line of lines) {
    const t = line.trim()
    if (t.startsWith('|')) {
      const cells = t.split('|').slice(1, -1).map((c) => c.trim())
      if (cells.every((c) => /^-+$/.test(c))) continue // linha separadora
      if (headers.length === 0) { headers.push(...cells); continue }
      lastRow = cells
      rows.push(cells)
    } else if (t && lastRow) {
      // continuação de linha dentro de uma célula (a IA às vezes quebra linha)
      lastRow[lastRow.length - 1] += ' ' + t
    }
  }
  if (headers.length === 0 || rows.length === 0) return renderMarkdown(md)

  const groups: { title: string; rows: string[][] }[] = []
  for (const row of rows) {
    const param = row[0] ?? ''
    const def = RAIO_X_GROUPS.find((d) => d.match.test(param))
    const title = def ? def.title : 'Outros'
    let grp = groups.find((g) => g.title === title)
    if (!grp) { grp = { title, rows: [] }; groups.push(grp) }
    grp.rows.push(row)
  }

  let html = ''
  for (const grp of groups) {
    html += `<h3 class="ai-group-title">${grp.title}</h3>`
    for (const r of grp.rows) {
      const param = r[0] ?? ''
      const valor = r[1] ?? ''
      const interp = r[2] ?? ''
      const obs = r[3] ?? ''
      html += `<div class="ai-param">`
      html += `<div class="ai-param-name">${inline(param)}</div>`
      if (valor) html += `<div class="ai-param-val">${inline(valor)}</div>`
      if (interp) html += `<p class="ai-param-text">${inline(interp)}</p>`
      if (obs) html += `<p class="ai-param-obs">${inline(obs)}</p>`
      html += `</div>`
    }
  }
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

function dietaToMarkdown(plan: DietaPlan): string {
  const out: string[] = []
  for (const r of plan.refeicoes) {
    out.push(`**${r.nome}${r.horario ? ' — ' + r.horario : ''}**`)
    out.push('')
    out.push('| Alimento | Qtd | TACO (base) | Prot | Carbo | Gord | kcal |')
    out.push('|---|---|---|---|---|---|---|')
    for (const a of r.alimentos) {
      const tac = a.alimento ? a.alimento.descricao : '—'
      const m = a.macros
      out.push(`| ${a.descricao || '—'} | ${a.quantidade_g}g | ${tac} | ${m ? m.proteina + 'g' : '—'} | ${m ? m.carbo + 'g' : '—'} | ${m ? m.gordura + 'g' : '—'} | ${m ? m.kcal : '—'} |`)
    }
    out.push(`| **Total** | | | **${r.totais.proteina}g** | **${r.totais.carbo}g** | **${r.totais.gordura}g** | **${r.totais.kcal}** |`)
    if (r.observacao) {
      out.push('')
      out.push(r.observacao)
    }
    out.push('')
  }
  out.push('**Totais do dia vs Meta**')
  out.push('')
  out.push('| | kcal | Proteína | Carbo | Gordura |')
  out.push('|---|---|---|---|---|')
  out.push(`| **Dieta** | ${plan.totais.kcal} | ${plan.totais.proteina}g | ${plan.totais.carbo}g | ${plan.totais.gordura}g |`)
  out.push(`| **Meta** | ${plan.meta.calorias ?? '—'} | ${plan.meta.proteinaG ?? '—'}g | ${plan.meta.carbG ?? '—'}g | ${plan.meta.gorduraG ?? '—'}g |`)
  if (plan.naoEncontrados.length) {
    out.push('')
    out.push('Alimentos sem correspondência na TACO: ' + plan.naoEncontrados.join(', '))
  }
  return out.join('\n')
}

export default function App() {
  const [view, setView] = useState<'app' | 'meus' | 'cadastro' | 'home' | 'hub'>('home')
  const [step, setStep] = useState<1 | 2 | 3>(1)
  const [resultTab, setResultTab] = useState<'analises' | 'dieta' | 'treinos'>('analises')
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
  const [invalid, setInvalid] = useState<string[]>([])
  const inv = (f: string) => (invalid.includes(f) ? 'invalid' : '')
  const [training, setTraining] = useState<TrainingProgram | null>(null)
  const [dietaContent, setDietaContent] = useState('')
  const [dietaLoading, setDietaLoading] = useState(false)
  const [caneta, setCaneta] = useState<CanetaInfo>({ usa: false, substancia: '', dosagem: '', ciclo: '' })
  const [showCaneta, setShowCaneta] = useState(false)
  const [showRestricao, setShowRestricao] = useState(false)
  const [alimentoQuery, setAlimentoQuery] = useState('')
  const [alimentoResults, setAlimentoResults] = useState<Alimento[]>([])
  const [alimentoSearching, setAlimentoSearching] = useState(false)
  const [viewing, setViewing] = useState<CatalogExercise | null>(null)
  const [openDay, setOpenDay] = useState<number | null>(0)
  const [showFrequency, setShowFrequency] = useState(false)
  const [showDuration, setShowDuration] = useState(false)
  const [visits, setVisits] = useState<number | null>(null)
  const [user, setUser] = useState<{ id: string; email?: string } | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [authMode, setAuthMode] = useState<'login' | 'register' | null>(null)
  const [showSignup, setShowSignup] = useState(false)
  const [profileMode, setProfileMode] = useState(false)
  const [infoPopup, setInfoPopup] = useState('')
  const [pdfLoading, setPdfLoading] = useState(false)
  const [authEmail, setAuthEmail] = useState('')
  const [authPassword, setAuthPassword] = useState('')
  const [pf, setPf] = useState({ firstName: '', lastName: '', address: '', numero: '', cep: '', neighborhood: '', city: '', uf: '', cpf: '', whatsapp: '', instagram: '', photo: '', termsAccepted: false })

  const userId = getUserId()

  const loadHistory = async (uid?: string, email?: string) => {
    setLoadingHistory(true)
    try {
      setHistory(await getCalculations(uid ?? userId, email))
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoadingHistory(false)
    }
  }

  const loadProfile = async (id: string): Promise<Profile | null> => {
    try {
      const p = await getProfile(id)
      setProfile(p)
      if (p) {
        setPf({ firstName: (p.fullName || '').split(' ')[0] || '', lastName: (p.fullName || '').split(' ').slice(1).join(' ') || '', address: p.address || '', numero: p.numero || '', cep: p.cep || '', neighborhood: p.neighborhood || '', city: p.city || '', uf: p.uf || '', cpf: p.cpf || '', whatsapp: p.whatsapp || '', instagram: p.instagram || '', photo: p.photo || '', termsAccepted: p.termsAccepted })
      }
      return p
    } catch {
      setProfile(null)
      return null
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
    const { data: sub } = supabase.auth.onAuthStateChange((evt, session) => {
      const u = session?.user
      setUser(u ? { id: u.id, email: u.email } : null)
      if (u) {
        loadHistory(u.id, u.email)
        if (evt === 'SIGNED_IN') {
          setAuthMode(null)
          setShowSignup(false)
          loadProfile(u.id).then((p) => {
            if (p) {
              setInfoPopup(`Você entrou com ${u.email}.`)
            } else {
              // Google/novo usuário: passo 2 — completar cadastro (Google já deu o e-mail)
              setInfoPopup('Conta conectada! Complete seu cadastro.')
              setProfileMode(true)
            }
          })
        } else {
          loadProfile(u.id)
        }
      } else {
        setProfile(null)
        loadHistory()
      }
    })
    return () => sub.subscription.unsubscribe()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Persistir o fluxo atual (sobrevive ao reload do login via Google/refresh)
  const firstRender = useRef(true)
  useEffect(() => {
    if (firstRender.current) { firstRender.current = false; return }
    try {
      localStorage.setItem('bh-flow', JSON.stringify({ form, result, calcCode, aiContent, strategyContent, training, step }))
    } catch { /* ignore */ }
  }, [form, result, calcCode, aiContent, strategyContent, training, step])

  // Restaurar o fluxo salvo ao carregar a página
  useEffect(() => {
    try {
      const raw = localStorage.getItem('bh-flow')
      if (raw) {
        const s = JSON.parse(raw)
        if (s.form) setForm(s.form)
        if (s.calcCode) setCalcCode(s.calcCode)
        if (s.aiContent) setAiContent(s.aiContent)
        if (s.strategyContent) setStrategyContent(s.strategyContent)
        if (s.training) setTraining(s.training)
        if (s.result) { setResult(s.result); if (s.step) setStep(s.step) }
      }
    } catch { /* ignore */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Título da aba dinâmico por tela
  useEffect(() => {
    const base = 'Shape Informa'
    if (view === 'meus') document.title = `Meus Cálculos - ${base}`
    else if (view === 'cadastro') document.title = `Meu Cadastro - ${base}`
    else if (view === 'home') document.title = `${base} | Avaliação Corporal e Profissionais`
    else if (view === 'hub') document.title = `${base} | Meu Painel`
    else if (step >= 3) document.title = `${base} | Análise`
    else document.title = `${base} | Análise Corporal Prévia`
  }, [view, step])

  const set = (k: keyof ClientData, v: unknown) => setForm((f) => ({ ...f, [k]: v }))

  const resetFlow = () => {
    try { localStorage.removeItem('bh-flow') } catch { /* ignore */ }
    setForm(emptyForm)
    setStep(1)
    setResultTab('analises')
    setResult(null)
    setAiContent('')
    setStrategyContent('')
    setDietaContent('')
    setTraining(null)
    setKnowsBodyFat('')
    setEffectiveBodyFat(null)
    setSkinfolds({})
    setCaneta({ usa: false, substancia: '', dosagem: '', ciclo: '' })
    setInvalid([])
    setError('')
    setAlimentoQuery('')
    setAlimentoResults([])
  }

  const goToStep = (n: 1 | 2 | 3) => {
    setError('')
    setStep(n)
    window.scrollTo({ top: 0 })
  }

  const validateStep1 = (): boolean => {
    setError('')
    const missing: string[] = []
    if (!form.name.trim()) missing.push('name')
    if (form.age <= 0) missing.push('age')
    if (!form.gender) missing.push('gender')
    if (form.weight <= 0) missing.push('weight')
    if (form.height <= 0) missing.push('height')
    if (knowsBodyFat === '') missing.push('fatChoice')
    if (knowsBodyFat === 'sim' && (form.bodyFat == null || form.bodyFat <= 0)) missing.push('bodyFat')
    if (missing.length) {
      setInvalid(missing)
      setError('Preencha os campos destacados.')
      const el = document.querySelector(`[data-field="${missing[0]}"]`)
      if (el) el.scrollIntoView({ block: 'center', behavior: 'smooth' })
      return false
    }
    setInvalid([])
    return true
  }

  const validateStep2 = (): boolean => {
    setError('')
    const missing: string[] = []
    if (!form.goal) missing.push('goal')
    if (!form.activityLevel) missing.push('activityLevel')
    if ((form.goal === 'emagrecimento' || form.goal === 'hipertrofia') && !form.prazoMeses) missing.push('prazo')
    if ((form.goal === 'emagrecimento' || form.goal === 'hipertrofia') && !form.metaKg) missing.push('metaKg')
    if (missing.length) {
      setInvalid(missing)
      setError('Preencha os campos destacados.')
      const el = document.querySelector(`[data-field="${missing[0]}"]`)
      if (el) el.scrollIntoView({ block: 'center', behavior: 'smooth' })
      return false
    }
    setInvalid([])
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
    // Auto-gerar estratégia e treino caso ainda não tenham sido gerados
    let strategy = strategyContent
    if (!strategy) {
      strategy = buildStrategy(form.goal, form.activityLevel, form.prazoMeses, form.weight, result, form.frequenciaOverride)
      setStrategyContent(strategy)
    }
    let t = training
    if (!t) {
      t = buildTrainingProgram(form.goal, form.activityLevel, form.frequenciaOverride)
      setTraining(t)
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
        strategy,
        dieta: dietaContent || null,
        trainingProgram: t,
      })
      setSavedMsg('Roteiro salvo!')
      localStorage.removeItem('bh-flow')
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

  const onGoogle = async () => {
    await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: window.location.origin,
        queryParams: { prompt: 'select_account' },
      },
    })
  }

  // Salva a prévia/análise atual (form + results + estratégia/dieta/treino) para o usuário
  const saveCurrentCalculation = async (uid: string) => {
    if (!result) return
    const { prazoMeses, metaKg, frequenciaOverride, duracaoTreino, ...restForm } = form
    await saveCalculation({
      ...restForm,
      prazo_meses: prazoMeses ?? null,
      meta_kg: metaKg ?? null,
      frequencia_treino: frequenciaOverride || null,
      duracao_treino: duracaoTreino || null,
      bodyFat: effectiveBodyFat ?? form.bodyFat ?? null,
      userId: uid,
      calculationCode: calcCode,
      savedAt: new Date().toISOString(),
      results: result,
      strategy: strategyContent || null,
      dieta: dietaContent || null,
      trainingProgram: training,
    })
  }

  const onSignupComplete = async () => {
    setError('')
    if (!authEmail || !authPassword) { setError('Informe e-mail e senha.'); return }
    if (!pf.firstName || !pf.lastName || !pf.address || !pf.numero || !pf.cep || !pf.neighborhood || !pf.city || !pf.whatsapp) {
      setError('Preencha os campos obrigatórios do cadastro.')
      return
    }
    if (!pf.termsAccepted) {
      setError('Você precisa aceitar os termos de uso.')
      return
    }
    const { data, error } = await supabase.auth.signUp({ email: authEmail, password: authPassword, options: { emailRedirectTo: window.location.origin } })
    if (error) { setError(error.message); return }
    const uid = data.user?.id
    if (uid) {
      try {
        const { firstName, lastName, ...restPf } = pf
        await saveProfile({ id: uid, ...restPf, fullName: `${firstName} ${lastName}`.trim() })
        await saveCurrentCalculation(uid)
        localStorage.removeItem('bh-flow')
      } catch { /* o cadastro foi criado; erro de salvar prévia não bloqueia */ }
    }
    setShowSignup(false)
    setAuthEmail('')
    setAuthPassword('')
    if (data.user && !data.session) {
      setInfoPopup('Conta criada! Enviamos um link de ativação para seu e-mail. Clique no link e depois entre para ver seus dados.')
    } else {
      setInfoPopup('Conta criada com sucesso!')
    }
    if (!result) { resetFlow(); setView('app') }
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

  const onPhotoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      const img = new Image()
      img.onload = () => {
        const max = 240
        const scale = Math.min(1, max / Math.max(img.width, img.height))
        const w = Math.round(img.width * scale)
        const h = Math.round(img.height * scale)
        const canvas = document.createElement('canvas')
        canvas.width = w
        canvas.height = h
        const ctx = canvas.getContext('2d')
        if (!ctx) return
        ctx.drawImage(img, 0, 0, w, h)
        setPf((p) => ({ ...p, photo: canvas.toDataURL('image/jpeg', 0.85) }))
      }
      img.src = String(reader.result)
    }
    reader.readAsDataURL(file)
  }

  const onSaveProfile = async () => {
    setError('')
    if (!user) return
    if (!pf.firstName || !pf.lastName || !pf.address || !pf.numero || !pf.cep || !pf.neighborhood || !pf.city || !pf.whatsapp) {
      setError('Preencha os campos obrigatórios do cadastro.')
      return
    }
    if (!pf.termsAccepted) {
      setError('Você precisa aceitar os termos de uso.')
      return
    }
    try {
      const { firstName, lastName, ...restPf } = pf
      const saved = await saveProfile({ id: user.id, ...restPf, fullName: `${firstName} ${lastName}`.trim() })
      setProfile(saved)
      setProfileMode(false)
      await saveCurrentCalculation(user.id)
      localStorage.removeItem('bh-flow')
      setInfoPopup('Cadastro concluído!')
    } catch (e) {
      setError((e as Error).message)
    }
  }

  const onGenerateAI = async () => {
    if (!result) return
    if (!user) {
      setShowSignup(true)
      return
    }
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

  const onGerarDieta = () => {
    if (!result) return
    setError('')
    // Ponto 1: verificação de restrições/alergias antes de gerar o roteiro nutricional
    setShowRestricao(true)
  }

  const onConfirmCaneta = async () => {
    if (!result) return
    setShowCaneta(false)
    setDietaLoading(true)
    setError('')
    try {
      const macros = buildDietaMacros(form.goal, form.weight, result, caneta)
      const res = await generateDieta({
        ...form,
        bodyFat: effectiveBodyFat ?? form.bodyFat ?? null,
        results: result,
        macros,
        caneta,
      })
      setDietaContent(dietaToMarkdown(res))
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setDietaLoading(false)
    }
  }

  const onSearchAlimentos = async () => {
    const q = alimentoQuery.trim()
    if (!q) { setAlimentoResults([]); return }
    setAlimentoSearching(true)
    try {
      const res = await searchAlimentos(q)
      setAlimentoResults(res.results)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setAlimentoSearching(false)
    }
  }

  const onGoToTraining = () => {
    if (!strategyContent) {
      setError('Gere a Estratégia para Meta antes de criar o roteiro de treinos.')
      return
    }
    setResultTab('treinos')
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
    setDietaContent(typeof c.dieta === 'string' ? c.dieta : '')
    setTraining(c.trainingProgram)
    setAiContent('')
    setView('app')
    setStep(3)
    setResultTab('analises')
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
        <div className="brand"><span className="shape">Shape</span> Informa</div>
        <div>
          <button className={view === 'home' ? 'navlink active' : 'navlink'} onClick={() => setView('home')}>
            Início
          </button>
          <button className={view === 'app' ? 'navlink active' : 'navlink'} onClick={() => setView('app')}>
            Calculadora
          </button>
          <button className={view === 'hub' ? 'navlink active' : 'navlink'} onClick={() => setView('hub')}>
            Painel
          </button>
          <button className={view === 'meus' ? 'navlink active' : 'navlink'} onClick={() => setView('meus')}>
            Meus Cálculos {history.length > 0 && <span className="badge">{history.length}</span>}
          </button>
          {user ? (
            <>
              <button className="navlink user-chip" onClick={() => { if (profile) setView('cadastro'); else setProfileMode(true) }} title="Meu Cadastro">
                {profile?.photo ? <img className="user-avatar" src={profile.photo} alt="" /> : null}
                {profile?.fullName || user.email}
              </button>
              <button className="navlink" onClick={onLogout}>
                Sair
              </button>
            </>
          ) : (
            <button className="navlink" onClick={() => setAuthMode('login')}>
              Entrar
            </button>
          )}
        </div>
      </div>

      {error && <div className="error">{error}</div>}

      {view === 'home' && (
        <>
          <div className="home-hero">
            <h1>Conheça seu corpo.<br />Conecte-se a <span>quem entende</span>.</h1>
            <p>Faça sua avaliação corporal gratuita e, se quiser acompanhamento, encontre um personal ou nutricionista que combina com seu objetivo.</p>
            <div className="home-cta">
              <button className="btn btn-primary" onClick={() => { resetFlow(); setView('app') }}>Avaliar meu corpo</button>
              <button className="btn btn-ghost" onClick={() => setAuthMode('login')}>Entrar</button>
            </div>
            <div className="paths">
              <div className="path-card">
                <h3>Sou profissional</h3>
                <p>Monte o perfil do seu cliente, gere análises e roteiros, e receba novos alunos.</p>
                <span className="path-link" onClick={() => setInfoPopup('Em breve você poderá criar seu perfil profissional e receber clientes.')}>Criar perfil profissional →</span>
              </div>
            </div>
          </div>

          <div className="pro-section">
            <div className="pro-head">
              <h2>Profissionais perto de você</h2>
              <span className="pro-ver">Prévia</span>
            </div>
            <div className="pro-grid">
              <div className="pro-card">
                <div className="pro-top">
                  <div className="ava a1">CR</div>
                  <div>
                    <div className="pro-nm">Camila Rocha</div>
                    <div className="pro-cred">Nutricionista, CRN 6-43210</div>
                  </div>
                </div>
                <p className="pro-spec">Emagrecimento e reeducação alimentar. Atende presencial e online.</p>
                <div className="pro-meta"><span>4,9 (120 avaliações)</span><b>R$ 180/sessão</b></div>
                <div className="pro-soon">Perfil completo em breve</div>
              </div>
              <div className="pro-card">
                <div className="pro-top">
                  <div className="ava a2">RT</div>
                  <div>
                    <div className="pro-nm">Rafael Tavares</div>
                    <div className="pro-cred">Personal, CREF 045678-G/SP</div>
                  </div>
                </div>
                <p className="pro-spec">Hipertrofia e performance. Treinos presenciais em SP.</p>
                <div className="pro-meta"><span>4,8 (96 avaliações)</span><b>R$ 120/sessão</b></div>
                <div className="pro-soon">Perfil completo em breve</div>
              </div>
              <div className="pro-card">
                <div className="pro-top">
                  <div className="ava a3">BN</div>
                  <div>
                    <div className="pro-nm">Beatriz Nunes</div>
                    <div className="pro-cred">Nutricionista esportiva, CRN 3-98120</div>
                  </div>
                </div>
                <p className="pro-spec">Performance e hipertrofia. Consultas online.</p>
                <div className="pro-meta"><span>5,0 (74 avaliações)</span><b>R$ 220/sessão</b></div>
                <div className="pro-soon">Perfil completo em breve</div>
              </div>
            </div>
          </div>
        </>
      )}

      {view === 'hub' && (
        <div className="card">
          <p className="lede">{result ? `Painel de ${form.name}` : 'Seu painel'}</p>
          <h1>Seu plano completo</h1>
          <div className="hub-grid">
            <button className="hub-card" onClick={() => { setView('app'); setStep(3) }}>
              <div className="hub-badge an">A</div>
              <h3>Análises</h3>
              <p>Composição corporal, metabolismo e hormônios.</p>
              <span className="hub-open">Abrir</span>
            </button>
            <button className="hub-card" onClick={() => { setView('app'); setStep(3) }}>
              <div className="hub-badge di">D</div>
              <h3>Dieta</h3>
              <p>Plano alimentar com macros reais (TACO).</p>
              <span className="hub-open">Abrir</span>
            </button>
            <button className="hub-card" onClick={() => { setView('app'); setStep(3); setResultTab('treinos') }}>
              <div className="hub-badge tr">T</div>
              <h3>Treinos</h3>
              <p>Divisão semanal com vídeos por exercício.</p>
              <span className="hub-open">Abrir</span>
            </button>
          </div>
          <div className="hub-banner">
            <div><b>Quer acompanhamento de verdade?</b><span>Conecte-se a um personal ou nutricionista que entende seu plano.</span></div>
            <button className="btn btn-primary" onClick={() => setView('home')}>Encontrar profissional</button>
          </div>
        </div>
      )}

      {view === 'app' && (
        <>
          {step === 1 && (
            <p className="hero-tagline">Avalie a composição corporal, gere o plano de dieta e o treino personalizado.</p>
          )}

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
            <div className={`step ${step === 3 ? 'now' : ''}`}>
              <div className="dot">3</div>
              <div className="step-label">Resultado</div>
            </div>
          </div>

          {step === 1 && (
            <div className="card">
              <h1>Vamos começar</h1>
              <p className="lede">Preencha os dados do cliente para gerar a análise corporal, o plano de dieta e o treino.</p>

              <label>Nome</label>
              <input data-field="name" className={inv('name')} value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="Nome do cliente" />

              <div className="row">
                <div>
                  <label>Idade</label>
                  <input data-field="age" className={inv('age')} type="number" value={form.age === 0 ? '' : form.age} onChange={(e) => set('age', Number(e.target.value))} placeholder="ex.: 30" />
                </div>
                <div>
                  <label>Sexo</label>
                  <select data-field="gender" className={inv('gender')} value={form.gender} onChange={(e) => set('gender', e.target.value)}>
                    <option value="">Selecione</option>
                    <option value="female">Feminino</option>
                    <option value="male">Masculino</option>
                  </select>
                </div>
              </div>

              <div className="row">
                <div>
                  <label>Peso (kg)</label>
                  <input data-field="weight" className={inv('weight')} type="number" value={form.weight === 0 ? '' : form.weight} onChange={(e) => set('weight', Number(e.target.value))} placeholder="ex.: 80" />
                </div>
                <div>
                  <label>Altura (cm)</label>
                  <input data-field="height" className={inv('height')} type="number" value={form.height === 0 ? '' : form.height} onChange={(e) => set('height', Number(e.target.value))} placeholder="ex.: 175" />
                </div>
              </div>

              <label>% de gordura corporal</label>
              <div data-field="fatChoice" className={`radio-group${invalid.includes('fatChoice') ? ' invalid' : ''}`} style={{ flexDirection: 'column', alignItems: 'flex-start' }}>
                <label className="radio">
                  <input type="radio" name="fatChoice" checked={knowsBodyFat === 'nao' && form.bodyFatEstimationMethod === 'deurenberg'} onChange={() => { setKnowsBodyFat('nao'); set('bodyFatEstimationMethod', 'deurenberg') }} />
                  Não sei, estimar pelo IMC
                </label>
                <label className="radio">
                  <input type="radio" name="fatChoice" checked={knowsBodyFat === 'nao' && form.bodyFatEstimationMethod === 'pollock3'} onChange={() => { setKnowsBodyFat('nao'); set('bodyFatEstimationMethod', 'pollock3') }} />
                  Não sei, estimar por dobras cutâneas
                </label>
                <label className="radio">
                  <input type="radio" name="fatChoice" checked={knowsBodyFat === 'sim'} onChange={() => { setKnowsBodyFat('sim'); set('bodyFatEstimationMethod', '') }} />
                  Sei meu valor
                </label>
              </div>

              {knowsBodyFat === 'sim' && (
                <>
                  <label>% Gordura Corporal</label>
                  <input
                    data-field="bodyFat"
                    className={inv('bodyFat')}
                    type="number"
                    value={form.bodyFat ?? ''}
                    onChange={(e) => set('bodyFat', e.target.value === '' ? undefined : Number(e.target.value))}
                    placeholder="ex.: 18"
                  />
                </>
              )}

              {knowsBodyFat === 'nao' && form.bodyFatEstimationMethod === 'pollock3' && (
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
              <select data-field="goal" className={inv('goal')} value={form.goal} onChange={(e) => set('goal', e.target.value as Goal)}>
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
                      data-field="prazo"
                      className={inv('prazo')}
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
                      data-field="metaKg"
                      className={inv('metaKg')}
                      type="number"
                      value={form.metaKg ?? ''}
                      onChange={(e) => set('metaKg', e.target.value === '' ? undefined : Number(e.target.value))}
                      placeholder="ex.: 5"
                    />
                  </div>
                </div>
              )}

              <label>Nível de atividade</label>
              <select data-field="activityLevel" className={inv('activityLevel')} value={form.activityLevel} onChange={(e) => set('activityLevel', e.target.value as ActivityLevel)}>
                <option value="">Selecione</option>
                <option value="sedentary">Sedentário</option>
                <option value="light">Leve (1-3x/semana)</option>
                <option value="moderate">Moderado (3-5x/semana)</option>
                <option value="active">Ativo (6-7x/semana)</option>
              </select>
              <p className="hint">Sua rotina atual de exercícios (não o plano).</p>

              <div className="actions">
                <button className="btn btn-ghost" onClick={() => goToStep(1)}>Voltar</button>
                <button className="btn btn-primary" onClick={onGenerate}>Continuar</button>
              </div>
            </div>
          )}

          {step === 3 && result && (
            <div className="card">
              <h1>Análise Corporal Prévia</h1>
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

              <div className="result-tabs">
                <button className={`rtab${resultTab === 'analises' ? ' active' : ''}`} onClick={() => setResultTab('analises')}>Análises</button>
                <button className={`rtab${resultTab === 'dieta' ? ' active' : ''}${aiContent ? '' : ' locked'}`} onClick={() => { if (aiContent) setResultTab('dieta') }}>Dieta</button>
                <button className={`rtab${resultTab === 'treinos' ? ' active' : ''}${strategyContent ? '' : ' locked'}`} onClick={() => { if (strategyContent) setResultTab('treinos') }}>Treinos</button>
              </div>

              {resultTab === 'analises' && (
              <>
              {/* Ato 1: engajar o cliente a entender o corpo a fundo */}
              {!aiContent && (
                <div className="engage">
                  <p className="engage-title">Isso é só uma prévia.</p>
                  <p className="engage-sub">Gere a análise completa para ver composição corporal, metabolismo, hormônios e o que os números significam para o cliente.</p>
                </div>
              )}

              {!aiContent && (
                <div className="actions secondary">
                  <button className="btn btn-secondary" onClick={onGenerateAI} disabled={aiLoading}>
                    {aiLoading ? 'Gerando...' : '1 Ver Análise Completa'}
                  </button>
                </div>
              )}

              {aiContent && (
                <div className="ai-result">
                  <h3 className="ai-title">Análise Completa</h3>
                  <div dangerouslySetInnerHTML={{ __html: renderRaioX(aiContent) }} />
                </div>
              )}

              {/* Ato 2: engajar o cliente em direção à meta */}
              {aiContent && (form.goal === 'emagrecimento' || form.goal === 'hipertrofia') && form.metaKg && (
                <div className="engage">
                  <p className="engage-title">
                    {form.goal === 'emagrecimento'
                      ? `Faltam ${form.metaKg}kg para a meta do cliente`
                      : `Faltam ${form.metaKg}kg de massa magra para a meta do cliente`}
                    {form.prazoMeses ? ` em ${form.prazoMeses} meses` : ''}.
                  </p>
                  <div className="engage-journey">
                    <span className="engage-now">{form.weight}kg hoje</span>
                    <span className="engage-arrow">→</span>
                    <span className="engage-goal">{form.goal === 'emagrecimento' ? form.weight - form.metaKg : form.weight + form.metaKg}kg meta</span>
                  </div>
                  <p className="engage-sub">Gere a estratégia de dieta e treino para o cliente alcançar a meta.</p>
                </div>
              )}

              {aiContent && (
                <div className="actions secondary">
                  <button className="btn btn-secondary" onClick={onGenerateStrategy}>
                    2 Gerar Estratégia para Meta
                  </button>
                </div>
              )}

              {strategyContent && (
                <div className="ai-result">
                  <h3 className="ai-title">Estratégia para Meta</h3>
                  <div dangerouslySetInnerHTML={{ __html: renderMarkdown(strategyContent) }} />
                </div>
              )}
              </>
              )}

              {resultTab === 'dieta' && (
              <>
              {strategyContent && (
                <div className="actions secondary">
                  <button className="btn btn-secondary" onClick={onGerarDieta} disabled={dietaLoading}>
                    {dietaLoading ? 'Gerando...' : 'Gerar Roteiro de Dieta'}
                  </button>
                </div>
              )}
              {!strategyContent && (
                <p className="hint">Gere a Estratégia para Meta para liberar a dieta.</p>
              )}

              {dietaContent && (
                <div className="ai-result">
                  <h3 className="ai-title">Roteiro de Dieta</h3>
                  <div dangerouslySetInnerHTML={{ __html: renderMarkdown(dietaContent) }} />
                </div>
              )}

              {dietaContent && (
              <div className="alimento-search">
                <h4 className="alimento-search-title">Buscar alimento (TACO — composição oficial)</h4>
                <div className="alimento-search-row">
                  <input
                    type="text"
                    value={alimentoQuery}
                    onChange={(e) => setAlimentoQuery(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') onSearchAlimentos() }}
                    placeholder="Ex.: frango, arroz, ovo, feijão..."
                  />
                  <button className="btn btn-secondary" onClick={onSearchAlimentos} disabled={alimentoSearching}>
                    {alimentoSearching ? 'Buscando...' : 'Buscar'}
                  </button>
                </div>
                {alimentoResults.length > 0 && (
                  <div className="alimento-results">
                    {alimentoResults.map((a) => (
                      <div key={a.id} className="alimento-item">
                        <div className="alimento-name">{a.descricao}</div>
                        <div className="alimento-macros">
                          {a.energia_kcal != null ? `${a.energia_kcal} kcal` : '—'} · P {a.proteina_g ?? 0}g · C {a.carboidrato_g ?? 0}g · G {a.lipideos_g ?? 0}g
                        </div>
                        <div className="alimento-cat">{a.categoria ?? ''}</div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              )}
              </>
              )}

              {resultTab === 'treinos' && (
              <>
              <h3 className="ai-title">Divisão de Treino</h3>

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

              <div className="save-bar">
                <button className="btn btn-primary" onClick={onSave} disabled={saving || pdfLoading}>
                  {pdfLoading ? 'Gerando PDF...' : saving ? 'Salvando...' : 'Salvar Roteiro'}
                </button>
              </div>
              {savedMsg && <div className="ok">{savedMsg}</div>}
              </>
              )}

              <div className="actions">
                <button className="btn btn-ghost" onClick={() => goToStep(2)}>Voltar</button>
              </div>

              <p className="legal">
                * Resultados gerados a partir de fórmulas padrão. Consulte um nutricionista ou médico antes de iniciar qualquer dieta.
              </p>
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

          {user && (
            <div className="dev-contact">
              <a className="btn btn-ghost" href="https://wa.me/5511967756822" target="_blank" rel="noopener noreferrer">Fale com desenvolvedor</a>
            </div>
          )}
        </div>
      )}

      {view === 'cadastro' && (
        <div className="card">
          <h1>Meu Cadastro</h1>
          {profile ? (
            <>
              <p className="lede">Seus dados cadastrais.</p>
              {profile.photo && <img className="profile-photo" src={profile.photo} alt={profile.fullName} />}
              <div className="profile-view">
                <p><strong>Nome:</strong> {profile.fullName}</p>
                <p><strong>Endereço:</strong> {profile.address}{profile.numero ? `, ${profile.numero}` : ''}</p>
                <p><strong>CEP:</strong> {profile.cep}</p>
                <p><strong>Bairro:</strong> {profile.neighborhood}</p>
                <p><strong>Cidade:</strong> {profile.city}{profile.uf ? ` - ${profile.uf}` : ''}</p>
                <p><strong>CPF:</strong> {profile.cpf}</p>
                <p><strong>WhatsApp:</strong> {profile.whatsapp}</p>
                {profile.instagram && <p><strong>Instagram:</strong> <a href={`https://instagram.com/${profile.instagram.replace(/^@/, '')}`} target="_blank" rel="noopener noreferrer">@{profile.instagram.replace(/^@/, '')}</a></p>}
              </div>
              <div className="actions">
                <button className="btn btn-primary" onClick={() => setProfileMode(true)}>Editar cadastro</button>
              </div>
            </>
          ) : (
            <>
              <p className="lede">Você ainda não completou seu cadastro.</p>
              <div className="actions">
                <button className="btn btn-primary" onClick={() => setProfileMode(true)}>Completar cadastro</button>
              </div>
            </>
          )}
        </div>
      )}

      <footer className="footer">
        <p>© 2026 Shape Informa. Todos os direitos reservados.</p>
        <p>
          Criado por{' '}
          <a href="https://www.linkedin.com/in/uebersonlsousa" target="_blank" rel="noopener noreferrer">
            Ueberson Sousa
          </a>
        </p>
        <p>As recomendações são geradas por IA e não substituem o conselho médico profissional.</p>
        <p>Estratégias de dieta e treino são sugestões e devem ser adaptadas individualmente, preferencialmente com acompanhamento profissional.</p>
        <p className="version">
          v{__APP_COMMIT__} - {new Date(__APP_BUILD_TIME__).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
        </p>
        {visits != null && (
          <p className="version">Acessos: {visits.toLocaleString('pt-BR')}</p>
        )}
      </footer>

      {viewing && (() => {
        const isFemale = form.gender === 'female'
        const v = isFemale ? (viewing.videoFemale || viewing.video) : viewing.video
        const p = isFemale ? (viewing.thumbFemale || viewing.thumb) : viewing.thumb
        return (
          <div className="modal-overlay" onClick={() => setViewing(null)}>
            <div className="modal" onClick={(e) => e.stopPropagation()}>
              <button className="modal-close" onClick={() => setViewing(null)} aria-label="Fechar">×</button>
              <h3>{viewing.name}</h3>
              <p className="tmeta">{viewing.muscle} / {viewing.equipment} <span className={`difficulty diff-${viewing.difficulty.toLowerCase()}`}>{viewing.difficulty}</span></p>
              <video className="ex-video" src={v} poster={p} controls autoPlay loop muted playsInline />
              {viewing.instructions && <p className="ex-instructions">{viewing.instructions}</p>}
            </div>
          </div>
        )
      })()}

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
              <button className="btn btn-primary" onClick={onLogin}>
                Entrar
              </button>
            </div>

            <p className="hint" style={{ textAlign: 'center', cursor: 'pointer' }} onClick={() => { setAuthMode(null); setShowSignup(true) }}>
              Não tem uma conta? Criar conta
            </p>
          </div>
        </div>
      )}

      {showSignup && (
        <div className="modal-overlay" onClick={() => setShowSignup(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <button className="modal-close" onClick={() => setShowSignup(false)} aria-label="Fechar">×</button>
            <h2 className="auth-title">Crie sua conta</h2>
            <p className="auth-sub">Crie seu login e complete seu cadastro para salvar seus dados.</p>

            <div className="auth-social">
              <button type="button" className="btn-social" onClick={onGoogle}>
                <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z"/><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C21.16 2.18 18.13 1 15.31 1 9.42 1 4.95 4.51 2.18 9.18l3.66 2.84C6.71 8.45 9.14 5.38 12 5.38z"/></svg>
                Continuar com Google
              </button>
            </div>
            <div className="auth-divider">ou com e-mail</div>

            <label>E-mail</label>
            <input type="email" value={authEmail} onChange={(e) => setAuthEmail(e.target.value)} placeholder="seu@email.com" />
            <label>Senha</label>
            <input type="password" value={authPassword} onChange={(e) => setAuthPassword(e.target.value)} placeholder="••••••" />

            <div className="photo-upload">
              {pf.photo ? (
                <img className="photo-preview" src={pf.photo} alt="Sua foto" />
              ) : (
                <div className="photo-preview photo-empty">Sem foto</div>
              )}
              <div className="photo-actions">
                <label className="btn btn-ghost">
                  {pf.photo ? 'Trocar foto' : 'Adicionar foto'}
                  <input type="file" accept="image/*" onChange={onPhotoChange} style={{ display: 'none' }} />
                </label>
                {pf.photo && (
                  <button type="button" className="btn btn-ghost" onClick={() => setPf((p) => ({ ...p, photo: '' }))}>Remover</button>
                )}
              </div>
            </div>

            <div className="row">
              <div>
                <label>Nome</label>
                <input value={pf.firstName} onChange={(e) => setPf((p) => ({ ...p, firstName: e.target.value }))} placeholder="Seu nome" />
              </div>
              <div>
                <label>Sobrenome</label>
                <input value={pf.lastName} onChange={(e) => setPf((p) => ({ ...p, lastName: e.target.value }))} placeholder="Seu sobrenome" />
              </div>
            </div>
            <label>CEP</label>
            <input value={pf.cep} onChange={(e) => onCepChange(e.target.value)} placeholder="00000-000" />
            <label>Endereço</label>
            <input value={pf.address} onChange={(e) => setPf((p) => ({ ...p, address: e.target.value }))} placeholder="Rua" />
            <label>Número</label>
            <input value={pf.numero} onChange={(e) => setPf((p) => ({ ...p, numero: e.target.value }))} placeholder="123" />
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
            <label>CPF (opcional)</label>
            <input value={pf.cpf} onChange={(e) => setPf((p) => ({ ...p, cpf: e.target.value }))} placeholder="000.000.000-00" />
            <label>Contato (WhatsApp)</label>
            <input value={pf.whatsapp} onChange={(e) => setPf((p) => ({ ...p, whatsapp: e.target.value }))} placeholder="(11) 90000-0000" />
            <label>Instagram (opcional)</label>
            <input value={pf.instagram} onChange={(e) => setPf((p) => ({ ...p, instagram: e.target.value }))} placeholder="@seu.perfil" />
            <label className="radio" style={{ marginTop: 14 }}>
              <input type="checkbox" checked={pf.termsAccepted} onChange={(e) => setPf((p) => ({ ...p, termsAccepted: e.target.checked }))} />
              Aceito os termos de uso
            </label>

            <div className="actions">
              <button className="btn btn-primary" onClick={onSignupComplete}>Criar conta e continuar</button>
            </div>
          </div>
        </div>
      )}

      {profileMode && (
        <div className="modal-overlay" onClick={() => setProfileMode(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <button className="modal-close" onClick={() => setProfileMode(false)} aria-label="Fechar">×</button>
            <h3>{profile ? 'Meus dados' : 'Complete seu cadastro'}</h3>
            <div className="photo-upload">
              {pf.photo ? (
                <img className="photo-preview" src={pf.photo} alt="Sua foto" />
              ) : (
                <div className="photo-preview photo-empty">Sem foto</div>
              )}
              <div className="photo-actions">
                <label className="btn btn-ghost">
                  {pf.photo ? 'Trocar foto' : 'Adicionar foto'}
                  <input type="file" accept="image/*" onChange={onPhotoChange} style={{ display: 'none' }} />
                </label>
                {pf.photo && (
                  <button type="button" className="btn btn-ghost" onClick={() => setPf((p) => ({ ...p, photo: '' }))}>Remover</button>
                )}
              </div>
            </div>
            <div className="row">
              <div>
                <label>Nome</label>
                <input value={pf.firstName} onChange={(e) => setPf((p) => ({ ...p, firstName: e.target.value }))} placeholder="Seu nome" />
              </div>
              <div>
                <label>Sobrenome</label>
                <input value={pf.lastName} onChange={(e) => setPf((p) => ({ ...p, lastName: e.target.value }))} placeholder="Seu sobrenome" />
              </div>
            </div>
            <label>CEP</label>
            <input value={pf.cep} onChange={(e) => onCepChange(e.target.value)} placeholder="00000-000" />
            <label>Endereço</label>
            <input value={pf.address} onChange={(e) => setPf((p) => ({ ...p, address: e.target.value }))} placeholder="Rua" />
            <label>Número</label>
            <input value={pf.numero} onChange={(e) => setPf((p) => ({ ...p, numero: e.target.value }))} placeholder="123" />
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
            <label>CPF (opcional)</label>
            <input value={pf.cpf} onChange={(e) => setPf((p) => ({ ...p, cpf: e.target.value }))} placeholder="000.000.000-00" />
            <label>Contato (WhatsApp)</label>
            <input value={pf.whatsapp} onChange={(e) => setPf((p) => ({ ...p, whatsapp: e.target.value }))} placeholder="(11) 90000-0000" />
            <label>Instagram (opcional)</label>
            <input value={pf.instagram} onChange={(e) => setPf((p) => ({ ...p, instagram: e.target.value }))} placeholder="@seu.perfil" />
            <label className="radio" style={{ marginTop: 14 }}>
              <input type="checkbox" checked={pf.termsAccepted} onChange={(e) => setPf((p) => ({ ...p, termsAccepted: e.target.checked }))} />
              Aceito os termos de uso
            </label>
            <p className="hint">Ao usar o Shape Informa você concorda com os termos de uso e a política de privacidade.</p>
            <div className="actions">
              <button className="btn btn-primary" onClick={onSaveProfile}>{profile ? 'Salvar alterações' : 'Concluir cadastro'}</button>
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

      {showRestricao && (
        <div className="modal-overlay" onClick={() => setShowRestricao(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <button className="modal-close" onClick={() => setShowRestricao(false)} aria-label="Fechar">×</button>
            <h3>Verificação de Restrições / Alergias</h3>
            <p className="auth-sub">Informe as restrições do cliente para que a dieta as respeite.</p>
            <label>Restrições / alergias</label>
            <input value={form.restrictions} onChange={(e) => set('restrictions', e.target.value)} placeholder="ex.: lactose, glúten, amendoim" />
            <p className="hint">Deixe em branco se o cliente não tiver restrições.</p>
            <div className="actions">
              <button className="btn btn-ghost" onClick={() => setShowRestricao(false)}>Cancelar</button>
              <button className="btn btn-primary" onClick={() => { setShowRestricao(false); setShowCaneta(true) }}>Confirmar e continuar</button>
            </div>
          </div>
        </div>
      )}

      {showCaneta && (
        <div className="modal-overlay" onClick={() => setShowCaneta(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <button className="modal-close" onClick={() => setShowCaneta(false)} aria-label="Fechar">×</button>
            <h3>Uso de Caneta Emagrecedora</h3>
            <p className="auth-sub">Avaliação para dieta específica de quem usa análogos de GLP-1/GIP.</p>

            <label className="radio">
              <input type="radio" name="usaCaneta" checked={!caneta.usa} onChange={() => setCaneta((c) => ({ ...c, usa: false }))} />
              Não usa caneta
            </label>
            <label className="radio">
              <input type="radio" name="usaCaneta" checked={caneta.usa} onChange={() => setCaneta((c) => ({ ...c, usa: true }))} />
              Usa caneta emagrecedora
            </label>

            {caneta.usa && (
              <>
                <label>Substância</label>
                <select value={caneta.substancia} onChange={(e) => setCaneta((c) => ({ ...c, substancia: e.target.value as CanetaSubstancia, dosagem: '' }))}>
                  <option value="">Selecione</option>
                  <option value="semaglutida">{CANETA_LABELS.semaglutida}</option>
                  <option value="tirzepatida">{CANETA_LABELS.tirzepatida}</option>
                  <option value="liraglutida">{CANETA_LABELS.liraglutida}</option>
                </select>

                {caneta.substancia && (
                  <>
                    <label>Dosagem atual</label>
                    <select value={caneta.dosagem} onChange={(e) => setCaneta((c) => ({ ...c, dosagem: e.target.value }))}>
                      <option value="">Selecione</option>
                      {CANETA_DOSES[caneta.substancia].map((d) => <option key={d} value={d}>{d}</option>)}
                    </select>
                  </>
                )}

                <label>Fase do ciclo</label>
                <select value={caneta.ciclo} onChange={(e) => setCaneta((c) => ({ ...c, ciclo: e.target.value as CanetaCiclo }))}>
                  <option value="">Selecione</option>
                  <option value="titulacao">Titulação (subindo dose)</option>
                  <option value="manutencao">Manutenção (dose alvo)</option>
                  <option value="desmame">Desmame (reduzindo dose)</option>
                </select>
              </>
            )}

            <div className="actions">
              <button className="btn btn-ghost" onClick={() => setShowCaneta(false)}>Voltar</button>
              <button className="btn btn-primary" onClick={onConfirmCaneta}>Gerar Roteiro de Dieta</button>
            </div>
          </div>
        </div>
      )}

      <div id="pdf-content" className="pdf-hidden" aria-hidden="true">
        <div style={{ fontFamily: 'Sora, sans-serif', color: '#111', fontSize: 13 }}>
          <h1 style={{ fontSize: 22, margin: '0 0 4px' }}>Shape Informa</h1>
          <p style={{ color: '#555', margin: '0 0 16px' }}>Análise Corporal - {form.name}, {calcCode}, {new Date().toLocaleDateString('pt-BR')}</p>
          {result && (
            <>
              <h2 style={{ fontSize: 16, borderBottom: '1px solid #ccc', paddingBottom: 4 }}>Análise Corporal Prévia</h2>
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
          {aiContent && <><h2 style={{ fontSize: 16, borderBottom: '1px solid #ccc', paddingBottom: 4, marginTop: 16 }}>Análise Corporal Completa</h2><div style={{ fontSize: 12 }} dangerouslySetInnerHTML={{ __html: renderRaioX(aiContent) }} /></>}
          {strategyContent && <><h2 style={{ fontSize: 16, borderBottom: '1px solid #ccc', paddingBottom: 4, marginTop: 16 }}>Estratégia para Meta</h2><div style={{ fontSize: 12 }} dangerouslySetInnerHTML={{ __html: renderMarkdown(strategyContent) }} /></>}
          {dietaContent && <><h2 style={{ fontSize: 16, borderBottom: '1px solid #ccc', paddingBottom: 4, marginTop: 16 }}>Roteiro de Dieta</h2><div style={{ fontSize: 12 }} dangerouslySetInnerHTML={{ __html: renderMarkdown(dietaContent) }} /></>}
          {training && <><h2 style={{ fontSize: 16, borderBottom: '1px solid #ccc', paddingBottom: 4, marginTop: 16 }}>Roteiro de Treinos</h2>{form.duracaoTreino && <p>Duração: {form.duracaoTreino} min por sessão</p>}{training.days.map((d, i) => <div key={i} style={{ marginTop: 10 }}><h3 style={{ fontSize: 14, margin: '0 0 4px' }}>{d.name}</h3><ul style={{ margin: '0 0 0 18px', padding: 0 }}>{d.exercises.map((e, j) => <li key={j} style={{ margin: '2px 0' }}>{e.name} - {e.sets} séries de {e.reps}{e.rest ? `, descanso ${e.rest}` : ''}</li>)}</ul></div>)}</>}
        </div>
      </div>
    </div>
  )
}
