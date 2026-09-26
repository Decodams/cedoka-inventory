# Cedoka Inventory - Session Summary

## Objective
**Round 1 (committed `93d673e`)**: ADMIN/MANAGER/BRANCH & INVENTORY ACCESS-CONTROL SPEC (33 sections) — strict multi-tenant RLS (Business → Location → Branch, one-admin-per-branch, IDOR prevention, audited movements, SQL tests). COMPLETE and pushed.

**Round 2 (current, UNCOMMITTED)**: 9-phase master plan — (1) restore records "removed" by the strict-RLS migration `202609180004` (visibility collapse, not data loss), (2) oversight-vs-ownership architecture (business/location/branch oversight; My Records vs Overseen Records), (3) Super Admin command-centre dashboard, harden deletion with soft-delete tombstones, then UX/tests. Safe, non-destructive enhancement of the live app.

## Verified Ground Truth
- React/TS + Vite + Tailwind + Supabase (Postgres/RLS/Edge Functions/RPCs); Vercel → cedoka-inventory.vercel.app; remote `https://github.com/Decodams/cedoka-inventory.git`; branch `main` at `93d673e`
- Project ref `erxhhqrzxgsklyhsuulx`; CLI v2.115.0; **Docker NOT installed** (no `db dump`; use `supabase db query --linked` only)
- `db query --linked` returns only the LAST result set; SQL starting with `--` parsed as flags (prepend `SELECT 1;`); PowerShell strips embedded `"` from native args — build claim JSON server-side via `json_build_object('sub',...,'role','authenticated')::text`; NOTICEs from DO blocks NOT surfaced by CLI (final result row only) — suite ends with `result: ALL TESTS PASSED` row
- Gate: `npx tsc -p tsconfig.app.json --noEmit`, `npx eslint .`, `npm run build` — all pass; 3 allowed warnings: ReceiptPDF.tsx:7, AuthContext react-refresh, SalesPage exhaustive-deps (`selectedProduct`); `tsconfig.app.json` includes only `src`
- Do NOT commit/push until user explicitly says so; update `.opencode/summary.md` before each commit
- **Known out-of-scope hole**: `update-user-status` edge fn only scope-checks admins, not managers (rank check exists) — left unchanged to not break approved suite
- Baseline counts (round-2 start): 17 non-empty tables, ~293 rows; products 2 live + 3 tombstones reconstructed = 5
- Impersonation pattern: `SELECT set_config('request.jwt.claims', json_build_object(...), false); SET ROLE authenticated; SELECT ...`

