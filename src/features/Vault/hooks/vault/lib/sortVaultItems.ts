import type { VaultItem } from '../../../types/ui';

const vaultNameCollator = new Intl.Collator(undefined, { sensitivity: 'base', numeric: true });

export const sortVaultItems = (list: VaultItem[]) =>
  [...list].sort((a, b) => {
    if (a.isDefault !== b.isDefault) return a.isDefault ? -1 : 1;
    const byName = vaultNameCollator.compare(a.name, b.name);
    if (byName !== 0) return byName;
    return vaultNameCollator.compare(a.id, b.id);
  });
