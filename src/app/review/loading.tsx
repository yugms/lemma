import {
  ListSkeleton,
  LoadingAnnouncement,
  PageHeaderSkeleton,
} from "@/components/skeletons";

export default function Loading() {
  return (
    <div className="space-y-14">
      <LoadingAnnouncement>Loading your review queue</LoadingAnnouncement>
      <PageHeaderSkeleton />
      <ListSkeleton rows={5} />
    </div>
  );
}
