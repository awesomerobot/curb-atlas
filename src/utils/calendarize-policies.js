import plur from 'plur';
import { dayOfWeekOptions } from '../constants';
import { trimQuotes, timeToNumber } from './basic-utils';

const allDaysOfWeek = dayOfWeekOptions.map((d) => d.value);

const calendarizePolicies = (policies) => {
	const policiesClone = JSON.parse(JSON.stringify(policies));
	if (!policiesClone || !policiesClone.length) return;

	let calendar = [];

	const sortedPolicies = policiesClone.sort((a, b) => b.priority - a.priority);

	for (const policy of sortedPolicies) {
		let { rules = [], time_spans = [] } = policy ?? {};
		rules = Array.isArray(rules) ? rules.filter(Boolean) : [];
		time_spans = Array.isArray(time_spans) ? time_spans.filter(Boolean) : [];

		for (const rule of rules) {
			let {
				activity = null,
				purposes = [],
				user_classes = [],
				max_stay,
				max_stay_unit
			} = rule ?? {};

			// The unusable-image sentinel carries no regulation info; rendering
			// it on the calendar would just paint a confusing 24/7 block.
			if (activity === 'unusable image') continue;

			// Clean data
			if (!purposes) purposes = [];
			if (!user_classes) user_classes = [];
			purposes = purposes.map(trimQuotes);
			user_classes = user_classes.map(trimQuotes);

			for (const timespan of time_spans) {
				// Clean data
				let {
					days_of_week = null,
					time_of_day_start = null,
					time_of_day_end = null,
					designated_period
				} = timespan ?? {};

				if (days_of_week !== null && days_of_week !== undefined) {
					days_of_week = days_of_week.map(trimQuotes);
				} else {
					days_of_week = allDaysOfWeek;
				}

				time_of_day_start = timeToNumber(time_of_day_start);
				if (time_of_day_start === 24) {
					time_of_day_start = 0;
				}
				time_of_day_end = timeToNumber(time_of_day_end);
				if (time_of_day_end === 0) {
					time_of_day_end = 24;
				}

				let nextItem = {
					policyId: policy?.curb_policy_id
				};

				if (max_stay) {
					nextItem.maxStay = `${max_stay} ${plur(max_stay_unit, max_stay)}`;
				}

				nextItem.priority = policy?.priority ?? 0;
				nextItem.days = days_of_week;

				// Set the time for the calendar element
				nextItem.start = time_of_day_start === null ? 0 : time_of_day_start;
				nextItem.end = time_of_day_end === null ? 24 : time_of_day_end;

				nextItem.activity = activity;
				nextItem.purposes = purposes;

				nextItem.designatedPeriod = designated_period;

				calendar.push(nextItem);
			}
		}
	}

	const RESTRICTION_ACTIVITIES = new Set(['no parking', 'no stopping', 'no standing']);

	// Mirrors determineParkingValidity's permissive default: if the zone's
	// only regulations are time-limited restrictions, parking is allowed
	// whenever none of those restrictions are active. If true here, we can
	// safely paint gap/idle days blue.
	const hasRestrictionRuleAnywhere = calendar.some((e) =>
		RESTRICTION_ACTIVITIES.has(e.activity)
	);
	const hasPositiveParkingRuleAnywhere = calendar.some((e) => e.activity === 'parking');
	const usePermissiveDefault = hasRestrictionRuleAnywhere && !hasPositiveParkingRuleAnywhere;

	const allowedAllDay = () => ({
		policyId: 'synthetic-allowed',
		priority: -1,
		start: 0,
		end: 24,
		activity: 'parking',
		purposes: []
	});

	const synthesizeAllowedGaps = (events) => {
		const restrictions = events
			.filter((e) => RESTRICTION_ACTIVITIES.has(e.activity))
			.sort((a, b) => a.start - b.start);

		// Day has no events at all: if the zone has restrictions on other days
		// (permissive default applies all day), fill the whole day blue.
		if (!restrictions.length && !events.length) {
			return usePermissiveDefault ? [allowedAllDay()] : events;
		}

		// Existing positive parking events define the schedule themselves —
		// don't try to invent fill that would conflict with them.
		if (events.some((e) => e.activity === 'parking')) return events;

		// Restrictions present: fill the gaps blue.
		if (!restrictions.length) return events;
		const gaps = [];
		let cursor = 0;
		for (const r of restrictions) {
			if (r.start > cursor) gaps.push([cursor, r.start]);
			cursor = Math.max(cursor, r.end);
		}
		if (cursor < 24) gaps.push([cursor, 24]);
		const synthetic = gaps.map(([start, end]) => ({
			policyId: 'synthetic-allowed',
			priority: -1,
			start,
			end,
			activity: 'parking',
			purposes: []
		}));
		return [...events, ...synthetic];
	};

	calendar = allDaysOfWeek.reduce((acc, day) => {
		let events = calendar.filter((c) => c.days.includes(day));
		events = events
			.sort((a, b) => b.priority - a.priority)
			.map((e) => {
				const clone = JSON.parse(JSON.stringify(e));
				delete clone.days;
				return clone;
			});
		acc[day] = synthesizeAllowedGaps(events);
		return acc;
	}, {});

	return calendar;
};

export { calendarizePolicies };
