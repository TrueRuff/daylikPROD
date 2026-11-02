// клиент LLM API (OpenRouter, бесплатный тариф).
// ключ и модель берутся из .env (VITE_OPENROUTER_API_KEY, VITE_LLM_MODEL, см. .env.example).
// любая ошибка — нет ключа, сеть, HTTP, неожиданный ответ — даёт null: разбор падает на правила.

import { log } from '../core/log.js';
import type { CategorizeResult } from '../core/categorize.js';
import type { SphereGroup } from '../core/models.js';

const API_URL = 'https://openrouter.ai/api/v1/chat/completions';
const REQUEST_TIMEOUT_MS = 20000;
const RETRY_DELAY_MS = 2000;
// у бесплатных моделей общий пул: 429/5xx часто уходит за секунды — пробуем ещё раз
const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);
// openrouter/free — роутер: сам выбирает свободную модель из бесплатных
const DEFAULT_MODEL = 'openrouter/free';

const KINDS = new Set(['task', 'routine', 'sphere']);
const GROUPS = new Set(['Н', 'Ж', 'П']);

const SYSTEM_PROMPT = `Ты разбираешь записи планировщика: тебе дают фразу на русском языке.
Верни строго один JSON-объект без пояснений, в формате:
{"kind": "...", "title": "...", "group": "...", "durationMin": число, "repeatRule": "..."}
kind — "task" (разовое дело), "routine" (регулярная практика) или "sphere" (пользователь хочет освоить новое — предложить сферу).
title — короткое название дела, практики или сферы.
group — "Н" (быт и насущное), "Ж" (желания и жизнь) или "П" (практики и развитие).
durationMin — длительность в минутах от 5 до 240, указывай только для task.
repeatRule — "daily" или "weekly", указывай только для routine.`;

async function sendRequest(apiKey: string, model: string, userText: string, systemPrompt: string = SYSTEM_PROMPT): Promise<Response | null> {
  try {
    return await fetch(API_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userText },
        ],
        temperature: 0,
        // запас на reasoning-токены, иначе у резонеров обрезается сам ответ
        max_tokens: 1000,
        reasoning: { exclude: true },
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    return null;
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function categorizeWithLlm(rawText: string): Promise<CategorizeResult | null> {
  const apiKey = import.meta.env.VITE_OPENROUTER_API_KEY;
  if (!apiKey) return null;

  const model = import.meta.env.VITE_LLM_MODEL || DEFAULT_MODEL;
  log.debug('llm.request', { model, textLength: rawText.length });

  let response = await sendRequest(apiKey, model, rawText);
  if (response && RETRYABLE_STATUS.has(response.status)) {
    log.warn('llm.retryable', { status: response.status });
    await delay(RETRY_DELAY_MS);
    response = await sendRequest(apiKey, model, rawText);
  }
  if (!response || !response.ok) {
    log.warn('llm.failed', { status: response ? response.status : 'network' });
    return null;
  }

  const data = await response.json().catch(() => null) as LlmResponse | null;
  const content = data?.choices?.[0]?.message?.content;
  if (typeof content !== 'string') {
    log.warn('llm.badResponse', { hasContent: false });
    return null;
  }

  const result = parseLlmAnswer(content);
  log[result ? 'info' : 'warn'](result ? 'llm.parsed' : 'llm.unparsed', {
    model: data?.model,
    chars: content.length,
  });
  return result;
}

interface LlmResponse {
  model?: string;
  choices?: { message?: { content?: string } }[];
}

// модели обрамляют JSON пояснениями или ```-блоками, иногда выдают несколько
// объектов подряд — берём первый сбалансированный {...}
function extractFirstJson(text: string): string | null {
  const start = text.indexOf('{');
  if (start === -1) return null;
  let depth = 0;
  for (let i = start; i < text.length; i++) {
    if (text[i] === '{') depth++;
    else if (text[i] === '}' && --depth === 0) return text.slice(start, i + 1);
  }
  return null;
}

function parseLlmAnswer(text: string): CategorizeResult | null {
  const json = extractFirstJson(text);
  if (!json) return null;

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(json);
  } catch {
    return null;
  }
  if (!KINDS.has(parsed.kind as string) || typeof parsed.title !== 'string' || !parsed.title.trim()) return null;

  const result: CategorizeResult = {
    kind: parsed.kind as CategorizeResult['kind'],
    title: (parsed.title as string).trim(),
    group: GROUPS.has(parsed.group as string) ? parsed.group as SphereGroup : null,
    confidence: 0.6,
    provider: 'llm',
  };
  if (parsed.kind === 'task') {
    const dur = Math.round(Number(parsed.durationMin));
    if (dur >= 5 && dur <= 240) result.durationMin = dur;
  }
  if (parsed.kind === 'routine' && (parsed.repeatRule === 'daily' || parsed.repeatRule === 'weekly')) {
    result.repeatRule = parsed.repeatRule;
  }
  return result;
}

const BREAKDOWN_PROMPT = `Разбей дело на 3–6 маленьких конкретных шагов, каждый по 10–30 минут.
Верни строго JSON-массив строк без пояснений: ["шаг 1", "шаг 2", ...]`;

// разбиение большого дела на шаги (идея из goblin.tools). null — ключа нет,
// сеть недоступна или модель ответила не массивом
export async function breakdownWithLlm(title: string): Promise<string[] | null> {
  const apiKey = import.meta.env.VITE_OPENROUTER_API_KEY;
  if (!apiKey) return null;
  const model = import.meta.env.VITE_LLM_MODEL || DEFAULT_MODEL;
  log.debug('llm.breakdown.request', { model });

  const response = await sendRequest(apiKey, model, title, BREAKDOWN_PROMPT);
  if (!response || !response.ok) {
    log.warn('llm.breakdown.failed', { status: response ? response.status : 'network' });
    return null;
  }
  const data = await response.json().catch(() => null) as LlmResponse | null;
  const content = data?.choices?.[0]?.message?.content;
  if (typeof content !== 'string') return null;

  const steps = parseSteps(content);
  log[steps ? 'info' : 'warn']('llm.breakdown.' + (steps ? 'ok' : 'unparsed'), { chars: content.length });
  return steps;
}

function parseSteps(text: string): string[] | null {
  const start = text.indexOf('[');
  const end = text.lastIndexOf(']');
  if (start === -1 || end <= start) return null;
  let arr: unknown;
  try {
    arr = JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
  if (!Array.isArray(arr)) return null;
  const steps = arr.filter((s) => typeof s === 'string' && s.trim()).map((s) => (s as string).trim()).slice(0, 6);
  return steps.length >= 2 ? steps : null;
}
