// Translates Boston sign codes (BTD/Cartegraph) into CDS-shaped policies that
// mimic the smart-curb-api policy schema. Output policies carry `derived: true`
// so the UI can label them as inferred from the sign inventory rather than
// authoritative city data.
//
// Source: City of Boston BTD "Sign Code Guide" April 2016 (pages 3, 4-9, 10-12,
// 13-16) — covers permit (PB-), street cleaning (S-/AC-), tow zones (T-), and
// meter/parking (P-/MS-) signs. Unrecognized codes return null and the caller
// should fall back to showing the sign's photo / notes_field as-is.

// Boston neighborhood codes used in PB-{NN}{X}
export const NEIGHBORHOOD_CODES = {
	11: 'Beacon Hill',
	15: 'Bay Village',
	18: 'South End',
	19: 'North End',
	23: 'Back Bay',
	24: 'Chinatown',
	25: 'Fenway/Kenmore',
	26: 'South Boston',
	27: 'Leather District',
	28: 'East Boston',
	29: 'Mission Hill',
	30: 'Allston/Brighton',
	31: 'Dorchester',
	32: 'Charlestown',
	33: 'Jamaica Plain',
	34: 'West Roxbury',
	35: 'Roxbury',
	36: 'Roslindale',
	37: 'Hyde Park',
	38: 'West End'
};

const ALL_DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const MON_FRI = ['mon', 'tue', 'wed', 'thu', 'fri'];
const MON_SAT = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const SUN_FRI = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri'];

const ts = (start, end, days = ALL_DAYS, extra = {}) => ({
	time_of_day_start: start,
	time_of_day_end: end,
	days_of_week: days,
	days_of_month: null,
	weeks_of_month: extra.weeks_of_month ?? null,
	months: extra.months ?? null,
	start_date: extra.start_date ?? null,
	end_date: extra.end_date ?? null,
	designated_period: null,
	designated_period_except: null
});

// PB-{NN}{X} permit-parking variants. Each letter encodes a fixed time
// window + days, plus whether non-permit holders may park for 2 hours.
const PB_SUFFIX_TABLE = {
	A: { activity: 'parking', window: ts('00:00', '24:00'), permitOnly: true, label: 'Permit Parking Only — 24/7' },
	B: { activity: 'parking', window: ts('18:00', '08:00'), permitOnly: true, label: 'Permit Parking — 6pm–8am' },
	C: { activity: 'parking', window: ts('08:00', '18:00', MON_FRI), permitOnly: false, maxStayHours: 2, label: '2hr limit (permit exempt) — 8am–6pm Mon–Fri' },
	D: { activity: 'parking', window: ts('00:01', '08:00', MON_FRI), permitOnly: true, label: 'Permit Parking — 12:01am–8am Mon–Fri' },
	E: { activity: 'parking', window: ts('08:00', '18:00', MON_FRI), permitOnly: true, label: 'Permit Parking — 8am–6pm Mon–Fri' },
	F: { activity: 'parking', window: ts('08:00', '20:00', MON_FRI), permitOnly: true, label: 'Permit Parking — 8am–8pm Mon–Fri' },
	G: { activity: 'parking', window: ts('18:00', '10:00', MON_FRI), permitOnly: true, label: 'Permit Parking — 6pm–10am Mon–Fri' },
	H: { activity: 'parking', window: ts('18:00', '10:00', MON_FRI), permitOnly: false, maxStayHours: 2, label: '2hr limit (permit exempt) — 6pm–10am Mon–Fri' },
	I: { activity: 'parking', window: ts('18:00', '10:00', SUN_FRI), permitOnly: false, maxStayHours: 2, label: '2hr limit (permit exempt) — 6pm–10am Sun–Fri' },
	J: { activity: 'parking', window: ts('10:00', '14:00', MON_FRI), permitOnly: false, maxStayHours: 2, label: '2hr limit (permit exempt) — 10am–2pm Mon–Fri' },
	K: { activity: 'parking', window: ts('10:00', '14:00', MON_FRI), permitOnly: true, label: 'Permit Parking — 10am–2pm Mon–Fri' },
	M: { activity: 'parking', window: ts('18:00', '10:00', SUN_FRI), permitOnly: true, label: 'Permit Parking — 6pm–10am Sun–Fri' },
	N: { activity: 'parking', window: ts('10:00', '18:00', MON_FRI), permitOnly: true, label: 'Permit Parking — 10am–6pm Mon–Fri' },
	O: { activity: 'parking', window: ts('10:00', '18:00', MON_FRI), permitOnly: false, maxStayHours: 2, label: '2hr limit (permit exempt) — 10am–6pm Mon–Fri' },
	S: { activity: 'parking', window: ts('00:00', '24:00'), permitOnly: true, label: 'Special Resident Permit Parking' }
};

