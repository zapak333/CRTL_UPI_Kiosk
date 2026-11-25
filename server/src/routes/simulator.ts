import { Router } from 'express';
import { config } from '../config.js';
import { ah } from '../lib/validate.js';
import { formatINR } from '../lib/money.js';
import { buildSimulatedWebhook, simLedger } from '../services/payments/simulated.js';

/**
 * Simulated UPI app + bank. Only mounted when PAYMENT_PROVIDER=simulated.
 * "Paying" here makes the simulated bank send a SIGNED webhook to our own webhook endpoint over HTTP,
 * so the exact production verification path is exercised.
 */
export const simulatorRouter = Router();

async function deliver(ref: string, outcome: 'success' | 'fail' | 'wrong_amount', times = 1) {
  const hook = buildSimulatedWebhook(ref, outcome);
  const results = [];
  for (let i = 0; i < times; i++) {
    const r = await fetch(`http://127.0.0.1:${config.port}/api/webhooks/simulated`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-sim-signature': hook.signature },
      body: hook.raw,
    });
    results.push(await r.json());
  }
  return results;
}

simulatorRouter.post('/api/simulator/:ref/:outcome', ah(async (req, res) => {
  const ref = String(req.params.ref);
  const outcome = req.params.outcome as string;
  if (!simLedger.has(ref)) return res.status(404).json({ error: 'Unknown or expired simulated QR' });
  if (outcome === 'duplicate') return res.json({ results: await deliver(ref, 'success', 3) });
  if (outcome === 'silent') {
    // Payment succeeds at the "bank" but the webhook is lost: the server must find it by API polling.
    buildSimulatedWebhook(ref, 'success');
    return res.json({ results: ['webhook suppressed'] });
  }
  if (!['success', 'fail', 'wrong_amount'].includes(outcome)) return res.status(400).json({ error: 'bad outcome' });
  res.json({ results: await deliver(ref, outcome as any) });
}));

simulatorRouter.get('/sim-upi/:ref', (req, res) => {
  const r = simLedger.get(String(req.params.ref));
  const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
  res.set('Content-Security-Policy', "default-src 'self'; style-src 'unsafe-inline'; script-src 'unsafe-inline'");
  res.send(`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Simulated UPI</title>
<style>body{font-family:system-ui,sans-serif;background:#f1f5f9;margin:0;padding:24px;color:#0f172a}.c{max-width:380px;margin:auto;background:#fff;border-radius:16px;padding:24px;box-shadow:0 4px 20px #0001}
.b{display:block;width:100%;padding:14px;border:0;border-radius:10px;font-size:16px;font-weight:600;margin-top:10px;cursor:pointer}.t{background:#fef3c7;color:#92400e;padding:8px 12px;border-radius:8px;font-size:13px}</style></head>
<body><div class="c"><div class="t">TEST MODE &mdash; simulated UPI app. No real money moves.</div>
${r ? `<h2>Pay ${esc(formatINR(r.amountPaise))}</h2><p>To: CRTL Canteen<br>Order: ${esc(r.orderNumber)}</p>
<button class="b" style="background:#16a34a;color:#fff" onclick="go('success')">Pay (success)</button>
<button class="b" style="background:#dc2626;color:#fff" onclick="go('fail')">Decline (failure)</button><p id="m"></p>` : '<p>This QR code is unknown or has expired.</p>'}
</div><script>async function go(o){const r=await fetch('/api/simulator/${esc(String(req.params.ref))}/'+o,{method:'POST'});document.getElementById('m').textContent=r.ok?'Done. Check the kiosk screen.':'Error';}</script></body></html>`);
});

simulatorRouter.get('/api/simulator/:ref', ah(async (req, res) => {
  const r = simLedger.get(String(req.params.ref));
  if (!r) return res.status(404).json({ error: 'unknown' });
  res.json({ status: r.status, amount: r.amountPaise });
}));
