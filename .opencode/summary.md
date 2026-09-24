# Cedoka Inventory - Session Summary

## Objective
Fix the user's 10-bug list on the Cedoka inventory/sales platform: product detail on row click, product-add stock syncing into inventory, serials staying children of products, comprehensive dashboard charts, real stock values in the products Stock column, inventory records rhyming with product details, full sync across transfers/products/sales/GRN/roles/businesses (no silent desync), de-duplication of products appearing 3× in inventory, all tables paginated at 10 rows/page, and a fully encompassing Admin dashboard — clean flows, correct endpoints, no table/display errors.

## Verified Ground Truth
- Stack: React+TS + Vite + Tailwind; Supabase (auth/DB/edge functions); Vercel -> cedoka-inventory.vercel.app
- Supabase project erxhhqrzxgsklyhsuulx; types `src/types/database.ts`; rbac `src/lib/rbac.ts`; gate: `npx tsc -p tsconfig.app.json --noEmit`, `npx eslint .`, `npm run build` (all exit 0; 3 pre-existing warnings: ReceiptPDF react-refresh, AuthContext:277 react-refresh, SalesPage:230 exhaustive-deps 'selectedProduct')
- Stock source of truth: `inventory_balances` + `inventory_transactions`; sales via RPC `create_sale_with_items`; GRN now via RPC `record_grn_with_items`
- `supabase db query --linked` with multiple statements returns only the LAST result set — run checks as separate calls
- Do NOT commit/push until user explicitly asks; update `.opencode/summary.md` before commit
- `Input` has no `hint` prop; `useSupabaseQuery` disables with `queryFn: null` (a queryFn returning null builder crashes); cacheKey must include page+search; PostgREST embedded filters need `!inner` to filter top rows; client search sanitized with `.replace(/[,%()\\]/g, ' ')` in both `.or()` and client filter

## Work State - COMPLETED (10-bug round, NOT yet committed)
- **Migration `202609170002_stock_sync_integrity.sql` (pushed + verified live)**: numeric(14,2) widening (transactions qty before/after, transfer/GRN item qty, min/reorder on products+balances); duplicate inventory_balances consolidation (Phase A keep max-stock earliest-branch row, Phase B delete untouched zero-rows at branch-less rows when another exists) — kills the "product appears 3×" bug; min/reorder backfilled from products; integer `record_inventory_movement` replaced with numeric version; new `record_grn_with_items` atomic RPC (locks PR, validates, inserts GRN+items+receipt movements, updates PR status, all-or-nothing); Power Go verified: 1 balance row, stock 1.00
- **ProductsPage**: pageSize 10; server-side `.or(name/sku/brand ilike)` search; cacheKey includes page+needle (fixed stale-pagination bug); Stock column shows real balance sums (0→red, ≤min→amber + "min N"); row click/Enter → new ProductDetailModal (details incl. business/category/supplier, per-branch stock + total, serials with status badges, last-10 movements, Edit); count-based footer; seedBalances = single direct insert at creator's branch with payload min/reorder; min/reorder inputs + validation in form; products select embeds business; `Product.business` added to types
- **TransfersPage**: pageSize 10; idempotent advanceStatus (skips products already moved for this transfer via inventory_transactions reference check, aborts WITHOUT status change on failure); syncError banner + busyId disable; count footer
- **InventoryPage**: pageSize 10; server search via matchedProductIds/assets `.or()`; 3 count footers (assets footer gained Prev/Next); cacheKeys include page+search; needle sanitized; metrics use counts
- **CustomersPage / UserManagementPage**: pageSize 10; server search (users: branch/business ids via matched refs, role filter via `roles!inner`); count footers
- **SalesPage / AuditLogPage / ProcurementPage / ReconciliationPage**: client pagination 10/page with footers; Sales/Procurement/Reconciliation got multi-business `accessibleBusinessIds` scoping; Procurement got server search + limit 200 + GRN via atomic RPC (GRNModal currentUser prop removed); Reconciliation PeriodDetailView line pagination (hooks before early returns)
- **DashboardPage (bug 4+10)**: `usersQuery` now returns full RLS-scoped role-joined list for admins (was self-only → Staff Distribution broken); allProducts/pendingUsers gates `isSuperAdmin`→`isAdmin` (products RLS `can_access_business` safe); emptyShelves query replaced by derived `outOfStockCount`; stockBalances enriched with product(cost_price)+branch joins limit 1000; new admin analytics: 4 metric cards (Stock Value at cost, Low Stock, Units On Hand, Branches Holding Stock), Stock-by-Branch bars (top 8), Most Stocked Products (top 8), Low Stock Watchlist (6), 30-day completed-revenue bar chart from daily_sales (local-date keys, business-scoped for non-super); second metric row (Products/Out of Stock/Pending/Roles) now admin-visible; fixed 2 mojibake spots (`â€`→`—`, `Â·`→`·`)
- **Gate: PASS** — tsc 0 errors, eslint 0 errors (3 known pre-existing warnings), `npm run build` ✓

## Files changed (this round)
- `supabase/migrations/202609170002_stock_sync_integrity.sql` (NEW, pushed)
- `src/hooks/useSupabaseQuery.ts` (count exposure)
- `src/pages/`: ProductsPage, TransfersPage, InventoryPage, CustomersPage, UserManagementPage, SalesPage, AuditLogPage, ProcurementPage, ReconciliationPage, DashboardPage
- `src/types/database.ts` (Product.business)

## Next Move
- Report the 10 bugs + fixes to the user; await explicit "commit and push" instruction; commit includes `.opencode/summary.md` update
