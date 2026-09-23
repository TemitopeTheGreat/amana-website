# Product Requirements Document: Amana

**Product:** Amana, a verified domestic and household talent platform for Nigeria and its diaspora.
**Audience:** Households, diaspora families and organisations that hire household staff, and the household professionals they hire.
**Value proposition:** Trusted, vetted, trained and managed household staff, without relying on word of mouth.

The marketing website (this repo) is static. This document specifies the product it points to.

---

## 1. Goals

1. **Trust.** Every professional is verified before a client meets them (identity, guarantors, references, police character certificate, medical screening, role assessment, training).
2. **Accountability after placement.** Amana can stay responsible for payroll, compliance, supervision and replacement (Managed Staffing), or make a one-time vetted introduction (Placement).
3. **Dignity and career growth for workers.** Formal contracts, digital payslips, Academy training and a career ladder: Trainee, Certified, Senior, Lead / House Manager.
4. **Shared infrastructure.** Reuse the shared backend (auth, database, Smile ID, Resend) with sister platforms, with strict brand isolation.

## 2. Personas

**A. Household professional (candidate).** Nanny, housekeeper or cleaner, driver, cook, house manager, companion or carer, gardener, estate staff. Often mobile-first, on limited data, and may have little formal documentation. Needs: fair contracts, reliable pay, training, a way to raise concerns, and a path to better roles.

**B. Family or household (client).** Nigerian families needing dependable help at home. Needs: trust, speed, a replacement guarantee, and one accountable party.

**C. Diaspora family (client).** Pays for staff supporting parents or relatives in Nigeria. Needs: remote onboarding, contracts, payroll, supervision and reporting without being on site.

**D. Organisation (client).** Residential estates, developers, corporates, embassies and NGOs. Needs: estate-wide or bulk arrangements, documentation, a dedicated account contact.

## 3. Service model

| Plan | For | Includes | Replacement |
| :--- | :--- | :--- | :--- |
| Standard | Everyday households | Core verification, role training, matching | 30 days |
| Premium | Specialised or more experienced staff | Enhanced checks, specialised cooks, multilingual nannies, defensive-driving certified drivers | 60 days |
| Executive | High-net-worth homes, embassies, principals | Senior house managers, dedicated relationship management, enhanced protection | 60 days |

Engagement models: **Placement** (one-time vetted introduction) and **Managed Staffing** (payroll, statutory compliance, supervision, replacement).

## 4. Functional requirements

| Module | Feature | Requirement | Priority |
| :--- | :--- | :--- | :--- |
| Intake | Client request | Capture role, schedule, live-in or live-out, location, plan and household notes. Works without an account. | P0 |
| Intake | Professional application | Mobile-first, low-bandwidth application: role, experience, availability, location. | P0 |
| Verification | Identity | Smile ID verification (NIN, BVN or government ID) with a Verified badge. | P0 |
| Verification | Vetting pipeline | Track the eight stages per professional: identity, police character certificate, guarantors, references, medical screening, role assessment, training, final approval. Staff can see status and blockers. | P0 |
| Academy | Training records | Record modules completed, certification level and refresher training. | P1 |
| Matching | Household matching | Rank verified professionals by role, location, schedule, live-in or live-out, languages, experience and plan tier. Deterministic and explainable. | P0 |
| Matching | Shortlist review | Client reviews a shortlist of matched professionals. Amana staff approve before it is sent. | P0 |
| Placement | Onboarding | Contracts, documentation and start date, handled by Amana. | P0 |
| Managed Staffing | Payroll and compliance | Payroll runs, digital payslips, statutory deductions where applicable. | P1 |
| Managed Staffing | Supervision | Scheduled check-ins, and a channel for both client and professional to raise concerns. | P1 |
| Guarantee | Replacement | Open a replacement request within the guarantee window (30 or 60 days) and re-run matching. | P0 |
| Organisations | Bulk arrangements | Multi-role, multi-site staffing plans with an account manager. | P2 |
| Notifications | Email and SMS | Status updates via Resend, and SMS or WhatsApp where reachable. No in-app chat in v1. | P1 |
| Privacy | Consent and data handling | Explicit consent for sharing a professional's details with a client, and data retention rules. | P0 |

## 5. Non-goals (v1)

- Open marketplace with public worker profiles or bidding.
- In-app messaging.
- White-collar or executive recruiting (a separate product line).

## 6. Proposed success metrics

These are starting targets to validate, not commitments.

- **Vetting completion:** 80% or more of applicants who start verification finish it.
- **Time to shortlist:** first shortlist within 72 hours of a complete client request.
- **Placement retention:** 85% or more of placements still active after the replacement window.
- **Replacement rate:** under 15% of placements use the guarantee.

## 7. Open questions

- Which payroll and statutory-deduction rules apply per placement type, and who is the employer of record under Managed Staffing?
- Insurance or fidelity cover: which tiers, which provider?
- How guarantor and police certificate checks are performed and evidenced, and by whom.
- Whether WhatsApp Business is used for candidate and client updates.
