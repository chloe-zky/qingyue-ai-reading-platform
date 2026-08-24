# Security Policy

## Public repository boundary

This repository contains application source, example configuration, migrations, and tests only. It must not contain live Supabase project identifiers, service-role keys, LLM keys, user credentials, production data, execution logs, or local collaboration records.

The frontend may receive a Supabase anon public key. A service-role key must remain server-side and must never be committed or exposed through a `VITE_*` variable.

## Reporting a vulnerability

Please use GitHub's private vulnerability reporting / security advisory feature instead of opening a public issue containing exploit details, credentials, or personal data.

If a credential is exposed, revoke or rotate it first, then remove it from every reachable Git object. Deleting it only from the latest commit is not sufficient.

## Known pre-production limits

- Author identity and manuscript ownership are not yet enforced by account-level authentication.
- The included SQL migrations extend an existing project schema; they do not initialize every base business table from an empty database.
- Production deployment requires an explicit CORS allowlist, Supabase RLS review, separate test data, and end-to-end authorization tests.
