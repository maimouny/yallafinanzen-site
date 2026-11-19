// Überträgt jede Formular-Anfrage der Website als Lead nach monday.com.
//
// Netlify ruft diese Funktion automatisch nach jeder geprüften Einsendung über
// Netlify Forms auf (Event "submission-created", Spam bereits aussortiert).
// Es gibt keinen eigenen öffentlichen Endpunkt: Netlify signiert das Event und
// prüft die Signatur, bevor die Funktion läuft.
//
// Einstellungen nur als Umgebungsvariablen in Netlify (nie im Code):
//   MONDAY_API_TOKEN   API-Token (Pflicht)
//   MONDAY_BOARD_ID    Board für die Leads (Pflicht)
//   MONDAY_GROUP_ID    Gruppe im Board (optional)
//   MONDAY_COLUMN_EMAIL     Spalte vom Typ E-Mail (optional)
//   MONDAY_COLUMN_PHONE     Spalte vom Typ Text (optional)
//   MONDAY_COLUMN_SOURCE    Spalte vom Typ Text, z. B. "termin · whatsapp" (optional)
//   MONDAY_COLUMN_LANGUAGE  Spalte vom Typ Text (optional)
// Alle Angaben landen zusätzlich als Update (Kommentar) am Eintrag.

const MONDAY_API_URL = 'https://api.monday.com/v2';
const REQUEST_TIMEOUT_MS = 8000;

const KNOWN_FORMS = new Set(['termin', 'guide', 'rueckruf', 'investieren']);

// Erlaubte Felder mit maximaler Länge. Alles andere wird verworfen.
const FIELD_LIMITS = {
  name: 100,
  telefon: 40,
  email: 254,
  thema: 200,
  themen: 300,
  wann: 100,
  guide: 200,
  sprache: 5,
  in_deutschland: 50,
  investieren: 100,
  versicherungen: 100,
  kanal: 20,
  einwilligung: 600,
  einwilligung_zeit: 40,
  datenschutz_stand: 10,
  zeit: 40,
  seite: 300,
};

const FIELD_LABELS = {
  name: 'Name',
  telefon: 'Telefon',
  email: 'E-Mail',
  thema: 'Thema',
  themen: 'Themen',
  wann: 'Erreichbar',
  guide: 'Guide',
  sprache: 'Sprache',
  in_deutschland: 'In Deutschland',
  investieren: 'Investieren',
  versicherungen: 'Versicherungen',
  kanal: 'Weiter über',
  einwilligung: 'Einwilligung',
  einwilligung_zeit: 'Einwilligung (Zeit)',
  datenschutz_stand: 'Datenschutzerklärung (Stand)',
  zeit: 'Gesendet',
  seite: 'Seite',
};

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_PATTERN = /^\+?[\d\s()/.-]{6,40}$/;

export class LeadSyncError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'LeadSyncError';
    this.code = code;
  }
}

export function sanitizeLead(formName, rawData) {
  if (!KNOWN_FORMS.has(formName)) {
    throw new LeadSyncError('UNKNOWN_FORM', 'Formular ist nicht für monday freigegeben');
  }
  const lead = { formular: formName };
  for (const [field, limit] of Object.entries(FIELD_LIMITS)) {
    const value = rawData?.[field];
    if (typeof value !== 'string') continue;
    const clean = value.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, limit);
    if (clean) lead[field] = clean;
  }
  if (lead.email && !EMAIL_PATTERN.test(lead.email)) delete lead.email;
  if (lead.telefon && !PHONE_PATTERN.test(lead.telefon)) delete lead.telefon;
  if (!lead.email && !lead.telefon) {
    throw new LeadSyncError('NO_CONTACT', 'Weder gültige E-Mail noch Telefonnummer');
  }
  return lead;
}

