# DevKiller

DK Tools and DK Create share a Next.js application and Supabase authentication.

## Development

Use Node.js 22, run `npm ci`, copy `.env.example` to `.env.local`, configure your own credentials, and run `npm run dev`.

## Production

See [deployment configuration](docs/producao-dk-tools-create.md) and `.env.production.example`. Deploy the web application on Vercel. Supabase provides authentication and PostgreSQL; the Create worker requires a separate persistent host. The generator is not a Vercel-only workload.

`npm run build` validates the web build. Credentials and generated user projects are intentionally excluded. Payment checkout remains inactive until billing is configured.
