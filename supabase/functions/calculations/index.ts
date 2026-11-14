// Edge Function 'calculations' — Body And Health (corpointeligente)
import { createClient } from 'npm:@supabase/supabase-js@2';

const SUPABASE_URL = 'https://ylmwwwtnqhqjtufqmctf.supabase.co';
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlsbXd3d3RucWhxanR1ZnFtY3RmIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NjA1MDYyNSwiZXhwIjoyMDkxNjI2NjI1fQ.Pt4N59ohX0wc-wJqSV46cQxFaFCdl9-Q-_G9z0G7UJ4';

const DEEPSEEK_KEY = atob('c2stMTE5MWVhZTc5ODcyNDE0MGE1YTgwNDc3MTFmYTIyMDg=');

const SYSTEM_PROMPT = 'Você é um excelente nutrólogo esportivo com vasto conhecimento em hipertrofia, emagrecimento, condicionamento físico e reposição hormonal, além de preparador físico de atletas. Você entrega informações relevantes com alta clareza. Responda SEMPRE em português do Brasil.';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

const CAMEL_TO_SNAKE: Record<string, string> = {
  userId: 'user_id', calculationCode: 'calculation_code', bodyFat: 'body_fat',
  bodyFatEstimationMethod: 'body_fat_estimation_method', activityLevel: 'activity_level',
  savedAt: 'created_at', trainingProgram: 'training_program',
  fullName: 'full_name', termsAccepted: 'terms_accepted',
};
const SNAKE_TO_CAMEL: Record<string, string> = {
  user_id: 'userId', calculation_code: 'calculationCode', body_fat: 'bodyFat',
  body_fat_estimation_method: 'bodyFatEstimationMethod', activity_level: 'activityLevel',
  created_at: 'savedAt', training_program: 'trainingProgram',
  full_name: 'fullName', terms_accepted: 'termsAccepted',
};
const toDbRow = (o: Record<string, unknown>) => {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(o)) { if (v === undefined) continue; out[CAMEL_TO_SNAKE[k] ?? k] = v; }
  return out;
};
const toCamelRow = (r: Record<string, unknown>) => {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(r)) { out[SNAKE_TO_CAMEL[k] ?? k] = v; }
  return out;
};

async function callDeepSeek(userPrompt: string): Promise<string> {
  const res = await fetch('https://api.deepseek.com/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + DEEPSEEK_KEY },
    body: JSON.stringify({
      model: 'deepseek-chat',
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userPrompt },
      ],
      temperature: 0.7,
      max_tokens: 3000,
    }),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error('DeepSeek HTTP ' + res.status + ': ' + t.slice(0, 200));
  }
  const data = await res.json();
  return data.choices[0].message.content;
}

function parseJson(content: string): unknown {
  let t = content.trim();
  t = t.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
  const start = t.indexOf('{');
  const end = t.lastIndexOf('}');
  if (start === -1 || end === -1) throw new Error('Resposta sem JSON válido');
  return JSON.parse(t.slice(start, end + 1));
}

const GOAL_PT: Record<string, string> = { emagrecimento: 'Emagrecimento (perda de gordura)', hipertrofia: 'Hipertrofia (ganho de massa muscular)', saude: 'Saúde (manutenção de peso)' };
const ACT_PT: Record<string, string> = { sedentary: 'sedentário', light: 'levemente ativo (1-3x/semana)', moderate: 'moderadamente ativo (3-5x/semana)', active: 'ativo (6-7x/semana)' };

function metaTexto(d: any): string {
  const prazo = d.prazoMeses ? Number(d.prazoMeses) : 0;
  const meta = d.metaKg ? Number(d.metaKg) : 0;
  if (d.goal === 'hipertrofia') return `Ganhar ${meta}kg de massa magra em ${prazo} meses`;
  if (d.goal === 'emagrecimento') return `Perder ${meta}kg em ${prazo} meses`;
  return 'Manutenção de peso';
}

