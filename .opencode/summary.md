# Cedoka Inventory - Session Summary

## Objective
**Round 1 (committed `93d673e`)**: ADMIN/MANAGER/BRANCH & INVENTORY ACCESS-CONTROL SPEC (33 sections) — strict multi-tenant RLS (Business → Location → Branch, one-admin-per-branch, IDOR prevention, audited movements, SQL tests). COMPLETE and pushed.

**Round 2 (committed `f2c8b64`)**: 9-phase master plan — restore records "removed" by strict-RLS migration `202609180004`, oversight-vs-ownership architecture (business/location/branch oversight; My vs Overseen), Super Admin command-centre dashboard, soft-delete tombstones, rewritten authorization suite (Section 27G). COMPLETE and pushed.

**Round 3 (current, UNCOMMITTED)**: user's 18-item UX/security/feature spec — (1) salesperson multi-branch visibility, (2) report business/branch ownership + auto-select, (3) urgency/escalation in-app notifications, (6) offline/error/retry, (10) consistent icons/no emojis/no mojibake, (11) skeletons/empty screens/errors, (12) tiny 150–300ms motions, (15) sanitize input, (7) API keys server-side, (17) sensitive keys backend-only, (4) keyboard-safe forms, (5) all-screen-size design, (18) serial picker, (9) no gradients, (14) engineering review, (16) file upload policy, (13) report ownership selection, (8) SKIPPED by user.

## Verified Ground Truth
- React/TS + Vite + Tailwind + Supabase (Postgres/RLS/Edge Functions/RPCs); Vercel → cedoka-inventory.vercel.app; remote `https://github.com/Decodams/cedoka-inventory.git`; branch `main` at `f2c8b64`
- Project ref `erxhhqrzxgsklyhsuulx`; CLI v2.115.0; **Docker NOT installed** (no `db dump`; use `supabase db query --linked` only)
- `db query --linked` returns only the LAST result set; SQL starting with `--` parsed as flags (prepend `SELECT 1;`); PowerShell strips embedded `"` from native args — build claim JSON server-side via `json_build_object('sub',...,'role','authenticated')::text`; NOTICEs from DO blocks NOT surfaced by CLI (final result row only) — suites end with `result: ALL TESTS PASSED` row
- Gate: `npx tsc -p tsconfig.app.json --noEmit`, `npx eslint .`, `npm run build` — all pass; 3 allowed warnings: ReceiptPDF.tsx:7, AuthContext react-refresh, SalesPage exhaustive-deps (`selectedProduct`); `tsconfig.app.json` includes only `src`
- Do NOT commit/push until user explicitly says so; update `.opencode/summary.md` before each commit
- Impersonation pattern: `SELECT set_config('request.jwt.claims', json_build_object(...), false); SET ROLE authenticated; SELECT ...`
- CLI supports `--file` for scripts run headless (used for migration + tests)

## Roster / IDs (live)
- Julia admin `afa6e895-92c2-4e60-9c3a-5b07da177f6d` (primary Asaba); Samuel Dim admin `abfc1c33-a599-4e73-8fef-a49c92eab80f` (primary Awka); Mercy manager `76bb8fa1-e143-4b68-88dd-b2fd568e94b2` (Ejigbo, branch manager); Super `f87e2e5f-c52e-4b9f-8ac0-d9ce3601c6f2`; martin Luter supervisor `7d93bb03-1382-4267-8fdd-89f8aec491fc` (INACTIVE)
- Businesses: Electronics `9ad5a468-2b61-40ad-b356-86e0722abe79`, Farm `ccd75ce5-66ff-43cb-878f-2087ac156458` (branches Ejigbo/Okanran/Okeafo), Default `0323311a-3fa1-4da1-b5b1-790791936191`, 4th `c8714478-a077-4c53-84d9-57886837c73b`
- Branches: Asaba `b96d1dce-4286-440b-9670-0df6bf198f6a`, Awka `41c060f0-a79d-4b95-ac14-249ce498a557`, Ejigbo `1cc8eff7-bb45-4ae0-9266-a151fa251288` (Mercy manager_id); Okanran `e1e10a5c-36a6-46d0-935a-5d7ca0513940`, Okeafo `e0ddf2fb-e81d-4d27-909d-920ed90dd29f`; Default `0993346a-f534-40ae-8aa8-a4b409ee5989`
- `user_business_assignments`: Samuel→Electronics, Julia→Electronics, Julia→Farm
- Notification recipients (migration trigger): branch `manager_id` + business admins (primary or `user_business_assignments`) + super admins, minus `auth.uid()`

