import { publishMemberListing } from '@/lib/publish-member-listing';

export function POST(request: Request) {
  return publishMemberListing(request, 'digital');
}
