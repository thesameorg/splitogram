import { imageUrl } from '../utils/image';

interface AvatarProps {
  avatarKey?: string | null;
  displayName: string;
  size?: 'sm' | 'md' | 'lg';
  emoji?: string | null;
}

const SIZE_CLASSES = {
  sm: 'w-8 h-8 text-xs',
  md: 'w-10 h-10 text-sm',
  lg: 'w-16 h-16 text-xl',
};

export function Avatar({ avatarKey, displayName, size = 'md', emoji }: AvatarProps) {
  const sizeClass = SIZE_CLASSES[size];

  if (avatarKey) {
    return (
      <img
        src={imageUrl(avatarKey)}
        alt={displayName}
        className={`${sizeClass} rounded-full object-cover`}
      />
    );
  }

  // Emoji avatar (for groups)
  if (emoji) {
    return (
      <div
        className={`${sizeClass} rounded-full bg-tg-secondary-bg flex items-center justify-center`}
      >
        {emoji}
      </div>
    );
  }

  // Initials fallback
  const initials = displayName
    .split(' ')
    .map((w) => w[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);

  return (
    <div
      className={`${sizeClass} rounded-full bg-tg-button/20 text-tg-button flex items-center justify-center font-medium`}
    >
      {initials}
    </div>
  );
}
