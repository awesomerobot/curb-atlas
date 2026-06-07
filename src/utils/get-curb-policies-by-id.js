import { fetchUrl } from './fetch';
import { curbApiUrl } from '../constants';

// Module-level cache. Policy definitions are stable enough across a session
// that re-fetching the same IDs across viewport changes is pure overhead —
// one "no parking" policy can cover hundreds of zones citywide.
const cache = new Map();

const getCurbPoliciesById = async (ids) => {
	if (!ids || !ids.length) return [];

	const missing = ids.filter((id) => id && !cache.has(id));
	if (missing.length) {
		const url = `${curbApiUrl}/curbs/policies?ids=${missing.join(',')}`;
		const resultData = await fetchUrl({ url, method: 'GET' });
		const policies = resultData?.data?.policies ?? [];
		for (const p of policies) {
			if (p?.curb_policy_id) cache.set(p.curb_policy_id, p);
		}
		// Remember misses too so we don't refetch policy IDs the API doesn't know.
		for (const id of missing) {
			if (!cache.has(id)) cache.set(id, null);
		}
	}

	return ids.map((id) => cache.get(id)).filter(Boolean);
};

export { getCurbPoliciesById };
