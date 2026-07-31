#!/usr/bin/env node
/**
 * Fail-closed environment validator for production validation.
 *
 * Exits non-zero (fail closed) unless the target is a real, reachable, ready
 * VALIDATION database — never a recognized production project (unless an explicit
 * destructive override is set). It performs no writes.
 *
 * Env (validation only — separate from the app's runtime vars):
 *   SUPABASE_TEST_URL, SUPABASE_TEST_SERVICE_ROLE_KEY   (required)
 *   SUPABASE_TEST_ANON_KEY                               (recommended; RLS tests)
 *   SUPABASE_TEST_DB_URL                                 (optional; direct SQL)
 *   ALLOW_DESTRUCTIVE_VALIDATION=1                       (override prod guard)
 *   PRODUCTION_URL                                       (the prod URL to refuse)
 */
import { createClient } from '@supabase/supabase-js';

const fail = (msg) => {
  console.error(`✗ env validation FAILED: ${msg}`);
  process.exit(1);
};
const ok = (msg) => console.log(`  ✓ ${msg}`);

const url = process.env.SUPABASE_TEST_URL;
const serviceKey = process.env.SUPABASE_TEST_SERVICE_ROLE_KEY;
const prodUrl = process.env.PRODUCTION_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const override = process.env.ALLOW_DESTRUCTIVE_VALIDATION === '1';

if (!url) fail('SUPABASE_TEST_URL is required.');
if (!serviceKey) fail('SUPABASE_TEST_SERVICE_ROLE_KEY is required.');
try {
  // eslint-disable-next-line no-new
  new URL(url);
  ok('SUPABASE_TEST_URL is a valid URL');
} catch {
  fail('SUPABASE_TEST_URL is not a valid URL.');
}

// Never target a recognized production project unless explicitly overridden.
if (prodUrl && url === prodUrl && !override) {
  fail('SUPABASE_TEST_URL matches the production project. Refusing (set ALLOW_DESTRUCTIVE_VALIDATION=1 only for a disposable project).');
}
ok('target is not the recognized production project');

// The service key must not be a public/anon key.
if (/anon/i.test(serviceKey)) fail('SUPABASE_TEST_SERVICE_ROLE_KEY looks like an anon key.');
ok('service-role credential is present (server-only)');

const db = createClient(url, serviceKey, { auth: { persistSession: false } });
const { data, error } = await db.rpc('app_validation_probe');
if (error) fail(`database not reachable / schema missing: ${error.message}`);

if (!data?.has_pgcrypto) fail('required extension pgcrypto is missing.');
if (!data?.has_jobs_table || !data?.has_claim_jobs) fail('schema not applied (jobs/claim_jobs missing) — run migrations first.');
const major = Number(String(data.version).split('.')[0]);
if (Number.isFinite(major) && major < 14) fail(`Postgres ${data.version} is too old (need >= 14).`);
ok(`Postgres ${data.version} reachable, pgcrypto present, schema applied`);
ok(`validation DB workspace_count=${data.workspace_count}`);

console.log('✓ environment validation PASSED');