const parsePB = (code) => {
	const m = /^PB-(\d{2})([A-Z])$/.exec(code);
	if (!m) return null;
	const nn = Number(m[1]);
	const suffix = m[2];
	const neighborhood = NEIGHBORHOOD_CODES[nn];
	const entry = PB_SUFFIX_TABLE[suffix];
	if (!neighborhood || !entry) return null;

	const rules = [];
	if (entry.permitOnly) {
		rules.push({
			activity: entry.activity,
			user_classes: [`permit:${nn}`],
			user_classes_except: null,
			max_stay: null,
			max_stay_unit: null,
			no_return: null,
			no_return_unit: null,
			purposes: null,
			description: `${neighborhood} permit holders only`
		});
	} else {
		// 2hr limit for general public, unlimited for permit holders.
		rules.push({
			activity: entry.activity,
			user_classes: null,
			user_classes_except: [`permit:${nn}`],
			max_stay: entry.maxStayHours,
			max_stay_unit: 'hour',
			no_return: null,
			no_return_unit: null,
			purposes: null,
			description: `${entry.maxStayHours}-hour limit, ${neighborhood} permit holders exempt`
		});
	}
	return {
		name: code,
		description: `${neighborhood}: ${entry.label}`,
		priority: 50,
		rules,
		time_spans: [entry.window]
	};
};

// Street cleaning codes S-1..S-57. Each is a single day-of-week (or
// 1st/3rd, 2nd/4th) and time window; vehicles must move during cleaning.
// Months are April-November unless special tab "C" applies (handled at
// the caller — special-tab logic lives in parseSpecialTab below).
const S_TABLE = {
	'S-1':  ['mon', '05:00', '07:00'],
	'S-2':  ['tue', '05:00', '07:00'],
	'S-3':  ['wed', '05:00', '07:00'],
	'S-4':  ['thu', '05:00', '07:00'],
	'S-5':  ['fri', '05:00', '07:00'],
	'S-6':  ['mon', '08:00', '12:00'],
	'S-7':  ['mon', '12:00', '16:00'],
	'S-8':  ['tue', '08:00', '12:00'],
	'S-9':  ['tue', '12:00', '16:00'],
	'S-10': ['wed', '08:00', '12:00'],
	'S-11': ['wed', '12:00', '16:00'],
	'S-12': ['thu', '08:00', '12:00'],
	'S-13': ['thu', '12:00', '16:00'],
	'S-14': ['fri', '08:00', '12:00'],
	'S-15': ['fri', '12:00', '16:00'],
	'S-16': ['mon', '08:00', '12:00', { weeks: [1, 3] }],
	'S-17': ['mon', '12:00', '16:00', { weeks: [1, 3] }],
	'S-18': ['mon', '08:00', '12:00', { weeks: [2, 4] }],
	'S-19': ['mon', '12:00', '16:00', { weeks: [2, 4] }],
	'S-20': ['tue', '08:00', '12:00', { weeks: [1, 3] }],
	'S-21': ['tue', '12:00', '16:00', { weeks: [1, 3] }],
	'S-22': ['tue', '08:00', '12:00', { weeks: [2, 4] }],
	'S-23': ['tue', '12:00', '16:00', { weeks: [2, 4] }],
	'S-24': ['wed', '08:00', '12:00', { weeks: [1, 3] }],
	'S-25': ['wed', '12:00', '16:00', { weeks: [1, 3] }],
	'S-26': ['wed', '08:00', '12:00', { weeks: [2, 4] }],
	'S-27': ['wed', '12:00', '16:00', { weeks: [2, 4] }],
	'S-28': ['thu', '08:00', '12:00', { weeks: [1, 3] }],
	'S-29': ['thu', '12:00', '16:00', { weeks: [1, 3] }],
	'S-30': ['thu', '08:00', '12:00', { weeks: [2, 4] }],
	'S-31': ['thu', '12:00', '16:00', { weeks: [2, 4] }],
	'S-32': ['fri', '08:00', '12:00', { weeks: [1, 3] }],
	'S-33': ['fri', '12:00', '16:00', { weeks: [1, 3] }],
	'S-34': ['fri', '08:00', '12:00', { weeks: [2, 4] }],
	'S-35': ['fri', '12:00', '16:00', { weeks: [2, 4] }],
	'S-36': ['wed', '08:00', '12:00', { weeks: [1, 3, 5] }],
	'S-37': ['wed', '12:00', '16:00', { weeks: [1, 3, 5] }],
	'S-38': ['thu', '08:00', '12:00', { weeks: [1, 3, 5] }],
	'S-39': ['thu', '12:00', '16:00', { weeks: [1, 3, 5] }],
	'S-40': ['fri', '08:00', '12:00', { weeks: [1, 3, 5] }],
	'S-41': ['fri', '12:00', '16:00', { weeks: [1, 3, 5] }],
	'S-50': [null, '02:00', '07:00'],
	'S-51': ['mon', '00:01', '07:00'],
	'S-52': ['tue', '00:01', '07:00'],
	'S-53': ['wed', '00:01', '07:00'],
	'S-54': ['thu', '00:01', '07:00'],
	'S-55': ['fri', '00:01', '07:00'],
	'S-56': [['mon', 'wed'], '02:00', '06:00'],
	'S-57': [['tue', 'fri'], '02:00', '06:00']
};

