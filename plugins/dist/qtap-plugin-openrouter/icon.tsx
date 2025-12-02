'use client';

import React from 'react';

interface IconProps {
  className?: string;
}

/**
 * OpenRouter Icon Component
 * Displays the OpenRouter branding icon with customizable styling
 * Orange color scheme reflecting OpenRouter's brand identity
 *
 * @param props Icon component properties
 * @param props.className Optional CSS class name for styling
 * @returns JSX Element representing the OpenRouter icon
 */
export function OpenRouterIcon({ className = 'h-5 w-5' }: IconProps) {
  return (
    <svg
      className={`text-orange-600 ${className}`}
      fill="currentColor"
      viewBox="0 0 24 24"
      xmlns="http://www.w3.org/2000/svg"
      data-testid="openrouter-icon"
    >
      {/* OpenRouter logo - stylized circular design with orange gradient feel */}
      <circle
        cx="12"
        cy="12"
        r="11"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
      />
      <path
        d="M12 2A10 10 0 1 1 2 12A10 10 0 0 1 12 2Z"
        fill="currentColor"
        opacity="0.1"
      />
      {/* Text label ORT */}
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
        ORT
      </text>
    </svg>
  );
}

export default OpenRouterIcon;
