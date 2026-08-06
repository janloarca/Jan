import Logo from '@/components/ui/Logo'

export const metadata = { title: 'Términos de Servicio · Chispudo' }

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
            ← Volver
          </a>
          <div className="flex mb-2">
            <Logo size={22} />
          </div>
          <h1 className="text-xl font-bold text-white">Términos de Servicio</h1>
          <p className="text-xs mt-1" style={{ color: 'var(--text-tertiary, var(--text-secondary))' }}>
            Última actualización: 29 de julio de 2026
          </p>
        </div>

        <Section title="1. Qué es Chispudo">
          <p>
            Chispudo es una herramienta de seguimiento de patrimonio e inversiones. Te deja registrar,
            importar y visualizar la composición y el rendimiento de tus activos (cuentas de inversión,
            cripto, bienes raíces, cuentas bancarias, deudas, etc.), incluyendo conexiones de solo lectura
            con brokers y exchanges.
          </p>
          <p className="font-medium text-white">
            Chispudo nunca ejecuta operaciones, mueve dinero ni tiene acceso de escritura a tus cuentas
            de broker. Toda conexión con un tercero (API o archivo importado) es estrictamente de lectura.
          </p>
        </Section>

        <Section title="2. No es asesoría financiera">
          <p>
            Chispudo muestra cálculos (retornos, proyecciones, comparaciones contra índices, sugerencias
            de rebalanceo) construidos a partir de los datos que vos ingresás o importás. Estos cálculos
            son herramientas informativas, no recomendaciones de inversión, no son asesoría financiera,
            legal ni fiscal, y no sustituyen el consejo de un profesional. Las decisiones que tomés con
            tu dinero son tu responsabilidad.
          </p>
        </Section>

        <Section title="3. Exactitud de los datos">
          <p>
            Cuando no hay historial real disponible (por ejemplo, un broker que solo entrega estados de
            cuenta mensuales, o una posición recién importada sin fecha de compra), Chispudo reconstruye
            o estima valores pasados y lo indica en la interfaz. Los precios de mercado provienen de
            proveedores externos (Yahoo Finance, CoinGecko) y pueden tener demoras o interrupciones.
            Verificá siempre las cifras importantes contra el estado de cuenta oficial de tu broker antes
            de tomar una decisión basada en ellas.
          </p>
        </Section>

        <Section title="4. Tu cuenta">
          <p>
            Sos responsable de mantener la confidencialidad de tu contraseña y de toda actividad que
            ocurra en tu cuenta. Avisanos si sospechás un acceso no autorizado.
          </p>
        </Section>

        <Section title="5. Conexiones con brokers y credenciales">
          <p>
            Si conectás un broker por API (por ejemplo, Interactive Brokers), el token/credencial se
            guarda cifrado (AES-256-GCM) y solo se usa para consultar tus datos de solo lectura. Podés
            desconectar cualquier integración en cualquier momento desde Configuración; al hacerlo se
            borra la credencial guardada.
          </p>
        </Section>

        <Section title="6. Importación asistida por IA">
          <p>
            Si subís un estado de cuenta en PDF, Chispudo usa un modelo de IA (Claude, de Anthropic) para
            convertirlo a un formato que la plataforma puede leer. Vos revisás y confirmás cada fila antes
            de que se guarde nada: ningún dato extraído por la IA se importa automáticamente sin tu
            confirmación.
          </p>
        </Section>

        <Section title="7. La función Amigos">
          <p>
            Amigos es una función opcional de comparación social. Si la activás, se publica un perfil con
            un seudónimo y únicamente porcentajes de retorno y símbolos de los activos que más te movieron
            ese día — nunca montos en dinero. Podés desactivarla en cualquier momento desde Configuración;
            al hacerlo se borra tu perfil público y salís de todos los grupos.
          </p>
        </Section>

        <Section title="8. Eliminar tu cuenta y tus datos">
          <p>
            Desde Configuración → Datos podés borrar tu información (activos, historial, transacciones,
            conexiones de broker y tu perfil de Amigos) en cualquier momento. Es una acción irreversible.
          </p>
        </Section>

        <Section title="9. Propiedad">
          <p>
            Los datos financieros que ingresás o importás son tuyos. Chispudo es dueño del software, la
            marca y el diseño de la plataforma.
          </p>
        </Section>

        <Section title="10. Cambios a estos términos">
          <p>
            Podemos actualizar estos términos según evolucione el producto. Los cambios importantes se
            avisarán dentro de la app. El uso continuado después de un cambio implica que lo aceptás.
          </p>
        </Section>

        <Section title="11. Ley aplicable">
          <p>
            Estos términos se rigen por las leyes de Guatemala. Cualquier disputa se resolverá ante los
            tribunales competentes de Guatemala, salvo que la ley aplicable disponga lo contrario.
          </p>
        </Section>

        <Section title="12. Contacto">
          <p>
            Preguntas sobre estos términos: <a href="mailto:janmarcof@gmail.com" style={{ color: 'var(--accent-blue)' }}>janmarcof@gmail.com</a>
          </p>
        </Section>

        <p className="text-xs pt-6 border-t border-glass-border" style={{ color: 'var(--text-tertiary, var(--text-secondary))' }}>
          Ver también nuestra <a href="/privacy" style={{ color: 'var(--accent-blue)' }}>Política de Privacidad</a>.
        </p>
      </div>
    </div>
  )
}