const CLEANING_MONTHS = [4, 5, 6, 7, 8, 9, 10, 11];

const buildCleaningPolicy = (code, entry, monthsOverride = CLEANING_MONTHS) => {
	const [dayOrDays, start, end, opts = {}] = entry;
	const days = Array.isArray(dayOrDays)
		? dayOrDays
		: dayOrDays
			? [dayOrDays]
			: ALL_DAYS;
	const window = ts(start, end, days, {
		weeks_of_month: opts.weeks ?? null,
		months: monthsOverride
	});
	return {
		name: code,
		description: `Street cleaning — ${code}`,
		priority: 70,
		rules: [
			{
				activity: 'no parking',
				user_classes: null,
				user_classes_except: null,
				max_stay: null,
				max_stay_unit: null,
				no_return: null,
				no_return_unit: null,
				purposes: null,
				description: 'Street cleaning — vehicles must be moved'
			}
		],
		time_spans: [window]
	};
};

const parseS = (rawCode) => {
	// Special-tab suffix A/B/C alters times/months but the base S- code drives the day pattern.
	const m = /^(S-\d{1,2})([ABC])?$/.exec(rawCode);
	if (!m) return null;
	const base = m[1];
	const tab = m[2];
	const entry = S_TABLE[base];
	if (!entry) return null;
	let policy = buildCleaningPolicy(base, entry);
	if (tab === 'A') {
		// "Changes times to 9am - 1pm"
		policy.time_spans = policy.time_spans.map((s) => ({ ...s, time_of_day_start: '09:00', time_of_day_end: '13:00' }));
		policy.name = rawCode;
	} else if (tab === 'B') {
		// "Changes times to 1pm - 5pm"
		policy.time_spans = policy.time_spans.map((s) => ({ ...s, time_of_day_start: '13:00', time_of_day_end: '17:00' }));
		policy.name = rawCode;
	} else if (tab === 'C') {
		// "Changes months to March 1 to December 31"
		policy.time_spans = policy.time_spans.map((s) => ({ ...s, months: [3, 4, 5, 6, 7, 8, 9, 10, 11, 12] }));
		policy.name = rawCode;
	}
	return policy;
};

