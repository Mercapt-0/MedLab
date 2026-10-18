const { resultTypeFor, QuantitativeResult, QualitativeResult, CultureResult } = require('../../backend/src/domain/resultTypes');

const glucose = { category: 'quantitative', unit: 'mg/dL', ref_low: 70, ref_high: 99, panic_low: 40, panic_high: 500 };
const hcg = { category: 'qualitative', panic_on_positive: false };
const bloodCx = { category: 'culture', panic_on_positive: true };

describe('Polymorphic result types (R-09)', () => {
  test('factory returns the right subclass per category', () => {
    expect(resultTypeFor(glucose)).toBeInstanceOf(QuantitativeResult);
    expect(resultTypeFor(hcg)).toBeInstanceOf(QualitativeResult);
    expect(resultTypeFor(bloodCx)).toBeInstanceOf(CultureResult);
    expect(() => resultTypeFor({ category: 'imaging' })).toThrow(/Unknown result category/);
  });

  describe('Quantitative', () => {
    const q = resultTypeFor(glucose);
    test.each([
      [85, null, false],
      [65, 'L', false],
      [120, 'H', false],
      [40, 'L', true],
      [35, 'L', true],
      [500, 'H', true],
    ])('value %p -> flag %p, panic %p', (value, flag, panic) => {
      expect(q.evaluate(q.validate({ value }))).toEqual({ abnormalFlag: flag, isPanic: panic });
    });
    test('rejects non-numeric input', () => {
      expect(() => q.validate({ value: 'abc' })).toThrow(/numeric/);
      expect(() => q.validate({})).toThrow();
      expect(() => q.validate({ value: '' })).toThrow();
    });
    test('accepts numeric strings', () => {
      expect(q.validate({ value: '92.5' }).value).toBe(92.5);
    });
    test('summarize includes unit and reference range', () => {
      expect(q.summarize({ value: 85 })).toBe('85 mg/dL (ref 70-99)');
    });
  });

  describe('Qualitative', () => {
    const q = resultTypeFor(hcg);
    test('normalizes case and flags positive as abnormal', () => {
      expect(q.validate({ interpretation: 'POSITIVE' }).interpretation).toBe('positive');
      expect(q.evaluate({ interpretation: 'positive' })).toEqual({ abnormalFlag: 'A', isPanic: false });
      expect(q.evaluate({ interpretation: 'negative' })).toEqual({ abnormalFlag: null, isPanic: false });
    });
    test('rejects unknown interpretation', () => {
      expect(() => q.validate({ interpretation: 'maybe' })).toThrow(/positive, negative, indeterminate/);
    });
    test('panic when test configured panic_on_positive', () => {
      const p = resultTypeFor({ category: 'qualitative', panic_on_positive: true });
      expect(p.evaluate({ interpretation: 'positive' }).isPanic).toBe(true);
    });
  });

  describe('Culture', () => {
    const c = resultTypeFor(bloodCx);
    test('no growth is normal', () => {
      const d = c.validate({ growth: false });
      expect(c.evaluate(d)).toEqual({ abnormalFlag: null, isPanic: false });
      expect(c.summarize(d)).toBe('No growth');
    });
    test('growth requires organism and S/I/R sensitivities', () => {
      expect(() => c.validate({ growth: true })).toThrow(/organism/);
      expect(() => c.validate({ growth: true, organism: 'E. coli', sensitivities: [] })).toThrow(/sensitivity/);
      expect(() => c.validate({ growth: true, organism: 'E. coli', sensitivities: [{ antibiotic: 'Cipro', interpretation: 'X' }] })).toThrow(/S, I, or R/);
    });
    test('positive blood culture is a panic value', () => {
      const d = c.validate({ growth: true, organism: 'S. aureus', sensitivities: [{ antibiotic: 'Vancomycin', interpretation: 's' }] });
      expect(d.sensitivities[0].interpretation).toBe('S');
      expect(c.evaluate(d)).toEqual({ abnormalFlag: 'A', isPanic: true });
      expect(c.summarize(d)).toBe('S. aureus: Vancomycin S');
    });
    test('requires boolean growth', () => {
      expect(() => c.validate({ growth: 'yes' })).toThrow(/boolean/);
    });
  });
});
