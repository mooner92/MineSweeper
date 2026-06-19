import { getReviewQueue } from '@/lib/data';
import { ReviewQueueBoard } from './board';

export const dynamic = 'force-dynamic';

export default async function ReviewQueuePage() {
  const all = await getReviewQueue();
  return <ReviewQueueBoard items={all} />;
}
