/** Status / bucket badges. Every badge carries its text, so state is never colour-alone. */

type Tone = 'critical' | 'warning' | 'good' | 'info' | 'purple' | 'neutral';

export function statusTone(status: string): Tone {
  const value = status.toLowerCase();
  if (value.startsWith('resolved')) return 'good';
  if (value.includes('audit')) return 'purple';
  if (value.includes('admin')) return 'info';
  if (value.includes('disable')) return 'neutral';
  return 'warning';
}

export function bucketTone(bucket: string): Tone {
  const value = bucket.toLowerCase();
  if (value.includes('breakdown') && !value.includes('non')) return 'critical';
  if (value.includes('non breakdown')) return 'warning';
  return 'neutral';
}

export function StatusBadge({ status }: { status: string }) {
  return <span className={`badge ${statusTone(status)}`}>{status}</span>;
}

export function BucketBadge({ bucket }: { bucket: string }) {
  return <span className={`badge ${bucketTone(bucket)}`}>{bucket}</span>;
}

export function ActiveBadge({ active }: { active: boolean }) {
  return (
    <span className={`badge ${active ? 'critical' : 'good'}`}>
      {active ? 'Active' : 'Closed'}
    </span>
  );
}
