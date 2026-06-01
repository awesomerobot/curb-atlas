<script>
	import Search from './Search.svelte';
	import Legend from './Legend.svelte';
</script>

<div class="SelectAreaMenu">
	<div class="SelectAreaMenu-section">
		<div class="section-title">Search for an Address</div>
		<div class="search-container"><Search /></div>
	</div>

	<div class="SelectAreaMenu-section">
		<div class="section-title-container">
			<div class="section-title">Legend</div>
		</div>
		<Legend />
	</div>
</div>

<style lang="scss">
	.SelectAreaMenu {
		width: 100%;
		max-width: 330px;
		height: 100%;
		background-color: var(--charles-blue);
		padding: 1rem;
		gap: 0.5rem;
		display: flex;
		flex-direction: column;
		border-radius: 0.5rem;

		&-section {
			display: flex;
			flex-direction: column;
			gap: 0.5rem;
		}
	}

	.section-title-container {
		display: flex;
		justify-content: space-between;
		width: 100%;
		align-items: baseline;
		gap: 0.5rem;
	}

	.section-title {
		font-family: var(--primary-font);
		font-size: var(--font-size-l);
		font-weight: var(--font-weight-bold);
		color: var(--white);
		text-transform: uppercase;
	}
</style>
