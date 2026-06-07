#!/usr/bin/env node
// Reads the Boston signage CSV and emits static/signs.geojson with one
// feature per physical sign (attachments collapsed) for parking-relevant
// signs whose code is decoded by src/utils/sign-code-rules.js.
//
// Each feature carries a CDS-shaped derived policy that mirrors the
// smart-curb-api schema, so the side panel can render it alongside real
// policies (clearly labeled "estimated from sign inventory").
//
// Usage: node scripts/build-signs-geojson.js [--input PATH] [--output PATH]
// Defaults: ../signs-raw.csv  →  static/signs.geojson

import { createReadStream, mkdirSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'csv-parse';
import { deriveSignPolicy } from '../src/utils/sign-code-rules.js';

const here = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(here, '..');

const args = process.argv.slice(2);
const argVal = (flag) => {
	const i = args.indexOf(flag);
	return i >= 0 ? args[i + 1] : null;
};
const inputPath = resolve(projectRoot, argVal('--input') || '../signs-raw.csv');
const outputPath = resolve(projectRoot, argVal('--output') || 'static/signs.geojson');

const PHOTO_PREFIX = 'https://cartegraphattachments.blob.core.windows.net/signattachments/';
const collapsePhotoUrl = (url) => (url.startsWith(PHOTO_PREFIX) ? url.slice(PHOTO_PREFIX.length) : url);

const parser = parse({
	columns: true,
	relax_column_count: true,
	relax_quotes: true,
	skip_records_with_error: true
});

const byOid = new Map();
let totalRows = 0;
let droppedStatus = 0;
let droppedNoPolicy = 0;
let droppedNoCoords = 0;

const stream = createReadStream(inputPath).pipe(parser);

stream.on('data', (row) => {
	totalRows++;
	if (totalRows % 50000 === 0) console.error(`  ...read ${totalRows.toLocaleString()} rows`);

	if (row.asset_status_field !== 'Existing') {
		droppedStatus++;
		return;
	}

	const lat = Number(row.latitude);
	const lng = Number(row.longitude);
	if (!Number.isFinite(lat) || !Number.isFinite(lng) || (lat === 0 && lng === 0)) {
		droppedNoCoords++;
		return;
	}

	const code = (row.mutcd_code_field || '').trim();
	const policy = deriveSignPolicy(code, row.oid);
	if (!policy) {
		droppedNoPolicy++;
		return;
	}

	const oid = row.oid;
	let entry = byOid.get(oid);
	if (!entry) {
		entry = {
			oid,
			lng,
			lat,
			code,
			policy,
			address:
				[row.address_number_field, row.street_field].filter(Boolean).join(' ').trim() ||
				[row.locator_address_number_field, row.locator_street_field].filter(Boolean).join(' ').trim(),
			neighborhood: (row.neighborhood_field || row.locator_city_field || '').trim(),
			notes: (row.notes_field || '').trim(),
			special: (row.special_sign_description_field || '').trim(),
			direction: (row.directionof_sign_arrow_field || '').trim(),
			photos: new Set()
		};
		byOid.set(oid, entry);
	}
	const url = (row.attachment_public_url || '').trim();
	if (url) entry.photos.add(collapsePhotoUrl(url));
});

stream.on('error', (err) => {
	console.error('CSV parse error:', err.message);
	process.exit(1);
});

stream.on('end', async () => {
	console.error(`Read ${totalRows.toLocaleString()} rows.`);
	console.error(`  dropped (status != Existing): ${droppedStatus.toLocaleString()}`);
	console.error(`  dropped (no/invalid coords):  ${droppedNoCoords.toLocaleString()}`);
	console.error(`  dropped (unrecognized code):  ${droppedNoPolicy.toLocaleString()}`);
	console.error(`Kept: ${byOid.size.toLocaleString()} distinct signs`);

	const codeCounts = new Map();
	let withPhotos = 0;
	const features = [];
	for (const entry of byOid.values()) {
		const photos = [...entry.photos];
		if (photos.length) withPhotos++;
		codeCounts.set(entry.code, (codeCounts.get(entry.code) || 0) + 1);

		features.push({
			type: 'Feature',
			id: entry.oid,
			geometry: { type: 'Point', coordinates: [entry.lng, entry.lat] },
			properties: {
				code: entry.code,
				addr: entry.address,
				hood: entry.neighborhood,
				dir: entry.direction,
				notes: entry.notes || entry.special || '',
				photos,
				policy: entry.policy
			}
		});
	}

	console.error(`  with photo(s): ${withPhotos.toLocaleString()}`);
	const top = [...codeCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
	console.error(`  top codes: ${top.map(([k, v]) => `${k}=${v}`).join(', ')}`);

	const fc = {
		type: 'FeatureCollection',
		meta: {
			source: 'Boston Cartegraph signage inventory',
			translatedVia: 'BTD Sign Code Guide (April 2016)',
			generatedAt: new Date().toISOString(),
			photoUrlPrefix: PHOTO_PREFIX,
			featureCount: features.length
		},
		features
	};

	mkdirSync(dirname(outputPath), { recursive: true });
	await writeFile(outputPath, JSON.stringify(fc));
	console.error(`Wrote ${outputPath} (${features.length.toLocaleString()} features)`);
});
