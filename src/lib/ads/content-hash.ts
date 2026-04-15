import crypto from 'crypto';

// Metadata fields excluded from content hash (matching Python bot's AdPartial.update_content_hash)
const METADATA_FIELDS = new Set([
  'id', 'created_on', 'updated_on', 'content_hash', 'repost_count', 'price_reduction_count', 'file',
]);

// Fields typed as `float` in the Python Pydantic model.
// Python json.dumps serializes float(5) as "5.0", but JS JSON.stringify(5) gives "5".
// We must match Python's output so content hashes are identical.
const PYTHON_FLOAT_FIELDS = new Set([
  'shipping_costs',
  'auto_price_reduction.amount',
  'auto_price_reduction.min_price',
]);

/** Recursively remove empty containers ({}, []) to match Python's prune behavior. */
export function prune(obj: unknown): unknown {
  if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) {
      if (v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length === 0) continue;
      if (Array.isArray(v) && v.length === 0) continue;
      result[k] = prune(v);
    }
    return result;
  }
  if (Array.isArray(obj)) {
    return obj.filter((v) => !(v && typeof v === 'object' && Object.keys(v).length === 0)).map(prune);
  }
  return obj;
}

/** JSON.stringify with recursively sorted keys matching Python json.dumps(sort_keys=True).
 *  Python default separators are (', ', ': ') — space after comma and colon.
 *  Tracks field paths to apply Python float serialization for known float-typed fields. */
export function stableStringify(obj: unknown, path = ''): string {
  if (obj === null || obj === undefined) return 'null';
  if (typeof obj === 'number') {
    // Match Python: float fields serialize integer values with ".0"
    if (PYTHON_FLOAT_FIELDS.has(path) && Number.isInteger(obj)) {
      return obj.toFixed(1);
    }
    return JSON.stringify(obj);
  }
  if (typeof obj !== 'object') return JSON.stringify(obj);
  if (Array.isArray(obj)) {
    return '[' + obj.map((v) => stableStringify(v, path)).join(', ') + ']';
  }
  const sorted = Object.keys(obj as Record<string, unknown>).sort();
  return '{' + sorted.map((k) => {
    const childPath = path ? `${path}.${k}` : k;
    return JSON.stringify(k) + ': ' + stableStringify((obj as Record<string, unknown>)[k], childPath);
  }).join(', ') + '}';
}

/** Recursively strip null/undefined values to match Python's model_dump(exclude_none=True). */
function stripNulls(obj: unknown): unknown {
  if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) {
      if (v === null || v === undefined) continue;
      result[k] = stripNulls(v);
    }
    return result;
  }
  if (Array.isArray(obj)) {
    return obj.map(stripNulls);
  }
  return obj;
}

/** Compute SHA-256 content hash matching the Python bot's algorithm.
 *  Excludes metadata fields, strips null values recursively (matching Python's
 *  model_dump(exclude_none=True)), prunes empty containers, JSON-serializes with sorted keys. */
export function computeContentHash(ad: Record<string, unknown>): string {
  const raw: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(ad)) {
    if (METADATA_FIELDS.has(k)) continue;
    if (v === null || v === undefined) continue;
    raw[k] = v;
  }
  const stripped = stripNulls(raw) as Record<string, unknown>;
  const pruned = prune(stripped) as Record<string, unknown>;
  const json = stableStringify(pruned);
  return crypto.createHash('sha256').update(json).digest('hex');
}
