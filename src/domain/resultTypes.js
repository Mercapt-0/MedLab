const { badRequest } = require('../errors');

/**
 * Polymorphic result types (R-09). Each subclass knows how to validate its own
 * payload and how to evaluate abnormal / panic flags against the catalogue test.
 * Adding a new category = adding one subclass + registering it below.
 */
class ResultType {
  constructor(test) {
    this.test = test; // row from lab_tests
  }

  /** @returns normalized data object; throws 400 on invalid input */
  validate(_data) {
    throw new Error('validate() must be implemented by subclass');
  }

  /** @returns { abnormalFlag: 'H'|'L'|'A'|null, isPanic: boolean } */
  evaluate(_data) {
    return { abnormalFlag: null, isPanic: false };
  }

  /** Human-readable one-liner for reports and notifications */
  summarize(_data) {
    return '';
  }
}

class QuantitativeResult extends ResultType {
  validate(data) {
    const value = Number(data && data.value);
    if (data == null || data.value === '' || data.value === null || !Number.isFinite(value)) {
      throw badRequest('Quantitative result requires a numeric "value"');
    }
    return { value, comment: data.comment ? String(data.comment) : undefined };
  }

  evaluate({ value }) {
    const t = this.test;
    let abnormalFlag = null;
    if (t.ref_low !== null && value < t.ref_low) abnormalFlag = 'L';
    if (t.ref_high !== null && value > t.ref_high) abnormalFlag = 'H';
    const isPanic =
      (t.panic_low !== null && value <= t.panic_low) ||
      (t.panic_high !== null && value >= t.panic_high);
    return { abnormalFlag, isPanic };
  }

  summarize({ value }) {
    const t = this.test;
    const range = t.ref_low !== null || t.ref_high !== null ? ` (ref ${t.ref_low ?? ''}-${t.ref_high ?? ''})` : '';
    return `${value}${t.unit ? ' ' + t.unit : ''}${range}`;
  }
}

const QUALITATIVE_VALUES = ['positive', 'negative', 'indeterminate'];

class QualitativeResult extends ResultType {
  validate(data) {
    const interpretation = String((data && data.interpretation) || '').toLowerCase();
    if (!QUALITATIVE_VALUES.includes(interpretation)) {
      throw badRequest(`Qualitative result "interpretation" must be one of: ${QUALITATIVE_VALUES.join(', ')}`);
    }
    return { interpretation, comment: data.comment ? String(data.comment) : undefined };
  }

  evaluate({ interpretation }) {
    const abnormal = interpretation === 'positive';
    return {
      abnormalFlag: abnormal ? 'A' : null,
      isPanic: abnormal && !!this.test.panic_on_positive,
    };
  }

  summarize({ interpretation }) {
    return interpretation[0].toUpperCase() + interpretation.slice(1);
  }
}

const SIR = ['S', 'I', 'R'];

class CultureResult extends ResultType {
  validate(data) {
    if (!data || typeof data.growth !== 'boolean') {
      throw badRequest('Culture result requires boolean "growth"');
    }
    if (!data.growth) return { growth: false, comment: data.comment ? String(data.comment) : undefined };

    if (!data.organism || !String(data.organism).trim()) {
      throw badRequest('Culture with growth requires "organism"');
    }
    const sensitivities = Array.isArray(data.sensitivities) ? data.sensitivities : [];
    if (sensitivities.length === 0) {
      throw badRequest('Culture with growth requires at least one antibiotic sensitivity');
    }
    const normalized = sensitivities.map((s, i) => {
      const antibiotic = String((s && s.antibiotic) || '').trim();
      const interpretation = String((s && s.interpretation) || '').toUpperCase();
      if (!antibiotic || !SIR.includes(interpretation)) {
        throw badRequest(`Sensitivity #${i + 1} needs "antibiotic" and interpretation S, I, or R`);
      }
      return { antibiotic, interpretation };
    });
    return {
      growth: true,
      organism: String(data.organism).trim(),
      sensitivities: normalized,
      comment: data.comment ? String(data.comment) : undefined,
    };
  }

  evaluate({ growth }) {
    return { abnormalFlag: growth ? 'A' : null, isPanic: growth && !!this.test.panic_on_positive };
  }

  summarize(d) {
    if (!d.growth) return 'No growth';
    return `${d.organism}: ${d.sensitivities.map((s) => `${s.antibiotic} ${s.interpretation}`).join(', ')}`;
  }
}

const REGISTRY = {
  quantitative: QuantitativeResult,
  qualitative: QualitativeResult,
  culture: CultureResult,
};

/** Factory: returns the right ResultType for a catalogue test row. */
function resultTypeFor(test) {
  const Cls = REGISTRY[test.category];
  if (!Cls) throw badRequest(`Unknown result category "${test.category}"`);
  return new Cls(test);
}

module.exports = { ResultType, QuantitativeResult, QualitativeResult, CultureResult, resultTypeFor };