function buildRaioXPrompt(d: any): string {
  const gender = d.gender === 'male' ? 'masculino' : 'feminino';
  const bodyFat = d.bodyFat != null ? d.bodyFat + '%' : 'não informado';
  const restrictions = (d.restrictions && String(d.restrictions).trim()) ? d.restrictions : 'nenhuma';
  const nome = (d.name && String(d.name).trim()) ? d.name : 'cliente';
  const r = d.results ?? {};
  return `Vamos realizar um Raio X corporal com cálculo para o seguinte cliente:\n\n!CLIENTE:\n- Nome: ${nome}\n- Sexo: ${gender}\n- Idade: ${d.age} anos\n- Peso: ${d.weight} kg\n- Altura: ${d.height} cm\n- % Gordura Corporal: ${bodyFat}\n- Nível de Atividade: ${ACT_PT[d.activityLevel] ?? d.activityLevel}\n- Objetivo: ${GOAL_PT[d.goal] ?? d.goal}\n- Meta: ${metaTexto(d)}\n- Restrições: ${restrictions}\n\nCom base nesses dados, calcule e monte a tabela:\n\n!CALCULAR:\n- TMB (Harris-Benedict: mulher 655 + 9,6*peso + 1,8*altura - 4,7*idade | homem 66 + 13,7*peso + 5*altura - 6,8*idade)\n- GCT = TMB × fator de atividade (sedentário 1,2 | leve 1,375 | moderado 1,55 | ativo 1,725)\n- IMC (com classificação) e PGC (% gordura, com interpretação)\n- Macros: Proteína 1,6-2,2g/kg (emagrecimento) ou 2,2-2,5g/kg (hipertrofia); Gorduras 20-30% das calorias; Carbs = restante\n- Suplementação necessária\n- Consumo de água (35ml/kg + 500ml/h de treino)\n- Tipo de treino e frequência (incluir cardio ao final dos treinos de força)\n\nValores de referência já calculados (use como base):\n- IMC: ${r.imc ?? '—'}\n- TMB: ${r.tmb ?? '—'} kcal\n- GCT: ${r.gct ?? '—'} kcal\n- Meta calórica: ${r.calorieTarget ?? '—'} kcal\n- Macros: Proteína ${r.protein ?? '—'}g, Carbs ${r.carbs ?? '—'}g, Gorduras ${r.fat ?? '—'}g\n- Água: ${r.water ?? '—'} L\n\n!ESTRUTURA DE SAÍDA (obrigatória):\nTabela markdown SEM TÍTULO (comece direto na tabela, sem linha de título acima), com colunas:\n| Parâmetro | Cálculo/Resultado | Interpretação | Observação |\n\nLinhas obrigatórias (nesta ordem):\n1. IMC\n2. Massa Magra Estimada\n3. % Gordura Corporal (PGC)\n4. Taxa Metabólica Basal (TMB)\n5. Gasto Calórico Total (GCT)\n6. Novo Consumo Calórico (meta)\n7. Distribuição de Macros\n8. Suplementação\n9. Consumo de Água\n10. Treino (frequência + cardio)\n11. Saúde Hormonal (recomendar exame para verificar hormônios)\n\n!PERSONALIZAR (obrigatório):\n- Chame o cliente pelo nome (${nome}) na coluna Interpretação e na coluna Observação.\n- Relacione cada recomendação ao objetivo e à meta (${metaTexto(d)}): seja específico (cite alimentos, exercícios e hábitos concretos).\n- NUNCA use conselhos genéricos como "coma menos e se mexa mais" ou "beba mais água". Diga exatamente o que ${nome} deve fazer.\n- Destaque o que muda na prática para ${nome} chegar à meta.\n\n!VALIDAR:\n- Se déficit > 25%, apresentar "déficit seguro" e "déficit solicitado"\n- Se proteína < 1,2g/kg, alertar e ajustar\n- Classificar IMC e % gordura por sexo\n\nIMPORTANTE: cada linha em UMA única linha da tabela, sem quebras de linha dentro das células (separe valores com '•' ou ';').\n\nResponda SOMENTE com a tabela markdown (sem texto antes ou depois, sem título).`;
}

