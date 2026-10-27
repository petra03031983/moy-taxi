# Moy Taxi — sale-readiness audit (internal working note)

This document is an engineering checklist, not a buyer-facing claim of production readiness.

## Current system
- Web/PWA source is in the Next.js project.
- Supabase project «Мой Такси» was seen as ACTIVE_HEALTHY during the audit.
- Production Edge Function moy-taxi-api was version 55 (updated 2026-10-21); its source was synchronized to this branch.
- Production Edge Function moy-taxi-api-feed was version 2 (updated 2026-10-19); its previously missing source was restored to this branch.
- The restored driver-account-number migration was reconstructed from the live schema and should be reviewed before a clean-room deploy.
- The app build workflow passed before the latest source-sync commits; rerun/verify the latest branch build before merging.

## Scope to sell
Include only the taxi product:
- src/app/page.js
- src/app/passenger/**
- src/app/driver/**
- src/app/admin/**
- src/app/order/**
- src/app/c/[driverCode]/**
- src/app/start/**
- src/app/api.js
- common layout/styles/assets that those pages require
- supabase/functions/moy-taxi-api/**
- supabase/functions/moy-taxi-api-feed/**
- taxi migrations for core entities, driver registration/tracking, orders and price offers, owner/admin and commission ledger, vehicle rates/test mode, payment-method preference, wallet, 2GIS API key, owner withdrawals, cancellations, timeout, map route cache, tariff preferences, and individual driver account numbers.

## Explicitly exclude from a taxi-only sale
These are part of Astana Guide/scanner and should be kept by the current owner unless a separate deal is agreed:
- src/app/astana-map/**
- src/app/api/road-auth/**
- src/app/api/road-data/**
- src/app/api/road-manual-objects/**
- src/app/api/road-observations/**
- src/app/api/road-screen-evidence/**
- src/app/api/_lib/astanaAccess.js
- android/** (the visible Android project is the Astana Guide screen scanner, not a native taxi app)
- road-data migrations, including 20261025* and 20261026*
- map-only Edge Functions such as astana-map, astana-map-api, and dgis-setup.

## Known blockers before transferring a standalone code package
1. GitHub repository petra03031983/moy-taxi was public at audit time. Make it private through repository settings; connector permissions available to this session do not expose a visibility-change action. Public history and copies cannot be recalled retroactively.
2. The Vercel connector lists a moy-taxi project, but project detail/env/domain calls returned not-found/permission errors. Verify the deployment's Git connection, domain, environment-variable names, and billing owner in Vercel before transfer.
3. The checked-in migration history is not a complete, matching reproduction of the live Supabase migration history. Live history includes migrations not present in the repository (including initial core/permissions and driver-document-related migrations); some checked-in names/timestamps differ. Do not promise one-click clean install until the migration baseline is reconstructed and tested on a separate, empty database.
4. The codebase currently mixes taxi and Astana Guide. Do not hand over the whole repository/database as-is if retaining Astana Guide.
5. The production API source differed from the checked-in version; taxi API source was synced in this branch, but the current branch build and deployment should be verified before merging.
6. Database advisor warnings remain for Astana Guide RPCs and map tables. Some RPCs explicitly validate a private access key in their function body; they must not be revoked blindly because the map web routes call them. Audit each before changing permissions.
7. Kaspi is represented as a payment-method preference/transfer instruction, not as an automated acquiring/merchant gateway. Describe it accurately.
8. The driver wallet/commission ledger exists in schema; live table counts during audit showed no wallet transaction entries yet. Verify all wallet balance and commission flows using fresh test accounts before making a buyer-facing guarantee.
9. Transfer should be documented, paid, and staged: create buyer-owned Supabase/Vercel resources, import schema/data only as agreed, replace API keys, reset admin and driver credentials, then cut over DNS. Never send service-role credentials or old private keys in a chat.

## Security work completed during audit
- Revoked direct execute for public.assign_driver_account_number() and public.sync_screen_evidence_to_road_object() from PUBLIC, anon, and authenticated; retained execute for service_role.
- Verified both remain attached to database triggers and that the role grants reflect the intended restriction.
- Added the same hardening as a versioned migration in this branch.

## Status
This is a working, internally reviewed source package—not yet an independently deployable buyer handoff. It must be separated, cleaned of map-only files/data, and tested on buyer-owned infrastructure before closing a sale.