// Mapbox paint expressions for the curb-zone layers. Pure functions of the
// current filter state — keep them out of Map.svelte so the component
// focuses on lifecycle (source/layer setup, click handlers, viewport sync)
// instead of how blue/red/dashed/etc. is decided.

import { colors, dasharrays, widths, AUTO_LOAD_MINZOOM } from '../constants';

// Picks one of four results based on a feature's permitted/paid properties.
const generateNestedCondition = (bothResult, permittedResult, paidResult, defaultResult) => [
	'case',
	[
		'all',
		['has', 'permitted'],
		['==', ['get', 'permitted'], true],
		['has', 'paid'],
		['==', ['get', 'paid'], true]
	],
	bothResult,
	['all', ['has', 'permitted'], ['==', ['get', 'permitted'], true]],
	permittedResult,
	['all', ['has', 'paid'], ['==', ['get', 'paid'], true]],
	paidResult,
	defaultResult
];

// Wraps a nested condition with accessible/loading-zone overrides when those
// filters are on (so those zones get their distinct colors/symbols).
const generateOuterNestedCondition = (
	isLoadingZone,
	isAccessible,
	loadingResult,
	accessibleResult,
	nestedCondition
) => {
	if (isLoadingZone && isAccessible) {
		return [
			'case',
			['to-boolean', ['get', 'accessible']],
			accessibleResult,
			['to-boolean', ['get', 'loadingZone']],
			loadingResult,
			nestedCondition
		];
	}
	if (isAccessible) {
		return [
			'case',
			['to-boolean', ['get', 'accessible']],
			accessibleResult,
			nestedCondition
		];
	}
	if (isLoadingZone) {
		return [
			'case',
			['to-boolean', ['get', 'loadingZone']],
			loadingResult,
			nestedCondition
		];
	}
	return nestedCondition;
};

// "Can the user park here right now, given the filters?" Filter ON adds the
// matching attribute to the blue set; filter OFF excludes zones flagged with
// that attribute (even if canPark is true).
const generateCanParkCondition = (permitted, paid) => {
	const positives = [['to-boolean', ['get', 'canPark']]];
	if (permitted) positives.push(['to-boolean', ['get', 'permitted']]);
	if (paid) positives.push(['to-boolean', ['get', 'paid']]);
	const positive = positives.length === 1 ? positives[0] : ['any', ...positives];

	const exclusions = [];
	if (!permitted) exclusions.push(['!', ['to-boolean', ['get', 'permitted']]]);
	if (!paid) exclusions.push(['!', ['to-boolean', ['get', 'paid']]]);
	return exclusions.length ? ['all', positive, ...exclusions] : positive;
};

// A zone is "estimated" when the city pipeline has no real data for it
// (unusableImage) AND we have signage data joined to it from the inventory.
// Amber on the map ⇒ "the policies you'll see are derived from signage."
const isEstimatedExpr = [
	'all',
	['to-boolean', ['get', 'unusableImage']],
	['to-boolean', ['get', 'hasDerivedSignage']]
];

// Scale a literal width linearly with zoom: ~70% of full width at the
// auto-load floor (lots of zones visible), full thickness near maxZoom.
export const scaledByZoom = (w) => [
	'interpolate',
	['linear'],
	['zoom'],
	AUTO_LOAD_MINZOOM,
	w * 0.7,
	17,
	w
];

export const parkingLineWidth = (filters) => {
	const { paid, permitted } = filters;
	const condition = generateCanParkCondition(permitted, paid);
	// Mapbox requires ['zoom'] at the outermost level of an expression — not
	// nested inside a case — so the case picks the base width per feature
	// and the interpolate scales the whole layer by zoom.
	const widthCaseAtScale = (scale) => [
		'case',
		['to-boolean', ['get', 'unusableImage']],
		widths.unusableCurbZoneWidth * scale,
		condition,
		widths.curbZoneWidth * scale,
		widths.notAllowedCurbZoneWidth * scale
	];
	return [
		'interpolate',
		['linear'],
		['zoom'],
		AUTO_LOAD_MINZOOM,
		widthCaseAtScale(0.7),
		17,
		widthCaseAtScale(1)
	];
};

export const parkingLineDasharray = (filters) => {
	const { paid, permitted } = filters;
	const condition = generateCanParkCondition(permitted, paid);
	return [
		'case',
		['to-boolean', ['get', 'unusableImage']],
		dasharrays.unusableImageDasharray, // gray dashed (estimated uses same dash, differs only in color)
		condition,
		dasharrays.curbZoneDasharray, // solid
		dasharrays.notAllowedCurbZoneDasharray // dotted
	];
};

export const parkingLineColor = (filters) => {
	const { paid, permitted, accessible, loadingZone } = filters;

	let nested = generateNestedCondition(
		colors.parkingAllowedPermittedPaid,
		colors.parkingAllowedPermitted,
		colors.parkingAllowedPaid,
		colors.parkingAllowed
	);
	let fallback = colors.parkingNotAllowed;

	if (loadingZone || accessible) {
		const nestedLight = generateNestedCondition(
			colors.parkingAllowedPermittedPaidLight,
			colors.parkingAllowedPermittedLight,
			colors.parkingAllowedPaidLight,
			colors.parkingAllowedLight
		);
		nested = generateOuterNestedCondition(
			loadingZone,
			accessible,
			colors.loading,
			colors.accessible,
			nestedLight
		);
		fallback = colors.parkingNotAllowedLight;
	}

	return [
		'case',
		isEstimatedExpr,
		colors.estimated,
		['to-boolean', ['get', 'unusableImage']],
		colors.unusableImage,
		['boolean', ['feature-state', 'hover'], false],
		colors.hoverHighlightColor,
		generateCanParkCondition(permitted, paid),
		nested,
		fallback
	];
};

export const parkingEmphasisOutline = (filters) => {
	const { accessible, loadingZone } = filters;
	return generateOuterNestedCondition(
		loadingZone,
		accessible,
		'#ffffff',
		'#ffffff',
		'transparent'
	);
};

export const parkingEmphasis = (filters) => {
	const { accessible, loadingZone } = filters;
	return [
		'case',
		['boolean', ['feature-state', 'hover'], false],
		colors.hoverHighlightColor,
		generateOuterNestedCondition(
			loadingZone,
			accessible,
			colors.loading,
			colors.accessible,
			'transparent'
		)
	];
};

// 24x24 sprite images styled via params for accessible / loading zones.
const iconImage = (name, fill, stroke) => [
	'image',
	name,
	{ params: { 'color-2': fill, 'color-1': stroke } }
];
const wheelchairImage = iconImage('wheelchair 24x24', colors.accessibleIconFill, colors.accessibleIconStroke);
const loadingImage = iconImage('loading 24x24', colors.loadingIconFill, colors.loadingIconStroke);

export const parkingSymbol = (filters) => {
	const { accessible, loadingZone } = filters;
	if (loadingZone && accessible) {
		return [
			'case',
			['to-boolean', ['get', 'accessible']],
			wheelchairImage,
			loadingImage
		];
	}
	if (accessible) return wheelchairImage;
	if (loadingZone) return loadingImage;
	return 'none';
};

export const parkingSymbolFilter = (filters) => {
	const { accessible, loadingZone } = filters;
	if (loadingZone && accessible) {
		return [
			'any',
			['to-boolean', ['get', 'accessible']],
			['to-boolean', ['get', 'loadingZone']]
		];
	}
	if (accessible) return ['to-boolean', ['get', 'accessible']];
	if (loadingZone) return ['to-boolean', ['get', 'loadingZone']];
	return false;
};
