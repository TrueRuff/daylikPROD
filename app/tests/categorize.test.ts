import { describe, it, expect, vi, beforeEach } from 'vitest';
import { categorizeByRules, categorize } from '../src/core/categorize';
import { categorizeWithLlm } from '../src/ai/llmClient';

vi.mock('../src/ai/llmClient', () => ({
  categorizeWithLlm: vi.fn(),
}));

describe('categorizeByRules', () => {
  it('бытовое дело → группа Н, разовое', () => {
    const r = categorizeByRules('помыть пол');
    expect(r.kind).toBe('task');
    expect(r.group).toBe('Н');
    expect(r.durationMin).toBe(30);
    expect(r.confidence).toBeGreaterThanOrEqual(0.5);
  });

  it('«хочу научиться готовить» → предложение сферы', () => {
    const r = categorizeByRules('хочу научиться готовить');
    expect(r.kind).toBe('sphere');
    expect(r.title).toBe('готовить');
    expect(r.group).toBe('Ж');
  });

  it('«читать 20 страниц в день» → практика с повтором', () => {
    const r = categorizeByRules('читать 20 страниц в день');
    expect(r.kind).toBe('routine');
    expect(r.repeatRule).toBe('daily');
    expect(r.title).not.toContain('в день');
  });

  it('незнакомая формулировка → низкая уверенность (уйдёт в LLM-фолбэк)', () => {
    const r = categorizeByRules('что-то совсем странное');
    expect(r.confidence).toBeLessThan(0.5);
  });
});

describe('длительность в тексте', () => {
  it('«позвонить маме на 20 минут» → 20 мин, из названия вычищено', () => {
    const r = categorizeByRules('позвонить маме на 20 минут');
    expect(r.durationMin).toBe(20);
    expect(r.title).toBe('позвонить маме');
  });

  it('«сделать курсач за 2 часа» → 120 мин', () => {
    const r = categorizeByRules('сделать курсач за 2 часа');
    expect(r.durationMin).toBe(120);
    expect(r.title).toBe('сделать курсач');
  });

  it('«полчаса» и «полтора часа» → 30 и 90', () => {
    const r1 = categorizeByRules('разобрать ящик с проводами, полчаса');
    expect(r1.durationMin).toBe(30);
    const r2 = categorizeByRules('разобрать ящик с проводами, полтора часа');
    expect(r2.durationMin).toBe(90);
  });

  it('незнакомый глагол, но длительность явная → она сохраняется в фолбэке', () => {
    const r = categorizeByRules('пересобрать кота на 40 минут');
    expect(r.confidence).toBeLessThan(0.5);
    expect(r.durationMin).toBe(40);
    expect(r.title).toBe('пересобрать кота');
  });

  it('нулевая длительность («на 0 минут») игнорируется, остаётся дефолт', () => {
    const r = categorizeByRules('позвонить маме на 0 минут');
    expect(r.durationMin).toBe(30);
    expect(r.title).toContain('на 0 минут');
  });
});

describe('расширенный словарь', () => {
  it('«медитировать по вечерам» → ежедневная практика', () => {
    const r = categorizeByRules('медитировать по вечерам');
    expect(r.kind).toBe('routine');
    expect(r.repeatRule).toBe('daily');
    expect(r.title).toBe('медитировать');
  });

  it('«тренироваться каждую неделю» → недельная практика', () => {
    const r = categorizeByRules('тренироваться каждую неделю');
    expect(r.kind).toBe('routine');
    expect(r.repeatRule).toBe('weekly');
    expect(r.title).toBe('тренироваться');
  });

  it('«бассейн по субботам» → недельная практика', () => {
    const r = categorizeByRules('бассейн по субботам');
    expect(r.kind).toBe('routine');
    expect(r.repeatRule).toBe('weekly');
    expect(r.title).toBe('бассейн');
  });

  it('«хочу выучить японский» → сфера', () => {
    const r = categorizeByRules('хочу выучить японский');
    expect(r.kind).toBe('sphere');
    expect(r.title).toBe('японский');
  });

  it('«приготовить ужин» → дело Н', () => {
    const r = categorizeByRules('приготовить ужин');
    expect(r.kind).toBe('task');
    expect(r.group).toBe('Н');
  });
});

describe('categorize — гибрид правил и LLM', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('уверенное правило срабатывает без вызова LLM', async () => {
    const r = await categorize('помыть пол');
    expect(r.provider).toBe('rules');
    expect(categorizeWithLlm).not.toHaveBeenCalled();
  });

  it('низкая уверенность + LLM ответил → берётся ответ LLM', async () => {
    categorizeWithLlm.mockResolvedValueOnce({
      kind: 'task', title: 'Отсортировать книги', group: 'Ж', confidence: 0.6, provider: 'llm',
    });

    const r = await categorize('что-то совсем странное');
    expect(r.provider).toBe('llm');
    expect(r.title).toBe('Отсортировать книги');
  });

  it('LLM недоступен → остаёмся на правилах с пометкой llmFailed', async () => {
    categorizeWithLlm.mockResolvedValueOnce(null);

    const r = await categorize('что-то совсем странное');
    expect(r.provider).toBe('rules');
    expect(r.llmFailed).toBe(true);
  });

  it('LLM упал с ошибкой → деградация на правилах, а не отказ', async () => {
    categorizeWithLlm.mockRejectedValueOnce(new Error('network'));

    const r = await categorize('что-то совсем странное');
    expect(r.provider).toBe('rules');
    expect(r.llmFailed).toBe(true);
  });
});
