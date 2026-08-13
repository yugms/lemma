import { LoadingAnnouncement, PageHeaderSkeleton, SPEC_ROW } from "@/components/skeletons";

export default function Loading() {
  return (
    <div className="mx-auto max-w-3xl">
      <LoadingAnnouncement>Loading the course catalog</LoadingAnnouncement>
      <PageHeaderSkeleton wide />
      <div className="border-t border-line">
        {Array.from({ length: 5 }, (_, i) => (
          <div key={i} className={SPEC_ROW}>
            <div className="skeleton h-2.5 w-20" />
            <div className="flex flex-wrap gap-2">
              {Array.from({ length: 4 }, (_, j) => (
                <div key={j} className="skeleton h-8 w-28" />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