// AC-* — Street cleaning + snow emergency. The snow-emergency conditional is
// not expressible in CDS time_spans (it depends on a citywide event), so we
// emit only the cleaning component and add a note.
const AC_TABLE = {
	'AC-1':  ['mon', '00:01', '07:00'],
	'AC-2':  ['tue', '00:01', '07:00'],
	'AC-3':  ['wed', '00:01', '07:00'],
	'AC-4':  ['thu', '00:01', '07:00'],
	'AC-5':  ['fri', '00:01', '07:00'],
	'AC-6':  ['mon', '02:00', '07:00'],
	'AC-7':  ['tue', '02:00', '07:00'],
	'AC-8':  ['wed', '02:00', '07:00'],
	'AC-9':  ['thu', '02:00', '07:00'],
	'AC-10': ['fri', '02:00', '07:00'],
	'AC-11': [null, '02:00', '07:00'],
	'AC-12': [null, '00:01', '07:00'],
	'AC-13': ['mon', '05:00', '07:00'],
	'AC-14': ['tue', '05:00', '07:00'],
	'AC-15': ['wed', '05:00', '07:00'],
	'AC-16': ['thu', '05:00', '07:00'],
	'AC-17': ['fri', '05:00', '07:00']
};

const parseAC = (code) => {
	const entry = AC_TABLE[code];
	if (!entry) return null;
	const p = buildCleaningPolicy(code, entry);
	p.description = `Street cleaning + snow emergency tow zone — ${code}`;
	p.rules[0].description = 'Street cleaning, also active during snow emergencies';
	return p;
};

