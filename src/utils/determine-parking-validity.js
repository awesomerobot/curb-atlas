import { trimQuotes, timeToNumber } from './basic-utils';

const determineParkingValidity = async (policies, zoneProperties, day, time) => {
	let { curb_policy_ids, curb_zone_id } = zoneProperties;
	curb_policy_ids = curb_policy_ids.filter(Boolean);

	// Upstream returned `{ zoneProperties }` (object wrapper) here, which lost
	// the top-level fields — including curb_zone_id — for any zone with no
	// policies. Return the properties directly so the feature is identifiable
	// downstream and renders correctly.
	if (!curb_policy_ids || !curb_policy_ids.length) return { ...zoneProperties };

	const properties = {
		zoneId: curb_zone_id,
		// canPark = freely parkable right now for a regular car (no permit
		// or payment needed). The map filter then optionally widens that to
		// include permit-only or paid zones via the checkboxes.
		canPark: false,
		// permitted / paid are zone-level "has this characteristic anywhere"
		// flags, NOT gated on right-now activity. Each filter checkbox adds
		// zones whose flag is set, regardless of canPark.
		permitted: false,
		accessible: false,
		loadingZone: false,
		unusableImage: false,
		maxStay: null,
		paid: false
	};

	// Pre-scan: flag permitted/paid based on any rule that indicates them,
	// across all the zone's policies (not just active-now ones).
	const permitDescRe = /permit|resident only|residents only|hp\/dv|disabled veteran/;
	for (const policy of policies.filter(Boolean)) {
		if ((policy.rates || []).length) properties.paid = true;
		const desc = (policy.description || '').toLowerCase();
		if (permitDescRe.test(desc)) properties.permitted = true;
		for (const r of (policy.rules || [])) {
			const uc = r?.user_classes || [];
			const purp = r?.purposes || [];
			if (uc.some((v) => /permit/i.test(v))) properties.permitted = true;
			if (purp.some((v) => ['permit', 'disabled_parking_permit'].includes(v))) {
				properties.permitted = true;
			}
		}
	}

	// canPark tracking — does the zone's regulation actually let a regular
	// car park right now?
	let hasTimeLimitedRule = false;
	let anyRuleActiveNow = false;

	// Sort by priority order
	const sortedPolicies = policies.sort((a, b) => a.priority - b.priority);

	for (const policy of sortedPolicies) {
		let { rules = [], time_spans = [] } = policy ?? {};

		rules = Array.isArray(rules) ? rules.filter(Boolean) : [];
		time_spans = Array.isArray(time_spans) ? time_spans.filter(Boolean) : [];
		// Boston tags permit/HP-DV-only zones as activity="no parking" with the
		// permit nuance only in the description text. Detect those so we treat
		// the rule as permit-allowed parking instead of a flat ban.
		const description = (policy?.description || '').toLowerCase();
		const isPermitDescription =
			/permit|resident only|residents only|hp\/dv|disabled veteran/.test(description);

		for (const rule of rules) {
			let {
				activity = null,
				purposes = [],
				user_classes = [],
				max_stay,
				max_stay_unit
			} = rule ?? {};

			// Gross data fixing
			if (!purposes) purposes = [];
			if (!user_classes) user_classes = [];
			purposes = purposes.map(trimQuotes);
			user_classes = user_classes.map(trimQuotes);

			for (const timespan of time_spans) {
				let {
					days_of_week = null,
					time_of_day_start = null,
					time_of_day_end = null
				} = timespan ?? {};

				if (days_of_week !== null) {
					days_of_week = days_of_week.map(trimQuotes);
				}

				time_of_day_start = timeToNumber(time_of_day_start);
				if (time_of_day_start === 24) {
					time_of_day_start = 0;
				}
				time_of_day_end = timeToNumber(time_of_day_end);
				if (time_of_day_end === 0) {
					time_of_day_end = 24;
				}

				const isParking = !!activity && activity === 'parking';

				const dayApplies = !days_of_week || days_of_week.includes(day);
				const timeApplies =
					time_of_day_start === null ||
					time_of_day_start === time_of_day_end ||
					(time >= time_of_day_start && time <= time_of_day_end);
				const ruleApplies = dayApplies && timeApplies;
				const isTimeLimited =
					!!days_of_week ||
					(time_of_day_start !== null && time_of_day_start !== time_of_day_end);

				// POSITIVE
				// Check for basic parking eligibility
				if (isParking) {
					if (isTimeLimited) hasTimeLimitedRule = true;
					if (!ruleApplies) {
						// Off-window: rule says nothing about this moment — don't
						// flip canPark either way. The permissive default below
						// handles the "free parking outside the window" case.
						continue;
					}
					anyRuleActiveNow = true;
					// Only mark a regular car as able to park when the rule
					// is open to all comers — permit-only or non-car-only
					// rules don't grant canPark for our default user.
					const userClassIsPermit =
						Array.isArray(user_classes) &&
						user_classes.some((v) => /permit/i.test(v));
					const requiresSpecialClass =
						Array.isArray(user_classes) &&
						user_classes.length > 0 &&
						!user_classes.includes('car') &&
						user_classes.length > 0;
					if (!userClassIsPermit && !requiresSpecialClass) {
						properties.canPark = true;
					}
					if (Array.isArray(user_classes) && user_classes.includes('accessible')) {
						properties.accessible = true;
					}

					// Track max stay only when the rule is the one currently
					// granting parking (so we don't surface limits the user
					// can't actually be subject to).
					if (properties.canPark && max_stay && max_stay_unit) {
						properties.maxStay = max_stay_unit === 'hour' ? max_stay * 60 : max_stay;
					}
				} // No parking
				else {
					if (activity === 'no parking' || activity === 'no stopping') {
						if (isTimeLimited) hasTimeLimitedRule = true;
						if (ruleApplies) anyRuleActiveNow = true;
						// An active flat-restriction flips canPark to false
						// for regular cars (permit-only zones still mark
						// permitted=true via the pre-scan, so the permit
						// filter can re-include them).
						if (ruleApplies && properties.canPark) {
							properties.canPark = false;
						}
					}

					if (activity === 'loading' && ruleApplies) {
						properties.loadingZone = true;
					}
				}
			}
		}
	}

	// Permissive default: if the zone's only regulations are time-limited
	// (either "no parking Tue 12-4" or "metered Mon-Sat 8-8") and none of
	// them apply right now, parking is allowed. Without this, off-window
	// times read as "no parking" when they should be free.
	if (!properties.canPark && hasTimeLimitedRule && !anyRuleActiveNow) {
		properties.canPark = true;
	}


	// Only mark unusable if we couldn't determine any parking policy
	if (!properties.canPark && !properties.loadingZone) {
		const hasKnownPolicy = policies.some((policy) =>
			(policy?.rules ?? []).some(
				(rule) => rule?.activity && rule.activity !== 'unusable image'
			)
		);
		if (!hasKnownPolicy) {
			const hasUnusableImage = policies.some((policy) =>
				(policy?.rules ?? []).some((rule) => rule?.activity === 'unusable image')
			);
			properties.unusableImage = hasUnusableImage;
		}
	}

	if (properties.maxStay === null) {
		delete properties.maxStay;
	}

	return { ...zoneProperties, ...properties };
};

export { determineParkingValidity };
