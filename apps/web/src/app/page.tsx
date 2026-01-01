'use client';

import { Plug, TrendingUp, Activity, Clock, CheckCircle2, Search, FileText, Loader2 } from 'lucide-react';
import Link from 'next/link';
import { PageHeader } from '@/components/layout/page-header';
import { Card, CardContent, Badge } from '@/components/ui';
import { useDashboardStats, useDashboardActivity, useDashboardConnections } from '@/lib/hooks';

const quickLinks = [
  { href: '/connections', title: 'Connections', description: 'Configure music services', icon: Plug },
  { href: '/search', title: 'Search', description: 'Find new artists', icon: Search },
  { href: '/subscriptions', title: 'Subscriptions', description: 'Automated music discovery', icon: TrendingUp },
  { href: '/logs', title: 'Logs', description: 'View activity and errors', icon: FileText },
];

export default function Home() {
  // Use React Query hooks - data is cached and shared across navigations
  const { data: stats, isLoading: statsLoading } = useDashboardStats();
  const { data: activities = [], isLoading: activitiesLoading } = useDashboardActivity();
  const { data: connections } = useDashboardConnections();
  
  const isLoading = statsLoading || activitiesLoading;

  const statCards = [
    { label: 'Active Subscriptions', value: stats?.activeSubscriptions ?? '—', icon: TrendingUp, color: 'text-blue-500' },
    { label: 'Artists Added (30d)', value: stats?.artistsAdded ?? '—', icon: CheckCircle2, color: 'text-green-500' },
    { label: 'Pending Reviews', value: stats?.pendingReviews ?? '—', icon: Clock, color: 'text-yellow-500' },
    { label: 'Jobs Running', value: stats?.runningJobs ?? '—', icon: Activity, color: 'text-purple-500' },
  ];

  return (
    <>
      <PageHeader title="Dashboard" description="Welcome to Mixarr" />

      {/* Stats Grid */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 mb-8">
        {statCards.map((stat) => (
          <Card key={stat.label}>
            <CardContent className="flex items-center gap-4 p-6">
              <div className={`rounded-full bg-muted p-3 ${stat.color}`}>
                <stat.icon className="h-5 w-5" />
              </div>
              <div>
                <p className="text-2xl font-bold">{isLoading ? <Loader2 className="h-6 w-6 animate-spin" /> : stat.value}</p>
                <p className="text-sm text-muted-foreground">{stat.label}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Connection Status */}
      {connections && connections.total > 0 && (
        <div className="mb-8">
          <h2 className="text-xl font-semibold mb-4">Connections</h2>
          <div className="flex gap-2 flex-wrap">
            {connections.connections.map((conn, i) => (
              <Badge key={i} variant={conn.isActive ? 'success' : 'secondary'}>
                {conn.type}: {conn.name}
              </Badge>
            ))}
          </div>
        </div>
      )}

      {/* Quick Links */}
      <h2 className="text-xl font-semibold mb-4">Quick Access</h2>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        {quickLinks.map((link) => (
          <Link key={link.href} href={link.href}>
            <Card className="h-full transition-all hover:border-primary hover:shadow-md">
              <CardContent className="flex items-center gap-4 p-6">
                <div className="rounded-full bg-primary/10 p-3 text-primary">
                  <link.icon className="h-5 w-5" />
                </div>
                <div className="min-w-0">
                  <h3 className="font-semibold truncate">{link.title}</h3>
                  <p className="text-sm text-muted-foreground truncate">{link.description}</p>
                </div>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>

      {/* Recent Activity */}
      <h2 className="text-xl font-semibold mt-8 mb-4">Recent Activity</h2>
      <Card>
        <CardContent className="py-6">
          {isLoading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : activities.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8 text-center">
              <Activity className="h-12 w-12 text-muted-foreground/50 mb-4" />
              <p className="text-muted-foreground">No recent activity</p>
              <p className="text-sm text-muted-foreground mt-1">
                Set up connections to get started with music discovery
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {activities.map((activity) => (
                <div key={activity.id} className="flex items-center gap-4 p-3 rounded-lg bg-muted/50">
                  <div className={`rounded-full p-2 ${
                    activity.status === 'completed' ? 'bg-green-500/10 text-green-500' :
                    activity.status === 'failed' ? 'bg-red-500/10 text-red-500' :
                    'bg-blue-500/10 text-blue-500'
                  }`}>
                    {activity.status === 'completed' ? <CheckCircle2 className="h-4 w-4" /> :
                     activity.status === 'failed' ? <Activity className="h-4 w-4" /> :
                     <Loader2 className="h-4 w-4 animate-spin" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium truncate">{activity.title}</p>
                    <p className="text-sm text-muted-foreground truncate">{activity.description}</p>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {new Date(activity.timestamp).toLocaleString()}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </>
  );
}
