import Logo from '@/components/ui/Logo'

export const metadata = { title: 'Terms of Service · Chispudo' }

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

export default function TermsPage() {
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
          <h1 className="text-xl font-bold text-white">Terms of Service</h1>
          <p className="text-xs mt-1" style={{ color: 'var(--text-tertiary, var(--text-secondary))' }}>
            Last updated: August 13, 2026
          </p>
        </div>

        <Section title="1. What Chispudo is">
          <p>
            Chispudo is a net worth and investment tracking tool. It lets you record, import and
            visualize the composition and performance of your assets (investment accounts, crypto, real
            estate, bank accounts, debts, and so on), including read-only connections to brokers and
            exchanges.
          </p>
          <p className="font-medium text-white">
            Chispudo never places trades, never moves money, and never has write access to your broker
            accounts. Every third-party connection (API or imported file) is strictly read-only.
          </p>
        </Section>

        <Section title="2. Not financial advice">
          <p>
            Chispudo shows calculations (returns, projections, benchmark comparisons, rebalancing
            suggestions) built from the data you enter or import. These calculations are informational
            tools. They are not investment recommendations, they are not financial, legal or tax advice,
            and they do not replace a professional. Decisions you make with your money are your
            responsibility.
          </p>
        </Section>

        <Section title="3. Data accuracy">
          <p>
            When no real history is available (for example, a broker that only provides monthly
            statements, or a position imported without a purchase date), Chispudo reconstructs or
            estimates past values and marks them as such in the interface. Market prices come from
            external data sources and may be delayed or interrupted. Always verify important figures
            against your broker&apos;s official statement before making a decision based on them.
          </p>
        </Section>

        <Section title="4. Your account">
          <p>
            You are responsible for keeping your password confidential and for all activity that occurs
            under your account. Let us know if you suspect unauthorized access.
          </p>
        </Section>

        <Section title="5. Broker connections and credentials">
          <p>
            If you connect a broker over an API (for example, Interactive Brokers), the token or
            credential is stored encrypted (AES-256-GCM) and is used only to read your data. You can
            disconnect any integration at any time from Settings, which deletes the stored credential.
          </p>
        </Section>

        <Section title="6. AI-assisted import">
          <p>
            If you upload a PDF statement, Chispudo uses an AI model (Claude, by Anthropic) to convert it
            into a format the platform can read. You review and confirm every row before anything is
            saved: no AI-extracted data is imported automatically without your confirmation.
          </p>
        </Section>

        <Section title="7. The Friends feature">
          <p>
            Friends is an optional social comparison feature. If you turn it on, a profile is published
            with a pseudonym and only percentage returns and the symbols of the assets that moved you
            most that day. Never money amounts. You can turn it off at any time from Settings, which
            deletes your public profile and removes you from all groups.
          </p>
        </Section>

        <Section title="8. Deleting your account and your data">
          <p>
            From Settings → Data you can delete your information (assets, history, transactions, broker
            connections and your Friends profile) at any time. This action cannot be undone.
          </p>
        </Section>

        <Section title="9. Ownership">
          <p>
            The financial data you enter or import is yours. Chispudo owns the software, the brand and
            the design of the platform.
          </p>
        </Section>

        <Section title="10. Service provided as is">
          <p>
            Chispudo is provided as is, without warranties of any kind, express or implied. We do not
            guarantee that the service will be uninterrupted, error-free, or that the figures it displays
            are complete or accurate, particularly where they depend on external data sources or on
            reconstructed history.
          </p>
          <p>
            To the maximum extent permitted by law, Chispudo is not liable for investment losses, lost
            profits, or any indirect or consequential damages arising from your use of the service or
            from reliance on the figures it displays. This is why section 3 asks you to verify important
            figures against your broker&apos;s official statement.
          </p>
        </Section>

        <Section title="11. Suspension and termination">
          <p>
            You may stop using Chispudo and delete your account at any time. We may suspend or terminate
            an account that abuses the service, attempts to access another user&apos;s data, or violates
            these terms. Where possible we will give notice first so you can export your data.
          </p>
        </Section>

        <Section title="12. Changes to these terms">
          <p>
            We may update these terms as the product evolves. Significant changes will be announced
            inside the app. Continued use after a change means you accept it.
          </p>
        </Section>

        <Section title="13. Governing law">
          <p>
            These terms are governed by the laws of Guatemala. Any dispute will be resolved before the
            competent courts of Guatemala, unless applicable law provides otherwise.
          </p>
        </Section>

        <Section title="14. Contact">
          <p>
            Questions about these terms: <a href="mailto:jan@chispu.xyz" style={{ color: 'var(--accent-blue)' }}>jan@chispu.xyz</a>
          </p>
        </Section>

        <p className="text-xs pt-6 border-t border-glass-border" style={{ color: 'var(--text-tertiary, var(--text-secondary))' }}>
          See also our <a href="/privacy" style={{ color: 'var(--accent-blue)' }}>Privacy Policy</a>.
        </p>
      </div>
    </div>
  )
}
