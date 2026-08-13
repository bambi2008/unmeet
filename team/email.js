function configured() { return Boolean(process.env.RESEND_API_KEY && process.env.UNMEET_FROM_EMAIL); }

async function sendInvite({ to, workspaceName, inviterName, role, inviteUrl, idempotencyKey }) {
  if (!configured()) return { sent: false, reason: 'not_configured' };
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
      'User-Agent': 'UnMeet/0.3',
      'Idempotency-Key': idempotencyKey,
    },
    body: JSON.stringify({
      from: process.env.UNMEET_FROM_EMAIL,
      to: [to],
      subject: `Join ${workspaceName} on UnMeet`,
      text: `${inviterName} invited you to join ${workspaceName} as ${role}.\n\nAccept your invitation: ${inviteUrl}\n\nThis link expires in 72 hours.`,
    }),
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.message || 'Invitation email could not be sent.');
  return { sent: true, id: payload.id };
}

module.exports = { configured, sendInvite };
