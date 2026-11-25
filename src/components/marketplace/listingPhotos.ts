/** Les seuls emplacements écrits par le parcours de scan du vendeur. */
export function listingPhotoName(path: string, ownerId: string, itemId: string | null): boolean {
  if (!itemId) return false;
  const parts = path.split('/');
  return parts.length === 3 && parts[0] === ownerId && parts[1] === itemId
    && /^(face|dos|defaut)\.(jpg|png|webp)$/.test(parts[2]);
}
