import { type ReactNode, useEffect, useState } from 'react';
import {
  LayoutDashboard,
  Building2,
  Users,
  ClipboardList,
  Package,
  ArrowLeftRight,
  ShoppingCart,
  AlertTriangle,
  CalendarDays,
  FileText,
  LogOut,
  Menu,
  X,
  ChevronDown,
  ClipboardCheck,
  DollarSign,
  Wallet,
  Layers,
  MapPin,
  Wrench,
  GitBranch,
} from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { supabase } from '@/lib/supabaseClient';
import { ROLE_COLORS } from '@/lib/rbac';
import type { RoleName } from '@/types/database';
import logo from '@/logo.jpeg';

export type PageKey =
  | 'dashboard'
  | 'businesses'
  | 'users'
  | 'reports'
  | 'reconciliation'
  | 'products'
  | 'inventory'
  | 'transfers'
  | 'procurement'
  | 'sales'
  | 'expenses'
  | 'issues'
  | 'activities'
  | 'audit'
  | 'departments'
  | 'teams'
  | 'customers'
  | 'services'
  | 'locations'
  | 'workflows';

interface NavItem {
  key: PageKey;
  label: string;
  icon: typeof LayoutDashboard;
  visible: (role: RoleName | null) => boolean;
  section: 'operations' | 'catalog' | 'organization';
}

const NAV_ITEMS: NavItem[] = [
  // Operations
  { key: 'dashboard', label: 'Dashboard', icon: LayoutDashboard, visible: () => true, section: 'operations' },
  { key: 'reports', label: 'Weekly Reports', icon: ClipboardList, visible: () => true, section: 'operations' },
  { key: 'reconciliation', label: 'Reconciliation', icon: ClipboardCheck, visible: (r) => r !== 'sales_person', section: 'operations' },
  { key: 'inventory', label: 'Inventory', icon: Package, visible: (r) => r !== 'sales_person', section: 'operations' },
  { key: 'transfers', label: 'Stock Transfers', icon: ArrowLeftRight, visible: (r) => r !== 'sales_person', section: 'operations' },
  { key: 'procurement', label: 'Procurement', icon: ShoppingCart, visible: (r) => r !== 'sales_person', section: 'operations' },
  { key: 'sales', label: 'Daily Sales', icon: DollarSign, visible: () => true, section: 'operations' },
  { key: 'expenses', label: 'Expenses', icon: Wallet, visible: (r) => r !== 'sales_person', section: 'operations' },
  { key: 'issues', label: 'Issues & Challenges', icon: AlertTriangle, visible: () => true, section: 'operations' },
  { key: 'activities', label: 'Daily Activities', icon: CalendarDays, visible: () => true, section: 'operations' },
  // Catalog
  { key: 'products', label: 'Products', icon: Package, visible: () => true, section: 'catalog' },
  { key: 'services', label: 'Services', icon: Wrench, visible: () => true, section: 'catalog' },
  { key: 'customers', label: 'Customers', icon: Users, visible: () => true, section: 'catalog' },
  // Organization
  { key: 'businesses', label: 'Businesses & Branches', icon: Building2, visible: (r) => r === 'super_admin' || r === 'admin', section: 'organization' },
  { key: 'departments', label: 'Departments', icon: Layers, visible: (r) => r === 'super_admin' || r === 'admin', section: 'organization' },
  { key: 'teams', label: 'Teams', icon: Users, visible: (r) => r === 'super_admin' || r === 'admin', section: 'organization' },
  { key: 'locations', label: 'Locations', icon: MapPin, visible: (r) => r === 'super_admin' || r === 'admin', section: 'organization' },
  { key: 'workflows', label: 'Workflows', icon: GitBranch, visible: (r) => r === 'super_admin' || r === 'admin', section: 'organization' },
  { key: 'users', label: 'User Management', icon: Users, visible: (r) => r === 'super_admin' || r === 'admin' || r === 'manager', section: 'organization' },
  { key: 'audit', label: 'Audit Log', icon: FileText, visible: (r) => r === 'super_admin' || r === 'admin', section: 'organization' },
];

