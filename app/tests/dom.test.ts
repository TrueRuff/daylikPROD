import { describe, it, expect } from 'vitest';
import { escapeHtml, normalizeTimeValue } from '../src/ui/dom';

describe('escapeHtml', () => {
  it('экранирует все опасные символы', () => {
    expect(escapeHtml('<img src=x onerror="alert(1)">')).toBe(
      '&lt;img src=x onerror=&quot;alert(1)&quot;&gt;'
    );
    expect(escapeHtml("a'b&c<d>e\"f")).toBe('a&#39;b&amp;c&lt;d&gt;e&quot;f');
  });

  it('обычный текст не меняет, числа приводит к строке', () => {
    expect(escapeHtml('позвонить маме')).toBe('позвонить маме');
    expect(escapeHtml(30)).toBe('30');
  });
});

describe('normalizeTimeValue', () => {
  it('дополняет и ограничивает введённые цифры', () => {
    expect(normalizeTimeValue('930')).toBe('09:30');
    expect(normalizeTimeValue('930', )).toBe('09:30');
    expect(normalizeTimeValue('0930')).toBe('09:30');
    expect(normalizeTimeValue('7')).toBe('07:00');
    expect(normalizeTimeValue('2459')).toBe('23:59');
  });

  it('двоеточие и мусор игнорируются, пусто остаётся пустым', () => {
    expect(normalizeTimeValue('9:30')).toBe('09:30');
    expect(normalizeTimeValue('')).toBe('');
    expect(normalizeTimeValue(null)).toBe('');
    expect(normalizeTimeValue('abc')).toBe('');
  });
});