// Tow Zone signs T-*. Many of these are bare codes with explicit time text on
// the sign; the Sign Code Guide enumerates them. Codes not in this table fall
// back to the generic "tow zone" rule with notes_field providing detail.
const T_TABLE = {
	'T-1':    { activity: 'no parking',  window: ts('08:00', '18:00', MON_FRI), desc: 'Tow zone — no parking 8am–6pm Mon–Fri' },
	'T-1A':   { activity: 'no parking',  window: ts('07:00', '09:30', MON_FRI), desc: 'Tow zone — no parking 7am–9:30am Mon–Fri' },
	'T-1B':   { activity: 'no parking',  window: ts('07:00', '09:30', MON_FRI), desc: 'Tow zone — no parking 7am–9:30am Mon–Fri' },
	'T-1C':   { activity: 'no parking',  window: ts('16:00', '18:00', MON_FRI), desc: 'Tow zone — no parking 4pm–6pm Mon–Fri' },
	'T-1D':   { activity: 'no parking',  window: ts('16:00', '18:00', MON_FRI), desc: 'Tow zone — no parking 4pm–6pm Mon–Fri' },
	'T-1E':   { activity: 'no parking',  window: ts('07:00', '16:00', MON_FRI), desc: 'Tow zone — no parking 7am–4pm school days' },
	'T-1-CP': { activity: 'loading',     window: ts('11:00', '20:00'),          maxStay: 10, maxStayUnit: 'minute', desc: 'Curb side food pickup 11am–8pm, 10 min limit' },
	'T-1-EV': { activity: 'parking',     window: ts('00:00', '24:00'),          maxStay: 4, maxStayUnit: 'hour', userClasses: ['electric_vehicle'], desc: 'Reserved for electric vehicles — 4hr limit' },
	'T-1-FT': { activity: 'parking',     window: ts('00:00', '24:00'),          userClasses: ['food_truck'], desc: 'Reserved for food truck' },
	'T-4':    { activity: 'parking',     window: ts('00:00', '24:00'),          userClasses: ['handicap_disabled_veteran'], desc: 'HP-DV plate/placard only — 24/7' },
	'T-4A':   { activity: 'parking',     window: ts('08:00', '18:00'),          userClasses: ['handicap_disabled_veteran'], desc: 'HP-DV plate/placard only — 8am–6pm' },
	'T-4RS':  { activity: 'parking',     window: ts('00:00', '24:00'),          userClasses: ['handicap_disabled_veteran'], desc: 'HP-DV only, additional restrictions during Red Sox games' },
	'T-5':    { activity: 'no parking',  window: ts('00:00', '24:00'),          desc: 'Cab stand — no parking' },
	'T-6':    { activity: 'no parking',  window: ts('00:00', '24:00'),          desc: 'Curb ramp — no parking' },
	'T-7':    { activity: 'no parking',  window: ts('00:00', '24:00'),          desc: 'Emergency artery — no parking during snow emergencies' },
	'T-10':   { activity: 'no stopping', window: ts('07:00', '09:30', MON_FRI), desc: 'No stopping 7am–9:30am Mon–Fri' },
	'T-11':   { activity: 'no stopping', window: ts('16:00', '18:00', MON_FRI), desc: 'No stopping 4pm–6pm Mon–Fri' },
	'T-12':   { activity: 'no stopping', window: ts('07:00', '09:30', MON_FRI), desc: 'No stopping 7am–9:30am + 4pm–6pm Mon–Fri', extraSpans: [ts('16:00', '18:00', MON_FRI)] },
	'T-13':   { activity: 'no stopping', window: ts('00:00', '24:00'),          desc: 'No stopping — fire house' },
	'T-14':   { activity: 'no stopping', window: ts('00:00', '24:00'),          desc: 'No stopping — fire lane' },
	'T-15':   { activity: 'no stopping', window: ts('07:00', '09:30', MON_FRI), desc: 'No stopping 7am–9:30am + no parking 9:30am–6pm Mon–Fri' },
	'T-16':   { activity: 'no stopping', window: ts('16:00', '18:00', MON_FRI), desc: 'No stopping 4pm–6pm + no parking 7am–4pm Mon–Fri' },
	'T-17':   { activity: 'no stopping', window: ts('07:00', '09:30', MON_FRI), desc: 'No stopping 7am–9:30am + no parking anytime Mon–Fri', extraSpans: [ts('00:00', '24:00', MON_FRI)] },
	'T-18':   { activity: 'no stopping', window: ts('16:00', '18:00', MON_FRI), desc: 'No stopping 4pm–6pm + no parking anytime Mon–Fri' },
	'T-19':   { activity: 'no stopping', window: ts('07:00', '09:30', MON_FRI), desc: 'No stopping 7am–9:30am + 4pm–6pm + no parking anytime Mon–Fri' },
	'T-23':   { activity: 'no stopping', window: ts('00:00', '24:00'),          desc: 'No stopping any time' },
	'T-23B':  { activity: 'no stopping', window: ts('00:00', '24:00'),          desc: 'No stopping — bike lane' },
	'T-23RS': { activity: 'no stopping', window: ts('00:00', '24:00'),          desc: 'No stopping during Red Sox day/night games (4hr before to 2hr after)' },
	'T-23X':  { activity: 'no stopping', window: ts('00:00', '24:00'),          desc: 'No stopping — emergency vehicle access' },
	'T-24':   { activity: 'no stopping', window: ts('08:00', '18:00', MON_FRI), desc: 'No stopping 8am–6pm Mon–Fri' },
	'T-25':   { activity: 'no stopping', window: ts('07:00', '19:00', MON_SAT), desc: 'No stopping 7am–7pm except Sunday' },
	'T-26':   { activity: 'no stopping', window: ts('07:00', '19:00', MON_SAT), desc: 'No stopping 7am–7pm + no parking 7pm–7am except Sunday' },
	'T-27':   { activity: 'no stopping', window: ts('07:00', '19:00', MON_FRI), desc: 'No stopping 7am–7pm Mon–Fri' },
	'T-28':   { activity: 'loading',     window: ts('00:00', '24:00', MON_FRI), maxStay: 30, maxStayUnit: 'minute', desc: 'Loading zone Mon–Fri, 30 min limit' },
	'T-29':   { activity: 'loading',     window: ts('07:00', '19:00', MON_SAT), maxStay: 30, maxStayUnit: 'minute', desc: 'Loading zone 7am–7pm except Sun, 30 min limit' },
	'T-29A':  { activity: 'loading',     window: ts('07:00', '19:00', MON_FRI), maxStay: 30, maxStayUnit: 'minute', desc: 'Loading zone 7am–7pm Mon–Fri, 30 min limit' },
	'T-30':   { activity: 'loading',     window: ts('08:00', '16:00', MON_FRI), maxStay: 30, maxStayUnit: 'minute', desc: 'Loading zone 8am–4pm Mon–Fri, 30 min limit' },
	'T-31':   { activity: 'loading',     window: ts('07:00', '16:00', MON_FRI), maxStay: 30, maxStayUnit: 'minute', desc: 'Loading zone 7am–4pm Mon–Fri, 30 min limit' },
	'T-32':   { activity: 'loading',     window: ts('09:30', '18:00', SUN_FRI), maxStay: 30, maxStayUnit: 'minute', desc: 'Loading zone 9:30am–6pm except Sat, 30 min limit' },
	'T-33':   { activity: 'loading',     window: ts('09:30', '16:00', MON_FRI), maxStay: 30, maxStayUnit: 'minute', desc: 'Loading zone 9:30am–4pm Mon–Fri, 30 min limit' },
	'T-34':   { activity: 'loading',     window: ts('08:00', '18:00', MON_FRI), maxStay: 30, maxStayUnit: 'minute', desc: 'Loading zone 8am–6pm Mon–Fri, 30 min limit' },
	'T-35':   { activity: 'loading',     window: ts('00:00', '24:00'),          maxStay: 15, maxStayUnit: 'minute', desc: 'Valet zone — 15 min limit' },
	'T-37':   { activity: 'no parking',  window: ts('00:00', '24:00'),          desc: 'Tour bus stop' },
	'T-39':   { activity: 'parking',     window: ts('00:00', '24:00'),          userClasses: ['tour_bus'], desc: 'Tour bus parking' },
	'T-41':   { activity: 'loading',     window: ts('00:00', '24:00'),          maxStay: 10, maxStayUnit: 'minute', desc: 'City licensed sightseeing bus stop — 10 min limit' }
};

