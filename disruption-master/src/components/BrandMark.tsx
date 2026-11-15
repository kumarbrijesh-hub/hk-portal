import React from 'react';

/**
 * The Blinkit DMS mark.
 *
 * One component rather than the tile being hand-rolled in the header, the
 * sign-in card and the report banner, because the report is the copy that
 * leaves the building and it must not be the one that drifts.
 *
 * Drawn in markup, not as an image file: the report is captured with
 * html-to-image, and an <img> would need to be fetched and inlined during the
 * capture, which is exactly the step that silently produces a blank box.
 */

export type BrandMarkSize = 'sm' | 'md' | 'lg';

const TILE: Record<BrandMarkSize, string> = {
  sm: 'w-7 h-7 text-[9px] rounded-md',
  md: 'w-10 h-10 text-lg rounded-lg',
  lg: 'w-10 h-10 text-lg rounded-lg',
};

const WORDMARK: Record<BrandMarkSize, string> = {
  sm: 'text-[11px]',
  md: 'text-sm',
  lg: 'text-xl',
};

interface BrandMarkProps {
  size?: BrandMarkSize;
  /** Set on dark surfaces - the header and the sign-in banner. */
  onDark?: boolean;
  /** Shows "Blinkit" above "DMS" beside the tile. */
  showWordmark?: boolean;
  className?: string;
}

export const BrandMark: React.FC<BrandMarkProps> = ({
  size = 'md',
  onDark = false,
  showWordmark = true,
  className = '',
}) => {
  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <div
        className={`${TILE[size]} bg-emerald-600 flex items-center justify-center text-white font-extrabold tracking-tight shadow-inner shrink-0`}
        aria-hidden="true"
      >
        DMS
      </div>
      {showWordmark && (
        <div className="leading-none">
          <div
            className={`${WORDMARK[size]} font-extrabold tracking-tight ${
              onDark ? 'text-white' : 'text-slate-900'
            }`}
          >
            Blinkit
          </div>
          <div
            className={`text-[10px] font-bold tracking-[0.18em] uppercase mt-0.5 ${
              onDark ? 'text-emerald-400' : 'text-emerald-600'
            }`}
          >
            DMS
          </div>
        </div>
      )}
    </div>
  );
};
