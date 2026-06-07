<script>
	import { timeState } from '../state.svelte';
	import { dayOfWeekOptions, timeOptions } from '../constants';
	import { timeToRealTime, dayToFullDay, fullDayToDay } from '../utils/basic-utils';
	import Dropdown from './Dropdown.svelte';

	let useCurrentTime = $derived(timeState.useCurrentTime);

	let localDayOfWeek = $state(null);
	let localTime = $state(null);
	let localTimeInterval = $state(null);

	const daysOfWeek = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
	const timeOfDayOptions = timeOptions.filter((o) => !o?.hide);

	const updateTime = () => {
		const now = new Date();
		const options12 = {
			hour: 'numeric',
			minute: '2-digit',
			timeZone: 'America/New_York',
			hour12: true
		};
		const options24 = {
			hour: 'numeric',
			minute: '2-digit',
			timeZone: 'America/New_York',
			hour12: false
		};

		localTime = now.toLocaleTimeString('en-US', options12);
		const dayIndex = now.getDay();
		localDayOfWeek = daysOfWeek[dayIndex];

		// Snap to the current half-hour floor on every tick (not just at
		// :00/:30). This way toggling to "current time" mid-half-hour updates
		// the map state immediately instead of waiting up to 30 minutes.
		let hours = Number(now.toLocaleTimeString('en-US', options24).split(':')[0]);
		if (hours === 24) hours = 0;
		const halfHour = now.getMinutes() >= 30 ? 0.5 : 0;
		timeState.day = fullDayToDay(localDayOfWeek);
		timeState.time = hours + halfHour;
	};

	$effect(() => {
		if (useCurrentTime) {
			updateTime();
			const secondsLeft = 60 - new Date().getSeconds();
			if (secondsLeft > 0) {
				setTimeout(() => {
					updateTime();
					localTimeInterval = setInterval(updateTime, 60000);
				}, secondsLeft * 1000);
			} else {
				localTimeInterval = setInterval(updateTime, 60000);
			}
		} else {
			if (localTimeInterval) clearInterval(localTimeInterval);
			localTime = null;
			localDayOfWeek = null;
		}
	});

	const toggleCustomTime = () => {
		timeState.useCurrentTime = !timeState.useCurrentTime;
	};
</script>

<div class="timeContainer">
	{#if useCurrentTime}
		<div class="day">{localDayOfWeek ?? dayToFullDay(timeState.day)}</div>
		<div class="time">{localTime ?? timeToRealTime(timeState.time)}</div>
	{:else}
		<div class="custom-row">
			<Dropdown
				options={dayOfWeekOptions}
				value={timeState.day}
				onChange={(v) => (timeState.day = v)}
			/>
			<Dropdown
				options={timeOfDayOptions}
				value={timeState.time}
				onChange={(v) => (timeState.time = Number(v))}
			/>
		</div>
	{/if}

	<button type="button" class="custom-toggle" onclick={toggleCustomTime}>
		{useCurrentTime ? 'Set custom time' : 'Use current time'}
	</button>
</div>

<style lang="scss">
	.timeContainer {
		background-color: var(--white);
		padding: 1rem;
		border-radius: 0.5rem;
		box-shadow: 0 0 0.75rem 0.125rem rgba(0, 0, 0, 0.5);

		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		min-width: 220px;

		.day {
			font-family: var(--primary-font);
			font-size: var(--font-size-l);
			font-weight: var(--font-weight-bold);
			color: var(--charles-blue);
		}

		.time {
			font-family: var(--primary-font);
			font-size: var(--font-size-l);
			font-weight: var(--font-weight-regular);
			color: var(--charles-blue);
		}

		.custom-row {
			display: flex;
			flex-direction: column;
			gap: 0.5rem;
		}

		.custom-toggle {
			align-self: flex-start;
			padding: 0;
			background: none;
			border: none;
			cursor: pointer;
			font-family: var(--primary-font);
			font-size: var(--font-size-ms);
			color: var(--optimistic-blue, #1871BD);
			text-decoration: underline;

			&:hover {
				color: var(--optimistic-blue-hover, #1554a0);
			}
		}
	}
</style>
