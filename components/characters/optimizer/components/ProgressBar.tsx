'use client';

/**
 * ProgressBar (Character Optimizer)
 *
 * The three stages of refinement — retrieving, analysing, composing — rendered
 * on the shared segmented bar. The bar itself moved to
 * `components/ui/ProgressBar` when The Almanack needed the same construct; what
 * remains here is this feature's segment list and step vocabulary.
 */

import { ProgressBar as SharedProgressBar, type ProgressSegment } from '@/components/ui/ProgressBar';

interface ProgressBarProps {
  currentStep: string | null;
  startedAt: number | null;
}

const SEGMENTS: ProgressSegment[] = [
  { key: 'loading', label: 'Retrieving', estimatedDurationMs: 3000 },
  { key: 'analyzing', label: 'Analysing', estimatedDurationMs: 15000 },
  { key: 'generating', label: 'Composing', estimatedDurationMs: 20000 },
];

export function ProgressBar({ currentStep, startedAt }: ProgressBarProps) {
  return (
    <SharedProgressBar
      segments={SEGMENTS}
      // A step the segment list doesn't know about reads as "not started", which
      // is the same behaviour the bespoke implementation had.
      currentKey={currentStep}
      startedAt={startedAt}
    />
  );
}
