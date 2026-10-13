---
title: "Backing up a self-hosted zerosoft: one database, one folder, one .env"
description: "A self-hosted zerosoft is a SQLite file, an uploads folder and an .env. How to copy them while the app runs, store them off the server and test a restore."
date: "2026-10-12"
author: "zerosoft"
tags: ["self-hosting", "backups", "sqlite"]
---

We've said it a few times on this blog: in zerosoft, the backup is "just a file". That's true in spirit and slightly dangerous in practice. A SQLite database that's being written to is not a file you can blindly `cp` and trust.

This is the practical version: what to back up, how to copy it consistently while the app is running, where to send it, and how to know the backup actually restores. Fifteen minutes of setup, ten minutes a quarter.

## What you're backing up

A self-hosted zerosoft with Docker has exactly three things that matter:

1. **The database.** One SQLite file, `zerosoftware.db`, at `/app/data` inside the container, stored in the `zerosoft-data` volume. Links, clicks, contacts, deals, issues, bookings, conversations, docs, users, teams, API keys: all of it.
2. **Uploads.** Attachments from Chat, Track and CRM tasks, at `/app/public/uploads`, stored in the `zerosoft-uploads` volume.
3. **Your `.env`.** Easy to forget, and it matters more than it looks: more on that below.

Without Docker it's the same idea: `data/zerosoftware.db` and `public/uploads/` in the app directory.

One Docker detail first: Compose prefixes volume names with the project name, which defaults to the directory name. If you cloned into `zerosoft/`, your volumes are probably `zerosoft_zerosoft-data` and `zerosoft_zerosoft-uploads`. Check instead of guessing:

```bash
docker volume ls | grep zerosoft
```

## Why plain cp isn't enough

zerosoft opens its local database in **WAL mode** (`PRAGMA journal_mode = WAL`). In WAL mode, new writes go first to a side file, `zerosoftware.db-wal`, and are folded back into the main file later, at a checkpoint. While the app is running, you'll typically see three files: `zerosoftware.db`, `-wal` and `-shm`.

So if you `cp zerosoftware.db` while the app is running:

- Recently committed data may still be sitting in the `-wal` file, and your copy won't have it.
- If you copy the `.db` and the `-wal` separately, a write can land in between, and the pair you get may not match.

Plain copying *is* fine if the app is stopped: on a clean shutdown SQLite checkpoints the WAL into the main file. If the process was killed instead, a leftover `-wal` may still hold committed data, so copy all the files together. But stopping your app every night to back it up is silly when SQLite has a proper way to do it live.

## The right way: .backup or VACUUM INTO

SQLite ships two ways to take a consistent snapshot of a live database:

