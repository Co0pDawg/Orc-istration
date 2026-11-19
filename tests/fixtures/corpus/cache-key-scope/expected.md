# Expected findings: cache-key-scope

| Id | Lane | File | Lines | Defect |
|----|------|------|-------|--------|
| E1 | code-reviewer | src/catalog/priceCache.js | 10-18 | `getPrice` reads and writes `price:<sku>` with no tenant, while `warmPrices` writes `price:<tenant>:<sku>`: warmed entries are never read and one tenant's price is served to another |
