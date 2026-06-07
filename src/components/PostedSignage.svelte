<script>
	import { resolvePhotoUrl } from '../utils/signs-loader';
	import { signsState } from '../state.svelte';

	const { signs = [] } = $props();

	const prefix = $derived(signsState.photoUrlPrefix);
</script>

<div class="PostedSignage">
	<div class="title">Posted signage</div>
	{#if signs.length === 0}
		<p class="empty">No signs from the city inventory snapped to this segment.</p>
	{:else}
		<p class="caption">
			{signs.length} sign{signs.length === 1 ? '' : 's'} found within ~12 m of this curb. Photos
			come from the BTD asset inventory; codes are translated via the BTD Sign Code Guide.
		</p>
		<ul class="sign-list">
			{#each signs as sign}
				<li class="sign">
					<div class="sign-meta">
						<div class="sign-code">{sign.properties.code}</div>
						<div class="sign-desc">{sign.properties.policy?.description ?? ''}</div>
						{#if sign.properties.addr}
							<div class="sign-addr">{sign.properties.addr}</div>
						{/if}
						{#if sign.properties.notes && sign.properties.notes !== sign.properties.hood}
							<div class="sign-notes">"{sign.properties.notes}"</div>
						{/if}
					</div>
					{#if sign.properties.photos?.length}
						<div class="sign-photos">
							{#each sign.properties.photos.slice(0, 3) as path}
								<a class="thumb" href={resolvePhotoUrl(path, prefix)} target="_blank" rel="noopener">
									<img alt="Sign {sign.properties.code}" src={resolvePhotoUrl(path, prefix)} loading="lazy" />
								</a>
							{/each}
						</div>
					{/if}
				</li>
			{/each}
		</ul>
	{/if}
</div>

<style lang="scss">
	.PostedSignage {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		font-family: var(--primary-font);
		color: var(--charles-blue);
	}

	.title {
		font-size: var(--font-size-l);
		font-weight: var(--font-weight-bold);
		text-transform: uppercase;
	}

	.empty {
		font-size: var(--font-size-ms);
		color: var(--charles-blue);
	}

	.caption {
		font-size: var(--font-size-s);
		font-style: italic;
		margin: 0;
	}

	.sign-list {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
		padding: 0;
		margin: 0;
		max-height: 360px;
		overflow-y: auto;

		li { list-style: none; padding: 0; }
	}

	.sign {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		padding: 0.5rem;
		background: rgba(0, 0, 0, 0.04);
		border-radius: 4px;
	}

	.sign-code {
		font-weight: var(--font-weight-bold);
		font-size: var(--font-size-ms);
	}

	.sign-desc {
		font-size: var(--font-size-s);
	}

	.sign-addr {
		font-size: var(--font-size-s);
		opacity: 0.7;
	}

	.sign-notes {
		font-size: var(--font-size-s);
		font-style: italic;
		opacity: 0.8;
	}

	.sign-photos {
		display: flex;
		gap: 0.25rem;
		margin-top: 0.25rem;
	}

	.thumb {
		display: block;
		width: 80px;
		height: 80px;
		overflow: hidden;
		border-radius: 4px;
		background: #ddd;
	}

	.thumb img {
		width: 100%;
		height: 100%;
		object-fit: cover;
	}
</style>
