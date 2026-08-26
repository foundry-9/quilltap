/**
 * Tests for the in-flight activity registry
 *
 * The registry is the half of the toolbar chips that covers work which never
 * becomes a `background_jobs` row — the inline image tool, the Concierge
 * classifier, an embedding minted to answer a search.
 */

import {
  beginActivity,
  trackActivity,
  runAttributedToJob,
  getActivityCounts,
  getActivityStartTotals,
  applyChildActivityDelta,
  resetChildActivity,
  __resetActivityRegistryForTests,
} from '@/lib/background-jobs/activity-registry';
import {
  JOB_TYPE_ACTIVITY,
  ACTIVITY_CHIPS,
  ACTIVITY_KINDS,
  activityKindForJobType,
} from '@/lib/background-jobs/activity-kinds';
import { BackgroundJobTypeEnum } from '@/lib/schemas/job.types';

describe('activity registry', () => {
  beforeEach(() => {
    __resetActivityRegistryForTests();
  });

  describe('counting', () => {
    it('counts a span for its whole duration and releases it afterwards', async () => {
      let observed = -1;

      await trackActivity('image', async () => {
        observed = getActivityCounts().image;
      });

      expect(observed).toBe(1);
      expect(getActivityCounts().image).toBe(0);
    });

    it('releases the count when the work throws', async () => {
      await expect(
        trackActivity('image', async () => {
          throw new Error('provider exploded');
        })
      ).rejects.toThrow('provider exploded');

      expect(getActivityCounts().image).toBe(0);
    });

    it('counts concurrent work of the same kind separately', async () => {
      const end1 = beginActivity('image');
      const end2 = beginActivity('image');
      expect(getActivityCounts().image).toBe(2);

      end1();
      expect(getActivityCounts().image).toBe(1);
      end2();
      expect(getActivityCounts().image).toBe(0);
    });

    it('ignores a duplicated end', () => {
      const end = beginActivity('memory');
      end();
      end();
      expect(getActivityCounts().memory).toBe(0);
    });
  });

  describe('same-kind collapsing', () => {
    it('does not double-count a nested span of the same kind', async () => {
      let inner = -1;

      await trackActivity('image', () =>
        trackActivity('image', async () => {
          inner = getActivityCounts().image;
        })
      );

      expect(inner).toBe(1);
    });

    it('still counts a nested span of a different kind', async () => {
      let counts = { image: -1, danger: -1 };

      await trackActivity('image', () =>
        trackActivity('danger', async () => {
          const snapshot = getActivityCounts();
          counts = { image: snapshot.image, danger: snapshot.danger };
        })
      );

      expect(counts).toEqual({ image: 1, danger: 1 });
    });

    it('attributes a job handler to its kind without adding a count', async () => {
      let insideJob = -1;
      let insideNested = -1;

      await runAttributedToJob('image', async () => {
        insideJob = getActivityCounts().image;
        // Inline image work inside an image job collapses into the job row.
        await trackActivity('image', async () => {
          insideNested = getActivityCounts().image;
        });
      });

      expect(insideJob).toBe(0);
      expect(insideNested).toBe(0);
    });

    it('counts other-kind work inside an attributed job', async () => {
      let danger = -1;

      await runAttributedToJob('image', () =>
        trackActivity('danger', async () => {
          danger = getActivityCounts().danger;
        })
      );

      expect(danger).toBe(1);
    });
  });

  describe('blip detection', () => {
    it('does not record a blip for a span shorter than the threshold', async () => {
      await trackActivity('danger', async () => {});
      expect(getActivityStartTotals().danger).toBe(0);
    });

    it('records a blip once a span outlives the threshold', async () => {
      const nowSpy = jest.spyOn(Date, 'now');
      nowSpy.mockReturnValueOnce(0).mockReturnValueOnce(5_000);

      const end = beginActivity('summary');
      end();

      expect(getActivityStartTotals().summary).toBe(1);
      nowSpy.mockRestore();
    });
  });

  describe('child mirror', () => {
    it('adds child-reported work to the parent count', () => {
      applyChildActivityDelta({ type: 'activity', kind: 'embedding', delta: 1 });
      expect(getActivityCounts().embedding).toBe(1);

      applyChildActivityDelta({ type: 'activity', kind: 'embedding', delta: -1 });
      expect(getActivityCounts().embedding).toBe(0);
    });

    it('records a child blip without moving the live count', () => {
      applyChildActivityDelta({ type: 'activity', kind: 'memory', delta: 'blip' });

      expect(getActivityCounts().memory).toBe(0);
      expect(getActivityStartTotals().memory).toBe(1);
    });

    it('zeroes the mirror when the child dies mid-span', () => {
      applyChildActivityDelta({ type: 'activity', kind: 'image', delta: 1 });
      expect(getActivityCounts().image).toBe(1);

      resetChildActivity();
      expect(getActivityCounts().image).toBe(0);
    });

    it('never lets a stray decrement drive a count negative', () => {
      applyChildActivityDelta({ type: 'activity', kind: 'summary', delta: -1 });
      expect(getActivityCounts().summary).toBe(0);
    });
  });
});

describe('activity kinds', () => {
  it('assigns every background job type to a chip or an explicit null', () => {
    for (const type of BackgroundJobTypeEnum.options) {
      expect(JOB_TYPE_ACTIVITY).toHaveProperty(type);
      const kind = JOB_TYPE_ACTIVITY[type];
      expect(kind === null || ACTIVITY_KINDS.includes(kind)).toBe(true);
    }
  });

  it('maps no job types beyond the enum', () => {
    expect(Object.keys(JOB_TYPE_ACTIVITY).sort()).toEqual([...BackgroundJobTypeEnum.options].sort());
  });

  it('renders exactly one chip per kind', () => {
    expect(ACTIVITY_CHIPS.map((chip) => chip.kind).sort()).toEqual([...ACTIVITY_KINDS].sort());
  });

  it('treats an unknown job type as uncounted rather than throwing', () => {
    expect(activityKindForJobType('SOME_FUTURE_JOB')).toBeNull();
  });

  it('counts every image job type under the image chip', () => {
    expect(activityKindForJobType('STORY_BACKGROUND_GENERATION')).toBe('image');
    expect(activityKindForJobType('CHARACTER_AVATAR_GENERATION')).toBe('image');
    expect(activityKindForJobType('CHARACTER_HEADSHOULDERS_BACKFILL')).toBe('image');
  });
});
