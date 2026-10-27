# Moy Taxi — sale-readiness audit (internal working note)

This document is an engineering checklist, not a buyer-facing claim of production readiness.

## Current system
- Web/PWA source is in the Next.js project.
- Supabase project «Мой Такси» was seen as ACTIVE_HEALTHY during the audit.
- Production Edge Function moy-taxi-api was version 55; the source in this branch now matches the live function exactly.
- Production Edge Function moy-taxi-api-feed was version 2; its previously missing source was restored and now matches the live function exactly.
- A core baseline, driver-verification migration, account-number migration, and trigger-function hardening migration have been added or reconstructed in this branch.
- Recent branch build workflows completed successfully before the latest migration-only commits; verify the latest workflow before merging.
- The current production deployment is still on main. Deployments from this branch are previews and have not been promoted to production.

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
- taxi migrations for core entities, driver registration/tracking, orders and price offers, owner/admin and commission ledger, vehicle rates/test mode, payment-method preference, wallet, 2GIS API key, driver-document verification, owner withdrawals, cancellations, timeout, map route cache, tariff preferences, and individual driver account numbers.

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
1. GitHub repository petra03031983/moy-taxi was public at audit time. The connected GitHub tools available in this session can read/write repository content but cannot change repository visibility. Make it private through repository settings; public history and copies cannot be recalled retroactively.
2. Vercel project details were successfully inspected. Project moy-taxi has a verified Vercel domain and a latest READY preview deployment from this branch. Its current production deployment remains on main. Password protection is disabled; do not enable it blindly because it could block the live demo. The environment-variable names include the public Supabase URL/key only; no service-role key was found in the listed Vercel variables.
3. The checked-in migration history was not originally a complete, matching reproduction of the live Supabase history. Core baseline, driver-verification and driver-account migration files have now been restored/reconstructed in this branch, but the full sequence must be tested on a separate, empty Supabase project before promising one-click installation.
4. A separate branch moy-taxi-sale-only now has a current source tree with Astana Guide/scanner files and road-data migrations removed. However, it is still in the same PUBLIC repository, so historical commits remain accessible. Do not send the repository URL as a confidential package; use a snapshot archive of only the current branch tree or a new private repository.
5. The production API source differed from the checked-in version; it now matches live function version 55 in this branch. The branch is not promoted to production and the PR remains a draft.
6. Database advisor warnings remain for Astana Guide RPCs and map tables. Some RPCs explicitly validate a private access key in their function body; do not revoke them blindly because the map web routes call them. Audit each before changing permissions.
7. Kaspi is represented as a payment-method preference/transfer instruction, not as an automated acquiring/merchant gateway. Describe it accurately.
8. The driver wallet/commission ledger exists in schema; live table counts during audit showed no wallet transaction entries yet. Verify all wallet balance and commission flows using fresh test accounts before making a buyer-facing guarantee.
9. Transfer should be staged: create buyer-owned Supabase/Vercel resources, import schema and agreed data, replace API keys, reset admin and driver credentials, then cut over domain. Never send service-role credentials or old private keys in chat.

## Security work completed during audit
- Revoked direct execute for public.assign_driver_account_number() and public.sync_screen_evidence_to_road_object() from PUBLIC, anon, and authenticated; retained execute for service_role.
- Verified both remain attached to their database triggers and that role grants reflect the intended restriction.
- Added the same hardening as a versioned migration in this branch.
- Compared the active taxi API sources to the live Supabase versions; they match the versions recorded in the branch.

## Status
A filtered taxi-only current-tree branch exists at moy-taxi-sale-only and a Vercel preview build was READY during review. This does not make the source private and does not remove historical map code from the same repository. It is not yet a complete, independently deployable buyer handoff: the migration chain must be tested on an empty database and the code must be placed in a separate private repository or exported as a current-tree archive before confidential transfer.