export function buildColumnValues(lead, env) {
  const columns = {};
  if (env.MONDAY_COLUMN_EMAIL && lead.email) {
    columns[env.MONDAY_COLUMN_EMAIL] = { email: lead.email, text: lead.email };
  }
  if (env.MONDAY_COLUMN_PHONE && lead.telefon) columns[env.MONDAY_COLUMN_PHONE] = lead.telefon;
  if (env.MONDAY_COLUMN_SOURCE) {
    columns[env.MONDAY_COLUMN_SOURCE] = [lead.formular, lead.kanal].filter(Boolean).join(' · ');
  }
  if (env.MONDAY_COLUMN_LANGUAGE && lead.sprache) columns[env.MONDAY_COLUMN_LANGUAGE] = lead.sprache;
  return columns;
}

function escapeHtml(value) {
  return value.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

// Der Text eines monday-Updates wird als HTML dargestellt, daher jede Eingabe escapen.
export function buildUpdateBody(lead) {
  const rows = Object.keys(FIELD_LABELS)
    .filter((field) => lead[field])
    .map((field) => `<b>${FIELD_LABELS[field]}:</b> ${escapeHtml(lead[field])}`);
  return [`<b>Formular:</b> ${escapeHtml(lead.formular)}`, ...rows].join('<br>');
}

export function itemName(lead) {
  return lead.name || lead.telefon || lead.email;
}

async function callMonday(token, query, variables) {
  let response;
  try {
    response = await fetch(MONDAY_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: token },
      body: JSON.stringify({ query, variables }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    throw new LeadSyncError('MONDAY_UNREACHABLE', 'monday.com nicht erreichbar');
  }
  if (!response.ok) {
    throw new LeadSyncError('MONDAY_HTTP_' + response.status, 'monday.com hat die Anfrage abgelehnt');
  }
  const result = await response.json().catch(() => null);
  if (!result || result.errors || result.error_code) {
    throw new LeadSyncError('MONDAY_API_ERROR', 'monday.com meldet einen Fehler');
  }
  return result.data;
}

const CREATE_ITEM = `mutation ($board: ID!, $group: String, $name: String!, $columns: JSON) {
  create_item(board_id: $board, group_id: $group, item_name: $name, column_values: $columns) { id }
}`;

const CREATE_UPDATE = `mutation ($item: ID!, $body: String!) {
  create_update(item_id: $item, body: $body) { id }
}`;

export async function syncLeadToMonday(formName, rawData, env) {
  if (!env.MONDAY_API_TOKEN || !env.MONDAY_BOARD_ID) {
    throw new LeadSyncError('NOT_CONFIGURED', 'MONDAY_API_TOKEN oder MONDAY_BOARD_ID fehlt');
  }
  const lead = sanitizeLead(formName, rawData);
  const created = await callMonday(env.MONDAY_API_TOKEN, CREATE_ITEM, {
    board: env.MONDAY_BOARD_ID,
    group: env.MONDAY_GROUP_ID || null,
    name: itemName(lead),
    columns: JSON.stringify(buildColumnValues(lead, env)),
  });
  const itemId = created?.create_item?.id;
  if (!itemId) throw new LeadSyncError('MONDAY_NO_ITEM', 'monday.com hat keinen Eintrag angelegt');
  await callMonday(env.MONDAY_API_TOKEN, CREATE_UPDATE, { item: itemId, body: buildUpdateBody(lead) });
  return itemId;
}

// Logs enthalten bewusst keine personenbezogenen Daten, nur Formular und Fehlercode.
function log(level, event, details) {
  console[level](JSON.stringify({ event, ...details }));
}

export default async (request) => {
  const body = await request.json().catch(() => null);
  const payload = body?.payload;
  const formName = payload?.form_name;
  try {
    await syncLeadToMonday(formName, payload?.data, process.env);
    log('log', 'lead_synced', { form: formName });
  } catch (error) {
    const code = error instanceof LeadSyncError ? error.code : 'UNEXPECTED';
    log('error', 'lead_sync_failed', { form: typeof formName === 'string' ? formName.slice(0, 30) : null, code });
    // Fehler weiterreichen, damit Netlify den Lauf als fehlgeschlagen anzeigt.
    // Die Anfrage selbst bleibt in Netlify Forms gespeichert.
    throw error;
  }
};
