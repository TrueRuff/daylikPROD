import { describe, it, expect } from 'vitest';
import {
  serializeJson, parseJson,
  serializeBinary, parseBinary,
  normalizeImport,
} from '../src/core/serialization';

// Набор, покрывающий nullable-поля, midnight-практики и висячие ссылки
function fixture() {
  return {
    spheres: [
      { id: 's1', name: 'Сон', group: 'Н', brief: 'спать 8 часов', details: 'отбой в 23', createdAt: 1729900000000 },
      { id: 's2', name: 'Английский', group: 'П', brief: '', details: '', createdAt: 1729900000001 },
    ],
    tasks: [
      {
        id: 't1', sphereId: 's1', rawText: 'купить корм', title: 'Купить корм', group: 'Н',
        durationMin: 30, status: 'done', scheduledDate: '2026-10-24', scheduledStart: 600,
        dueAt: null, repeatRule: null, notes: '', createdAt: 1729900000002, source: 'rules',
      },
      {
        id: 't2', sphereId: 's-deleted', rawText: '', title: 'Разобрать шкаф', group: 'Ж',
        durationMin: 90, status: 'inbox', scheduledDate: null, scheduledStart: null,
        dueAt: 1729900123456, repeatRule: null, notes: 'запахло нафталином', createdAt: 1729900000003, source: 'llm',
      },
    ],
    practices: [
      { id: 'p1', sphereId: 's1', title: 'Сон', days: [1, 2, 3, 4, 5, 6, 7], start: 1380, end: 420 },
      { id: 'p2', sphereId: null, title: 'Прогулка', days: [6, 7], start: 600, end: 660 },
    ],
  };
}

const cleanFixture = () => normalizeImport(fixture());

describe('JSON-сериализация', () => {
  it('round-trip: serialize → parse → normalize восстанавливает данные', () => {
    const restored = normalizeImport(parseJson(serializeJson(fixture())));
    expect(restored).toEqual(cleanFixture());
  });

  it('не-JSON или чужой JSON → null', () => {
    expect(parseJson('не json')).toBeNull();
    expect(parseJson('{"format":"other"}')).toBeNull();
  });
});

describe('двоичный формат .daylik', () => {
  it('round-trip восстанавливает данные', () => {
    const bytes = serializeBinary(fixture());
    expect(bytes[0]).toBe(0x44); // сигнатура DAYL
    expect(normalizeImport(parseBinary(bytes.buffer))).toEqual(cleanFixture());
  });

  it('двоичный файл компактнее JSON', () => {
    expect(serializeBinary(fixture()).length).toBeLessThan(serializeJson(fixture()).length);
  });

  it('битая сигнатура → null', () => {
    const bytes = serializeBinary(fixture());
    bytes[0] = 0x58;
    expect(parseBinary(bytes.buffer)).toBeNull();
  });

  it('обрыв файла → null, а не исключение', () => {
    const bytes = serializeBinary(fixture());
    for (const cut of [10, 50, bytes.length - 7]) {
      expect(parseBinary(bytes.buffer.slice(0, cut))).toBeNull();
    }
  });

  it('мусор вместо длины строки → null', () => {
    const bytes = serializeBinary(fixture());
    bytes[10] = 0xff; // раздуем длину первой строки до миллиардов байтов
    expect(parseBinary(bytes.buffer)).toBeNull();
  });
});

