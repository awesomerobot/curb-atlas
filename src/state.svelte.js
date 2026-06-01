import { initialFilterState } from './constants';

export let mapState = $state({
	map: null,
	position: {
		center: [-71.05774, 42.36453],
		zoom: 12
	}
});

export let selectedAreaState = $state({
	// `selected` holds the polygon synthesized from the current map viewport
	// whenever zoom ≥ AUTO_LOAD_MINZOOM; the curb-zone fetch and clip pipeline
	// keys off this. Null while the user is zoomed out below the threshold.
	type: null,
	selected: null,
	isViewport: false
});

export let geocoderState = $state({
	results: null
});

export let filterState = $state({
	current: initialFilterState
});

export let selectedCurbZoneState = $state({
	// Set hash from curb_zone_id in properties
	// Set id on mount, then removed in Map
	id: null,
	geometry: null,
	properties: null,
	policies: null
});

export let timeState = $state({
	day: 'mon',
	time: 9,
	useCurrentTime: true
});

export let loadingState = $state({
	loading: false
});
