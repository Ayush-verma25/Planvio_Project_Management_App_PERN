# Planvio

Planvio is a project-management application with a React/Vite client and an Express API backed by PostgreSQL, Prisma, and Clerk.

## Requirements

- Node.js 20.19 or newer (or 22.12 or newer)
- npm
- A PostgreSQL database
- Clerk keys for authentication

## Local development

Create local environment files from the examples:

```powershell
Copy-Item client\.env.example client\.env.local
Copy-Item server\.env.example server\.env
```

Set the Clerk keys and PostgreSQL connection string in those files. In two terminals:

```powershell
cd server
npm install
npm run server
```

```powershell
cd client
npm install
npm run dev
```

The client runs at `http://localhost:5173` and the API at `http://localhost:5000`.
`VITE_BASE_URL` must point to the API origin; `CLIENT_URL` is the browser origin
allowed by the API and used to construct task-email links.
If the browser reports a CORS error locally, set `CLIENT_URL=http://localhost:5173`
in `server/.env` and restart the API server. For multiple allowed client origins,
separate them with commas.

## Checks

```powershell
cd client
npm run lint
npm run build
```

```powershell
cd server
npm exec prisma validate
```

## Production setup

Deploy `client` and `server` as separate Vercel projects, with each project's
root directory set to its corresponding folder. Set the client environment
variables at build time and set the server environment variables in the server
deployment. Set `CLIENT_URL` to the public client origin and `VITE_BASE_URL` to
the public API origin. For multiple allowed client origins, separate them with
commas in `CLIENT_URL`.

Configure Clerk with the same application keys used by the client and API.
Configure Inngest for the server's `/api/inngest` endpoint and configure SMTP
credentials if task assignment and reminder emails are enabled.

The repository does not currently include Prisma migration files. Before
production traffic is enabled, provision the database and verify that its schema
matches `server/prisma/schema.prisma`; establish and review a migration baseline
for an existing database rather than applying an unreviewed schema push.