// Special-tab suffix on T- codes: e.g. T-23N = T-23 base + N suffix (Pick up / Drop off variant)
const T_SPECIAL_TABS = {
	J: { user_classes: ['city_vehicle'], desc: 'Reserved for city vehicles' },
	K: { user_classes: ['general_court'], desc: 'Reserved for general court' },
	L: { user_classes: ['ambulance'], desc: 'Reserved for ambulances' },
	M: { side: 'either', desc: 'Either side of street' },
	N: { activity: 'loading', maxStay: 10, maxStayUnit: 'minute', desc: 'Pick up / drop off, 10 min limit' },
	P: { user_classes: ['postal'], desc: 'Reserved for postal vehicles' },
	Q: { user_classes: ['car_share'], desc: 'Reserved for car share vehicles' }
};

const parseT = (rawCode) => {
	// First try the literal table.
	let entry = T_TABLE[rawCode];
	let appliedTab = null;
	if (!entry) {
		// Try stripping a final single-letter special tab.
		const m = /^(T-[\dA-Z-]+?)([JKLMNPQ])$/.exec(rawCode);
		if (m && T_TABLE[m[1]]) {
			entry = T_TABLE[m[1]];
			appliedTab = T_SPECIAL_TABS[m[2]];
		}
	}
	if (!entry) return null;

	const rule = {
		activity: appliedTab?.activity || entry.activity,
		user_classes: appliedTab?.user_classes || entry.userClasses || null,
		user_classes_except: null,
		max_stay: appliedTab?.maxStay ?? entry.maxStay ?? null,
		max_stay_unit: appliedTab?.maxStayUnit ?? entry.maxStayUnit ?? null,
		no_return: null,
		no_return_unit: null,
		purposes: null,
		description: appliedTab ? `${entry.desc} (${appliedTab.desc})` : entry.desc
	};

	return {
		name: rawCode,
		description: rule.description,
		priority: 60,
		rules: [rule],
		time_spans: [entry.window, ...(entry.extraSpans || [])]
	};
};

