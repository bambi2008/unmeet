const crypto = require('node:crypto');

const STRIPE_API = 'https://api.stripe.com/v1';

function configured() {
  return Boolean(process.env.STRIPE_SECRET_KEY && (process.env.STRIPE_PRICE_STARTER || process.env.STRIPE_PRICE_TEAM));
}

async function stripeRequest(endpoint, params) {
  if (!process.env.STRIPE_SECRET_KEY) throw new Error('Stripe is not configured.');
  const response = await fetch(`${STRIPE_API}${endpoint}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params),
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error?.message || 'Stripe request failed.');
  return payload;
}

async function createCheckout({ workspace, user, plan, baseUrl }) {
  const price = plan === 'starter' ? process.env.STRIPE_PRICE_STARTER : plan === 'team' ? process.env.STRIPE_PRICE_TEAM : null;
  if (!price) throw new Error(`Stripe price for ${plan} is not configured.`);
  const params = {
    mode: 'subscription',
    client_reference_id: workspace.id,
    'line_items[0][price]': price,
    'line_items[0][quantity]': '1',
    success_url: `${baseUrl}/?billing=success`,
    cancel_url: `${baseUrl}/?billing=canceled`,
    allow_promotion_codes: 'true',
    'automatic_tax[enabled]': 'true',
    'subscription_data[metadata][workspace_id]': workspace.id,
    'subscription_data[metadata][plan]': plan,
    'metadata[workspace_id]': workspace.id,
    'metadata[plan]': plan,
  };
  if (workspace.stripeCustomerId) params.customer = workspace.stripeCustomerId;
  else params.customer_email = user.email;
  return stripeRequest('/checkout/sessions', params);
}

async function createPortal({ workspace, baseUrl }) {
  if (!workspace.stripeCustomerId) throw new Error('No Stripe customer exists for this workspace.');
  return stripeRequest('/billing_portal/sessions', { customer: workspace.stripeCustomerId, return_url: `${baseUrl}/?billing=portal_return` });
}

function verifyWebhook(rawBody, signatureHeader, secret = process.env.STRIPE_WEBHOOK_SECRET, toleranceSeconds = 300) {
  if (!secret) throw new Error('Stripe webhook secret is not configured.');
  const parts = String(signatureHeader || '').split(',').map(part => part.split('='));
  const timestamp = parts.find(([key]) => key === 't')?.[1];
  const signatures = parts.filter(([key]) => key === 'v1').map(([, value]) => value);
  if (!timestamp || !signatures.length) throw new Error('Stripe signature is missing.');
  if (Math.abs(Date.now() / 1000 - Number(timestamp)) > toleranceSeconds) throw new Error('Stripe signature timestamp is outside tolerance.');
  const expected = crypto.createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex');
  const valid = signatures.some(value => {
    const a = Buffer.from(value, 'hex'); const b = Buffer.from(expected, 'hex');
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  });
  if (!valid) throw new Error('Stripe signature verification failed.');
  return JSON.parse(rawBody);
}

function subscriptionUpdate(event) {
  const object = event.data?.object || {};
  if (event.type === 'checkout.session.completed') return {
    workspaceId: object.metadata?.workspace_id || object.client_reference_id,
    plan: object.metadata?.plan, status: 'active', customerId: object.customer, subscriptionId: object.subscription,
  };
  if (event.type.startsWith('customer.subscription.')) return {
    workspaceId: object.metadata?.workspace_id, plan: object.metadata?.plan,
    status: object.status === 'canceled' ? 'canceled' : object.status,
    customerId: object.customer, subscriptionId: object.id,
  };
  return null;
}

module.exports = { configured, createCheckout, createPortal, verifyWebhook, subscriptionUpdate };
