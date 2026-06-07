<script>
	import { selectedCurbZoneState, signsState } from '../state.svelte';
	import Policies from './Policies.svelte';
	import PostedSignage from './PostedSignage.svelte';
	import AdditionalInfo from './AdditionalInfo.svelte';

	const realPolicies = $derived(selectedCurbZoneState.policies);
	const properties = $derived(selectedCurbZoneState.properties);
	let curbZoneId = $derived(properties?.curb_zone_id);

	const nearbySigns = $derived(
		curbZoneId ? signsState.byZoneId.get(curbZoneId) || [] : []
	);

	// `properties.unusableImage` is set by upstream's post-loop logic only
	// when every policy on the zone is the sentinel — same semantic the map
	// paint uses. Treat "no policies at all" as the same case so the derived
	// fallback still kicks in there.
	const hasNoRealData = $derived(
		properties?.unusableImage || !realPolicies?.length
	);

	const derivedPolicies = $derived(nearbySigns.map((s) => s.properties.policy).filter(Boolean));

	// When real policies coexist with the unusable-image sentinel, hide the
	// sentinel — it adds no info next to real policies, and the dashed line
	// on the map already conveys data quality. Keep it when it's the only
	// policy so the list isn't empty.
	const filteredRealPolicies = $derived.by(() => {
		if (!realPolicies?.length) return realPolicies;
		const nonSentinel = realPolicies.filter((p) =>
			(p.rules || []).some((r) => r?.activity !== 'unusable image')
		);
		return nonSentinel.length ? nonSentinel : realPolicies;
	});

	const policies = $derived(
		hasNoRealData && derivedPolicies.length ? derivedPolicies : filteredRealPolicies
	);

	// Mirrors the field set AdditionalInfo's `items` is built from. The tab
	// button + content are hidden entirely when nothing would render.
	const hasAdditionalInfoFields = $derived(
		!!properties?.jurisdiction_type ||
			properties?.available !== undefined ||
			properties?.num_spaces !== undefined ||
			!!properties?.parking_angle ||
			!!properties?.street_side ||
			!!properties?.median ||
			!!properties?.entire_roadway
	);
	const hasAdditionalTab = $derived(hasAdditionalInfoFields || nearbySigns.length > 0);

	let activeTab = $state('policies');

	// If the user is parked on a tab that no longer has content (after a new
	// segment select), bounce them back to Policies.
	$effect(() => {
		if (activeTab === 'additional_info' && !hasAdditionalTab) activeTab = 'policies';
	});

</script>

<div class="PoliciesWrapper">
	{#if hasAdditionalTab}
		<div class="panels">
			<button
				class={['panel-button', { active: activeTab === 'policies' }]}
				onclick={() => (activeTab = 'policies')}>Policies</button
			>
			<button
				class={['panel-button', { active: activeTab === 'additional_info' }]}
				onclick={() => (activeTab = 'additional_info')}
				>Additional info{#if nearbySigns.length}&nbsp;({nearbySigns.length}){/if}</button
			>
		</div>
	{/if}
	{#if activeTab === 'policies'}
		<Policies {policies} {curbZoneId} estimated={hasNoRealData && derivedPolicies.length > 0} />
	{:else if activeTab === 'additional_info'}
		<div class="additional-info-stack">
			<AdditionalInfo {properties} />
			{#if nearbySigns.length}
				<PostedSignage signs={nearbySigns} />
			{/if}
		</div>
	{/if}
</div>

<style lang="scss">
	.PoliciesWrapper {
		color: var(--charles-blue);
		width: 360px;
	}

	.panels {
		display: flex;
		align-items: center;
		gap: 1rem;

		margin-bottom: 1rem;
	}

	.additional-info-stack {
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}

	.panel-button {
		font-size: var(--font-size-ms);
		cursor: pointer;

		&.active {
			text-decoration: underline;
			color: var(--optimistic-blue);
		}

		&:focus {
			color: var(--optimistic-blue-hover);

			.link-out-icon {
				:global(svg path) {
					fill: var(--optimistic-blue-hover);
				}
			}
		}

		&:hover {
			color: var(--optimistic-blue-hover);

			.link-out-icon {
				:global(svg path) {
					fill: var(--optimistic-blue-hover);
				}
			}
		}
	}
</style>
