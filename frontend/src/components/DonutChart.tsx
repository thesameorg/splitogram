import { formatAmount } from '../utils/format';
import { useTranslation } from 'react-i18next';

interface Segment {
  label: string;
  value: number;
  isCurrentUser: boolean;
}

interface DonutChartProps {
  segments: Segment[];
  total: number;
  currency: string;
}

const COLORS = [
  '#4F46E5', // indigo
  '#0EA5E9', // sky
  '#10B981', // emerald
  '#F59E0B', // amber
  '#EF4444', // red
  '#8B5CF6', // violet
  '#EC4899', // pink
  '#14B8A6', // teal
];

const CURRENT_USER_COLOR = '#6366F1'; // brighter indigo for current user

export function DonutChart({ segments, total, currency }: DonutChartProps) {
  const { t } = useTranslation();

  const radius = 70;
  const strokeWidth = 22;
  const circumference = 2 * Math.PI * radius;
  const center = radius + strokeWidth;
  const size = center * 2;

  if (total === 0) {
    return (
      <div className="flex justify-center py-4">
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
          <circle
            cx={center}
            cy={center}
            r={radius}
            fill="none"
            stroke="currentColor"
            strokeWidth={strokeWidth}
            className="text-tg-separator"
          />
          <text
            x={center}
            y={center}
            textAnchor="middle"
            dominantBaseline="central"
            className="fill-tg-hint text-sm"
            fontSize="14"
          >
            {t('group.statsNoData')}
          </text>
        </svg>
      </div>
    );
  }

  let offset = 0;
  const arcs = segments
    .filter((s) => s.value > 0)
    .map((seg, i) => {
      const fraction = seg.value / total;
      const dashLength = fraction * circumference;
      const color = seg.isCurrentUser ? CURRENT_USER_COLOR : COLORS[i % COLORS.length];
      const arc = { ...seg, dashLength, offset, color };
      offset += dashLength;
      return arc;
    });

  return (
    <div className="flex justify-center py-4">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        {/* Background track */}
        <circle
          cx={center}
          cy={center}
          r={radius}
          fill="none"
          stroke="currentColor"
          strokeWidth={strokeWidth}
          className="text-tg-separator"
        />
        {/* Segments */}
        {arcs.map((arc, i) => (
          <circle
            key={i}
            cx={center}
            cy={center}
            r={radius}
            fill="none"
            stroke={arc.color}
            strokeWidth={arc.isCurrentUser ? strokeWidth + 4 : strokeWidth}
            strokeDasharray={`${arc.dashLength} ${circumference - arc.dashLength}`}
            strokeDashoffset={-arc.offset}
            strokeLinecap="butt"
            transform={`rotate(-90 ${center} ${center})`}
          />
        ))}
        {/* Center text */}
        <text
          x={center}
          y={center - 10}
          textAnchor="middle"
          dominantBaseline="central"
          className="fill-tg-hint"
          fontSize="12"
        >
          {t('group.statsTotal')}
        </text>
        <text
          x={center}
          y={center + 10}
          textAnchor="middle"
          dominantBaseline="central"
          className="fill-tg-text"
          fontSize="16"
          fontWeight="bold"
        >
          {formatAmount(total, currency)}
        </text>
      </svg>
    </div>
  );
}
