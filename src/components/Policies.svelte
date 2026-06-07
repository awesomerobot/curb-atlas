<script>
	import { tick } from 'svelte';
	import { calendarizePolicies } from '../utils/calendarize-policies';
	import Calendar from './Calendar.svelte';

	const { curbZoneId, policies, estimated = false } = $props();

	let highlightedPolicyId = $state(null);

	const setHighlightedPolicyId = (val) => {
		highlightedPolicyId = val;
	};

	const sortedPolicies = $derived(
		JSON.parse(JSON.stringify(policies))?.sort((a, b) => a.priority - b.priority)
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
			Estimated from posted signage — the city's curb-zone pipeline could not
			classify this segment, so policies below are derived from nearby sign
			codes (BTD Sign Code Guide). Verify against the photos under "Posted
			signage."
		</div>
	{/if}

	<ul class="policies-list-container">
		{#each sortedPolicies as policy}
			<li id={policy?.curb_policy_id}>
				<div class="policy-container">
					<div
						class={['policy-text', { highlighted: highlightedPolicyId === policy?.curb_policy_id }]}
					>
						{policy?.description ?? 'No policy description provided.'}
						{#if policy?.derived}<span class="derived-tag">estimated</span>{/if}
						{#if summarizeDays(policy)}<div class="policy-days">{summarizeDays(policy)}</div>{/if}
					</div>
					{#if policy?.published_date}
						<div class="last-updated">
							Last updated {getLastUpdatedString(policy?.published_date)}
						</div>
					{/if}
				</div>
			</li>
		{/each}
	</ul>

	{#key curbZoneId}
		{#if policies && policies.length}
			<div class="title">Calendar</div>

			<Calendar {policies} {setHighlightedPolicyId} />
		{/if}
	{/key}
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

	.policy-container {
		display: flex;
		gap: 0.5rem;
		align-items: start;
		justify-content: space-between;
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
		font-size: var(--font-size-s);
		opacity: 0.75;
		margin-top: 0.15rem;
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
		white-space: nowrap;
	}

	.policies-list-container {
		position: relative;
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		padding: 0;
		margin-left: 1rem;
		max-height: 200px;
		overflow: auto;

		li {
			padding-left: 0;
		}

		li::marker {
			margin-left: 0;
		}
	}
</style>