function buildStrategyPrompt(d: any): string {
  const r = d.results ?? {};
  const gender = d.gender === 'male' ? 'masculino' : 'feminino';
  const goal = GOAL_PT[d.goal] ?? d.goal;
  const balanco = r.deficit != null ? `Déficit de ${r.deficit} kcal/dia` : (d.goal === 'hipertrofia' ? 'Superávit de 250 kcal/dia' : 'Manutenção calórica');
  const freq = d.activityLevel === 'active' ? '5-6x/semana' : d.activityLevel === 'moderate' ? '4-5x/semana' : '3-4x/semana';
  const prazo = d.prazoMeses ? Number(d.prazoMeses) : 0;
  const semanas = prazo > 0 ? prazo * 4 : 16;
  return `Agora elabore a ESTRATÉGIA MACRO: DIETA + TREINO com base no Raio X Corporal deste cliente:\n\n!CLIENTE_RAIOX:\n- Código: ${d.calculationCode ?? 'CODE'}\n- Sexo: ${gender} | Idade: ${d.age} anos | Peso: ${d.weight} kg | Altura: ${d.height} cm\n- Objetivo: ${goal}\n- Prazo: ${prazo > 0 ? prazo + ' meses (' + semanas + ' semanas)' : 'não informado'}\n- Meta: ${metaTexto(d)}\n- Meta Calórica: ${r.calorieTarget ?? '—'} kcal/dia\n- Proteína: ${r.protein ?? '—'} g/dia\n- Carbs Base: ${r.carbs ?? '—'} g/dia\n- Gorduras: ${r.fat ?? '—'} g/dia\n- Balanço: ${balanco}\n- Frequência de Treino sugerida: ${freq}\n\nCrie UMA tabela markdown SEM TÍTULO (comece direto na tabela, sem linha de título acima) com colunas:\n| Fase | Semanas | Dieta (kcal, proteínas, gorduras, carbs) | Divisão Treino | Recomendação | Objetivo | Monitoramento | Observação |\n\nDefina as fases conforme o prazo (${semanas} semanas, aproximadamente 4 semanas por fase). Para 12 semanas use 3 fases (Adaptação 1-4, Otimização 5-8, Definição 9-12). Para 16 semanas use 4 fases (Adaptação 1-4, Otimização 5-8, Força 9-12, Definição 13-16). Ajuste o número de fases ao total de semanas.\n\nRegras:\n- A dieta de cada fase usa a Meta Calórica aplicando variação de kcal conforme a fase e o objetivo (basear carbs nos valores do RAIO X CORPORAL).\n- A meta (${metaTexto(d)}) deve orientar o déficit/superávit e a progressão das fases.\n- Divisão de treino integrando força e cardio no mesmo dia (Full-body, Upper/Lower, Push/Pull/Legs conforme o objetivo).\n- Totalizadores automáticos: "Total kcal/dia" considerando a meta calórica e o volume das fases.\n\n!VALIDAR:\n1. Proteína mínima: 2,0g/kg (hipertrofia) ou 1,6g/kg (emagrecimento); se menor, corrija.\n2. Carbs mínimo 100g/dia (evitar cetose não intencional); priorizar carbs complexos (>50%).\n3. Frequência de treino mínima conforme a atividade informada.\n4. Volume semanal: 12-20 séries por grupo muscular.\n\nIMPORTANTE: cada fase em UMA única linha da tabela, sem quebras de linha dentro das células (separe valores com '•' ou ';').\n\nResponda SOMENTE com a tabela markdown (sem texto antes ou depois, sem título).`;
}

