import { notFound, redirect } from 'next/navigation';

import Thread from '@/components/inbox/Thread';
import { createServerSupabaseClient } from '@/lib/supabase-server';

/**
 * EX-F1 — page fil de conversation. Le serveur vérifie la participation
 * (RLS convs_select) puis laisse le client poller /api/conversations/[id].
 */

export default async function ThreadPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  // RLS : participant uniquement → 404 sinon (jamais 403 : pas de fuite)
  const { data: conv } = await supabase
    .from('conversations')
    .select('id')
    .eq('id', id)
    .maybeSingle();
  if (!conv) notFound();

  return (
    <div className="h-[calc(100vh-8rem)] md:h-full">
      <Thread conversationId={id} myId={user.id} />
    </div>
  );
}
