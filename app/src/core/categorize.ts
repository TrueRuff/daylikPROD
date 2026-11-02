// гибридный разбор ввода: сначала локальные правила (словарь + регулярки),
// при низкой уверенности — внешний LLM API (см. src/ai/llmClient.ts).
// контракт: categorize(rawText) → { kind, title, group, durationMin?, repeatRule?, confidence, provider }

import { categorizeWithLlm } from '../ai/llmClient.js';
import { log } from './log.js';
import type { SphereGroup } from './models.js';

export type CategorizeKind = 'task' | 'routine' | 'sphere';

export interface CategorizeResult {
  kind: CategorizeKind;
  title: string;
  group: SphereGroup | null;
  durationMin?: number;
  repeatRule?: string | null;
  confidence: number;
  provider: 'rules' | 'llm';
  llmFailed?: boolean;
}

// длительность в тексте: «на 20 минут», «за 2 часа», «полчаса», «полтора часа».
// \b в JS не знает кириллицы, поэтому конец слова — lookahead (?![а-яё]).
const DURATION_RE = /(?:на\s+|за\s+)?(?:(\d+)\s*(минут[а-яё]*|мин|час[а-яё]*|ч)(?![а-яё])|полчаса|полтора\s+часа)/i;

export function extractDuration(text: string): number | null {
  const m = text.match(DURATION_RE);
  if (!m) return null;
  if (/полчаса/i.test(m[0])) return 30;
  if (/полтора/i.test(m[0])) return 90;
  const n = Number(m[1]);
  return /^ч/i.test(m[2]) ? n * 60 : n;
}

// явная длительность перекрывает дефолт правила и вычищается из названия;
// нулевая и отрицательная («на 0 минут») — не длительность, оставляем дефолт
function withDuration(result: CategorizeResult): CategorizeResult {
  const dur = extractDuration(result.title);
  if (dur == null || dur <= 0) return result;
  return {
    ...result,
    title: result.title.replace(DURATION_RE, '').replace(/\s+/g, ' ').trim(),
    durationMin: dur,
  };
}

interface Rule {
  pattern: RegExp;
  kind: CategorizeKind;
  group: SphereGroup;
  titleFrom?: (raw: string) => string;
  confidence: number;
  durationMin?: number;
  repeatRule?: string;
}

// словарь правил: ключевое слово/регулярка → разбор.
// порядок важен: первый совпавший шаблон побеждает.
const RULES: Rule[] = [
  {
    // «читать 20 страниц в день», «бегать каждое утро», «медитировать по вечерам» → практика
    // (\b в JS не работает с кириллицей — границы слов не используем)
    pattern: /(каждый день|ежедневно|в день|каждое утро|каждый вечер|по утрам|по вечерам|по дням)/i,
    kind: 'routine',
    group: 'П',
    titleFrom: (raw) => raw.replace(/\s*(каждый день|ежедневно|в день|каждое утро|каждый вечер|по утрам|по вечерам|по дням)\s*/i, ' ').trim(),
    confidence: 0.8,
  },
  {
    // «тренироваться каждую неделю», «по субботам» → практика с недельным повтором
    pattern: /(каждую неделю|еженедельно|раз в неделю|по\s+(понедельникам|вторникам|средам|четвергам|пятницам|субботам|воскресеньям|выходным))/i,
    kind: 'routine',
    group: 'П',
    repeatRule: 'weekly',
    titleFrom: (raw) => raw.replace(/\s*(каждую неделю|еженедельно|раз в неделю|по\s+(понедельникам|вторникам|средам|четвергам|пятницам|субботам|воскресеньям|выходным))\s*/i, ' ').trim(),
    confidence: 0.8,
  },
  {
    // «хочу научиться X», «хочу выучить японский» → предложение создать сферу
    pattern: /^(хочу|мечтаю)\s+(научиться|освоить|разобраться|начать|выучить|изучить)\s+/i,
    kind: 'sphere',
    group: 'Ж',
    titleFrom: (raw) => raw.replace(/^(хочу|мечтаю)\s+(научиться|освоить|разобраться|начать|выучить|изучить)\s+/i, '').trim(),
    confidence: 0.7,
  },
  {
    // «помыть пол», «приготовить ужин» → бытовое разовое дело, группа Н
    pattern: /^(помыть|вымыть|убрать|купить|вынести|покормить|полить|позвонить|заплатить|сдать|отнести|починить|приготовить|сделать|написать|разобрать|оформить|заполнить|записаться|сходить|пойти|забрать|встретить|отвести|принести)/i,
    kind: 'task',
    group: 'Н',
    durationMin: 30,
    confidence: 0.9,
  },
];

export function categorizeByRules(rawText: string): CategorizeResult {
  const raw = rawText.trim();
  for (const rule of RULES) {
    const m = raw.match(rule.pattern);
    if (!m) continue;

    const result: CategorizeResult = {
      kind: rule.kind,
      title: rule.titleFrom ? rule.titleFrom(raw) : raw,
      group: rule.group,
      confidence: rule.confidence,
      provider: 'rules',
    };
    if (rule.durationMin) result.durationMin = rule.durationMin;
    if (rule.kind === 'routine') result.repeatRule = rule.repeatRule || 'daily';
    return result.kind === 'task' ? withDuration(result) : result;
  }

  // ничего не распознали — но длительность из текста вытащить всё же попробуем
  const fallback: CategorizeResult = { kind: 'task', title: raw, group: null, confidence: 0.1, provider: 'rules' };
  return withDuration(fallback);
}

const CONFIDENCE_THRESHOLD = 0.5;

export async function categorize(rawText: string): Promise<CategorizeResult> {
  const rulesResult = categorizeByRules(rawText);
  if (rulesResult.confidence >= CONFIDENCE_THRESHOLD) return rulesResult;

  // низкая уверенность — пробуем внешний LLM; недоступен → работаем на правилах
  try {
    const llmResult = await categorizeWithLlm(rawText);
    if (llmResult) return llmResult;
  } catch (err) {
    log.error('categorize.llmThrew', { message: err instanceof Error ? err.message : String(err) });
  }
  log.info('categorize.fallback', { rawText });
  return { ...rulesResult, llmFailed: true };
}
