// Controlled vocabularies for the Amana Request schema (intake/schema.js).
// Locking these in one file is the point of Stage A1: the website form,
// the WhatsApp bot, and later the Hiyame portal all import from here
// instead of each inventing their own strings for the same status.
//
// IMPORTANT: per the brief, these values need sign-off before Stage A4
// (the bot) is built against them. Treat anything here as a first draft
// lifted straight from the brief's wording until that sign-off happens -
// don't let a later stage quietly add a status value that isn't listed
// here too.

const STATUS = {
  intake: ['Incomplete', 'New', 'Awaiting Clarification', 'Confirmed'],
  recruitment: ['Sourcing', 'Shortlisting', 'Client Review', 'Interview', 'Candidate Selected'],
  commercial: ['Awaiting Payment', 'Payment Confirmed'],
  fulfilment: ['Placement in Progress', 'Fulfilled', 'Cancelled', 'On Hold'],
};

const ALL_STATUSES = [
  ...STATUS.intake,
  ...STATUS.recruitment,
  ...STATUS.commercial,
  ...STATUS.fulfilment,
];

/** Where a request came from. Keep distinct per channel so journeys stay traceable (Stage H2). */
const SOURCE_CHANNELS = ['Website', 'WhatsApp Bot', 'Hiyame Portal'];

const CLIENT_TYPES = ['Individual / Family', 'Business / Organisation'];

const CONTACT_CHANNELS = ['WhatsApp', 'Phone call', 'Email', 'SMS'];

/**
 * Staff categories, matching the WhatsApp bot's step-2 button options
 * (Stage A4) exactly - these are presented as quick-reply buttons, so
 * the set is intentionally short with an escape hatch for anything else.
 */
const STAFF_CATEGORIES = ['Nanny', 'Housekeeper', 'Cook', 'Cleaner', 'Driver', 'Other'];

const EMPLOYMENT_TYPES = ['Full-time', 'Part-time'];

const LIVE_ARRANGEMENTS = ['Live-in', 'Live-out'];

const URGENCY_LEVELS = ['Immediate (within a week)', 'Within a month', 'Flexible / no fixed date'];

/** Bot Sessions tab completion status (Stage A2 point 1 / Stage A4). */
const SESSION_STATUS = {
  active: 'Active',
  incomplete: 'Incomplete',
  handoff: 'Handoff Requested',
  confirmed: 'Confirmed',
};

/** Phrases that trigger human handoff at any point in the bot flow (Stage A4 rule). */
const HANDOFF_TRIGGERS = ['agent', 'human', 'talk to someone', 'talk to a person', 'representative', 'speak to someone'];

module.exports = {
  STATUS,
  ALL_STATUSES,
  SOURCE_CHANNELS,
  CLIENT_TYPES,
  CONTACT_CHANNELS,
  STAFF_CATEGORIES,
  EMPLOYMENT_TYPES,
  LIVE_ARRANGEMENTS,
  URGENCY_LEVELS,
  SESSION_STATUS,
  HANDOFF_TRIGGERS,
};
