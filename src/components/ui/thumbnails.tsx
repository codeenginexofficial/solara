/**
 * Vector thumbnails for Mars datasets and Jezero crater region.
 * High-performance, self-contained SVG graphics matching the visual dashboard reference.
 */

export function JezeroThumbnail({ className = 'size-11' }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 44 44"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
    >
      <rect width="44" height="44" rx="8" fill="#181513" />
      {/* Outer crater rim */}
      <circle cx="26" cy="20" r="15" stroke="#3d2c22" strokeWidth="2" opacity="0.8" />
      {/* Crater floor */}
      <circle cx="26" cy="20" r="12" fill="#241b16" />
      {/* River inlet canyon & delta deposit */}
      <path
        d="M2 13C10 15 16 18 20 22C23 25 25 25 30 24"
        stroke="#6e4f3a"
        strokeWidth="2.5"
        strokeLinecap="round"
      />
      {/* Fan delta spread */}
      <path
        d="M20 22L27 18M20 22L28 23M20 22L25 27"
        stroke="#8a6349"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      {/* Secondary small craters */}
      <circle cx="10" cy="32" r="4.5" stroke="#3d2c22" strokeWidth="1.5" fill="#1c1613" />
      <circle cx="34" cy="34" r="3" stroke="#3d2c22" strokeWidth="1.2" fill="#1c1613" />
    </svg>
  );
}

export function CtxThumbnail({ className = 'size-11' }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 44 44"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
    >
      <rect width="44" height="44" rx="8" fill="#161616" />
      <circle cx="18" cy="18" r="8" stroke="#333333" strokeWidth="2" fill="#1e1e1e" />
      <circle cx="32" cy="30" r="5" stroke="#333333" strokeWidth="1.5" fill="#1c1c1c" />
      <path
        d="M4 28C12 24 20 26 28 20C34 16 40 17 44 15"
        stroke="#444444"
        strokeWidth="1.5"
        strokeLinecap="round"
        opacity="0.8"
      />
      <circle cx="8" cy="10" r="2.5" stroke="#2c2c2c" strokeWidth="1" />
      <circle cx="36" cy="10" r="2" stroke="#2c2c2c" strokeWidth="1" />
    </svg>
  );
}

export function TopographyThumbnail({ className = 'size-11' }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 44 44"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
    >
      <rect width="44" height="44" rx="8" fill="#14181a" />
      {/* Elevation contour ripples */}
      <path d="M4 36C12 30 20 34 32 26C38 22 42 24 44 22" stroke="#2a3c42" strokeWidth="1.5" />
      <path d="M4 28C12 22 22 26 30 18C36 14 40 16 44 14" stroke="#3a525a" strokeWidth="1.5" />
      <path d="M4 20C14 14 24 18 32 10C36 8 40 9 44 8" stroke="#4a6873" strokeWidth="1.5" />
    </svg>
  );
}