- **`.backup`** (the `sqlite3` CLI's online backup) copies the database page by page into a new file, producing a consistent snapshot even while the app keeps writing.
- **`VACUUM INTO '/path/file.db'`** writes a fresh, compacted copy of the database as of a single transaction. It does a bit more work and gives you a smaller file. The target file must not exist yet.

Either is correct. Both include whatever is in the WAL. The zerosoft image doesn't include the `sqlite3` CLI, so the simplest path is a throwaway Alpine container that mounts the volume:

```bash
#!/bin/sh
# /usr/local/bin/zerosoft-backup.sh
set -eu
DATA_VOL=zerosoft_zerosoft-data        # check with: docker volume ls
UPLOADS_VOL=zerosoft_zerosoft-uploads
DEST=/var/backups/zerosoft
STAMP=$(date +%Y-%m-%d_%H%M)
mkdir -p "$DEST"

# 1. Consistent snapshot of the live database (safe while the app runs)
docker run --rm -v "$DATA_VOL":/data -v "$DEST":/backup alpine:3.20 \
  sh -c "apk add --no-cache sqlite >/dev/null && sqlite3 /data/zerosoftware.db \".backup '/backup/db-$STAMP.db'\""

# 2. Check the copy before trusting it
docker run --rm -v "$DEST":/backup alpine:3.20 \
  sh -c "apk add --no-cache sqlite >/dev/null && sqlite3 /backup/db-$STAMP.db 'PRAGMA integrity_check;'" | grep -qx ok

# 3. Uploads are plain files: tar is fine
docker run --rm -v "$UPLOADS_VOL":/uploads:ro -v "$DEST":/backup alpine:3.20 \
  tar czf "/backup/uploads-$STAMP.tgz" -C /uploads .

# 4. Keep two weeks locally
find "$DEST" -type f -mtime +14 -delete
```

Run it from cron, at a quiet hour:

```bash
# crontab -e
15 3 * * * /usr/local/bin/zerosoft-backup.sh >> /var/log/zerosoft-backup.log 2>&1
```

Prefer `VACUUM INTO`? Swap the `.backup` line for `sqlite3 /data/zerosoftware.db \"VACUUM INTO '/backup/db-$STAMP.db'\"`.

## Don't forget the .env

zerosoft encrypts OAuth tokens (Gmail and Google Calendar integrations) and webhook secrets in the database with AES-256-GCM. The key comes from `ENCRYPTION_KEY`, or from `NEXTAUTH_SECRET` if that's unset.

What that means for backups: restore the database on a server with a *different* secret and everything still loads, but those encrypted values can't be decrypted. Integrations have to be reconnected, and webhook signing secrets are lost. Back up your `.env` too, separately and encrypted (it holds your Google client secret), in your password manager or secrets vault. Not as a plain file next to the database dumps.

## Get it off the server

A backup on the same disk as the database protects you from mistakes, not from a dead disk or a deleted VPS. Send the backup folder somewhere else. Any tool works; two common ones:

```bash
# rclone: copy to any S3-compatible bucket you've configured as "offsite"
rclone copy /var/backups/zerosoft offsite:zerosoft-backups

# or restic: encrypted, deduplicated snapshots
restic -r s3:https://<endpoint>/<bucket> backup /var/backups/zerosoft
```

Add that line to the end of the backup script. Keep longer retention offsite than locally: a few weeks of dailies plus some monthlies is plenty for most small teams. And make sure the server's credentials can *write* backups but not delete old ones, if your storage supports it; ransomware loves a backup it can erase.

If you want something closer to continuous, Litestream streams SQLite WAL changes to object storage. We mention it because it fits SQLite well, but we haven't validated it against zerosoft specifically: test the restore before you rely on it.

## Restore, for real

The restore procedure, with the app stopped:

```bash
docker compose stop

docker run --rm -v zerosoft_zerosoft-data:/data -v /var/backups/zerosoft:/backup alpine:3.20 \
  sh -c "rm -f /data/zerosoftware.db-wal /data/zerosoftware.db-shm \
    && cp /backup/db-2026-10-12_0315.db /data/zerosoftware.db \
    && chown 1001 /data/zerosoftware.db"

docker run --rm -v zerosoft_zerosoft-uploads:/uploads -v /var/backups/zerosoft:/backup alpine:3.20 \
  sh -c "tar xzf /backup/uploads-2026-10-12_0315.tgz -C /uploads && chown -R 1001 /uploads"

docker compose start
```

Two details that bite people:

- **Delete the old `-wal` and `-shm`.** A leftover WAL from the previous database must never be replayed on top of the restored file.
- **Ownership.** The app runs as user `zerosoft` (uid 1001). Files restored as root may be readable but not writable, and the app will fail on the first write.

Database migrations run automatically when the app starts, so restoring an older backup onto a newer version of zerosoft brings its schema up to date. The other direction (a newer database on older code) isn't something to count on.

## The drill nobody does

A backup you've never restored is a hope, not a backup. Once a quarter, take the latest offsite copy (not the local one) and check it somewhere that isn't production:

```bash
sqlite3 db-2026-10-12_0315.db "PRAGMA integrity_check;"
sqlite3 db-2026-10-12_0315.db "SELECT count(*) FROM links; SELECT count(*) FROM crm_contacts; SELECT count(*) FROM track_issues;"
```

Do the counts look like your real numbers? Does the uploads tarball open? Better yet, once a year run the full restore above on a spare VPS with your backed-up `.env`, log in and click around. Time it. That number is your real recovery time, and it's worth knowing before you need it.

## If you use Turso instead

Set `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN` and the database isn't on your server at all. It's a remote libSQL database, which is what our own cloud runs on. Turso has its own backup and restore features; check what your plan includes. We'd still keep a copy you control:

```bash
turso db shell <your-db> .dump > zerosoft-$(date +%F).sql
```

Uploads are still yours to back up either way (on your disk, or in Vercel Blob if you set `BLOB_READ_WRITE_TOKEN`).

## Checklist

- Database snapshot with `.backup` or `VACUUM INTO`, never a blind `cp` of a running database.
- Integrity check on every copy.
- Uploads tarball.
- `.env` stored separately and encrypted.
- Offsite copy, with retention.
- A restore drill on the calendar.

That's the whole runbook. It's short because the architecture is small: [one process, one file](/blog/sqlite-es-suficiente). The only hard part is doing the drill.
