import Ajv from 'ajv';
import { randomUUID } from 'node:crypto';
const ajv = new Ajv({ allErrors: true });
export const responseSchema = decisions => ({
  type: 'object', additionalProperties: false,
  properties: { decision: { type: 'string', enum: decisions }, amountUsd: { type: 'number', minimum: 0, maximum: 100000 }, evidence: { type: 'array', minItems: 1, maxItems: 12, items: { type: 'string', minLength: 1, maxLength: 1500 } }, reason: { type: 'string', minLength: 1, maxLength: 4000 } },
  required: ['decision', 'amountUsd', 'evidence', 'reason']
});
const validators = new Map();
export function validateResponse(value, role) {
  if (!validators.has(role)) validators.set(role, ajv.compile(responseSchema(role === 'Critic' ? ['ACCEPT', 'REJECT', 'REQUEST REVISION'] : ['BUY', 'SELL', 'HOLD'])));
  if (!validators.get(role)(value)) throw Error('Agent response failed schema validation');
  if (role === 'Critic' && value.amountUsd !== 0) throw Error('Critic cannot set a trade amount');
  if (role !== 'Critic' && value.decision === 'HOLD' && value.amountUsd !== 0) throw Error('HOLD amount must be zero');
  if (role !== 'Critic' && value.decision !== 'HOLD' && value.amountUsd <= 0) throw Error('Trade amount must be positive');
  return value;
}
const envelopeValidator = ajv.compile({
  type: 'object', additionalProperties: false,
  properties: { symbol: { type: 'string', enum: ['BTC-USD', 'ETH-USD', 'SOL-USD', 'ZEC-USD', 'PUMP-USD'] }, id: { type: 'string', minLength: 1 }, proposalId: { type: 'string', minLength: 1 }, sender: { enum: ['Analyst', 'Critic', 'Controller', 'Risk'] }, recipient: { enum: ['Analyst', 'Critic', 'Controller', 'Risk', 'User'] }, timestamp: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}T' }, decision: { enum: ['BUY', 'SELL', 'HOLD', 'ACCEPT', 'REJECT', 'REQUEST REVISION', 'APPROVED', 'EXECUTED', 'FAILED', 'CANCELLED'] }, evidence: { type: 'array', minItems: 1, items: { type: 'string' } }, reason: { type: 'string', minLength: 1 }, amountUsd: { type: 'number', minimum: 0 }, source: { enum: ['codex', 'code', 'offline-fixture'] } },
  required: ['id', 'proposalId', 'sender', 'recipient', 'timestamp', 'decision', 'evidence', 'reason', 'amountUsd', 'source']
});
export function message(proposalId, sender, recipient, body, source = 'code', now = Date.now()) {
  const m = { symbol: body.symbol ?? 'BTC-USD', id: randomUUID(), proposalId, sender, recipient, timestamp: new Date(now).toISOString(), decision: body.decision, evidence: body.evidence, reason: body.reason, amountUsd: body.amountUsd ?? 0, source };
  if (!envelopeValidator(m)) throw Error('Invalid message envelope');
  return m;
}