const EXERCISES_BY_MUSCLE: Record<string, string> = {
  'Peito': 'Supino reto com barra; Supino declinado com barra; Supino inclinado com barra; Supino declinado com halteres; Crucifixo declinado com halteres; Crucifixo reto com halteres; Supino inclinado com halteres; Crucifixo inclinado com halteres; Supino inclinado neutro com halteres; Supino reto neutro com halteres; Crucifixo no cabo; Crucifixo no cabo deitado; Supino inclinado na máquina; Supino reto na máquina',
  'Costas': 'Encolhimento com barra; Remada curvada supinada com barra; Remada deitado com barra curva; Remada curvada com halteres; Remada inclinada neutra com halteres; Remada inclinada com halteres; Encolhimento inclinado com halteres; Remada deitado para deltoide posterior; Encolhimento com halteres; Extensão lombar 45°; Puxada frente pegada fechada; Puxada unilateral no cabo; Remada sentado unilateral com rotação; Puxada frente no cabo',
  'Ombros': 'Elevação frontal com barra; Elevação posterior com barra; Desenvolvimento nuca com barra; Remada alta com barra; Desenvolvimento militar; Desenvolvimento alternado com halteres; Desenvolvimento Arnold; Elevação frontal com halteres; Elevação lateral posterior inclinada; Elevação lateral com halteres; Elevação lateral unilateral; Remada para deltoide posterior; Elevação frontal sentado; Elevação lateral sentado',
  'Bíceps': 'Rosca direta com barra; Rosca arrastada com barra; Rosca inclinada pronada; Rosca alternada com halteres; Rosca concentrada; Rosca martelo cruzada; Rosca inclinada com halteres; Rosca inclinada; Rosca martelo inclinada; Rosca Zottman unilateral no banco; Rosca inclinada pronada com halteres; Rosca de punho neutra sentado; Rosca scott com halteres; Rosca alternada sentado',
  'Tríceps': 'Supino fechado com barra; Supino fechado com halteres; Extensão de tríceps inclinada; Coice com halteres; Extensão de tríceps deitado alternado; Extensão de tríceps deitado; Extensão de tríceps unilateral; Extensão de tríceps pronada; Coice sentado; Extensão de tríceps sentado; Extensão de tríceps deitado no cabo; Extensão de tríceps com corda; Tríceps na corda; Tríceps unilateral no cabo',
  'Quadríceps': 'Agachamento livre; Arremesso e desenvolvimento; Agachamento frontal; Agachamento goblet; Leg press pés juntos; Leg press horizontal; Cadeira extensora; Leg press 45° aberto; Agachamento no smith; Leg press no smith; Agachamento sissy com peso; Subida no banco com salto; Agachamento',
  'Posterior': 'Stiff com barra; Flexora com halteres; Stiff unilateral com halteres; Flexora ajoelhado; Flexora deitado; Flexora sentado',
  'Glúteos': 'Afundo com barra; Levantamento terra com halteres; Afundo com halteres; Agachamento unilateral com halteres; Agachamento com halteres; Stiff com halteres; Agachamento sumô com halteres; Hiperextensão reversa na máquina; Abdutora na máquina; Adutora na máquina; Extensão de quadril na máquina; Chute para trás na máquina; Elevação de pernas deitado; Ponte declinada',
  'Panturrilha': 'Panturrilha sentado com halteres; Panturrilha unilateral com halteres; Panturrilha em pé com halteres; Panturrilha sentado na máquina; Panturrilha em pé na máquina; Panturrilha no smith; Panturrilha burrinho',
  'Core': 'Flexão lateral com halteres; Abdominal ajoelhado no cabo; Abdominal em pé no cabo; Elevação em pé no cabo; Torção no cabo; Extensão lombar na máquina; Abdominal sentado na máquina; Abdominal com peso e pernas estendidas; Abdominal bicicleta 45°; Abdominal no banco; Elevação de pernas na barra; Elevação de pernas estendidas na barra; Elevação de pernas inclinado; Elevação de pernas deitado',
  'Antebraço': 'Rosca de punho invertida com barra; Rosca de punho invertida em pé; Rosca de punho atrás das costas; Rosca de punho no banco',
  'Cardio': 'Elíptico; Bicicleta ergométrica; Esteira (corrida); Burpee; Exercício cardiovascular; Polichinelo; Corrida',
};