## Work State - COMPLETED (round 3, NOT committed)
- **#1 SalesPage multi-branch**: `userBranchIds` = `fullAccessibleBranchIds(user)`; `branchOptions` = all for super, else scope-filtered; `canChooseBranch` = super OR >1 branch; auto-select preferred/single; per-user cacheKey; Select options use `branchOptions`; customer/notes sanitized
- **#2/#13 WeeklyReportsPage**: list query scoped by `accessibleBusinessIds` + `fullAccessibleBranchIds` for non-executives; ReportFormModal business→branch cascade (branch list filtered by chosen business AND reachable branches); auto-select single business/branch; `priority` (Normal/Priority/Urgent) field + submission notice; saved sanitized
- **#3 Migration `202609200001_report_priority_escalation_notifications.sql` APPLIED**: weekly_reports `priority` (CHECK normal|priority|urgent, default normal) + `escalated/escalated_at/escalated_by` + indexes; `notifications` table (own-select/own-update RLS, indexes); SECURITY DEFINER `notify_weekly_report_hierarchy()` + trigger on INSERT/UPDATE OF priority,status,escalated → notifies manager/business-admins/super-admins (excl. actor) for priority>normal on submitted/reviewed and for escalation. **Functional test PASSED** (urgent Ejigbo report → ≥2 notifications, cleaned up). Authorization suite re-run → **ALL TESTS PASSED**
- **#3 Frontend**: `NotificationBell` (unread count, bell/panel, mark-all-read, click→reports page) in AppShell top bar; `AppNotification` + `NotificationType` types
- **#6 Offline**: `useOnlineStatus` hook + amber offline banner (fixed, z-60) in AppShell shell
- **#11 Skeletons**: `Skeleton` + `ListSkeleton` in States.tsx; SalesPage + WeeklyReportsPage use ListSkeleton instead of spinner
- **#4 Keyboard-safe forms**: Modal `max-h-[92dvh]`, focusin listener scrolls focused field into view (smartphone keyboard); safe-bottom on modal body
- **#5 All-screen sizes**: `viewport-fit=cover` already present; `min-h-dvh` shell; `.safe-top/.safe-bottom/.safe-left/.safe-right` utilities applied to top bar + modal
- **#10 Icons/no-emoji**: only emoji found was ⚠ (ReconciliationPage variance) — removed; no `�` anywhere (audit artifacts were valid `·`); Lua? icon-size standardisation deferred (sizes 12–28 are contextual, low value)
- **#12 Tiny motions**: Button `active:scale-[0.98]`; tailwind `fade-in` keyframe (220ms); `prefers-reduced-motion` media query zeroes animation/transition durations globally
- **#15 Sanitize**: `src/lib/sanitize.ts` (`sanitizeText`, `sanitizeMultiline` — strips control chars/null bytes); applied to SalesPage customer/notes + WeeklyReportsPage narrative fields
- **#7/#17 Keys + headers**: `vercel.json` global headers CSP (self + supabase domains; object-src none; frame-ancestors none), X-Content-Type-Options, X-Frame-Options DENY, Referrer-Policy, Permissions-Policy; verified `.env/.env.local` gitignored, `.env.example` generic-only, no `service_role`/JWT strings or console.log in src
- **#9 No gradients**: confirmed zero gradient classes in codebase (no action)
- **#16 File upload**: no upload surface exists — policy documented in code only (no action needed)
- **#14 Engineering review**: gate green (tsc OK, eslint 0 errors/3 warnings, build ✓ 36s); auth suite re-run PASSED; used `fullAccessibleBranchIds` (new rbac helper) to dedupe the branch-scope set
- **Fixed TDZ bug** in ReportFormModal (availableBranches read `businessId` before declaration — reordered hooks)

## Files changed (round 3)
- `supabase/migrations/202609200001_report_priority_escalation_notifications.sql` (APPPLIED — new)
- `src/components/NotificationBell.tsx` (new), `src/hooks/useOnlineStatus.ts` (new), `src/lib/sanitize.ts` (new)
- `src/components/AppShell.tsx`, `src/components/ui/{Modal,States,Button}.tsx`, `src/index.css`, `tailwind.config.js`
- `src/lib/rbac.ts` (+`fullAccessibleBranchIds`), `src/types/database.ts` (+`ReportPriority`, WeeklyReport priority/escalated fields, `AppNotification`/`NotificationType`)
- `src/pages/{SalesPage,WeeklyReportsPage,ReconciliationPage}.tsx`, `vercel.json`

## Next Move
- Verify #18 serial picker already built (confirmed: CartItem.serial_numbers, serial/selectedSerials/serialFilter state, group display) — no code change
- Await user review + explicit commit/push instruction (gate + suite already re-verified) — then commit with updated summary