/**
 * Google + SerpApi connectivity diagnostic.
 * Run inside the logistics-agent container:
 *   docker compose exec logistics-agent npx tsx src/scripts/diagnose-google-apis.ts
 *
 * Tests each API with a minimal real request and reports status + error.
 */

const GOOGLE_PLACES_KEY  = process.env['GOOGLE_PLACES_API_KEY']  ?? '';
const GOOGLE_MAPS_KEY    = process.env['GOOGLE_MAPS_API_KEY']    ?? '';
const SERPAPI_KEY        = process.env['SERPAPI_KEY']             ?? '';
const PLACES_BASE        = process.env['GOOGLE_PLACES_BASE_URL'] ?? 'https://places.googleapis.com/v1';
const ROUTES_BASE        = process.env['GOOGLE_ROUTES_BASE_URL'] ?? 'https://routes.googleapis.com';
const MAPS_BASE          = process.env['GOOGLE_MAPS_BASE_URL']   ?? 'https://maps.googleapis.com/maps/api';
const SERPAPI_BASE       = process.env['SERPAPI_BASE_URL']        ?? 'https://serpapi.com/search';

interface Result {
  api:    string;
  status: 'OK' | 'FAIL' | 'NO_KEY';
  http?:  number;
  error?: string;
  note?:  string;
}

async function testPlacesApi(): Promise<Result> {
  const api = 'Google Places API (New) — places.googleapis.com/v1/places:searchText';
  if (!GOOGLE_PLACES_KEY) return { api, status: 'NO_KEY', note: 'GOOGLE_PLACES_API_KEY not set' };
  try {
    const res = await fetch(`${PLACES_BASE}/places:searchText`, {
      method: 'POST',
      headers: {
        'Content-Type':  'application/json',
        'X-Goog-Api-Key': GOOGLE_PLACES_KEY,
        'X-Goog-FieldMask': 'places.id,places.displayName',
      },
      body: JSON.stringify({ textQuery: 'Lisbon airport' }),
    });
    const body = await res.json() as Record<string, unknown>;
    if (!res.ok) {
      const msg = (body['error'] as Record<string, unknown>)?.['message'] as string ?? JSON.stringify(body).slice(0, 200);
      return { api, status: 'FAIL', http: res.status, error: msg };
    }
    const count = Array.isArray(body['places']) ? body['places'].length : 0;
    return { api, status: 'OK', http: res.status, note: `${count} place(s) returned` };
  } catch (e) {
    return { api, status: 'FAIL', error: String(e) };
  }
}

async function testRoutesApi(): Promise<Result> {
  const api = 'Google Routes API — routes.googleapis.com/directions/v2:computeRoutes';
  if (!GOOGLE_MAPS_KEY) return { api, status: 'NO_KEY', note: 'GOOGLE_MAPS_API_KEY not set' };
  try {
    const res = await fetch(`${ROUTES_BASE}/directions/v2:computeRoutes`, {
      method: 'POST',
      headers: {
        'Content-Type':   'application/json',
        'X-Goog-Api-Key': GOOGLE_MAPS_KEY,
        'X-Goog-FieldMask': 'routes.duration,routes.legs',
      },
      body: JSON.stringify({
        origin:      { address: 'Lisboa, Portugal' },
        destination: { address: 'Porto, Portugal' },
        travelMode:  'TRANSIT',
        transitPreferences: { allowedTravelModes: ['TRAIN'] },
      }),
    });
    const body = await res.json() as Record<string, unknown>;
    if (!res.ok) {
      const msg = (body['error'] as Record<string, unknown>)?.['message'] as string ?? JSON.stringify(body).slice(0, 200);
      return { api, status: 'FAIL', http: res.status, error: msg };
    }
    const count = Array.isArray(body['routes']) ? body['routes'].length : 0;
    return { api, status: 'OK', http: res.status, note: `${count} route(s) returned` };
  } catch (e) {
    return { api, status: 'FAIL', error: String(e) };
  }
}

async function testMapsDirectionsApi(): Promise<Result> {
  const api = 'Google Maps Directions API — maps.googleapis.com/maps/api/directions';
  if (!GOOGLE_MAPS_KEY) return { api, status: 'NO_KEY', note: 'GOOGLE_MAPS_API_KEY not set' };
  try {
    const qs = new URLSearchParams({
      origin:      'Lisboa, Portugal',
      destination: 'Porto, Portugal',
      key:         GOOGLE_MAPS_KEY,
    });
    const res = await fetch(`${MAPS_BASE}/directions/json?${qs.toString()}`);
    const body = await res.json() as Record<string, unknown>;
    if (!res.ok || body['status'] === 'REQUEST_DENIED') {
      return { api, status: 'FAIL', http: res.status, error: String(body['error_message'] ?? body['status'] ?? 'unknown') };
    }
    const status = String(body['status'] ?? '');
    return { api, status: status === 'OK' || status === 'ZERO_RESULTS' ? 'OK' : 'FAIL', http: res.status, note: `status=${status}` };
  } catch (e) {
    return { api, status: 'FAIL', error: String(e) };
  }
}

async function testSerpApi(): Promise<Result> {
  const api = 'SerpApi — serpapi.com/search (google_flights)';
  if (!SERPAPI_KEY) return { api, status: 'NO_KEY', note: 'SERPAPI_KEY not set' };
  try {
    const qs = new URLSearchParams({
      engine:        'google_flights',
      departure_id:  'LIS',
      arrival_id:    'OPO',
      outbound_date: '2026-08-01',
      currency:      'EUR',
      type:          '2',
      api_key:       SERPAPI_KEY,
    });
    const res = await fetch(`${SERPAPI_BASE}?${qs.toString()}`);
    const body = await res.json() as Record<string, unknown>;
    if (!res.ok) {
      const msg = String(body['error'] ?? JSON.stringify(body).slice(0, 200));
      return { api, status: 'FAIL', http: res.status, error: msg };
    }
    const count = Array.isArray(body['best_flights']) ? body['best_flights'].length : 0;
    return { api, status: 'OK', http: res.status, note: `${count} flight result(s) returned` };
  } catch (e) {
    return { api, status: 'FAIL', error: String(e) };
  }
}

async function main(): Promise<void> {
  console.log('\n=== Google API Diagnostic ===\n');

  const tests = [testPlacesApi, testRoutesApi, testMapsDirectionsApi, testSerpApi];
  const results = await Promise.all(tests.map((t) => t()));

  for (const r of results) {
    const icon = r.status === 'OK' ? '✓' : r.status === 'NO_KEY' ? '?' : '✗';
    const colour = r.status === 'OK' ? '\x1b[32m' : r.status === 'NO_KEY' ? '\x1b[33m' : '\x1b[31m';
    const reset = '\x1b[0m';
    console.log(`${colour}${icon} [${r.status}]${reset} ${r.api}`);
    if (r.http)  console.log(`       HTTP ${r.http}`);
    if (r.note)  console.log(`       ${r.note}`);
    if (r.error) console.log(`       ERROR: ${r.error}`);
    console.log();
  }

  const failed = results.filter((r) => r.status === 'FAIL').map((r) => r.api);
  if (failed.length > 0) {
    console.log('=== FAILED APIs — enable in Google Cloud Console ===');
    for (const f of failed) console.log(`  • ${f}`);
    console.log();
    console.log('Console URL: https://console.cloud.google.com/apis/library');
    console.log('APIs to search and enable:');
    console.log('  • Places API (New)');
    console.log('  • Routes API');
    console.log('  • Directions API');
  } else {
    console.log('All tested APIs reachable.');
  }
}

void main();
