<script>
	import { untrack } from 'svelte';
	import Map from './Map.svelte';
	import TopBar from './TopBar.svelte';
	import MenuButton from './MenuButton.svelte';
	import SelectAreaMenu from './SelectAreaMenu.svelte';
	import Filters from './Filters.svelte';
	import PoliciesWrapper from './PoliciesWrapper.svelte';
	import StreetViewButton from './StreetViewButton.svelte';
	import { selectedCurbZoneState, filterState } from '../state.svelte';
	import DigitalSeal from '../images/low_res_digital_seal.png';
	import Close from '../icons/Close.svelte';
	import TimeContainer from './TimeContainer.svelte';

	let infoModalOpen = $state(true);

	let openMenus = $state({
		filters: false,
		policies: false
	});

	let selectedZoneId = $derived(selectedCurbZoneState?.properties?.curb_zone_id);
	let hasPolicies = $derived(!!selectedCurbZoneState?.policies);

	// Count of toggled-on filter options for the "Set Filters" button badge.
	let activeFilterCount = $derived(
		(filterState.current || []).reduce(
			(acc, section) => acc + (section.options || []).filter((o) => o?.value).length,
			0
		)
	);
	let filtersLabel = $derived(
		activeFilterCount > 0 ? `Set Filters (${activeFilterCount})` : 'Set Filters'
	);

	const setOpenMenu = (key) => {
		openMenus = Object.fromEntries(
			Object.entries(openMenus).map(([k, v]) => {
				if (k === key) {
					return [k, !v];
				} else {
					return [k, false];
				}
			})
		);
	};

	// Auto-open the policies panel every time the user selects a (different)
	// zone — keying on the id rather than just hasPolicies so clicking a new
	// segment re-opens it even if a prior selection had already filled in
	// policies.
	$effect(() => {
		selectedZoneId; // tracked
		if (selectedZoneId) {
			untrack(() => (openMenus.policies = true));
		} else {
			untrack(() => (openMenus.policies = false));
		}
	});
</script>

<div class="Frame">
	<div class="top-bar" role="banner">
		<TopBar onClickInfo={() => (infoModalOpen = !infoModalOpen)} />
	</div>
	<div class="map-container" role="main">
		<Map />

		<div class="top-left" role="navigation"><SelectAreaMenu /></div>
		<div class="top-right">
			<TimeContainer />
		</div>

		<div class="bottom-row">
			<div class="button-container">
				<div class="button-container-section">
					<MenuButton
						label={filtersLabel}
						setOpen={() => setOpenMenu('filters')}
						open={openMenus['filters']}
					>
						<Filters /></MenuButton
					>
				</div>
				<div class="button-container-section">
					<StreetViewButton />
					<MenuButton
						label="See Policies"
						setOpen={() => setOpenMenu('policies')}
						open={openMenus['policies']}
						position="right"
						disabled={!hasPolicies}
						theme="light"><PoliciesWrapper /></MenuButton
					>
				</div>
			</div>
		</div>

		{#if infoModalOpen}
			<div class="info-modal-screen-container">
				<button class="info-modal-backdrop" onclick={() => (infoModalOpen = false)}></button>
				<div class="info-modal" role="dialog">
					<button class="close-button" onclick={() => (infoModalOpen = false)}><Close /></button>
					<div class="info-modal-title">Boston Curb Map (BETA)</div>
					<div class="info-modal-body">
						<p>
							The data you see may be incomplete, outdated, or inaccurate. <strong
								>This tool is for informational purposes only and does not constitute official City
								of Boston guidance on parking or curb regulations.</strong
							> Always refer to posted signage when making parking decisions.
						</p>

						<p>
							For any questions or feedback - please reach out to us at <strong
								><a href="mailto:oet@boston.gov">oet@boston.gov</a></strong
							>.
						</p>
					</div>
					<div class="info-modal-logo-container">
						<div class="info-modal-logo">
							<img alt="Boston Digital Seal" src={DigitalSeal} />
						</div>
					</div>
				</div>
			</div>
		{/if}
	</div>
</div>

<style lang="scss">
	.Frame {
		display: flex;
		flex-direction: column;
		width: 100%;
		height: 100%;
	}

	.info-modal-screen-container {
		position: absolute;
		width: 100%;
		height: 100%;
		top: 0;
		bottom: 0;
		left: 0;
		right: 0;
		z-index: 100;
		display: flex;
		align-items: center;
		justify-content: center;
	}

	.info-modal-backdrop {
		position: absolute;
		width: 100%;
		height: 100%;
		top: 0;
		bottom: 0;
		left: 0;
		right: 0;
		background-color: rgba(255, 255, 255, 0.5);
	}

	.close-button {
		position: absolute;
		top: 0;
		right: 0;
		margin: 1rem;
		cursor: pointer;

		:global(svg) {
			width: 1rem;
			height: 1rem;

			:global(path) {
				fill: var(--white);
			}
		}
	}

	.info-modal {
		position: relative;
		background-color: var(--charles-blue-80);
		padding: 3rem 3rem 1rem 3rem;
		border-radius: 0.5rem;
		width: 70%;
		max-width: 620px;
		min-width: 300px;
		display: flex;
		flex-direction: column;
		gap: 1rem;

		&-title {
			font-family: var(--primary-font);
			font-size: var(--font-size-xl);
			font-weight: var(--font-weight-bold);
			color: var(--white);
			width: 100%;
			text-align: center;
		}

		&-body {
			font-family: var(--secondary-font);
			font-size: var(--font-size-ms);
			font-weight: var(--font-weight-regular);
			color: var(--white);

			display: flex;
			flex-direction: column;
			gap: 1rem;
		}

		&-logo-container {
			width: 100%;
			display: flex;
			justify-content: center;
		}

		&-logo {
			max-width: 10rem;

			img {
				width: 100%;
				height: 100%;
			}
		}
	}

	.top-bar {
	}

	.map-container {
		flex-grow: 1;
		position: relative;
	}

	.top-left {
		position: absolute;
		padding: 2.5rem 1rem;
		top: 0;
		left: 0;
	}

	.top-right {
		position: absolute;
		padding: 2.5rem 1rem;
		top: 0;
		right: 0;
		z-index: 10;
	}

	.bottom-row {
		position: absolute;
		padding: 2.5rem 1rem;
		bottom: 0;
		width: 100%;
		pointer-events: none;
	}

	.button-container {
		display: flex;
		align-items: center;
		justify-content: space-between;

		&-section {
			display: flex;
			align-items: center;
			gap: 0.5rem;
		}
	}
</style>