const SECTION_LABELS: Record<NavItem['section'], string> = {
  operations: 'Operations',
  catalog: 'Catalog',
  organization: 'Organization',
};

interface AppShellProps {
  currentPage: PageKey;
  onPageChange: (page: PageKey) => void;
  children: ReactNode;
}

export function AppShell({ currentPage, onPageChange, children }: AppShellProps) {
  const { user, signOut } = useAuth();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [activityPluginEnabled, setActivityPluginEnabled] = useState(true);
  const [pluginMessage, setPluginMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!user?.id) return;
    supabase
      .from('user_dashboard_plugins')
      .select('is_enabled')
      .eq('user_id', user.id)
      .eq('plugin_key', 'activity_reports')
      .maybeSingle()
      .then(({ data }) => setActivityPluginEnabled(data?.is_enabled ?? true));
  }, [user?.id]);

  const toggleActivityPlugin = async () => {
    const nextEnabled = !activityPluginEnabled;
    setActivityPluginEnabled(nextEnabled);
    const { error } = await supabase.from('user_dashboard_plugins').upsert({
      user_id: user?.id,
      plugin_key: 'activity_reports',
      is_enabled: nextEnabled,
      updated_at: new Date().toISOString(),
    });
    setPluginMessage(error ? 'Could not save preference.' : `Activity reports turned ${nextEnabled ? 'on' : 'off'}.`);
    window.setTimeout(() => setPluginMessage(null), 2500);
    if (!nextEnabled && currentPage === 'activities') onPageChange('dashboard');
  };

  const roleName = user?.role?.name ?? null;
  const visibleItems = NAV_ITEMS.filter((item) => item.visible(roleName) && (item.key !== 'activities' || activityPluginEnabled));
  const currentItem = NAV_ITEMS.find((item) => item.key === currentPage);

  const handlePageChange = (page: PageKey) => {
    onPageChange(page);
    setSidebarOpen(false);
  };

  return (
    <div className="min-h-screen bg-slate-50 flex overflow-x-hidden">
      {/* Mobile overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-slate-900/40 z-30 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={`fixed lg:sticky top-0 left-0 z-40 h-screen w-64 bg-white border-r border-slate-200 flex flex-col transition-transform duration-300 ${
          sidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'
        }`}
      >
        <div className="flex items-center justify-between px-5 py-5 border-b border-slate-100">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl brand-ink overflow-hidden flex items-center justify-center">
              <img src={logo} alt="Cedoka" className="h-full w-full object-cover object-[50%_35%]" />
            </div>
            <div>
              <p className="text-sm font-bold text-slate-900 leading-tight">Cedoka Global</p>
              <p className="text-[10px] text-slate-400 uppercase tracking-wider">Operations Platform</p>
            </div>
          </div>
          <button
            onClick={() => setSidebarOpen(false)}
            aria-label="Close navigation"
            className="lg:hidden p-1.5 rounded-lg text-slate-400 hover:bg-slate-100"
          >
            <X size={20} />
          </button>
        </div>

        <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-4">
          {(Object.keys(SECTION_LABELS) as Array<NavItem['section']>).map((section) => {
            const items = visibleItems.filter((i) => i.section === section);
            if (items.length === 0) return null;
            return (
              <div key={section}>
                <p className="px-3 mb-1.5 text-[10px] font-semibold tracking-widest text-slate-400 uppercase">{SECTION_LABELS[section]}</p>
                <div className="space-y-0.5">
                  {items.map((item) => {
                    const Icon = item.icon;
                    const isActive = currentPage === item.key;
                    return (
                      <button
                        key={item.key}
                        onClick={() => handlePageChange(item.key)}
                        className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all ${
                          isActive
                            ? 'bg-slate-900 text-white shadow-sm'
                            : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                        }`}
                      >
                        <Icon size={18} className={isActive ? 'text-white' : 'text-slate-400'} />
                        <span className="truncate">{item.label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </nav>

        <div className="px-3 py-4 border-t border-slate-100">
          <button
            onClick={signOut}
            className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium text-slate-500 hover:bg-rose-50 hover:text-rose-600 transition-all"
          >
            <LogOut size={18} />
            Sign Out
          </button>
        </div>
      </aside>

      {/* Main content */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top bar */}
        <header className="sticky top-0 z-20 bg-white/80 backdrop-blur-md border-b border-slate-200 px-4 lg:px-8 py-3.5 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setSidebarOpen(true)}
              aria-label="Open navigation"
              className="lg:hidden p-2 rounded-lg text-slate-500 hover:bg-slate-100"
            >
              <Menu size={20} />
            </button>
            <h1 className="text-base font-semibold text-slate-900">
              {currentItem?.label ?? 'Dashboard'}
            </h1>
          </div>

          <div className="relative">
            <button
              onClick={() => setUserMenuOpen(!userMenuOpen)}
              aria-expanded={userMenuOpen}
              aria-haspopup="menu"
              aria-label={`${user?.full_name ?? 'User'} account menu`}
              className="flex items-center gap-2.5 pl-2 pr-3 py-1.5 rounded-lg hover:bg-slate-100 transition-colors"
            >
              <div className="w-8 h-8 rounded-full bg-slate-900 text-white flex items-center justify-center text-sm font-semibold">
                {user?.full_name?.charAt(0).toUpperCase() ?? '?'}
              </div>
              <div className="hidden sm:block text-left">
                <p className="text-sm font-medium text-slate-900 leading-tight">
                  {user?.full_name}
                </p>
                <p className="text-[11px] text-slate-400">
                  {user?.branch?.name ?? user?.business?.name ?? 'Global'}
                </p>
              </div>
              <ChevronDown size={16} className="text-slate-400" />
            </button>

            {userMenuOpen && (
              <>
                <div
                  className="fixed inset-0 z-30"
                  onClick={() => setUserMenuOpen(false)}
                />
                <div className="absolute right-0 top-full mt-2 w-56 bg-white rounded-xl shadow-lg border border-slate-200 py-2 z-40">
                  <div className="px-4 py-2 border-b border-slate-100">
                    <p className="text-sm font-semibold text-slate-900">{user?.full_name}</p>
                    <p className="text-xs text-slate-400">{user?.email}</p>
                    {roleName && (
                      <span
                        className={`inline-flex mt-1.5 px-2 py-0.5 rounded-full text-[10px] font-medium border ${ROLE_COLORS[roleName]}`}
                      >
                        {user?.role?.display_name}
                      </span>
                    )}
                  </div>
                  <button
                    onClick={toggleActivityPlugin}
                    className="w-full flex items-center justify-between gap-2 px-4 py-2 text-sm text-slate-600 hover:bg-slate-50"
                  >
                    <span>Activity reports</span>
                    <span className={`text-xs font-medium ${activityPluginEnabled ? 'text-emerald-600' : 'text-slate-400'}`}>
                      {activityPluginEnabled ? 'On' : 'Off'}
                    </span>
                  </button>
                  {pluginMessage && <p role="status" className="px-4 py-1 text-xs text-emerald-600">{pluginMessage}</p>}
                  <button
                    onClick={() => {
                      setUserMenuOpen(false);
                      signOut();
                    }}
                    className="w-full flex items-center gap-2 px-4 py-2 text-sm text-rose-600 hover:bg-rose-50"
                  >
                    <LogOut size={16} />
                    Sign Out
                  </button>
                </div>
              </>
            )}
          </div>
        </header>

        {/* Page content */}
        <main className="flex-1 min-w-0 overflow-x-hidden p-3 sm:p-6 lg:p-8">{children}</main>
      </div>
    </div>
  );
}
