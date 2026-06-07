<script>
	import Calendar from './Calendar.svelte';

	const { curbZoneId, policies, estimated = false } = $props();

	let highlightedPolicyId = $state(null);

	const setHighlightedPolicyId = (val) => {
		highlightedPolicyId = val;
	};

	const sortedPolicies = $derived(
		JSON.parse(JSON.stringify(policies))?.sort((a, b) => a.priority - b.priority)
	);

	// The calendar is only meaningful when at least one rule has real schedule
	// info; an unusable-image-only zone would render an empty grid below the
	// title for no reason.
	const hasSchedulableRules = $derived(
		(policies || []).some((p) =>
			(p.rules || []).some((r) => r?.activity && r.activity !== 'unusable image')
		)
	);

	// Replace the city's literal "* Unusable Image" sentinel description with
	// something more honest. The city writes multi-rule policies as a single
	// description string with embedded "* " bullets — split those into a
	// primary line + nested sub-rules so they render as proper bullets.
	const describePolicy = (policy) => {
		const rules = policy?.rules || [];
		if (rules.length && rules.every((r) => r?.activity === 'unusable image')) {
			return { main: 'No data available for this segment', subs: [] };
		}
		const raw = policy?.description ?? 'No policy description provided.';
		const lines = raw
			.split(/\r?\n/)
			.map((l) => l.replace(/^\s*\*\s*/, '').trim())
			.filter(Boolean);
		return { main: lines[0] || '', subs: lines.slice(1) };
	};

	// The city publishes the same date across all policies on a zone in
	// practice, so show the most-recent published_date once below the title
	// rather than repeating it under each row.
	const mostRecentUpdate = $derived(
		(policies || [])
			.map((p) => p?.published_date)
			.filter(Boolean)
			.reduce((max, d) => (max == null || d > max ? d : max), null)
	);

	// The city's policy descriptions ("* No Parking 8:00 AM-12:00 PM") drop the
	// days_of_week, so a Tuesdays-only rule reads as if it's everyday. Pull the
	// day info off the time_spans and surface it as a separate line. Returns
	// null when the rule applies all 7 days (no clarification needed).
	const DAY_ORDER = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
	const DAY_LABEL = {
		sun: 'Sun', mon: 'Mon', tue: 'Tue', wed: 'Wed', thu: 'Thu', fri: 'Fri', sat: 'Sat'
	};
	const summarizeDays = (policy) => {
		const spans = policy?.time_spans || [];
		if (!spans.length) return null;
		const allDays = new Set();
		for (const s of spans) {
			for (const d of s.days_of_week || []) allDays.add(d);
		}
		if (allDays.size === 0 || allDays.size === 7) return null;
		const ordered = DAY_ORDER.filter((d) => allDays.has(d));
		const isMonFri =
			ordered.length === 5 && ['mon', 'tue', 'wed', 'thu', 'fri'].every((d) => allDays.has(d));
		const isMonSat = ordered.length === 6 && !allDays.has('sun');
		if (isMonFri) return 'Mon–Fri';
		if (isMonSat) return 'Mon–Sat';
		return ordered.map((d) => DAY_LABEL[d]).join(', ');
	};

	const getLastUpdatedString = (dateMs) => {
		const date = new Date(dateMs);

		const timeZone = 'America/New_York';

		const options = {
			timeZone: timeZone,
			year: 'numeric',
			month: 'numeric',
			day: 'numeric',
			hour: 'numeric',
			minute: 'numeric',
			hour12: true
		};

		const formattedDate = date.toLocaleString('en-US', options);

		return formattedDate;
	};

	$effect(() => {
		if (highlightedPolicyId) {
			const el = document.getElementById(highlightedPolicyId);
			if (el)
				el.scrollIntoView({
					behavior: 'smooth',
					block: 'center'
				});
		}
	});
</script>

<div class="Policies">
	<div class="title">Policies</div>

	{#if estimated}
		<div class="estimated-banner">
			Estimated from signage inventory — verify against the photos under the
			"Additional info" tab.
		</div>
	{/if}

	<ul class="policies-list-container">
		{#each sortedPolicies as policy}
			{@const desc = describePolicy(policy)}
			<li id={policy?.curb_policy_id}>
				<div class="policy-container">
					{#if summarizeDays(policy)}
						<div class="policy-days">{summarizeDays(policy)}</div>
					{/if}
					<div
						class={['policy-text', { highlighted: highlightedPolicyId === policy?.curb_policy_id }]}
					>
						{desc.main}
						{#if policy?.derived}<span class="derived-tag">estimated</span>{/if}
						{#if desc.subs.length}
							<ul class="policy-subs">
								{#each desc.subs as sub}<li>{sub}</li>{/each}
							</ul>
						{/if}
					</div>
				</div>
			</li>
		{/each}
	</ul>

	{#key curbZoneId}
		{#if hasSchedulableRules}
			<div class="calendar-wrap">
				<Calendar {policies} {setHighlightedPolicyId} />
			</div>
		{/if}
	{/key}

	{#if mostRecentUpdate}
		<div class="last-updated">Last updated {getLastUpdatedString(mostRecentUpdate)}</div>
	{/if}
</div>

<style lang="scss">
	.Policies {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		font-family: var(--primary-font);
	}

	.title {
		font-size: var(--font-size-l);
		font-weight: var(--font-weight-bold);
		text-transform: uppercase;
	}

	.calendar-wrap {
		margin-top: 1.5rem;
	}

	.policy-container {
		display: flex;
		flex-direction: column;
		gap: 0.15rem;
		min-width: 300px;
	}

	.policy-text {
		font-size: var(--font-size-ms);
		color: var(--charles-blue);

		&.highlighted {
			color: var(--optimistic-blue);
		}
	}

	.policy-days {
		font-size: var(--font-size-xs, 0.7rem);
		opacity: 0.7;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		font-weight: var(--font-weight-bold);
	}

	.policy-subs {
		list-style: disc outside;
		padding-inline-start: 1rem;
		margin-top: 0.25rem;
	}

	.estimated-banner {
		font-size: var(--font-size-s);
		font-style: italic;
		color: var(--charles-blue);
		background: rgba(255, 200, 0, 0.18);
		border-left: 3px solid #d4a017;
		padding: 0.5rem 0.75rem;
		border-radius: 4px;
	}

	.derived-tag {
		display: inline-block;
		margin-left: 0.4rem;
		padding: 0 0.3rem;
		font-size: 0.65rem;
		font-weight: var(--font-weight-bold);
		text-transform: uppercase;
		color: #6b4d00;
		background: rgba(255, 200, 0, 0.4);
		border-radius: 2px;
		vertical-align: middle;
	}

	.last-updated {
		font-size: var(--font-size-s);
		opacity: 0.7;
	}

	.policies-list-container {
		position: relative;
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		padding-inline-start: 1.25rem;
		margin-left: 0;
		max-height: 200px;
		overflow: auto;
		list-style: disc outside;
	}
</style>