// Parking and meter signs from page 2-3 of the guide.
const P_MS_TABLE = {
	'P-3':   { activity: 'parking', window: ts('00:00', '24:00'), desc: 'Angle parking' },
	'P-4':   { activity: 'parking', window: ts('00:00', '24:00'), desc: 'Parallel parking' },
	'P-6':   { activity: 'parking', window: ts('00:00', '24:00'), maxStay: 2, maxStayUnit: 'hour', desc: 'Parking, 2 hour limit' },
	'P-7':   { activity: 'parking', window: ts('08:00', '18:00', MON_FRI), maxStay: 2, maxStayUnit: 'hour', desc: '2hr limit 8am–6pm Mon–Fri' },
	'P-7A':  { activity: 'parking', window: ts('08:00', '18:00', MON_SAT), maxStay: 2, maxStayUnit: 'hour', desc: '2hr limit 8am–6pm Mon–Sat' },
	'P-10':  { activity: 'parking', window: ts('00:00', '24:00'), desc: 'General parking allowed' },
	'P-11':  { activity: 'parking', window: ts('00:00', '24:00'), userClasses: ['electric_vehicle'], desc: 'Electric vehicle parking only' },
	'MS-6':  { activity: 'parking', window: ts('08:00', '20:00', MON_SAT), maxStay: 2, maxStayUnit: 'hour', paid: true, desc: 'Meter — 2hr limit, 8am–8pm except Sunday, pay multi-space meter' },
	'MS-7':  { activity: 'parking', window: ts('00:00', '24:00'), paid: true, desc: 'Pay meter here' }
};

const parsePMS = (code) => {
	const entry = P_MS_TABLE[code];
	if (!entry) return null;
	return {
		name: code,
		description: entry.desc,
		priority: 40,
		rules: [
			{
				activity: entry.activity,
				user_classes: entry.userClasses || null,
				user_classes_except: null,
				max_stay: entry.maxStay ?? null,
				max_stay_unit: entry.maxStayUnit ?? null,
				no_return: null,
				no_return_unit: null,
				purposes: null,
				description: entry.desc
			}
		],
		time_spans: [entry.window],
		rates: entry.paid ? [{ rate: null, rate_unit: 'hour', start_duration: 0, end_duration: null }] : []
	};
};

// Normalize the messy real-world code strings before dictionary lookup.
// CSV data carries decorations like `T-23(L)`, `PB-18C (L)`, `T-1E(MOD)`,
// `W-6 (LED)`, `R-1 (30"x30")`, ` Special`, etc. — strip them. Also
// canonicalize T-1-EV / T-1EV style variants.
const normalizeCode = (raw) => {
	let s = String(raw || '').trim();
	if (!s) return '';
	// Iterate stripping suffixes until stable. Real CSV codes can stack
	// annotations like "T-28 (L) Special" or "R-1 (30\"x30\")".
	for (let i = 0; i < 5; i++) {
		const before = s;
		s = s.replace(/\s*\([^)]*\)\s*$/, '');
		s = s.replace(/\s+(Special|SPECIAL|MOD|mod)\s*$/, '');
		s = s.trim();
		if (s === before) break;
	}
	// Canonicalize T-1EV → T-1-EV, T-1CP → T-1-CP, T-1FT → T-1-FT.
	s = s.replace(/^T-1(EV|CP|FT)$/, 'T-1-$1');
	return s;
};

// Main entry point — returns a CDS-shaped policy (or null) and tags it derived.
// Caller threads the sign's oid through for stable IDs.
export const deriveSignPolicy = (rawCode, signOid = '') => {
	const code = normalizeCode(rawCode);
	if (!code) return null;
	// Reject placeholders left in the data ("S-#", "T-#", "PBS-XX", "NA").
	if (/^[A-Z]+-#$/.test(code) || /XX$/.test(code) || code === 'NA') return null;

	let policy = parsePB(code) || parseS(code) || parseAC(code) || parseT(code) || parsePMS(code);
	if (!policy) return null;

	// Stamp synthetic IDs + derived flag so the UI can label these.
	const idStub = `derived:${signOid || code}`;
	policy.curb_policy_id = idStub;
	policy.published_date = null;
	policy.policy_color = null;
	policy.rates = policy.rates || [];
	policy.derived = true;
	policy.derived_from = { code, sign_oid: signOid || null };
	policy.rules = policy.rules.map((r, i) => ({
		...r,
		rule_id: `${idStub}:r${i}`,
		curb_policy_id: idStub,
		name: null
	}));
	policy.time_spans = policy.time_spans.map((s, i) => ({
		...s,
		time_span_id: `${idStub}:ts${i}`,
		curb_policy_id: idStub
	}));
	return policy;
};

export const isDictionaryCode = (rawCode) => deriveSignPolicy(rawCode, '') !== null;
