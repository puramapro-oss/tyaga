'use client';

import { useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';

import { REFERRAL_STORAGE_KEY } from '@/lib/referral';

/**
 * Consomme le code parrain stocké par /signup?ref=… au premier dashboard
 * vu après inscription (email confirmé ou OAuth Google). Silencieux :
 * le lien d'invitation est valide par construction, toute réponse lève la clé.
 */
export default function ReferralAttach() {
  const router = useRouter();
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return;
    let code: string | null = null;
    try {
      code = sessionStorage.getItem(REFERRAL_STORAGE_KEY);
    } catch {
      return;
    }
    if (!code) return;
    ran.current = true;

    (async () => {
      try {
        await fetch('/api/referral/attach', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ code }),
        });
      } catch {
        // Hors-ligne : la clé reste, nouvel essai au prochain dashboard
        return;
      }
      try {
        sessionStorage.removeItem(REFERRAL_STORAGE_KEY);
      } catch {
        // Stockage refusé : rien d'autre à nettoyer
      }
      router.refresh();
    })();
  }, [router]);

  return null;
}
