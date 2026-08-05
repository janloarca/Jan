export const metadata = { title: 'Política de Privacidad · Chispudo' }

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
            ← Volver
          </a>
          <div className="flex items-center gap-2 mb-2">
            <span className="text-2xl" style={{ color: 'var(--accent-blue)' }}>⚡</span>
            <h1 className="text-2xl font-bold" style={{ color: 'var(--accent-blue)' }}>Chispudo</h1>
          </div>
          <h1 className="text-xl font-bold text-white">Política de Privacidad</h1>
          <p className="text-xs mt-1" style={{ color: 'var(--text-tertiary, var(--text-secondary))' }}>
            Última actualización: 29 de julio de 2026
          </p>
        </div>

        <Section title="1. Qué datos recopilamos">
          <ul className="list-disc pl-5 space-y-1.5">
            <li>Datos de cuenta: email y contraseña (o tu cuenta de Google, si iniciás sesión así).</li>
            <li>Datos financieros que ingresás o importás: activos, transacciones, valuaciones, metas.</li>
            <li>Credenciales de broker, cifradas (AES-256-GCM), si conectás una integración por API.</li>
            <li>Archivos que subís para importar (CSV, Excel, PDF de estados de cuenta).</li>
            <li>Datos técnicos básicos (idioma, moneda base, zona horaria) para que la app funcione bien.</li>
          </ul>
          <p>No pedimos ni almacenamos tu número de tarjeta ni credenciales bancarias de acceso directo.</p>
        </Section>

        <Section title="2. Para qué los usamos">
          <p>
            Para calcular y mostrarte el valor y rendimiento de tu portafolio, sincronizar con los brokers
            que conectés, convertir estados de cuenta con IA cuando lo pedís, y enviarte notificaciones que
            vos activás (vencimientos, dividendos, recordatorios). Nunca vendemos tus datos financieros.
          </p>
        </Section>

        <Section title="3. Con quién los compartimos">
          <p>Usamos los siguientes proveedores para operar la plataforma (subencargados de tratamiento):</p>
          <ul className="list-disc pl-5 space-y-1.5">
            <li><span className="text-white">Firebase / Google Cloud</span>: autenticación y base de datos (Firestore).</li>
            <li><span className="text-white">Anthropic (Claude)</span>: solo si subís un PDF para convertirlo — el archivo se envía a su API para extraer los datos, con tu confirmación antes de guardar cualquier cosa.</li>
            <li><span className="text-white">Yahoo Finance / CoinGecko</span>: precios de mercado en tiempo real.</li>
            <li><span className="text-white">Proveedores de tipo de cambio</span>: para convertir entre monedas.</li>
            <li><span className="text-white">Vercel</span>: hosting de la aplicación.</li>
          </ul>
          <p>
            Con brokers (por ejemplo Interactive Brokers) solo hay conexión de LECTURA cuando vos das tu
            token; nunca compartimos tus credenciales con nadie más.
          </p>
          <p>
            Si activás la función Amigos, se comparte con otros usuarios del grupo únicamente un
            seudónimo, tu retorno en porcentaje y los símbolos de tus activos con más movimiento — nunca
            montos en dinero ni el detalle de tu portafolio.
          </p>
        </Section>

        <Section title="4. Seguridad">
          <p>
            Las credenciales de broker se cifran con AES-256-GCM antes de guardarse. El acceso a tus datos
            en la base de datos está restringido por reglas que niegan todo por defecto salvo tu propia
            cuenta; los datos entre usuarios (como Amigos) solo se leen a través de rutas del servidor con
            verificación de identidad, nunca directo desde el navegador de otro usuario.
          </p>
        </Section>

        <Section title="5. Cuánto tiempo guardamos tus datos">
          <p>
            Mientras tu cuenta exista. Si borrás tu cuenta o usás "Borrar todo" en Configuración,
            eliminamos tus activos, transacciones, historial, conexiones de broker y tu perfil de Amigos.
          </p>
        </Section>

        <Section title="6. Tus derechos">
          <p>
            Podés acceder, corregir o eliminar tus datos vos mismo desde la app en cualquier momento (no
            necesitás pedírnoslo). Si preferís que lo hagamos nosotros, o tenés cualquier duda sobre tus
            datos, escribinos a <a href="mailto:janmarcof@gmail.com" style={{ color: 'var(--accent-blue)' }}>janmarcof@gmail.com</a>.
          </p>
        </Section>

        <Section title="7. Menores de edad">
          <p>Chispudo no está dirigido a menores de 18 años y no recopilamos a sabiendas sus datos.</p>
        </Section>

        <Section title="8. Cambios a esta política">
          <p>
            Si hacemos cambios importantes te avisamos dentro de la app. La fecha de arriba indica la
            última actualización.
          </p>
        </Section>

        <Section title="9. Contacto">
          <p>
            <a href="mailto:janmarcof@gmail.com" style={{ color: 'var(--accent-blue)' }}>janmarcof@gmail.com</a>
          </p>
        </Section>

        <p className="text-xs pt-6 border-t border-glass-border" style={{ color: 'var(--text-tertiary, var(--text-secondary))' }}>
          Ver también nuestros <a href="/terms" style={{ color: 'var(--accent-blue)' }}>Términos de Servicio</a>.
        </p>
      </div>
    </div>
  )
}
