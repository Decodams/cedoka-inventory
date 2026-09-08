import { useState } from 'react';
import { AuthProvider, useAuth } from '@/context/AuthContext';
import { LoginPage } from '@/pages/LoginPage';
import { AppShell, type PageKey } from '@/components/AppShell';
import { DashboardPage } from '@/pages/DashboardPage';
import { BusinessBranchPage } from '@/pages/BusinessBranchPage';
import { UserManagementPage } from '@/pages/UserManagementPage';
import { WeeklyReportsPage } from '@/pages/WeeklyReportsPage';
import { ReconciliationPage } from '@/pages/ReconciliationPage';
import { ProductsPage } from '@/pages/ProductsPage';
import { InventoryPage } from '@/pages/InventoryPage';
import { IssuesPage } from '@/pages/IssuesPage';
import { ActivitiesPage } from '@/pages/ActivitiesPage';
import { TransfersPage } from '@/pages/TransfersPage';
import { ProcurementPage } from '@/pages/ProcurementPage';
import { SalesPage } from '@/pages/SalesPage';
import { ExpensesPage } from '@/pages/ExpensesPage';
import { AuditLogPage } from '@/pages/AuditLogPage';
import { LoadingState } from '@/components/ui/States';

function AppContent() {
  const { user, loading } = useAuth();
  const [currentPage, setCurrentPage] = useState<PageKey>('dashboard');

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <LoadingState message="Loading..." />
      </div>
    );
  }

  if (!user) {
    return <LoginPage />;
  }

  const renderPage = () => {
    switch (currentPage) {
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
      case 'expenses':
        return <ExpensesPage />;
      case 'audit':
        return <AuditLogPage />;
      default:
        return <DashboardPage />;
    }
  };

  return (
    <AppShell currentPage={currentPage} onPageChange={setCurrentPage}>
      {renderPage()}
    </AppShell>
  );
}

function App() {
  return (
    <AuthProvider>
      <AppContent />
    </AuthProvider>
  );
}

export default App;