describe('normalizeImport — проверка импортируемых данных', () => {
  it('висячий sphereId у дела обнуляется', () => {
    const restored = normalizeImport(fixture());
    expect(restored.tasks[0].sphereId).toBe('s1');
    expect(restored.tasks[1].sphereId).toBeNull();
  });

  it('записи без обязательных полей отбрасываются', () => {
    const restored = normalizeImport({
      spheres: [{ name: 'без id' }, fixture().spheres[0]],
      tasks: [{ id: 't', group: 'Н' }, fixture().tasks[0]],
      practices: [{ title: 'без id' }, fixture().practices[0]],
    });
    expect(restored.spheres).toHaveLength(1);
    expect(restored.tasks).toHaveLength(1);
    expect(restored.practices).toHaveLength(1);
  });

  it('недопустимые дни недели у практики отфильтровываются', () => {
    const restored = normalizeImport({ practices: [{ id: 'p', title: 'X', days: [2, 9, 0, 5] }] });
    expect(restored.practices[0].days).toEqual([2, 5]);
  });

  it('мусорные группы заменяются на П, числа — безопасными значениями', () => {
    const restored = normalizeImport({
      spheres: [{ id: 's', name: 'S', group: 'работа' }],
      tasks: [{ id: 't', title: 'T', group: 42, durationMin: 'много' }],
      practices: [{ id: 'p', title: 'P', days: [1], start: 'утро', end: 9999 }],
    });
    expect(restored.spheres[0].group).toBe('П');
    expect(restored.tasks[0].group).toBe('П');
    expect(restored.tasks[0].durationMin).toBe(30);
    expect(restored.practices[0].start).toBe(0);
    expect(restored.practices[0].end).toBe(1440);
  });

  it('длительность дела ограничивается диапазоном 5–480', () => {
    const restored = normalizeImport({
      tasks: [
        { id: 'a', title: 'A', group: 'Н', durationMin: 2 },
        { id: 'b', title: 'B', group: 'Н', durationMin: 10000 },
      ],
    });
    expect(restored.tasks[0].durationMin).toBe(5);
    expect(restored.tasks[1].durationMin).toBe(480);
  });

  it('отсутствующие ключи не ломают импорт', () => {
    const restored = normalizeImport({});
    expect(restored).toEqual({ spheres: [], tasks: [], practices: [] });
  });
});

describe('normalizeImport — безопасность id', () => {
  it('записи с опасным id отбрасываются, безопасные проходят', async () => {
    const { normalizeImport } = await import('../src/core/serialization');
    const data = normalizeImport({
      spheres: [
        { id: 'ok-1', name: 'Школа', group: 'П' },
        { id: '"><img src=x onerror=alert(1)>', name: 'Зло', group: 'Н' },
      ],
      tasks: [
        { id: '../etc', title: 'слэши тоже мимо', group: 'Н' },
        { id: 'task-1', title: 'нормальное дело', group: 'Н' },
      ],
      practices: [
        { id: 'x'.repeat(65), title: 'слишком длинный id', days: [1] },
        { id: 'pr-1', title: 'нормальная рутина', days: [1] },
      ],
    });
    expect(data.spheres.map((x) => x.id)).toEqual(['ok-1']);
    expect(data.tasks.map((x) => x.id)).toEqual(['task-1']);
    expect(data.practices.map((x) => x.id)).toEqual(['pr-1']);
  });
});

describe('normalizeImport — дубликаты и мусор в полях расписания', () => {
  it('дубликаты id отбрасываются, остаётся первое вхождение', () => {
    const restored = normalizeImport({
      spheres: [{ id: 's', name: 'одна' }, { id: 's', name: 'две' }],
      tasks: [{ id: 'dup', title: 'первое' }, { id: 'dup', title: 'второе' }],
      practices: [{ id: 'p', title: 'A' }, { id: 'p', title: 'B' }],
    });
    expect(restored.spheres.map((x) => x.name)).toEqual(['одна']);
    expect(restored.tasks.map((x) => x.title)).toEqual(['первое']);
    expect(restored.practices.map((x) => x.title)).toEqual(['A']);
  });

  it('мусорные дата/время/статус/напоминание у дела приводятся в норму', () => {
    const restored = normalizeImport({
      tasks: [
        { id: 'a', title: 'A', scheduledDate: '24.10.2026', scheduledStart: 'утро', status: 'inbox', dueAt: 'завтра' },
        { id: 'b', title: 'B', scheduledDate: '2026-10-24', scheduledStart: 9999, status: 'done', dueAt: 1000 },
      ],
    });
    expect(restored.tasks[0].scheduledDate).toBeNull();
    expect(restored.tasks[0].scheduledStart).toBeNull();
    expect(restored.tasks[0].status).toBe('todo');
    expect(restored.tasks[0].dueAt).toBeNull();
    expect(restored.tasks[1].scheduledDate).toBe('2026-10-24');
    expect(restored.tasks[1].scheduledStart).toBe(1439);
    expect(restored.tasks[1].status).toBe('done');
    expect(restored.tasks[1].dueAt).toBe(1000);
  });

  it('дни практики приводятся к числам 1..7 без повторов', () => {
    const restored = normalizeImport({ practices: [{ id: 'p', title: 'P', days: ['2', 3, 3, 8] }] });
    expect(restored.practices[0].days).toEqual([2, 3]);
  });
});
