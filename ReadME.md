# NeumuacFQ — Architecture Decision Record
**CFTR Precision Medicine Platform · v4.0.0**
*This document records design decisions, security assessments, and planned improvements
for future implementation. It is a living reference — not a changelog.*

---

## Table of Contents

1. [Platform Overview](#1-platform-overview)
2. [Authentication Architecture — Current State](#2-authentication-architecture--current-state)
3. [Authentication Architecture — Recommended Model](#3-authentication-architecture--recommended-model)
4. [Location Detection — Design Decision](#4-location-detection--design-decision)
5. [UI Professionality Assessment](#5-ui-professionality-assessment)
6. [Security Vulnerabilities — Prioritised](#6-security-vulnerabilities--prioritised)
7. [Database Schema Placeholder](#7-database-schema-placeholder)
8. [Implementation Roadmap](#8-implementation-roadmap)

---

## 1. Platform Overview

NeumuacFQ is a single-file clinical web application for managing, validating, and
researching CFTR (Cystic Fibrosis Transmembrane Conductance Regulator) gene variants.
It is built for clinical and research personnel in hospital settings.

**Core capabilities:**
- CFTR variant database with full CRUD (read/write/validate/delete)
- CFTR class classification (I–VI) with ETI modulator eligibility prediction
- Two-clinician validation enforcement on classification-critical variants
- External lookup via PubMed DOI and gnomAD v4 allele frequency
- Geolocation-enriched search analytics (institution-level, session-level)
- PDF and CSV export with audit trail
- Supabase backend with Row Level Security

**Tech stack:**
- Single HTML file (~25,000 lines), vanilla JS, IBM Plex Sans/Mono, Syne
- Supabase (PostgreSQL + Auth + RLS + Realtime)
- Chart.js (lazy-loaded), Leaflet/CartoCDN maps
- CDN: cdnjs.cloudflare.com, fonts.googleapis.com

---

## 2. Authentication Architecture — Current State

### 2.1 Hospital Modal (identification, not authentication)

At startup, a modal collects:
- Institution/hospital name
- Clinician name (optional)
- Clinician role (optional, autocompleted from DB history)

**Assessment:** This is *identification*, not *authentication*. Any string is accepted.
No server-side verification occurs. The modal looks like a login screen but provides
no security guarantees. Clinicians may reasonably believe they are "logging in" when
they are not.

**Risk:** Medium. Misrepresentation is possible. Audit logs record unverified names.

### 2.2 Write Mode PIN

A modal gate protects all write operations (create, update, delete, validate).
The PIN is defined in client-side JavaScript:

```js
// CONFIG object in index.html
WRITE_CODE: 'helix2024', // ⚠ Change before deployment — move to server-side auth in production
WRITE_DURATION: 30 * 60 * 1000  // 30 minutes
```

**Assessment:** This is *security theater*. The PIN is readable in browser DevTools
by any user who opens the file. The 30-minute session timer and lock icon UI signal
real security; the underlying mechanism provides none.

**Risk:** CRITICAL. Any clinician with basic browser knowledge has full write access
to the clinical database.

### 2.3 Two-Clinician Enforcement (currently unverified)

The codebase enforces a two-clinician rule on classification-critical variants:
a second validator must have a different role from the first. This is clinically sound
and legally significant. However, because identity is unverified (see 2.1), the rule
can be trivially circumvented by entering different name/role strings.

**Risk:** High. The safeguard is structurally correct but operationally bypassed.

---

## 3. Authentication Architecture — Recommended Model

### 3.1 Three-Tier Access Model

```
Tier 1 — Read-only (no authentication required)
│  Lookup variants, view ETI eligibility, browse evidence
│  Access: open, no gate
│  Why: Point-of-care lookup must never be blocked by auth friction
│
Tier 2 — Write access (authentication required)
│  Validate, annotate, create, edit, import, delete variants
│  Access: Supabase Auth (email + password or institution SSO)
│  Identity: server-verified JWT, persisted session
│  Two-clinician rule: enforced with verified user IDs, not name strings
│
Tier 3 — Admin/curation (elevated role required)
   Bulk import/export, analytics access, DB policy changes
   Access: Supabase Row Level Security role ("admin" or "curator")
   Enforcement: server-side, no client logic involved
```

### 3.2 Supabase Auth Integration (planned)

Replace the client-side PIN modal with Supabase Auth:

```js
// PLANNED — pseudocode, not yet implemented
const { data, error } = await supabase.auth.signInWithPassword({
  email: clinicianEmail,
  password: clinicianPassword
});
// JWT returned; all write API calls use this JWT
// Supabase RLS policies enforce tier on the server
```

**Write mode session:** Keep the 30-minute concept but derive it from the Supabase
auth token expiry, not a client-side timer. Token refresh should be silent.

**Two-clinician rule:** After migration, record `user_id` (Supabase UUID) alongside
`clinician_name` in validation_history. Enforce the "different validator" rule via
user IDs, not role strings.

### 3.3 Hospital Modal — Redesign Intent

The modal should be repositioned as a *personalization step*, not authentication:

- Rename: "Set your session context" rather than implying login
- Label it clearly as non-authenticating if write auth is implemented separately
- Pre-fill institution from IP geolocation (see Section 4)
- Persist institution choice in localStorage for returning users

### 3.4 Audit Trail — Server Authority

Currently `writeAuditLog()` is called client-side. For regulatory and legal purposes,
the audit trail must be server-authoritative:

- Move audit writes to Supabase Edge Functions or database triggers
- Client-side calls become advisory only (UX feedback)
- Tamper-evident: use Postgres `GENERATED ALWAYS` timestamps, not client timestamps

---

## 4. Location Detection — Design Decision

### 4.1 Current Implementation

Two-layer fallback, cached per session:

```
Layer 1: browser Geolocation API (GPS/WiFi, building-level accuracy)
  → on success: back-fills institution record with verified coordinates
  → on failure: falls through to Layer 2

Layer 2: ipapi.co IP geolocation (city-level, no permission required)
  → on failure: locationCache = {} (empty, graceful)
```

Internal flags:
- `ip_source: 'browser_gps'` | `'ipapi.co'`
- `location_tier: 1` (GPS) | `2` (IP) | `3` (unknown)

**Assessment:** Architecture is sound. The two-layer fallback, session caching, and
coordinate back-fill are all appropriate for a multi-institution clinical platform
where hospital networks often share a single egress IP.

### 4.2 Gate vs. Consent — Decision

**Decision: Informed consent step, not a hard gate.**

Rationale:
- A clinician denying GPS access still needs rapid variant lookup — blocking them
  is a patient safety risk
- Clinical and research users have legitimate reasons to deny precise location
  (remote work, privacy policy, institutional IT restrictions)
- IP geolocation (Layer 2) provides sufficient city-level data for analytics even
  without GPS consent
- GDPR and equivalent regulations require informed consent for precise location data;
  a hard gate without explanation would be non-compliant

**Recommended UX flow (to be implemented):**

On first session (or after clearing localStorage), show a full-screen consent step
*before* the hospital modal. Not a browser popup — a custom UI:

```
┌─────────────────────────────────────────────────────┐
│  📍 Location helps us                               │
│                                                     │
│  Knowing your institution's location helps us       │
│  attribute variant searches correctly when          │
│  multiple clinicians share a network IP.            │
│                                                     │
│  ┌─────────────────────┐  ┌─────────────────────┐  │
│  │  Allow precise      │  │  Use approximate    │  │
│  │  location (GPS)     │  │  location (IP only) │  │
│  └─────────────────────┘  └─────────────────────┘  │
│                                                     │
│  You can change this in settings at any time.       │
└─────────────────────────────────────────────────────┘
```

- "Allow precise location" → triggers `navigator.geolocation.getCurrentPosition()`
- "Use approximate location" → skips to Layer 2 (IP), sets consent flag
- Choice persisted in localStorage as `neumuacfq_location_consent: 'gps' | 'ip'`
- On subsequent sessions, consent is remembered; no prompt shown

### 4.3 Privacy and Data Handling

- GPS coordinates are rounded to 4 decimal places (~11m precision) before storage
- IP address is stored only when source is `'ipapi.co'` (not for GPS path)
- Location data is used exclusively for search attribution and institution mapping
- No location data is shared externally beyond what's stored in the Supabase instance

---

## 5. UI Professionality Assessment

### 5.1 Design System — Strengths

- **Token hierarchy:** Two-layer CSS architecture (utility primitives + design system)
  is well-structured. Load order is documented and enforced.
- **CFTR class color system:** Consistent semantic colors (I–VI) with opacity-based
  tokens that auto-adapt to light/dark themes.
- **Shadow/glow system:** Dark-adapted, glow-based shadows appropriate for medical
  data density. z-index ladder is well-defined.
- **Typography:** IBM Plex Sans/Mono + Syne is a strong clinical + display combination.
  Type scale tokens are defined and used consistently.
- **Lazy loading:** Chart.js deferred to first analytics open (~200KB saved on
  initial parse). Performance-aware.
- **SRI integrity hashes:** Font Awesome loaded with SHA-512 integrity check.
  Appropriate for a medical platform.

### 5.2 Trust/Professionality Gaps

**Hospital Modal as false authentication:**
The modal uses lock iconography and "session context" language that implies security.
Because it provides none, clinicians may have a false sense of access control.
*Resolution:* Clearly label as personalization, or replace with real auth (Section 3).

**Write Mode modal — security theater:**
The 30-minute timer, lock icon, and "Unlock write mode" copy signal a real security
boundary. The client-side PIN does not deliver one.
*Resolution:* Replace PIN with Supabase Auth JWT (Section 3.2). Remove WRITE_CODE
from CONFIG entirely.

**Dev notice bar:**
`v4.0 · Active development` is visible in the loading screen. If this platform is
being used in clinical settings, the disclaimer should reflect that, not suggest
it is a development build.
*Resolution for production:*
- Replace dev notice with: "For authorised clinical and research personnel only"
- This string already exists in PDF export code — surface it on-screen
- Add explicit "Not for clinical diagnosis" disclaimer if regulatory context requires

**`unsafe-inline` in Content Security Policy:**
The CSP includes `unsafe-inline` for both `script-src` and `style-src`. This negates
most XSS protection. Given the effort invested in SRI hashes, this is inconsistent.
*Resolution:* Migrate inline scripts to external files and use nonces or hashes.
Significant refactor required — lower priority than auth fixes.

**Supabase key exposure:**
```js
KEY: 'sb_publishable_vKCe5bc1Qr20_LI_awKIYw_CqSFrblh'
```
This is noted in the code as a "publishable key with Row Level Security enabled."
RLS must be correctly configured for this to be safe. Verify all policies are
restrictive by default (deny unless explicitly granted).

### 5.3 Specific Recommendations

| Issue | Severity | Action |
|---|---|---|
| WRITE_CODE in client JS | Critical | Replace with Supabase Auth |
| Hospital modal as false auth | High | Reposition as personalization step |
| Audit log client-side | High | Move to server triggers or Edge Functions |
| unsafe-inline CSP | Medium | Migrate to nonce-based CSP |
| Dev notice in production | Medium | Replace with clinical disclaimer |
| Two-clinician rule unverified | High | Enforce with user_id after auth migration |

---

## 6. Security Vulnerabilities — Prioritised

### P0 — Immediate

1. **Remove WRITE_CODE from client JavaScript.**
   Any user with DevTools has full write access to the clinical database.
   *Fix:* Supabase Auth + RLS policies. Remove `WRITE_CODE` and `WRITE_DURATION`
   from CONFIG entirely.

### P1 — Before clinical deployment

2. **Server-authoritative audit trail.**
   Current `writeAuditLog()` calls are client-initiated. A motivated user can
   suppress audit entries.
   *Fix:* Postgres triggers on INSERT/UPDATE/DELETE to `variants` and
   `validation_history` tables. Client calls become advisory UI only.

3. **Verified identity for two-clinician rule.**
   The rule is structurally sound but bypassed by entering different strings.
   *Fix:* After auth migration, record `validator_user_id` (Supabase UUID).
   Enforce uniqueness of user IDs across the two validation entries.

4. **RLS policy audit.**
   Confirm all Supabase tables have restrictive default policies.
   Anonymous reads on `variants` and `evidence` should be allowed.
   Anonymous writes must be blocked at the database layer.

### P2 — Hardening

5. **Content Security Policy — remove `unsafe-inline`.**
   Requires migrating inline JS to external scripts and using nonce-based CSP.

6. **`frame-ancestors` CSP via HTTP response header.**
   The existing `<meta>` CSP correctly notes that `frame-ancestors` requires a
   response header. Ensure the server/CDN delivers this header.

---

## 7. Database Schema Placeholder

*The database schema will be added here once provided. This section will document:*

- Table definitions (variants, validation_history, audit_log, institutions, etc.)
- Row Level Security policies per table and role
- Indexes and performance considerations
- Supabase Auth integration points (user_id foreign keys)
- Trigger definitions for server-side audit logging
- gnomAD and PubMed enrichment table structure

*Schema to be added: pending.*

---

## 8. Implementation Roadmap

### Phase 1 — Critical security (P0/P1)

- [ ] Migrate write access from client PIN to Supabase Auth
- [ ] Remove `WRITE_CODE` from `CONFIG` object
- [ ] Add Supabase Auth sign-in UI (modal, consistent with existing design system)
- [ ] Implement server-side audit triggers in Postgres
- [ ] Audit all RLS policies — confirm anonymous write is blocked

### Phase 2 — Trust and identity

- [ ] Reposition hospital modal as personalization (not auth)
- [ ] Record `user_id` in `validation_history` alongside clinician name
- [ ] Enforce two-clinician rule using `user_id` uniqueness
- [ ] Replace dev notice with clinical disclaimer in production builds

### Phase 3 — Location consent

- [ ] Build first-session location consent screen (custom UI, not browser popup)
- [ ] Persist consent choice in localStorage
- [ ] Surface location tier (`location_tier`) in institution record UI
- [ ] Add "location settings" option to the header or settings panel

### Phase 4 — CSP hardening

- [ ] Migrate inline scripts to external files
- [ ] Implement nonce-based CSP (requires server-side nonce injection)
- [ ] Remove `unsafe-inline` from `script-src` and `style-src`
- [ ] Verify `frame-ancestors` is set via HTTP response header

### Phase 5 — Architecture evolution (longer term)

- [ ] Modularise single-file codebase (ES modules or build step)
- [ ] Move Supabase key to environment variable / backend proxy
- [ ] Add institution-level role management (per-institution admin)
- [ ] Explore SMART on FHIR for hospital SSO integration

---

*Document maintained by the NeumuacFQ engineering team.*
*Last reviewed: 2026-05-18*
*Next review: on database schema addition or major architectural change.*
