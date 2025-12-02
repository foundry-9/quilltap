'use client';

import React from 'react';

interface IconProps {
  className?: string;
}

/**
 * Gab AI Icon Component
 * Displays the Gab AI branding icon with customizable styling
 *
 * @param props Icon component properties
 * @param props.className Optional CSS class name for styling
 * @returns JSX Element representing the Gab AI icon
 */
export function GabAIIcon({ className = 'h-5 w-5' }: IconProps) {
  return (
    <svg
      className={`text-green-600 ${className}`}
      fill="currentColor"
      viewBox="0 0 24 24"
      xmlns="http://www.w3.org/2000/svg"
      data-testid="gab-ai-icon"
    >
      {/* Gab AI logo - stylized circular design */}
      <circle cx="12" cy="12" r="11" fill="none" stroke="currentColor" strokeWidth="2" />
      <path
        d="M12 2A10 10 0 1 1 2 12A10 10 0 0 1 12 2Z"
        fill="currentColor"
        opacity="0.1"
      />
      {/* Text label GAB */}
      <text
        x="50%"
        y="50%"
        textAnchor="middle"
        dominantBaseline="middle"
        fill="currentColor"
        fontSize="9"
        fontWeight="bold"
        fontFamily="system-ui, -apple-system, sans-serif"
      >
        GAB
      </text>
    </svg>
  );
}

export default GabAIIcon;
