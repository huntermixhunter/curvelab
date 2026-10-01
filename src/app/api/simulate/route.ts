import { runSimulation } from '@/lib/server/simulate-service'
import type { CurveRequest, SimulateRequest } from '@/lib/api/types'
import { SIMULATION_LIMITS as LIMITS, SimulationInputError } from '@/lib/api/limits'

/** Bounds that keep a request inside what the SDK will actually build. */
class BadRequest extends SimulationInputError {}

function num(value: unknown, field: string, { min, max }: { min: number; max: number }): number {
  const n = Number(value)
  if (!Number.isFinite(n)) throw new BadRequest(`${field} must be a finite number`)
  if (n < min || n > max) throw new BadRequest(`${field} must be between ${min} and ${max}`)
  return n
}

function parseCurve(raw: unknown, i: number): CurveRequest {
  const c = raw as Partial<CurveRequest>
  if (!c || typeof c !== 'object' || !c.curve) throw new BadRequest(`curves[${i}] is malformed`)

  return {
    id: String(c.id ?? `curve-${i}`).slice(0, 64),
    label: String(c.label ?? `Curve ${i + 1}`).slice(0, 48),
    slot: Math.max(0, Math.min(2, Math.floor(Number(c.slot ?? i)) || 0)),
    curve: {
      migrationThresholdQuote: num(
        c.curve.migrationThresholdQuote,
        `curves[${i}].migrationThresholdQuote`,
        LIMITS.threshold,
      ),
      // A length at or below 1 would put migration at or under the start price,
      // which the SDK rejects from deep inside its curve solver with a message
      // that says nothing useful. Bounding it here turns a 500 into a clear 400.
      curveLength: num(c.curve.curveLength, `curves[${i}].curveLength`, LIMITS.curveLength),
      baseFeeBps: Math.round(num(c.curve.baseFeeBps, `curves[${i}].baseFeeBps`, LIMITS.baseFeeBps)),
      creatorTradingFeePercentage: Math.round(
        num(c.curve.creatorTradingFeePercentage ?? 0, `curves[${i}].creatorTradingFeePercentage`, { min: 0, max: 100 }),
      ),
      totalTokenSupply: Math.round(num(c.curve.totalTokenSupply, `curves[${i}].totalTokenSupply`, LIMITS.supply)),
    },
  }
}

function parseRequest(body: unknown): SimulateRequest {
  const b = body as Partial<SimulateRequest>
  if (!b || typeof b !== 'object') throw new BadRequest('body must be a JSON object')
  if (!Array.isArray(b.curves) || b.curves.length === 0) throw new BadRequest('curves must be a non-empty array')
  if (b.curves.length > LIMITS.curves) throw new BadRequest(`at most ${LIMITS.curves} curves per request`)

  const curves = b.curves.map(parseCurve)
  const d = b.demand
  if (!d || typeof d !== 'object') throw new BadRequest('demand is required')

  if (d.kind === 'pool') {
    if (typeof d.pool !== 'string' || !d.pool) throw new BadRequest('demand.pool is required')
    return { curves, demand: { kind: 'pool', pool: d.pool } }
  }
  if (d.kind === 'synthetic') {
    const shape = d.shape
    if (shape !== 'flat' && shape !== 'frontloaded' && shape !== 'organic') {
      throw new BadRequest('demand.shape must be flat, frontloaded, or organic')
    }
    return {
      curves,
      demand: {
        kind: 'synthetic',
        shape,
        buys: Math.round(num(d.buys, 'demand.buys', LIMITS.buys)),
        totalQuote: num(d.totalQuote, 'demand.totalQuote', LIMITS.totalQuote),
      },
    }
  }
  throw new BadRequest('demand.kind must be synthetic or pool')
}

export async function POST(request: Request) {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: 'body must be valid JSON' }, { status: 400 })
  }

  try {
    return Response.json(runSimulation(parseRequest(body)))
  } catch (e) {
    if (e instanceof SimulationInputError) return Response.json({ error: e.message }, { status: 400 })
    // Anything else is a bug in the engine rather than in the request, and the
    // message is the most useful thing a developer can get back.
    console.error('simulate failed', e)
    return Response.json({ error: `simulation failed: ${(e as Error).message}` }, { status: 500 })
  }
}
