/** Public app identity only. Corpus and simulation APIs keep their own policy. */
export function GET() {
  return Response.json(
    { app: 'curvelab', status: 'ok', mode: 'simulation' },
    {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'no-store',
      },
    },
  )
}
