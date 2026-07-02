import { ADSENSE_CLIENT } from '@/lib/adsense'

// AdSense requires https://chispu.xyz/ads.txt declaring the publisher — it's also
// one of Google's accepted site-verification methods.
export async function GET() {
  if (!ADSENSE_CLIENT) {
    return new Response('Not configured', { status: 404 })
  }
  // ads.txt wants the bare publisher id (pub-XXXX), without the "ca-" prefix.
  const pubId = ADSENSE_CLIENT.replace(/^ca-/, '')
  return new Response(`google.com, ${pubId}, DIRECT, f08c47fec0942fa0\n`, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'public, max-age=86400',
    },
  })
}
