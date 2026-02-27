export interface StatsBarProps {
  pending: number;
  addedToday: number;
}

export function StatsBar({ pending, addedToday }: StatsBarProps) {
  return (
    <div className="text-sm text-muted-foreground mb-6">
      <span>{pending} pending</span>
      <span className="mx-2">•</span>
      <span>{addedToday} added today</span>
    </div>
  );
}
