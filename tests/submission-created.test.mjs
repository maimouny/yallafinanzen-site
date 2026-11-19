import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import handler, { sanitizeLead, buildUpdateBody, syncLeadToMonday, LeadSyncError } from '../netlify/functions/submission-created.mjs';

const ENV = {
  MONDAY_API_TOKEN: 'test-token',
  MONDAY_BOARD_ID: '123',
  MONDAY_COLUMN_EMAIL: 'email',
  MONDAY_COLUMN_PHONE: 'telefon',
  MONDAY_COLUMN_SOURCE: 'quelle',
};

const realFetch = globalThis.fetch;
let calls;

function mockMonday(responses) {
  calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options, body: JSON.parse(options.body) });
    const next = responses.shift();
    return new Response(JSON.stringify(next.json), { status: next.status ?? 200 });
  };
}

beforeEach(() => { calls = []; });
afterEach(() => { globalThis.fetch = realFetch; });

test('verwirft unbekannte Felder (Allowlist)', () => {
  const lead = sanitizeLead('termin', { name: 'Amira', email: 'a@example.com', isAdmin: 'true', role: 'admin' });
  assert.deepEqual(Object.keys(lead).sort(), ['email', 'formular', 'name']);
});

test('lehnt unbekannte Formulare ab', () => {
  assert.throws(() => sanitizeLead('admin', { email: 'a@example.com' }), (e) => e instanceof LeadSyncError && e.code === 'UNKNOWN_FORM');
});

test('verlangt eine gültige E-Mail oder Telefonnummer', () => {
  assert.throws(() => sanitizeLead('termin', { name: 'X', email: 'kein-mail', telefon: 'abc' }), (e) => e.code === 'NO_CONTACT');
  assert.equal(sanitizeLead('investieren', { telefon: '+49 170 1234567' }).telefon, '+49 170 1234567');
});

test('kürzt überlange Werte', () => {
  const lead = sanitizeLead('termin', { email: 'a@example.com', name: 'x'.repeat(5000) });
  assert.equal(lead.name.length, 100);
});

test('escaped HTML im Update-Text', () => {
  const body = buildUpdateBody(sanitizeLead('termin', { email: 'a@example.com', name: '<img src=x onerror=alert(1)>' }));
  assert.ok(!body.includes('<img'));
  assert.ok(body.includes('&lt;img'));
});

test('legt Eintrag und Update in monday an, Werte nur als GraphQL-Variablen', async () => {
  mockMonday([
    { json: { data: { create_item: { id: '987' } } } },
    { json: { data: { create_update: { id: '1' } } } },
  ]);
  const id = await syncLeadToMonday('investieren', { telefon: '+49 170 1234567', kanal: 'whatsapp', sprache: 'ar' }, ENV);
  assert.equal(id, '987');
  assert.equal(calls.length, 2);
  assert.equal(calls[0].options.headers.Authorization, 'test-token');
  assert.ok(!calls[0].body.query.includes('+49 170 1234567'), 'Eingaben dürfen nicht in den Query-Text');
  assert.deepEqual(JSON.parse(calls[0].body.variables.columns), { telefon: '+49 170 1234567', quelle: 'investieren · whatsapp' });
  assert.equal(calls[1].body.variables.item, '987');
});

test('meldet API-Fehler von monday', async () => {
  mockMonday([{ json: { errors: [{ message: 'nope' }] } }]);
  await assert.rejects(syncLeadToMonday('termin', { email: 'a@example.com' }, ENV), (e) => e.code === 'MONDAY_API_ERROR');
});

test('ohne Konfiguration wird nichts gesendet', async () => {
  mockMonday([]);
  await assert.rejects(syncLeadToMonday('termin', { email: 'a@example.com' }, {}), (e) => e.code === 'NOT_CONFIGURED');
  assert.equal(calls.length, 0);
});

test('Handler loggt keine personenbezogenen Daten', async () => {
  mockMonday([{ status: 500, json: {} }]);
  const logged = [];
  const origError = console.error;
  console.error = (line) => logged.push(line);
  Object.assign(process.env, ENV);
  try {
    const request = new Request('http://localhost', {
      method: 'POST',
      body: JSON.stringify({ payload: { form_name: 'termin', data: { name: 'Amira Test', email: 'amira@example.com' } } }),
    });
    await assert.rejects(handler(request));
  } finally {
    console.error = origError;
    for (const key of Object.keys(ENV)) delete process.env[key];
  }
  assert.equal(logged.length, 1);
  assert.ok(!logged[0].includes('amira'), 'keine E-Mail im Log');
  assert.ok(!logged[0].includes('Amira'), 'kein Name im Log');
  assert.ok(logged[0].includes('MONDAY_HTTP_500'));
});
