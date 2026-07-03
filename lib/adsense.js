// Public AdSense publisher id — safe to commit (it's visible in any page's source).
// The site-verification snippet must be reachable by Google's crawler, which never
// sees the (auth-gated) dashboard, so app/layout.jsx injects it globally with this.
// Override or disable via NEXT_PUBLIC_ADSENSE_CLIENT (set to empty to turn off).
export const ADSENSE_CLIENT = process.env.NEXT_PUBLIC_ADSENSE_CLIENT ?? 'ca-pub-5733983572577760'

// Display ad unit for the dashboard banner (also public — it's in the rendered
// <ins> tag). Override or disable via NEXT_PUBLIC_ADSENSE_SLOT_FOOTER.
export const ADSENSE_SLOT_FOOTER = process.env.NEXT_PUBLIC_ADSENSE_SLOT_FOOTER ?? '5651452931'
