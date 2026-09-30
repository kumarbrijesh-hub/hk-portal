import React from 'react';
import { CurrentStatus, BucketType } from '../types';

interface StatusBadgeProps {
  status: CurrentStatus | string;
}

export const StatusBadge: React.FC<StatusBadgeProps> = ({ status }) => {
  let badgeClasses = 'bg-slate-100 text-slate-700 border-slate-200';

  switch (status) {
    case 'No Update':
      badgeClasses = 'bg-slate-100 text-slate-800 border-slate-300 font-semibold';
      break;
    case 'RAC Aligned':
    case 'OEM Aligned':
      badgeClasses = 'bg-blue-50 text-blue-700 border-blue-200';
      break;
    case 'RAC Visited':
    case 'OEM Visited':
      badgeClasses = 'bg-indigo-50 text-indigo-700 border-indigo-200';
      break;
    case 'Auto Disable':
      badgeClasses = 'bg-rose-100 text-rose-800 border-rose-300 font-bold';
      break;
    case 'Disable':
      badgeClasses = 'bg-slate-200 text-slate-800 border-slate-300';
      break;
    case 'Disruption':
      badgeClasses = 'bg-red-50 text-red-700 border-red-200 font-semibold';
      break;
    case 'Known Admin Issue':
      badgeClasses = 'bg-purple-50 text-purple-700 border-purple-200';
      break;
    case 'Audit in Process':
      badgeClasses = 'bg-amber-50 text-amber-800 border-amber-300';
      break;
    case 'Resolved by RAC':
    case 'Resolved by OEM':
    case 'Resolved by Dealer':
    case 'Resolved by CC':
      badgeClasses = 'bg-emerald-50 text-emerald-700 border-emerald-200';
      break;
  }

  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium border ${badgeClasses} whitespace-nowrap`}
    >
      {status}
    </span>
  );
};

export const BucketBadge: React.FC<{ bucket: BucketType | string }> = ({ bucket }) => {
  let badgeClasses = 'bg-slate-100 text-slate-700 border-slate-200';
  if (bucket === 'Breakdown') {
    badgeClasses = 'bg-red-50 text-red-700 border-red-200 font-semibold';
  } else if (bucket === 'Non Breakdown') {
    badgeClasses = 'bg-amber-50 text-amber-700 border-amber-200';
  } else if (bucket === 'False Alarm / Invalid') {
    badgeClasses = 'bg-slate-100 text-slate-600 border-slate-200';
  }

  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium border ${badgeClasses} whitespace-nowrap`}>
      {bucket}
    </span>
  );
};
