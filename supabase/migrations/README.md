# DreamPlay Composer — Supabase Migration Files

All schema changes are recorded here as timestamped SQL files.

## How to use

1. When you need a DB change, write the SQL in a new file: `YYYYMMDD_NNN_description.sql`
2. Run it manually in the **Supabase SQL Editor**
3. Commit the file to git — this is the source of truth

## Important: Schema & Table Names

All DreamPlay Composer tables live in the **`composer`** schema (NOT `public`).

| Logical name used in code | Actual table name              |
|---------------------------|-------------------------------|
| configs / SongConfig      | `composer.configurations`     |
| profiles / UserProfile    | `composer.profiles`           |

When writing raw SQL in Supabase, always prefix with `composer.` e.g.:
```sql
ALTER TABLE composer.configurations ADD COLUMN ...;
```

## Migration Log

| File | Date | Description |
|------|------|-------------|
| `20260406_001_init_schema.sql` | 2026-04-06 | Initial composer schema (reconstructed) |
| `20260406_002_add_visibility.sql` | 2026-04-06 | Add visibility column (private/unlisted/public) |
