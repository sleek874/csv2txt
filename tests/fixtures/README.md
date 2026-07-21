# Synthetic CSV fixtures

These files contain generated, fictional data only. They do not contain real
people, identifiers, phone numbers, or production addresses.

## Field meanings used by the generator

The application itself treats fields positionally; these meanings exist only to
make the sample data easier to inspect.

| Field | Example meaning | Preset Big5 byte width |
|---:|---|---:|
| 1 | Region code | 1 |
| 2 | Category in Chinese | 2 |
| 3 | Type flag | 1 |
| 4 | Clearly fake ID | 10 |
| 5 | Traditional Chinese name | 10 |
| 6 | Birth date text | 8 |
| 7 | Clearly fake numeric reference | 12 |
| 8 | Record type | 1 |
| 9 | Fictional Traditional Chinese address | 120 |
| 10 | Clearly fake customer ID | 15 |
| 11 | Amount-like text with leading zeros | 10 |
| 12 | Yes/no flag | 1 |
| 13 | Registration date text | 8 |
| 14 | Batch ID | 8 |
| 15 | Status flag | 1 |

## Files

- `synthetic-valid-200.utf8.csv` has no header and contains exactly 200 records
  with 15 fields each. Every value round-trips through Big5 and fits its preset
  byte width. The first record includes an exact 10-byte name and exact
  120-byte address. Later records include a quoted comma, an escaped quote, and
  visible spaces.
- `synthetic-invalid-boundaries.utf8.csv` has five 15-field records. Set the
  expected record count to `5` before testing it. Its records intentionally test
  a field-1 overflow, field-5 overflow, field-9 overflow, an emoji unavailable
  in Big5, and field-10 overflow, in that order.

Regenerate both files from the project root with:

```bash
npm run generate:testdata
```