## Roster / IDs (live)
- Julia admin `afa6e895-92c2-4e60-9c3a-5b07da177f6d` (primary Asaba); Samuel Dim admin `abfc1c33-a599-4e73-8fef-a49c92eab80f` (primary Awka); Mercy manager `76bb8fa1-e143-4b68-88dd-b2fd568e94b2` (Ejigbo, 1 oversight row); Super `f87e2e5f-c52e-4b9f-8ac0-d9ce3601c6f2`; martin Luter supervisor `7d93bb03-1382-4267-8fdd-89f8aec491fc` (INACTIVE, Farm/Okanran)
- Businesses: Electronics `9ad5a468-2b61-40ad-b356-86e0722abe79`, Farm `ccd75ce5-66ff-43cb-878f-2087ac156458`, Default `0323311a-3fa1-4da1-b5b1-790791936191`, 4th `c8714478-a077-4c53-84d9-57886837c73b` (untouched)
- Branches: Asaba `b96d1dce-4286-440b-9670-0df6bf198f6a`, Awka `41c060f0-a79d-4b95-ac14-249ce498a557`, Ejigbo `1cc8eff7-bb45-4ae0-9266-a151fa251288`; Okanran `e1e10a5c-36a6-46d0-935a-5d7ca0513940`, Okeafo `e0ddf2fb-e81d-4d27-909d-920ed90dd29f`; Default `0993346a-f534-40ae-8aa8-a4b409ee5989`
- `user_business_assignments`: Samuel→Electronics, Julia→Electronics, Julia→Farm (kept — drives Julia's Farm oversight)
- Semantics: `user_branch_assignments` = unlimited OVERSIGHT grants; one-admin-per-branch enforced ONLY on `user_profiles.branch_id` (primary); business oversight = admin sees all branches/records/staff of the business (fellow admin visible via branch overlap but NEVER editable); managers/staff strict; tombstones visible only to admin/super

## Work State - COMPLETED (round 2, NOT committed)
- **Phase 0 backup**: SQL-exporter (temp: `C:\Users\Osmaxin\AppData\Local\Temp\opencode\export_backup.sql`, UNION ALL via `jsonb_each(to_jsonb(t))`) → `.opencode/backups/pre_restore_20260926.sql` (71,133 B, 294 lines)
- **Migration E** `202609190001_restore_oversight_scope.sql` (APPLIED): `user_location_assignments` + select RLS; `can_access_branch`/`my_branch_ids` (super | primary | assignments | managed | location oversight | admin business clause); `user_profiles_select_scoped`/`update_scoped` rebuilt (admin business-wide, admins excluded unless branch overlap); assets/asset_movements policies → branch-scoped; `branch_has_other_admin` → primary-only; dropped assignment-form trigger
- **Migration F** `202609190002_product_soft_delete.sql` (APPLIED): `products.deleted_at/deleted_by`, partial index, tombstone-select policy, frozen update
- **Migration G** `202609190003_products_soft_delete_transition.sql` (APPLIED — written after suite caught the bug): drops `deleted_at IS NULL` from WITH CHECK only (soft-delete transition allowed for products.manage+scope; USING still freezes tombstones; edge fn unaffected as service_role)
- **Impersonation matrix PASSED**: Samuel=Asaba,Awka,Ejigbo/2 products/5 assets/1 business; Julia=+Okanran,Okeafo/2 businesses/sees Julia,martin,Mercy+Samuel (post-primary DML)/Super hidden; Mercy=Ejigbo only/0 products/0 assets; Super=all/5 profiles; tombstones: Mercy 0, Super 3
- **Phase 2 DML** (idempotent, applied): primaries Julia=Asaba, Samuel=Awka; locations renamed (Anambra/Delta/Lagos, Ogun/Lagos) + branches relinked; 3 tombstones reconstructed from audit_log (`metadata.reconstructed=true`, ids `e3a3b69a…` Itel Power Tank, `342e66f3…` Power Go, `53556b9f…` Power Go, sku NULL, Awka)
- **Edge functions edited + all 5 deployed**: manage-product (admin business expansion + soft delete + 409 on tombstone), create-user-account, update-user-role, update-user-status, delete-user (admin business-wide branch expansion)
- **Frontend scope plumbing** (TSC green): `UserProfile.accessible_branch_ids` + `Product.deleted_at/deleted_by` in database.ts; AuthContext fetches `rpc('my_branch_ids')` (fallback `branch_assignment_ids`); Dashboard/Inventory/Sales/Products pages prefer `accessibleBranchIds`; Transfers/UserManagement `myBranchIds`
- **ProductsPage**: `showDeleted` toggle (canDeleteProduct) + `.is('deleted_at', null)` filter + cacheKey; Deleted badge; row actions hidden for tombstones; `handleDelete` unified to `manage-product` invoke with direct soft-delete fallback (no window.confirm/hard delete); inline confirm panel in modal footer; ProductFormModal business picker honors `business_assignment_ids`
- **DashboardPage**: scope split (mine/overseen/all — `overseenBranchIds`=accessible−primary) wired into branches/reports/issues/balances/revenue queries + cacheKeys; segmented control; allProducts excludes tombstones; Super command centre: Open Transfers/Low Stock/Stock Value/Active Products KPIs, Business Breakdown table, Recent Activity feed (audit_log last 8)
- **Suite REWRITTEN + PASSING** (`supabase db query --linked -f supabase/tests/authorization_test.sql` → `ALL TESTS PASSED`, ROLLBACK): 27A business isolation; 27B locations; 27C oversight (admin sees 3 branches/2 products/2 balances, creates product at A2 — positive; foreign business still denied); 27D primary-only one-admin + oversight assignment positive; 27E directory business-scoped, fellow-admin visible-but-ineditable, blind writes 0 rows; 27F audited movements; **27G NEW**: location grant widens/revoke collapses visibility, hard delete blocked (0 rows), soft delete creates frozen tombstone, admin/overseeing-admin see tombstone, staff/manager never; SUPER controls; final row `ALL TESTS PASSED`
- **Post-suite verification**: residue clean (products 5 = 3 tombstones, users 5, businesses 4, branches 6, locations 7, audit 34, daily_sales 0); full gate green (tsc OK, eslint 0 errors/3 warnings, build ✓ 22.7s)
- **Reports scoping check**: no ReportsPage — `WeeklyReportsPage`/`ReportTypesPage` rely on RLS-only scoping (businesses/branches/weekly_reports/report_types policies) — acceptable per plan

## Files changed (round 2)
- `supabase/migrations/202609190001_restore_oversight_scope.sql`, `202609190002_product_soft_delete.sql`, `202609190003_products_soft_delete_transition.sql` (all applied)
- `.opencode/backups/pre_restore_20260926.sql` (backup)
- `supabase/functions/`: manage-product, create-user-account, update-user-role, update-user-status, delete-user (deployed)
- `supabase/tests/authorization_test.sql` (rewritten, passing)
- `src/context/AuthContext.tsx`, `src/types/database.ts`
- `src/pages/`: DashboardPage, ProductsPage, InventoryPage, SalesPage, TransfersPage, UserManagementPage

## Next Move
- Round 2 is verified end-to-end (suite + gate + residue). Remaining optional items: responsive pass on changed pages, hierarchical assignment UI — then commit when user approves.
