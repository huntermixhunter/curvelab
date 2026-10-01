import CurveLab from '@/components/CurveLab'
import { listPools } from '@/lib/server/corpus'

/**
 * Read the corpus at request time.
 *
 * Capture runs as a background job, so the set of verified launches grows while
 * the server is running. Prerendering this page would freeze the pool list at
 * build time and hide every launch captured afterwards.
 */
export const dynamic = 'force-dynamic'

export default function Home() {
  return <CurveLab pools={listPools()} />
}
