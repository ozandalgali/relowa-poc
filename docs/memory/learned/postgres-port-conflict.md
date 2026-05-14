# Postgres port conflict — Homebrew vs Docker

> Symptom: `password authentication failed for user "relowa"` even with the correct password.
> Root cause: a different Postgres on the same port.

## What happened

Local migration kept failing:

```
PostgresError: password authentication failed for user "relowa"
code: '28P01'
```

Verified the password in `.env` was correct. Verified the role existed inside the container. Even direct `psql` from the host returned the same error.

## The trick

`lsof -nP -iTCP:5432 -sTCP:LISTEN` revealed:

```
COMMAND     PID USER   FD   TYPE  NAME
postgres   1588 ozan    7u  IPv6  TCP [::1]:5432 (LISTEN)
postgres   1588 ozan    8u  IPv4  TCP 127.0.0.1:5432 (LISTEN)
com.docke 58713 ozan  192u  IPv6  TCP *:5432 (LISTEN)
```

A Homebrew `postgresql@16` was already binding `127.0.0.1:5432` and `::1:5432`. When the OS routes connections to `localhost:5432`, IPv6 / loopback rules send them to Homebrew first, **not** the Docker container.

`relowa` user obviously didn't exist in the Homebrew Postgres → "wrong password."

## The fix

Mapped Docker host port to **5433**:

```yaml
ports:
  - "5433:5432"   # host 5433 → container 5432
```

Updated `.env`:

```
DATABASE_URL=postgres://relowa:dev_password_change_me@localhost:5433/relowa
```

## Why not stop Homebrew Postgres

Tempting — `brew services stop postgresql@16` — but the host's Postgres might be powering something else (another local project, a dotfiles tool). Avoiding the collision is more polite than evicting it.

## Indicator that this might be your problem

- Password is "wrong" but role exists inside the container
- `docker exec relowa-postgres psql -U relowa` works, but `psql -h localhost` doesn't
- `lsof -iTCP:5432` shows two processes
- Docker Postgres logs do **not** show the failed authentication attempts (they never reached the container)

## Generalization

This isn't Postgres-specific. Anytime a local-dev container's mapped port "doesn't work," check `lsof -iTCP:<port>`. macOS, in particular, has many services that bind common ports (Redis 6379, Mongo 27017, Mysql 3306).

## See also

- [[postgres-18-volume-mount]] — another Postgres-18-specific gotcha
