import { fetchUrl } from './fetch';
import { curbApiUrl } from '../constants';
import { determineParkingValidity } from './determine-parking-validity';
import { getCurbPoliciesById } from './get-curb-policies-by-id';
import { loadingState, signsState } from '../state.svelte';
import { loadSigns, joinSignsToZones } from './signs-loader';

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

const getCurbZonesByArea = async (min_lng, min_lat, max_lng, max_lat, day, time) => {
	loadingState.loading = true;

	let allPolicies;
	let resultData;

	const url = `${curbApiUrl}/curbs/zones?min_lng=${min_lng}&min_lat=${min_lat}&max_lng=${max_lng}&max_lat=${max_lat}`;
	resultData = await fetchUrl({ url, method: 'GET' });

	let allPolicyIds = (resultData?.data?.zones ?? []).map((z) => z?.curb_policy_ids ?? []).flat();
	allPolicyIds = [...new Set(allPolicyIds)];

	allPolicies = await getCurbPoliciesById(allPolicyIds);
	allPolicies = allPolicies.reduce((acc, p) => {
		acc[p?.curb_policy_id] = p;
		return acc;
	}, {});

	const transformedResult = await transformData(resultData, allPolicies, day, time);

	loadingState.loading = false;

	refreshSignsJoin(transformedResult);

	return transformedResult;
};

const getCurbZonesByRadius = async (lng, lat, radius, day, time) => {
	loadingState.loading = true;

	const url = `${curbApiUrl}/curbs/zones?lng=${lng}&lat=${lat}&radius=${radius}`;
	const resultData = await fetchUrl({ url, method: 'GET' });

	let allPolicyIds = (resultData?.data?.zones ?? []).map((z) => z?.curb_policy_ids ?? []).flat();
	allPolicyIds = [...new Set(allPolicyIds)];

	let allPolicies = await getCurbPoliciesById(allPolicyIds);
	allPolicies = allPolicies.reduce((acc, p) => {
		acc[p?.curb_policy_id] = p;
		return acc;
	}, {});

	const transformData = async (data) => {
		if (!data.data) return null;
		let { zones } = data.data;
		zones = await Promise.all(
			zones.map(async (z) => {
				let properties = { ...z };
				delete properties.geometry;

				const { curb_policy_ids } = z;

				const zonePolicies = curb_policy_ids.map((id) => allPolicies[id]);

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

	const transformedResult = await transformData(resultData);

	loadingState.loading = false;

	refreshSignsJoin(transformedResult);

	return transformedResult;
};

export { getCurbZonesByArea, getCurbZonesByRadius };
