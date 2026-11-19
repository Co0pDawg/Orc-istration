# Cache written under one key scope and read under another

Lanes: code-reviewer

What it tests: write/read key agreement and tenant scoping. `warmPrices` writes each price under a key that carries the tenant; `getPrice` reads and writes under a key that does not. The warmed entries are never read, and the first tenant to miss the cache stores its price where every other tenant's lookup of the same SKU will find it.

A lane that only reads each function on its own sees two plausible cache calls. Catching it takes comparing the key a value is written under with the key it is read under (code-reviewer angle I, write/read agreement) and asking whose data a shared key serves.
