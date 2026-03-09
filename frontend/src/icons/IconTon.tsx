interface IconProps {
  size?: number;
  className?: string;
}

export function IconTon({ size = 24, className }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <polygon points="12 2 22 12 12 22 2 12" />
      <line x1="2" y1="12" x2="22" y2="12" />
    </svg>
  );
}
