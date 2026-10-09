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

// Matches the wording of the "Amana Domestic Staff Order Request" Google
// Form (https://forms.gle/uAE2rMPf6FAiQwZk9) exactly, since request-
// staff.html is meant to be a like-for-like replacement for it - see
// whatsapp-intake/README.md's "Matched to the Google Form" note.
const CLIENT_TYPES = ['Company or organisation', 'Private household'];

const CONTACT_CHANNELS = ['WhatsApp', 'Phone call', 'Email', 'SMS'];

/**
 * Staff categories, matching the WhatsApp bot's step-2 button options
 * (Stage A4) exactly - these are presented as quick-reply buttons, so
 * the set is intentionally short with an escape hatch for anything else.
 */
const STAFF_CATEGORIES = ['Nanny', 'Housekeeper', 'Cook', 'Cleaner', 'Driver', 'Other'];

const EMPLOYMENT_TYPES = ['Full-time', 'Part-time'];

// The Google Form allows more than one ("Either" and "Monday to Friday
// live-in" as explicit extra options, on top of a client being open to
// both Live-in and Live-out) - liveArrangement is stored as a comma-
// joined string of one or more of these, not a single value.
const LIVE_ARRANGEMENTS = ['Live-in', 'Live-out', 'Either', 'Monday to Friday live-in'];

const URGENCY_LEVELS = ['Immediate (within a week)', 'Within a month', 'Flexible / no fixed date'];

const REGISTRATION_STATUSES = ['I am a new customer', 'I am an existing customer'];

const REFERRAL_SOURCES = ['Google', 'Word of Mouth', 'WhatsApp', 'AI search', 'Social media', 'Other'];

const PROPERTY_TYPES = ['Duplex', 'Flat', 'Bungalow'];

const MAIN_DUTIES = ['Cleaning', 'Cooking', 'Laundry', 'Childcare', 'Shopping / market runs', 'Driving', 'Facility management', 'Tutoring', 'House management'];

const VACANCY_REASONS = ['New position', 'Replacement', 'Additional staff', 'Temporary cover'];

const LIVE_OUT_FREQUENCIES = ['1', '2', '3', '4', '5', '6', 'N/A'];

const MEALS_PROVIDED_OPTIONS = ['1', '2', '3', 'None'];

const ACCOMMODATION_TYPES = ["Room in Boys' Quarters (BQ)", 'Room in main house', 'Separate flat', 'Shared staff room'];

const CUISINES = ['Nigerian', 'Continental', 'Western', 'Asian', 'Baking / pastry', 'Not applicable'];

const DIETARY_REQUIREMENTS = ['Vegetarian', 'Vegan', 'Kosher', 'Halal', 'Gluten-free', 'None', 'Other'];

const CHILDCARE_REQUIREMENTS = ['Newborn / infant care', 'School runs', 'Homework support', 'First-aid trained', 'Special needs experience', 'N/A', 'Other'];

const PREFERRED_AGE_RANGES = ['23-29', '30-40', '41-49', '50-55'];

const PREFERRED_GENDERS = ['Female', 'Male'];

const ID_TYPES = ["NIN slip", "Driver's license", 'International passport', "Voter's card"];

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
  REGISTRATION_STATUSES,
  REFERRAL_SOURCES,
  PROPERTY_TYPES,
  MAIN_DUTIES,
  VACANCY_REASONS,
  LIVE_OUT_FREQUENCIES,
  MEALS_PROVIDED_OPTIONS,
  ACCOMMODATION_TYPES,
  CUISINES,
  DIETARY_REQUIREMENTS,
  CHILDCARE_REQUIREMENTS,
  PREFERRED_AGE_RANGES,
  PREFERRED_GENDERS,
  ID_TYPES,
};
