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
					</div>
					<div class="last-updated">
						Last updated {getLastUpdatedString(policy?.published_date)}
					</div>
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
