import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import handler, { sanitizeLead, buildUpdateBody, syncLeadToMonday, LeadSyncError, normalizePhone, countryOf } from '../netlify/functions/submission-created.mjs';

const ENV = {
  MONDAY_API_TOKEN: 'test-token',
  MONDAY_BOARD_ID: '123',
  MONDAY_COLUMN_EMAIL: 'email',
  MONDAY_COLUMN_PHONE: 'telefon',
  MONDAY_COLUMN_SOURCE: 'quelle',
  MONDAY_COLUMN_CHANNEL: 'kontaktweg',
  MONDAY_COLUMN_CAMPAIGN: 'kampagne',
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
  assert.deepEqual(Object.keys(lead).sort(), ['email', 'formular', 'kanal', 'name']);
});

test('lehnt unbekannte Formulare ab', () => {
  assert.throws(() => sanitizeLead('admin', { email: 'a@example.com' }), (e) => e instanceof LeadSyncError && e.code === 'UNKNOWN_FORM');
});

test('verlangt eine gültige E-Mail oder Telefonnummer', () => {
  assert.throws(() => sanitizeLead('termin', { name: 'X', email: 'kein-mail', telefon: 'abc' }), (e) => e.code === 'NO_CONTACT');
  assert.equal(sanitizeLead('investieren', { telefon: '+49 170 1234567' }).telefon, '+491701234567');
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
  const id = await syncLeadToMonday('investieren', { name: 'Amira', telefon: '0170 1234567', kanal: 'whatsapp', sprache: 'ar', seite: 'https://yallafinanzen.de/preise?utm_campaign=herbst-ar' }, ENV);
  assert.equal(id, '987');
  assert.equal(calls.length, 2);
  assert.equal(calls[0].options.headers.Authorization, 'test-token');
  assert.ok(!calls[0].body.query.includes('1701234567'), 'Eingaben dürfen nicht in den Query-Text');
  assert.equal(calls[0].body.variables.name, 'Amira');
  assert.deepEqual(JSON.parse(calls[0].body.variables.columns), {
    telefon: { phone: '+491701234567', countryShortName: 'DE' },
    kontaktweg: { label: 'WhatsApp' },
    quelle: 'investieren · /preise',
    kampagne: 'herbst-ar',
  });
  assert.equal(calls[1].body.variables.item, '987');
});

test('meldet API-Fehler von monday', async () => {
  mockMonday([{ json: { errors: [{ message: 'nope' }] } }, { json: { errors: [{ message: 'nope' }] } }]);
  await assert.rejects(syncLeadToMonday('termin', { email: 'a@example.com' }, ENV), (e) => e.code === 'MONDAY_API_ERROR');
  assert.equal(calls.length, 2, 'zweiter Versuch ohne Spalten, dann Fehler');
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

test('Telefonnummern werden einheitlich mit Ländervorwahl gespeichert', () => {
  assert.equal(normalizePhone('0170 123 45 67'), '+491701234567');
  assert.equal(normalizePhone('+49 (170) 1234567'), '+491701234567');
  assert.equal(normalizePhone('0049 170 1234567'), '+491701234567');
  assert.equal(normalizePhone('1701234567'), '+491701234567');
  assert.equal(normalizePhone('+20 100 123 4567'), '+201001234567');
  assert.equal(normalizePhone('12345'), null);
  assert.equal(normalizePhone('abc'), null);
  assert.equal(countryOf('+201001234567'), 'EG');
  assert.equal(countryOf('+9715012345678'), 'AE');
  assert.equal(countryOf('+491701234567'), 'DE');
});

test('Ohne WhatsApp gilt der Kontaktweg "Rückmeldung in 24 Std."', async () => {
  mockMonday([
    { json: { data: { create_item: { id: '1' } } } },
    { json: { data: { create_update: { id: '2' } } } },
  ]);
  await syncLeadToMonday('termin', { name: 'Omar', email: 'o@example.com', kanal: 'irgendwas' }, ENV);
  assert.deepEqual(JSON.parse(calls[0].body.variables.columns).kontaktweg, { label: 'Rückmeldung in 24 Std.' });
  assert.ok(calls[1].body.variables.body.includes('Rückmeldung in 24 Std.'));
});

test('Lehnt monday die Spaltenwerte ab, wird der Lead trotzdem ohne Spalten angelegt', async () => {
  mockMonday([
    { json: { errors: [{ message: 'invalid value for column' }] } },
    { json: { data: { create_item: { id: '55' } } } },
    { json: { data: { create_update: { id: '56' } } } },
  ]);
  const origWarn = console.warn; const warned = []; console.warn = (l) => warned.push(l);
  try {
    const id = await syncLeadToMonday('investieren', { name: 'Lina', telefon: '0170 1234567', kanal: 'formular' }, ENV);
    assert.equal(id, '55');
  } finally { console.warn = origWarn; }
  assert.equal(calls.length, 3);
  assert.deepEqual(JSON.parse(calls[1].body.variables.columns), {});
  assert.ok(calls[2].body.variables.body.includes('Spaltenwerte wurden von monday abgelehnt'));
  assert.ok(warned.length === 1 && !warned[0].includes('Lina') && !warned[0].includes('1701234567'), 'Warnung ohne personenbezogene Daten');
});

test('Kontaktformular: Nachricht wird übernommen und gekürzt', () => {
  const lead = sanitizeLead('kontakt', { name: 'Sara', email: 's@example.com', thema: 'Rente', nachricht: 'Hallo '.repeat(500) });
  assert.equal(lead.formular, 'kontakt');
  assert.equal(lead.nachricht.length, 2000);
  assert.equal(lead.kanal, 'formular');
  assert.ok(buildUpdateBody(lead).includes('<b>Nachricht:</b>'));
});
