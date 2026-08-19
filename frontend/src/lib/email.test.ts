// ─── Test: src/lib/email.ts — invio centralizzato (Notifications Round 2) ──
// Mirror di backend/lib/email.test.js: global.fetch sempre mockato, nessuna
// chiamata di rete reale.
import test from 'node:test';
import { describe } from 'node:test';
import assert from 'node:assert/strict';
import { sendEmail, sendTemplatedEmail } from './email.ts';

const originalFetch = globalThis.fetch;
function restoreFetch() {
  globalThis.fetch = originalFetch;
}
function installFetchSequence(handlers: Array<() => unknown>) {
  let i = 0;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).fetch = async () => {
    const handler = handlers[Math.min(i, handlers.length - 1)];
    i += 1;
    return handler();
  };
  return { callCount: () => i };
}
function okResponse() {
  return { ok: true, status: 200, text: async () => '' };
}
function errorResponse(status: number) {
  return { ok: false, status, text: async () => `errore ${status}` };
}

describe('sendEmail', () => {
  test('RESEND_API_KEY assente -> sent:false, skipped:true, nessuna fetch', async () => {
    delete process.env.RESEND_API_KEY;
    const tracker = installFetchSequence([() => okResponse()]);
    try {
      const result = await sendEmail('cliente@esempio.it', { subject: 'Ciao', html: '<p>Ciao</p>' });
      assert.equal(result.sent, false);
      assert.equal(result.skipped, true);
      assert.equal(tracker.callCount(), 0);
    } finally {
      restoreFetch();
    }
  });

  test('successo: from/reply-to/subject/html corretti nel body', async () => {
    process.env.RESEND_API_KEY = 'test-key';
    process.env.RESEND_FROM_EMAIL = 'noreply@esempio-agenzia.test';
    process.env.RESEND_REPLY_TO = 'supporto@esempio-agenzia.test';
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let capturedInit: any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).fetch = async (_url: string, init: any) => { capturedInit = init; return okResponse(); };
    try {
      const result = await sendEmail('cliente@esempio.it', { subject: 'Benvenuto', html: '<p>Ciao</p>' });
      assert.equal(result.sent, true);
      const body = JSON.parse(capturedInit.body);
      assert.equal(body.from, 'ShardApps <noreply@esempio-agenzia.test>');
      assert.deepEqual(body.to, ['cliente@esempio.it']);
      assert.deepEqual(body.reply_to, ['supporto@esempio-agenzia.test']);
      assert.equal(capturedInit.headers.Authorization, 'Bearer test-key');
    } finally {
      restoreFetch();
      delete process.env.RESEND_API_KEY;
      delete process.env.RESEND_FROM_EMAIL;
      delete process.env.RESEND_REPLY_TO;
    }
  });

  test('500 -> retry -> successo al secondo tentativo', async () => {
    process.env.RESEND_API_KEY = 'test-key';
    const tracker = installFetchSequence([() => errorResponse(500), () => okResponse()]);
    try {
      const result = await sendEmail('cliente@esempio.it', { subject: 'X', html: '<p>X</p>' });
      assert.equal(result.sent, true);
      assert.equal(tracker.callCount(), 2);
    } finally {
      restoreFetch();
      delete process.env.RESEND_API_KEY;
    }
  });

  test('400 -> NESSUN retry', async () => {
    process.env.RESEND_API_KEY = 'test-key';
    const tracker = installFetchSequence([() => errorResponse(400)]);
    try {
      const result = await sendEmail('cliente@esempio.it', { subject: 'X', html: '<p>X</p>' });
      assert.equal(result.sent, false);
      assert.equal(tracker.callCount(), 1);
    } finally {
      restoreFetch();
      delete process.env.RESEND_API_KEY;
    }
  });

  test('destinatario mancante -> sent:false, nessuna fetch', async () => {
    const tracker = installFetchSequence([() => okResponse()]);
    try {
      const result = await sendEmail('', { subject: 'X', html: '<p>X</p>' });
      assert.equal(result.sent, false);
      assert.equal(tracker.callCount(), 0);
    } finally {
      restoreFetch();
    }
  });
});

describe('sendTemplatedEmail', () => {
  test('template valido -> subject/html generati arrivano al body della richiesta', async () => {
    process.env.RESEND_API_KEY = 'test-key';
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let capturedInit: any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).fetch = async (_url: string, init: any) => { capturedInit = init; return okResponse(); };
    try {
      const result = await sendTemplatedEmail('cliente@esempio.it', 'password_reset', { resetLink: 'https://esempio.it/reset?token=abc' });
      assert.equal(result.sent, true);
      const body = JSON.parse(capturedInit.body);
      assert.equal(body.subject, 'Reimposta la tua password');
      assert.match(body.html, /esempio\.it\/reset\?token=abc/);
    } finally {
      restoreFetch();
      delete process.env.RESEND_API_KEY;
    }
  });

  test('nome template sconosciuto -> sent:false, nessuna fetch', async () => {
    const tracker = installFetchSequence([() => okResponse()]);
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = await sendTemplatedEmail('cliente@esempio.it', 'template_inventato' as any, {} as any);
      assert.equal(result.sent, false);
      assert.equal(tracker.callCount(), 0);
    } finally {
      restoreFetch();
    }
  });
});
