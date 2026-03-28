import type { Folder } from '../../../types/ui';

export const collectFolderSubtreeIds = (rootId: string, folders: Folder[]): string[] => {
  const childrenByParent = new Map<string, string[]>();
  for (const folder of folders) {
    if (!folder.parentId) continue;
    const children = childrenByParent.get(folder.parentId) ?? [];
    children.push(folder.id);
    childrenByParent.set(folder.parentId, children);
  }

  const ids: string[] = [];
  const stack = [rootId];
  const visited = new Set<string>();
  while (stack.length > 0) {
    const folderId = stack.pop();
    if (!folderId || visited.has(folderId)) continue;
    visited.add(folderId);
    ids.push(folderId);
    const children = childrenByParent.get(folderId) ?? [];
    for (const childId of children) {
      stack.push(childId);
    }
  }

  return ids;
};
