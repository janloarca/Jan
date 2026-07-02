// AdSense requires https://chispu.xyz/ads.txt declaring the publisher. Generated
// from the same env var that enables the ad slot, so there's a single switch:
// no NEXT_PUBLIC_ADSENSE_CLIENT → 404 here and no ad rendered.
export async function GET() {
  const client = process.env.NEXT_PUBLIC_ADSENSE_CLIENT
  if (!client) {
    return new Response('Not configured', { status: 404 })
  }
  // ads.txt wants the bare publisher id (pub-XXXX), without the "ca-" prefix.
  const pubId = client.replace(/^ca-/, '')
  return new Response(`google.com, ${pubId}, DIRECT, f08c47fec0942fa0\n`, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'public, max-age=86400',
    },
  })
}
