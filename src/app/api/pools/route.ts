import { listPools } from '@/lib/server/corpus'

/**
 * The corpus of verified mainnet launches available to replay against.
 *
 * Not cached: capture runs as a background job, so the corpus grows while the
 * server is up and a stale list would hide pools that are already usable.
 */
export async function GET() {
  return Response.json({ pools: listPools() })
}
