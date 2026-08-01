import {
  ListSkeleton,
  LoadingAnnouncement,
  PageHeaderSkeleton,
} from "@/components/skeletons";

export default function Loading() {
  return (
    <div className="mx-auto max-w-3xl">
      <LoadingAnnouncement>Loading your sets</LoadingAnnouncement>
      <PageHeaderSkeleton />
      <ListSkeleton rows={5} />
    </div>
  );
}
