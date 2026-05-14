# Realtime AES key length

> Symptom: Supabase Realtime container crash-loops with `:badarg "Bad key size"`.
> Root cause: `DB_ENC_KEY` must be exactly 16 ASCII characters for AES-128-ECB.

## What happened

Realtime container kept restarting. Logs showed:

```
** (ErlangError) Erlang error: {:badarg, ~c"api_ng.c", 244, ~c"Bad key size"}:

  * 2nd argument: Bad key size

    (crypto 5.4.2) crypto.erl:965: :crypto.crypto_one_time(:aes_128_ecb,
      "supabaseencryptionkey_32_chars__", ...)
```

Initial config used a 32-character `DB_ENC_KEY`. The function declared was AES-**128**, which expects 128 bits = 16 bytes = 16 ASCII characters.

## The fix

```yaml
environment:
  DB_ENC_KEY: supabaseencrypti     # exactly 16 characters
```

Verify:

```bash
echo -n "supabaseencrypti" | wc -c   # → 16
```

## Other Realtime env vars that matter

| Variable | Constraint |
| --- | --- |
| `DB_ENC_KEY` | Exactly 16 ASCII chars |
| `API_JWT_SECRET` | At least 32 ASCII chars (used for HS256 JWT signing) |
| `SECRET_KEY_BASE` | Long enough for Phoenix's session encryption (~64 chars typical) |
| `DB_HOST` | Use the **service name** in compose (`postgres`), not `localhost` |

## Why this is annoying

Realtime's documentation has historically been thin and sometimes contradictory between the GitHub README and the docs site. The error message points at the right line but doesn't say "your key is the wrong length."

Pin to a specific version (`supabase/realtime:v2.30.34`) so the env-var contract doesn't shift unexpectedly.

## See also

- [[../../adr/0002-supabase-realtime-standalone]] — why we run only this Supabase piece
