# Phase 3 – Master Admin and Restaurant Admin

## Implemented API

All API paths below are prefixed with `/api/v1`.

### Master Admin (role: `master_admin`)
- `GET /master/restaurants` – list restaurant tenants, organization and active state.
- `POST /master/restaurants` – create organization, restaurant and first restaurant-admin account in one DB transaction.
- `GET /master/restaurants/:id` – restaurant details and active staff count.
- `PATCH /master/restaurants/:id/active` – enable/disable a restaurant. Disabled tenants are rejected by tenant-scoped API routes; login is also blocked.

### Restaurant Admin (role: `restaurant_admin`)
Tenant identity is derived only from the signed access token; client-supplied tenant IDs are not trusted.
- `GET /restaurant/dashboard` – today's order counts, table counts and menu counts.
- `GET|POST /restaurant/service-areas` – list/create service areas.
- `GET|POST /restaurant/tables` – list/create tables within the authenticated tenant.
- `GET|POST /restaurant/menu/categories` – list/create menu categories.
- `GET|POST /restaurant/menu/items` – list/create menu items with `kitchen`, `bar` or `other` routing.
- `PATCH /restaurant/menu/items/:id/active` – activate/deactivate a menu item.

## Admin web app

The Vite/React app now has:
- Sign-in for master and restaurant admins.
- Master Admin tenant creation, listing and enable/disable controls.
- Restaurant Admin dashboard, service-area/table creation and menu category/item management.

Set `VITE_API_URL` to the API base URL if it is not `http://localhost:4000/api/v1`.

## Setup
1. Create a PostgreSQL database and set `DATABASE_URL`.
2. Set a random `JWT_SECRET` with at least 32 bytes.
3. Run `npm run db:migrate` from `server/`.
4. Run `npm run seed:master` after configuring the seed environment variables described by that script.
5. Run `npm install && npm run dev` in `server/`.
6. Run `npm install && npm run dev` in `admin/`.

## Verification boundaries
Automated unit tests and JavaScript syntax checks do not replace integration tests against PostgreSQL, browser/device tests, security review, or deployment testing. This phase does not implement waiter Android, kitchen/bar ticket delivery, thermal printer drivers, billing/payment workflows, offline synchronization, subscriptions, or production deployment.
