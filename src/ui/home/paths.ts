// Root-relative path helpers shared by the home screen and the editor's "back to folder" links (design.md §8.2
// amendment A16: folders are real subdirectories of the served root; a diagram's id is its root-relative path
// without the `.mmd` extension, e.g. `brehob/stage-2`).

/** The folder part of a root-relative path (`''` when it has none, i.e. the served root). */
export function folderOf(relPath: string): string {
  const idx = relPath.lastIndexOf('/');
  return idx === -1 ? '' : relPath.slice(0, idx);
}

/** The bare file or folder name at the end of a root-relative path. */
export function baseNameOf(relPath: string): string {
  const idx = relPath.lastIndexOf('/');
  return idx === -1 ? relPath : relPath.slice(idx + 1);
}

/** `dir` joined with one more segment (folder or file name). */
export function joinDir(dir: string, name: string): string {
  return dir ? `${dir}/${name}` : name;
}

/** The home page's URL for a folder (`?dir=`, dropped entirely for the root, design.md A16: "remembered in the URL
 *  … so Back works"). */
export function homeHref(dir: string): string {
  return dir ? `/?dir=${encodeURIComponent(dir)}` : '/';
}

/** Breadcrumb segments for a folder path, root first: `"brehob/legal"` → `[{label:"brehob",dir:"brehob"},
 *  {label:"legal",dir:"brehob/legal"}]` (the root itself isn't included; render it separately). */
export function crumbs(dir: string): { label: string; dir: string }[] {
  if (!dir) return [];
  const parts = dir.split('/');
  const out: { label: string; dir: string }[] = [];
  let acc = '';
  for (const part of parts) {
    acc = acc ? `${acc}/${part}` : part;
    out.push({ label: part, dir: acc });
  }
  return out;
}

/** The current `?dir=` (default `''`, the served root), read the same way `?file=` is in `App.tsx`. */
export function currentDir(): string {
  return new URLSearchParams(location.search).get('dir') ?? '';
}
