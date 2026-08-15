import Logo from '@/components/ui/Logo'

export const metadata = { title: 'Privacy Policy · Chispudo' }

function Section({ title, children }) {
  return (
    <section className="mb-8">
      <h2 className="text-lg font-semibold text-white mb-3">{title}</h2>
      <div className="space-y-3 text-sm leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
        {children}
      </div>
    </section>
  )
}

export default function PrivacyPage() {
  return (
    <div className="min-h-screen bg-theme-base py-12 px-6">
      <div className="max-w-2xl mx-auto">
        <div className="mb-10">
          <a href="/login" className="inline-flex items-center gap-2 mb-6 text-sm" style={{ color: 'var(--accent-blue)' }}>
            ← Back
          </a>
          <div className="flex mb-2">
            <Logo size={22} />
          </div>
          <h1 className="text-xl font-bold text-white">Privacy Policy</h1>
          <p className="text-xs mt-1" style={{ color: 'var(--text-tertiary, var(--text-secondary))' }}>
            Last updated: August 13, 2026
          </p>
        </div>

        <Section title="1. What we collect">
          <ul className="list-disc pl-5 space-y-1.5">
            <li>Account data: email and password (or your Google account, if you sign in that way).</li>
            <li>Financial data you enter or import: assets, transactions, valuations, goals.</li>
            <li>Broker credentials, encrypted (AES-256-GCM), if you connect an API integration.</li>
            <li>Files you upload to import (CSV, Excel, PDF statements).</li>
            <li>Basic technical data (language, base currency, time zone) so the app works correctly.</li>
          </ul>
          <p>We never ask for or store your card number or your direct banking login credentials.</p>
        </Section>

        <Section title="2. What we use it for">
          <p>
            To calculate and show you the value and performance of your portfolio, sync with the brokers
            you connect, convert statements with AI when you ask us to, and send you the notifications
            you turn on (maturities, dividends, reminders, periodic summaries). We never sell your
            financial data.
          </p>
        </Section>

        <Section title="3. Who we share it with">
          <p>We use the following providers to operate the platform (data subprocessors):</p>
          <ul className="list-disc pl-5 space-y-1.5">
            <li><span className="text-white">Firebase / Google Cloud</span>: authentication and database (Firestore).</li>
            <li><span className="text-white">Anthropic (Claude)</span>: only if you upload a PDF to convert. The file is sent to their API to extract the data, with your confirmation before anything is saved.</li>
            <li><span className="text-white">Public data sources</span>: real-time market prices (stocks, crypto, exchange rates).</li>
            <li><span className="text-white">Exchange rate providers</span>: to convert between currencies.</li>
            <li><span className="text-white">Vercel</span>: application hosting.</li>
            <li><span className="text-white">Email provider</span>: to deliver the notification emails you turn on. Your address is used only to send them.</li>
          </ul>
          <p>
            With brokers (for example Interactive Brokers) there is only a READ connection, and only when
            you provide your token. We never share your credentials with anyone else.
          </p>
          <p>
            If you turn on the Friends feature, the only things shared with other members of your group
            are a pseudonym, your return as a percentage, and the symbols of your most active assets.
            Never money amounts, and never the detail of your portfolio.
          </p>
        </Section>

        <Section title="4. Security">
          <p>
            Broker credentials are encrypted with AES-256-GCM before being stored. Access to your data in
            the database is restricted by rules that deny everything by default except your own account.
            Cross-user data (such as Friends) is only read through server routes with identity
            verification, never directly from another user&apos;s browser.
          </p>
        </Section>

        <Section title="5. Cookies and local storage">
          <p>
            We do not use advertising or tracking cookies of our own. Chispudo stores data in your
            browser (local storage and a session cookie) to keep you signed in and to remember your
            preferences, such as theme, language and base currency. The AdSense unit in the footer is
            served by Google and may set its own cookies, subject to Google&apos;s policies.
          </p>
        </Section>

        <Section title="6. How long we keep your data">
          <p>
            For as long as your account exists. If you delete your account or use &quot;Delete
            everything&quot; in Settings, we remove your assets, transactions, history, broker
            connections and your Friends profile.
          </p>
        </Section>

        <Section title="7. Your rights">
          <p>
            You can access, correct or delete your data yourself from inside the app at any time, without
            asking us. If you would rather we do it, or you have any question about your data, write to
            us at <a href="mailto:jan@chispu.xyz" style={{ color: 'var(--accent-blue)' }}>jan@chispu.xyz</a>.
          </p>
        </Section>

        <Section title="8. Minors">
          <p>Chispudo is not directed at people under 18 and we do not knowingly collect their data.</p>
        </Section>

        <Section title="9. Changes to this policy">
          <p>
            If we make significant changes we will let you know inside the app. The date at the top shows
            the last update.
          </p>
        </Section>

        <Section title="10. Contact">
          <p>
            <a href="mailto:jan@chispu.xyz" style={{ color: 'var(--accent-blue)' }}>jan@chispu.xyz</a>
          </p>
        </Section>

        <p className="text-xs pt-6 border-t border-glass-border" style={{ color: 'var(--text-tertiary, var(--text-secondary))' }}>
          See also our <a href="/terms" style={{ color: 'var(--accent-blue)' }}>Terms of Service</a>.
        </p>
      </div>
    </div>
  )
}
