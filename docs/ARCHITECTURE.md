# Technical Architecture: Amana

## 1. Overview

Amana is one brand on a shared backend. Each brand has its own frontend, and every core table carries a `brand_scope` so data and access are isolated per brand.

```
   Amana web / mobile        Sister brand (e.g. Hiyame)
            \                       /
             \                     /
          Shared Supabase (PostgreSQL + Auth + Storage)
             /          |            \
        Smile ID      Resend        Sentry
     (identity KYC)   (email)     (monitoring)
```

The marketing site in this repo is static HTML, CSS and JS hosted on Vercel. The application described here is a separate codebase.

## 2. Suggested stack

- **Client:** Next.js for web, Expo React Native for mobile. Mobile-first, since most professionals apply from a phone on limited data.
- **Data fetching:** TanStack Query.
- **Backend:** Supabase (PostgreSQL, Row-Level Security, Storage, Auth).
- **Identity:** Smile ID.
- **Email:** Resend. SMS or WhatsApp provider to be chosen.
- **Monitoring:** Sentry.

## 3. Data model (core tables)

All tables include `brand_scope`.

```sql
CREATE TYPE brand_scope_enum AS ENUM ('amana', 'hiyame', 'global');
CREATE TYPE engagement_model AS ENUM ('placement', 'managed');
CREATE TYPE plan_tier AS ENUM ('standard', 'premium', 'executive');
CREATE TYPE career_level AS ENUM ('trainee', 'certified', 'senior', 'lead');
CREATE TYPE vetting_stage AS ENUM (
  'identity', 'police_certificate', 'guarantors', 'references',
  'medical', 'role_assessment', 'training', 'approved'
);

CREATE TABLE professionals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  brand_scope brand_scope_enum NOT NULL DEFAULT 'amana',
  role text NOT NULL,                 -- nanny, cleaner, driver, cook, house_manager, companion, gardener, estate_staff
  career_level career_level NOT NULL DEFAULT 'trainee',
  location text,
  languages text[],
  live_in boolean,
  is_verified boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'applied',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE vetting_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  professional_id uuid NOT NULL REFERENCES professionals(id) ON DELETE CASCADE,
  brand_scope brand_scope_enum NOT NULL DEFAULT 'amana',
  stage vetting_stage NOT NULL,
  passed boolean,
  notes text,
  completed_at timestamptz,
  UNIQUE (professional_id, stage)
);

CREATE TABLE clients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  brand_scope brand_scope_enum NOT NULL DEFAULT 'amana',
  type text NOT NULL,                 -- household, diaspora, organisation
  plan plan_tier NOT NULL DEFAULT 'standard',
  engagement engagement_model NOT NULL DEFAULT 'placement'
);

CREATE TABLE placement_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  brand_scope brand_scope_enum NOT NULL DEFAULT 'amana',
  role text NOT NULL,
  location text NOT NULL,
  live_in boolean,
  schedule jsonb,
  notes text,
  status text NOT NULL DEFAULT 'open'
);

CREATE TABLE placements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL REFERENCES placement_requests(id) ON DELETE CASCADE,
  professional_id uuid NOT NULL REFERENCES professionals(id),
  brand_scope brand_scope_enum NOT NULL DEFAULT 'amana',
  start_date date,
  guarantee_days int NOT NULL,        -- 30 standard, 60 premium and executive
  status text NOT NULL DEFAULT 'active'
);
```

Also expected: `match_scores`, `academy_records`, `payslips` (Managed Staffing), `check_ins` (supervision) and `concerns` (a channel for both sides to raise issues).

## 4. Access control (RLS)

Staff see everything for their brand. Clients see only their own requests and the shortlists Amana released to them. Professionals see only their own record.

```sql
ALTER TABLE professionals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "professional reads own record"
ON professionals FOR SELECT
USING (user_id = auth.uid());

CREATE POLICY "staff read amana professionals"
ON professionals FOR SELECT
USING (
  brand_scope IN ('amana', 'global')
  AND EXISTS (
    SELECT 1 FROM staff_members s
    WHERE s.user_id = auth.uid() AND s.brand_scope = 'amana'
  )
);
```

Clients never query `professionals` directly. They read a `shortlists` view, or a function that returns only released, approved profiles with limited fields.

## 5. Matching

Deterministic and explainable, run by staff tooling before any shortlist is released.

1. **Hard filters:** `brand_scope = 'amana'`, `is_verified = true`, role matches, location within range, live-in or live-out compatible, and plan-tier requirements met (for example, defensive-driving certification for Premium drivers).
2. **Scoring:** experience and career level, languages, schedule fit, prior placement retention, Academy results.
3. **Output:** ranked candidates with the reasons for each score. Staff approve before release.

```typescript
export interface MatchRequest {
  brandScope: 'amana';
  role: string;
  location: string;
  liveIn?: boolean;
  languages?: string[];
  plan: 'standard' | 'premium' | 'executive';
}
```

## 6. Verification flow

1. Professional applies. A `professionals` row and `vetting_records` for all eight stages are created.
2. Smile ID handles the identity stage. Its result is stored on the record and sets the Verified badge.
3. Staff record the other stages: police character certificate, guarantors, references, medical, assessment, training.
4. When every stage passes, `is_verified` is set and the professional enters the matching pool.

## 7. Notifications

Email through Resend. SMS or WhatsApp for professionals who are hard to reach by email. Triggers include vetting stage changes, shortlist released, placement confirmed, check-in due, payslip issued and replacement opened. No in-app chat in v1.

## 8. Security and privacy

- Documents (ID, certificates, guarantor forms) live in private Supabase Storage buckets with short-lived signed URLs.
- Share a professional's details with a client only after consent, and only the fields needed.
- Follow NDPR requirements. Define retention periods for vetting documents.
- Account deletion cascades across profile, vetting and placement records (`ON DELETE CASCADE`), subject to any legal retention.
- Sentry must not capture personal data. Scrub payloads.

## 9. Open decisions

- Employer of record and statutory deductions under Managed Staffing.
- SMS or WhatsApp provider.
- Whether staff tooling is a separate admin app or a role-gated area of the main app.
