import { useState, lazy, Suspense } from 'react';
import { AuthProvider, useAuth } from '@/context/AuthContext';
import { LoginPage } from '@/pages/LoginPage';
import { AppShell, canAccessPage, type PageKey } from '@/components/AppShell';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { NotFoundPage } from '@/components/NotFoundPage';
import { LoadingState } from '@/components/ui/States';

const DashboardPage = lazy(() => import('@/pages/DashboardPage').then(m => ({ default: m.DashboardPage })));
const BusinessBranchPage = lazy(() => import('@/pages/BusinessBranchPage').then(m => ({ default: m.BusinessBranchPage })));
const UserManagementPage = lazy(() => import('@/pages/UserManagementPage').then(m => ({ default: m.UserManagementPage })));
const WeeklyReportsPage = lazy(() => import('@/pages/WeeklyReportsPage').then(m => ({ default: m.WeeklyReportsPage })));
const ReconciliationPage = lazy(() => import('@/pages/ReconciliationPage').then(m => ({ default: m.ReconciliationPage })));
const ProductsPage = lazy(() => import('@/pages/ProductsPage').then(m => ({ default: m.ProductsPage })));
const InventoryPage = lazy(() => import('@/pages/InventoryPage').then(m => ({ default: m.InventoryPage })));
const IssuesPage = lazy(() => import('@/pages/IssuesPage').then(m => ({ default: m.IssuesPage })));
const ActivitiesPage = lazy(() => import('@/pages/ActivitiesPage').then(m => ({ default: m.ActivitiesPage })));
const TransfersPage = lazy(() => import('@/pages/TransfersPage').then(m => ({ default: m.TransfersPage })));
const ProcurementPage = lazy(() => import('@/pages/ProcurementPage').then(m => ({ default: m.ProcurementPage })));
const SalesPage = lazy(() => import('@/pages/SalesPage').then(m => ({ default: m.SalesPage })));
const QuotationsPage = lazy(() => import('@/pages/QuotationsPage').then(m => ({ default: m.QuotationsPage })));
const ExpensesPage = lazy(() => import('@/pages/ExpensesPage').then(m => ({ default: m.ExpensesPage })));
const AuditLogPage = lazy(() => import('@/pages/AuditLogPage').then(m => ({ default: m.AuditLogPage })));
const DepartmentsPage = lazy(() => import('@/pages/DepartmentsPage').then(m => ({ default: m.DepartmentsPage })));
const TeamsPage = lazy(() => import('@/pages/TeamsPage').then(m => ({ default: m.TeamsPage })));
const CustomersPage = lazy(() => import('@/pages/CustomersPage').then(m => ({ default: m.CustomersPage })));
const ServicesPage = lazy(() => import('@/pages/ServicesPage').then(m => ({ default: m.ServicesPage })));
const SuppliersPage = lazy(() => import('@/pages/SuppliersPage').then(m => ({ default: m.SuppliersPage })));
const LocationsPage = lazy(() => import('@/pages/LocationsPage').then(m => ({ default: m.LocationsPage })));
const WorkflowsPage = lazy(() => import('@/pages/WorkflowsPage').then(m => ({ default: m.WorkflowsPage })));
const ReportTypesPage = lazy(() => import('@/pages/ReportTypesPage').then(m => ({ default: m.ReportTypesPage })));

const PAGE_STORAGE_KEY = 'cedoka:page';

const ALL_PAGES: PageKey[] = [
  'dashboard', 'businesses', 'users', 'reports', 'reconciliation', 'products',
  'inventory', 'issues', 'activities', 'transfers', 'procurement', 'sales',
  'quotations',
  'expenses', 'departments', 'teams', 'customers', 'services', 'suppliers', 'locations',
  'workflows', 'report-types', 'audit',
];

function loadSavedPage(): PageKey {
  try {
    const saved = window.localStorage.getItem(PAGE_STORAGE_KEY);
    if (saved && (ALL_PAGES as string[]).includes(saved)) return saved as PageKey;
  } catch {
    // storage unavailable — fall through to dashboard
  }
  return 'dashboard';
}

function AppContent() {
  const { user, loading } = useAuth();
  const [currentPage, setCurrentPage] = useState<PageKey>(loadSavedPage);

  const goToPage = (page: PageKey) => {
    setCurrentPage(page);
    try {
      window.localStorage.setItem(PAGE_STORAGE_KEY, page);
    } catch {
      // storage unavailable — page simply won't persist
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <LoadingState message="Loading..." />
      </div>
    );
  }

  if (window.location.pathname !== '/' && window.location.pathname !== '') {
    return <NotFoundPage />;
  }

  if (!user) {
    return <LoginPage />;
  }

  // Enforce the same role rules the nav uses: a persisted/injected page key
  // must never render an admin screen for a lower-privileged user (RLS still
  // protects data, but the UI must not expose the surface either).
  const roleName = user.role?.name ?? null;
  const activePage: PageKey = canAccessPage(roleName, currentPage) ? currentPage : 'dashboard';

  const renderPage = () => {
    switch (activePage) {
      case 'dashboard':
        return <DashboardPage />;
      case 'businesses':
        return <BusinessBranchPage />;
      case 'users':
        return <UserManagementPage />;
      case 'reports':
        return <WeeklyReportsPage />;
      case 'reconciliation':
        return <ReconciliationPage />;
      case 'products':
        return <ProductsPage />;
      case 'inventory':
        return <InventoryPage />;
      case 'issues':
        return <IssuesPage />;
      case 'activities':
        return <ActivitiesPage />;
      case 'transfers':
        return <TransfersPage />;
      case 'procurement':
        return <ProcurementPage />;
      case 'sales':
        return <SalesPage />;
      case 'quotations':
        return <QuotationsPage />;
      case 'expenses':
        return <ExpensesPage />;
      case 'departments':
        return <DepartmentsPage />;
      case 'teams':
        return <TeamsPage />;
      case 'customers':
        return <CustomersPage />;
      case 'services':
        return <ServicesPage />;
      case 'suppliers':
        return <SuppliersPage />;
      case 'locations':
        return <LocationsPage />;
      case 'workflows':
        return <WorkflowsPage />;
      case 'report-types':
        return <ReportTypesPage />;
      case 'audit':
        return <AuditLogPage />;
      default:
        return <DashboardPage />;
    }
  };

  return (
    <AppShell currentPage={activePage} onPageChange={goToPage}>
      <Suspense fallback={<div className="p-8 flex justify-center"><LoadingState message="Loading page..." /></div>}>
        {renderPage()}
      </Suspense>
    </AppShell>
  );
}

function App() {
  return (
    <ErrorBoundary>
      <AuthProvider>
        <AppContent />
      </AuthProvider>
    </ErrorBoundary>
  );
}

export default App;
