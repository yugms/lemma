import {
  ListSkeleton,
  LoadingAnnouncement,
  PageHeaderSkeleton,
} from "@/components/skeletons";

export default function Loading() {
  return (
    <div className="mx-auto max-w-3xl">
      <LoadingAnnouncement>Loading this problem set</LoadingAnnouncement>
      <PageHeaderSkeleton wide />
      <ListSkeleton rows={6} />
    </div>
  );
}