function buildTrainingPrompt(d: any): string {
  const goal = GOAL_PT[d.goal] ?? d.goal;
  const gender = d.gender === 'male' ? 'masculino' : 'feminino';
  const freqDays: Record<string, number> = { sedentary: 3, light: 3, moderate: 4, active: 5 };
  const days = freqDays[d.activityLevel] ?? 4;
  const exerciseList = Object.entries(EXERCISES_BY_MUSCLE)
    .map(([m, names]) => m + ': ' + names)
    .join('\n');
  return `Monte o programa de treino semanal deste cliente:\n\n!CLIENTE:\n- Sexo: ${gender} | Idade: ${d.age} anos | Peso: ${d.weight} kg | Altura: ${d.height} cm\n- Objetivo: ${goal}\n- Nível de atividade: ${ACT_PT[d.activityLevel] ?? d.activityLevel}\n- Frequência de treino: ${days}x/semana\n- Meta: ${metaTexto(d)}\n\nRegras:\n- Defina uma divisão de treino coerente com o objetivo e a frequência (ex.: Upper/Lower, Push/Pull/Legs ou divisão por grupo muscular).\n- ${days} dias de treino, com 4 a 6 exercícios por dia.\n- Cada exercício: nome (APENAS da lista abaixo, exatamente como escrito), séries, repetições e descanso.\n- Exercícios compostos no início do treino, isoladores no final.\n- Hipertrofia: 3-4 séries de 8-12 reps. Emagrecimento: séries de 10-15 reps e incluir cardio ao final.\n\n!LISTA DE EXERCÍCIOS DISPONÍVEIS (use APENAS estes nomes, exatamente como estão):\n${exerciseList}\n\nResponda SOMENTE com um JSON válido (sem markdown, sem texto antes ou depois), no formato:\n{\n  "split": "nome da divisão (ex.: Superiores/Inferiores 4x)",\n  "days": [\n    { "name": "Dia 1 - Peito e Tríceps", "exercises": [ { "name": "Supino reto com barra", "sets": 4, "reps": "8-10", "rest": "90s" } ] }\n  ]\n}`;
}

