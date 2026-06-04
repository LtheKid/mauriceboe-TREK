# Local TREK Docker Setup

These notes describe how to run this local checkout with Docker on port `3001`, using known admin credentials.

## Build/run behavior

This repo's `docker-compose.yml` is configured to build the app from the local repository instead of pulling the published Docker Hub image.

That means local code changes are included when you rebuild with:

```bash
docker compose up --build -d
```

The app is configured to run on:

```txt
http://localhost:3001
```

## Local feature notes

This checkout includes local improvements for map/place import workflows:

- Add Place modal: paste a Google Maps place URL and extract granular latitude/longitude coordinates.
- Places sidebar → List Import → Google Route: paste a Google Maps directions URL and import its route stops as unplanned places.
- Supported route URL styles include coordinate routes such as `/maps/dir/lat,lng/lat,lng` and named Google route URLs with embedded stop coordinates.
- Settings → Map → Marker Display Mode: choose photo markers or always show category icons/colors.
- Day Planner toolbar: one Export menu now contains PDF, ICS calendar, and Copy markdown export options.

After changing code, rebuild the local Docker image/container with:

```bash
docker compose up --build -d
```

## Start fresh with known admin credentials

Run all commands from the repo root:

```bash
cd /Users/user/projects/personal/trek_amadeus/TREK
```

Stop any existing container:

```bash
docker compose down
```

If you previously started the app and login is not working, remove the local database/uploads so first-boot admin creation runs again:

```bash
rm -rf data uploads
```

Start with known admin credentials:

```bash
ADMIN_EMAIL=admin@trek.local \
ADMIN_PASSWORD=changeme \
ENCRYPTION_KEY=$(openssl rand -hex 32) \
docker compose up --build -d
```

Open:

```txt
http://localhost:3001
```

Login with:

```txt
Email:    admin@trek.local
Password: changeme
```

## Important note about admin credentials

`ADMIN_EMAIL` and `ADMIN_PASSWORD` are only used on first boot when there are no users in the database yet.

If the app already created a user/admin account, changing these environment variables will not reset the password. To use these known credentials, stop the container and delete local data first:

```bash
docker compose down
rm -rf data uploads
```

Then start again with the credential command above.

## Stopping safely while retaining app data

TREK stores local app data in the repo's bind-mounted directories:

```txt
./data
./uploads
```

As long as you do **not** delete those directories, your trips, users, uploads, and other local app data should remain available after restarting.

### Safest stop command

To stop the app but keep the container definition and all data:

```bash
cd /Users/user/projects/personal/trek_amadeus/TREK
docker compose stop
```

Restart later with:

```bash
docker compose start
```

### Also safe: remove the container but keep data

This stops and removes the container/network, but keeps `./data` and `./uploads` because they are normal local folders:

```bash
cd /Users/user/projects/personal/trek_amadeus/TREK
docker compose down
```

Restart later with:

```bash
docker compose up -d
```

### Do not run these if you want to keep data

These delete local app data or Docker volumes:

```bash
rm -rf data uploads
```

```bash
docker compose down -v
```

Only use those when you intentionally want a fresh app/database.

## Common commands

Check running containers:

```bash
docker ps
```

View logs:

```bash
docker logs trek
```

Stop the app and keep data:

```bash
docker compose stop
```

Restart a stopped app:

```bash
docker compose start
```

Stop and remove the container while keeping local `data` and `uploads`:

```bash
docker compose down
```

Rebuild after code changes:

```bash
docker compose up --build -d
```

Start without rebuilding:

```bash
docker compose up -d
```

## Troubleshooting

### Error: `no configuration file provided: not found`

This means Docker Compose cannot find `docker-compose.yml` in your current directory.

Fix by running from the repo root:

```bash
cd /Users/user/projects/personal/trek_amadeus/TREK
docker compose up -d
```

Or pass the compose file explicitly:

```bash
docker compose -f /Users/user/projects/personal/trek_amadeus/TREK/docker-compose.yml up -d
```

### Login error: `Invalid email or password`

Most likely, the database was already initialized before `ADMIN_EMAIL` and `ADMIN_PASSWORD` were passed into the container.

Reset local data and start again:

```bash
cd /Users/user/projects/personal/trek_amadeus/TREK
docker compose down
rm -rf data uploads
ADMIN_EMAIL=admin@trek.local \
ADMIN_PASSWORD=changeme \
ENCRYPTION_KEY=$(openssl rand -hex 32) \
docker compose up --build -d
```

Then log in with:

```txt
admin@trek.local
changeme
```
