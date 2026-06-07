import { fetchUrl } from './fetch';
import { curbApiUrl } from '../constants';
import { determineParkingValidity } from './determine-parking-validity';
import { getCurbPoliciesById } from './get-curb-policies-by-id';
import { loadingState, signsState } from '../state.svelte';
import { loadSigns, joinSignsToZones } from './signs-loader';
import { buildTileGrid } from './bbox-math';

// Fire-and-forget: after a curb-zone fetch resolves, lazy-load
// signs.geojson and publish the per-zone join. Surfaces "estimated from
// sign inventory" data in the side panel for zones the city pipeline
// couldn't classify.
const refreshSignsJoin = async (zoneCollection) => {
	if (!zoneCollection) return;
	try {
		const cache = await loadSigns();
		signsState.byZoneId = joinSignsToZones(cache, zoneCollection);
		signsState.photoUrlPrefix = cache.photoUrlPrefix;
	} catch (err) {
		console.warn('signs join failed:', err.message);
	}
};

const transformData = async (data, policies, day, time) => {
	if (!data.data) return null;
	let { zones } = data.data;
	zones = await Promise.all(
		zones.map(async (z) => {
			let properties = { ...z };
			delete properties.geometry;

			const { curb_policy_ids } = z;

			const zonePolicies = curb_policy_ids.map((id) => policies[id]);

			properties = await determineParkingValidity(zonePolicies, properties, day, time);

			let nextFeature = {
				type: 'Feature',
				properties,
				geometry: z?.geometry
			};
			return nextFeature;
		})
	);
	return {
		type: 'FeatureCollection',
		features: zones
	};
};

// The smart-curb-api caps every response at exactly 10,000 zones. A single
// bbox in a dense neighborhood can exceed that, producing visible gaps.
// When we hit the cap, split the bbox into four quadrants and fetch them
// in parallel; recurse if a quadrant is also capped.
const API_TRUNCATION_CAP = 10000;

const fetchZonesInBbox = async (min_lng, min_lat, max_lng, max_lat) => {
	const url = `${curbApiUrl}/curbs/zones?min_lng=${min_lng}&min_lat=${min_lat}&max_lng=${max_lng}&max_lat=${max_lat}`;
	const resultData = await fetchUrl({ url, method: 'GET' });
	const zones = resultData?.data?.zones ?? [];
	if (zones.length < API_TRUNCATION_CAP) return zones;

	const midLng = (min_lng + max_lng) / 2;
	const midLat = (min_lat + max_lat) / 2;
	const quads = await Promise.all([
		fetchZonesInBbox(min_lng, min_lat, midLng, midLat),
		fetchZonesInBbox(midLng, min_lat, max_lng, midLat),
		fetchZonesInBbox(min_lng, midLat, midLng, max_lat),
		fetchZonesInBbox(midLng, midLat, max_lng, max_lat)
	]);
	const byId = new Map();
	for (const arr of quads) for (const z of arr) byId.set(z.curb_zone_id, z);
	return [...byId.values()];
};

// Process raw zones into the curb-atlas Feature shape with canPark, etc.
// Used per-tile by the caller so each tile can render as it arrives.
const processZonesToFC = async (zones, day, time) => {
	if (!zones.length) return { type: 'FeatureCollection', features: [] };

	const policyIds = [...new Set(zones.flatMap((z) => z?.curb_policy_ids ?? []))];
	const policiesList = await getCurbPoliciesById(policyIds);
	const policies = policiesList.reduce((acc, p) => {
		if (p?.curb_policy_id) acc[p.curb_policy_id] = p;
		return acc;
	}, {});

	const features = await Promise.all(
		zones.map(async (z) => {
			let properties = { ...z };
			delete properties.geometry;
			const zonePolicies = (z.curb_policy_ids || []).map((id) => policies[id]);
			properties = await determineParkingValidity(zonePolicies, properties, day, time);
			return { type: 'Feature', properties, geometry: z?.geometry };
		})
	);

	return { type: 'FeatureCollection', features };
};

// Streaming tile fetch + process. Splits the bbox into a `gridSize × gridSize`
// grid, fires all tile fetches in parallel, and calls `onTileReady(tileFC,
// tileBbox)` as each one completes. Resolves to the merged collection.
const getCurbZonesByArea = async (
	min_lng,
	min_lat,
	max_lng,
	max_lat,
	day,
	time,
	{ gridSize = 3, onTileReady } = {}
) => {
	loadingState.loading = true;

	const tiles = buildTileGrid([min_lng, min_lat, max_lng, max_lat], gridSize);

	const featuresByZoneId = new Map();
	await Promise.all(
		tiles.map(async (tileBbox) => {
			const zones = await fetchZonesInBbox(...tileBbox);
			const tileFC = await processZonesToFC(zones, day, time);
			for (const f of tileFC.features) {
				featuresByZoneId.set(f.properties.curb_zone_id, f);
			}
			if (onTileReady) onTileReady(tileFC, tileBbox);
		})
	);

	const merged = {
		type: 'FeatureCollection',
		features: [...featuresByZoneId.values()]
	};

	loadingState.loading = false;
	refreshSignsJoin(merged);
	return merged;
};

export { getCurbZonesByArea };
