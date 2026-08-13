function configured() { return Boolean(process.env.RESEND_API_KEY && process.env.UNMEET_FROM_EMAIL); }

async function send({ to, subject, text, idempotencyKey }) {
  if (!configured()) return { sent: false, reason: 'not_configured' };
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json', 'User-Agent': 'UnMeet/0.4', 'Idempotency-Key': idempotencyKey },
    body: JSON.stringify({ from: process.env.UNMEET_FROM_EMAIL, to: [to], subject, text }),
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.message || 'Email could not be sent.');
  return { sent: true, id: payload.id };
}

async function sendInvite({ to, workspaceName, inviterName, role, inviteUrl, idempotencyKey }) {
  return send({ to, subject: `Join ${workspaceName} on UnMeet`, text: `${inviterName} invited you to join ${workspaceName} as ${role}.\n\nAccept your invitation: ${inviteUrl}\n\nThis link expires in 72 hours.`, idempotencyKey });
}

function sendVerification({ to, verifyUrl, idempotencyKey }) { return send({ to, subject: 'Verify your UnMeet email', text: `Verify your email to activate UnMeet:\n\n${verifyUrl}\n\nThis link expires in 24 hours.`, idempotencyKey }); }
function sendPasswordReset({ to, resetUrl, idempotencyKey }) { return send({ to, subject: 'Reset your UnMeet password', text: `Reset your UnMeet password:\n\n${resetUrl}\n\nThis link expires in 30 minutes. If you did not request this, ignore this email.`, idempotencyKey }); }

module.exports = { configured, sendInvite, sendVerification, sendPasswordReset };