function buildDietaPrompt(d: any): string {
  const nome = (d.name && String(d.name).trim()) ? d.name : 'cliente';
  const m = d.macros ?? {};
  const caneta = d.caneta ?? {};
  const restrictions = (d.restrictions && String(d.restrictions).trim()) ? d.restrictions : 'nenhuma';
  const goal = GOAL_PT[d.goal] ?? d.goal;
  const meta = metaTexto(d);

  const canetaBloco = caneta.usa
    ? `\n\n!USO DE CANETA EMAGRECEDORA (ANÁLOGO GLP-1/GIP):\n- Substância: ${caneta.substancia ?? ''}\n- Dosagem atual: ${caneta.dosagem ?? ''}\n- Fase do ciclo: ${caneta.ciclo ?? ''}\n\nAPLIQUE A METODOLOGIA CLÍNICA PARA CANETAS:\n1. PROTEÍNA É PRIORIDADE #1: preservar massa magra (25-40% do peso perdido vira músculo sem aporte proteico adequado).\n2. Refeições fracionadas (5-6x/dia) em porções pequenas (200-250g por tomada) — a gastroparesia induzida reduz o volume tolerado.\n3. PERIODIZAÇÃO SEMANAL (canetas semanais): Dias 1-2 pós-aplicação = líquidos/pastosos (shakes proteicos, sopas batidas); Dias 3-4 = sólidos brandos (frango desfiado, peixe cozido, purês); Dias 5-7 = sólido pleno.\n4. Evitar refeições gordurosas (agravam gastroparesia/refluxo) e excesso de fibras insolúveis cruas.\n5. Hidratação obrigatória ${m.aguaMl ?? ''} mL/dia + eletrólitos (500-1000mg sódio, 200-400mg potássio).\n6. Não descer abaixo do piso calórico de ${m.pisoCalorico ?? ''} kcal/dia.\n7. Priorizar fontes proteicas líquidas/semissólidas se houver intolerância a sólidos (whey isolado, clara pasteurizada, iogurte grego desnatado, tofu macio).`
    : '';

  return `Elabore o ROTEIRO NUTRICIONAL (dieta) deste cliente, associado à meta estabelecida:\n\n!CLIENTE:\n- Nome: ${nome}\n- Objetivo: ${goal}\n- Meta: ${meta}\n- Restrições/alergias: ${restrictions}\n\n!MACROS JÁ CALCULADOS (respeite estes números):\n- Calorias/dia: ${m.calorias ?? '—'} kcal\n- Proteína: ${m.proteinaG ?? '—'} g/dia (${m.proteinaGkg ?? '—'} g/kg)\n- Carboidratos: ${m.carbG ?? '—'} g/dia (${Math.round((m.carbPct ?? 0) * 100)}%)\n- Gorduras: ${m.gorduraG ?? '—'} g/dia (${Math.round((m.gorduraPct ?? 0) * 100)}%)\n- Água: ${m.aguaMl ?? '—'} mL/dia${canetaBloco}\n\n!TAREFA:\nMonte o dia completo (café da manhã, lanche da manhã, almoço, lanche da tarde, jantar e ceia se necessário) como JSON.\n\nREGRAS:\n- RESPEITE AS RESTRIÇÕES/ALERGIAS (${restrictions}) — não sugira alimentos proibidos.\n- Distribua a proteína em doses de 25-40g por refeição (gatilho de leucina para preservar massa magra).\n- Os totais do dia devem se aproximar das macros fornecidas.\n- PERSONALIZE: chame o cliente pelo nome (${nome}) e relacione as refeições à meta (${meta}).\n- NUNCA use conselhos genéricos.\n\n!NOMES DOS ALIMENTOS (IMPORTANTE — os macros serão calculados a partir da tabela TACO):\nUse nomes SIMPLES, ESPECÍFICOS e próximos da nomenclatura de tabela de composição brasileira. Exemplos:\n- \"frango, peito, sem pele, grelhado\" (NÃO \"frango grelhado\")\n- \"arroz, tipo 1, cozido\" (NÃO \"arroz branco\")\n- \"ovo, de galinha, inteiro, cozido\" (NÃO \"ovos mexidos\")\n- \"feijão, carioca, cozido\" (NÃO só \"feijão\")\n- \"batata, doce, cozida\" (NÃO \"batata doce\")\n- \"leite, de vaca, desnatado\" (NÃO \"leite desnatado\")\nInforme a quantidade em gramas (peso do alimento pronto/cozido).\nNÃO liste água, sal ou temperos como alimentos — a hidratação é calculada separadamente.\n\n!ATINJA A META (crítico — não use porções pequenas):\nA meta é ${m.calorias ?? '—'} kcal, ${m.proteinaG ?? '—'}g proteína, ${m.carbG ?? '—'}g carbo e ${m.gorduraG ?? '—'}g gordura por dia. Para atingi-la:\n- Almoço e jantar: 150-250g de proteína animal (frango/carne/peixe) + 150-200g de carboidrato (arroz/batata/feijão).\n- Café da manhã: 2-4 ovos + uma fonte de carboidrato.\n- Lanches: 150-250 kcal cada (iogurte, fruta, castanha, pão, shake).\n- Gordura: adicione 5-10ml de azeite e 10-20g de castanha/amendoim para atingir ${m.gorduraG ?? '—'}g de gordura.\n- Ao final, some mentalmente os QUATRO macros: se qualquer um ficar ABAIXO da meta, AUMENTE a fonte correspondente (proteína → mais carne/frango/ovo; gordura → mais azeite/castanha; carbo → mais arroz/batata) até se aproximar.\n- Não economize nas porções — a meta é o alvo a atingir, não um teto máximo.\n\nResponda SOMENTE com JSON válido (sem markdown, sem texto antes ou depois), neste formato:\n{\n  \"refeicoes\": [\n    { \"nome\": \"Café da manhã\", \"horario\": \"07:00\", \"alimentos\": [ { \"descricao\": \"ovo, de galinha, inteiro, cozido\", \"quantidade_g\": 100 } ], \"observacao\": \"...\" }\n  ]\n}`;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

const STOPWORDS = new Set(['de', 'da', 'do', 'dos', 'das', 'com', 'sem', 'em', 'e', 'a', 'o', 'as', 'os', 'na', 'no', 'ao', 'aos', 'para', 'por']);

const GENDER_MAP: Record<string, string> = {
  grelhada: 'grelhado', grelhadas: 'grelhado', cozida: 'cozido', cozidas: 'cozido',
  frita: 'frito', fritas: 'frito', crua: 'cru', cruas: 'cru', assada: 'assado', assadas: 'assado',
  desnatada: 'desnatado', desnatadas: 'desnatado', inteira: 'inteiro', inteiras: 'inteiro',
};
const SYNONYM_MAP: Record<string, string> = {
  mexido: 'frito', mexidos: 'frito', mexida: 'frito', mexidas: 'frito',
  ovos: 'ovo', para: 'brasil', file: 'filé',
};

function canonToken(t: string): string {
  return SYNONYM_MAP[t] ?? GENDER_MAP[t] ?? t;
}

function normTxt(s: string): string {
  return (s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function tokTxt(s: string): string[] {
  return normTxt(s).split(/[^a-z0-9]+/).filter(Boolean);
}

function canonTokens(s: string): string[] {
  return tokTxt(s).map(canonToken).filter((t) => !STOPWORDS.has(t));
}

function scoreMatch(nome: string, candidato: string): number {
  const a = canonTokens(nome).filter((t) => t.length > 1);
  const b = new Set(canonTokens(candidato));
  let score = 0;
  for (const t of a) if (b.has(t)) score += t.length;
  const fa = a[0];
  const fb = canonTokens(candidato)[0];
  if (fa && fb && fa === fb) score += 100;
  return score;
}

const ALIMENTO_COLS = 'id, descricao, categoria, energia_kcal, proteina_g, lipideos_g, carboidrato_g, fibra_g, sodio_mg';

async function resolveAlimento(nome: string, db: any): Promise<any> {
  const n = (nome || '').trim();
  if (!n) return null;
  const { data: exact, error } = await db.from('alimentos').select(ALIMENTO_COLS).ilike('descricao', `%${n}%`).limit(10);
  if (!error && exact && exact.length) {
    return [...exact].sort((x: any, y: any) => scoreMatch(n, y.descricao) - scoreMatch(n, x.descricao))[0];
  }
  const toks = canonTokens(n).filter((t) => t.length > 1);
  if (!toks.length) return null;
  const seen = new Map<number, any>();
  for (const t of toks) {
    const { data: rows } = await db.from('alimentos').select(ALIMENTO_COLS).ilike('descricao', `%${t}%`).limit(10);
    for (const r of (rows ?? [])) if (!seen.has(r.id)) seen.set(r.id, r);
  }
  const all = Array.from(seen.values());
  if (!all.length) return null;
  return all.sort((x: any, y: any) => scoreMatch(n, y.descricao) - scoreMatch(n, x.descricao))[0];
}

function macroDe(alimento: any, qtdG: number) {
  if (!alimento) return null;
  const f = qtdG / 100;
  return {
    kcal: round2((alimento.energia_kcal ?? 0) * f),
    proteina: round2((alimento.proteina_g ?? 0) * f),
    carbo: round2((alimento.carboidrato_g ?? 0) * f),
    gordura: round2((alimento.lipideos_g ?? 0) * f),
  };
}

const NON_FOODS = new Set(['agua', 'sal', 'pimenta', 'tempero', 'temperos', 'oregano']);
function isNonFood(descricao: string): boolean {
  const ts = canonTokens(descricao);
  return ts.length > 0 && ts.every((t) => NON_FOODS.has(t));
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const body = await req.json();
    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });
    const db = supabase.schema('corpointeligente');

    switch (body.action) {
      case 'save_new_calculation': {
        const { data: inserted, error } = await db.from('calculations').insert(toDbRow(body.data ?? {})).select().single();
        if (error) return json({ error: error.message }, 400);
        return json(toCamelRow(inserted));
      }
      case 'get_user_calculations': {
        const isAdmin = body.email === 'ueberson.lsousa@gmail.com';
        const q = isAdmin ? db.from('calculations').select('*') : db.from('calculations').select('*').eq('user_id', body.userId);
        const { data: rows, error } = await q.order('created_at', { ascending: false });
        if (error) return json({ error: error.message }, 400);
        return json((rows ?? []).map(toCamelRow));
      }
      case 'update_calculation': {
        const { data: updated, error } = await db.from('calculations').update(toDbRow(body.data ?? {})).eq('id', body.calculationId).select().single();
        if (error) return json({ error: error.message }, 400);
        return json(toCamelRow(updated));
      }
      case 'delete_calculation': {
        const { error } = await db.from('calculations').delete().eq('id', body.calculationId);
        if (error) return json({ error: error.message }, 400);
        return json({ success: true });
      }
      case 'save_profile': {
        const { data: upserted, error } = await db.from('profiles').upsert(toDbRow(body.data ?? {}), { onConflict: 'id' }).select().single();
        if (error) return json({ error: error.message }, 400);
        return json(toCamelRow(upserted));
      }
      case 'get_profile': {
        const { data: row, error } = await db.from('profiles').select('*').eq('id', body.id).maybeSingle();
        if (error) return json({ error: error.message }, 400);
        return json(row ? toCamelRow(row) : null);
      }
      case 'get_all_profiles': {
        const { data: profiles, error } = await db.from('profiles').select('*').order('created_at', { ascending: false });
        if (error) return json({ error: error.message }, 400);
        const emailById: Record<string, string> = {};
        try {
          const { data: users } = await supabase.auth.admin.listUsers({ page: 1, perPage: 1000 });
          for (const u of (users?.users ?? [])) emailById[u.id] = u.email ?? '';
        } catch { /* e-mail opcional */ }
        return json((profiles ?? []).map((p: any) => ({ ...toCamelRow(p), email: emailById[p.id] ?? null })));
      }
      case 'generate_raio_x': {
        const content = await callDeepSeek(buildRaioXPrompt(body.data ?? {}));
        return json({ content });
      }
      case 'generate_strategy': {
        const content = await callDeepSeek(buildStrategyPrompt(body.data ?? {}));
        return json({ content });
      }
      case 'generate_training': {
        const content = await callDeepSeek(buildTrainingPrompt(body.data ?? {}));
        const program = parseJson(content);
        return json({ program });
      }
      case 'generate_dieta': {
        const content = await callDeepSeek(buildDietaPrompt(body.data ?? {}));
        const parsed = parseJson(content) as any;
        const refeicoes = Array.isArray(parsed.refeicoes) ? parsed.refeicoes : [];
        const naoEncontrados: string[] = [];
        let totK = 0, totP = 0, totC = 0, totG = 0;
        const outRefeicoes: any[] = [];
        for (const ref of refeicoes) {
          const alimentos: any[] = [];
          let rK = 0, rP = 0, rC = 0, rG = 0;
          for (const item of (Array.isArray(ref.alimentos) ? ref.alimentos : [])) {
            const descricao = String(item.descricao ?? '');
            const qtd = Number(item.quantidade_g) || 0;
            if (isNonFood(descricao)) continue;
            const al = await resolveAlimento(descricao, db);
            const macros = macroDe(al, qtd);
            if (macros) {
              rK += macros.kcal; rP += macros.proteina; rC += macros.carbo; rG += macros.gordura;
            } else if (descricao) {
              naoEncontrados.push(descricao);
            }
            alimentos.push({
              descricao,
              quantidade_g: qtd,
              alimento: al ? { id: al.id, descricao: al.descricao } : null,
              macros,
            });
          }
          outRefeicoes.push({
            nome: String(ref.nome ?? ''),
            horario: String(ref.horario ?? ''),
            alimentos,
            observacao: String(ref.observacao ?? ''),
            totais: { kcal: round2(rK), proteina: round2(rP), carbo: round2(rC), gordura: round2(rG) },
          });
          totK += rK; totP += rP; totC += rC; totG += rG;
        }
        const m = (body.data ?? {}).macros ?? {};
        return json({
          refeicoes: outRefeicoes,
          totais: { kcal: round2(totK), proteina: round2(totP), carbo: round2(totC), gordura: round2(totG) },
          meta: { calorias: m.calorias, proteinaG: m.proteinaG, carbG: m.carbG, gorduraG: m.gorduraG },
          naoEncontrados: Array.from(new Set(naoEncontrados)),
        });
      }
      case 'search_alimentos': {
        const q = String(body.query ?? '').trim();
        if (!q) return json({ results: [] });
        const { data: rows, error } = await db.from('alimentos')
          .select('id, descricao, categoria, energia_kcal, proteina_g, lipideos_g, carboidrato_g, fibra_g, sodio_mg')
          .ilike('descricao', `%${q}%`)
          .order('descricao')
          .limit(20);
        if (error) return json({ error: error.message }, 400);
        return json({ results: rows ?? [] });
      }
      default:
        return json({ error: 'Unknown action' }, 400);
    }
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});
