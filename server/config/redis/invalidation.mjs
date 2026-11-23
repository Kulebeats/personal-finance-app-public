const check = value => { if (!value) throw new Error('REDIS_INVALIDATION_REFUSED'); };
const boundedInteger = (value, maximum) => Number.isSafeInteger(value) && value > 0 && value <= maximum;
/** Internal bounded work over a binding; this function grants no service authority. */
export async function deleteByPatterns(binding, patterns, bounds = { maxScans: 128, maxKeys: 10000, batchSize: 100 }) {
  check(Array.isArray(patterns) && patterns.length > 0 && patterns.length <= 2 && patterns.every(value => typeof value === 'string' && value.length > 0 && value.length <= 1024));
  check(bounds && Object.keys(bounds).sort().join('|') === 'batchSize|maxKeys|maxScans' &&
    boundedInteger(bounds.maxScans, 128) && boundedInteger(bounds.maxKeys, 10000) && boundedInteger(bounds.batchSize, 100));
  const keys = new Set(); let scans = 0, inspected = 0;
  for (const pattern of patterns) {
    let cursor = '0';
    do {
      binding.assertCurrent(); check(++scans <= bounds.maxScans);
      const page = await binding.scan(cursor, pattern, bounds.batchSize); binding.assertCurrent();
      check(Array.isArray(page) && page.length === 2 && typeof page[0] === 'string' && /^(?:0|[1-9][0-9]{0,19})$/.test(page[0]) &&
        Array.isArray(page[1]) && page[1].length <= bounds.maxKeys);
      inspected += page[1].length; check(inspected <= bounds.maxKeys);
      cursor = page[0];
      for (const key of page[1]) {
        check(typeof key === 'string' && key.length > 0 && key.length <= 1024); binding.validateKey(key);
        const included = binding.includeKey(key); check(typeof included === 'boolean');
        if (included) keys.add(key); check(keys.size <= bounds.maxKeys);
      }
    } while (cursor !== '0');
  }
  // Validate the complete bounded scan before any writes. Do not expose physical
  // keys to another prefixing layer or create unobserved pipeline promises.
  const selected = Array.from(keys); let deleted = 0;
  for (let offset = 0; offset < selected.length; offset += bounds.batchSize) {
    binding.assertCurrent(); const batch = selected.slice(offset, offset + bounds.batchSize); batch.forEach(key => { binding.validateKey(key); check(binding.includeKey(key) === true); });
    const confirmed = await binding.deleteBatch(batch); binding.assertCurrent();
    check(Number.isSafeInteger(confirmed) && confirmed >= 0 && confirmed <= batch.length); deleted += confirmed;
  }
  binding.assertCurrent(); return deleted;
}
