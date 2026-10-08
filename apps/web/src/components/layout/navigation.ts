import Download from 'lucide-react/dist/esm/icons/download';
import FileText from 'lucide-react/dist/esm/icons/file-text';
import Home from 'lucide-react/dist/esm/icons/home';
import Layers from 'lucide-react/dist/esm/icons/layers';
import Library from 'lucide-react/dist/esm/icons/library';
import ListChecks from 'lucide-react/dist/esm/icons/list-checks';
import Plug from 'lucide-react/dist/esm/icons/plug';
import Search from 'lucide-react/dist/esm/icons/search';
import Settings from 'lucide-react/dist/esm/icons/settings';
import Sparkles from 'lucide-react/dist/esm/icons/sparkles';
import TrendingUp from 'lucide-react/dist/esm/icons/trending-up';
import Users from 'lucide-react/dist/esm/icons/users';
import Waypoints from 'lucide-react/dist/esm/icons/waypoints';

interface NavItem {
  href: string;
  label: string;
  icon: typeof Home;
  adminOnly?: boolean;
}

interface NavGroup {
  label: string;
  adminOnly?: boolean;
  items: NavItem[];
}

const navGroups: NavGroup[] = [
  {
    label: 'Discovery',
    items: [
      { href: '/', label: 'Dashboard', icon: Home },
      { href: '/search', label: 'Search', icon: Search },
      { href: '/discover', label: 'Discover', icon: Sparkles },
      { href: '/constellation', label: 'Constellation', icon: Waypoints },
    ],
  },
  {
    label: 'Management',
    items: [
      { href: '/subscriptions', label: 'Subscriptions', icon: TrendingUp },
      { href: '/queue', label: 'Review Queue', icon: ListChecks },
      { href: '/downloads', label: 'Downloads', icon: Download },
    ],
  },
  {
    label: 'System',
    adminOnly: true,
    items: [
      { href: '/connections', label: 'Connections', icon: Plug },
      { href: '/library', label: 'Library', icon: Library },
      { href: '/jobs', label: 'Jobs', icon: Layers },
      { href: '/logs', label: 'Logs', icon: FileText },
      { href: '/users', label: 'Users', icon: Users },
      { href: '/settings', label: 'Settings', icon: Settings },
    ],
  },
];

export function navigationForRole(role: 'admin' | 'user' | undefined) {
  return navGroups.filter(group => !group.adminOnly || role === 'admin')
    .map(group => ({ ...group, items: group.items.filter(item => !item.adminOnly || role === 'admin') }))
    .filter(group => group.items.length > 0);
}
