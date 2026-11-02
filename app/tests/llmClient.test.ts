import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { categorizeWithLlm, breakdownWithLlm } from '../src/ai/llmClient';

// Ответ OpenRouter: текст модели лежит в choices[0].message.content
function apiResponse(content) {
  return {
    ok: true,
    json: async () => ({ choices: [{ message: { content } }] }),
  };
}

describe('categorizeWithLlm', () => {
  beforeEach(() => {
    vi.stubEnv('VITE_OPENROUTER_API_KEY', 'test-key');
    vi.stubEnv('VITE_LLM_MODEL', 'test-model');
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('разбирает JSON-ответ в формат categorize', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      apiResponse('{"kind":"task","title":"Помыть пол","group":"Н","durationMin":45}')
    );
    vi.stubGlobal('fetch', fetchMock);

    const result = await categorizeWithLlm('надо помыть пол');
    expect(result).toEqual({
      kind: 'task',
      title: 'Помыть пол',
      group: 'Н',
      durationMin: 45,
      confidence: 0.6,
      provider: 'llm',
    });

    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe('https://openrouter.ai/api/v1/chat/completions');
    const body = JSON.parse(options.body);
    expect(body.model).toBe('test-model');
    expect(body.messages.at(-1).content).toBe('надо помыть пол');
    expect(options.headers.Authorization).toBe('Bearer test-key');
  });

  it('достаёт JSON из ответа с пояснениями и fences', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      apiResponse('Вот разбор:\n```json\n{"kind":"routine","title":"Медитация","group":"П","repeatRule":"daily"}\n```')
    ));

    const result = await categorizeWithLlm('медитировать каждое утро');
    expect(result.kind).toBe('routine');
    expect(result.title).toBe('Медитация');
    expect(result.repeatRule).toBe('daily');
    expect(result.durationMin).toBeUndefined();
  });

  it('без ключа возвращает null и не обращается к API', async () => {
    vi.stubEnv('VITE_OPENROUTER_API_KEY', '');
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    expect(await categorizeWithLlm('что-то')).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('ошибка сети → null', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    expect(await categorizeWithLlm('что-то')).toBeNull();
  });

  it('429 → повтор через 2 секунды приносит ответ', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: false, status: 429 })
      .mockResolvedValueOnce(
        apiResponse('{"kind":"task","title":"Позвонить маме","group":"Н","durationMin":15}')
      );
    vi.stubGlobal('fetch', fetchMock);
    vi.useFakeTimers();

    const pending = categorizeWithLlm('позвонить маме');
    await vi.advanceTimersByTimeAsync(2000);
    const result = await pending;

    expect(result.provider).toBe('llm');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('401 не повторяется — сразу null', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 401 });
    vi.stubGlobal('fetch', fetchMock);

    expect(await categorizeWithLlm('что-то')).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('HTTP-ошибка (401) → null', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 401 }));
    expect(await categorizeWithLlm('что-то')).toBeNull();
  });

  it('битый JSON в ответе → null', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(apiResponse('к сожалению, не могу {сформировать')));
    expect(await categorizeWithLlm('что-то')).toBeNull();
  });

  it('неизвестный kind → null', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      apiResponse('{"kind":"idea","title":"X","group":"Н"}')
    ));
    expect(await categorizeWithLlm('что-то')).toBeNull();
  });

  it('пустой title → null', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      apiResponse('{"kind":"task","title":"  ","group":"Н"}')
    ));
    expect(await categorizeWithLlm('что-то')).toBeNull();
  });

  it('несколько JSON-объектов подряд → берётся первый', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      apiResponse('{"kind": "task", "title": "Приготовить еду", "group": "Н", "durationMin": 60} {"kind": "routine", "title": "Готовить", "group": "П", "repeatRule": "daily"}')
    ));

    const result = await categorizeWithLlm('надо поесть и научиться готовить');
    expect(result).toEqual({
      kind: 'task',
      title: 'Приготовить еду',
      group: 'Н',
      durationMin: 60,
      confidence: 0.6,
      provider: 'llm',
    });
  });

  it('незнакомая группа → group null, остальное сохранено', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      apiResponse('{"kind":"task","title":"Позвонить маме","group":"семья","durationMin":15}')
    ));

    const result = await categorizeWithLlm('позвонить маме');
    expect(result.group).toBeNull();
    expect(result.title).toBe('Позвонить маме');
    expect(result.durationMin).toBe(15);
  });

  it('durationMin вне диапазона → поле отброшено', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      apiResponse('{"kind":"task","title":"Разобрать шкаф","group":"Н","durationMin":9999}')
    ));

    const result = await categorizeWithLlm('разобрать шкаф');
    expect(result.durationMin).toBeUndefined();
  });
});

describe('breakdownWithLlm — разбиение дела на шаги', () => {
  beforeEach(() => {
    vi.stubEnv('VITE_OPENROUTER_API_KEY', 'test-key');
    vi.stubEnv('VITE_LLM_MODEL', 'test-model');
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('массив строк превращается в шаги', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      apiResponse('["собрать вещи", "протереть полки", "разложить по коробкам"]')
    ));
    const steps = await breakdownWithLlm('Разобрать шкаф');
    expect(steps).toEqual(['собрать вещи', 'протереть полки', 'разложить по коробкам']);
  });

  it('пояснения вокруг массива и лишние элементы отбрасываются, максимум 6', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      apiResponse('Вот шаги: ["a","b","",7,"c","d","e","f","g"] Удачи!')
    ));
    const steps = await breakdownWithLlm('X');
    expect(steps).toEqual(['a', 'b', 'c', 'd', 'e', 'f']);
  });

  it('меньше двух валидных шагов → null', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(apiResponse('["единственный шаг"]')));
    expect(await breakdownWithLlm('X')).toBeNull();
  });

  it('не-массив или мусор → null', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(apiResponse('не могу разбить это дело')));
    expect(await breakdownWithLlm('X')).toBeNull();
  });

  it('без ключа → null без запроса', async () => {
    vi.stubEnv('VITE_OPENROUTER_API_KEY', '');
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    expect(await breakdownWithLlm('X')).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
