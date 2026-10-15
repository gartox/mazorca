const subjects = ['pod', 'leaf', 'tree', 'canopy', 'beans', 'other', 'unknown'];
const issues = [
  'moniliasis', 'black_pod', 'witches_broom', 'animal_damage', 'overripe', 'healthy',
  'excess_shade', 'needs_pruning', 'weeds', 'waterlogging', 'other', 'unknown'
];
const confidence = ['low', 'medium', 'high'];
const podIssues = new Set(['moniliasis', 'black_pod', 'animal_damage', 'overripe', 'healthy']);
const object = value => value && typeof value === 'object' && !Array.isArray(value) ? value : {};
const text = (value, max = 600) => typeof value === 'string' ? value.slice(0, max) : '';
const list = (value, max, size = 600) => Array.isArray(value)
  ? value.filter(item => typeof item === 'string').slice(0, max).map(item => text(item, size))
  : [];
const nonnegativeInteger = value => Number.isInteger(value) && value >= 0 ? value : 0;

export const observationSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    scene: { type: 'string' },
    people: { type: 'integer', minimum: 0 },
    fruitsVisible: { type: 'boolean' },
    fruitCountEstimate: { type: 'integer', minimum: 0 },
    closeUp: { type: 'boolean' },
    notableColors: { type: 'array', items: { type: 'string' } }
  },
  required: ['scene', 'people', 'fruitsVisible', 'fruitCountEstimate', 'closeUp', 'notableColors']
};

const findingSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    issue: { type: 'string', enum: issues },
    confidence: { type: 'string', enum: confidence },
    evidence: { type: 'string' }
  },
  required: ['issue', 'confidence', 'evidence']
};

export const diagnosisSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    subject: { type: 'string', enum: subjects },
    findings: { type: 'array', maxItems: 6, items: findingSchema },
    podCounts: {
      type: 'object',
      properties: {
        healthy: { type: 'integer', minimum: 0 },
        affected: { type: 'integer', minimum: 0 }
      },
      required: ['healthy', 'affected']
    },
    summary: { type: 'string' },
    actions: { type: 'array', maxItems: 4, items: { type: 'string' } },
    verify: { type: 'string' }
  },
  required: ['subject', 'findings', 'podCounts', 'summary', 'actions', 'verify']
};

const countProperties = ['brown', 'purple', 'slaty', 'moldy', 'other'];
const countSchema = Object.fromEntries(
  countProperties.map(name => [name, { type: 'integer', minimum: 0 }])
);

export const cutTestSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    counts: { type: 'object', properties: countSchema, required: countProperties },
    fermentationNote: { type: 'string' },
    confidence: { type: 'string', enum: confidence }
  },
  required: ['counts', 'fermentationNote', 'confidence']
};

export const planSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    headline: { type: 'string' },
    priorities: { type: 'array', maxItems: 4, items: { type: 'string' } },
    thisWeek: { type: 'array', maxItems: 5, items: { type: 'string' } },
    watch: { type: 'array', maxItems: 3, items: { type: 'string' } },
    disclaimer: { type: 'string' }
  },
  required: ['headline', 'priorities', 'thisWeek', 'watch', 'disclaimer']
};

export function normalizeObservation(value) {
  const data = object(value);
  return {
    scene: text(data.scene),
    people: nonnegativeInteger(data.people),
    fruitsVisible: data.fruitsVisible === true,
    fruitCountEstimate: nonnegativeInteger(data.fruitCountEstimate),
    closeUp: data.closeUp === true,
    notableColors: list(data.notableColors, 8, 80)
  };
}

function proportionalCounts(counts, limit) {
  const total = counts.healthy + counts.affected;
  if (total <= limit) return counts;
  const target = Math.max(0, Math.floor(limit));
  const healthy = Math.floor((counts.healthy / total) * target);
  return { healthy, affected: target - healthy };
}

export function enforceDiagnosisRules(value, observation) {
  const result = { ...value };
  if (!observation.fruitsVisible) {
    result.findings = value.findings.filter(finding => !podIssues.has(finding.issue));
    result.podCounts = { healthy: 0, affected: 0 };
    return result;
  }
  result.podCounts = proportionalCounts(
    result.podCounts,
    observation.fruitCountEstimate * 1.5 + 2
  );
  return result;
}

export function normalizeDiagnosis(value) {
  const data = object(value);
  const findings = Array.isArray(data.findings)
    ? data.findings.slice(0, 6).map(item => {
      const finding = object(item);
      return {
        issue: issues.includes(finding.issue) ? finding.issue : 'unknown',
        confidence: confidence.includes(finding.confidence) ? finding.confidence : 'low',
        evidence: text(finding.evidence, 300)
      };
    })
    : [];

  return {
    subject: subjects.includes(data.subject) ? data.subject : 'unknown',
    findings,
    podCounts: {
      healthy: nonnegativeInteger(data.podCounts?.healthy),
      affected: nonnegativeInteger(data.podCounts?.affected)
    },
    summary: text(data.summary),
    actions: list(data.actions, 4),
    verify: text(data.verify)
  };
}

export function normalizeCutTest(value) {
  const data = object(value);
  const counts = Object.fromEntries(
    countProperties.map(name => [name, nonnegativeInteger(data.counts?.[name])])
  );
  return {
    counts,
    fermentationNote: text(data.fermentationNote),
    confidence: confidence.includes(data.confidence) ? data.confidence : 'low'
  };
}

export function normalizePlan(value) {
  const data = object(value);
  return {
    headline: text(data.headline, 300),
    priorities: list(data.priorities, 4),
    thisWeek: list(data.thisWeek, 5),
    watch: list(data.watch, 3),
    disclaimer: text(data.disclaimer)
  };
}
