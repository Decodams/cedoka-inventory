# Cedoka Inventory - Session Summary

## Objective
Implement the user's **ADMIN/MANAGER/BRANCH & INVENTORY ACCESS-CONTROL SPECIFICATION** (33 sections): strict multi-tenant authorization enforced at DB/backend level (Business → Location → Branch hierarchy, one-admin-per-branch, branch isolation, IDOR prevention, audited movements, SQL authorization tests), not mere UI visibility.

## Verified Ground Truth
- Stack: React/TS + Vite + Tailwind + Supabase (Postgres/RLS/Edge Functions/RPCs); Vercel → cedoka-inventory.vercel.app; remote `https://github.com/Decodams/cedoka-inventory.git`; branch `main` at `55ff9ff`
- Project ref `erxhhqrzxgsklyhsuulx`; CLI v2.115.0
- `supabase db query --linked "<SQL>"` returns only the LAST result set — run checks as separate calls; `--file/-f` exists; without `--linked` it tries local Docker (not running). NOTICEs from DO blocks are NOT surfaced by the CLI — assert via a final `SELECT` row
- Gate: `npx tsc -p tsconfig.app.json --noEmit`, `npx eslint .`, `npm run build` — all pass; 3 allowed pre-existing warnings: ReceiptPDF.tsx:7, AuthContext.tsx:284 react-refresh, SalesPage.tsx:224 exhaustive-deps (`selectedProduct`)
- `tsconfig.app.json` has `"include": ["src"]` → supabase/ NOT type-checked by frontend gate
- Do NOT commit/push until user explicitly says so; update `.opencode/summary.md` before each commit
- User design decisions: (1) Location layer = `business_locations` + `branches.location_id`; (2) branch-scoped products (`products.branch_id`, UNIQUE(business_id, branch_id, sku)); (3) SQL auth tests as single `BEGIN; … ROLLBACK;` with `SET ROLE authenticated` + `set_config('request.jwt.claims','{"sub":"<uuid>","role":"authenticated"}',true)`, DO-block assertions, final confirmation row
- Migrations 202609180001–0004 APPLIED via `supabase db push`; 6 edge functions DEPLOYED: manage-product, create-user-account, update-user-role, update-user-status, delete-user, manage-category
- Live IDs: super `f87e2e5f-c52e-4b9f-8ac0-d9ce3601c6f2`; roles: super_admin `64583bc8-…`, admin `3f94bd78-…`, manager `a9a24d5e-…`, sales_person `fa31bf7d-…`, inventory_officer `00000000-0000-0000-0000-000000000007` (test SQL uses `(SELECT id FROM roles WHERE name='…')` subselects)
- Permission checks live-verified: admin = audit.view, inventory.manage, products.manage, sales.create, transfers.manage, users.manage_branch, users.manage_business; manager = inventory/products/sales/transfers.manage + users.manage_branch; inventory_officer = inventory.manage + transfers.manage; sales_person = sales.create only
- Error messages: 'Branch is outside your scope' / 'Product does not belong to this branch' / 'Quantity must be greater than zero' / 'outside your assigned scope' / 'not stocked at this branch' / 'Transfers permission required' / 'destination branch' / 'already has an Admin' (23505) / 'cannot change your own role, scope, or status' (42501) / 'cannot deactivate administrators' / 'own account' / 'outside your branch scope' / product branch immutability = ERRCODE 23514 `check_violation` with 'cannot be changed'
- All scope helpers are SECURITY DEFINER → no RLS recursion; live pg_policies verified strict (no stale loose SELECT policies); no triggers on auth.users; `user_profiles.id` FK → `auth.users(id)`
- Trigger order note: `enforce_one_admin_per_branch_profile` (alphabetical) fires BEFORE `prevent_self_scope_change` — self-move to an OCCUPIED branch raises 23505, not 42501; tests must target a vacant branch to isolate the self-scope guard

## Work State - COMPLETED (access-control round, NOT committed)
- Migrations A–D written + applied: `202609180001_org_location_hierarchy`, `202609180002_branch_scoped_products`, `202609180003_one_admin_per_branch`, `202609180004_strict_branch_scope_rls` (strict helpers `branch_in_business`/`product_at_branch`/`same_business_branches`/strict `can_access_branch`/`my_branch_ids`/`can_view_user_records`/`can_manage_inventory_period`; policy rewrites for user_profiles/audit/roles/categories/suppliers/units/balances/txns/transfers/items/PR/GRN/serials/sales/weekly_reports/activities/issues/expenses; RPC hardening of `record_inventory_movement`/`create_sale_with_items`/`record_grn_with_items`/`advance_stock_transfer`/`deactivate_user`/`activate_user`; `sales.cancel` seed; audit_log scope columns + fill trigger)
- Edge functions scope-validated + deployed (all 6); update-user-role got target-scope check (target branch in accessibleBranches / branch-less target in accessibleBusinesses)
- Frontend pass DONE (gates pass): rbac (strict canAccessBranch, super-only canManageBranches); AuthContext managed-branches merge; audit.ts optional scope param; Dashboard/Products/Transfers/Inventory/Sales/UserManagement/BusinessBranch pages branch-scoped; ProductsPage Branch column + branch-required form + branch-scoped duplicate check; TransfersPage `advance_stock_transfer` RPC + side gating + branch-filtered product loader; UserManagement inActorScope + myBranchIds-scoped branch dropdowns; BusinessBranchPage super-only writes; database.ts Product gains `branch_id` + `branch?`
- **`supabase/tests/authorization_test.sql` WRITTEN AND PASSING** (`supabase db query --linked -f supabase/tests/authorization_test.sql` → `ALL TESTS PASSED`): §27A business isolation, §27B locations, §27C branch isolation (products/balances/txns writes + immutability), §27D one-admin-per-branch (23505 on insert/move/assignment) + self-scope (42501), §27E IDOR (user_profiles blind-writes, roles, categories, sales scope/mismatch, transfers creation/sides/permission, deactivate_user messages), §27F audited movements (movement success/attribution/stock math, sale + txn + scoped audit row, deactivation audit, audit insert actor+branch scope, cross-tenant invisibility), SUPER positive controls; single transaction, ROLLBACK clean (0 fixture residue verified)

## Files changed (this round)
- `supabase/migrations/202609180001..0004_*.sql` (applied)
- `supabase/functions/`: manage-product, create-user-account, update-user-role, update-user-status, delete-user, manage-category (deployed)
- `supabase/tests/authorization_test.sql` (NEW, passing)
- `src/lib/rbac.ts`, `src/lib/audit.ts`, `src/context/AuthContext.tsx`, `src/types/database.ts`
- `src/pages/`: DashboardPage, ProductsPage, TransfersPage, InventoryPage, SalesPage, UserManagementPage, BusinessBranchPage

## Next Move
- Gate green (tsc/eslint/build) and `authorization_test.sql` passing; committing and pushing this round per user instruction
