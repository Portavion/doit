# Self-Hosting

Doit is designed to run as a local single-user service. Keep the app bound to localhost or a private interface unless an authentication layer sits in front of it.

## Build

```sh
cargo build --release
```

Copy the release binary and `public/` directory to your deployment path.

When changing any cacheable frontend asset, update the matching query string in `public/index.html` before deploying. This includes `app.js`, `style.css`, favicons, and touch icons because browsers and proxies can keep immutable asset URLs for a long time.

## Runtime User

Use an unprivileged user with a dedicated Taskwarrior config and data directory:

```sh
sudo useradd --system --create-home --home-dir /var/lib/doit doit
sudo install -d -o doit -g doit /opt/doit
sudo install -d -o doit -g doit /var/lib/doit/.task
```

Create `/var/lib/doit/.taskrc` for that user. Configure Taskwarrior sync there if you use it.

## systemd

Example unit:

```ini
[Unit]
Description=Doit Taskwarrior mobile web UI
After=network-online.target
Wants=network-online.target

[Service]
User=doit
Group=doit
WorkingDirectory=/opt/doit
ExecStart=/opt/doit/doit
Restart=always
Environment=BIND_ADDR=127.0.0.1:3000
Environment=TASKRC=/var/lib/doit/.taskrc
Environment=TASKDATA=/var/lib/doit/.task
Environment=TASK_LOCK=/var/lib/doit/.task/task.lock
Environment=TASK_TIMEOUT_SECS=10

[Install]
WantedBy=multi-user.target
```

Enable it:

```sh
sudo systemctl daemon-reload
sudo systemctl enable --now doit
curl -fsS http://127.0.0.1:3000/health
```

## Reverse Proxy

Terminate TLS and authentication in a reverse proxy or access gateway. Keep the Doit process on `127.0.0.1` unless your network design requires a private interface.

Minimum proxy requirements:

- HTTPS for remote access
- Authentication before traffic reaches Doit
- Request body limits appropriate for small JSON requests
- Logs configured to avoid storing private task descriptions

## Sync

If Taskwarrior sync is configured in `TASKRC`, Doit runs `task sync` around reads and writes by default. Set `TASK_SYNC=false` only for isolated local development or deployments where another process handles sync.
