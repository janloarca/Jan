// Correos del modo institucional. Siempre en inglés (regla del producto para
// todo correo saliente) y SIN contenido sensible: una invitación nombra a la
// firma y lleva el link; un aviso de mensaje nunca trae el texto del mensaje.
import { renderEmail } from '@/lib/emailLayout'

const BASE_URL = 'https://chispu.xyz'

export function inviteUrl(token) {
  return `${BASE_URL}/invitacion?t=${encodeURIComponent(token)}`
}

export function memberInviteEmail({ orgName, inviterName, role, token }) {
  const url = inviteUrl(token)
  const roleLabel = role === 'admin' ? 'an administrator' : role === 'assistant' ? 'an assistant' : 'an advisor'
  const mail = renderEmail({
    title: `Join ${orgName} on Chispu`,
    subtitle: 'Team invitation',
    preheader: `You have been invited to join ${orgName} on Chispu. Open this email to accept the invitation with your account.`,
    sections: [{
      paragraphs: [
        `${inviterName || 'An administrator'} invited you to join ${orgName} as ${roleLabel}.`,
        'Accept with the Chispu account that uses this email address. The invitation works once and expires in 14 days.',
      ],
      cta: { label: 'Accept invitation', url },
    }],
    reason: `You are receiving this because someone at ${orgName} entered your email address.`,
  })
  return { subject: `You are invited to join ${orgName} on Chispu`, ...mail }
}

export function clientInviteEmail({ orgName, advisorName, token }) {
  const url = inviteUrl(token)
  const mail = renderEmail({
    title: `${orgName} would like to view your portfolio`,
    subtitle: 'Read-only access request',
    preheader: `${orgName} is asking for read-only access to your Chispu portfolio. Open this email to review what they would see.`,
    sections: [{
      paragraphs: [
        `${advisorName || 'Your advisor'} at ${orgName} is asking for read-only access to your portfolio on Chispu.`,
        'They cannot move your money or change your data. You choose what they can see, and you can revoke access at any time from Settings.',
        'If you already use Chispu, sign in with your existing account: nothing is copied or migrated. The invitation works once and expires in 14 days.',
      ],
      cta: { label: 'Review the request', url },
    }],
    reason: `You are receiving this because ${orgName} entered your email address. If you do not know them, ignore this message.`,
  })
  return { subject: `${orgName} would like read-only access to your portfolio`, ...mail }
}

export function newMessageEmail({ fromName, toAdvisor, clientUid }) {
  const url = toAdvisor ? `${BASE_URL}/asesor/clientes/${encodeURIComponent(clientUid)}?tab=mensajes` : `${BASE_URL}/tu-asesor`
  const mail = renderEmail({
    title: 'You have a new message on Chispu',
    subtitle: fromName ? `From ${fromName}` : undefined,
    preheader: 'You have a new message waiting on Chispu. Open the app to read it: the content is not included in this email.',
    sections: [{
      paragraphs: ['Open Chispu to read it. For your privacy, the content of the message is not included in this email.'],
      cta: { label: 'Open the conversation', url },
    }],
    reason: 'You are receiving this because you have an active advisor link on Chispu.',
  })
  return { subject: 'New message on Chispu', ...mail }
}
